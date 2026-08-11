import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../db.js";

export type ImportSourceType = "csv" | "xlsx" | "manual";
export type ImportBatchStatus = "pending_confirmation" | "confirmed";
export type CandidateStatus = "ready" | "needs_confirmation" | "confirmed" | "rejected";

export class RepositoryError extends Error {}
export class NotFoundError extends RepositoryError {}
export class ConflictError extends RepositoryError {}
export class DuplicateImportFileError extends ConflictError {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateImportFileError";
  }
}
export class ValidationError extends RepositoryError {}
export class ForbiddenError extends RepositoryError {}

export interface CreateBatchInput {
  id?: string;
  enterpriseId: string;
  storeId: string;
  actorId: string;
  sourceType: ImportSourceType;
  originalFileKey?: string;
  originalFileName?: string;
  originalFileMimeType?: string;
  originalFileSizeBytes?: number;
  originalFileChecksum?: string;
  rangeStart?: string;
  rangeEnd?: string;
}

export interface CreateImportFileInput {
  id: string;
  batchId: string;
  enterpriseId: string;
  storeId: string;
  originalFileName: string;
  normalizedMimeType: string;
  byteCount: number;
  sha256Checksum: string;
  objectKey: string;
  uploadedAt: Date;
  expiresAt: Date;
}

export interface ImportFileRecord extends CreateImportFileInput {
  cleanedAt: Date | null;
  cleanupAttemptedAt: Date | null;
  cleanupFailureCount: number;
}

export const IMPORT_FILE_CLEANUP_RETRY_DELAY_MS = 60 * 60 * 1000;

export interface ImportBatch {
  id: string;
  enterpriseId: string;
  storeId: string;
  actorId: string;
  sourceType: ImportSourceType;
  status: ImportBatchStatus;
  rangeStart: string | null;
  rangeEnd: string | null;
  confirmedByActorId: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCandidateInput {
  batchId: string;
  enterpriseId: string;
  storeId: string;
  metricKey: string;
  metricDisplayName: string;
  value: number;
  unit: string;
  rangeStart: string;
  rangeEnd: string;
  sourceLocator: string;
  confidence: number;
  issueCode?: string;
  status: Exclude<CandidateStatus, "confirmed" | "rejected">;
}

export interface ImportCandidate extends Omit<CreateCandidateInput, "issueCode"> {
  id: string;
  issueCode: string | null;
  confirmedValue: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConfirmBatchInput {
  batchId: string;
  enterpriseId: string;
  storeId: string;
  actorId: string;
  candidateIds: readonly string[];
}

export interface FactVersionScope {
  id: string;
  enterpriseId: string;
  storeId: string;
}

export interface FactValue {
  id: string;
  factVersionId: string;
  enterpriseId: string;
  storeId: string;
  metricKey: string;
  value: number;
  unit: string;
  rangeStart: string;
  rangeEnd: string;
  sourceCandidateId: string;
  sourceBatchId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FactVersion {
  id: string;
  enterpriseId: string;
  storeId: string;
  sourceBatchId: string;
  confirmationActorId: string;
  confirmationStatus: "confirmed";
  confirmedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  values: FactValue[];
}

export interface ImportBatchDetails extends ImportBatch {
  candidates: ImportCandidate[];
}

export interface UpdateCandidateInput {
  id: string;
  batchId: string;
  enterpriseId: string;
  storeId: string;
  value?: number;
  unit?: string;
  rangeStart?: string;
  rangeEnd?: string;
  status?: Exclude<CandidateStatus, "confirmed" | "rejected">;
}

type Row = Record<string, unknown>;

export class ImportRepository {
  constructor(private readonly database: Queryable, private readonly transactionDatabase?: Database) {}

