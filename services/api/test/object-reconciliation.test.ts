import { describe, expect, it } from "vitest";
import {
  reconcileImportObjects,
  runImportObjectReconciliation,
  type ImportObjectReconciliationRepository
} from "../src/imports/object-reconciliation.js";
import { NotFoundError, type ImportObjectReconciliationJob } from "../src/imports/repository.js";
import type { ObjectStorage } from "../src/storage/object-storage.js";

const now = new Date("2026-11-09T08:00:00.000Z");

describe("import object reconciliation", () => {
  it.each(["deleted", "missing"] as const)("resolves delete_orphan after an object is %s", async (outcome) => {
    const repository = new QueueRepository([job("orphan", "delete_orphan")]);
    const storage = new Storage(outcome);

    await expect(reconcileImportObjects(repository, storage, now)).resolves.toEqual({
      scanned: 1, resolved: 1, failed: 0
    });
    expect(repository.resolutions).toEqual([["orphan", "object_removed"]]);
  });

  it("keeps an object and resolves persistence_committed when its scoped batch exists", async () => {
    const repository = new QueueRepository([job("committed", "verify_batch_then_delete")]);
    const storage = new Storage("deleted");
    repository.batchExists = true;

    await expect(reconcileImportObjects(repository, storage, now)).resolves.toEqual({
      scanned: 1, resolved: 1, failed: 0
    });
    expect(storage.deletedKeys).toEqual([]);
    expect(repository.batchScopes).toEqual([{ id: "batch_committed", enterpriseId: "ent_demo", storeId: "store_demo" }]);
    expect(repository.resolutions).toEqual([["committed", "persistence_committed"]]);
  });

  it("deletes a verification object only when the expected scoped batch is not found", async () => {
    const repository = new QueueRepository([job("missing", "verify_batch_then_delete")]);
    const storage = new Storage("deleted");
    repository.batchError = new NotFoundError("expected batch missing");

    await reconcileImportObjects(repository, storage, now);

    expect(storage.deletedKeys).toEqual(["imports/missing"]);
    expect(repository.resolutions).toEqual([["missing", "object_removed"]]);
  });

  it("waits for original persistence holding the batch guard, then retains the committed object", async () => {
    const repository = new BlockingQueueRepository([job("racing", "verify_batch_then_delete")]);
    const storage = new Storage("deleted");
    const commitPersistence = repository.holdOriginalPersistence();

    const reconciliation = reconcileImportObjects(repository, storage, now);
    await repository.waitForRunnerAtGuard();
    expect(storage.deletedKeys).toEqual([]);

    repository.batchExists = true;
    commitPersistence();

    await expect(reconciliation).resolves.toEqual({ scanned: 1, resolved: 1, failed: 0 });
    expect(storage.deletedKeys).toEqual([]);
    expect(repository.resolutions).toEqual([["racing", "persistence_committed"]]);
  });

  it("deletes after the runner obtains an uncontended batch guard and confirms the batch is absent", async () => {
    const repository = new BlockingQueueRepository([job("guarded_missing", "verify_batch_then_delete")]);
    const storage = new Storage("deleted");

    await expect(reconcileImportObjects(repository, storage, now)).resolves.toEqual({
      scanned: 1, resolved: 1, failed: 0
    });
    expect(storage.deletedKeys).toEqual(["imports/guarded_missing"]);
  });

  it.each([
    ["database", new Error("database down")],
    ["storage", new Error("storage down")]
  ] as const)("records a retry for a %s error without deleting", async (kind, error) => {
    const repository = new QueueRepository([job(kind, "verify_batch_then_delete")]);
    const storage = new Storage("deleted");
    if (kind === "database") repository.batchError = error;
    else storage.deleteError = error;
    if (kind === "storage") repository.batchError = new NotFoundError("missing");

    await expect(reconcileImportObjects(repository, storage, now)).resolves.toEqual({
      scanned: 1, resolved: 0, failed: 1
    });
    expect(repository.failures).toHaveLength(1);
    expect(repository.resolutions).toEqual([]);
    expect(storage.deletedKeys).toEqual(kind === "storage" ? ["imports/storage"] : []);
  });

  it("uses bounded pages, only reports eligible backlog, and counts grace-delayed jobs separately", async () => {
    const repository = new QueueRepository([
      job("a", "delete_orphan"), job("b", "delete_orphan"), job("c", "delete_orphan")
    ]);
    repository.deferred = 2;

    await expect(runImportObjectReconciliation(repository, new Storage("missing"), now, {
      pageSize: 1, maxPasses: 2
    })).resolves.toEqual({
      scanned: 2, resolved: 2, failed: 0, deferred: 2, passes: 2, hasMore: true, guardsPruned: 0
    });
    expect(repository.requestedLimits).toEqual([1, 1, 1]);
  });

  it("does not report grace-delayed jobs as eligible backlog", async () => {
    const repository = new QueueRepository([job("only", "delete_orphan")]);
    repository.deferred = 1;

    await expect(runImportObjectReconciliation(repository, new Storage("missing"), now, {
      pageSize: 1, maxPasses: 1
    })).resolves.toMatchObject({ scanned: 1, deferred: 1, hasMore: false });
  });

  it.each([0, 1001, 1.5, Number.NaN])("rejects unsafe page sizes: %s", async (pageSize) => {
    await expect(runImportObjectReconciliation(new QueueRepository([]), new Storage("missing"), now, { pageSize }))
      .rejects.toThrow("Reconciliation page size");
  });

  it.each([0, 101, 1.5, Number.NaN])("rejects unsafe pass limits: %s", async (maxPasses) => {
    await expect(runImportObjectReconciliation(new QueueRepository([]), new Storage("missing"), now, { maxPasses }))
      .rejects.toThrow("Reconciliation pass limit");
  });
});

