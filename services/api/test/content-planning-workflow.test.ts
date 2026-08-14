import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";
import type { Database } from "../src/db.js";
import type { ModelGenerationService } from "../src/model-providers/generation.js";

const scope = { enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo" };
const profile = { storeName: "双流小馆", industryCode: "fast_food", categoryCode: "rice_noodle", provinceCode: "sc", cityCode: "cd", districtCode: "sl", detailedAddress: "航空港", businessDistrictType: "community", operatingMode: "dine_in" };

describe("content planning workflow", () => {
  let pool: Database;
  let app: ReturnType<typeof buildServer>;
  const generator: ModelGenerationService = { generateStructured: vi.fn() };

  beforeEach(async () => {
    vi.mocked(generator.generateStructured).mockReset().mockImplementation(async (request) => ({ provider: "deepseek", model: "test", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1, output: request.promptVersion === "content-topic-v1" ? [
      { title: "老板早起", angle: "手艺", productReference: "招牌米线", goalReference: "到店", commercialLevel: 1 }, { title: "午市烟火", angle: "生活", productReference: "招牌米线", goalReference: "到店", commercialLevel: 1 }, { title: "一碗热汤", angle: "产品", productReference: "招牌米线", goalReference: "到店", commercialLevel: 1 }
    ] : request.promptVersion === "content-copy-v1" ? [
      { title: "手艺版", body: "老板凌晨熬汤", strategy: "persona_story", productReference: "招牌米线", goalReference: "到店", commercialLevel: 1 }, { title: "生活版", body: "午饭来碗热米线", strategy: "daily_life", productReference: "招牌米线", goalReference: "到店", commercialLevel: 1 }, { title: "产品版", body: "招牌米线现煮", strategy: "product_value", productReference: "招牌米线", goalReference: "到店", commercialLevel: 1 }
    ] : request.promptVersion === "content-semantic-review-v1" ? { approved: true, findings: [] } : [{ order: 1, shot: "熬汤锅", durationSeconds: 3, narration: "凌晨开始熬汤", productReference: "招牌米线", goalReference: "到店", commercialLevel: 1 }] } as never));
    const memory = newDb({ noAstCoverageCheck: true }); const { Pool } = memory.adapters.createPg(); pool = new Pool();
    for (const file of ["001_imports.sql", "013_content_planning_profile.sql", "014_content_templates_rules.sql", "015_operator_accounts_sessions.sql", "016_operator_content_versions.sql", "017_douyin_official_connections.sql", "018_content_planning_workflow.sql"]) {
      const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
      await pool.query(sql.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, "").replace(/CREATE OR REPLACE FUNCTION[\s\S]*$/, ""));
    }
    app = buildServer({ database: pool, trustedContextResolver: async () => scope, modelGenerationService: generator });
    await app.inject({ method: "POST", url: "/v1/stores/store_demo/content-profile", payload: profile });
    await app.inject({ method: "POST", url: "/v1/stores/store_demo/operating-stages", payload: { effectiveDate: "2026-08-14", primaryGoal: "increase_visits" } });
  });

  it("locks profile and stage snapshots, then generates exactly three topics", async () => {
    const task = await app.inject({ method: "POST", url: "/v1/stores/store_demo/content-tasks", payload: { inspiration: "老板每天凌晨熬汤", persona: "owner", contentType: "store_story", style: "sincere", commercialLevel: 1 } });
    expect(task.statusCode).toBe(201);
    expect(task.json()).toMatchObject({ profileVersion: 1, primaryGoal: "increase_visits", status: "topic_draft" });
    const generated = await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.json().id}/topics/generate` });
    expect(generated.statusCode).toBe(201);
    expect(generated.json()).toHaveLength(3);
    expect(vi.mocked(generator.generateStructured)).toHaveBeenCalledWith(expect.objectContaining({ promptVersion: "content-topic-v1", commercialLevel: 1 }));
  });

  it.skip("requires a confirmed, clean copy before generating immutable shots (covered by REAL_POSTGRES_TEST_URL behavior tests)", async () => {
    const task = (await app.inject({ method: "POST", url: "/v1/stores/store_demo/content-tasks", payload: { persona: "owner", contentType: "store_story", style: "sincere", commercialLevel: 1 } })).json();
    const topics = (await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/topics/generate` })).json();
    const copies = await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/topics/${topics[0].id}/copies/generate` });
    expect(copies.statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/shots/generate` })).statusCode).toBe(409);
    const copy = copies.json()[0];
    expect((await pool.query("SELECT id FROM content_task_copies WHERE id=$1 AND task_id=$2", [copy.id, task.id])).rowCount).toBe(1);
    expect((await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/copies/${copy.id}/confirm` })).statusCode).toBe(200);
    const shots = await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/shots/generate` });
    expect(shots.statusCode).toBe(201);
    expect(shots.json()).toMatchObject({ copyId: copy.id, status: "draft" });
  });

  it.skip("blocks confirmation when a published deterministic rule matches and never exposes drafts to providers (covered by REAL_POSTGRES_TEST_URL behavior tests)", async () => {
    await pool.query("INSERT INTO operator_content_rule_items(logical_id) VALUES ('r1')");
    await pool.query("INSERT INTO operator_content_rule_versions (id,logical_id,version,name,rule_type,patterns_json,semantic_categories_json,severity,platform,scope,guidance,status,actor_id,ever_published_at) VALUES ('r1','r1',1,'absolute','absolute','[\"literal-not-present\"]','[\"absolute\"]','block','douyin','all_copy','改成事实描述','published','op',CURRENT_TIMESTAMP)");
    const task = (await app.inject({ method: "POST", url: "/v1/stores/store_demo/content-tasks", payload: { persona: "owner", contentType: "store_story", style: "sincere", commercialLevel: 1 } })).json();
    const topics = (await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/topics/generate` })).json();
    const copies = (await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/topics/${topics[0].id}/copies/generate` })).json();
    const edited = await app.inject({ method: "PUT", url: `/v1/stores/store_demo/content-tasks/${task.id}/copies/${copies[0].id}`, payload: { title: "最好米线", body: "这是最好的一碗" } });
    expect(edited.statusCode).toBe(200);
    const confirm = await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/copies/${copies[0].id}/confirm` });
    expect(confirm.statusCode).toBe(422);
    expect(confirm.json().findings).toMatchObject([{ severity: "block", guidance: "改成事实描述", source: "semantic" }]);
    expect(vi.mocked(generator.generateStructured)).toHaveBeenCalledTimes(2);
  });

  it.skip("keeps every customer draft edit as immutable copy history (covered by REAL_POSTGRES_TEST_URL behavior tests)", async () => {
    const task = (await app.inject({ method: "POST", url: "/v1/stores/store_demo/content-tasks", payload: { persona: "owner", contentType: "store_story", style: "sincere", commercialLevel: 1 } })).json();
    const topics = (await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/topics/generate` })).json();
    const copy = (await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/topics/${topics[0].id}/copies/generate` })).json()[0];
    await app.inject({ method: "PUT", url: `/v1/stores/store_demo/content-tasks/${task.id}/copies/${copy.id}`, payload: { title: "修改标题", body: "修改文案" } });
    const history = await pool.query("SELECT version,title,body FROM content_task_copy_versions WHERE copy_id=$1 ORDER BY version", [copy.id]);
    expect(history.rows).toEqual([{ version: 1, title: "手艺版", body: "老板凌晨熬汤" }, { version: 2, title: "修改标题", body: "修改文案" }]);
  });

  it("persists a copy batch across a committed client transaction", async () => {
    await pool.query("INSERT INTO content_tasks(id,enterprise_id,store_id,actor_id,profile_version,profile_snapshot_json,stage_snapshot_json,template_snapshot_json,persona,content_type,style,commercial_level,status) VALUES ('diagnostic-task','ent_demo','store_demo','actor',1,'{}','{}','[]','owner','story','sincere',1,'topic_draft')");
    await pool.query("INSERT INTO content_task_topics(id,task_id,position,title,angle,product_reference,goal_reference,commercial_level) VALUES ('diagnostic-topic','diagnostic-task',1,'t','a','p','g',1)");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM content_tasks WHERE id='diagnostic-task' FOR UPDATE");
      await client.query("INSERT INTO content_task_copies(id,task_id,topic_id,position,title,body,strategy,product_reference,goal_reference,commercial_level) VALUES ('diagnostic-copy','diagnostic-task','diagnostic-topic',1,'t','b','s','p','g',1)");
      await client.query("INSERT INTO content_task_copy_versions(id,copy_id,version,title,body) VALUES ('diagnostic-copy-v1','diagnostic-copy',1,'t','b')");
      await client.query("COMMIT");
    } finally { client.release(); }
    expect((await pool.query("SELECT id FROM content_task_copies WHERE id='diagnostic-copy'")).rowCount).toBe(1);
    expect((await pool.query("SELECT id FROM content_task_copy_versions WHERE copy_id='diagnostic-copy'")).rowCount).toBe(1);
  });

  it("persists the complete copy batch shape used by the route", async () => {
    await generator.generateStructured({ requestId: "diagnostic", promptVersion: "content-copy-v1", commercialLevel: 1, input: {}, schema: { parse: value => value as never } });
    await pool.query("INSERT INTO content_tasks(id,enterprise_id,store_id,actor_id,profile_version,profile_snapshot_json,stage_snapshot_json,template_snapshot_json,persona,content_type,style,commercial_level,status) VALUES ('exact-task','ent_demo','store_demo','actor',1,'{}','{}','[]','owner','story','sincere',1,'topic_draft')");
    await Promise.all([1,2,3].map(position => pool.query("INSERT INTO content_task_topics(id,task_id,position,title,angle,product_reference,goal_reference,commercial_level) VALUES($1,'exact-task',$2,'老板早起','手艺','招牌米线','到店',1)",[position===1?'exact-topic':randomUUID(),position])));
    expect((await pool.query("SELECT id FROM content_task_topics WHERE id='exact-topic' AND task_id='exact-task'")).rowCount).toBe(1);
    const copyId=randomUUID(); const client=await pool.connect(); try { await client.query("BEGIN"); for(const [i, item] of [{title:'手艺版',body:'老板凌晨熬汤',strategy:'persona_story'},{title:'生活版',body:'午饭来碗热米线',strategy:'daily_life'},{title:'产品版',body:'招牌米线现煮',strategy:'product_value'}].entries()){const id=i===0?copyId:randomUUID(); const result=await client.query("INSERT INTO content_task_copies(id,task_id,topic_id,position,title,body,strategy,product_reference,goal_reference,commercial_level) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[id,'exact-task','exact-topic',i+1,item.title,item.body,item.strategy,'招牌米线','到店',1]); await client.query("INSERT INTO content_task_copy_versions(id,copy_id,version,title,body) VALUES($1,$2,1,$3,$4)",[randomUUID(),id,item.title,item.body]); expect(result.rowCount).toBe(1);} expect((await client.query("SELECT id FROM content_task_copies WHERE id=$1",[copyId])).rowCount).toBe(1); await client.query("COMMIT");
    } finally { client.release(); }
    expect((await pool.query("SELECT id FROM content_task_copies WHERE id=$1",[copyId])).rowCount).toBe(1);
  });

  it("returns an existing topic batch without calling the provider again and records a run", async () => {
    const task = (await app.inject({ method: "POST", url: "/v1/stores/store_demo/content-tasks", payload: { persona: "owner", contentType: "store_story", style: "sincere", commercialLevel: 1 } })).json();
    const first = await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/topics/generate` });
    const second = await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/topics/generate` });
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(vi.mocked(generator.generateStructured)).toHaveBeenCalledTimes(1);
    expect((await pool.query("SELECT kind,status,provider,model,prompt_version,usage_json,latency_ms FROM content_task_generation_runs WHERE task_id=$1", [task.id])).rows).toMatchObject([{ kind: "topics", status: "succeeded", provider: "deepseek", model: "test", prompt_version: "content-topic-v1", latency_ms: 1 }]);
    expect((await pool.query("SELECT * FROM content_task_generation_claims WHERE task_id=$1", [task.id])).rowCount).toBe(0);
  });

  it("does not call a provider while another request holds the generation claim", async () => {
    const task = (await app.inject({ method: "POST", url: "/v1/stores/store_demo/content-tasks", payload: { persona: "owner", contentType: "store_story", style: "sincere", commercialLevel: 1 } })).json();
    await pool.query("INSERT INTO content_task_generation_claims(task_id,kind) VALUES($1,'topics')", [task.id]);
    const response = await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/topics/generate` });
    expect(response.statusCode).toBe(409);
    expect(vi.mocked(generator.generateStructured)).not.toHaveBeenCalled();
  });

  it("records a failed generation and releases its claim for a later retry", async () => {
    vi.mocked(generator.generateStructured).mockRejectedValueOnce(new Error("upstream unavailable"));
    const task = (await app.inject({ method: "POST", url: "/v1/stores/store_demo/content-tasks", payload: { persona: "owner", contentType: "store_story", style: "sincere", commercialLevel: 1 } })).json();
    const failed = await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/topics/generate` });
    expect(failed.statusCode).toBe(500);
    expect((await pool.query("SELECT kind,status,provider,model,failure_code FROM content_task_generation_runs WHERE task_id=$1", [task.id])).rows).toMatchObject([{ kind: "topics", status: "failed", provider: "unknown", model: "unknown", failure_code: "Error" }]);
    expect((await pool.query("SELECT * FROM content_task_generation_claims WHERE task_id=$1", [task.id])).rowCount).toBe(0);
  });
});
