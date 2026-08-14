import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/migrate.js";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/db.js";
import { buildServer } from "../src/server.js";
import type { ModelGenerationService } from "../src/model-providers/generation.js";

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

describe("018 content planning PostgreSQL transaction, partial-unique, and trigger invariants", () => {
  realPostgresIt("persists a committed copy/version batch, permits one confirmed copy, and rejects immutable history rewrites", async () => {
    const database = createDatabase(realPostgresUrl!);
    const files = (await readdir(new URL("../migrations/", import.meta.url))).filter((file) => file.endsWith(".sql")).sort();
    await runMigrations(database, await Promise.all(files.map(async (id) => ({ id, sql: await readFile(new URL(`../migrations/${id}`, import.meta.url), "utf8") }))));
    const client = await database.connect(); const taskId = randomUUID(); const topicId = randomUUID(); const copyId = randomUUID(); const secondCopyId = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO content_tasks(id,enterprise_id,store_id,actor_id,profile_version,profile_snapshot_json,stage_snapshot_json,template_snapshot_json,persona,content_type,style,commercial_level,status) VALUES($1,'e','s','a',1,'{}','{}','[]','owner','story','sincere',1,'topic_draft')", [taskId]);
      await client.query("INSERT INTO content_task_topics(id,task_id,position,title,angle,product_reference,goal_reference,commercial_level) VALUES($1,$2,1,'t','a','p','g',1)", [topicId, taskId]);
      await client.query("INSERT INTO content_task_copies(id,task_id,topic_id,position,title,body,strategy,product_reference,goal_reference,commercial_level) VALUES($1,$2,$3,1,'t','b','s','p','g',1)", [copyId, taskId, topicId]);
      await client.query("INSERT INTO content_task_copy_versions(id,copy_id,version,title,body) VALUES($1,$2,1,'t','b')", [randomUUID(), copyId]);
      await client.query("COMMIT");
      expect((await database.query("SELECT id FROM content_task_copies WHERE id=$1", [copyId])).rowCount).toBe(1);
      await client.query("BEGIN");
      await expectRejected(client, "UPDATE content_task_topics SET title='rewrite' WHERE id=$1", [topicId]);
      await expectRejected(client, "UPDATE content_task_copy_versions SET title='rewrite' WHERE copy_id=$1", [copyId]);
      await client.query("UPDATE content_task_copies SET status='confirmed',confirmed_at=now() WHERE id=$1", [copyId]);
      await expectRejected(client, "UPDATE content_task_copies SET title='rewrite' WHERE id=$1", [copyId]);
      await client.query("INSERT INTO content_task_copies(id,task_id,topic_id,position,title,body,strategy,product_reference,goal_reference,commercial_level) VALUES($1,$2,$3,2,'t2','b2','s','p','g',1)", [secondCopyId, taskId, topicId]);
      await expectRejected(client, "UPDATE content_task_copies SET status='confirmed',confirmed_at=now() WHERE id=$1", [secondCopyId]);
    } finally { try { await client.query("ROLLBACK"); } catch {} client.release(); await database.end(); }
  }, 30_000);

  realPostgresIt("returns conflict when a copy changes after its version-bound review", async () => {
    const database = createDatabase(realPostgresUrl!);
    const files = (await readdir(new URL("../migrations/", import.meta.url))).filter((file) => file.endsWith(".sql")).sort();
    await runMigrations(database, await Promise.all(files.map(async (id) => ({ id, sql: await readFile(new URL(`../migrations/${id}`, import.meta.url), "utf8") }))));
    const taskId = randomUUID(); const topicId = randomUUID(); const copyId = randomUUID();
    await database.query("INSERT INTO content_tasks(id,enterprise_id,store_id,actor_id,profile_version,profile_snapshot_json,stage_snapshot_json,template_snapshot_json,persona,content_type,style,commercial_level,status) VALUES($1,'race-enterprise','race-store','actor',1,'{}','{}','[]','owner','story','sincere',1,'topic_draft')", [taskId]);
    await database.query("INSERT INTO content_task_topics(id,task_id,position,title,angle,product_reference,goal_reference,commercial_level) VALUES($1,$2,1,'t','a','p','g',1)", [topicId, taskId]);
    await database.query("INSERT INTO content_task_copies(id,task_id,topic_id,position,title,body,strategy,product_reference,goal_reference,commercial_level) VALUES($1,$2,$3,1,'before','body','s','p','g',1)", [copyId, taskId, topicId]);
    let raced = false;
    const racedDatabase = {
      connect: () => database.connect(),
      query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
        if (!raced && text.startsWith("INSERT INTO content_task_copy_reviews")) {
          raced = true;
          await database.query("UPDATE content_task_copies SET title='after',version=version+1 WHERE id=$1", [copyId]);
        }
        return database.query<Row>(text, values ? [...values] : undefined);
      }
    };
    const generator: ModelGenerationService = { generateStructured: async () => ({ provider: "deepseek", model: "test", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1, output: { approved: true, findings: [] } as never }) };
    const app = buildServer({ database: racedDatabase, trustedContextResolver: async () => ({ enterpriseId: "race-enterprise", storeId: "race-store", actorId: "actor" }), modelGenerationService: generator });
    try {
      const response = await app.inject({ method: "POST", url: `/v1/stores/race-store/content-tasks/${taskId}/copies/${copyId}/confirm` });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "Copy changed after review" });
      expect(raced).toBe(true);
      expect((await database.query("SELECT status,version,title FROM content_task_copies WHERE id=$1", [copyId])).rows).toMatchObject([{ status: "draft", version: 2, title: "after" }]);
    } finally { await app.close(); await database.end(); }
  }, 30_000);

  realPostgresIt("enforces shot gate, deterministic block, edit history, and semantic fail-closed through routes", async () => {
    const database = createDatabase(realPostgresUrl!);
    const files = (await readdir(new URL("../migrations/", import.meta.url))).filter(file => file.endsWith(".sql")).sort();
    await runMigrations(database, await Promise.all(files.map(async id => ({ id, sql: await readFile(new URL(`../migrations/${id}`, import.meta.url), "utf8") }))));
    const enterpriseId = `route-e-${randomUUID()}`; const storeId = `route-s-${randomUUID()}`;
    const makeDraft = async (title: string) => { const taskId = randomUUID(); const topicId = randomUUID(); const copyId = randomUUID(); await database.query("INSERT INTO content_tasks(id,enterprise_id,store_id,actor_id,profile_version,profile_snapshot_json,stage_snapshot_json,template_snapshot_json,persona,content_type,style,commercial_level,status) VALUES($1,$2,$3,'actor',1,'{}','{}','[]','owner','story','sincere',1,'topic_draft')", [taskId, enterpriseId, storeId]); await database.query("INSERT INTO content_task_topics(id,task_id,position,title,angle,product_reference,goal_reference,commercial_level) VALUES($1,$2,1,'t','a','p','g',1)", [topicId, taskId]); await database.query("INSERT INTO content_task_copies(id,task_id,topic_id,position,title,body,strategy,product_reference,goal_reference,commercial_level) VALUES($1,$2,$3,1,$4,'body','s','p','g',1)", [copyId, taskId, topicId, title]); await database.query("INSERT INTO content_task_copy_versions(id,copy_id,version,title,body) VALUES($1,$2,1,$3,'body')", [randomUUID(), copyId, title]); return { taskId, copyId }; };
    let semanticFails = false;
    const generator: ModelGenerationService = { generateStructured: async request => { if (semanticFails) throw new Error("unavailable"); return { provider: "deepseek", model: "test", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1, output: (request.promptVersion === "content-semantic-review-v1" ? { approved: true, findings: [] } : []) as never }; } };
    const app = buildServer({ database, trustedContextResolver: async () => ({ enterpriseId, storeId, actorId: "actor" }), modelGenerationService: generator });
    try {
      const gated = await makeDraft("safe");
      expect((await app.inject({ method: "POST", url: `/v1/stores/${storeId}/content-tasks/${gated.taskId}/shots/generate` })).statusCode).toBe(409);
      const editable = await makeDraft("safe");
      expect((await app.inject({ method: "PUT", url: `/v1/stores/${storeId}/content-tasks/${editable.taskId}/copies/${editable.copyId}`, payload: { title: "edited", body: "edited body" } })).statusCode).toBe(200);
      expect((await database.query("SELECT version FROM content_task_copy_versions WHERE copy_id=$1 ORDER BY version", [editable.copyId])).rows).toEqual([{ version: 1 }, { version: 2 }]);
      const ruleId = randomUUID(); await database.query("INSERT INTO operator_content_rule_items(logical_id) VALUES($1)", [ruleId]); await database.query("INSERT INTO operator_content_rule_versions(id,logical_id,version,name,rule_type,patterns_json,semantic_categories_json,severity,platform,scope,guidance,status,actor_id,ever_published_at) VALUES($1,$2,1,'r','literal','[\"forbidden\"]','[]','block','douyin','all_copy','rewrite','published','operator',now())", [randomUUID(), ruleId]);
      const blocked = await makeDraft("forbidden"); expect((await app.inject({ method: "POST", url: `/v1/stores/${storeId}/content-tasks/${blocked.taskId}/copies/${blocked.copyId}/confirm` })).statusCode).toBe(422);
      semanticFails = true; const unavailable = await makeDraft("safe again"); expect((await app.inject({ method: "POST", url: `/v1/stores/${storeId}/content-tasks/${unavailable.taskId}/copies/${unavailable.copyId}/confirm` })).statusCode).toBe(422);
    } finally { await app.close(); await database.end(); }
  }, 30_000);
});

async function expectRejected(client: { query(text: string, values?: unknown[]): Promise<unknown> }, sql: string, values: unknown[]): Promise<void> {
  await client.query("SAVEPOINT expected_failure");
  await expect(client.query(sql, values)).rejects.toThrow();
  await client.query("ROLLBACK TO SAVEPOINT expected_failure");
}
