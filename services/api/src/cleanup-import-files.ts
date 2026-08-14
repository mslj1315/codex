import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "./db.js";
import {
  runExpiredImportFileCleanup,
  type ImportFileCleanupRepository,
  type ImportFileCleanupRunResult
} from "./imports/file-cleanup.js";
import { ImportRepository } from "./imports/repository.js";
import type { ObjectStorage } from "./storage/object-storage.js";
import {
  createMinioObjectStorageFromEnv,
  ObjectStorageConfigurationError
} from "./storage/minio-object-storage.js";

export interface CleanupDatabase extends Database {
  end(): Promise<void>;
}

export interface CleanupImportFilesDependencies {
  createDatabase(databaseUrl: string): CleanupDatabase;
  createObjectStorage(environment: Record<string, string | undefined>): ObjectStorage | undefined;
  cleanup(
    imports: ImportFileCleanupRepository,
    storage: ObjectStorage,
    now: Date
  ): Promise<ImportFileCleanupRunResult>;
  now(): Date;
  writeOutput(value: string): void;
}

const defaultDependencies: CleanupImportFilesDependencies = {
  createDatabase,
  createObjectStorage: createMinioObjectStorageFromEnv,
  cleanup: runExpiredImportFileCleanup,
  now: () => new Date(),
  writeOutput: (value) => console.log(value)
};

const minioEnvironmentKeys = [
  "MINIO_ENDPOINT",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "MINIO_BUCKET"
] as const;

export const IMPORT_FILE_CLEANUP_ADVISORY_LOCK_KEY = 734982135;

export interface SkippedImportFileCleanup {
  skipped: true;
  reason: "already_running";
}

export type ImportFileCleanupCliResult = ImportFileCleanupRunResult | SkippedImportFileCleanup;

export async function runImportFileCleanup(
  environment: Record<string, string | undefined> = process.env,
  dependencies: CleanupImportFilesDependencies = defaultDependencies
): Promise<ImportFileCleanupCliResult> {
  const databaseUrl = environment.DATABASE_URL;
  if (!isNonEmpty(databaseUrl)) throw new Error("DATABASE_URL is required");

  const missing = minioEnvironmentKeys.filter((key) => !isNonEmpty(environment[key]));
  if (missing.length > 0) {
    throw new ObjectStorageConfigurationError(`Missing MinIO configuration: ${missing.join(", ")}`);
  }

  const storage = dependencies.createObjectStorage(environment);
  if (!storage) throw new ObjectStorageConfigurationError("MinIO configuration is required");

  const database = dependencies.createDatabase(databaseUrl);
  let lockClient: Awaited<ReturnType<CleanupDatabase["connect"]>> | undefined;
  try {
    lockClient = await database.connect();
    const lock = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
      [IMPORT_FILE_CLEANUP_ADVISORY_LOCK_KEY]
    );
    if (lock.rows[0]?.locked !== true) {
      const skipped: SkippedImportFileCleanup = { skipped: true, reason: "already_running" };
      lockClient.release();
      lockClient = undefined;
      dependencies.writeOutput(JSON.stringify(skipped));
      return skipped;
    }

    let result: ImportFileCleanupRunResult | undefined;
    let cleanupFailed = false;
    let cleanupFailure: unknown;
    try {
      result = await dependencies.cleanup(
        new ImportRepository(database),
        storage,
        dependencies.now()
      );
    } catch (error) {
      cleanupFailed = true;
      cleanupFailure = error;
    }

    let unlockFailure: unknown;
    try {
      const unlock = await lockClient.query<{ unlocked: boolean }>(
        "SELECT pg_advisory_unlock($1::bigint) AS unlocked",
        [IMPORT_FILE_CLEANUP_ADVISORY_LOCK_KEY]
      );
      if (unlock.rows[0]?.unlocked !== true) {
        throw new Error("Unable to release import cleanup lock");
      }
    } catch (error) {
      unlockFailure = error;
    }
    lockClient.release();
    lockClient = undefined;

    if (cleanupFailed) throw cleanupFailure;
    if (unlockFailure !== undefined) throw new Error("Unable to release import cleanup lock");
    dependencies.writeOutput(JSON.stringify(result));
    return result!;
  } finally {
    lockClient?.release();
    await database.end();
  }
}

export function cleanupExitCode(result: ImportFileCleanupCliResult): number {
  if ("skipped" in result) return 0;
  return result.failed > 0 || result.hasMore ? 1 : 0;
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runImportFileCleanup();
    process.exitCode = cleanupExitCode(result);
  } catch {
    console.error("Import file cleanup failed");
    process.exitCode = 1;
  }
}