  async createBatchWithCandidates(
    input: CreateBatchInput,
    candidates: readonly Omit<CreateCandidateInput, "batchId" | "enterpriseId" | "storeId">[],
    file?: CreateImportFileInput
  ): Promise<ImportBatchDetails> {
    if (file && (
      input.id === undefined
      || file.batchId !== input.id
      || file.enterpriseId !== input.enterpriseId
      || file.storeId !== input.storeId
    )) {
      throw new ValidationError("Import file scope must match its import batch");
    }
    const database = this.transactionDatabase ?? (isDatabase(this.database) ? this.database : undefined);
    if (!database) throw new Error("Transactions require a database connection");
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const transaction = new ImportRepository(client);
      const batch = await transaction.createBatch(input);
      if (file) await transaction.createImportFile(file);
      for (const candidate of candidates) await transaction.createCandidate({ ...candidate, batchId: batch.id, enterpriseId: input.enterpriseId, storeId: input.storeId });
      const details = await transaction.getBatch({ id: batch.id, enterpriseId: input.enterpriseId, storeId: input.storeId });
      await client.query("COMMIT");
      return details;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async createBatch(input: CreateBatchInput): Promise<ImportBatch> {
    const result = await this.database.query<Row>(
      `INSERT INTO import_batches (
        id, enterprise_id, store_id, actor_id, source_type,
        original_file_key, original_file_name, original_file_mime_type,
        original_file_size_bytes, original_file_checksum, status, range_start, range_end
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending_confirmation', $11, $12)
      RETURNING *`,
      [
        input.id ?? randomUUID(), input.enterpriseId, input.storeId, input.actorId, input.sourceType,
        input.originalFileKey ?? null, input.originalFileName ?? null, input.originalFileMimeType ?? null,
        input.originalFileSizeBytes ?? null, input.originalFileChecksum ?? null,
        input.rangeStart ?? null, input.rangeEnd ?? null
      ]
    );
    return toBatch(result.rows[0]);
  }

  async findBatchByFileChecksum(input: {
    enterpriseId: string;
    storeId: string;
    sha256Checksum: string;
  }): Promise<ImportBatchDetails | null> {
    const result = await this.database.query<Row>(
      `SELECT batch_id FROM import_files
       WHERE enterprise_id = $1 AND store_id = $2 AND sha256_checksum = $3`,
      [input.enterpriseId, input.storeId, input.sha256Checksum]
    );
    if (result.rowCount !== 1) return null;
    return this.getBatch({
      id: string(result.rows[0].batch_id),
      enterpriseId: input.enterpriseId,
      storeId: input.storeId
    });
  }

  async createImportFile(input: CreateImportFileInput): Promise<ImportFileRecord> {
    try {
      const result = await this.database.query<Row>(
        `INSERT INTO import_files (
          id, batch_id, enterprise_id, store_id, original_file_name, normalized_mime_type,
          byte_count, sha256_checksum, object_key, uploaded_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          input.id, input.batchId, input.enterpriseId, input.storeId, input.originalFileName,
          input.normalizedMimeType, input.byteCount, input.sha256Checksum, input.objectKey,
          input.uploadedAt, input.expiresAt
        ]
      );
      return toImportFile(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateImportFileError("Import file already exists for store");
      }
      throw error;
    }
  }

  async listExpiredImportFiles(now: Date, limit = 100): Promise<ImportFileRecord[]> {
    assertValidDate(now, "Cleanup time");
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new ValidationError("Cleanup limit must be an integer between 1 and 1000");
    }
    const retryCutoff = new Date(now.getTime() - IMPORT_FILE_CLEANUP_RETRY_DELAY_MS);
    const result = await this.database.query<Row>(
      `SELECT * FROM import_files
       WHERE cleaned_at IS NULL AND expires_at <= $1
       AND (cleanup_attempted_at IS NULL OR cleanup_attempted_at <= $2)
       ORDER BY CASE WHEN cleanup_attempted_at IS NULL THEN 0 ELSE 1 END,
         cleanup_attempted_at, expires_at, id
       LIMIT $3`,
      [now, retryCutoff, limit]
    );
    return result.rows.map(toImportFile);
  }

  async markImportFileCleaned(id: string, cleanedAt: Date): Promise<boolean> {
    assertValidDate(cleanedAt, "Cleanup time");
    // Retain attempt counters after success as bounded operational history.
    const result = await this.database.query(
      `UPDATE import_files
       SET cleaned_at = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND cleaned_at IS NULL`,
      [cleanedAt, id]
    );
    return result.rowCount === 1;
  }

  async recordImportFileCleanupFailure(id: string, attemptedAt: Date): Promise<boolean> {
    assertValidDate(attemptedAt, "Cleanup attempt time");
    const result = await this.database.query(
      `UPDATE import_files
       SET cleanup_attempted_at = $1,
         cleanup_failure_count = cleanup_failure_count + 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND cleaned_at IS NULL`,
      [attemptedAt, id]
    );
    return result.rowCount === 1;
  }

  async createCandidate(input: CreateCandidateInput): Promise<ImportCandidate> {
    assertSafeInteger(input.value, "Candidate value");
    const batchResult = await this.database.query<Row>(
      "SELECT enterprise_id, store_id FROM import_batches WHERE id = $1",
      [input.batchId]
    );
    if (batchResult.rowCount !== 1) {
      throw new NotFoundError("Import batch not found");
    }
    if (batchResult.rows[0].enterprise_id !== input.enterpriseId || batchResult.rows[0].store_id !== input.storeId) {
      throw new ForbiddenError("Candidate tenant and store must match its import batch");
    }
    const result = await this.database.query<Row>(
      `INSERT INTO import_candidates (
        id, batch_id, enterprise_id, store_id, metric_key, metric_display_name, value, unit,
        range_start, range_end, source_locator, confidence, issue_code, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        randomUUID(), input.batchId, input.enterpriseId, input.storeId, input.metricKey,
        input.metricDisplayName, input.value, input.unit, input.rangeStart, input.rangeEnd,
        input.sourceLocator, input.confidence, input.issueCode ?? null, input.status
      ]
    );
    return toCandidate(result.rows[0]);
  }

  async getBatch(scope: FactVersionScope): Promise<ImportBatchDetails> {
    const batchResult = await this.database.query<Row>(
      "SELECT * FROM import_batches WHERE id = $1 AND enterprise_id = $2 AND store_id = $3",
      [scope.id, scope.enterpriseId, scope.storeId]
    );
    if (batchResult.rowCount !== 1) throw new NotFoundError("Import batch not found for enterprise and store");
    const candidates = await this.database.query<Row>(
      "SELECT * FROM import_candidates WHERE batch_id = $1 AND enterprise_id = $2 AND store_id = $3 ORDER BY created_at",
      [scope.id, scope.enterpriseId, scope.storeId]
    );
    return { ...toBatch(batchResult.rows[0]), candidates: candidates.rows.map(toCandidate) };
  }

  async updateCandidate(input: UpdateCandidateInput): Promise<ImportCandidate> {
    if (input.value !== undefined) assertSafeInteger(input.value, "Candidate value");
    const database = this.transactionDatabase ?? (isDatabase(this.database) ? this.database : undefined);
    if (!database) throw new Error("Transactions require a database connection");
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<Row>(
      `SELECT candidate.* FROM import_candidates candidate JOIN import_batches batch ON batch.id = candidate.batch_id
       WHERE candidate.id = $1 AND candidate.batch_id = $2 AND candidate.enterprise_id = $3 AND candidate.store_id = $4
       AND batch.enterprise_id = $3 AND batch.store_id = $4 AND batch.status = 'pending_confirmation' FOR UPDATE`,
      [input.id, input.batchId, input.enterpriseId, input.storeId]
      );
      if (current.rowCount !== 1) {
        const batch = await client.query<Row>("SELECT status FROM import_batches WHERE id = $1 AND enterprise_id = $2 AND store_id = $3", [input.batchId, input.enterpriseId, input.storeId]);
        if (batch.rowCount === 1 && batch.rows[0].status !== "pending_confirmation") throw new ConflictError("Candidates cannot be changed after confirmation");
        throw new NotFoundError("Import candidate not found for import batch");
      }
      const result = await client.query<Row>(
      `UPDATE import_candidates SET value = COALESCE($1, value), unit = COALESCE($2, unit),
       range_start = COALESCE($3, range_start), range_end = COALESCE($4, range_end), status = COALESCE($5, status),
       updated_at = CURRENT_TIMESTAMP WHERE id = $6 AND batch_id = $7 AND enterprise_id = $8 AND store_id = $9 RETURNING *`,
      [input.value ?? null, input.unit ?? null, input.rangeStart ?? null, input.rangeEnd ?? null, input.status ?? null,
        input.id, input.batchId, input.enterpriseId, input.storeId]
      );
      await client.query("COMMIT");
      return toCandidate(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async confirmBatch(input: ConfirmBatchInput): Promise<FactVersion> {
    if (input.candidateIds.length === 0) {
      throw new ValidationError("At least one candidate is required for confirmation");
    }

    const database = this.transactionDatabase ?? (isDatabase(this.database) ? this.database : undefined);
    if (!database) throw new Error("Transactions require a database connection");
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const candidateIdClause = placeholders(4, input.candidateIds.length);
      const batchResult = await client.query<Row>(
        `SELECT * FROM import_batches
         WHERE id = $1 AND enterprise_id = $2 AND store_id = $3 FOR UPDATE`,
        [input.batchId, input.enterpriseId, input.storeId]
      );
      if (batchResult.rowCount !== 1) {
        throw new NotFoundError("Import batch not found for enterprise and store");
      }
      if (batchResult.rows[0].status !== "pending_confirmation") {
        throw new ConflictError("Import batch is already confirmed");
      }

      const candidateResult = await client.query<Row>(
        `SELECT * FROM import_candidates
         WHERE batch_id = $1 AND enterprise_id = $2 AND store_id = $3 AND id IN (${candidateIdClause})
         ORDER BY created_at FOR UPDATE`,
        [input.batchId, input.enterpriseId, input.storeId, ...input.candidateIds]
      );
      if (candidateResult.rowCount !== input.candidateIds.length || candidateResult.rows.some((row) => row.status !== "ready")) {
        throw new ValidationError("Only ready candidates in the pending batch can be confirmed");
      }

      const confirmedAt = new Date();
      const versionId = randomUUID();
      const versionResult = await client.query<Row>(
        `INSERT INTO fact_versions (
          id, enterprise_id, store_id, source_batch_id, confirmation_actor_id, confirmation_status, confirmed_at
        ) VALUES ($1, $2, $3, $4, $5, 'confirmed', $6) RETURNING *`,
        [versionId, input.enterpriseId, input.storeId, input.batchId, input.actorId, confirmedAt]
      );

      const values: FactValue[] = [];
      for (const candidate of candidateResult.rows) {
        const valueResult = await client.query<Row>(
          `INSERT INTO fact_values (
            id, fact_version_id, enterprise_id, store_id, metric_key, value, unit,
            range_start, range_end, source_candidate_id, source_batch_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
          [
            randomUUID(), versionId, input.enterpriseId, input.storeId, candidate.metric_key,
            candidate.value, candidate.unit, candidate.range_start, candidate.range_end,
            candidate.id, input.batchId
          ]
        );
        values.push(toFactValue(valueResult.rows[0]));
      }

      await client.query(
        `UPDATE import_candidates SET status = 'confirmed', confirmed_value = value, updated_at = CURRENT_TIMESTAMP
         WHERE batch_id = $1 AND id IN (${placeholders(2, input.candidateIds.length)})`,
        [input.batchId, ...input.candidateIds]
      );
      await client.query(
        `UPDATE import_batches
         SET status = 'confirmed', confirmed_by_actor_id = $1, confirmed_at = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [input.actorId, confirmedAt, input.batchId]
      );
      await client.query("COMMIT");

      return { ...toFactVersion(versionResult.rows[0]), values };
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) {
        throw new ConflictError("Import batch is already confirmed");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async getFactVersion(scope: FactVersionScope): Promise<FactVersion> {
    const versionResult = await this.database.query<Row>(
      "SELECT * FROM fact_versions WHERE id = $1 AND enterprise_id = $2 AND store_id = $3",
      [scope.id, scope.enterpriseId, scope.storeId]
    );
    if (versionResult.rowCount !== 1) {
      throw new NotFoundError("Fact version not found for enterprise and store");
    }
    const valuesResult = await this.database.query<Row>(
      `SELECT * FROM fact_values
       WHERE fact_version_id = $1 AND enterprise_id = $2 AND store_id = $3
       ORDER BY created_at`,
      [scope.id, scope.enterpriseId, scope.storeId]
    );
    return { ...toFactVersion(versionResult.rows[0]), values: valuesResult.rows.map(toFactValue) };
  }

  async getLatestFactVersion(scope: Omit<FactVersionScope, "id">): Promise<FactVersion> {
    const result = await this.database.query<Row>(
      `SELECT id FROM fact_versions WHERE enterprise_id = $1 AND store_id = $2
       ORDER BY confirmed_at DESC, created_at DESC LIMIT 1`,
      [scope.enterpriseId, scope.storeId]
    );
    if (result.rowCount !== 1) throw new NotFoundError("No confirmed fact version for enterprise and store");
    return this.getFactVersion({ id: string(result.rows[0].id), ...scope });
  }
}

function toBatch(row: Row): ImportBatch {
  return {
    id: string(row.id), enterpriseId: string(row.enterprise_id), storeId: string(row.store_id),
    actorId: string(row.actor_id), sourceType: row.source_type as ImportSourceType,
    status: row.status as ImportBatchStatus, rangeStart: nullableDateOnly(row.range_start),
    rangeEnd: nullableDateOnly(row.range_end), confirmedByActorId: nullableString(row.confirmed_by_actor_id),
    confirmedAt: nullableDate(row.confirmed_at), createdAt: date(row.created_at), updatedAt: date(row.updated_at)
  };
}

function toCandidate(row: Row): ImportCandidate {
  return {
    id: string(row.id), batchId: string(row.batch_id), enterpriseId: string(row.enterprise_id),
    storeId: string(row.store_id), metricKey: string(row.metric_key), metricDisplayName: string(row.metric_display_name),
    value: number(row.value), unit: string(row.unit), rangeStart: dateOnly(row.range_start), rangeEnd: dateOnly(row.range_end),
    sourceLocator: string(row.source_locator), confidence: number(row.confidence), issueCode: nullableString(row.issue_code),
    status: row.status as CreateCandidateInput["status"], confirmedValue: nullableNumber(row.confirmed_value),
    createdAt: date(row.created_at), updatedAt: date(row.updated_at)
  };
}

function toImportFile(row: Row): ImportFileRecord {
  return {
    id: string(row.id), batchId: string(row.batch_id), enterpriseId: string(row.enterprise_id),
    storeId: string(row.store_id), originalFileName: string(row.original_file_name),
    normalizedMimeType: string(row.normalized_mime_type), byteCount: number(row.byte_count),
    sha256Checksum: string(row.sha256_checksum), objectKey: string(row.object_key),
    uploadedAt: date(row.uploaded_at), expiresAt: date(row.expires_at), cleanedAt: nullableDate(row.cleaned_at),
    cleanupAttemptedAt: nullableDate(row.cleanup_attempted_at),
    cleanupFailureCount: number(row.cleanup_failure_count)
  };
}

function toFactVersion(row: Row): Omit<FactVersion, "values"> {
  return {
    id: string(row.id), enterpriseId: string(row.enterprise_id), storeId: string(row.store_id),
    sourceBatchId: string(row.source_batch_id), confirmationActorId: string(row.confirmation_actor_id),
    confirmationStatus: "confirmed", confirmedAt: date(row.confirmed_at),
    createdAt: date(row.created_at), updatedAt: date(row.updated_at)
  };
}

function toFactValue(row: Row): FactValue {
  return {
    id: string(row.id), factVersionId: string(row.fact_version_id), enterpriseId: string(row.enterprise_id),
    storeId: string(row.store_id), metricKey: string(row.metric_key), value: number(row.value), unit: string(row.unit),
    rangeStart: dateOnly(row.range_start), rangeEnd: dateOnly(row.range_end), sourceCandidateId: string(row.source_candidate_id),
    sourceBatchId: string(row.source_batch_id), createdAt: date(row.created_at), updatedAt: date(row.updated_at)
  };
}

function string(value: unknown): string { return String(value); }
function number(value: unknown): number { return Number(value); }
function nullableString(value: unknown): string | null { return value == null ? null : string(value); }
function nullableNumber(value: unknown): number | null { return value == null ? null : number(value); }
function date(value: unknown): Date { return new Date(string(value)); }
function nullableDate(value: unknown): Date | null { return value == null ? null : date(value); }
function dateOnly(value: unknown): string {
  if (!(value instanceof Date)) return string(value);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function nullableDateOnly(value: unknown): string | null { return value == null ? null : dateOnly(value); }
function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError(`${name} must be a JSON safe integer`);
  }
}
function assertValidDate(value: Date, name: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ValidationError(`${name} must be a valid date`);
  }
}
function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "23505";
}
function isDatabase(value: Queryable): value is Database { return "connect" in value && typeof value.connect === "function"; }
function placeholders(start: number, count: number): string {
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(", ");
}
