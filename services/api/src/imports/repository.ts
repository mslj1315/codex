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
export const IMPORT_OBJECT_RECONCILIATION_RETRY_DELAY_MS = 60 * 60 * 1000;
export const IMPORT_BATCH_RECONCILIATION_GUARD_RETENTION_DAYS = 30;
export const IMPORT_BATCH_RECONCILIATION_GUARD_PRUNE_LIMIT = 100;
const RECONCILIATION_ERROR_TYPES = new Set(["StorageError", "DatabaseError", "NotFoundError", "UnknownError"]);
const RECONCILIATION_ERROR_CODES = new Set([
  "access_denied", "connection_refused", "not_found", "service_unavailable", "timeout", "unknown"
]);

export type ImportObjectReconciliationKind = "delete_orphan" | "verify_batch_then_delete";
export type ImportObjectReconciliationState = "pending" | "resolved";
export type ImportObjectReconciliationResolution = "object_removed" | "persistence_committed";

export interface CreateImportObjectReconciliationJob {
  id: string;
  enterpriseId: string;
  storeId: string;
  batchId: string;
  sha256Checksum: string;
  objectKey: string;
  kind: ImportObjectReconciliationKind;
  notBefore: Date;
}

export interface ImportObjectReconciliationJob extends CreateImportObjectReconciliationJob {
  state: ImportObjectReconciliationState;
  attemptedAt: Date | null;
  failureCount: number;
  resolvedAt: Date | null;
  resolution: ImportObjectReconciliationResolution | null;
  lastErrorType: string | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ImportMaintenanceStatus {
  pendingReconciliationJobs: number;
  eligibleReconciliationJobs: number;
  graceDeferredReconciliationJobs: number;
  retryDeferredReconciliationJobs: number;
  failedReconciliationJobs: number;
  oldestEligibleAt: Date | null;
  reconciliationGuardCount: number;
}

export interface DataReadinessScope {
  enterpriseId: string;
  storeId: string;
  rangeStart: string;
  rangeEnd: string;
}

export interface DataReadiness {
  rangeStart: string;
  rangeEnd: string;
  requiredMetrics: string[];
  presentMetrics: string[];
  missingMetrics: string[];
  confidence: "high" | "medium" | "low";
  comparisonAvailable: boolean;
}

export interface DeterministicDiagnostic {
  kind: "revenue_decline";
  rangeStart: string;
  rangeEnd: string;
  priorRangeStart: string;
  priorRangeEnd: string;
  fact: { metricKey: "revenue"; currentValue: number; priorValue: number; changePercent: number };
  evidence: string[];
  hypothesis: string;
  action: string;
  verificationMetric: string;
  confidence: "high" | "medium";
}

export type ActionCardStatus = "proposed" | "in_progress" | "completed" | "verified" | "cancelled";
export type ActionCardVerificationOutcome = "effective" | "ineffective" | "not_executed" | "data_insufficient";
export interface CreateActionCardInput {
  id?: string; enterpriseId: string; storeId: string; actorId: string; diagnosticKind: string;
  rangeStart: string; rangeEnd: string; title: string; action: string; verificationMetric: string; dueDate?: string;
}
export interface ActionCard extends Omit<CreateActionCardInput, "id" | "actorId"> {
  id: string; createdByActorId: string; status: ActionCardStatus; executionNote: string | null; verificationOutcome: ActionCardVerificationOutcome | null; completedAt: Date | null; verifiedAt: Date | null; createdAt: Date; updatedAt: Date;
}

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
    const batchInput = { ...input, id: input.id ?? randomUUID() };
    if (file && (
      file.batchId !== batchInput.id
      || file.enterpriseId !== batchInput.enterpriseId
      || file.storeId !== batchInput.storeId
    )) {
      throw new ValidationError("Import file scope must match its import batch");
    }
    const database = this.transactionDatabase ?? (isDatabase(this.database) ? this.database : undefined);
    if (!database) throw new Error("Transactions require a database connection");
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await acquireImportBatchReconciliationGuard(client, batchInput.id);
      const transaction = new ImportRepository(client);
      const batch = await transaction.createBatch(batchInput);
      if (file) await transaction.createImportFile(file);
      for (const candidate of candidates) await transaction.createCandidate({ ...candidate, batchId: batch.id, enterpriseId: batchInput.enterpriseId, storeId: batchInput.storeId });
      const details = await transaction.getBatch({ id: batch.id, enterpriseId: batchInput.enterpriseId, storeId: batchInput.storeId });
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

