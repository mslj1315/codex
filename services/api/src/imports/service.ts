import { createHash, randomUUID } from "node:crypto";
import { ParserInputError, parseCsvBytes, parseXlsx } from "./parser.js";
import type { ImportCandidate, ImportBatchDetails, ImportSourceType, CreateCandidateInput, CreateImportObjectReconciliationJob, DataReadiness, DeterministicDiagnostic, ActionCard, ActionCardStatus, ActionCardVerificationOutcome, ActionCardVerificationSummary } from "./repository.js";
import { DuplicateImportFileError, ImportRepository, ValidationError } from "./repository.js";
import {
  ObjectStorageError,
  type ObjectStorage
} from "../storage/object-storage.js";

export interface TrustedContext {
  enterpriseId: string;
  storeId: string;
  actorId: string;
}

export interface CandidateDraft {
  metricKey: string;
  metricDisplayName: string;
  value: number;
  unit: string;
  rangeStart?: string;
  rangeEnd?: string;
  sourceLocator?: string;
  confidence?: number;
  status?: "ready" | "needs_confirmation";
}

export interface FileImportResult {
  batch: ImportBatchDetails;
  duplicate: boolean;
}

export const RAW_FILE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface ImportServiceLogger {
  error(entry: Record<string, unknown>, message?: string): void;
}

export class ImportService {
  constructor(
    private readonly imports: ImportRepository,
    private readonly objectStorage: ObjectStorage,
    private readonly now: () => Date,
    private readonly logger: ImportServiceLogger
  ) {}

  async createManual(context: TrustedContext, input: { rangeStart: string; rangeEnd: string; candidates: CandidateDraft[] }): Promise<ImportBatchDetails> {
    assertRange(input.rangeStart, input.rangeEnd);
    if (!Array.isArray(input.candidates) || input.candidates.length === 0) throw new ValidationError("At least one candidate is required");
    const candidates = input.candidates.map((candidate) => this.prepareCandidate(candidate, input.rangeStart, input.rangeEnd));
    return this.imports.createBatchWithCandidates({ ...context, sourceType: "manual", rangeStart: input.rangeStart, rangeEnd: input.rangeEnd }, candidates);
  }

