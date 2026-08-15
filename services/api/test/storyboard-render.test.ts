import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DataType, newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import { buildServer } from "../src/server.js";
import { InMemoryVideoStorage } from "../src/video-editing/storage.js";
import { StoryboardRenderWorker } from "../src/video-editing/worker.js";
import { RenderArtifactCleanupRunner } from "../src/video-editing/render-cleanup.js";
import { DatabaseRenderWorkerRepository, RenderRepository } from "../src/video-editing/render-repository.js";

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
    for (const file of ["001_imports.sql", "013_content_planning_profile.sql", "014_content_templates_rules.sql", "015_operator_accounts_sessions.sql", "016_operator_content_versions.sql", "017_douyin_official_connections.sql", "018_content_planning_workflow.sql", "019_storyboard_media_assets.sql", "020_storyboard_media_asset_hardening.sql", "021_storyboard_projects.sql", "022_storyboard_render_jobs.sql", "023_storyboard_render_lifecycle.sql", "024_storyboard_render_artifacts.sql", "025_storyboard_render_leases.sql", "026_storyboard_render_delivery.sql"]) {
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
      downloadToFile: async (key, _destinationPath) => { events.push(`download:${key}`); },
      putProtectedFile: async (_key, _sourcePath, metadata) => { events.push(`output:${metadata.contentType}`); }
    }, {
      render: async manifest => { expect(manifest).toMatchObject({ width: 1080, height: 1920, fps: 30, durationSeconds: 12, subtitles: ["only confirmed subtitle"] }); return { outputPath: "work/job-1/output.mp4", metadata: { width: 1080, height: 1920, fps: 30, durationSeconds: 12, contentType: "video/mp4" }, coverPaths: [{ positionSeconds: 1, path: "work/job-1/cover-1.jpg" }, { positionSeconds: 6, path: "work/job-1/cover-2.jpg" }, { positionSeconds: 11, path: "work/job-1/cover-3.jpg" } ] }; }
    });
    await worker.runOnce();
    expect(events).toContain("remove:work/job-1");
    expect(events.join("\n")).toContain("output:video/mp4");
    expect(events.filter(event => event === "output:image/jpeg")).toHaveLength(3);
    expect(events.find(event => event.startsWith("succeed:"))).toContain('"positionSeconds":1');
  });

  it("downloads each unique source to a controlled path sequentially and gives paths to the runner", async () => {
    let activeDownloads = 0; let maxDownloads = 0; let resolveFirst!: () => void;
    const firstDownload = new Promise<void>(resolve => { resolveFirst = resolve; });
    const runnerManifests: unknown[] = [];
    const worker = new StoryboardRenderWorker({
      claim: async () => ({ id: "sequential-sources", kind: "final" as const, projectId, projectVersion: 1, durationSeconds: 4, subtitleText: [], sourceKeys: ["source-a", "source-b"] }),
      succeed: async () => {}, fail: async () => {}, isCancelled: async () => false
    }, { create: async () => "workspace", remove: async () => {} }, {
      downloadToFile: async (key, destinationPath) => {
        activeDownloads++; maxDownloads = Math.max(maxDownloads, activeDownloads);
        if (key === "source-a") await firstDownload;
        activeDownloads--;
        expect(destinationPath).toMatch(/^workspace[\\/]source-[12]\.mp4$/);
      },
      putProtectedFile: async () => {}
    }, {
      render: async manifest => { runnerManifests.push(manifest); return { outputPath: "workspace/output.mp4", metadata: { width: 1080, height: 1920, fps: 30, durationSeconds: 4, contentType: "video/mp4" }, coverPaths: [{ positionSeconds: 1, path: "workspace/cover-1.jpg" }, { positionSeconds: 2, path: "workspace/cover-2.jpg" }, { positionSeconds: 3, path: "workspace/cover-3.jpg" }] }; }
    });
    const running = worker.runOnce();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(maxDownloads).toBe(1);
    resolveFirst();
    await running;
    expect(maxDownloads).toBe(1);
    expect(runnerManifests).toEqual([expect.objectContaining({ sourcePaths: [join("workspace", "source-1.mp4"), join("workspace", "source-2.mp4")] })]);
  });

  it("removes protected output when cancellation wins after the write", async () => {
    let cancelledChecks = 0; const events: string[] = [];
    const worker = new StoryboardRenderWorker({ claim: async () => ({ id: "cancel-after-write", kind: "final", projectId, projectVersion: 1, durationSeconds: 4, subtitleText: [], sourceKeys: ["source"] }), isCancelled: async () => ++cancelledChecks >= 3, succeed: async () => { events.push("succeed"); }, fail: async () => { events.push("fail"); } }, { create: async () => "workspace", remove: async () => {} }, { downloadToFile: async () => {}, putProtectedFile: async key => { events.push(`put:${key}`); }, deleteProtected: async key => { events.push(`delete:${key}`); } }, { render: async () => ({ outputPath: "workspace/output.mp4", metadata: { width: 1080, height: 1920, fps: 30, durationSeconds: 4, contentType: "video/mp4" }, coverPaths: [{ positionSeconds: 1, path: "workspace/cover-1.jpg" }, { positionSeconds: 2, path: "workspace/cover-2.jpg" }, { positionSeconds: 3, path: "workspace/cover-3.jpg" }] }) });
    await worker.runOnce();
    expect(events).toContain("delete:storyboard-render-output/cancel-after-write.mp4");
    expect(events).not.toContain("succeed");
  });

  it("renews the token lease while a render is still running", async () => {
    let finish!: () => void; const renewals: string[] = []; let tick: (() => Promise<void>) | undefined;
    const worker = new StoryboardRenderWorker({ claim: async () => ({ id: "long-render", kind: "final", projectId, projectVersion: 1, durationSeconds: 4, subtitleText: [], sourceKeys: ["source"], leaseToken: "lease" }), renewLease: async (_id, token) => { renewals.push(token); return true; }, isCancelled: async () => false, succeed: async () => {}, fail: async () => {} }, { create: async () => "workspace", remove: async () => {} }, { downloadToFile: async () => {}, putProtectedFile: async () => {} }, { render: async () => await new Promise(resolve => { finish = () => resolve({ outputPath: "workspace/output.mp4", metadata: { width: 1080, height: 1920, fps: 30, durationSeconds: 4, contentType: "video/mp4" }, coverPaths: [{ positionSeconds: 1, path: "workspace/cover-1.jpg" }, { positionSeconds: 2, path: "workspace/cover-2.jpg" }, { positionSeconds: 3, path: "workspace/cover-3.jpg" }] }); }) }, undefined, { start: callback => { tick = callback; return () => {}; } });
    const running = worker.runOnce(); while (!finish) await new Promise(resolve => setTimeout(resolve, 0)); await tick!(); finish(); await running;
    expect(renewals).toEqual(["lease"]);
  });

  it("contains a rejected heartbeat renewal and does not write output", async () => {
    let tick: (() => Promise<void>) | undefined; const events: string[] = [];
    const worker = new StoryboardRenderWorker({ claim: async () => ({ id: "renew-fail", kind: "final", projectId, projectVersion: 1, durationSeconds: 4, subtitleText: [], sourceKeys: ["source"], leaseToken: "lease" }), renewLease: async () => { throw new Error("transport"); }, isCancelled: async () => false, succeed: async () => { events.push("succeed"); }, fail: async () => { events.push("fail"); } }, { create: async () => "workspace", remove: async () => {} }, { downloadToFile: async () => {}, putProtectedFile: async () => { events.push("put"); } }, { render: async () => { await tick!(); return { outputPath: "workspace/output.mp4", metadata: { width: 1080, height: 1920, fps: 30, durationSeconds: 4, contentType: "video/mp4" }, coverPaths: [{ positionSeconds: 1, path: "workspace/cover-1.jpg" }, { positionSeconds: 2, path: "workspace/cover-2.jpg" }, { positionSeconds: 3, path: "workspace/cover-3.jpg" }] }; } }, undefined, { start: callback => { tick = callback; return () => { events.push("stop"); }; } });
    await worker.runOnce();
    expect(events).toEqual(["fail", "stop"]);
  });

  it("stops the heartbeat when workspace creation fails", async () => {
    const events: string[] = [];
    const worker = new StoryboardRenderWorker({ claim: async () => ({ id: "workspace-fail", kind: "final", projectId, projectVersion: 1, durationSeconds: 4, subtitleText: [], sourceKeys: [], leaseToken: "lease" }), renewLease: async () => true, isCancelled: async () => false, succeed: async () => {}, fail: async () => { events.push("fail"); } }, { create: async () => { throw new Error("disk"); }, remove: async () => {} }, { downloadToFile: async () => {}, putProtectedFile: async () => {} }, { render: async () => { throw new Error("unreachable"); } }, undefined, { start: () => () => { events.push("stop"); } });
    await worker.runOnce();
    expect(events).toEqual(["fail", "stop"]);
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
    await storage.putProtectedFile(`storyboard-render-output/${created.json().id}.mp4`, "fixture.mp4", { contentType: "video/mp4", expiresAt: new Date() });
    for (const context of [{ ...scope, actorRole: "provider" as const }, { ...scope, actorRole: "operator_editor" as const }, { ...scope, actorId: "other-customer" }]) {
      const forbidden = buildServer({ database, trustedContextResolver: async () => context, videoStorage: storage });
      expect((await forbidden.inject({ method: "DELETE", url: `${path()}/projects/${projectId}/renders/${created.json().id}`, payload: [] })).statusCode).toBe(403); await forbidden.close();
    }
    const removed = await app.inject({ method: "DELETE", url: `${path()}/projects/${projectId}/renders/${created.json().id}` }); expect(removed.statusCode, removed.body).toBe(204);
    expect((await database.query("SELECT reason FROM storyboard_render_output_deletions WHERE render_job_id=$1", [created.json().id])).rows).toEqual([{ reason: "customer_deleted" }]);
    expect((await app.inject({ method: "GET", url: `${path()}/projects/${projectId}/renders` })).json().renders).toEqual([]);
  });

  it("streams only a scoped, unexpired succeeded output and opaque cover candidate bytes", async () => {
    const created = await app.inject({ method: "POST", url: `${path()}/projects/${projectId}/renders`, payload: { kind: "final" } });
    const id = created.json().id;
    await database.query("UPDATE storyboard_render_jobs SET state='succeeded',output_object_key=$2,output_expires_at='2099-01-01T00:00:00.000Z',cover_candidates_json='[{\"positionSeconds\":1},{\"positionSeconds\":2},{\"positionSeconds\":3}]' WHERE id=$1", [id, `storyboard-render-output/${id}.mp4`]);
    await database.query("INSERT INTO storyboard_render_artifacts(id,render_job_id,object_key,kind) VALUES('output-artifact',$1,$2,'video'),('cover-one',$1,$3,'cover'),('cover-two',$1,$4,'cover'),('cover-three',$1,$5,'cover')", [id, `storyboard-render-output/${id}.mp4`, `storyboard-render-output/${id}-cover-1.jpg`, `storyboard-render-output/${id}-cover-2.jpg`, `storyboard-render-output/${id}-cover-3.jpg`]);
    await storage.putProtectedFile(`storyboard-render-output/${id}.mp4`, "fixture.mp4", { contentType: "video/mp4", expiresAt: new Date() });
    await storage.putProtectedFile(`storyboard-render-output/${id}-cover-1.jpg`, "fixture.jpg", { contentType: "image/jpeg", expiresAt: new Date() });
    const output = await app.inject({ method: "GET", url: `${path()}/projects/${projectId}/renders/${id}/output` });
    expect(output.statusCode, output.body).toBe(200);
    expect(output.headers["content-type"]).toContain("video/mp4");
    expect(output.headers["content-disposition"]).toContain("attachment");
    expect(output.body).toBe("protected");
    const cover = await app.inject({ method: "GET", url: `${path()}/projects/${projectId}/renders/${id}/cover-candidates/cover-one` });
    expect(cover.statusCode).toBe(200); expect(cover.headers["content-type"]).toContain("image/jpeg"); expect(cover.body).toBe("protected");
  });

  it("rejects delivery before storage for malformed, expired, foreign, and provider requests", async () => {
    const calls: string[] = []; const guarded = Object.assign(storage, { streamProtected: async (key: string) => { calls.push(key); throw new Error("must not stream"); } });
    const created = await app.inject({ method: "POST", url: `${path()}/projects/${projectId}/renders`, payload: { kind: "preview" } });
    await database.query("UPDATE storyboard_render_jobs SET state='succeeded',output_object_key='x',output_expires_at=CURRENT_TIMESTAMP - interval '1 second',cover_candidates_json='[]' WHERE id=$1", [created.json().id]);
    const expiredApp = buildServer({ database, trustedContextResolver: async () => scope, videoStorage: guarded });
    expect((await expiredApp.inject({ method: "GET", url: `${path()}/projects/${projectId}/renders/${created.json().id}/output` })).statusCode).toBe(404); await expiredApp.close();
    for (const context of [{ ...scope, actorRole: "provider" as const }, { ...scope, actorId: "other-customer" }]) { const forbidden = buildServer({ database, trustedContextResolver: async () => context, videoStorage: guarded }); expect((await forbidden.inject({ method: "GET", url: `${path()}/projects/${projectId}/renders/not-a-real-id/output` })).statusCode).toBe(403); await forbidden.close(); }
    expect(calls).toEqual([]);
  });

  it("does not delete another project render through a customer-owned project path", async () => {
    await database.query("INSERT INTO storyboard_projects(id,enterprise_id,store_id,task_id,shot_list_id,actor_id) VALUES('other-project',$1,$2,$3,$4,'other-customer')", [scope.enterpriseId, scope.storeId, taskId, shotListId]);
    await database.query("INSERT INTO storyboard_render_jobs(id,enterprise_id,store_id,task_id,shot_list_id,project_id,project_version,kind,state,output_object_key,output_expires_at,cover_candidates_json) VALUES('other-render',$1,$2,$3,$4,'other-project',1,'final','succeeded','other-output',CURRENT_TIMESTAMP + interval '180 days','[]')", [scope.enterpriseId, scope.storeId, taskId, shotListId]);
    const response = await app.inject({ method: "DELETE", url: `${path()}/projects/${projectId}/renders/other-render` });
    expect(response.statusCode, response.body).toBe(404);
    expect((await database.query("SELECT deleted_at FROM storyboard_render_jobs WHERE id='other-render'")).rows[0].deleted_at).toBeNull();
  });

  it("does not delete a non-succeeded render", async () => {
    const created = await app.inject({ method: "POST", url: `${path()}/projects/${projectId}/renders`, payload: { kind: "final" } });
    expect((await app.inject({ method: "DELETE", url: `${path()}/projects/${projectId}/renders/${created.json().id}` })).statusCode).toBe(404);
  });

  it("persists render artifacts separately so cleanup does not derive customer-visible storage identifiers", async () => {
    const columns = await database.query("SELECT column_name FROM information_schema.columns WHERE table_name='storyboard_render_artifacts'");
    expect(columns.rows.map(row => row.column_name)).toEqual(expect.arrayContaining(["render_job_id", "object_key", "kind", "deleted_at", "next_cleanup_attempt_at"]));
  });

  it("claims and deletes one due artifact idempotently while retaining retryable failures", async () => {
    const events: string[] = [];
    const cleanup = new RenderArtifactCleanupRunner({
      claimDue: async () => events.includes("claimed") ? undefined : (events.push("claimed"), { id: "artifact-1", objectKey: "internal" }),
      markDeleted: async () => { events.push("deleted"); },
      retry: async () => { events.push("retry"); }
    }, { deleteProtected: async () => { events.push("storage-delete"); } });
    await cleanup.runOnce(); await cleanup.runOnce();
    expect(events).toEqual(["claimed", "storage-delete", "deleted"]);
  });

  it("database worker repository leases, succeeds with artifacts, retries infrastructure failures, and terminals validation failures", async () => {
    const now = new Date("2026-08-15T00:00:00.000Z");
    const repository = new DatabaseRenderWorkerRepository(database, () => now);
    await database.query("INSERT INTO storyboard_render_jobs(id,enterprise_id,store_id,task_id,shot_list_id,project_id,project_version,kind,state) VALUES('job-success',$1,$2,$3,$4,$5,1,'final','queued')", [scope.enterpriseId, scope.storeId, taskId, shotListId, projectId]);
    const claimed = await repository.claim();
    expect(claimed?.id).toBe("job-success");
    expect(claimed?.leaseToken).toEqual(expect.any(String));
    expect(claimed?.slots).toEqual([{ sourceKey: "source-object", trimStartSeconds: 0, trimEndSeconds: 5, muted: false, subtitleText: "subtitle", subtitleEnabled: true }]);
    expect((await database.query("SELECT state,attempt_count FROM storyboard_render_jobs WHERE id='job-success'")).rows).toEqual([{ state: "processing", attempt_count: 1 }]);
    await repository.succeed("job-success", { outputExpiresAt: new Date("2027-02-11T00:00:00.000Z"), coverCandidates: [{ positionSeconds: 1 }, { positionSeconds: 2 }, { positionSeconds: 3 }], artifacts: [{ objectKey: "output", kind: "video" }, { objectKey: "cover-1", kind: "cover" }, { objectKey: "cover-2", kind: "cover" }, { objectKey: "cover-3", kind: "cover" }] });
    expect((await database.query("SELECT kind FROM storyboard_render_artifacts WHERE render_job_id='job-success' ORDER BY kind")).rows).toHaveLength(4);
    await database.query("UPDATE storyboard_render_jobs SET output_expires_at=$2 WHERE id='job-success'", ["job-success", now]);
    const cleanupRepository = new RenderRepository(database).cleanupRepository(() => now);
    for (let artifact = await cleanupRepository.claimDue(); artifact; artifact = await cleanupRepository.claimDue()) await cleanupRepository.markDeleted(artifact.id);
    expect((await database.query("SELECT deleted_at FROM storyboard_render_jobs WHERE id='job-success'")).rows[0].deleted_at).not.toBeNull();
    expect((await database.query("SELECT reason FROM storyboard_render_output_deletions WHERE render_job_id='job-success'")).rows).toEqual([{ reason: "retention_expired" }]);
    await database.query("INSERT INTO storyboard_render_jobs(id,enterprise_id,store_id,task_id,shot_list_id,project_id,project_version,kind,state) VALUES('job-retry',$1,$2,$3,$4,$5,1,'final','processing')", [scope.enterpriseId, scope.storeId, taskId, shotListId, projectId]); await repository.fail("job-retry", "infrastructure_unavailable", true);
    expect((await database.query("SELECT state,next_attempt_at FROM storyboard_render_jobs WHERE id='job-retry'")).rows[0].state).toBe("queued");
    await database.query("UPDATE storyboard_render_jobs SET state='cancelled' WHERE id='job-retry'"); await database.query("INSERT INTO storyboard_render_jobs(id,enterprise_id,store_id,task_id,shot_list_id,project_id,project_version,kind,state) VALUES('job-terminal',$1,$2,$3,$4,$5,1,'final','processing')", [scope.enterpriseId, scope.storeId, taskId, shotListId, projectId]); await repository.fail("job-terminal", "render_validation_failed", false);
    expect((await database.query("SELECT state,error_message FROM storyboard_render_jobs WHERE id='job-terminal'")).rows[0]).toMatchObject({ state: "failed", error_message: "render_validation_failed" });
  });

  it("uses one transaction for the lease-guarded success transition and artifacts", async () => {
    await database.query("INSERT INTO storyboard_render_jobs(id,enterprise_id,store_id,task_id,shot_list_id,project_id,project_version,kind,state,lease_token,lease_expires_at) VALUES('atomic-fail',$1,$2,$3,$4,$5,1,'final','processing','lease','2099-01-01T00:00:00.000Z')", [scope.enterpriseId, scope.storeId, taskId, shotListId, projectId]);
    const repository = new DatabaseRenderWorkerRepository(database, () => new Date("2026-08-15T00:00:00.000Z"));
    const queries: string[] = [];
    const originalQuery = database.query.bind(database);
    database.query = (async (...args: Parameters<typeof database.query>) => { queries.push(String(args[0])); return originalQuery(...args); }) as typeof database.query;
    await expect(repository.succeed("atomic-fail", { outputExpiresAt: new Date("2027-02-11T00:00:00.000Z"), coverCandidates: [{ positionSeconds: 1 }, { positionSeconds: 2 }, { positionSeconds: 3 }], artifacts: [{ objectKey: "duplicate", kind: "video" }, { objectKey: "duplicate", kind: "cover" }] }, "lease")).rejects.toThrow();
    expect(queries).toEqual(expect.arrayContaining(["BEGIN", "ROLLBACK"]));
    expect(queries.find(query => query.startsWith("UPDATE storyboard_render_jobs"))).toContain("lease_token=$5");
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
