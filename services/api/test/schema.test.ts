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
      metricDisplayName: "Orders", value: 120, unit: "orders", rangeStart: "2026-08-01",
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
      metricDisplayName: "Orders", value: 120, unit: "orders", rangeStart: "2026-08-01",
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
