import { readdir, readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ConflictError,
  DuplicateImportFileError,
  ForbiddenError,
  ImportRepository,
  NotFoundError,
  ValidationError
} from "../src/imports/repository.js";
import type { Database, Queryable } from "../src/db.js";

describe("import repository", () => {
  let imports: ImportRepository;
  let database: Database;
  let migration: string;

  beforeEach(async () => {
    const memory = newDb();
    memory.public.registerFunction({
      name: "length",
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (value: string) => value.length
    });
    const { Pool } = memory.adapters.createPg();
    const pool = new Pool();
    migration = await applyTestMigrations(pool);
    database = pool;
    imports = new ImportRepository(pool);
  });

  it("creates a store-scoped pending batch", async () => {
    const batch = await imports.createBatch({
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      actorId: "actor_demo",
      sourceType: "manual"
    });

    expect(batch.status).toBe("pending_confirmation");
    expect(batch.storeId).toBe("store_demo");
  });

  it("rejects a candidate whose enterprise or store differs from its batch", async () => {
    const batch = await imports.createBatch({
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      actorId: "actor_demo",
      sourceType: "manual"
    });

    await expect(imports.createCandidate({
      batchId: batch.id,
      enterpriseId: "ent_demo",
      storeId: "store_other",
      metricKey: "revenue",
      metricDisplayName: "Revenue",
      value: 4826000,
      unit: "cents",
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-07",
      sourceLocator: "manual:revenue",
      confidence: 100,
      status: "ready"
    })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a candidate value outside the JSON safe-integer range", async () => {
    const batch = await imports.createBatch({
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      actorId: "actor_demo",
      sourceType: "manual"
    });

    await expect(imports.createCandidate({
      batchId: batch.id,
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      metricKey: "revenue",
      metricDisplayName: "Revenue",
      value: Number.MAX_SAFE_INTEGER + 1,
      unit: "cents",
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-07",
      sourceLocator: "manual:revenue",
      confidence: 100,
      status: "ready"
    })).rejects.toBeInstanceOf(ValidationError);

    await expect(imports.createCandidate({
      batchId: batch.id,
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      metricKey: "revenue",
      metricDisplayName: "Revenue",
      value: 1.5,
      unit: "cents",
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-07",
      sourceLocator: "manual:revenue",
      confidence: 100,
      status: "ready"
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it("declares one fact version per source batch and append-only fact triggers", () => {
    expect(migration).toContain("UNIQUE (source_batch_id)");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION reject_fact_mutation()");
    expect(migration).toContain("RAISE EXCEPTION 'fact records are append-only'");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON fact_versions");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON fact_values");
  });

  it("declares the versioned metric catalog schema", () => {
    expect(migration).toContain("CREATE TABLE metric_catalog_versions");
    expect(migration).toContain("state IN ('draft', 'published', 'retired')");
    expect(migration).toContain("metric_catalog_one_published_idx");
    expect(migration).toContain("UNIQUE (metric_catalog_version_id, metric_key)");
    expect(migration).toContain("metric_catalog_version_id TEXT NOT NULL");
  });

  it("normalizes PostgreSQL DATE values in batch responses", async () => {
    const dateReturningDatabase = {
      query: async () => ({
        command: "INSERT", rowCount: 1, oid: 0, fields: [],
        rows: [{
          id: "batch_real_date", enterprise_id: "ent_demo", store_id: "store_demo",
          actor_id: "actor_demo", source_type: "csv", status: "pending_confirmation",
          range_start: postgresDateAtLocalMidnight(2026, 8, 1, "2026-07-31T16:00:00.000Z"),
          range_end: postgresDateAtLocalMidnight(2026, 8, 7, "2026-08-06T16:00:00.000Z"),
          confirmed_by_actor_id: null, confirmed_at: null,
          created_at: new Date("2026-08-11T08:00:00.000Z"),
          updated_at: new Date("2026-08-11T08:00:00.000Z")
        }]
      })
    } as unknown as Queryable;

    const batch = await new ImportRepository(dateReturningDatabase).createBatch({
      id: "batch_real_date", enterpriseId: "ent_demo", storeId: "store_demo",
      actorId: "actor_demo", sourceType: "csv", rangeStart: "2026-08-01", rangeEnd: "2026-08-07"
    });

    expect(batch).toMatchObject({ rangeStart: "2026-08-01", rangeEnd: "2026-08-07" });
  });

  it("normalizes PostgreSQL DATE values in candidate responses", async () => {
    let queryCount = 0;
    const dateReturningDatabase = {
      query: async () => {
        queryCount += 1;
        return queryCount === 1
          ? {
              command: "SELECT", rowCount: 1, oid: 0, fields: [],
              rows: [{ enterprise_id: "ent_demo", store_id: "store_demo" }]
            }
          : {
              command: "INSERT", rowCount: 1, oid: 0, fields: [],
              rows: [{
                id: "candidate_real_date", batch_id: "batch_real_date",
                enterprise_id: "ent_demo", store_id: "store_demo", metric_key: "orders",
                metric_display_name: "Orders", value: 12, unit: "count",
                range_start: postgresDateAtLocalMidnight(2026, 8, 1, "2026-07-31T16:00:00.000Z"),
                range_end: postgresDateAtLocalMidnight(2026, 8, 7, "2026-08-06T16:00:00.000Z"),
                source_locator: "A2", confidence: 0.98, issue_code: null, status: "ready",
                confirmed_value: null, created_at: new Date("2026-08-11T08:00:00.000Z"),
                updated_at: new Date("2026-08-11T08:00:00.000Z")
              }]
            };
      }
    } as unknown as Queryable;

    const candidate = await new ImportRepository(dateReturningDatabase).createCandidate({
      batchId: "batch_real_date", enterpriseId: "ent_demo", storeId: "store_demo",
      metricKey: "orders", metricDisplayName: "Orders", value: 12, unit: "count",
      rangeStart: "2026-08-01", rangeEnd: "2026-08-07", sourceLocator: "A2",
      confidence: 0.98, status: "ready"
    });

    expect(candidate).toMatchObject({ rangeStart: "2026-08-01", rangeEnd: "2026-08-07" });
  });

  it("normalizes PostgreSQL DATE values in fact responses", async () => {
    let queryCount = 0;
    const dateReturningDatabase = {
      query: async () => {
        queryCount += 1;
        return queryCount === 1
          ? {
              command: "SELECT", rowCount: 1, oid: 0, fields: [],
              rows: [{
                id: "fact_real_date", enterprise_id: "ent_demo", store_id: "store_demo",
                source_batch_id: "batch_real_date", confirmation_actor_id: "actor_demo",
                confirmation_status: "confirmed", confirmed_at: new Date("2026-08-11T08:00:00.000Z"),
                created_at: new Date("2026-08-11T08:00:00.000Z"),
                updated_at: new Date("2026-08-11T08:00:00.000Z")
              }]
            }
          : {
              command: "SELECT", rowCount: 1, oid: 0, fields: [],
              rows: [{
                id: "value_real_date", fact_version_id: "fact_real_date",
                enterprise_id: "ent_demo", store_id: "store_demo", metric_key: "orders",
                value: 12, unit: "count",
                range_start: postgresDateAtLocalMidnight(2026, 8, 1, "2026-07-31T16:00:00.000Z"),
                range_end: postgresDateAtLocalMidnight(2026, 8, 7, "2026-08-06T16:00:00.000Z"),
                source_candidate_id: "candidate_real_date", source_batch_id: "batch_real_date",
                created_at: new Date("2026-08-11T08:00:00.000Z"),
                updated_at: new Date("2026-08-11T08:00:00.000Z")
              }]
            };
      }
    } as unknown as Queryable;

    const fact = await new ImportRepository(dateReturningDatabase).getFactVersion({
      id: "fact_real_date", enterpriseId: "ent_demo", storeId: "store_demo"
    });

    expect(fact.values).toEqual([
      expect.objectContaining({ rangeStart: "2026-08-01", rangeEnd: "2026-08-07" })
    ]);
  });

  it("declares store-scoped import file identity and lifecycle timestamps", () => {
    expect(migration).toContain("UNIQUE (batch_id)");
    expect(migration).toContain("UNIQUE (enterprise_id, store_id, sha256_checksum)");
    expect(migration).toContain("expires_at TIMESTAMPTZ NOT NULL");
    expect(migration).toContain("cleaned_at TIMESTAMPTZ");
    expect(migration).toContain("cleanup_attempted_at TIMESTAMPTZ");
    expect(migration).toContain("cleanup_failure_count INTEGER NOT NULL DEFAULT 0");
    expect(migration).toContain("CHECK (cleanup_failure_count >= 0)");
    expect(migration).toContain("import_files_cleanup_queue_idx");
  });

  it("declares a durable pending reconciliation queue keyed by object", () => {
    expect(migration).toContain("CREATE TABLE import_object_reconciliation_jobs");
    expect(migration).toContain("object_key TEXT NOT NULL UNIQUE");
    expect(migration).toContain("kind IN ('delete_orphan', 'verify_batch_then_delete')");
    expect(migration).toContain("state IN ('pending', 'resolved')");
    expect(migration).toContain("not_before TIMESTAMPTZ NOT NULL");
    expect(migration).toContain("failure_count INTEGER NOT NULL DEFAULT 0");
    expect(migration).toContain("import_object_reconciliation_queue_idx");
    expect(migration).toContain("WHERE state = 'pending'");
  });

  it("declares a narrow batch guard shared by persistence and reconciliation", () => {
    expect(migration).toContain("CREATE TABLE import_batch_reconciliation_guards");
    expect(migration).toContain("batch_id TEXT PRIMARY KEY");
  });

  it("keeps diagnostic evidence immutable, scoped, and uniquely snapshotted", async () => {
    await database.query(`INSERT INTO diagnostic_runs
      (id, enterprise_id, store_id, kind, range_start, range_end, prior_range_start, prior_range_end, rule_version, confidence, snapshot_key)
      VALUES ('diagnostic_run_one', 'ent_demo', 'store_demo', 'revenue_decline', '2026-08-01', '2026-08-07', '2026-07-25', '2026-07-31', 'revenue_decline_v1', 'high', 'same-snapshot')`);

    await expect(database.query(`INSERT INTO diagnostic_runs
      (id, enterprise_id, store_id, kind, range_start, range_end, prior_range_start, prior_range_end, rule_version, confidence, snapshot_key)
      VALUES ('diagnostic_run_duplicate', 'ent_demo', 'store_demo', 'revenue_decline', '2026-08-01', '2026-08-07', '2026-07-25', '2026-07-31', 'revenue_decline_v1', 'high', 'same-snapshot')`)).rejects.toThrow();

    await database.query(`INSERT INTO diagnostic_evidence
      (id, diagnostic_run_id, enterprise_id, store_id, metric_key, current_value, prior_value, change_percent, current_fact_version_id, prior_fact_version_id)
      VALUES ('diagnostic_evidence_one', 'diagnostic_run_one', 'ent_demo', 'store_demo', 'revenue', 3826000, 4400000, -13.05, 'fact_current', 'fact_prior')`);
    await database.query("DELETE FROM diagnostic_runs WHERE id = 'diagnostic_run_one'");
    await expect(database.query("SELECT id FROM diagnostic_evidence WHERE id = 'diagnostic_evidence_one'"))
      .resolves.toMatchObject({ rowCount: 0 });

    await expect(database.query(`INSERT INTO action_cards
      (id, enterprise_id, store_id, created_by_actor_id, diagnostic_kind, range_start, range_end, title, action, verification_metric, status, diagnostic_run_id)
      VALUES ('action_cross_scope', 'ent_demo', 'store_other', 'actor_demo', 'revenue_decline', '2026-08-01', '2026-08-07', 'Review', 'Review', 'revenue', 'proposed', 'diagnostic_run_one')`)).rejects.toThrow();
    await expect(database.query(`INSERT INTO action_cards
      (id, enterprise_id, store_id, created_by_actor_id, diagnostic_kind, range_start, range_end, title, action, verification_metric, status, diagnostic_run_id)
      VALUES ('action_manual', 'ent_demo', 'store_other', 'actor_demo', 'manual', '2026-08-01', '2026-08-07', 'Review', 'Review', 'revenue', 'proposed', NULL)`)).resolves.toMatchObject({ rowCount: 1 });
  });

  it("enqueues one reconciliation job per object key", async () => {
    const input = reconciliationJobInput({ id: "reconciliation_first" });

    const first = await imports.enqueueImportObjectReconciliationJob(input);
    const duplicate = await imports.enqueueImportObjectReconciliationJob({
      ...input,
      id: "reconciliation_duplicate",
      kind: "verify_batch_then_delete"
    });

    expect(first).toMatchObject({
      id: "reconciliation_first",
      objectKey: input.objectKey,
      kind: "delete_orphan",
      state: "pending",
      attemptedAt: null,
      failureCount: 0,
      resolvedAt: null,
      resolution: null,
      lastErrorType: null,
      lastErrorCode: null
    });
    expect(duplicate).toEqual(first);
    await expect(database.query("SELECT id FROM import_object_reconciliation_jobs"))
      .resolves.toMatchObject({ rowCount: 1, rows: [{ id: "reconciliation_first" }] });
  });

  it("lists eligible reconciliation jobs with fresh work before one-hour retries", async () => {
    const now = new Date("2026-08-12T12:00:00.000Z");
    const fresh = await imports.enqueueImportObjectReconciliationJob(reconciliationJobInput({
      id: "reconciliation_fresh", objectKey: "imports/reconciliation/fresh", notBefore: now
    }));
    const oldRetry = await imports.enqueueImportObjectReconciliationJob(reconciliationJobInput({
      id: "reconciliation_old_retry", objectKey: "imports/reconciliation/old-retry", notBefore: now
    }));
    const recentRetry = await imports.enqueueImportObjectReconciliationJob(reconciliationJobInput({
      id: "reconciliation_recent_retry", objectKey: "imports/reconciliation/recent-retry", notBefore: now
    }));
    await imports.recordImportObjectReconciliationFailure(oldRetry.id, new Date("2026-08-12T10:59:59.000Z"), "StorageError", "timeout");
    await imports.recordImportObjectReconciliationFailure(recentRetry.id, new Date("2026-08-12T11:00:01.000Z"), "StorageError", "timeout");

    await expect(imports.listEligibleImportObjectReconciliationJobs(now)).resolves.toMatchObject([
      { id: fresh.id },
      { id: oldRetry.id }
    ]);
  });

  it("resolves pending reconciliation jobs once and retains bounded failure diagnostics", async () => {
    const now = new Date("2026-08-12T12:00:00.000Z");
    const job = await imports.enqueueImportObjectReconciliationJob(reconciliationJobInput({
      id: "reconciliation_resolution", objectKey: "imports/reconciliation/resolution", notBefore: now
    }));

    await expect(imports.recordImportObjectReconciliationFailure(
      job.id, now, "StorageError", "access_denied"
    )).resolves.toBe(true);
    await expect(imports.resolveImportObjectReconciliationJob(
      job.id, now, "object_removed"
    )).resolves.toBe(true);
    await expect(imports.resolveImportObjectReconciliationJob(
      job.id, new Date("2026-08-12T13:00:00.000Z"), "persistence_committed"
    )).resolves.toBe(false);
    await expect(imports.recordImportObjectReconciliationFailure(
      job.id, new Date("2026-08-12T13:00:00.000Z"), "StorageError", "access_denied"
    )).resolves.toBe(false);

    await expect(database.query(
      `SELECT state, resolution, failure_count, last_error_type, last_error_code
       FROM import_object_reconciliation_jobs WHERE id = $1`, [job.id]
    )).resolves.toMatchObject({ rows: [{
      state: "resolved", resolution: "object_removed", failure_count: 1,
      last_error_type: "StorageError", last_error_code: "access_denied"
    }] });
  });

  it("normalizes reconciliation diagnostics to finite stable tokens", async () => {
    const job = await imports.enqueueImportObjectReconciliationJob(reconciliationJobInput({
      id: "reconciliation_validation", objectKey: "imports/reconciliation/validation"
    }));
    const invalid = new Date("invalid");

    await expect(imports.listEligibleImportObjectReconciliationJobs(invalid)).rejects.toBeInstanceOf(ValidationError);
    await expect(imports.resolveImportObjectReconciliationJob(job.id, invalid, "object_removed"))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(imports.recordImportObjectReconciliationFailure(
      job.id, new Date("2026-08-12T12:00:00.000Z"), "StorageError", "access_denied"
    )).resolves.toBe(true);
    await expect(database.query(
      `SELECT last_error_type, last_error_code
       FROM import_object_reconciliation_jobs WHERE id = $1`, [job.id]
    )).resolves.toMatchObject({ rows: [{
      last_error_type: "StorageError", last_error_code: "access_denied"
    }] });
    await expect(imports.recordImportObjectReconciliationFailure(
      job.id, new Date("2026-08-12T13:00:00.000Z"), "sk_live_51N9gAFakeOpaqueSecret", "raw_error_payload"
    )).resolves.toBe(true);

    await expect(database.query(
      `SELECT last_error_type, last_error_code
       FROM import_object_reconciliation_jobs WHERE id = $1`, [job.id]
    )).resolves.toMatchObject({ rows: [{ last_error_type: null, last_error_code: null }] });
  });

  it("creates import file metadata and maps BIGINT and timestamps", async () => {
    const batch = await imports.createBatch({
      id: "batch_file_metadata",
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      actorId: "actor_demo",
      sourceType: "csv"
    });
    const uploadedAt = new Date("2026-08-11T08:00:00.000Z");
    const expiresAt = new Date("2026-11-09T08:00:00.000Z");

    const file = await imports.createImportFile({
      id: "file_metadata",
      batchId: batch.id,
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      originalFileName: "weekly.csv",
      normalizedMimeType: "text/csv",
      byteCount: 5242880,
      sha256Checksum: "a".repeat(64),
      objectKey: "imports/ent_demo/store_demo/batch_file_metadata/a.csv",
      uploadedAt,
      expiresAt
    });

    expect(file).toEqual({
      id: "file_metadata",
      batchId: batch.id,
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      originalFileName: "weekly.csv",
      normalizedMimeType: "text/csv",
      byteCount: 5242880,
      sha256Checksum: "a".repeat(64),
      objectKey: "imports/ent_demo/store_demo/batch_file_metadata/a.csv",
      uploadedAt,
      expiresAt,
      cleanedAt: null,
      cleanupAttemptedAt: null,
      cleanupFailureCount: 0
    });
    expect(file.byteCount).toBeTypeOf("number");
    expect(file.uploadedAt).toBeInstanceOf(Date);
    expect(file.expiresAt).toBeInstanceOf(Date);
  });

  it("rejects a duplicate checksum in the same enterprise and store", async () => {
    const checksum = "b".repeat(64);
    const firstBatch = await imports.createBatch({
      id: "batch_duplicate_first", enterpriseId: "ent_demo", storeId: "store_demo",
      actorId: "actor_demo", sourceType: "csv"
    });
    const secondBatch = await imports.createBatch({
      id: "batch_duplicate_second", enterpriseId: "ent_demo", storeId: "store_demo",
      actorId: "actor_demo", sourceType: "csv"
    });
    const baseFile = {
      enterpriseId: "ent_demo", storeId: "store_demo", originalFileName: "weekly.csv",
      normalizedMimeType: "text/csv", byteCount: 12, sha256Checksum: checksum,
      uploadedAt: new Date("2026-08-11T08:00:00.000Z"),
      expiresAt: new Date("2026-11-09T08:00:00.000Z")
    };

    await imports.createImportFile({
      ...baseFile, id: "file_duplicate_first", batchId: firstBatch.id,
      objectKey: "imports/ent_demo/store_demo/batch_duplicate_first/b.csv"
    });

    await expect(imports.createImportFile({
      ...baseFile, id: "file_duplicate_second", batchId: secondBatch.id,
      objectKey: "imports/ent_demo/store_demo/batch_duplicate_second/b.csv"
    })).rejects.toEqual(expect.objectContaining({
      name: DuplicateImportFileError.name,
      message: "Import file already exists for store"
    }));
  });

  it("allows the same checksum in another store and finds the scoped batch", async () => {
    const checksum = "c".repeat(64);
    const firstBatch = await imports.createBatch({
      id: "batch_store_first", enterpriseId: "ent_demo", storeId: "store_demo",
      actorId: "actor_demo", sourceType: "csv"
    });
    const otherBatch = await imports.createBatch({
      id: "batch_store_other", enterpriseId: "ent_demo", storeId: "store_other",
      actorId: "actor_demo", sourceType: "csv"
    });
    const uploadedAt = new Date("2026-08-11T08:00:00.000Z");
    const expiresAt = new Date("2026-11-09T08:00:00.000Z");

    await imports.createImportFile({
      id: "file_store_first", batchId: firstBatch.id, enterpriseId: "ent_demo", storeId: "store_demo",
      originalFileName: "weekly.csv", normalizedMimeType: "text/csv", byteCount: 12,
      sha256Checksum: checksum, objectKey: "imports/ent_demo/store_demo/batch_store_first/c.csv",
      uploadedAt, expiresAt
    });
    await imports.createImportFile({
      id: "file_store_other", batchId: otherBatch.id, enterpriseId: "ent_demo", storeId: "store_other",
      originalFileName: "weekly.csv", normalizedMimeType: "text/csv", byteCount: 12,
      sha256Checksum: checksum, objectKey: "imports/ent_demo/store_other/batch_store_other/c.csv",
      uploadedAt, expiresAt
    });

    await expect(imports.findBatchByFileChecksum({
      enterpriseId: "ent_demo", storeId: "store_demo", sha256Checksum: checksum
    })).resolves.toMatchObject({ id: firstBatch.id, storeId: "store_demo" });
    await expect(imports.findBatchByFileChecksum({
      enterpriseId: "ent_demo", storeId: "missing", sha256Checksum: checksum
    })).resolves.toBeNull();
  });

  it("creates file metadata with its batch and candidates in one transaction", async () => {
    const uploadedAt = new Date("2026-08-11T08:00:00.000Z");
    const expiresAt = new Date("2026-11-09T08:00:00.000Z");
    const batch = await imports.createBatchWithCandidates(
      {
        id: "batch_transaction_success", enterpriseId: "ent_demo", storeId: "store_demo",
        actorId: "actor_demo", sourceType: "csv", rangeStart: "2026-08-01", rangeEnd: "2026-08-07"
      },
      [{
        metricKey: "orders", metricDisplayName: "Orders", value: 12, unit: "count",
        rangeStart: "2026-08-01", rangeEnd: "2026-08-07", sourceLocator: "row:1:orders",
        confidence: 100, status: "ready"
      }],
      {
        id: "file_transaction_success", batchId: "batch_transaction_success", enterpriseId: "ent_demo",
        storeId: "store_demo", originalFileName: "weekly.csv", normalizedMimeType: "text/csv",
        byteCount: 12, sha256Checksum: "d".repeat(64),
        objectKey: "imports/ent_demo/store_demo/batch_transaction_success/d.csv", uploadedAt, expiresAt
      }
    );

    expect(batch).toMatchObject({ id: "batch_transaction_success", candidates: [{ value: 12 }] });
    expect(await database.query("SELECT id FROM import_files WHERE batch_id = $1", [batch.id]))
      .toMatchObject({ rowCount: 1, rows: [{ id: "file_transaction_success" }] });
    expect(await database.query("SELECT batch_id FROM import_batch_reconciliation_guards WHERE batch_id = $1", [batch.id]))
      .toMatchObject({ rowCount: 1, rows: [{ batch_id: batch.id }] });
  });

  it("prunes only unprotected stale or missing batch guards in bounded order", async () => {
    const now = new Date("2026-08-12T00:00:00.000Z");
    const oldBatch = await imports.createBatch({ id: "batch_guard_old", enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", sourceType: "manual" });
    await database.query("UPDATE import_batches SET updated_at = $1 WHERE id = $2", [new Date("2026-07-01T00:00:00.000Z"), oldBatch.id]);
    await database.query("INSERT INTO import_batch_reconciliation_guards (batch_id) VALUES ($1), ($2)", [oldBatch.id, "batch_guard_missing"]);
    const pruned = await imports.pruneImportBatchReconciliationGuards(now);
    expect(pruned).toBe(2);
    expect(await database.query("SELECT batch_id FROM import_batch_reconciliation_guards ORDER BY batch_id")).toMatchObject({ rows: [] });
  });

  it("retains recent and pending guards and enforces the prune limit", async () => {
    const now = new Date("2026-08-12T00:00:00.000Z");
    const recent = await imports.createBatch({ id: "batch_guard_recent", enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", sourceType: "manual" });
    await database.query("UPDATE import_batches SET updated_at = $1 WHERE id = $2", [new Date("2026-08-01T00:00:00.000Z"), recent.id]);
    await database.query("INSERT INTO import_batch_reconciliation_guards (batch_id) VALUES ($1), ($2), ($3)", [recent.id, "batch_guard_pending", "batch_guard_limit"]);
    await imports.enqueueImportObjectReconciliationJob({ id: "guard_pending_job", enterpriseId: "ent_demo", storeId: "store_demo", batchId: "batch_guard_pending", sha256Checksum: "a".repeat(64), objectKey: "guard/pending", kind: "verify_batch_then_delete", notBefore: now });
    await expect(imports.pruneImportBatchReconciliationGuards(now, 0)).rejects.toBeInstanceOf(ValidationError);
    expect(await imports.pruneImportBatchReconciliationGuards(now, 1)).toBe(1);
    expect(await database.query("SELECT batch_id FROM import_batch_reconciliation_guards ORDER BY batch_id")).toMatchObject({ rows: [{ batch_id: "batch_guard_pending" }, { batch_id: recent.id }] });
  });

  it("rejects file metadata whose batch or store scope differs from the new batch", async () => {
    await expect(imports.createBatchWithCandidates(
      {
        id: "batch_scope_contract", enterpriseId: "ent_demo", storeId: "store_demo",
        actorId: "actor_demo", sourceType: "csv"
      },
      [],
      {
        id: "file_scope_contract", batchId: "batch_other", enterpriseId: "ent_demo",
        storeId: "store_other", originalFileName: "weekly.csv", normalizedMimeType: "text/csv",
        byteCount: 12, sha256Checksum: "f".repeat(64),
        objectKey: "imports/ent_demo/store_other/batch_other/f.csv",
        uploadedAt: new Date("2026-08-11T08:00:00.000Z"),
        expiresAt: new Date("2026-11-09T08:00:00.000Z")
      }
    )).rejects.toBeInstanceOf(ValidationError);

    expect(await database.query("SELECT * FROM import_batches WHERE id = $1", ["batch_scope_contract"]))
      .toMatchObject({ rows: [] });
  });

  it("rolls back batch and file metadata when a later candidate fails", async () => {
    const uploadedAt = new Date("2026-08-11T08:00:00.000Z");
    const expiresAt = new Date("2026-11-09T08:00:00.000Z");
    const statements: string[] = [];
    const connect = database.connect.bind(database);
    database.connect = async () => {
      const client = await connect();
      const query = client.query.bind(client);
      client.query = ((text: string, values?: readonly unknown[]) => {
        statements.push(text.trim());
        return query(text, values as unknown[]);
      }) as typeof client.query;
      return client;
    };

    await expect(imports.createBatchWithCandidates(
      {
        id: "batch_transaction_failure", enterpriseId: "ent_demo", storeId: "store_demo",
        actorId: "actor_demo", sourceType: "csv", rangeStart: "2026-08-01", rangeEnd: "2026-08-07"
      },
      [{
        metricKey: "orders", metricDisplayName: "Orders", value: 12, unit: "count",
        rangeStart: "2026-08-01", rangeEnd: "2026-08-07", sourceLocator: "row:1:orders",
        confidence: 101, status: "ready"
      }],
      {
        id: "file_transaction_failure", batchId: "batch_transaction_failure", enterpriseId: "ent_demo",
        storeId: "store_demo", originalFileName: "weekly.csv", normalizedMimeType: "text/csv",
        byteCount: 12, sha256Checksum: "e".repeat(64),
        objectKey: "imports/ent_demo/store_demo/batch_transaction_failure/e.csv", uploadedAt, expiresAt
      }
    )).rejects.toThrow();

    const beginIndex = statements.findIndex((statement) => statement === "BEGIN");
    const batchIndex = statements.findIndex((statement) => statement.startsWith("INSERT INTO import_batches"));
    const fileIndex = statements.findIndex((statement) => statement.startsWith("INSERT INTO import_files"));
    const candidateIndex = statements.findIndex((statement) => statement.startsWith("INSERT INTO import_candidates"));
    const rollbackIndex = statements.findIndex((statement) => statement === "ROLLBACK");

    // pg-mem does not restore all cross-table writes, so verify the transaction protocol sent to PostgreSQL.
    expect([beginIndex, batchIndex, fileIndex, candidateIndex, rollbackIndex]).toEqual(
      [...[beginIndex, batchIndex, fileIndex, candidateIndex, rollbackIndex]].sort((left, right) => left - right)
    );
    expect(beginIndex).toBeGreaterThanOrEqual(0);
    expect(rollbackIndex).toBeGreaterThan(candidateIndex);
    expect(statements).not.toContain("COMMIT");
  });

  it("rejects a fact value whose candidate comes from another batch in the same store", async () => {
    const firstBatch = await imports.createBatch({ enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", sourceType: "manual" });
    const firstCandidate = await imports.createCandidate({
      batchId: firstBatch.id, enterpriseId: "ent_demo", storeId: "store_demo", metricKey: "revenue",
      metricDisplayName: "Revenue", value: 4826000, unit: "cents", rangeStart: "2026-08-01",
      rangeEnd: "2026-08-07", sourceLocator: "manual:revenue", confidence: 100, status: "ready"
    });
    const version = await imports.confirmBatch({
      batchId: firstBatch.id, enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", candidateIds: [firstCandidate.id]
    });
    const secondBatch = await imports.createBatch({ enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", sourceType: "manual" });
    const secondCandidate = await imports.createCandidate({
      batchId: secondBatch.id, enterpriseId: "ent_demo", storeId: "store_demo", metricKey: "orders",
      metricDisplayName: "Orders", value: 120, unit: "count", rangeStart: "2026-08-01",
      rangeEnd: "2026-08-07", sourceLocator: "manual:orders", confidence: 100, status: "ready"
    });

    await expect(database.query(
      `INSERT INTO fact_values (
        id, fact_version_id, enterprise_id, store_id, metric_key, value, unit,
        range_start, range_end, source_candidate_id, source_batch_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        "invalid_cross_batch_fact", version.id, "ent_demo", "store_demo", "orders", 120, "orders",
        "2026-08-01", "2026-08-07", secondCandidate.id, firstBatch.id
      ]
    )).rejects.toThrow();
  });

  it("returns typed errors for a repeat confirmation and non-ready candidate", async () => {
    const batch = await imports.createBatch({ enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", sourceType: "manual" });
    const candidate = await imports.createCandidate({
      batchId: batch.id, enterpriseId: "ent_demo", storeId: "store_demo", metricKey: "revenue",
      metricDisplayName: "Revenue", value: 4826000, unit: "cents", rangeStart: "2026-08-01",
      rangeEnd: "2026-08-07", sourceLocator: "manual:revenue", confidence: 100, status: "needs_confirmation"
    });
    await expect(imports.confirmBatch({
      batchId: batch.id, enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", candidateIds: [candidate.id]
    })).rejects.toBeInstanceOf(ValidationError);

    const readyCandidate = await imports.createCandidate({
      batchId: batch.id, enterpriseId: "ent_demo", storeId: "store_demo", metricKey: "orders",
      metricDisplayName: "Orders", value: 120, unit: "count", rangeStart: "2026-08-01",
      rangeEnd: "2026-08-07", sourceLocator: "manual:orders", confidence: 100, status: "ready"
    });
    const factVersion = await imports.confirmBatch({
      batchId: batch.id, enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", candidateIds: [readyCandidate.id]
    });
    await expect(imports.confirmBatch({
      batchId: batch.id, enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", candidateIds: [readyCandidate.id]
    })).rejects.toBeInstanceOf(ConflictError);
    await expect(imports.getFactVersion({ id: factVersion.id, enterpriseId: "ent_demo", storeId: "store_other" }))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it("appends fact versions without changing historical candidate provenance", async () => {
    const firstBatch = await imports.createBatch({
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      actorId: "actor_demo",
      sourceType: "manual"
    });
    const firstCandidate = await imports.createCandidate({
      batchId: firstBatch.id,
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      metricKey: "revenue",
      metricDisplayName: "Revenue",
      value: 4826000,
      unit: "cents",
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-07",
      sourceLocator: "manual:revenue",
      confidence: 100,
      status: "ready"
    });
    const firstVersion = await imports.confirmBatch({
      batchId: firstBatch.id,
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      actorId: "actor_demo",
      candidateIds: [firstCandidate.id]
    });

    const secondBatch = await imports.createBatch({
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      actorId: "actor_demo",
      sourceType: "manual"
    });
    const secondCandidate = await imports.createCandidate({
      batchId: secondBatch.id,
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      metricKey: "revenue",
      metricDisplayName: "Revenue",
      value: 5000000,
      unit: "cents",
      rangeStart: "2026-08-08",
      rangeEnd: "2026-08-14",
      sourceLocator: "manual:revenue",
      confidence: 100,
      status: "ready"
    });
    const secondVersion = await imports.confirmBatch({
      batchId: secondBatch.id,
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      actorId: "actor_demo",
      candidateIds: [secondCandidate.id]
    });

    const historicalFirst = await imports.getFactVersion({
      id: firstVersion.id,
      enterpriseId: "ent_demo",
      storeId: "store_demo"
    });

    expect(secondVersion.id).not.toBe(firstVersion.id);
    expect(historicalFirst.values).toEqual([
      expect.objectContaining({
        value: 4826000,
        sourceCandidateId: firstCandidate.id,
        sourceBatchId: firstBatch.id
      })
    ]);
    expect(secondVersion.values).toEqual([
      expect.objectContaining({
        value: 5000000,
        sourceCandidateId: secondCandidate.id,
        sourceBatchId: secondBatch.id
      })
    ]);
  });
});

async function applyTestMigrations(database: Database): Promise<string> {
  const migrationsUrl = new URL("../migrations/", import.meta.url);
  const fileNames = (await readdir(migrationsUrl))
    .filter((fileName) => /^\d+.*\.sql$/.test(fileName))
    .sort();
  const migrations = await Promise.all(
    fileNames.map((fileName) => readFile(new URL(fileName, migrationsUrl), "utf8"))
  );

  for (const migrationSql of migrations) {
    // pg-mem supports relational constraints but not PostgreSQL PL/pgSQL triggers.
    // Trigger execution and concurrent confirmations require a Docker PostgreSQL test run.
    await database.query(migrationSql.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
  }

  return migrations.join("\n");
}

function postgresDateAtLocalMidnight(year: number, month: number, day: number, utcIso: string): Date {
  const value = new Date(utcIso);
  value.getFullYear = () => year;
  value.getMonth = () => month - 1;
  value.getDate = () => day;
  return value;
}

function reconciliationJobInput(overrides: {
  id: string;
  objectKey?: string;
  notBefore?: Date;
}): {
  id: string;
  enterpriseId: string;
  storeId: string;
  batchId: string;
  sha256Checksum: string;
  objectKey: string;
  kind: "delete_orphan";
  notBefore: Date;
} {
  return {
    id: overrides.id,
    enterpriseId: "ent_demo",
    storeId: "store_demo",
    batchId: "batch_reconciliation",
    sha256Checksum: "a".repeat(64),
    objectKey: overrides.objectKey ?? `imports/reconciliation/${overrides.id}`,
    kind: "delete_orphan",
    notBefore: overrides.notBefore ?? new Date("2026-08-12T12:00:00.000Z")
  };
}
