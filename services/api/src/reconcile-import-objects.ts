import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "./db.js";
import {
  runImportObjectReconciliation,
  type ImportObjectReconciliationRepository,
  type ImportObjectReconciliationRunResult
} from "./imports/object-reconciliation.js";
import { ImportRepository } from "./imports/repository.js";
import type { ObjectStorage } from "./storage/object-storage.js";
import {
  createMinioObjectStorageFromEnv,
  ObjectStorageConfigurationError
} from "./storage/minio-object-storage.js";

export interface ReconciliationDatabase extends Database {
  end(): Promise<void>;
}

export interface ReconcileImportObjectsDependencies {
  createDatabase(databaseUrl: string): ReconciliationDatabase;
  createObjectStorage(environment: Record<string, string | undefined>): ObjectStorage | undefined;
  reconcile(
    imports: ImportObjectReconciliationRepository,
    storage: ObjectStorage,
    now: Date
  ): Promise<ImportObjectReconciliationRunResult>;
  now(): Date;
  writeOutput(value: string): void;
}

const defaultDependencies: ReconcileImportObjectsDependencies = {
  createDatabase,
  createObjectStorage: createMinioObjectStorageFromEnv,
  reconcile: runImportObjectReconciliation,
  now: () => new Date(),
  writeOutput: (value) => console.log(value)
};

const minioEnvironmentKeys = [
  "MINIO_ENDPOINT",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "MINIO_BUCKET"
] as const;

export const IMPORT_OBJECT_RECONCILIATION_ADVISORY_LOCK_KEY = 734982137;

export interface SkippedImportObjectReconciliation {
  skipped: true;
  reason: "already_running";
}

export type ImportObjectReconciliationCliResult =
  | ImportObjectReconciliationRunResult
  | SkippedImportObjectReconciliation;

export async function runImportObjectReconciliationCli(
  environment: Record<string, string | undefined> = process.env,
  dependencies: ReconcileImportObjectsDependencies = defaultDependencies
): Promise<ImportObjectReconciliationCliResult> {
  const databaseUrl = environment.DATABASE_URL;
  if (!isNonEmpty(databaseUrl)) throw new Error("DATABASE_URL is required");

  const missing = minioEnvironmentKeys.filter((key) => !isNonEmpty(environment[key]));
  if (missing.length > 0) {
    throw new ObjectStorageConfigurationError(`Missing MinIO configuration: ${missing.join(", ")}`);
  }

  const storage = dependencies.createObjectStorage(environment);
  if (!storage) throw new ObjectStorageConfigurationError("MinIO configuration is required");

  const database = dependencies.createDatabase(databaseUrl);
  let lockClient: Awaited<ReturnType<ReconciliationDatabase["connect"]>> | undefined;
  try {
    lockClient = await database.connect();
    const lock = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
      [IMPORT_OBJECT_RECONCILIATION_ADVISORY_LOCK_KEY]
    );
    if (lock.rows[0]?.locked !== true) {
      const skipped: SkippedImportObjectReconciliation = { skipped: true, reason: "already_running" };
      lockClient.release();
      lockClient = undefined;
      dependencies.writeOutput(JSON.stringify(skipped));
      return skipped;
    }

    let result: ImportObjectReconciliationRunResult | undefined;
    let reconciliationFailure: unknown;
    try {
      result = await dependencies.reconcile(new ImportRepository(database), storage, dependencies.now());
    } catch (error) {
      reconciliationFailure = error;
    }

    let unlockFailure: unknown;
    try {
      const unlock = await lockClient.query<{ unlocked: boolean }>(
        "SELECT pg_advisory_unlock($1::bigint) AS unlocked",
        [IMPORT_OBJECT_RECONCILIATION_ADVISORY_LOCK_KEY]
      );
      if (unlock.rows[0]?.unlocked !== true) {
        throw new Error("Unable to release import object reconciliation lock");
      }
    } catch (error) {
      unlockFailure = error;
    }
    lockClient.release();
    lockClient = undefined;

    if (reconciliationFailure !== undefined) throw reconciliationFailure;
    if (unlockFailure !== undefined) throw new Error("Unable to release import object reconciliation lock");
    dependencies.writeOutput(JSON.stringify(result));
    return result!;
  } finally {
    lockClient?.release();
    await database.end();
  }
}

export function importObjectReconciliationExitCode(result: ImportObjectReconciliationCliResult): number {
  if ("skipped" in result) return 0;
  return result.failed > 0 || result.hasMore ? 1 : 0;
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runImportObjectReconciliationCli();
    process.exitCode = importObjectReconciliationExitCode(result);
  } catch {
    console.error("Import object reconciliation failed");
    process.exitCode = 1;
  }
}
