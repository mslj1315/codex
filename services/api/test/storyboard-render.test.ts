import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import { buildServer } from "../src/server.js";
import { InMemoryVideoStorage } from "../src/video-editing/storage.js";
import { StoryboardRenderWorker } from "../src/video-editing/worker.js";

const scope = { enterpriseId: "render-ent", storeId: "render-store", actorId: "render-customer" };

describe("storyboard render queue", () => {
  let database: Database;
  let app: ReturnType<typeof buildServer>;
  let storage: InMemoryVideoStorage;
  let taskId: string;
  let shotListId: string;
  let projectId: string;

  beforeEach(async () => {
    const memory = newDb({ noAstCoverageCheck: true });
    memory.public.registerFunction({ name: "jsonb_typeof", args: [DataType.jsonb], returns: DataType.text, implementation: value => Array.isArray(value) ? "array" : typeof value === "object" && value !== null ? "object" : typeof value });
    const { Pool } = memory.adapters.createPg(); database = new Pool();
    for (const file of ["001_imports.sql", "013_content_planning_profile.sql", "014_content_templates_rules.sql", "015_operator_accounts_sessions.sql", "016_operator_content_versions.sql", "017_douyin_official_connections.sql", "018_content_planning_workflow.sql", "019_storyboard_media_assets.sql", "020_storyboard_media_asset_hardening.sql", "021_storyboard_projects.sql", "022_storyboard_render_jobs.sql", "023_storyboard_render_lifecycle.sql"]) {
      const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
      await database.query(sql.replace(/CREATE OR REPLACE FUNCTION[\s\S]*$/, ""));
    }
    ({ taskId, shotListId, projectId } = await seed(database));
    storage = new InMemoryVideoStorage();
    app = buildServer({ database, trustedContextResolver: async () => scope, videoStorage: storage });
  });

  afterEach(async () => { await app.close(); });

  it("queues one immutable final render for a customer-confirmed project without exposing storage internals", async () => {
    const first = await app.inject({ method: "POST", url: `${path()}/projects/${projectId}/renders`, payload: { kind: "final" } });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toMatchObject({ id: expect.any(String), kind: "final", state: "queued", projectId, projectVersion: 1 });
    expect(JSON.stringify(first.json())).not.toMatch(/objectKey|storage|https?:\/\//i);
    expect((await app.inject({ method: "POST", url: `${path()}/projects/${projectId}/renders`, payload: { kind: "final" } })).statusCode).toBe(409);
  });

  it("rejects provider, operator, and another customer before render request parsing or queue work", async () => {
    for (const context of [{ ...scope, actorRole: "provider" as const }, { ...scope, actorRole: "operator_editor" as const }, { ...scope, actorId: "other-customer" }]) {
      const privileged = buildServer({ database, trustedContextResolver: async () => context, videoStorage: storage });
      const response = await privileged.inject({ method: "POST", url: `${path()}/projects/${projectId}/renders`, payload: [] });
      expect(response.statusCode).toBe(403);
      await privileged.close();
    }
    expect((await database.query("SELECT count(*)::int AS count FROM storyboard_render_jobs")).rows).toEqual([{ count: 0 }]);
  });

  it("worker completes an immutable final render with three distinct real frame candidates and cleans its workspace", async () => {
    const events: string[] = [];
    const repository = {
      claim: async () => ({ id: "job-1", kind: "final" as const, projectId, projectVersion: 1, durationSeconds: 12, subtitleText: ["only confirmed subtitle"], sourceKeys: ["source-object"] }),
      succeed: async (_id: string, result: unknown) => { events.push(`succeed:${JSON.stringify(result)}`); },
      fail: async () => { events.push("fail"); },
      isCancelled: async () => false
    };
    const worker = new StoryboardRenderWorker(repository, {
      create: async () => "work/job-1",
      remove: async path => { events.push(`remove:${path}`); }
    }, {
      download: async key => { events.push(`download:${key}`); return Buffer.from("source"); },
      putProtected: async (_key, _bytes, metadata) => { events.push(`output:${metadata.contentType}`); }
    }, {
      render: async manifest => { expect(manifest).toMatchObject({ width: 1080, height: 1920, fps: 30, durationSeconds: 12, subtitles: ["only confirmed subtitle"] }); return { output: Buffer.from("mp4"), metadata: { width: 1080, height: 1920, fps: 30, durationSeconds: 12, contentType: "video/mp4" }, coverFrames: [{ positionSeconds: 1, bytes: Buffer.from("a") }, { positionSeconds: 6, bytes: Buffer.from("b") }, { positionSeconds: 11, bytes: Buffer.from("c") } ] }; }
    });
    await worker.runOnce();
    expect(events).toContain("remove:work/job-1");
    expect(events.join("\n")).toContain("output:video/mp4");
    expect(events.find(event => event.startsWith("succeed:"))).toContain('"positionSeconds":1');
  });

  it("lets its customer list and cancel a queued render without exposing output storage", async () => {
    const created = await app.inject({ method: "POST", url: `${path()}/projects/${projectId}/renders`, payload: { kind: "preview" } });
    const listed = await app.inject({ method: "GET", url: `${path()}/projects/${projectId}/renders` });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ renders: [{ id: created.json().id, state: "queued" }] });
    const cancelled = await app.inject({ method: "POST", url: `${path()}/projects/${projectId}/renders/${created.json().id}/cancel`, payload: {} });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ id: created.json().id, state: "cancelled" });
    expect(JSON.stringify(cancelled.json())).not.toMatch(/objectKey|storage|https?:\/\//i);
  });

  it("lets only its customer delete a succeeded output and audits the protected cleanup", async () => {
    const created = await app.inject({ method: "POST", url: `${path()}/projects/${projectId}/renders`, payload: { kind: "final" } });
    await database.query("UPDATE storyboard_render_jobs SET state='succeeded',output_object_key=$2,output_expires_at=CURRENT_TIMESTAMP + interval '180 days',cover_candidates_json='[{\"positionSeconds\":1},{\"positionSeconds\":2},{\"positionSeconds\":3}]' WHERE id=$1", [created.json().id, `storyboard-render-output/${created.json().id}.mp4`]);
    await storage.putProtected(`storyboard-render-output/${created.json().id}.mp4`, Buffer.from("mp4"), { contentType: "video/mp4", expiresAt: new Date() });
    for (const context of [{ ...scope, actorRole: "provider" as const }, { ...scope, actorRole: "operator_editor" as const }, { ...scope, actorId: "other-customer" }]) {
      const forbidden = buildServer({ database, trustedContextResolver: async () => context, videoStorage: storage });
      expect((await forbidden.inject({ method: "DELETE", url: `${path()}/projects/${projectId}/renders/${created.json().id}`, payload: [] })).statusCode).toBe(403); await forbidden.close();
    }
    const removed = await app.inject({ method: "DELETE", url: `${path()}/projects/${projectId}/renders/${created.json().id}` }); expect(removed.statusCode, removed.body).toBe(204);
    expect((await database.query("SELECT reason FROM storyboard_render_output_deletions WHERE render_job_id=$1", [created.json().id])).rows).toEqual([{ reason: "customer_deleted" }]);
    expect((await app.inject({ method: "GET", url: `${path()}/projects/${projectId}/renders` })).json().renders).toEqual([]);
  });

  function path() { return `/v1/stores/${scope.storeId}/content-tasks/${taskId}/shot-lists/${shotListId}`; }
});

