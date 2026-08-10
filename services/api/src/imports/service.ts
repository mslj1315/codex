import { createHash } from "node:crypto";
import { ParserInputError, parseCsv, parseXlsx } from "./parser.js";
import type { ImportCandidate, ImportBatchDetails, ImportSourceType, CreateCandidateInput } from "./repository.js";
import type { MetricKey } from "./models.js";
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
    const candidates = input.candidates.map((candidate) => this.prepareCandidate(candidate, input.rangeStart, input.rangeEnd));
    return this.imports.createBatchWithCandidates({ ...context, sourceType: "manual", rangeStart: input.rangeStart, rangeEnd: input.rangeEnd }, candidates);
  }

  async createFile(context: TrustedContext, input: { bytes: Buffer; filename: string; mimeType: string; rangeStart: string; rangeEnd: string; currencyUnit?: "yuan" | "cents" }): Promise<ImportBatchDetails> {
    assertRange(input.rangeStart, input.rangeEnd);
    const sourceType = fileType(input.filename, input.mimeType);
    const parsed = sourceType === "csv"
      ? parseCsv(input.bytes.toString("utf8"), input)
      : await parseXlsx(input.bytes, input);
    const batchInput = {
      ...context, sourceType, rangeStart: input.rangeStart, rangeEnd: input.rangeEnd,
      // Design limitation: this is metadata-only until object storage is integrated.
      originalFileKey: `test-placeholder/${createHash("sha256").update(input.bytes).digest("hex")}`,
      originalFileName: input.filename, originalFileMimeType: input.mimeType, originalFileSizeBytes: input.bytes.byteLength,
      originalFileChecksum: createHash("sha256").update(input.bytes).digest("hex")
    };
    const candidates = parsed.candidates.map((candidate) => this.prepareCandidate(candidate, input.rangeStart, input.rangeEnd));
    return this.imports.createBatchWithCandidates(batchInput, candidates);
  }

  getBatch(context: TrustedContext, batchId: string) { return this.imports.getBatch({ id: batchId, enterpriseId: context.enterpriseId, storeId: context.storeId }); }
  getLatest(context: TrustedContext) { return this.imports.getLatestFactVersion(context); }
  async confirm(context: TrustedContext, batchId: string, candidateIds: readonly string[]) {
    const batch = await this.imports.getBatch({ id: batchId, enterpriseId: context.enterpriseId, storeId: context.storeId });
    for (const id of candidateIds) {
      const candidate = batch.candidates.find((item) => item.id === id);
      if (!candidate || candidate.status !== "ready") throw new ValidationError("Only ready candidates in the pending batch can be confirmed");
      validateResolvedCandidate(candidate);
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
    if (resolved.status === "ready") validateResolvedCandidate(resolved);
    return this.imports.updateCandidate({ id: candidateId, batchId, ...context, ...update });
  }

  private prepareCandidate(candidate: CandidateDraft, rangeStart: string, rangeEnd: string): Omit<CreateCandidateInput, "batchId" | "enterpriseId" | "storeId"> {
    if (typeof candidate.metricKey !== "string" || typeof candidate.metricDisplayName !== "string" || typeof candidate.value !== "number" || typeof candidate.unit !== "string") throw new ValidationError("Candidate fields are invalid");
    const start = candidate.rangeStart ?? rangeStart; const end = candidate.rangeEnd ?? rangeEnd;
    assertRange(start, end);
    const prepared = { metricKey: candidate.metricKey, metricDisplayName: candidate.metricDisplayName, value: candidate.value, unit: candidate.unit, rangeStart: start, rangeEnd: end, sourceLocator: candidate.sourceLocator ?? `manual:${candidate.metricKey}`, confidence: candidate.confidence ?? 100, status: candidate.status ?? "ready" as const };
    if (prepared.status === "ready") validateResolvedCandidate(prepared);
    return prepared;
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

const metricUnits: Record<MetricKey, "cents" | "count"> = { revenue: "cents", orders: "count", average_spend: "cents", package_sales: "cents", package_redemptions: "count", refunds: "cents", promotion_spend: "cents" };
const strictlyPositive = new Set<MetricKey>(["orders", "average_spend", "package_sales", "package_redemptions"]);
export function validateResolvedCandidate(candidate: Pick<ImportCandidate, "metricKey" | "unit" | "value" | "rangeStart" | "rangeEnd">): void {
  if (!(candidate.metricKey in metricUnits)) throw new ValidationError("Candidate metric is invalid");
  const key = candidate.metricKey as MetricKey;
  if (candidate.unit !== metricUnits[key]) throw new ValidationError("Candidate unit does not match metric");
  if (!Number.isSafeInteger(candidate.value)) throw new ValidationError("Candidate value must be a JSON safe integer");
  if (candidate.value < 0 || (strictlyPositive.has(key) && candidate.value === 0)) throw new ValidationError("Candidate value is outside metric domain");
  assertRange(candidate.rangeStart, candidate.rangeEnd);
}

export { ParserInputError };
