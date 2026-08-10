import { createHash } from "node:crypto";
import { ParserInputError, parseCsv, parseXlsx } from "./parser.js";
import type { ImportCandidate, ImportBatchDetails, ImportSourceType } from "./repository.js";
import { ImportRepository, ValidationError } from "./repository.js";

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

export class ImportService {
  constructor(private readonly imports: ImportRepository) {}

  async createManual(context: TrustedContext, input: { rangeStart: string; rangeEnd: string; candidates: CandidateDraft[] }): Promise<ImportBatchDetails> {
    assertRange(input.rangeStart, input.rangeEnd);
    if (!Array.isArray(input.candidates) || input.candidates.length === 0) throw new ValidationError("At least one candidate is required");
    const batch = await this.imports.createBatch({ ...context, sourceType: "manual", rangeStart: input.rangeStart, rangeEnd: input.rangeEnd });
    for (const candidate of input.candidates) await this.createCandidate(batch.id, context, candidate, input.rangeStart, input.rangeEnd);
    return this.imports.getBatch({ id: batch.id, enterpriseId: context.enterpriseId, storeId: context.storeId });
  }

  async createFile(context: TrustedContext, input: { bytes: Buffer; filename: string; mimeType: string; rangeStart: string; rangeEnd: string; currencyUnit?: "yuan" | "cents" }): Promise<ImportBatchDetails> {
    assertRange(input.rangeStart, input.rangeEnd);
    const sourceType = fileType(input.filename, input.mimeType);
    const parsed = sourceType === "csv"
      ? parseCsv(input.bytes.toString("utf8"), input)
      : await parseXlsx(input.bytes, input);
    const batch = await this.imports.createBatch({
      ...context, sourceType, rangeStart: input.rangeStart, rangeEnd: input.rangeEnd,
      // Design limitation: this is metadata-only until object storage is integrated.
      originalFileKey: `test-placeholder/${createHash("sha256").update(input.bytes).digest("hex")}`,
      originalFileName: input.filename, originalFileMimeType: input.mimeType, originalFileSizeBytes: input.bytes.byteLength,
      originalFileChecksum: createHash("sha256").update(input.bytes).digest("hex")
    });
    for (const candidate of parsed.candidates) await this.imports.createCandidate({ batchId: batch.id, ...context, ...candidate });
    return this.imports.getBatch({ id: batch.id, enterpriseId: context.enterpriseId, storeId: context.storeId });
  }

  getBatch(context: TrustedContext, batchId: string) { return this.imports.getBatch({ id: batchId, enterpriseId: context.enterpriseId, storeId: context.storeId }); }
  getLatest(context: TrustedContext) { return this.imports.getLatestFactVersion(context); }
  confirm(context: TrustedContext, batchId: string, candidateIds: readonly string[]) { return this.imports.confirmBatch({ batchId, candidateIds, ...context }); }

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
    assertRange(update.rangeStart ?? existing.rangeStart, update.rangeEnd ?? existing.rangeEnd);
    return this.imports.updateCandidate({ id: candidateId, batchId, ...context, ...update });
  }

  private async createCandidate(batchId: string, context: TrustedContext, candidate: CandidateDraft, rangeStart: string, rangeEnd: string): Promise<void> {
    if (typeof candidate.metricKey !== "string" || typeof candidate.metricDisplayName !== "string" || typeof candidate.value !== "number" || typeof candidate.unit !== "string") throw new ValidationError("Candidate fields are invalid");
    const start = candidate.rangeStart ?? rangeStart; const end = candidate.rangeEnd ?? rangeEnd;
    assertRange(start, end);
    await this.imports.createCandidate({ batchId, ...context, metricKey: candidate.metricKey, metricDisplayName: candidate.metricDisplayName, value: candidate.value, unit: candidate.unit, rangeStart: start, rangeEnd: end, sourceLocator: candidate.sourceLocator ?? `manual:${candidate.metricKey}`, confidence: candidate.confidence ?? 100, status: candidate.status ?? "ready" });
  }
}

function fileType(filename: string, mimeType: string): ImportSourceType {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || mimeType === "text/csv") return "csv";
  if (lower.endsWith(".xlsx") || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  throw new ValidationError("Only CSV and XLSX files are supported");
}
function assertRange(start: string, end: string): void {
  const startTime = Date.parse(`${start}T00:00:00Z`); const endTime = Date.parse(`${end}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) throw new ValidationError("Invalid date range");
}

export { ParserInputError };
