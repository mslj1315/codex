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
    ] : [{ order: 1, shot: "熬汤锅", durationSeconds: 3, narration: "凌晨开始熬汤", productReference: "招牌米线", goalReference: "到店", commercialLevel: 1 }] } as never));
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

  it("requires a confirmed, clean copy before generating immutable shots", async () => {
    const task = (await app.inject({ method: "POST", url: "/v1/stores/store_demo/content-tasks", payload: { persona: "owner", contentType: "store_story", style: "sincere", commercialLevel: 1 } })).json();
    const topics = (await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/topics/generate` })).json();
    const copies = await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/topics/${topics[0].id}/copies/generate` });
    expect(copies.statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/shots/generate` })).statusCode).toBe(409);
    const copy = copies.json()[0];
    expect((await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/copies/${copy.id}/confirm` })).statusCode).toBe(200);
    const shots = await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/shots/generate` });
    expect(shots.statusCode).toBe(201);
    expect(shots.json()).toMatchObject({ copyId: copy.id, status: "draft" });
  });

  it("blocks confirmation when a published deterministic rule matches and never exposes drafts to providers", async () => {
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

  it("keeps every customer draft edit as immutable copy history", async () => {
    const task = (await app.inject({ method: "POST", url: "/v1/stores/store_demo/content-tasks", payload: { persona: "owner", contentType: "store_story", style: "sincere", commercialLevel: 1 } })).json();
    const topics = (await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/topics/generate` })).json();
    const copy = (await app.inject({ method: "POST", url: `/v1/stores/store_demo/content-tasks/${task.id}/topics/${topics[0].id}/copies/generate` })).json()[0];
    await app.inject({ method: "PUT", url: `/v1/stores/store_demo/content-tasks/${task.id}/copies/${copy.id}`, payload: { title: "修改标题", body: "修改文案" } });
    const history = await pool.query("SELECT version,title,body FROM content_task_copy_versions WHERE copy_id=$1 ORDER BY version", [copy.id]);
    expect(history.rows).toEqual([{ version: 1, title: "手艺版", body: "老板凌晨熬汤" }, { version: 2, title: "修改标题", body: "修改文案" }]);
  });
});
