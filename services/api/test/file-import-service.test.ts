import { describe, expect, it } from "vitest";
import { ImportService, type ImportServiceLogger } from "../src/imports/service.js";
import {
  DuplicateImportFileError,
  type ImportBatchDetails,
  NotFoundError,
  type ImportRepository
} from "../src/imports/repository.js";
import type { ObjectStorage, StoredObjectInput } from "../src/storage/object-storage.js";
import { ObjectStorageError } from "../src/storage/object-storage.js";

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
  it("deletes a possibly stored object when putObject saves bytes and then fails", async () => {
    const repository = new FailingRepository([null], new Error("must not persist"));
    const storage = new RecordingStorage();
    const putFailure = Object.assign(new Error("put timeout secret"), { code: "ETIMEDOUT" });
    storage.putFailureAfterStore = putFailure;
    const service = createService(repository, storage);

    await expect(service.createFile(context, fileInput)).rejects.toMatchObject({
      name: "ObjectStorageError",
      message: "Unable to store import file",
      cause: putFailure
    });
    expect(storage.objects.size).toBe(0);
    expect(storage.deletedKeys).toHaveLength(1);
  });

  it("keeps the put error when uncertain-object cleanup fails and logs only stable diagnostics", async () => {
    const repository = new FailingRepository([null], new Error("must not persist"));
    const storage = new RecordingStorage();
    const putFailure = Object.assign(new Error("put timeout secret"), { code: "ETIMEDOUT" });
    storage.putFailureAfterStore = putFailure;
    storage.deleteFailure = Object.assign(new Error("delete credential secret"), { code: "AccessDenied" });
    const logs: unknown[] = [];
    const service = createService(repository, storage, { error: (entry) => logs.push(entry) });

    const failure = await service.createFile(context, fileInput).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ObjectStorageError);
    expect((failure as ObjectStorageError).cause).toBe(putFailure);
    expect(logs).toEqual([expect.objectContaining({
      event: "import_object_put_recovery_failed",
      cause: { type: "Error", code: "AccessDenied" }
    })]);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain("timeout secret");
    expect(serialized).not.toContain("credential secret");
  });

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

  it("encodes untrusted tenant and store IDs as single safe object-key segments", async () => {
    const unusualContext = {
      enterpriseId: "ent/../企业\u0000",
      storeId: "../store/门店\u0001",
      actorId: "actor"
    };
    const repository = new FailingRepository([null], new Error("must not persist"));
    const storage = new RecordingStorage();
    storage.putFailureAfterStore = new Error("stop after key capture");
    const service = createService(repository, storage);

    await expect(service.createFile(unusualContext, fileInput)).rejects.toBeInstanceOf(ObjectStorageError);
    const key = storage.deletedKeys[0];
    expect(key.split("/")).toHaveLength(5);
    expect(key).not.toContain("..");
    expect(key).not.toContain("企业");
    expect(key).not.toContain("门店");
    expect(key).not.toMatch(/[\u0000-\u001f]/);
    expect(repository.lastChecksumScope).toMatchObject({
      enterpriseId: unusualContext.enterpriseId,
      storeId: unusualContext.storeId
    });
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

  it("keeps the object and returns the committed batch when persistence response was lost", async () => {
    const failure = new Error("commit response timeout private-marker");
    const repository = new FailingRepository([null], failure, (id) => batchDetails(id));
    const storage = new RecordingStorage();
    const logs: unknown[] = [];
    const service = createService(repository, storage, { error: (entry) => logs.push(entry) });

    const result = await service.createFile(context, fileInput);
    expect(result).toMatchObject({ batch: { id: expect.any(String) }, duplicate: false });
    expect(storage.objects.size).toBe(1);
    expect(storage.deletedKeys).toHaveLength(0);
    expect(logs).toEqual([expect.objectContaining({
      event: "import_persistence_recovered",
      batchId: result.batch.id,
      objectKey: expect.stringMatching(/^imports\/ent_demo\/store_demo\//)
    })]);
    expect(JSON.stringify(logs)).not.toContain("private-marker");
  });

  it("does not delete the object when persistence reconciliation is inconclusive", async () => {
    const failure = new Error("commit response timeout private-marker");
    const lookupFailure = Object.assign(new Error("database lookup credential"), { code: "ETIMEDOUT" });
    const repository = new FailingRepository([null], failure, lookupFailure);
    const storage = new RecordingStorage();
    const logs: unknown[] = [];
    const service = createService(repository, storage, { error: (entry) => logs.push(entry) });

    await expect(service.createFile(context, fileInput)).rejects.toBe(failure);
    expect(storage.objects.size).toBe(1);
    expect(storage.deletedKeys).toHaveLength(0);
    expect(logs).toEqual([expect.objectContaining({
      event: "import_object_reconciliation_required",
      cause: { type: "Error", code: "ETIMEDOUT" }
    })]);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain("private-marker");
    expect(serialized).not.toContain("credential");
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

  it("propagates duplicate winner reload failures after deleting the losing object", async () => {
    const conflict = new DuplicateImportFileError("duplicate conflict marker");
    const reloadFailure = Object.assign(new Error("winner reload unavailable"), { code: "ETIMEDOUT" });
    const repository = new FailingRepository([null, reloadFailure], conflict);
    const storage = new RecordingStorage();
    const service = createService(repository, storage);

    await expect(service.createFile(context, fileInput)).rejects.toBe(reloadFailure);
    expect(storage.objects.size).toBe(0);
    expect(storage.deletedKeys).toHaveLength(1);
  });
});

class FailingRepository {
  lookupCalls = 0;
  lastChecksumScope: { enterpriseId: string; storeId: string } | undefined;

  constructor(
    private readonly lookups: (ImportBatchDetails | Error | null)[],
    private readonly createFailure: unknown,
    private readonly batchLookup: ImportBatchDetails | Error | ((id: string) => ImportBatchDetails) = new NotFoundError("Import batch not found")
  ) {}

  async findBatchByFileChecksum(input?: { enterpriseId: string; storeId: string }): Promise<ImportBatchDetails | null> {
    this.lookupCalls += 1;
    this.lastChecksumScope = input;
    const lookup = this.lookups.shift() ?? null;
    if (lookup instanceof Error) throw lookup;
    return lookup;
  }

  async createBatchWithCandidates(): Promise<never> {
    throw this.createFailure;
  }

  async getBatch(input: { id: string }): Promise<ImportBatchDetails> {
    if (this.batchLookup instanceof Error) throw this.batchLookup;
    return typeof this.batchLookup === "function" ? this.batchLookup(input.id) : this.batchLookup;
  }
}

class RecordingStorage implements ObjectStorage {
  readonly objects = new Map<string, StoredObjectInput>();
  readonly deletedKeys: string[] = [];
  deleteFailure: unknown;
  putFailureAfterStore: unknown;

  async putObject(input: StoredObjectInput): Promise<void> {
    this.objects.set(input.key, { ...input, bytes: Buffer.from(input.bytes) });
    if (this.putFailureAfterStore) throw this.putFailureAfterStore;
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
