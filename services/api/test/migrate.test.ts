import { readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import { runMigrations } from "../src/migrate.js";

const migration = {
  id: "001_test.sql",
  sql: "CREATE TABLE imported_rows (id text primary key);"
};

describe("runMigrations", () => {
  it("declares and executes the customer content task queue index migration", async () => {
    const id = "027_content_task_customer_queue_index.sql";
    const sql = await readFile(new URL(`../migrations/${id}`, import.meta.url), "utf8");
    await expect(readFile(new URL("../migrations/025_content_task_customer_queue_index.sql", import.meta.url), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(sql.trim()).toBe("CREATE INDEX content_tasks_customer_queue_idx ON content_tasks(enterprise_id, store_id, actor_id, created_at DESC);");

    const memory = newDb({ noAstCoverageCheck: true });
    memory.public.registerFunction({ name: "pg_advisory_xact_lock", args: [DataType.bigint], returns: DataType.bool, implementation: () => true });
    const pool = new (memory.adapters.createPg().Pool)();
    await pool.query("CREATE TABLE content_tasks (enterprise_id TEXT NOT NULL, store_id TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)");

    expect(await runMigrations(pool, [{ id, sql }])).toEqual([id]);
    expect((await pool.query("SELECT migration_id FROM schema_migrations")).rows).toEqual([{ migration_id: id }]);
  });

  it("records a migration and skips it on the next run", async () => {
    const memory = newDb({ noAstCoverageCheck: true });
    memory.public.registerFunction({
      name: "pg_advisory_xact_lock",
      args: [DataType.bigint],
      returns: DataType.bool,
      implementation: () => true
    });
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool();

    expect(await runMigrations(pool, [migration])).toEqual(["001_test.sql"]);
    expect(await runMigrations(pool, [migration])).toEqual([]);

    const result = await pool.query("SELECT migration_id FROM schema_migrations");
    expect(result.rows).toEqual([{ migration_id: "001_test.sql" }]);
  });

  it("takes the transaction advisory lock before checking or applying migrations", async () => {
    const statements: string[] = [];
    const database = protocolDatabase(statements);

    await expect(runMigrations(database, [migration])).resolves.toEqual([migration.id]);

    expect(statements).toEqual([
      "BEGIN",
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringMatching(/^CREATE TABLE IF NOT EXISTS schema_migrations/),
      "SELECT migration_id FROM schema_migrations",
      migration.sql,
      "INSERT INTO schema_migrations (migration_id) VALUES ($1)",
      "COMMIT",
      "release"
    ]);
  });

  it("rolls back and releases the locked client when a migration fails", async () => {
    const statements: string[] = [];
    const failure = new Error("migration failed");
    const database = protocolDatabase(statements, failure);

    await expect(runMigrations(database, [migration])).rejects.toBe(failure);
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(statements.at(-1)).toBe("release");
  });

  it("serializes concurrent runners so only one applies and records new DDL", async () => {
    let locked = false;
    let applied = false;
    let ddlExecutions = 0;
    let inserts = 0;
    let signalSecondWaiting!: () => void;
    const secondWaiting = new Promise<void>((resolve) => { signalSecondWaiting = resolve; });
    let releaseLock!: () => void;
    let lockReleased = new Promise<void>((resolve) => { releaseLock = resolve; });

    const database = {
      async query() { throw new Error("pool query is not allowed"); },
      async connect() {
        return {
          async query(text: string) {
            const sql = text.trim();
            if (sql === "BEGIN") return result();
            if (sql.includes("pg_advisory_xact_lock")) {
              if (locked) {
                signalSecondWaiting();
                await lockReleased;
                lockReleased = new Promise<void>((resolve) => { releaseLock = resolve; });
              }
              locked = true;
              return result([{ pg_advisory_xact_lock: true }]);
            }
            if (sql.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) return result();
            if (sql === "SELECT migration_id FROM schema_migrations") {
              return result(applied ? [{ migration_id: migration.id }] : []);
            }
            if (sql === migration.sql) {
              ddlExecutions += 1;
              await secondWaiting;
              return result();
            }
            if (sql === "INSERT INTO schema_migrations (migration_id) VALUES ($1)") {
              inserts += 1;
              applied = true;
              return result();
            }
            if (sql === "COMMIT" || sql === "ROLLBACK") {
              locked = false;
              releaseLock();
              return result();
            }
            throw new Error(`unexpected query: ${sql}`);
          },
          release() {}
        };
      }
    } as unknown as Database;

    const outcomes = await Promise.all([
      runMigrations(database, [migration]),
      runMigrations(database, [migration])
    ]);
    expect(outcomes.map((value) => value.length).sort()).toEqual([0, 1]);
    expect(ddlExecutions).toBe(1);
    expect(inserts).toBe(1);
  });
});

function protocolDatabase(statements: string[], migrationFailure?: Error): Database {
  return {
    async query() { throw new Error("pool query is not allowed"); },
    async connect() {
      return {
        async query(text: string) {
          const sql = text.trim();
          statements.push(sql);
          if (sql === migration.sql && migrationFailure) throw migrationFailure;
          if (sql === "SELECT migration_id FROM schema_migrations") return result([]);
          return result();
        },
        release() { statements.push("release"); }
      };
    }
  } as unknown as Database;
}

function result(rows: Record<string, unknown>[] = []) {
  return { rows, rowCount: rows.length };
}
