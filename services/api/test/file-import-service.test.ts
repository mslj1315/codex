import { describe, expect, it } from "vitest";
import { ImportService, type ImportServiceLogger } from "../src/imports/service.js";
import {
  DuplicateImportFileError,
  type ImportBatchDetails,
  type ImportRepository
} from "../src/imports/repository.js";
import type { ObjectStorage, StoredObjectInput } from "../src/storage/object-storage.js";

const context = { enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo" };
const now = new Date("2026-08-11T03:04:05.000Z");
const fileInput = {
  bytes: Buffer.from("订单数\n12\n"),
  filename: "weekly.csv",
  mimeType: "text/csv",
  rangeStart: "2026-08-01",
  rangeEnd: "2026-08-07"
};

describe("ImportService file persistence compensation", () => {
  it("rejects empty file bytes before duplicate lookup or storage", async () => {
    const repository = new FailingRepository([null], new Error("must not persist"));
    const storage = new RecordingStorage();
    const service = createService(repository, storage);

    await expect(service.createFile(context, { ...fileInput, bytes: Buffer.alloc(0) })).rejects.toMatchObject({
      message: "File bytes are required"
    });
    expect(repository.lookupCalls).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  it("deletes the uploaded object and rethrows the original database error", async () => {
    const failure = new Error("database unavailable");
    const repository = new FailingRepository([null], failure);
    const storage = new RecordingStorage();
    const service = createService(repository, storage);

    await expect(service.createFile(context, fileInput)).rejects.toBe(failure);
    expect(storage.objects.size).toBe(0);
    expect(storage.deletedKeys).toHaveLength(1);
  });

  it("preserves the original database error when compensation deletion fails", async () => {
    const failure = new Error("database unavailable private-marker");
    const repository = new FailingRepository([null], failure);
    const storage = new RecordingStorage();
    storage.deleteFailure = Object.assign(new Error("delete secret-marker"), { code: "AccessDenied" });
    const logs: unknown[] = [];
    const service = createService(repository, storage, { error: (entry) => logs.push(entry) });

    await expect(service.createFile(context, fileInput)).rejects.toBe(failure);
    expect(storage.objects.size).toBe(1);
    expect(logs).toEqual([expect.objectContaining({
      event: "import_object_compensation_failed",
      objectKey: expect.stringMatching(/^imports\/ent_demo\/store_demo\//),
      cause: { type: "Error", code: "AccessDenied" }
    })]);
    expect(JSON.stringify(logs)).not.toContain("private-marker");
    expect(JSON.stringify(logs)).not.toContain("secret-marker");
  });

  it("preserves the original database error when compensation logging also fails", async () => {
    const failure = new Error("database unavailable");
    const repository = new FailingRepository([null], failure);
    const storage = new RecordingStorage();
    storage.deleteFailure = new Error("delete failed");
    const service = createService(repository, storage, {
      error() { throw new Error("logger failed"); }
    });

    await expect(service.createFile(context, fileInput)).rejects.toBe(failure);
  });

  it("wraps a non-Error persistence failure without replacing its cause", async () => {
    const repository = new FailingRepository([null], "database rejection");
    const storage = new RecordingStorage();
    const service = createService(repository, storage);

    await expect(service.createFile(context, fileInput)).rejects.toMatchObject({
      message: "Import persistence failed",
      cause: "database rejection"
    });
    expect(storage.objects.size).toBe(0);
  });

  it("deletes the losing object and returns the winning batch after a duplicate race", async () => {
    const winner = batchDetails("winner-batch");
    const conflict = new DuplicateImportFileError("duplicate");
    const repository = new FailingRepository([null, winner], conflict);
    const storage = new RecordingStorage();
    const service = createService(repository, storage);

    await expect(service.createFile(context, fileInput)).resolves.toEqual({ batch: winner, duplicate: true });
    expect(storage.objects.size).toBe(0);
    expect(storage.deletedKeys).toHaveLength(1);
  });

  it("still returns the winning duplicate when losing-object deletion fails", async () => {
    const winner = batchDetails("winner-batch");
    const repository = new FailingRepository([null, winner], new DuplicateImportFileError("duplicate"));
    const storage = new RecordingStorage();
    storage.deleteFailure = new Error("delete secret-marker");
    const logs: unknown[] = [];
    const service = createService(repository, storage, { error: (entry) => logs.push(entry) });

    await expect(service.createFile(context, fileInput)).resolves.toEqual({ batch: winner, duplicate: true });
    expect(logs).toEqual([expect.objectContaining({ event: "import_object_compensation_failed" })]);
    expect(JSON.stringify(logs)).not.toContain("secret-marker");
  });

  it("does not report duplicate success when the winning batch cannot be reloaded", async () => {
    const conflict = new DuplicateImportFileError("duplicate");
    const repository = new FailingRepository([null, null], conflict);
    const storage = new RecordingStorage();
    const service = createService(repository, storage);

    await expect(service.createFile(context, fileInput)).rejects.toBe(conflict);
    expect(storage.objects.size).toBe(0);
    expect(repository.lookupCalls).toBe(2);
  });
});

class FailingRepository {
  lookupCalls = 0;

  constructor(
    private readonly lookups: (ImportBatchDetails | null)[],
    private readonly createFailure: unknown
  ) {}

  async findBatchByFileChecksum(): Promise<ImportBatchDetails | null> {
    this.lookupCalls += 1;
    return this.lookups.shift() ?? null;
  }

  async createBatchWithCandidates(): Promise<never> {
    throw this.createFailure;
  }
}

class RecordingStorage implements ObjectStorage {
  readonly objects = new Map<string, StoredObjectInput>();
  readonly deletedKeys: string[] = [];
  deleteFailure: unknown;

  async putObject(input: StoredObjectInput): Promise<void> {
    this.objects.set(input.key, { ...input, bytes: Buffer.from(input.bytes) });
  }

  async deleteObject(key: string): Promise<"deleted" | "missing"> {
    this.deletedKeys.push(key);
    if (this.deleteFailure) throw this.deleteFailure;
    return this.objects.delete(key) ? "deleted" : "missing";
  }
}

function createService(
  repository: FailingRepository,
  storage: RecordingStorage,
  logger: ImportServiceLogger = { error: (_entry: unknown) => undefined }
) {
  return new ImportService(
    repository as unknown as ImportRepository,
    storage,
    () => now,
    logger
  );
}

function batchDetails(id: string): ImportBatchDetails {
  return {
    id,
    enterpriseId: context.enterpriseId,
    storeId: context.storeId,
    actorId: context.actorId,
    sourceType: "csv",
    status: "pending_confirmation",
    rangeStart: fileInput.rangeStart,
    rangeEnd: fileInput.rangeEnd,
    confirmedByActorId: null,
    confirmedAt: null,
    createdAt: now,
    updatedAt: now,
    candidates: []
  };
}
