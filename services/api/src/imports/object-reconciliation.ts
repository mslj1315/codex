import type { ObjectStorage } from "../storage/object-storage.js";
import {
  NotFoundError,
  ValidationError,
  type FactVersionScope,
  type ImportObjectReconciliationJob,
  type ImportObjectReconciliationResolution
} from "./repository.js";

export interface ImportObjectReconciliationRepository {
  listEligibleImportObjectReconciliationJobs(now: Date, limit?: number): Promise<ImportObjectReconciliationJob[]>;
  countDeferredImportObjectReconciliationJobs(now: Date): Promise<number>;
  withImportBatchReconciliationGuard<T>(
    batchId: string,
    work: (guarded: ImportObjectReconciliationRepository) => Promise<T>
  ): Promise<T>;
  getBatch(scope: FactVersionScope): Promise<unknown>;
  resolveImportObjectReconciliationJob(
    id: string,
    resolvedAt: Date,
    resolution: ImportObjectReconciliationResolution
  ): Promise<boolean>;
  recordImportObjectReconciliationFailure(
    id: string,
    attemptedAt: Date,
    errorType: string | null,
    errorCode: string | null
  ): Promise<boolean>;
  pruneImportBatchReconciliationGuards(now: Date, limit?: number): Promise<number>;
}

export interface ImportObjectReconciliationResult {
  scanned: number;
  resolved: number;
  failed: number;
}

export interface ImportObjectReconciliationRunResult extends ImportObjectReconciliationResult {
  deferred: number;
  passes: number;
  hasMore: boolean;
  guardsPruned: number;
}

export interface ImportObjectReconciliationRunOptions {
  pageSize?: number;
  maxPasses?: number;
}

export const IMPORT_OBJECT_RECONCILIATION_PAGE_SIZE = 100;
export const IMPORT_OBJECT_RECONCILIATION_MAX_PASSES = 10;

export async function reconcileImportObjects(
  repository: ImportObjectReconciliationRepository,
  storage: ObjectStorage,
  now: Date,
  limit = IMPORT_OBJECT_RECONCILIATION_PAGE_SIZE
): Promise<ImportObjectReconciliationResult> {
  const jobs = await repository.listEligibleImportObjectReconciliationJobs(now, limit);
  const result: ImportObjectReconciliationResult = { scanned: jobs.length, resolved: 0, failed: 0 };

  for (const job of jobs) {
    if (await reconcileJob(repository, storage, job, now)) result.resolved += 1;
    else result.failed += 1;
  }
  return result;
}

export async function runImportObjectReconciliation(
  repository: ImportObjectReconciliationRepository,
  storage: ObjectStorage,
  now: Date,
  options: ImportObjectReconciliationRunOptions = {}
): Promise<ImportObjectReconciliationRunResult> {
  const pageSize = options.pageSize ?? IMPORT_OBJECT_RECONCILIATION_PAGE_SIZE;
  const maxPasses = options.maxPasses ?? IMPORT_OBJECT_RECONCILIATION_MAX_PASSES;
  assertPositiveInteger(pageSize, 1000, "Reconciliation page size");
  assertPositiveInteger(maxPasses, 100, "Reconciliation pass limit");

  const total: ImportObjectReconciliationRunResult = {
    scanned: 0, resolved: 0, failed: 0,
    deferred: await repository.countDeferredImportObjectReconciliationJobs(now),
    passes: 0, hasMore: false, guardsPruned: 0
  };

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const page = await reconcileImportObjects(repository, storage, now, pageSize);
    if (page.scanned === 0) {
      total.guardsPruned = await repository.pruneImportBatchReconciliationGuards(now);
      return total;
    }
    total.scanned += page.scanned;
    total.resolved += page.resolved;
    total.failed += page.failed;
    total.passes += 1;
    if (page.scanned < pageSize) {
      total.guardsPruned = await repository.pruneImportBatchReconciliationGuards(now);
      return total;
    }
  }

  total.hasMore = (await repository.listEligibleImportObjectReconciliationJobs(now, 1)).length > 0;
  total.guardsPruned = await repository.pruneImportBatchReconciliationGuards(now);
  return total;
}

async function reconcileJob(
  repository: ImportObjectReconciliationRepository,
  storage: ObjectStorage,
  job: ImportObjectReconciliationJob,
  now: Date
): Promise<boolean> {
  if (job.kind === "delete_orphan") {
    try {
      await storage.deleteObject(job.objectKey);
    } catch {
      await recordFailure(repository, job.id, now, "StorageError");
      return false;
    }
    try {
      return await repository.resolveImportObjectReconciliationJob(job.id, now, "object_removed");
    } catch {
      await recordFailure(repository, job.id, now, "DatabaseError");
      return false;
    }
  }

  try {
    return await repository.withImportBatchReconciliationGuard(job.batchId, async (guarded) => {
      try {
        await guarded.getBatch({ id: job.batchId, enterpriseId: job.enterpriseId, storeId: job.storeId });
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
        try {
          await storage.deleteObject(job.objectKey);
        } catch (storageError) {
          throw new ReconciliationStorageFailure(storageError);
        }
        return guarded.resolveImportObjectReconciliationJob(job.id, now, "object_removed");
      }
      return guarded.resolveImportObjectReconciliationJob(job.id, now, "persistence_committed");
    });
  } catch (error) {
    await recordFailure(repository, job.id, now, error instanceof ReconciliationStorageFailure ? "StorageError" : "DatabaseError");
    return false;
  }
}

async function recordFailure(
  repository: ImportObjectReconciliationRepository,
  id: string,
  now: Date,
  errorType: "StorageError" | "DatabaseError"
): Promise<void> {
  try {
    await repository.recordImportObjectReconciliationFailure(id, now, errorType, "unknown");
  } catch {
    // The job remains pending and is safe to retry even when failure bookkeeping is unavailable.
  }
}

function assertPositiveInteger(value: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new ValidationError(`${name} must be an integer between 1 and ${maximum}`);
  }
}

class ReconciliationStorageFailure extends Error {
  constructor(cause: unknown) {
    super("Object storage reconciliation failed", { cause });
  }
}
