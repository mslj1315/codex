import { describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import {
  runImportFileCleanup,
  type CleanupImportFilesDependencies,
  type CleanupDatabase
} from "../src/cleanup-import-files.js";
import type { ImportFileCleanupResult } from "../src/imports/file-cleanup.js";
import type { ObjectStorage } from "../src/storage/object-storage.js";

const environment = {
  DATABASE_URL: "postgresql://user:private-password@postgres:5432/imports",
  MINIO_ENDPOINT: "http://minio:9000",
  MINIO_ACCESS_KEY: "access",
  MINIO_SECRET_KEY: "private-secret",
  MINIO_BUCKET: "restaurant-imports"
};

describe("import file cleanup CLI", () => {
  it("requires a non-empty database URL before creating resources", async () => {
    const harness = createHarness({ scanned: 0, cleaned: 0, failed: 0 });

    await expect(runImportFileCleanup({ ...environment, DATABASE_URL: "  " }, harness.dependencies))
      .rejects.toThrow("DATABASE_URL is required");
    expect(harness.databaseCreated).toBe(false);
  });

  it.each(["MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "MINIO_BUCKET"] as const)(
    "requires non-empty %s",
    async (key) => {
      const harness = createHarness({ scanned: 0, cleaned: 0, failed: 0 });
      await expect(runImportFileCleanup({ ...environment, [key]: " " }, harness.dependencies))
        .rejects.toThrow(`Missing MinIO configuration: ${key}`);
      expect(harness.databaseCreated).toBe(false);
    }
  );

  it("prints one JSON result and closes the database", async () => {
    const result = { scanned: 3, cleaned: 2, failed: 1 };
    const harness = createHarness(result);

    await expect(runImportFileCleanup(environment, harness.dependencies)).resolves.toEqual(result);
    expect(harness.output).toEqual([JSON.stringify(result)]);
    expect(harness.closed).toBe(true);
  });

  it("closes the database when cleanup throws", async () => {
    const failure = new Error("cleanup failed");
    const harness = createHarness(failure);

    await expect(runImportFileCleanup(environment, harness.dependencies)).rejects.toBe(failure);
    expect(harness.output).toEqual([]);
    expect(harness.closed).toBe(true);
  });
});

function createHarness(cleanupOutcome: ImportFileCleanupResult | Error) {
  const state = {
    closed: false,
    databaseCreated: false,
    output: [] as string[]
  };
  const database = {
    async query() { throw new Error("query should be delegated through cleanup"); },
    async connect() { throw new Error("connect should be delegated through cleanup"); },
    async end() { state.closed = true; }
  } as unknown as CleanupDatabase;
  const storage: ObjectStorage = {
    async putObject() {},
    async deleteObject() { return "missing"; }
  };
  const dependencies: CleanupImportFilesDependencies = {
    createDatabase(_databaseUrl: string): CleanupDatabase {
      state.databaseCreated = true;
      return database;
    },
    createObjectStorage() { return storage; },
    async cleanup(_imports, actualStorage, _now, limit) {
      expect(actualStorage).toBe(storage);
      expect(limit).toBe(100);
      if (cleanupOutcome instanceof Error) throw cleanupOutcome;
      return cleanupOutcome;
    },
    now: () => new Date("2026-11-09T08:00:00.000Z"),
    writeOutput(value: string) { state.output.push(value); }
  };
  return Object.assign(state, { dependencies });
}