class QueueRepository implements ImportObjectReconciliationRepository {
  readonly requestedLimits: number[] = [];
  readonly resolutions: Array<[string, "object_removed" | "persistence_committed"]> = [];
  readonly failures: Array<[string, string | null, string | null]> = [];
  readonly batchScopes: Array<{ id: string; enterpriseId: string; storeId: string }> = [];
  batchExists = false;
  batchError: Error | null = null;
  deferred = 0;
  guardsPruned = 0;

  constructor(private readonly jobs: ImportObjectReconciliationJob[]) {}

  async listEligibleImportObjectReconciliationJobs(_now: Date, limit: number) {
    this.requestedLimits.push(limit);
    return this.jobs.filter((item) => item.state === "pending").slice(0, limit);
  }

  async countDeferredImportObjectReconciliationJobs() { return this.deferred; }
  async pruneImportBatchReconciliationGuards() { return this.guardsPruned; }

  async withImportBatchReconciliationGuard<T>(
    _batchId: string,
    work: (guarded: ImportObjectReconciliationRepository) => Promise<T>
  ): Promise<T> {
    return work(this);
  }

  async getBatch(scope: { id: string; enterpriseId: string; storeId: string }) {
    this.batchScopes.push(scope);
    if (this.batchError) throw this.batchError;
    if (!this.batchExists) throw new NotFoundError("missing");
    return {};
  }

  async resolveImportObjectReconciliationJob(id: string, _at: Date, resolution: "object_removed" | "persistence_committed") {
    const target = this.jobs.find((item) => item.id === id);
    if (!target || target.state !== "pending") return false;
    target.state = "resolved";
    this.resolutions.push([id, resolution]);
    return true;
  }

  async recordImportObjectReconciliationFailure(id: string, _at: Date, type: string | null, code: string | null) {
    this.failures.push([id, type, code]);
    return true;
  }
}

class BlockingQueueRepository extends QueueRepository {
  private releaseOriginal: (() => void) | null = null;
  private readonly originalFinished = new Promise<void>((resolve) => { this.releaseOriginal = resolve; });
  private signalRunner: (() => void) | null = null;
  private readonly runnerAtGuard = new Promise<void>((resolve) => { this.signalRunner = resolve; });
  private originalIsHolding = false;

  holdOriginalPersistence(): () => void {
    this.originalIsHolding = true;
    return () => {
      this.originalIsHolding = false;
      this.releaseOriginal?.();
    };
  }

  async waitForRunnerAtGuard(): Promise<void> { await this.runnerAtGuard; }

  override async withImportBatchReconciliationGuard<T>(
    batchId: string,
    work: (guarded: ImportObjectReconciliationRepository) => Promise<T>
  ): Promise<T> {
    if (this.originalIsHolding) {
      this.signalRunner?.();
      await this.originalFinished;
    }
    return super.withImportBatchReconciliationGuard(batchId, work);
  }
}

class Storage implements ObjectStorage {
  readonly deletedKeys: string[] = [];
  deleteError: Error | null = null;

  constructor(private readonly outcome: "deleted" | "missing") {}
  async putObject() {}
  async deleteObject(key: string) {
    this.deletedKeys.push(key);
    if (this.deleteError) throw this.deleteError;
    return this.outcome;
  }
}

function job(id: string, kind: "delete_orphan" | "verify_batch_then_delete"): ImportObjectReconciliationJob {
  return {
    id, enterpriseId: "ent_demo", storeId: "store_demo", batchId: `batch_${id}`,
    sha256Checksum: id.padEnd(64, "0"), objectKey: `imports/${id}`, kind,
    notBefore: now, state: "pending", attemptedAt: null, failureCount: 0,
    resolvedAt: null, resolution: null, lastErrorType: null, lastErrorCode: null,
    createdAt: now, updatedAt: now
  };
}
