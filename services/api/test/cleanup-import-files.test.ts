import { describe, expect, it } from "vitest";
import {
  cleanupExitCode,
  runImportFileCleanup,
  type CleanupDatabase,
  type CleanupImportFilesDependencies
} from "../src/cleanup-import-files.js";
import type { ImportFileCleanupRunResult } from "../src/imports/file-cleanup.js";
import type { ObjectStorage } from "../src/storage/object-storage.js";

const environment = {
  DATABASE_URL: "postgresql://user:private-password@postgres:5432/imports",
  MINIO_ENDPOINT: "http://minio:9000",
  MINIO_ACCESS_KEY: "access",
  MINIO_SECRET_KEY: "private-secret",
  MINIO_BUCKET: "restaurant-imports"
};
const completed: ImportFileCleanupRunResult = {
  scanned: 3,
  cleaned: 3,
  failed: 0,
  passes: 1,
  hasMore: false
};

describe("import file cleanup CLI", () => {
  it("requires a non-empty database URL before creating resources", async () => {
    const harness = createHarness(completed);
    await expect(runImportFileCleanup({ ...environment, DATABASE_URL: "  " }, harness.dependencies))
      .rejects.toThrow("DATABASE_URL is required");
    expect(harness.databaseCreated).toBe(false);
  });

  it.each(["MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "MINIO_BUCKET"] as const)(
    "requires non-empty %s",
    async (key) => {
      const harness = createHarness(completed);
      await expect(runImportFileCleanup({ ...environment, [key]: " " }, harness.dependencies))
        .rejects.toThrow(`Missing MinIO configuration: ${key}`);
      expect(harness.databaseCreated).toBe(false);
    }
  );

  it("holds and releases a session advisory lock around cleanup before printing JSON", async () => {
    const harness = createHarness(completed);

    await expect(runImportFileCleanup(environment, harness.dependencies)).resolves.toEqual(completed);
    expect(harness.output).toEqual([JSON.stringify(completed)]);
    expect(harness.events).toEqual([
      "connect", "try-lock", "cleanup", "unlock", "release", "output", "end"
    ]);
  });

  it("skips without cleanup when another worker holds the lock", async () => {
    const harness = createHarness(completed, { lockAcquired: false });

    const skipped = { skipped: true as const, reason: "already_running" as const };
    await expect(runImportFileCleanup(environment, harness.dependencies)).resolves.toEqual(skipped);
    expect(harness.output).toEqual([JSON.stringify(skipped)]);
    expect(harness.cleanupCalls).toBe(0);
    expect(harness.events).toEqual(["connect", "try-lock", "release", "output", "end"]);
    expect(cleanupExitCode(skipped)).toBe(0);
  });

  it("allows only one of two concurrent runs to execute cleanup", async () => {
    let lockHeld = false;
    let releaseCleanup!: () => void;
    let signalStarted!: () => void;
    const cleanupStarted = new Promise<void>((resolve) => { signalStarted = resolve; });
    const cleanupBlocked = new Promise<void>((resolve) => { releaseCleanup = resolve; });
    const outputs: string[] = [];
    let cleanupCalls = 0;

    const dependencies = sharedLockDependencies({
      tryLock: () => lockHeld ? false : (lockHeld = true),
      unlock: () => { lockHeld = false; },
      cleanup: async () => {
        cleanupCalls += 1;
        signalStarted();
        await cleanupBlocked;
        return completed;
      },
      output: (value) => outputs.push(value)
    });

    const first = runImportFileCleanup(environment, dependencies);
    await cleanupStarted;
    const second = await runImportFileCleanup(environment, dependencies);
    expect(second).toEqual({ skipped: true, reason: "already_running" });
    releaseCleanup();
    await expect(first).resolves.toEqual(completed);
    expect(cleanupCalls).toBe(1);
    expect(outputs).toContain(JSON.stringify(completed));
    expect(outputs).toContain(JSON.stringify({ skipped: true, reason: "already_running" }));
  });

  it("releases the lock and database when cleanup throws", async () => {
    const failure = new Error("cleanup failed");
    const harness = createHarness(failure);

    await expect(runImportFileCleanup(environment, harness.dependencies)).rejects.toBe(failure);
    expect(harness.output).toEqual([]);
    expect(harness.events).toEqual([
      "connect", "try-lock", "cleanup", "unlock", "release", "end"
    ]);
  });

  it("preserves a cleanup failure if unlocking also fails", async () => {
    const failure = new Error("cleanup failed");
    const harness = createHarness(failure, { unlockFailure: new Error("unlock secret") });

    await expect(runImportFileCleanup(environment, harness.dependencies)).rejects.toBe(failure);
    expect(harness.events).toEqual([
      "connect", "try-lock", "cleanup", "unlock", "release", "end"
    ]);
  });

  it("rejects with a neutral error when only unlocking fails", async () => {
    const harness = createHarness(completed, { unlockFailure: new Error("unlock secret") });

    await expect(runImportFileCleanup(environment, harness.dependencies)).rejects.toThrow(
      "Unable to release import cleanup lock"
    );
    expect(harness.output).toEqual([]);
  });

  it("treats an advisory unlock false result as a neutral failure", async () => {
    const harness = createHarness(completed, { unlockResult: false });

    await expect(runImportFileCleanup(environment, harness.dependencies)).rejects.toThrow(
      "Unable to release import cleanup lock"
    );
    expect(harness.output).toEqual([]);
  });

  it("returns a nonzero exit code for failures or remaining eligible backlog", () => {
    expect(cleanupExitCode(completed)).toBe(0);
    expect(cleanupExitCode({ ...completed, failed: 1 })).toBe(1);
    expect(cleanupExitCode({ ...completed, hasMore: true })).toBe(1);
  });
});

function createHarness(
  cleanupOutcome: ImportFileCleanupRunResult | Error,
  options: { lockAcquired?: boolean; unlockFailure?: Error; unlockResult?: boolean } = {}
) {
  const state = {
    databaseCreated: false,
    output: [] as string[],
    events: [] as string[],
    cleanupCalls: 0
  };
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
    async connect() {
      state.events.push("connect");
      return client;
    },
    async end() { state.events.push("end"); }
  } as unknown as CleanupDatabase;
  const dependencies: CleanupImportFilesDependencies = {
    createDatabase(): CleanupDatabase {
      state.databaseCreated = true;
      return database;
    },
    createObjectStorage() { return missingStorage; },
    async cleanup() {
      state.cleanupCalls += 1;
      state.events.push("cleanup");
      if (cleanupOutcome instanceof Error) throw cleanupOutcome;
      return cleanupOutcome;
    },
    now: () => new Date("2026-11-09T08:00:00.000Z"),
    writeOutput(value: string) {
      state.events.push("output");
      state.output.push(value);
    }
  };
  return Object.assign(state, { dependencies });
}

function sharedLockDependencies(input: {
  tryLock(): boolean;
  unlock(): void;
  cleanup(): Promise<ImportFileCleanupRunResult>;
  output(value: string): void;
}): CleanupImportFilesDependencies {
  return {
    createDatabase: () => ({
      async query() { throw new Error("pool query is not allowed"); },
      async connect() {
        return {
          async query(text: string) {
            if (text.includes("pg_try_advisory_lock")) {
              return { rows: [{ locked: input.tryLock() }], rowCount: 1 };
            }
            if (text.includes("pg_advisory_unlock")) {
              input.unlock();
              return { rows: [{ unlocked: true }], rowCount: 1 };
            }
            throw new Error(`unexpected query: ${text}`);
          },
          release() {}
        };
      },
      async end() {}
    } as unknown as CleanupDatabase),
    createObjectStorage: () => missingStorage,
    cleanup: input.cleanup,
    now: () => new Date("2026-11-09T08:00:00.000Z"),
    writeOutput: input.output
  };
}

const missingStorage: ObjectStorage = {
  async putObject() {},
  async deleteObject() { return "missing"; }
};
