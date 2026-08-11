import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/migrate.js";

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
