import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import { ImportRepository, ValidationError, type ImportMaintenanceStatus } from "../src/imports/repository.js";
import { runImportMaintenanceStatus, IMPORT_MAINTENANCE_STATUS_ADVISORY_LOCK_KEY } from "../src/import-maintenance-status.js";

const now = new Date("2026-11-09T08:00:00.000Z");

describe("import maintenance status", () => {
  let imports: ImportRepository;
  let transactionEvents: string[];

  beforeEach(async () => {
    const memory = newDb();
    const { Pool } = memory.adapters.createPg();
    const pool = new Pool();
    const database = pool;
    await database.query(`
      CREATE TABLE import_object_reconciliation_jobs (
        id TEXT PRIMARY KEY, object_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL, state TEXT NOT NULL, not_before TIMESTAMPTZ NOT NULL,
        attempted_at TIMESTAMPTZ, failure_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE import_batch_reconciliation_guards (batch_id TEXT PRIMARY KEY);
    `);
    await seed(database);
    transactionEvents = [];
    imports = new ImportRepository({
      query: pool.query.bind(pool),
      async connect() {
        const client = await pool.connect();
        const query = client.query.bind(client);
        client.query = ((text: string, values?: readonly unknown[]) => {
          transactionEvents.push(text);
          return (query as unknown as (queryText: string, queryValues?: readonly unknown[]) => Promise<unknown>)(text, values);
        }) as typeof client.query;
        return client;
      }
    } as Database);
  });

  it("returns privacy-safe aggregate reconciliation and guard health", async () => {
    const status = await imports.getImportMaintenanceStatus(now);

    expect(status).toEqual({
      pendingReconciliationJobs: 5,
      eligibleReconciliationJobs: 2,
      graceDeferredReconciliationJobs: 1,
      retryDeferredReconciliationJobs: 1,
      failedReconciliationJobs: 2,
      oldestEligibleAt: new Date("2026-11-09T05:00:00.000Z"),
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
    expect(transactionEvents[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  });

  it.each([new Date("invalid"), null as unknown as Date])("rejects an invalid status timestamp: %s", async (value) => {
    await expect(imports.getImportMaintenanceStatus(value)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("import maintenance status CLI", () => {
  it("requires only DATABASE_URL and holds the lock on the same client", async () => {
    const status = { pendingReconciliationJobs: 1, eligibleReconciliationJobs: 1, graceDeferredReconciliationJobs: 0, retryDeferredReconciliationJobs: 0, failedReconciliationJobs: 0, oldestEligibleAt: now, reconciliationGuardCount: 1 };
    const harness = createCliHarness(status);
    await expect(runImportMaintenanceStatus({ DATABASE_URL: "postgres://private" }, harness.dependencies)).resolves.toEqual(status);
    expect(harness.lockKey).toBe(IMPORT_MAINTENANCE_STATUS_ADVISORY_LOCK_KEY);
    expect(harness.events).toEqual(["connect", "try-lock", "status", "unlock", "release", "output", "end"]);
    expect(harness.output).toHaveLength(1);
  });

  it("returns a privacy-safe skipped result on lock contention", async () => {
    const harness = createCliHarness({} as never, { lockAcquired: false });
    const result = await runImportMaintenanceStatus({ DATABASE_URL: "postgres://private", MINIO_SECRET_KEY: "must-not-read" }, harness.dependencies);
    expect(result).toEqual({ skipped: true, reason: "already_running" });
    expect(harness.events).toEqual(["connect", "try-lock", "release", "output", "end"]);
  });

  it("always releases resources when status fails", async () => {
    const failure = new Error("private database details");
    const harness = createCliHarness(failure);
    await expect(runImportMaintenanceStatus({ DATABASE_URL: "postgres://private" }, harness.dependencies)).rejects.toBe(failure);
    expect(harness.events).toEqual(["connect", "try-lock", "status", "unlock", "release", "end"]);
    expect(harness.output).toEqual([]);
  });
});

function createCliHarness(status: ImportMaintenanceStatus | Error, options: { lockAcquired?: boolean } = {}) {
  const state = { events: [] as string[], output: [] as string[], lockKey: 0 };
  const client = {
    async query(text: string, values?: readonly unknown[]) {
      if (text.includes("pg_try_advisory_lock")) { state.events.push("try-lock"); state.lockKey = Number(values?.[0]); return { rows: [{ locked: options.lockAcquired ?? true }], rowCount: 1 }; }
      if (text.includes("pg_advisory_unlock")) { state.events.push("unlock"); return { rows: [{ unlocked: true }], rowCount: 1 }; }
      throw new Error(`unexpected query: ${text}`);
    },
    release() { state.events.push("release"); }
  };
  const database = {
    async connect() { state.events.push("connect"); return client; },
    async end() { state.events.push("end"); },
    async query() { throw new Error("pool query forbidden"); }
  } as never;
  const dependencies = {
    createDatabase() { return database; },
    now: () => now,
    async getStatus() { state.events.push("status"); if (status instanceof Error) throw status; return status; },
    writeOutput(value: string) { state.events.push("output"); state.output.push(value); }
  };
  return Object.assign(state, { dependencies });
}

async function seed(database: Database): Promise<void> {
  await database.query(
    `INSERT INTO import_object_reconciliation_jobs
      (id, object_key, kind, state, not_before, attempted_at, failure_count, created_at)
     VALUES
      ('job_eligible', 'object/private-key', 'delete_orphan', 'pending', $1, NULL, 0, $8),
      ('job_failed_eligible', 'object/failed', 'delete_orphan', 'pending', $2, $3, 1, $9),
      ('job_grace', 'object/grace', 'verify_batch_then_delete', 'pending', $4, NULL, 0, $10),
      ('job_retry', 'object/retry', 'delete_orphan', 'pending', $5, $6, 1, $11),
      ('job_future_orphan', 'object/future-orphan', 'delete_orphan', 'pending', $4, NULL, 0, $12),
      ('job_resolved', 'object/resolved', 'delete_orphan', 'resolved', $7, NULL, 9, $13)`,
    [
      new Date("2026-11-09T06:00:00.000Z"), new Date("2026-11-09T07:00:00.000Z"),
      new Date("2026-11-09T06:30:00.000Z"), new Date("2026-11-09T08:05:00.000Z"),
      new Date("2026-11-09T07:00:00.000Z"), new Date("2026-11-09T07:30:00.000Z"),
      new Date("2026-11-09T06:00:00.000Z"),
      new Date("2026-11-09T05:00:00.000Z"), new Date("2026-11-09T06:00:00.000Z"),
      new Date("2026-11-09T07:00:00.000Z"), new Date("2026-11-09T07:30:00.000Z"),
      new Date("2026-11-09T07:00:00.000Z"), new Date("2026-11-09T06:00:00.000Z")
    ]
  );
  await database.query("INSERT INTO import_batch_reconciliation_guards (batch_id) VALUES ('guard_one'), ('guard_two')");
}
