import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "./db.js";
import {
  cleanupExpiredImportFiles,
  type ImportFileCleanupResult
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
    imports: ImportRepository,
    storage: ObjectStorage,
    now: Date,
    limit: number
  ): Promise<ImportFileCleanupResult>;
  now(): Date;
  writeOutput(value: string): void;
}

const defaultDependencies: CleanupImportFilesDependencies = {
  createDatabase,
  createObjectStorage: createMinioObjectStorageFromEnv,
  cleanup: cleanupExpiredImportFiles,
  now: () => new Date(),
  writeOutput: (value) => console.log(value)
};

const minioEnvironmentKeys = [
  "MINIO_ENDPOINT",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "MINIO_BUCKET"
] as const;

export async function runImportFileCleanup(
  environment: Record<string, string | undefined> = process.env,
  dependencies: CleanupImportFilesDependencies = defaultDependencies
): Promise<ImportFileCleanupResult> {
  const databaseUrl = environment.DATABASE_URL;
  if (!isNonEmpty(databaseUrl)) throw new Error("DATABASE_URL is required");

  const missing = minioEnvironmentKeys.filter((key) => !isNonEmpty(environment[key]));
  if (missing.length > 0) {
    throw new ObjectStorageConfigurationError(`Missing MinIO configuration: ${missing.join(", ")}`);
  }

  const storage = dependencies.createObjectStorage(environment);
  if (!storage) throw new ObjectStorageConfigurationError("MinIO configuration is required");

  const database = dependencies.createDatabase(databaseUrl);
  try {
    const result = await dependencies.cleanup(
      new ImportRepository(database),
      storage,
      dependencies.now(),
      100
    );
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await database.end();
  }
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runImportFileCleanup();
    if (result.failed > 0) process.exitCode = 1;
  } catch {
    console.error("Import file cleanup failed");
    process.exitCode = 1;
  }
}
