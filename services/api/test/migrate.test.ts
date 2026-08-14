import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/migrate.js";
import { readFile } from "node:fs/promises";

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

describe("016 operator content migration shape", () => {
  it("declares append-only audit and permanent published-history guards", async () => {
    const sql = await readFile(new URL("../migrations/016_operator_content_versions.sql", import.meta.url), "utf8");
    expect(sql).toContain("operator_content_audit_append_only");
    expect(sql).toContain("ever_published_at");
    expect(sql).toContain("legacy published rules require enrichment");
  });
});