  async enqueueImportObjectReconciliationJob(
    input: CreateImportObjectReconciliationJob
  ): Promise<ImportObjectReconciliationJob> {
    assertValidDate(input.notBefore, "Reconciliation not-before time");
    try {
      const result = await this.database.query<Row>(
        `INSERT INTO import_object_reconciliation_jobs (
          id, enterprise_id, store_id, batch_id, sha256_checksum, object_key, kind, not_before
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          input.id, input.enterpriseId, input.storeId, input.batchId, input.sha256Checksum,
          input.objectKey, input.kind, input.notBefore
        ]
      );
      return toImportObjectReconciliationJob(result.rows[0]);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.database.query<Row>(
        "SELECT * FROM import_object_reconciliation_jobs WHERE object_key = $1",
        [input.objectKey]
      );
      if (existing.rowCount === 1) return toImportObjectReconciliationJob(existing.rows[0]);
      throw error;
    }
  }

  async listEligibleImportObjectReconciliationJobs(
    now: Date,
    limit = 100
  ): Promise<ImportObjectReconciliationJob[]> {
    assertValidDate(now, "Reconciliation time");
    assertQueueLimit(limit, "Reconciliation limit");
    const retryCutoff = new Date(now.getTime() - IMPORT_OBJECT_RECONCILIATION_RETRY_DELAY_MS);
    const result = await this.database.query<Row>(
      `SELECT * FROM import_object_reconciliation_jobs
       WHERE state = 'pending' AND not_before <= $1
       AND (attempted_at IS NULL OR attempted_at <= $2)
       ORDER BY CASE WHEN attempted_at IS NULL THEN 0 ELSE 1 END,
         attempted_at, not_before, created_at, id
       LIMIT $3`,
      [now, retryCutoff, limit]
    );
    return result.rows.map(toImportObjectReconciliationJob);
  }

  async countDeferredImportObjectReconciliationJobs(now: Date): Promise<number> {
    assertValidDate(now, "Reconciliation time");
    const result = await this.database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM import_object_reconciliation_jobs
       WHERE state = 'pending' AND kind = 'verify_batch_then_delete' AND not_before > $1`,
      [now]
    );
    return Number(result.rows[0].count);
  }

  async getImportMaintenanceStatus(now: Date): Promise<ImportMaintenanceStatus> {
    assertValidDate(now, "Maintenance status time");
    const database = this.transactionDatabase ?? (isDatabase(this.database) ? this.database : undefined);
    if (!database) throw new Error("Maintenance status requires a database connection");
    const retryCutoff = new Date(now.getTime() - IMPORT_OBJECT_RECONCILIATION_RETRY_DELAY_MS);
    const client = await database.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const jobs = await client.query<{
        pending_reconciliation_jobs: string;
        eligible_reconciliation_jobs: string;
        grace_deferred_reconciliation_jobs: string;
        retry_deferred_reconciliation_jobs: string;
        failed_reconciliation_jobs: string;
        oldest_eligible_at: Date | null;
      }>(
        `SELECT
           SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END)::text AS pending_reconciliation_jobs,
           SUM(CASE WHEN state = 'pending' AND not_before <= $1
                     AND (attempted_at IS NULL OR attempted_at <= $2) THEN 1 ELSE 0 END)::text
             AS eligible_reconciliation_jobs,
           SUM(CASE WHEN state = 'pending' AND kind = 'verify_batch_then_delete' AND not_before > $1 THEN 1 ELSE 0 END)::text
             AS grace_deferred_reconciliation_jobs,
           SUM(CASE WHEN state = 'pending' AND not_before <= $1 AND attempted_at > $2 THEN 1 ELSE 0 END)::text
             AS retry_deferred_reconciliation_jobs,
           SUM(CASE WHEN state = 'pending' AND failure_count > 0 THEN 1 ELSE 0 END)::text
             AS failed_reconciliation_jobs,
           MIN(CASE WHEN state = 'pending' AND not_before <= $1
                     AND (attempted_at IS NULL OR attempted_at <= $2) THEN created_at END) AS oldest_eligible_at
         FROM import_object_reconciliation_jobs`,
        [now, retryCutoff]
      );
      const guards = await client.query<{ reconciliation_guard_count: string }>(
        "SELECT COUNT(*)::text AS reconciliation_guard_count FROM import_batch_reconciliation_guards"
      );
      await client.query("COMMIT");
      const row = jobs.rows[0];
      return {
        pendingReconciliationJobs: Number(row.pending_reconciliation_jobs),
        eligibleReconciliationJobs: Number(row.eligible_reconciliation_jobs),
        graceDeferredReconciliationJobs: Number(row.grace_deferred_reconciliation_jobs),
        retryDeferredReconciliationJobs: Number(row.retry_deferred_reconciliation_jobs),
        failedReconciliationJobs: Number(row.failed_reconciliation_jobs),
        oldestEligibleAt: nullableDate(row.oldest_eligible_at),
        reconciliationGuardCount: Number(guards.rows[0].reconciliation_guard_count)
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async pruneImportBatchReconciliationGuards(
    now: Date,
    limit = IMPORT_BATCH_RECONCILIATION_GUARD_PRUNE_LIMIT
  ): Promise<number> {
    assertValidDate(now, "Guard prune time");
    if (!Number.isInteger(limit) || limit < 1 || limit > IMPORT_BATCH_RECONCILIATION_GUARD_PRUNE_LIMIT) {
      throw new ValidationError(`Guard prune limit must be an integer between 1 and ${IMPORT_BATCH_RECONCILIATION_GUARD_PRUNE_LIMIT}`);
    }
    const cutoff = new Date(now.getTime() - IMPORT_BATCH_RECONCILIATION_GUARD_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const database = this.transactionDatabase ?? (isDatabase(this.database) ? this.database : undefined);
    if (!database) throw new Error("Guard pruning requires a database connection");
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const candidates = await client.query<{ batch_id: string }>(
      `SELECT batch_id
       FROM import_batch_reconciliation_guards
       WHERE batch_id NOT IN (
         SELECT batch_id FROM import_object_reconciliation_jobs WHERE state = 'pending'
       )
       AND batch_id NOT IN (
         SELECT id FROM import_batches WHERE updated_at > $1
       )
       ORDER BY created_at, batch_id
       LIMIT $2`,
      [cutoff, limit]
      );
      let pruned = 0;
      for (const candidate of candidates.rows) {
        const guard = await client.query("SELECT batch_id FROM import_batch_reconciliation_guards WHERE batch_id = $1 FOR UPDATE", [candidate.batch_id]);
        if (guard.rowCount !== 1) continue;
        const pending = await client.query("SELECT 1 FROM import_object_reconciliation_jobs WHERE batch_id = $1 AND state = 'pending' LIMIT 1", [candidate.batch_id]);
        if (pending.rowCount === 1) continue;
        const batch = await client.query("SELECT updated_at FROM import_batches WHERE id = $1", [candidate.batch_id]);
        if (batch.rowCount === 1 && batch.rows[0].updated_at > cutoff) continue;
        const result = await client.query("DELETE FROM import_batch_reconciliation_guards WHERE batch_id = $1", [candidate.batch_id]);
        pruned += result.rowCount ?? 0;
      }
      await client.query("COMMIT");
      return pruned;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async withImportBatchReconciliationGuard<T>(
    batchId: string,
    work: (guarded: ImportRepository) => Promise<T>
  ): Promise<T> {
    const database = this.transactionDatabase ?? (isDatabase(this.database) ? this.database : undefined);
    if (!database) throw new Error("Transactions require a database connection");
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await acquireImportBatchReconciliationGuard(client, batchId);
      const result = await work(new ImportRepository(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async resolveImportObjectReconciliationJob(
    id: string,
    resolvedAt: Date,
    resolution: ImportObjectReconciliationResolution
  ): Promise<boolean> {
    assertValidDate(resolvedAt, "Reconciliation resolution time");
    assertResolution(resolution);
    const result = await this.database.query(
      `UPDATE import_object_reconciliation_jobs
       SET state = 'resolved', resolved_at = $1, resolution = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND state = 'pending'`,
      [resolvedAt, resolution, id]
    );
    return result.rowCount === 1;
  }

  async recordImportObjectReconciliationFailure(
    id: string,
    attemptedAt: Date,
    errorType: string | null,
    errorCode: string | null
  ): Promise<boolean> {
    assertValidDate(attemptedAt, "Reconciliation attempt time");
    const normalizedErrorType = normalizeReconciliationErrorType(errorType);
    const normalizedErrorCode = normalizeReconciliationErrorCode(errorCode);
    const result = await this.database.query(
      `UPDATE import_object_reconciliation_jobs
       SET attempted_at = $1, failure_count = failure_count + 1,
         last_error_type = $2, last_error_code = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND state = 'pending'`,
      [attemptedAt, normalizedErrorType, normalizedErrorCode, id]
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

  async getDataReadiness(scope: DataReadinessScope): Promise<DataReadiness> {
    assertDateOnlyRange(scope.rangeStart, scope.rangeEnd);
    const requiredMetrics = ["revenue", "orders", "average_spend"];
    const presentResult = await this.database.query<Row>(
      `SELECT DISTINCT metric_key FROM fact_values
       WHERE enterprise_id = $1 AND store_id = $2
         AND range_start = $3 AND range_end = $4
         AND metric_key = ANY($5::text[])
       ORDER BY metric_key`,
      [scope.enterpriseId, scope.storeId, scope.rangeStart, scope.rangeEnd, requiredMetrics]
    );
    const presentMetrics = presentResult.rows.map((row) => string(row.metric_key));
    const missingMetrics = requiredMetrics.filter((metric) => !presentMetrics.includes(metric));
    const comparison = await this.database.query<Row>(
      `SELECT 1 FROM fact_values
       WHERE enterprise_id = $1 AND store_id = $2 AND range_end < $3
       LIMIT 1`,
      [scope.enterpriseId, scope.storeId, scope.rangeStart]
    );
    const comparisonAvailable = (comparison.rowCount ?? 0) > 0;
    const confidence = missingMetrics.length === 0 && comparisonAvailable
      ? "high"
      : presentMetrics.length > 0
        ? "medium"
        : "low";
    return { rangeStart: scope.rangeStart, rangeEnd: scope.rangeEnd, requiredMetrics, presentMetrics, missingMetrics, confidence, comparisonAvailable };
  }

  async getDeterministicDiagnostic(scope: DataReadinessScope): Promise<DeterministicDiagnostic | null> {
    assertDateOnlyRange(scope.rangeStart, scope.rangeEnd);
    const start = new Date(`${scope.rangeStart}T00:00:00Z`);
    const end = new Date(`${scope.rangeEnd}T00:00:00Z`);
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    const priorEnd = new Date(start.getTime() - 86400000);
    const priorStart = new Date(priorEnd.getTime() - (days - 1) * 86400000);
    const priorRangeStart = priorStart.toISOString().slice(0, 10);
    const priorRangeEnd = priorEnd.toISOString().slice(0, 10);
    const readRevenue = async (rangeStart: string, rangeEnd: string) => this.database.query<Row>(
      `SELECT value FROM fact_values
       WHERE enterprise_id = $1 AND store_id = $2 AND metric_key = 'revenue'
         AND range_start = $3 AND range_end = $4 LIMIT 1`,
      [scope.enterpriseId, scope.storeId, rangeStart, rangeEnd]
    );
    const currentResult = await readRevenue(scope.rangeStart, scope.rangeEnd);
    const priorResult = await readRevenue(priorRangeStart, priorRangeEnd);
    const current = currentResult.rows[0];
    const prior = priorResult.rows[0];
    if (!current || !prior || Number(prior.value) <= 0) return null;
    const changePercent = Math.round(((Number(current.value) - Number(prior.value)) / Number(prior.value)) * 10000) / 100;
    if (changePercent > -10) return null;
    return {
      kind: "revenue_decline", rangeStart: scope.rangeStart, rangeEnd: scope.rangeEnd, priorRangeStart, priorRangeEnd,
      fact: { metricKey: "revenue", currentValue: Number(current.value), priorValue: Number(prior.value), changePercent },
      evidence: [`revenue:${scope.rangeStart}/${scope.rangeEnd}`, `revenue:${priorRangeStart}/${priorRangeEnd}`],
      hypothesis: "营业额较上一周期明显下降，需要结合订单数与客单价进一步核查。",
      action: "检查本周期订单量、客单价和重点套餐表现，选择一个可执行的门店或内容动作。",
      verificationMetric: "下一周期营业额与订单数",
      confidence: "high"
    };
  }

  async createActionCard(input: CreateActionCardInput): Promise<ActionCard> {
    if (!input.title.trim() || !input.action.trim() || !input.verificationMetric.trim()) throw new ValidationError("Action card fields are required");
    assertDateOnlyRange(input.rangeStart, input.rangeEnd);
    if (input.dueDate !== undefined) assertDateOnlyRange(input.dueDate, input.dueDate);
    const result = await this.database.query<Row>(
      `INSERT INTO action_cards (id, enterprise_id, store_id, created_by_actor_id, diagnostic_kind, range_start, range_end, title, action, verification_metric, status, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'proposed', $11) RETURNING *`,
      [input.id ?? randomUUID(), input.enterpriseId, input.storeId, input.actorId, input.diagnosticKind, input.rangeStart, input.rangeEnd, input.title, input.action, input.verificationMetric, input.dueDate ?? null]
    );
    return toActionCard(result.rows[0]);
  }

  async getActionCard(scope: { id: string; enterpriseId: string; storeId: string }): Promise<ActionCard> {
    const result = await this.database.query<Row>("SELECT * FROM action_cards WHERE id = $1 AND enterprise_id = $2 AND store_id = $3", [scope.id, scope.enterpriseId, scope.storeId]);
    if (result.rowCount !== 1) throw new NotFoundError("Action card not found for enterprise and store");
    return toActionCard(result.rows[0]);
  }

  async listActionCards(scope: { enterpriseId: string; storeId: string; status?: ActionCardStatus }): Promise<ActionCard[]> {
    if (scope.status !== undefined && !["proposed", "in_progress", "completed", "verified", "cancelled"].includes(scope.status)) throw new ValidationError("Action card status is invalid");
    const result = await this.database.query<Row>(
      `SELECT * FROM action_cards WHERE enterprise_id = $1 AND store_id = $2
       ${scope.status === undefined ? "" : "AND status = $3"} ORDER BY created_at DESC, id DESC LIMIT 100`,
      scope.status === undefined ? [scope.enterpriseId, scope.storeId] : [scope.enterpriseId, scope.storeId, scope.status]
    );
    return result.rows.map(toActionCard);
  }

  async updateActionCardStatus(input: { id: string; enterpriseId: string; storeId: string; status: ActionCardStatus; now: Date; executionNote?: string; verificationOutcome?: ActionCardVerificationOutcome }): Promise<ActionCard> {
    assertValidDate(input.now, "now");
    const allowed: Record<ActionCardStatus, ActionCardStatus[]> = {
      proposed: ["in_progress", "cancelled"], in_progress: ["completed", "cancelled"], completed: ["verified"], verified: [], cancelled: []
    };
    const current = await this.database.query<Row>("SELECT * FROM action_cards WHERE id = $1 AND enterprise_id = $2 AND store_id = $3", [input.id, input.enterpriseId, input.storeId]);
    if (current.rowCount !== 1) throw new ValidationError("Action card is outside trusted store context");
    const currentStatus = current.rows[0].status as ActionCardStatus;
    if (!allowed[currentStatus].includes(input.status)) throw new ConflictError("Action card status transition is invalid");
    if (input.executionNote !== undefined && (input.status !== "completed" || !validActionNote(input.executionNote))) throw new ValidationError("Action card execution note is invalid");
    if (input.verificationOutcome !== undefined && (input.status !== "verified" || !["effective", "ineffective", "not_executed", "data_insufficient"].includes(input.verificationOutcome))) throw new ValidationError("Action card verification outcome is invalid");
    const result = await this.database.query<Row>(
      `UPDATE action_cards SET status = $1,
         completed_at = CASE WHEN $1 = 'completed' THEN $2 ELSE completed_at END,
         verified_at = CASE WHEN $1 = 'verified' THEN $2 ELSE verified_at END,
         execution_note = CASE WHEN $1 = 'completed' THEN COALESCE($3, execution_note) ELSE execution_note END,
         verification_outcome = CASE WHEN $1 = 'verified' THEN COALESCE($4, verification_outcome) ELSE verification_outcome END,
         updated_at = $2 WHERE id = $5 AND enterprise_id = $6 AND store_id = $7 RETURNING *`,
      [input.status, input.now, input.executionNote ?? null, input.verificationOutcome ?? null, input.id, input.enterpriseId, input.storeId]
    );
    return toActionCard(result.rows[0]);
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

function toImportObjectReconciliationJob(row: Row): ImportObjectReconciliationJob {
  return {
    id: string(row.id), enterpriseId: string(row.enterprise_id), storeId: string(row.store_id),
    batchId: string(row.batch_id), sha256Checksum: string(row.sha256_checksum), objectKey: string(row.object_key),
    kind: row.kind as ImportObjectReconciliationKind,
    state: row.state as ImportObjectReconciliationState,
    notBefore: date(row.not_before), attemptedAt: nullableDate(row.attempted_at),
    failureCount: number(row.failure_count), resolvedAt: nullableDate(row.resolved_at),
    resolution: row.resolution as ImportObjectReconciliationResolution | null,
    lastErrorType: nullableString(row.last_error_type), lastErrorCode: nullableString(row.last_error_code),
    createdAt: date(row.created_at), updatedAt: date(row.updated_at)
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

function toActionCard(row: Row): ActionCard {
  return {
    id: string(row.id), enterpriseId: string(row.enterprise_id), storeId: string(row.store_id), createdByActorId: string(row.created_by_actor_id),
    diagnosticKind: string(row.diagnostic_kind), rangeStart: dateOnly(row.range_start), rangeEnd: dateOnly(row.range_end), title: string(row.title),
    action: string(row.action), verificationMetric: string(row.verification_metric), dueDate: row.due_date == null ? undefined : dateOnly(row.due_date),
    status: row.status as ActionCardStatus, executionNote: nullableString(row.execution_note), verificationOutcome: nullableString(row.verification_outcome) as ActionCardVerificationOutcome | null, completedAt: nullableDate(row.completed_at), verifiedAt: nullableDate(row.verified_at), createdAt: date(row.created_at), updatedAt: date(row.updated_at)
  };
}
function nullableDateOnly(value: unknown): string | null { return value == null ? null : dateOnly(value); }
function assertDateOnlyRange(start: string, end: string): void {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (!pattern.test(start) || !pattern.test(end) || start > end
    || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())
    || startDate.toISOString().slice(0, 10) !== start || endDate.toISOString().slice(0, 10) !== end) {
    throw new ValidationError("Invalid date range");
  }
}
function validActionNote(value: string): boolean { return value.trim().length > 0 && value.length <= 500 && !/[\u0000-\u001F\u007F]/.test(value); }
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
function assertQueueLimit(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new ValidationError(`${name} must be an integer between 1 and 1000`);
  }
}
function assertResolution(value: string): asserts value is ImportObjectReconciliationResolution {
  if (value !== "object_removed" && value !== "persistence_committed") {
    throw new ValidationError("Reconciliation resolution is invalid");
  }
}

async function acquireImportBatchReconciliationGuard(database: Queryable, batchId: string): Promise<void> {
  await database.query(
    "INSERT INTO import_batch_reconciliation_guards (batch_id) VALUES ($1) ON CONFLICT (batch_id) DO NOTHING",
    [batchId]
  );
  await database.query(
    "SELECT batch_id FROM import_batch_reconciliation_guards WHERE batch_id = $1 FOR UPDATE",
    [batchId]
  );
}
function normalizeReconciliationErrorType(value: string | null): string | null {
  return value !== null && RECONCILIATION_ERROR_TYPES.has(value) ? value : null;
}
function normalizeReconciliationErrorCode(value: string | null): string | null {
  return value !== null && RECONCILIATION_ERROR_CODES.has(value) ? value : null;
}
function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "23505";
}
function isDatabase(value: Queryable): value is Database { return "connect" in value && typeof value.connect === "function"; }
function placeholders(start: number, count: number): string {
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(", ");
}
