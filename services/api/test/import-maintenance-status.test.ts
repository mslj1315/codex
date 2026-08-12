import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import { ImportRepository, ValidationError } from "../src/imports/repository.js";

const now = new Date("2026-11-09T08:00:00.000Z");

describe("import maintenance status", () => {
  let imports: ImportRepository;

  beforeEach(async () => {
    const memory = newDb();
    const { Pool } = memory.adapters.createPg();
    const pool = new Pool();
    const database = pool;
    await database.query(`
      CREATE TABLE import_object_reconciliation_jobs (
        id TEXT PRIMARY KEY, object_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL, state TEXT NOT NULL, not_before TIMESTAMPTZ NOT NULL,
        attempted_at TIMESTAMPTZ, failure_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE import_batch_reconciliation_guards (batch_id TEXT PRIMARY KEY);
    `);
    await seed(database);
    imports = new ImportRepository(database);
  });

  it("returns privacy-safe aggregate reconciliation and guard health", async () => {
    const status = await imports.getImportMaintenanceStatus(now);

    expect(status).toEqual({
      pendingReconciliationJobs: 4,
      eligibleReconciliationJobs: 2,
      graceDeferredReconciliationJobs: 1,
      retryDeferredReconciliationJobs: 1,
      failedReconciliationJobs: 2,
      oldestEligibleAt: new Date("2026-11-09T06:00:00.000Z"),
      reconciliationGuardCount: 2
    });
    expect(Object.keys(status).sort()).toEqual([
      "eligibleReconciliationJobs",
      "failedReconciliationJobs",
      "graceDeferredReconciliationJobs",
      "oldestEligibleAt",
      "pendingReconciliationJobs",
      "reconciliationGuardCount",
      "retryDeferredReconciliationJobs"
    ]);
    expect(JSON.stringify(status)).not.toContain("object/private-key");
    expect(JSON.stringify(status)).not.toContain("job_eligible");
  });

  it.each([new Date("invalid"), null as unknown as Date])("rejects an invalid status timestamp: %s", async (value) => {
    await expect(imports.getImportMaintenanceStatus(value)).rejects.toBeInstanceOf(ValidationError);
  });
});

async function seed(database: Database): Promise<void> {
  await database.query(
    `INSERT INTO import_object_reconciliation_jobs
      (id, object_key, kind, state, not_before, attempted_at, failure_count)
     VALUES
      ('job_eligible', 'object/private-key', 'delete_orphan', 'pending', $1, NULL, 0),
      ('job_failed_eligible', 'object/failed', 'delete_orphan', 'pending', $2, $3, 1),
      ('job_grace', 'object/grace', 'verify_batch_then_delete', 'pending', $4, NULL, 0),
      ('job_retry', 'object/retry', 'delete_orphan', 'pending', $5, $6, 1),
      ('job_resolved', 'object/resolved', 'delete_orphan', 'resolved', $7, NULL, 9)`,
    [
      new Date("2026-11-09T06:00:00.000Z"), new Date("2026-11-09T07:00:00.000Z"),
      new Date("2026-11-09T06:30:00.000Z"), new Date("2026-11-09T08:05:00.000Z"),
      new Date("2026-11-09T07:00:00.000Z"), new Date("2026-11-09T07:30:00.000Z"),
      new Date("2026-11-09T06:00:00.000Z")
    ]
  );
  await database.query("INSERT INTO import_batch_reconciliation_guards (batch_id) VALUES ('guard_one'), ('guard_two')");
}
