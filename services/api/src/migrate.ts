import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "./db.js";

export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATION_ADVISORY_LOCK_KEY = 734982136;

export async function runMigrations(
  database: Database,
  migrations: readonly Migration[]
): Promise<string[]> {
  const client = await database.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock($1::bigint)",
      [MIGRATION_ADVISORY_LOCK_KEY]
    );
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_id text UNIQUE
      )`
    );

    const applied = await client.query<{ migration_id: string }>(
      "SELECT migration_id FROM schema_migrations"
    );
    const appliedIds = new Set(applied.rows.map((row) => row.migration_id));
    const executed: string[] = [];

    for (const migration of migrations) {
      if (appliedIds.has(migration.id)) continue;

      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (migration_id) VALUES ($1)",
        [migration.id]
      );
      executed.push(migration.id);
    }

    await client.query("COMMIT");
    return executed;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loadMigrations(): Promise<Migration[]> {
  const directory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();

  return Promise.all(
    files.map(async (id) => ({
      id,
      sql: await readFile(new URL(`../migrations/${id}`, import.meta.url), "utf8")
    }))
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations");

  const database = createDatabase(databaseUrl);
  const executed = await runMigrations(database, await loadMigrations());
  console.log(`Applied ${executed.length} migration(s)`);
  await database.end();
}
