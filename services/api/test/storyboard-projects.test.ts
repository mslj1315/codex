import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { Database } from "../src/db.js";
import { InMemoryVideoStorage } from "../src/video-editing/storage.js";

const scope = { enterpriseId: "project-ent", storeId: "project-store", actorId: "project-customer" };

describe("storyboard editing projects", () => {
  let database: Database; let app: ReturnType<typeof buildServer>; let storage: InMemoryVideoStorage;
  let taskId: string; let shotListId: string; let assetId: string;

  beforeEach(async () => {
    const memory = newDb({ noAstCoverageCheck: true }); const { Pool } = memory.adapters.createPg(); database = new Pool();
    for (const file of ["001_imports.sql", "013_content_planning_profile.sql", "014_content_templates_rules.sql", "015_operator_accounts_sessions.sql", "016_operator_content_versions.sql", "017_douyin_official_connections.sql", "018_content_planning_workflow.sql", "019_storyboard_media_assets.sql", "020_storyboard_media_asset_hardening.sql", "021_storyboard_projects.sql"]) {
      const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"); await database.query(sql.replace(/CREATE OR REPLACE FUNCTION[\s\S]*$/, ""));
    }
    ({ taskId, shotListId, assetId } = await seed(database)); storage = new InMemoryVideoStorage();
    app = buildServer({ database, trustedContextResolver: async () => scope, videoStorage: storage });
  });
  afterEach(async () => { await app.close(); });

  it("creates a customer project only from a confirmed shot list and seeds editable subtitle drafts", async () => {
    const created = await create(); expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: expect.any(String), version: 1, status: "draft", slots: [{ slotId: "shot-1", subtitleText: "shot one" }], coverTitle: "signature noodles" });
    await database.query("UPDATE content_tasks SET status='copy_draft', confirmed_copy_id=NULL WHERE id=$1", [taskId]);
    expect((await create()).statusCode).toBe(409);
  });

  it("rejects provider/operator and another customer before project writes", async () => {
    const before = await database.query("SELECT count(*)::int AS count FROM storyboard_projects");
    for (const context of [{ ...scope, actorRole: "provider" as const }, { ...scope, actorRole: "operator_editor" as const }, { ...scope, actorId: "other-customer" }]) {
      const forbidden = buildServer({ database, trustedContextResolver: async () => context, videoStorage: storage });
      const response = await forbidden.inject({ method: "POST", url: `${path()}/projects`, payload: {} }); expect(response.statusCode, `${JSON.stringify(context)} ${response.body}`).toBe(403); await forbidden.close();
    }
    expect(await database.query("SELECT count(*)::int AS count FROM storyboard_projects")).toEqual(before);
  });

  it("validates selected assets, trims, order, audio, subtitles, supplemental slots, and the 90 second cap", async () => {
    const project = (await create()).json(); const update = (body: object) => app.inject({ method: "POST", url: `${path()}/projects/${project.id}/versions`, payload: body });
    const valid = { slots: [{ slotId: "shot-1", kind: "shot", shotIndex: 1, assetId, order: 1, trimStartSeconds: 1, trimEndSeconds: 5, muted: true, subtitleText: "edited subtitle" }, { slotId: "extra-1", kind: "supplemental", assetId, order: 2, trimStartSeconds: 5, trimEndSeconds: 10, muted: false, subtitleText: "supplemental" }] };
    expect((await update(valid)).statusCode).toBe(201);
    for (const invalid of [
      { ...valid, slots: [{ ...valid.slots[0], trimEndSeconds: 11 }] },
      { ...valid, slots: [{ ...valid.slots[0], order: 0 }] },
      { ...valid, slots: [{ ...valid.slots[0], muted: "no" }] },
      { ...valid, slots: [{ ...valid.slots[0], subtitleText: "" }] },
      { ...valid, slots: [{ ...valid.slots[0], assetId: "outside" }] },
      { ...valid, slots: Array.from({ length: 10 }, (_, index) => ({ ...valid.slots[0], slotId: `s-${index}`, kind: "supplemental", shotIndex: undefined, order: index + 1, trimStartSeconds: 0, trimEndSeconds: 10 })) }
    ]) expect((await update(invalid)).statusCode).toBe(422);
  });

  it("preserves version history, makes finalized versions immutable, and persists cover state", async () => {
    const project = (await create()).json(); const body = { slots: [{ slotId: "shot-1", kind: "shot", shotIndex: 1, assetId, order: 1, trimStartSeconds: 0, trimEndSeconds: 4, muted: false, subtitleText: "subtitle" }], coverAssetId: assetId, coverTitle: "today's signature", finalize: true };
    const final = await app.inject({ method: "POST", url: `${path()}/projects/${project.id}/versions`, payload: body }); expect(final.statusCode).toBe(201); expect(final.json()).toMatchObject({ version: 2, status: "final", coverAssetId: assetId, coverTitle: "today's signature" });
    expect((await app.inject({ method: "POST", url: `${path()}/projects/${project.id}/versions`, payload: body })).statusCode).toBe(409);
    const history = await app.inject({ method: "GET", url: `${path()}/projects/${project.id}` }); expect(history.statusCode).toBe(200); expect(history.json().versions).toHaveLength(2);
  });

  function path() { return `/v1/stores/${scope.storeId}/content-tasks/${taskId}/shot-lists/${shotListId}`; }
  function create() { return app.inject({ method: "POST", url: `${path()}/projects`, payload: {} }); }
});

async function seed(database: Database) {
  const taskId = randomUUID(), topicId = randomUUID(), copyId = randomUUID(), shotListId = randomUUID(), assetId = randomUUID();
  const projectId = createHash("sha256").update(`${scope.enterpriseId}:${scope.storeId}:${taskId}:${shotListId}:${scope.actorId}`).digest("hex");
  await database.query("INSERT INTO content_tasks(id,enterprise_id,store_id,actor_id,profile_version,profile_snapshot_json,stage_snapshot_json,template_snapshot_json,persona,content_type,style,commercial_level,status,confirmed_copy_id) VALUES($1,$2,$3,$4,1,'{}','{}','[]','owner','story','sincere',1,'copy_confirmed',$5)", [taskId, scope.enterpriseId, scope.storeId, scope.actorId, copyId]);
  await database.query("INSERT INTO content_task_topics(id,task_id,position,title,angle,product_reference,goal_reference,commercial_level) VALUES($1,$2,1,'title','angle','product','goal',1)", [topicId, taskId]);
  await database.query("INSERT INTO content_task_copies(id,task_id,topic_id,position,title,body,strategy,product_reference,goal_reference,commercial_level,status,confirmed_at) VALUES($1,$2,$3,1,'signature noodles','confirmed copy','strategy','product','goal',1,'confirmed',CURRENT_TIMESTAMP)", [copyId, taskId, topicId]);
  await database.query("INSERT INTO content_task_shot_lists(id,task_id,copy_id,shots_json) VALUES($1,$2,$3,$4)", [shotListId, taskId, copyId, JSON.stringify([{ order: 1, shot: "simmer", durationSeconds: 5, narration: "shot one" }])]);
  await database.query("INSERT INTO storyboard_media_assets(id,enterprise_id,store_id,task_id,shot_list_id,project_id,object_key,content_type,expected_size_bytes,size_bytes,duration_seconds,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,'object','video/mp4',1,1,10,'accepted',CURRENT_TIMESTAMP + interval '30 days')", [assetId, scope.enterpriseId, scope.storeId, taskId, shotListId, projectId]);
  return { taskId, shotListId, assetId };
}
