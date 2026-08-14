import { describe, expect, it } from "vitest";
import {
  importObjectReconciliationExitCode,
  runImportObjectReconciliationCli,
  type ReconcileImportObjectsDependencies,
  type ReconciliationDatabase
} from "../src/reconcile-import-objects.js";
import type { ImportObjectReconciliationRunResult } from "../src/imports/object-reconciliation.js";
import type { ObjectStorage } from "../src/storage/object-storage.js";

const environment = {
  DATABASE_URL: "postgresql://user:private-password@postgres:5432/imports",
  MINIO_ENDPOINT: "http://minio:9000",
  MINIO_ACCESS_KEY: "access",
  MINIO_SECRET_KEY: "private-secret",
  MINIO_BUCKET: "restaurant-imports"
};
const completed: ImportObjectReconciliationRunResult = {
  scanned: 3, resolved: 3, failed: 0, deferred: 0, passes: 1, hasMore: false, guardsPruned: 0
};

describe("import object reconciliation CLI", () => {
  it("requires a non-empty database URL before creating resources", async () => {
    const harness = createHarness(completed);
    await expect(runImportObjectReconciliationCli({ ...environment, DATABASE_URL: "  " }, harness.dependencies))
      .rejects.toThrow("DATABASE_URL is required");
    expect(harness.databaseCreated).toBe(false);
  });

  it.each(["MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "MINIO_BUCKET"] as const)(
    "requires non-empty %s",
    async (key) => {
      const harness = createHarness(completed);
      await expect(runImportObjectReconciliationCli({ ...environment, [key]: " " }, harness.dependencies))
        .rejects.toThrow(`Missing MinIO configuration: ${key}`);
      expect(harness.databaseCreated).toBe(false);
    }
  );

  it("holds and releases a session advisory lock around reconciliation before printing JSON", async () => {
    const harness = createHarness(completed);

    await expect(runImportObjectReconciliationCli(environment, harness.dependencies)).resolves.toEqual(completed);
    expect(harness.output).toEqual([JSON.stringify(completed)]);
    expect(harness.events).toEqual([
      "connect", "try-lock", "reconcile", "unlock", "release", "output", "end"
    ]);
  });

  it("skips without reconciliation when another worker holds the lock", async () => {
    const harness = createHarness(completed, { lockAcquired: false });
    const skipped = { skipped: true as const, reason: "already_running" as const };

    await expect(runImportObjectReconciliationCli(environment, harness.dependencies)).resolves.toEqual(skipped);
    expect(harness.output).toEqual([JSON.stringify(skipped)]);
    expect(harness.reconcileCalls).toBe(0);
    expect(harness.events).toEqual(["connect", "try-lock", "release", "output", "end"]);
    expect(importObjectReconciliationExitCode(skipped)).toBe(0);
  });

  it("releases the lock and database when reconciliation throws", async () => {
    const failure = new Error("reconciliation failed");
    const harness = createHarness(failure);

    await expect(runImportObjectReconciliationCli(environment, harness.dependencies)).rejects.toBe(failure);
    expect(harness.output).toEqual([]);
    expect(harness.events).toEqual(["connect", "try-lock", "reconcile", "unlock", "release", "end"]);
  });

  it("preserves reconciliation failure if unlocking also fails", async () => {
    const failure = new Error("reconciliation failed");
    const harness = createHarness(failure, { unlockFailure: new Error("unlock secret") });

    await expect(runImportObjectReconciliationCli(environment, harness.dependencies)).rejects.toBe(failure);
    expect(harness.events).toEqual(["connect", "try-lock", "reconcile", "unlock", "release", "end"]);
  });

  it("rejects neutrally if only unlocking fails", async () => {
    const harness = createHarness(completed, { unlockFailure: new Error("unlock secret") });
    await expect(runImportObjectReconciliationCli(environment, harness.dependencies)).rejects.toThrow(
      "Unable to release import object reconciliation lock"
    );
    expect(harness.output).toEqual([]);
  });

  it("returns nonzero for failed work or an eligible backlog", () => {
    expect(importObjectReconciliationExitCode(completed)).toBe(0);
    expect(importObjectReconciliationExitCode({ ...completed, failed: 1 })).toBe(1);
    expect(importObjectReconciliationExitCode({ ...completed, hasMore: true })).toBe(1);
  });
});

function createHarness(
  reconciliationOutcome: ImportObjectReconciliationRunResult | Error,
  options: { lockAcquired?: boolean; unlockFailure?: Error; unlockResult?: boolean } = {}
) {
  const state = { databaseCreated: false, output: [] as string[], events: [] as string[], reconcileCalls: 0 };
  const client = {
    async query(text: string) {
      if (text.includes("pg_try_advisory_lock")) {
        state.events.push("try-lock");
        return { rows: [{ locked: options.lockAcquired ?? true }], rowCount: 1 };
      }
      if (text.includes("pg_advisory_unlock")) {
        state.events.push("unlock");
        if (options.unlockFailure) throw options.unlockFailure;
        return { rows: [{ unlocked: options.unlockResult ?? true }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${text}`);
    },
    release() { state.events.push("release"); }
  };
  const database = {
    async query() { throw new Error("pool query is not allowed for locking"); },
    async connect() { state.events.push("connect"); return client; },
    async end() { state.events.push("end"); }
  } as unknown as ReconciliationDatabase;
  const dependencies: ReconcileImportObjectsDependencies = {
    createDatabase() { state.databaseCreated = true; return database; },
    createObjectStorage() { return storage; },
    async reconcile() {
      state.reconcileCalls += 1;
      state.events.push("reconcile");
      if (reconciliationOutcome instanceof Error) throw reconciliationOutcome;
      return reconciliationOutcome;
    },
    now: () => new Date("2026-11-09T08:00:00.000Z"),
    writeOutput(value) { state.events.push("output"); state.output.push(value); }
  };
  return Object.assign(state, { dependencies });
}

const storage: ObjectStorage = {
  async putObject() {},
  async deleteObject() { return "missing"; }
};
