import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "./db.js";
import { ImportRepository, type ImportMaintenanceStatus } from "./imports/repository.js";

export const IMPORT_MAINTENANCE_STATUS_ADVISORY_LOCK_KEY = 734982138;

export interface MaintenanceStatusDatabase extends Database { end(): Promise<void>; }
export interface ImportMaintenanceStatusDependencies {
  createDatabase(databaseUrl: string): MaintenanceStatusDatabase;
  getStatus(imports: ImportRepository, now: Date): Promise<ImportMaintenanceStatus>;
  now(): Date;
  writeOutput(value: string): void;
}

const defaultDependencies: ImportMaintenanceStatusDependencies = {
  createDatabase,
  getStatus: (imports, now) => imports.getImportMaintenanceStatus(now),
  now: () => new Date(),
  writeOutput: (value) => console.log(value)
};

export interface SkippedImportMaintenanceStatus { skipped: true; reason: "already_running"; }
export type ImportMaintenanceStatusCliResult = ImportMaintenanceStatus | SkippedImportMaintenanceStatus;

export async function runImportMaintenanceStatus(
  environment: Record<string, string | undefined> = process.env,
  dependencies: ImportMaintenanceStatusDependencies = defaultDependencies
): Promise<ImportMaintenanceStatusCliResult> {
  const databaseUrl = environment.DATABASE_URL;
  if (!isNonEmpty(databaseUrl)) throw new Error("DATABASE_URL is required");
  const database = dependencies.createDatabase(databaseUrl);
  let lockClient: Awaited<ReturnType<MaintenanceStatusDatabase["connect"]>> | undefined;
  try {
    lockClient = await database.connect();
    const lock = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS locked", [IMPORT_MAINTENANCE_STATUS_ADVISORY_LOCK_KEY]
    );
    if (lock.rows[0]?.locked !== true) {
      const skipped: SkippedImportMaintenanceStatus = { skipped: true, reason: "already_running" };
      lockClient.release(); lockClient = undefined;
      dependencies.writeOutput(JSON.stringify(skipped));
      return skipped;
    }
    let result: ImportMaintenanceStatus | undefined;
    let statusFailure: unknown;
    try { result = await dependencies.getStatus(new ImportRepository(database), dependencies.now()); }
    catch (error) { statusFailure = error; }
    let unlockFailure: unknown;
    try {
      const unlock = await lockClient.query<{ unlocked: boolean }>(
        "SELECT pg_advisory_unlock($1::bigint) AS unlocked", [IMPORT_MAINTENANCE_STATUS_ADVISORY_LOCK_KEY]
      );
      if (unlock.rows[0]?.unlocked !== true) throw new Error("Unable to release import maintenance status lock");
    } catch (error) { unlockFailure = error; }
    lockClient.release(); lockClient = undefined;
    if (statusFailure !== undefined) throw statusFailure;
    if (unlockFailure !== undefined) throw new Error("Unable to release import maintenance status lock");
    dependencies.writeOutput(JSON.stringify(result));
    return result!;
  } finally {
    lockClient?.release();
    await database.end();
  }
}

function isNonEmpty(value: string | undefined): value is string { return typeof value === "string" && value.trim().length > 0; }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await runImportMaintenanceStatus(); }
  catch { console.error("Import maintenance status failed"); process.exitCode = 1; }
}
