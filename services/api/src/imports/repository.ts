import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../db.js";

export type ImportSourceType = "csv" | "xlsx" | "manual";
export type ImportBatchStatus = "pending_confirmation" | "confirmed";
export type CandidateStatus = "ready" | "needs_confirmation" | "confirmed" | "rejected";

export interface CreateBatchInput {
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

type Row = Record<string, unknown>;

export class ImportRepository {
  constructor(private readonly database: Database) {}

  async createBatch(input: CreateBatchInput): Promise<ImportBatch> {
    const result = await this.database.query<Row>(
      `INSERT INTO import_batches (
        id, enterprise_id, store_id, actor_id, source_type,
        original_file_key, original_file_name, original_file_mime_type,
        original_file_size_bytes, original_file_checksum, status, range_start, range_end
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending_confirmation', $11, $12)
      RETURNING *`,
      [
        randomUUID(), input.enterpriseId, input.storeId, input.actorId, input.sourceType,
        input.originalFileKey ?? null, input.originalFileName ?? null, input.originalFileMimeType ?? null,
        input.originalFileSizeBytes ?? null, input.originalFileChecksum ?? null,
        input.rangeStart ?? null, input.rangeEnd ?? null
      ]
    );
    return toBatch(result.rows[0]);
  }

  async createCandidate(input: CreateCandidateInput): Promise<ImportCandidate> {
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

  async confirmBatch(input: ConfirmBatchInput): Promise<FactVersion> {
    if (input.candidateIds.length === 0) {
      throw new Error("At least one candidate is required for confirmation");
    }

    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const candidateIdClause = placeholders(4, input.candidateIds.length);
      const batchResult = await client.query<Row>(
        `SELECT * FROM import_batches
         WHERE id = $1 AND enterprise_id = $2 AND store_id = $3 AND status = 'pending_confirmation'`,
        [input.batchId, input.enterpriseId, input.storeId]
      );
      if (batchResult.rowCount !== 1) {
        throw new Error("Pending import batch not found for enterprise and store");
      }

      const candidateResult = await client.query<Row>(
        `SELECT * FROM import_candidates
         WHERE batch_id = $1 AND enterprise_id = $2 AND store_id = $3 AND id IN (${candidateIdClause})
         ORDER BY created_at`,
        [input.batchId, input.enterpriseId, input.storeId, ...input.candidateIds]
      );
      if (candidateResult.rowCount !== input.candidateIds.length || candidateResult.rows.some((row) => row.status !== "ready")) {
        throw new Error("Only ready candidates in the pending batch can be confirmed");
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
      throw error;
    } finally {
      client.release();
    }
  }

  async getFactVersion(id: string): Promise<FactVersion> {
    const versionResult = await this.database.query<Row>("SELECT * FROM fact_versions WHERE id = $1", [id]);
    if (versionResult.rowCount !== 1) {
      throw new Error("Fact version not found");
    }
    const valuesResult = await this.database.query<Row>(
      "SELECT * FROM fact_values WHERE fact_version_id = $1 ORDER BY created_at",
      [id]
    );
    return { ...toFactVersion(versionResult.rows[0]), values: valuesResult.rows.map(toFactValue) };
  }
}

function toBatch(row: Row): ImportBatch {
  return {
    id: string(row.id), enterpriseId: string(row.enterprise_id), storeId: string(row.store_id),
    actorId: string(row.actor_id), sourceType: row.source_type as ImportSourceType,
    status: row.status as ImportBatchStatus, rangeStart: nullableString(row.range_start),
    rangeEnd: nullableString(row.range_end), confirmedByActorId: nullableString(row.confirmed_by_actor_id),
    confirmedAt: nullableDate(row.confirmed_at), createdAt: date(row.created_at), updatedAt: date(row.updated_at)
  };
}

function toCandidate(row: Row): ImportCandidate {
  return {
    id: string(row.id), batchId: string(row.batch_id), enterpriseId: string(row.enterprise_id),
    storeId: string(row.store_id), metricKey: string(row.metric_key), metricDisplayName: string(row.metric_display_name),
    value: number(row.value), unit: string(row.unit), rangeStart: string(row.range_start), rangeEnd: string(row.range_end),
    sourceLocator: string(row.source_locator), confidence: number(row.confidence), issueCode: nullableString(row.issue_code),
    status: row.status as CreateCandidateInput["status"], confirmedValue: nullableNumber(row.confirmed_value),
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
    rangeStart: string(row.range_start), rangeEnd: string(row.range_end), sourceCandidateId: string(row.source_candidate_id),
    sourceBatchId: string(row.source_batch_id), createdAt: date(row.created_at), updatedAt: date(row.updated_at)
  };
}

function string(value: unknown): string { return String(value); }
function number(value: unknown): number { return Number(value); }
function nullableString(value: unknown): string | null { return value == null ? null : string(value); }
function nullableNumber(value: unknown): number | null { return value == null ? null : number(value); }
function date(value: unknown): Date { return new Date(string(value)); }
function nullableDate(value: unknown): Date | null { return value == null ? null : date(value); }
function placeholders(start: number, count: number): string {
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(", ");
}