async function seed(database: Database) {
  const taskId = randomUUID(), topicId = randomUUID(), copyId = randomUUID(), shotListId = randomUUID(), assetId = randomUUID();
  const projectId = createHash("sha256").update(`${scope.enterpriseId}:${scope.storeId}:${taskId}:${shotListId}:${scope.actorId}`).digest("hex");
  await database.query("INSERT INTO content_tasks(id,enterprise_id,store_id,actor_id,profile_version,profile_snapshot_json,stage_snapshot_json,template_snapshot_json,persona,content_type,style,commercial_level,status,confirmed_copy_id) VALUES($1,$2,$3,$4,1,'{}','{}','[]','owner','story','sincere',1,'copy_confirmed',$5)", [taskId, scope.enterpriseId, scope.storeId, scope.actorId, copyId]);
  await database.query("INSERT INTO content_task_topics(id,task_id,position,title,angle,product_reference,goal_reference,commercial_level) VALUES($1,$2,1,'title','angle','product','goal',1)", [topicId, taskId]);
  await database.query("INSERT INTO content_task_copies(id,task_id,topic_id,position,title,body,strategy,product_reference,goal_reference,commercial_level,status,confirmed_at) VALUES($1,$2,$3,1,'title','body','strategy','product','goal',1,'confirmed',CURRENT_TIMESTAMP)", [copyId, taskId, topicId]);
  await database.query("INSERT INTO content_task_shot_lists(id,task_id,copy_id,shots_json) VALUES($1,$2,$3,$4)", [shotListId, taskId, copyId, JSON.stringify([{ order: 1, shot: "simmer", durationSeconds: 5, narration: "shot one" }])]);
  await database.query("INSERT INTO storyboard_projects(id,enterprise_id,store_id,task_id,shot_list_id,actor_id) VALUES($1,$2,$3,$4,$5,$6)", [projectId, scope.enterpriseId, scope.storeId, taskId, shotListId, scope.actorId]);
  await database.query("INSERT INTO storyboard_project_versions(id,project_id,version,status,slots_json,cover_title) VALUES($1,$2,1,'final',$3,'cover')", [randomUUID(), projectId, JSON.stringify([{ slotId: "shot-1", kind: "shot", shotIndex: 1, assetId, order: 1, trimStartSeconds: 0, trimEndSeconds: 5, muted: false, subtitleText: "subtitle", subtitleEnabled: true }])]);
  await database.query("INSERT INTO storyboard_media_assets(id,enterprise_id,store_id,task_id,shot_list_id,project_id,object_key,content_type,expected_size_bytes,size_bytes,duration_seconds,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,'source-object','video/mp4',1,1,10,'accepted',CURRENT_TIMESTAMP + interval '30 days')", [assetId, scope.enterpriseId, scope.storeId, taskId, shotListId, projectId]);
  return { taskId, shotListId, projectId };
}
