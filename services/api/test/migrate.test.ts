import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/migrate.js";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/db.js";

describe("runMigrations", () => {
  it("records a migration and skips it on the next run", async () => {
    const memory = newDb({ noAstCoverageCheck: true });
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool();
    const migrations = [
      {
        id: "001_test.sql",
        sql: "CREATE TABLE imported_rows (id text primary key);"
      }
    ];

    expect(await runMigrations(pool, migrations)).toEqual(["001_test.sql"]);
    expect(await runMigrations(pool, migrations)).toEqual([]);

    const result = await pool.query("SELECT migration_id FROM schema_migrations");
    expect(result.rows).toEqual([{ migration_id: "001_test.sql" }]);
  });
});

describe("016 operator content migration structural scope (pg-mem does not execute PL/pgSQL triggers)", () => {
  it("declares append-only audit and permanent published-history guards", async () => {
    const sql = await readFile(new URL("../migrations/016_operator_content_versions.sql", import.meta.url), "utf8");
    expect(sql).toContain("operator_content_audit_append_only");
    expect(sql).toContain("ever_published_at");
    expect(sql).toContain("status <> 'published'");
    expect(sql).toContain("legacy published rules require enrichment");
  });
});

// This must be a dedicated disposable test database; never use a generic runtime DATABASE_URL.
const realPostgresUrl = process.env.REAL_POSTGRES_TEST_URL;
const realPostgresIt = realPostgresUrl ? it : it.skip;
describe("016 operator content PostgreSQL trigger invariants", () => {
  realPostgresIt("requires dedicated REAL_POSTGRES_TEST_URL; applies full migrations and rejects unmarked publication plus direct published/disabled history rewrites", async () => {
    const database = createDatabase(realPostgresUrl!);
    const files = (await readdir(new URL("../migrations/", import.meta.url))).filter((file) => file.endsWith(".sql")).sort();
    await runMigrations(database, await Promise.all(files.map(async (id) => ({ id, sql: await readFile(new URL(`../migrations/${id}`, import.meta.url), "utf8") }))));
    const client = await database.connect(); const logicalId = randomUUID(); const versionId = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO operator_content_template_items(logical_id) VALUES($1)", [logicalId]);
      await client.query("INSERT INTO operator_content_template_versions(id,logical_id,version,name,status,content_json,constraints_json,fallback_scope_json,actor_id) VALUES($1,$2,1,'test','draft','{}','{}','{}','test')", [versionId, logicalId]);
      await expectRejected(client, "UPDATE operator_content_template_versions SET status='published' WHERE id=$1", [versionId]);
      await client.query("UPDATE operator_content_template_versions SET status='published',ever_published_at=now() WHERE id=$1", [versionId]);
      await client.query("UPDATE operator_content_template_versions SET status='disabled',disabled_by_actor_id='test',disabled_at=now() WHERE id=$1", [versionId]);
      await expectRejected(client, "UPDATE operator_content_template_versions SET name='rewritten' WHERE id=$1", [versionId]);
      await expectRejected(client, "DELETE FROM operator_content_template_versions WHERE id=$1", [versionId]);
      await client.query("INSERT INTO operator_content_audit_events(id,content_kind,logical_id,version,event_type,actor_id) VALUES($1,'template',$2,1,'published','test')", [randomUUID(), logicalId]);
      await expectRejected(client, "UPDATE operator_content_audit_events SET actor_id='rewritten' WHERE logical_id=$1", [logicalId]);
    } finally { await client.query("ROLLBACK"); client.release(); await database.end(); }
  }, 30_000);
});

async function expectRejected(client: { query(text: string, values?: unknown[]): Promise<unknown> }, sql: string, values: unknown[]): Promise<void> {
  await client.query("SAVEPOINT expected_failure");
  await expect(client.query(sql, values)).rejects.toThrow();
  await client.query("ROLLBACK TO SAVEPOINT expected_failure");
}