  async createFile(context: TrustedContext, input: { bytes: Buffer; filename: string; mimeType: string; rangeStart: string; rangeEnd: string; currencyUnit?: "yuan" | "cents" }): Promise<FileImportResult> {
    assertRange(input.rangeStart, input.rangeEnd);
    if (input.bytes.byteLength === 0) throw new ValidationError("File bytes are required");
    const sha256Checksum = createHash("sha256").update(input.bytes).digest("hex");
    const duplicate = await this.imports.findBatchByFileChecksum({
      enterpriseId: context.enterpriseId,
      storeId: context.storeId,
      sha256Checksum
    });
    if (duplicate) return { batch: duplicate, duplicate: true };
    const sourceType = fileType(input.filename, input.mimeType);
    const parsed = sourceType === "csv"
      ? parseCsvBytes(input.bytes, input)
      : await parseXlsx(input.bytes, input);
    if (parsed.candidates.length === 0) throw new ParserInputError("no_recognized_candidates");
    const batchId = randomUUID();
    const uploadedAt = this.now();
    const normalizedMimeType = sourceType === "csv"
      ? "text/csv"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const objectKey = `imports/${objectKeySegment(context.enterpriseId)}/${objectKeySegment(context.storeId)}/${batchId}/${sha256Checksum}.${sourceType}`;
    const batchInput = {
      id: batchId,
      ...context, sourceType, rangeStart: input.rangeStart, rangeEnd: input.rangeEnd
    };
    const candidates = parsed.candidates.map((candidate) => this.prepareCandidate(candidate, input.rangeStart, input.rangeEnd));
    try {
      await this.objectStorage.putObject({ key: objectKey, bytes: input.bytes, contentType: normalizedMimeType });
    } catch (error) {
      const storageError = error instanceof ObjectStorageError
        ? error
        : new ObjectStorageError("Unable to store import file", error);
      await this.compensateObjectWrite(objectKey, {
        enterpriseId: context.enterpriseId, storeId: context.storeId, batchId, sha256Checksum,
      },
        "import_object_put_recovery_failed",
        "Unable to clean up uncertain import object write"
      );
      throw storageError;
    }
    try {
      const batch = await this.imports.createBatchWithCandidates(batchInput, candidates, {
        id: randomUUID(), batchId, enterpriseId: context.enterpriseId, storeId: context.storeId,
        originalFileName: input.filename, normalizedMimeType, byteCount: input.bytes.byteLength,
        sha256Checksum, objectKey, uploadedAt,
        expiresAt: new Date(uploadedAt.getTime() + RAW_FILE_RETENTION_MS)
      });
      return { batch, duplicate: false };
    } catch (error) {
      if (error instanceof DuplicateImportFileError) {
        await this.compensateObjectWrite(objectKey, {
          enterpriseId: context.enterpriseId, storeId: context.storeId, batchId, sha256Checksum
        });
        try {
          const winner = await this.imports.findBatchByFileChecksum({
            enterpriseId: context.enterpriseId,
            storeId: context.storeId,
            sha256Checksum
          });
          if (winner) return { batch: winner, duplicate: true };
        } catch (reloadError) {
          throw reloadError instanceof Error
            ? reloadError
            : new Error("Unable to reload duplicate import", { cause: reloadError });
        }
        throw error;
      }

      const persistenceError = error instanceof Error
        ? error
        : new Error("Import persistence failed", { cause: error });
      try {
        const recovered = await this.imports.getBatch({
          id: batchId,
          enterpriseId: context.enterpriseId,
          storeId: context.storeId
        });
        this.logBestEffort({
          event: "import_persistence_recovered",
          objectKey,
          batchId,
          enterpriseId: context.enterpriseId,
          storeId: context.storeId
        }, "Recovered committed import after persistence response failure");
        return { batch: recovered, duplicate: false };
      } catch (lookupError) {
        await this.enqueueReconciliation({
          id: randomUUID(), enterpriseId: context.enterpriseId, storeId: context.storeId,
          batchId, sha256Checksum, objectKey, kind: "verify_batch_then_delete",
          notBefore: new Date(this.now().getTime() + 5 * 60 * 1000)
        });
        this.logBestEffort({
          event: "import_object_reconciliation_required",
          objectKey,
          batchId,
          enterpriseId: context.enterpriseId,
          storeId: context.storeId,
          cause: diagnosticCause(lookupError)
        }, "Import persistence result requires reconciliation");
        throw persistenceError;
      }
    }
  }

  async getDataReadiness(context: TrustedContext, rangeStart: string, rangeEnd: string): Promise<DataReadiness> {
    return this.imports.getDataReadiness({ ...context, rangeStart, rangeEnd });
  }

  async getDeterministicDiagnostic(context: TrustedContext, rangeStart: string, rangeEnd: string): Promise<DeterministicDiagnostic | null> {
    return this.imports.getDeterministicDiagnostic({ ...context, rangeStart, rangeEnd });
  }

  getDiagnosticRun(context: TrustedContext, id: string) {
    return this.imports.getDiagnosticRun({ id, enterpriseId: context.enterpriseId, storeId: context.storeId });
  }

  async createActionCardFromDiagnostic(context: TrustedContext, rangeStart: string, rangeEnd: string, dueDate?: string): Promise<ActionCard> {
    const diagnostic = await this.getDeterministicDiagnostic(context, rangeStart, rangeEnd);
    if (!diagnostic) throw new ValidationError("No actionable diagnostic is available for this period");
    return this.createActionCard(context, {
      diagnosticKind: diagnostic.kind,
      rangeStart: diagnostic.rangeStart,
      rangeEnd: diagnostic.rangeEnd,
      title: "营业额下降复核",
      action: diagnostic.action,
      verificationMetric: diagnostic.verificationMetric,
      dueDate,
      diagnosticRunId: diagnostic.diagnosticRunId
    });
  }

  createActionCard(context: TrustedContext, input: { diagnosticKind: string; rangeStart: string; rangeEnd: string; title: string; action: string; verificationMetric: string; dueDate?: string; diagnosticRunId?: string }): Promise<ActionCard> {
    return this.imports.createActionCard({ ...context, ...input });
  }

