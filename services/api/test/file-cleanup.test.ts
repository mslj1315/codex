import { readdir, readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import {
  cleanupExpiredImportFiles,
  IMPORT_FILE_CLEANUP_RETRY_DELAY_MS
} from "../src/imports/file-cleanup.js";
import {
  ImportRepository,
  ValidationError,
  type ImportFileRecord
} from "../src/imports/repository.js";
import { FakeObjectStorage } from "./support/fake-object-storage.js";

const now = new Date("2026-11-09T08:00:00.000Z");

describe("expired import file cleanup", () => {
  let database: Database;
  let imports: ImportRepository;
  let storage: FakeObjectStorage;

  beforeEach(async () => {
    const memory = newDb();
    memory.public.registerFunction({
      name: "length",
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (value: string) => value.length
    });
    const { Pool } = memory.adapters.createPg();
    database = new Pool();
    await applyTestMigrations(database);
    imports = new ImportRepository(database);
    storage = new FakeObjectStorage();
  });

  it("does not scan a file before expiry and scans one expiring exactly now", async () => {
    await createFile(imports, storage, "future", new Date(now.getTime() + 1));
    await createFile(imports, storage, "boundary", now);

    await expect(imports.listExpiredImportFiles(now)).resolves.toMatchObject([
      { id: "file_boundary", expiresAt: now }
    ]);
    await expect(cleanupExpiredImportFiles(imports, storage, now)).resolves.toEqual({
      scanned: 1,
      cleaned: 1,
      failed: 0
    });
    expect(storage.objects.has(objectKey("future"))).toBe(true);
  });

  it("deletes an expired object but preserves its batch, candidates, facts, and checksum identity", async () => {
    const file = await createFile(imports, storage, "confirmed", new Date(now.getTime() - 1));
    const candidate = await imports.createCandidate({
      batchId: file.batchId,
      enterpriseId: file.enterpriseId,
      storeId: file.storeId,
      metricKey: "orders",
      metricDisplayName: "Orders",
      value: 12,
      unit: "count",
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-07",
      sourceLocator: "row:1:orders",
      confidence: 100,
      status: "ready"
    });
    const facts = await imports.confirmBatch({
      batchId: file.batchId,
      enterpriseId: file.enterpriseId,
      storeId: file.storeId,
      actorId: "actor_demo",
      candidateIds: [candidate.id]
    });

    await expect(cleanupExpiredImportFiles(imports, storage, now)).resolves.toEqual({
      scanned: 1,
      cleaned: 1,
      failed: 0
    });

    expect(storage.objects.has(file.objectKey)).toBe(false);
    expect(await database.query("SELECT cleaned_at FROM import_files WHERE id = $1", [file.id]))
      .toMatchObject({ rowCount: 1, rows: [{ cleaned_at: now }] });
    expect(await imports.getBatch({ id: file.batchId, enterpriseId: file.enterpriseId, storeId: file.storeId }))
      .toMatchObject({ id: file.batchId, status: "confirmed", candidates: [{ id: candidate.id }] });
    expect(await imports.getFactVersion({ id: facts.id, enterpriseId: file.enterpriseId, storeId: file.storeId }))
      .toMatchObject({ id: facts.id, values: [{ sourceBatchId: file.batchId }] });
    expect(await imports.findBatchByFileChecksum({
      enterpriseId: file.enterpriseId,
      storeId: file.storeId,
      sha256Checksum: file.sha256Checksum
    })).toMatchObject({ id: file.batchId });
  });

  it("marks an already missing object and does not scan it again", async () => {
    const file = await createFile(imports, storage, "missing", new Date(now.getTime() - 1));
    storage.objects.delete(file.objectKey);

    await expect(cleanupExpiredImportFiles(imports, storage, now)).resolves.toEqual({
      scanned: 1,
      cleaned: 1,
      failed: 0
    });
    await expect(cleanupExpiredImportFiles(imports, storage, now)).resolves.toEqual({
      scanned: 0,
      cleaned: 0,
      failed: 0
    });
  });

  it("continues after a delete failure and leaves the failed file retryable", async () => {
    const failed = await createFile(imports, storage, "a_failed", new Date(now.getTime() - 2));
    const succeeded = await createFile(imports, storage, "b_succeeded", new Date(now.getTime() - 1));
    storage.deleteFailures.add(failed.objectKey);

    await expect(cleanupExpiredImportFiles(imports, storage, now)).resolves.toEqual({
      scanned: 2,
      cleaned: 1,
      failed: 1
    });
    expect(storage.objects.has(failed.objectKey)).toBe(true);
    expect(storage.objects.has(succeeded.objectKey)).toBe(false);
    expect(await cleanedAt(database, failed.id)).toBeNull();
    expect(await cleanedAt(database, succeeded.id)).toEqual(now);
    expect(await cleanupState(database, failed.id)).toMatchObject({
      cleanup_attempted_at: now,
      cleanup_failure_count: 1
    });
  });

  it("backs off a permanently failing oldest file so an unattempted file is not starved", async () => {
    const failed = await createFile(imports, storage, "a_poison", new Date(now.getTime() - 20));
    const pending = await createFile(imports, storage, "z_pending", new Date(now.getTime() - 10));
    storage.deleteFailures.add(failed.objectKey);

    await expect(cleanupExpiredImportFiles(imports, storage, now, 1)).resolves.toEqual({
      scanned: 1, cleaned: 0, failed: 1
    });
    await expect(cleanupExpiredImportFiles(imports, storage, now, 1)).resolves.toEqual({
      scanned: 1, cleaned: 1, failed: 0
    });
    expect(storage.objects.has(pending.objectKey)).toBe(false);

    await expect(imports.listExpiredImportFiles(
      new Date(now.getTime() + IMPORT_FILE_CLEANUP_RETRY_DELAY_MS - 1)
    )).resolves.toEqual([]);
    const retryAt = new Date(now.getTime() + IMPORT_FILE_CLEANUP_RETRY_DELAY_MS);
    await expect(imports.listExpiredImportFiles(retryAt)).resolves.toMatchObject([{ id: failed.id }]);
    await expect(cleanupExpiredImportFiles(imports, storage, retryAt, 1)).resolves.toEqual({
      scanned: 1, cleaned: 0, failed: 1
    });
    expect(await cleanupState(database, failed.id)).toMatchObject({
      cleanup_attempted_at: retryAt,
      cleanup_failure_count: 2
    });
  });

  it("retries after deletion succeeds but marking fails", async () => {
    const file = await createFile(imports, storage, "mark_retry", new Date(now.getTime() - 1));
    const failingRepository = new MarkFailingRepository(database, file.id);

    await expect(cleanupExpiredImportFiles(failingRepository, storage, now)).resolves.toEqual({
      scanned: 1,
      cleaned: 0,
      failed: 1
    });
    expect(storage.objects.has(file.objectKey)).toBe(false);
    expect(await cleanedAt(database, file.id)).toBeNull();

    const retryAt = new Date(now.getTime() + IMPORT_FILE_CLEANUP_RETRY_DELAY_MS);
    await expect(cleanupExpiredImportFiles(
      imports,
      storage,
      retryAt
    )).resolves.toEqual({
      scanned: 1,
      cleaned: 1,
      failed: 0
    });
    expect(await cleanedAt(database, file.id)).toEqual(retryAt);
    expect(await cleanupState(database, file.id)).toMatchObject({
      cleanup_attempted_at: now,
      cleanup_failure_count: 1
    });
  });

  it("orders by expiry and id and processes no more than the limit", async () => {
    const sameExpiry = new Date(now.getTime() - 10);
    await createFile(imports, storage, "c", sameExpiry);
    await createFile(imports, storage, "b", sameExpiry);
    await createFile(imports, storage, "oldest", new Date(now.getTime() - 20));

    await expect(imports.listExpiredImportFiles(now, 2)).resolves.toMatchObject([
      { id: "file_oldest" },
      { id: "file_b" }
    ]);
    await expect(cleanupExpiredImportFiles(imports, storage, now, 2)).resolves.toEqual({
      scanned: 2,
      cleaned: 2,
      failed: 0
    });
    expect(storage.objects.has(objectKey("c"))).toBe(true);
  });

  it.each([0, -1, 1.5, 1001, Number.NaN])("rejects an unsafe cleanup limit: %s", async (limit) => {
    await expect(imports.listExpiredImportFiles(now, limit)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects invalid cleanup timestamps", async () => {
    const invalid = new Date(Number.NaN);
    await expect(imports.listExpiredImportFiles(invalid)).rejects.toBeInstanceOf(ValidationError);
    await expect(imports.markImportFileCleaned("file", invalid)).rejects.toBeInstanceOf(ValidationError);
    await expect(imports.recordImportFileCleanupFailure("file", invalid)).rejects.toBeInstanceOf(ValidationError);
  });

  it("maps timestamps and marks metadata idempotently without replacing the first cleanup time", async () => {
    const file = await createFile(imports, storage, "idempotent", new Date(now.getTime() - 1));
    const first = new Date("2026-11-09T08:01:00.000Z");
    const second = new Date("2026-11-09T08:02:00.000Z");

    const [mapped] = await imports.listExpiredImportFiles(now);
    expect(mapped.uploadedAt).toBeInstanceOf(Date);
    expect(mapped.expiresAt).toEqual(file.expiresAt);
    expect(mapped.cleanedAt).toBeNull();

    await database.query("UPDATE import_files SET updated_at = $1 WHERE id = $2", [
      new Date("2026-01-01T00:00:00.000Z"),
      file.id
    ]);
    expect(await imports.markImportFileCleaned(file.id, first)).toBe(true);
    const firstState = await cleanupState(database, file.id);
    expect(await imports.markImportFileCleaned(file.id, second)).toBe(false);
    const repeatedState = await cleanupState(database, file.id);
    expect(await cleanedAt(database, file.id)).toEqual(first);
    expect(repeatedState.updated_at).toEqual(firstState.updated_at);
  });
});

class MarkFailingRepository extends ImportRepository {
  private failed = false;

  constructor(database: Database, private readonly targetId: string) {
    super(database);
  }

  override async markImportFileCleaned(id: string, cleanedAt: Date): Promise<boolean> {
    if (id === this.targetId && !this.failed) {
      this.failed = true;
      throw new Error("database mark failed");
    }
    return super.markImportFileCleaned(id, cleanedAt);
  }
}

async function createFile(
  imports: ImportRepository,
  storage: FakeObjectStorage,
  suffix: string,
  expiresAt: Date
): Promise<ImportFileRecord> {
  const batchId = `batch_${suffix}`;
  await imports.createBatch({
    id: batchId,
    enterpriseId: "ent_demo",
    storeId: `store_${suffix}`,
    actorId: "actor_demo",
    sourceType: "csv"
  });
  const bytes = Buffer.from(`orders\n${suffix.length}\n`);
  const key = objectKey(suffix);
  await storage.putObject({ key, bytes, contentType: "text/csv" });
  return imports.createImportFile({
    id: `file_${suffix}`,
    batchId,
    enterpriseId: "ent_demo",
    storeId: `store_${suffix}`,
    originalFileName: `${suffix}.csv`,
    normalizedMimeType: "text/csv",
    byteCount: bytes.length,
    sha256Checksum: suffix.padEnd(64, "0").slice(0, 64),
    objectKey: key,
    uploadedAt: new Date("2026-08-11T08:00:00.000Z"),
    expiresAt
  });
}

function objectKey(suffix: string): string {
  return `imports/ent_demo/store_${suffix}/batch_${suffix}/${suffix}.csv`;
}

async function cleanedAt(database: Database, id: string): Promise<Date | null> {
  const result = await database.query<{ cleaned_at: Date | null }>(
    "SELECT cleaned_at FROM import_files WHERE id = $1",
    [id]
  );
  return result.rows[0].cleaned_at;
}

async function cleanupState(database: Database, id: string): Promise<{
  cleaned_at: Date | null;
  cleanup_attempted_at: Date | null;
  cleanup_failure_count: number;
  updated_at: Date;
}> {
  const result = await database.query<{
    cleaned_at: Date | null;
    cleanup_attempted_at: Date | null;
    cleanup_failure_count: number;
    updated_at: Date;
  }>(
    `SELECT cleaned_at, cleanup_attempted_at, cleanup_failure_count, updated_at
     FROM import_files WHERE id = $1`,
    [id]
  );
  return result.rows[0];
}

async function applyTestMigrations(database: Database): Promise<void> {
  const migrationsUrl = new URL("../migrations/", import.meta.url);
  const fileNames = (await readdir(migrationsUrl))
    .filter((fileName) => /^\d+.*\.sql$/.test(fileName))
    .sort();
  for (const fileName of fileNames) {
    const migration = await readFile(new URL(fileName, migrationsUrl), "utf8");
    await database.query(migration.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
  }
}
