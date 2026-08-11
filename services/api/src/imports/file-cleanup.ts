import type { ObjectStorage } from "../storage/object-storage.js";
import { ValidationError, type ImportFileRecord } from "./repository.js";

export { IMPORT_FILE_CLEANUP_RETRY_DELAY_MS } from "./repository.js";

export interface ImportFileCleanupResult {
  scanned: number;
  cleaned: number;
  failed: number;
}

export interface ImportFileCleanupRunResult extends ImportFileCleanupResult {
  passes: number;
  hasMore: boolean;
}

export interface ImportFileCleanupRepository {
  listExpiredImportFiles(now: Date, limit?: number): Promise<ImportFileRecord[]>;
  markImportFileCleaned(id: string, cleanedAt: Date): Promise<boolean>;
  recordImportFileCleanupFailure(id: string, attemptedAt: Date): Promise<boolean>;
}

export interface ImportFileCleanupRunOptions {
  pageSize?: number;
  maxPasses?: number;
}

export const IMPORT_FILE_CLEANUP_PAGE_SIZE = 100;
export const IMPORT_FILE_CLEANUP_MAX_PASSES = 10;

export async function cleanupExpiredImportFiles(
  imports: ImportFileCleanupRepository,
  storage: ObjectStorage,
  now: Date,
  limit = 100
): Promise<ImportFileCleanupResult> {
  const files = await imports.listExpiredImportFiles(now, limit);
  const result: ImportFileCleanupResult = { scanned: files.length, cleaned: 0, failed: 0 };

  for (const file of files) {
    try {
      await storage.deleteObject(file.objectKey);
      if (await imports.markImportFileCleaned(file.id, now)) result.cleaned += 1;
    } catch {
      result.failed += 1;
      try {
        await imports.recordImportFileCleanupFailure(file.id, now);
      } catch {
        // A later pass can retry the still-unmarked row even if failure bookkeeping is unavailable.
      }
    }
  }

  return result;
}

export async function runExpiredImportFileCleanup(
  imports: ImportFileCleanupRepository,
  storage: ObjectStorage,
  now: Date,
  options: ImportFileCleanupRunOptions = {}
): Promise<ImportFileCleanupRunResult> {
  const pageSize = options.pageSize ?? IMPORT_FILE_CLEANUP_PAGE_SIZE;
  const maxPasses = options.maxPasses ?? IMPORT_FILE_CLEANUP_MAX_PASSES;
  assertPositiveInteger(pageSize, 1000, "Cleanup page size");
  assertPositiveInteger(maxPasses, 100, "Cleanup pass limit");

  const total: ImportFileCleanupRunResult = {
    scanned: 0,
    cleaned: 0,
    failed: 0,
    passes: 0,
    hasMore: false
  };

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const page = await cleanupExpiredImportFiles(imports, storage, now, pageSize);
    if (page.scanned === 0) return total;
    total.scanned += page.scanned;
    total.cleaned += page.cleaned;
    total.failed += page.failed;
    total.passes += 1;
    if (page.scanned < pageSize) return total;
  }

  total.hasMore = (await imports.listExpiredImportFiles(now, 1)).length > 0;
  return total;
}

function assertPositiveInteger(value: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new ValidationError(`${name} must be an integer between 1 and ${maximum}`);
  }
}
