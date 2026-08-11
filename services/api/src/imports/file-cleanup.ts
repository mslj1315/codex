import type { ObjectStorage } from "../storage/object-storage.js";
import type { ImportRepository } from "./repository.js";

export interface ImportFileCleanupResult {
  scanned: number;
  cleaned: number;
  failed: number;
}

export async function cleanupExpiredImportFiles(
  imports: ImportRepository,
  storage: ObjectStorage,
  now: Date,
  limit = 100
): Promise<ImportFileCleanupResult> {
  const files = await imports.listExpiredImportFiles(now, limit);
  const result: ImportFileCleanupResult = { scanned: files.length, cleaned: 0, failed: 0 };

  for (const file of files) {
    try {
      await storage.deleteObject(file.objectKey);
      await imports.markImportFileCleaned(file.id, now);
      result.cleaned += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}