  updateActionCardStatus(context: TrustedContext, id: string, status: ActionCardStatus, now: Date, executionNote?: string, verificationOutcome?: ActionCardVerificationOutcome): Promise<ActionCard> {
    return this.imports.updateActionCardStatus({ id, enterpriseId: context.enterpriseId, storeId: context.storeId, status, now, executionNote, verificationOutcome });
  }
  getActionCard(context: TrustedContext, id: string): Promise<ActionCard> {
    return this.imports.getActionCard({ id, enterpriseId: context.enterpriseId, storeId: context.storeId });
  }
  listActionCards(context: TrustedContext, status?: ActionCardStatus): Promise<ActionCard[]> {
    return this.imports.listActionCards({ enterpriseId: context.enterpriseId, storeId: context.storeId, status });
  }
  getActionCardVerificationSummary(context: TrustedContext, id: string): Promise<ActionCardVerificationSummary | null> {
    return this.imports.getActionCardVerificationSummary({ id, enterpriseId: context.enterpriseId, storeId: context.storeId });
  }

  getBatch(context: TrustedContext, batchId: string) { return this.imports.getBatch({ id: batchId, enterpriseId: context.enterpriseId, storeId: context.storeId }); }
  getLatest(context: TrustedContext) { return this.imports.getLatestFactVersion(context); }
  async getPublishedMetricCatalog() {
    const catalog = await this.imports.getPublishedMetricCatalog();
    return {
      versionNumber: catalog.versionNumber,
      definitions: catalog.definitions.filter((definition) => definition.enabled).map((definition) => ({
        metricKey: definition.metricKey, displayName: definition.displayName, valueKind: definition.valueKind,
        storageUnit: definition.storageUnit, usableForReadiness: definition.usableForReadiness,
        usableForDiagnostic: definition.usableForDiagnostic, usableForVerification: definition.usableForVerification
      }))
    };
  }
  async confirm(context: TrustedContext, batchId: string, candidateIds: readonly string[]) {
    const batch = await this.imports.getBatch({ id: batchId, enterpriseId: context.enterpriseId, storeId: context.storeId });
    for (const id of candidateIds) {
      const candidate = batch.candidates.find((item) => item.id === id);
      if (!candidate || candidate.status !== "ready") throw new ValidationError("Only ready candidates in the pending batch can be confirmed");
    }
    return this.imports.confirmBatch({ batchId, candidateIds, ...context });
  }

  async updateCandidate(context: TrustedContext, batchId: string, candidateId: string, input: Record<string, unknown>): Promise<ImportCandidate> {
    const update: { value?: number; unit?: string; rangeStart?: string; rangeEnd?: string; status?: "ready" | "needs_confirmation" } = {};
    if (input.value !== undefined) { if (typeof input.value !== "number" || !Number.isSafeInteger(input.value)) throw new ValidationError("Candidate value must be a JSON safe integer"); update.value = input.value; }
    if (input.unit !== undefined) { if (typeof input.unit !== "string" || !["cents", "count", "unknown"].includes(input.unit)) throw new ValidationError("Candidate unit is invalid"); update.unit = input.unit; }
    if (input.rangeStart !== undefined) { if (typeof input.rangeStart !== "string") throw new ValidationError("Candidate rangeStart is invalid"); update.rangeStart = input.rangeStart; }
    if (input.rangeEnd !== undefined) { if (typeof input.rangeEnd !== "string") throw new ValidationError("Candidate rangeEnd is invalid"); update.rangeEnd = input.rangeEnd; }
    if (input.status !== undefined) { if (input.status !== "ready" && input.status !== "needs_confirmation") throw new ValidationError("Candidate status is invalid"); update.status = input.status; }
    if (Object.keys(update).length === 0) throw new ValidationError("No supported candidate fields supplied");
    const current = await this.imports.getBatch({ id: batchId, enterpriseId: context.enterpriseId, storeId: context.storeId });
    const existing = current.candidates.find((candidate) => candidate.id === candidateId);
    if (!existing) throw new ValidationError("Candidate does not belong to import batch");
    const resolved = { ...existing, ...update };
    assertRange(resolved.rangeStart, resolved.rangeEnd);
    return this.imports.updateCandidate({ id: candidateId, batchId, ...context, ...update });
  }

