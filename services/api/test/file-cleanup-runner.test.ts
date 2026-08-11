import { describe, expect, it } from "vitest";
import {
  runExpiredImportFileCleanup,
  type ImportFileCleanupRepository
} from "../src/imports/file-cleanup.js";
import type { ImportFileRecord } from "../src/imports/repository.js";
import type { ObjectStorage } from "../src/storage/object-storage.js";

const now = new Date("2026-11-09T08:00:00.000Z");

describe("bounded import file cleanup runner", () => {
  it("cleans more than one page in a single run", async () => {
    const repository = new QueueRepository(150);

    await expect(runExpiredImportFileCleanup(repository, missingStorage, now, {
      pageSize: 100,
      maxPasses: 10
    })).resolves.toEqual({
      scanned: 150,
      cleaned: 150,
      failed: 0,
      passes: 2,
      hasMore: false
    });
    expect(repository.requestedLimits).toEqual([100, 100]);
  });

  it("stays page-bounded and reports eligible backlog after exhausting its pass budget", async () => {
    const repository = new QueueRepository(1001);

    await expect(runExpiredImportFileCleanup(repository, missingStorage, now, {
      pageSize: 100,
      maxPasses: 10
    })).resolves.toEqual({
      scanned: 1000,
      cleaned: 1000,
      failed: 0,
      passes: 10,
      hasMore: true
    });
    expect(repository.requestedLimits).toEqual([...Array(10).fill(100), 1]);
    expect(Math.max(...repository.requestedLimits)).toBe(100);
  });

  it("does not infer backlog merely because the last full page was scanned", async () => {
    const repository = new QueueRepository(1000);

    await expect(runExpiredImportFileCleanup(repository, missingStorage, now, {
      pageSize: 100,
      maxPasses: 10
    })).resolves.toMatchObject({ scanned: 1000, hasMore: false });
    expect(repository.requestedLimits.at(-1)).toBe(1);
  });
});

class QueueRepository implements ImportFileCleanupRepository {
  readonly requestedLimits: number[] = [];
  private readonly files: ImportFileRecord[];

  constructor(count: number) {
    this.files = Array.from({ length: count }, (_, index) => importFile(index));
  }

  async listExpiredImportFiles(_now: Date, limit: number): Promise<ImportFileRecord[]> {
    this.requestedLimits.push(limit);
    return this.files.filter((file) => file.cleanedAt === null).slice(0, limit);
  }

  async markImportFileCleaned(id: string, cleanedAt: Date): Promise<boolean> {
    const file = this.files.find((candidate) => candidate.id === id);
    if (!file || file.cleanedAt !== null) return false;
    file.cleanedAt = cleanedAt;
    return true;
  }

  async recordImportFileCleanupFailure(): Promise<boolean> {
    return true;
  }
}

const missingStorage: ObjectStorage = {
  async putObject() {},
  async deleteObject() { return "missing"; }
};

function importFile(index: number): ImportFileRecord {
  const id = `file_${index.toString().padStart(4, "0")}`;
  return {
    id,
    batchId: `batch_${id}`,
    enterpriseId: "ent_demo",
    storeId: "store_demo",
    originalFileName: `${id}.csv`,
    normalizedMimeType: "text/csv",
    byteCount: 1,
    sha256Checksum: index.toString(16).padStart(64, "0"),
    objectKey: `imports/ent_demo/store_demo/${id}.csv`,
    uploadedAt: new Date("2026-08-11T08:00:00.000Z"),
    expiresAt: new Date("2026-11-01T08:00:00.000Z"),
    cleanedAt: null,
    cleanupAttemptedAt: null,
    cleanupFailureCount: 0
  };
}