  private prepareCandidate(candidate: CandidateDraft, rangeStart: string, rangeEnd: string): Omit<CreateCandidateInput, "batchId" | "enterpriseId" | "storeId"> {
    if (typeof candidate.metricKey !== "string" || typeof candidate.metricDisplayName !== "string" || typeof candidate.value !== "number" || typeof candidate.unit !== "string") throw new ValidationError("Candidate fields are invalid");
    if (candidate.status !== undefined && candidate.status !== "ready" && candidate.status !== "needs_confirmation") throw new ValidationError("Candidate status is invalid");
    if (candidate.confidence !== undefined && (!Number.isInteger(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 100)) throw new ValidationError("Candidate confidence is invalid");
    const start = candidate.rangeStart ?? rangeStart; const end = candidate.rangeEnd ?? rangeEnd;
    assertRange(start, end);
    const prepared = { metricKey: candidate.metricKey, metricDisplayName: candidate.metricDisplayName, value: candidate.value, unit: candidate.unit, rangeStart: start, rangeEnd: end, sourceLocator: candidate.sourceLocator ?? `manual:${candidate.metricKey}`, confidence: candidate.confidence ?? 100, status: candidate.status ?? "ready" as const };
    if (prepared.status === "ready") validateKnownMetricCandidate(prepared);
    return prepared;
  }

  private async compensateObjectWrite(
    objectKey: string,
    base: Pick<CreateImportObjectReconciliationJob, "enterpriseId" | "storeId" | "batchId" | "sha256Checksum">,
    event = "import_object_compensation_failed",
    message = "Unable to compensate import object write"
  ): Promise<void> {
    try {
      await this.objectStorage.deleteObject(objectKey);
    } catch (error) {
      this.logBestEffort({ event, objectKey, cause: diagnosticCause(error) }, message);
      await this.enqueueReconciliation({
        ...base, id: randomUUID(), objectKey, kind: "delete_orphan", notBefore: this.now()
      });
    }
  }

  private async enqueueReconciliation(input: CreateImportObjectReconciliationJob): Promise<void> {
    try {
      await this.imports.enqueueImportObjectReconciliationJob(input);
    } catch (error) {
      this.logBestEffort({
        event: "import_object_reconciliation_enqueue_failed",
        objectKey: input.objectKey,
        batchId: input.batchId,
        kind: input.kind,
        cause: diagnosticCause(error)
      }, "Unable to enqueue import object reconciliation job");
    }
  }

  private logBestEffort(entry: Record<string, unknown>, message: string): void {
    try {
      this.logger.error(entry, message);
    } catch {
      // Logging must never replace the operation result being reported.
    }
  }
}

function fileType(filename: string, mimeType: string): ImportSourceType {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (mimeType === "text/csv") return "csv";
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  throw new ValidationError("Only CSV and XLSX files are supported");
}
function assertRange(start: string, end: string): void {
  const startTime = Date.parse(`${start}T00:00:00Z`); const endTime = Date.parse(`${end}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) throw new ValidationError("Invalid date range");
}

function diagnosticCause(cause: unknown): { type: string; code?: string } {
  const candidate = typeof cause === "object" && cause !== null
    ? cause as { name?: unknown; code?: unknown }
    : undefined;
  const type = diagnosticToken(candidate?.name) ?? (cause === undefined ? "Unknown" : "Error");
  const code = diagnosticToken(candidate?.code);
  return code ? { type, code } : { type };
}

function diagnosticToken(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value)
    ? value
    : undefined;
}

function objectKeySegment(value: string): string {
  return encodeURIComponent(value).replace(/\./g, "%2E");
}

const knownMetricUnits: Record<string, "cents" | "count"> = {
  revenue: "cents", orders: "count", average_spend: "cents", package_sales: "cents",
  package_redemptions: "count", refunds: "cents", promotion_spend: "cents"
};
const knownPositiveMetrics = new Set(["orders", "average_spend", "package_sales", "package_redemptions"]);
function validateKnownMetricCandidate(candidate: Pick<ImportCandidate, "metricKey" | "unit" | "value">): void {
  if (!Number.isSafeInteger(candidate.value)) throw new ValidationError("Candidate value must be a JSON safe integer");
  const unit = knownMetricUnits[candidate.metricKey];
  if (unit !== undefined && (candidate.unit !== unit || candidate.value < 0 || (knownPositiveMetrics.has(candidate.metricKey) && candidate.value === 0))) {
    throw new ValidationError("Candidate value is outside the known metric domain");
  }
}

export { ParserInputError };
