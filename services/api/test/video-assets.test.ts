import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { Database } from "../src/db.js";
import { InMemoryVideoStorage } from "../src/video-editing/storage.js";

const scope = { enterpriseId: "media-ent", storeId: "media-store", actorId: "media-actor" };
const maxAssetBytes = 500 * 1024 * 1024;

describe("storyboard media assets", () => {
  let database: Database;
  let storage: InMemoryVideoStorage;
  let app: ReturnType<typeof buildServer>;
  let taskId: string;
  let shotListId: string;
  let projectId: string;

  beforeEach(async () => {
    const memory = newDb({ noAstCoverageCheck: true });
    const { Pool } = memory.adapters.createPg();
    database = new Pool();
    for (const file of ["001_imports.sql", "013_content_planning_profile.sql", "014_content_templates_rules.sql", "015_operator_accounts_sessions.sql", "016_operator_content_versions.sql", "017_douyin_official_connections.sql", "018_content_planning_workflow.sql", "019_storyboard_media_assets.sql", "020_storyboard_media_asset_hardening.sql"]) {
      const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
      await database.query(sql.replace(/CREATE OR REPLACE FUNCTION[\s\S]*$/, ""));
    }
    ({ taskId, shotListId, projectId } = await seedConfirmedShotList(database));
    storage = new InMemoryVideoStorage();
    app = buildServer({ database, trustedContextResolver: async () => scope, videoStorage: storage });
  });

  it("issues a scoped one-use upload grant only after a confirmed shot list, then verifies storage metadata before accepting the source", async () => {
    const grant = await requestGrant();
    expect(grant.statusCode).toBe(201);
    expect(grant.json()).toMatchObject({ assetId: expect.any(String), expiresAt: expect.any(String), upload: { method: "PUT", url: expect.any(String) } });
    expect(JSON.stringify(grant.json())).not.toMatch(/secret|credential|accessKey/i);

    const first = grant.json();
    await storage.put(first.objectKey, { sizeBytes: 10_000, contentType: "video/mp4", durationSeconds: 8 });
    const accepted = await app.inject({ method: "POST", url: `/v1/stores/${scope.storeId}/content-tasks/${taskId}/shot-lists/${shotListId}/assets/${first.assetId}/complete` });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({ id: first.assetId, projectId: first.projectId, sizeBytes: 10_000, durationSeconds: 8, expiresAt: expect.any(String) });
    expect((await app.inject({ method: "POST", url: `/v1/stores/${scope.storeId}/content-tasks/${taskId}/shot-lists/${shotListId}/assets/${first.assetId}/complete` })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: `/v1/stores/${scope.storeId}/content-tasks/${taskId}/shot-lists/${shotListId}/assets/${first.assetId}` })).statusCode).toBe(204);
    expect(await storage.inspect(first.objectKey)).toBeUndefined();
    expect((await database.query("SELECT reason,actor_id FROM storyboard_media_asset_deletions WHERE asset_id=$1", [first.assetId])).rows).toEqual([{ reason: "customer_deleted", actor_id: scope.actorId }]);
  });

  it("rejects an unconfirmed shot list and all provider/operator callers before granting or exposing assets", async () => {
    await database.query("UPDATE content_tasks SET status='topic_draft',confirmed_copy_id=NULL WHERE id=$1", [taskId]);
    expect((await requestGrant()).statusCode).toBe(409);
    await database.query("UPDATE content_tasks SET status='copy_confirmed',confirmed_copy_id=(SELECT copy_id FROM content_task_shot_lists WHERE id=$1) WHERE id=$2", [shotListId, taskId]);
    for (const actorRole of ["provider", "operator_editor", "operator_reviewer"] as const) {
      const privileged = buildServer({ database, trustedContextResolver: async () => ({ ...scope, actorRole }), videoStorage: storage });
      expect((await privileged.inject({ method: "POST", url: `/v1/stores/${scope.storeId}/content-tasks/${taskId}/shot-lists/${shotListId}/assets/upload-grants`, payload: grantBody(projectId) })).statusCode).toBe(403);
      await privileged.close();
    }
  });

  it("denies another customer in the same enterprise and store without creating an asset or upload session", async () => {
    const before = await database.query("SELECT count(*)::int AS count FROM storyboard_media_assets");
    const otherCustomer = buildServer({ database, trustedContextResolver: async () => ({ ...scope, actorId: "other-customer" }), videoStorage: storage });
    const response = await otherCustomer.inject({ method: "POST", url: `/v1/stores/${scope.storeId}/content-tasks/${taskId}/shot-lists/${shotListId}/assets/upload-grants`, payload: { expectedSizeBytes: 10_000, contentType: "video/mp4" } });
    expect(response.statusCode).toBe(403);
    expect(await database.query("SELECT count(*)::int AS count FROM storyboard_media_assets")).toEqual(before);
    await otherCustomer.close();
  });

  it("denies another customer from deleting an asset in the same enterprise and store", async () => {
    const grant = await requestGrant();
    const otherCustomer = buildServer({ database, trustedContextResolver: async () => ({ ...scope, actorId: "other-customer" }), videoStorage: storage });
    expect((await otherCustomer.inject({ method: "DELETE", url: `/v1/stores/${scope.storeId}/content-tasks/${taskId}/shot-lists/${shotListId}/assets/${grant.json().assetId}` })).statusCode).toBe(403);
    expect((await database.query("SELECT status FROM storyboard_media_assets WHERE id=$1", [grant.json().assetId])).rows).toEqual([{ status: "upload_pending" }]);
    await otherCustomer.close();
  });

  it("enforces project scope, 20 files, 500MB per file, and ten minutes of verified total duration", async () => {
    expect((await requestGrant({ expectedSizeBytes: maxAssetBytes + 1 })).statusCode).toBe(422);
    const first = await requestGrant(); const serverProjectId = first.json().projectId;
    for (let index = 1; index <= 19; index++) await database.query("INSERT INTO storyboard_media_assets(id,enterprise_id,store_id,task_id,shot_list_id,project_id,object_key,content_type,expected_size_bytes,size_bytes,duration_seconds,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'video/mp4',1,1,1,'accepted',CURRENT_TIMESTAMP + interval '30 days')", [`asset-${index}`, scope.enterpriseId, scope.storeId, taskId, shotListId, serverProjectId, `already-${index}`]);
    expect((await requestGrant()).statusCode).toBe(409);
    expect((await requestGrant({ projectId: randomUUID() })).statusCode).toBe(409);
    await database.query("DELETE FROM storyboard_media_upload_grants");
    await database.query("DELETE FROM storyboard_media_assets");
    await database.query("INSERT INTO storyboard_media_assets(id,enterprise_id,store_id,task_id,shot_list_id,project_id,object_key,content_type,expected_size_bytes,size_bytes,duration_seconds,status,expires_at) VALUES('long',$1,$2,$3,$4,$5,'long','video/mp4',1,1,600,'accepted',CURRENT_TIMESTAMP + interval '30 days')", [scope.enterpriseId, scope.storeId, taskId, shotListId, serverProjectId]);
    const grant = await requestGrant();
    await storage.put(grant.json().objectKey, { sizeBytes: 1, contentType: "video/mp4", durationSeconds: 1 });
    expect((await app.inject({ method: "POST", url: `/v1/stores/${scope.storeId}/content-tasks/${taskId}/shot-lists/${shotListId}/assets/${grant.json().assetId}/complete` })).statusCode).toBe(422);
  });

  it("rejects expired grants and audits retention cleanup after deleting its protected object", async () => {
    const grant = await requestGrant();
    await database.query("UPDATE storyboard_media_upload_grants SET expires_at=$1 WHERE asset_id=$2", [new Date(Date.now() - 1_000), grant.json().assetId]);
    await database.query("UPDATE storyboard_media_assets SET expires_at=$1 WHERE id=$2", [new Date(Date.now() - 1_000), grant.json().assetId]);
    await storage.put(grant.json().objectKey, { sizeBytes: 1, contentType: "video/mp4", durationSeconds: 1 });
    expect((await app.inject({ method: "POST", url: `/v1/stores/${scope.storeId}/content-tasks/${taskId}/shot-lists/${shotListId}/assets/${grant.json().assetId}/complete` })).statusCode).toBe(409);
    const repository = new (await import("../src/video-editing/asset-repository.js")).AssetRepository(database, storage);
    expect(await repository.expireSources(new Date())).toBe(1);
    await expect(storage.put(grant.json().objectKey, { sizeBytes: 1, contentType: "video/mp4", durationSeconds: 1 })).rejects.toThrow("immutable");
    const accepted = await requestGrant({ projectId: randomUUID() });
    await storage.put(accepted.json().objectKey, { sizeBytes: 1, contentType: "video/mp4", durationSeconds: 1 });
    await app.inject({ method: "POST", url: `/v1/stores/${scope.storeId}/content-tasks/${taskId}/shot-lists/${shotListId}/assets/${accepted.json().assetId}/complete` });
    await database.query("UPDATE storyboard_media_assets SET expires_at=$1 WHERE id=$2", [new Date(Date.now() - 1_000), accepted.json().assetId]);
    expect(await repository.expireSources(new Date())).toBe(1);
    expect(await storage.inspect(accepted.json().objectKey)).toBeUndefined();
    expect((await database.query("SELECT reason FROM storyboard_media_asset_deletions WHERE asset_id=$1", [accepted.json().assetId])).rows).toEqual([{ reason: "retention_expired" }]);
  });

  it("reclaims all grant-expired pending uploads before enforcing the next project quota", async () => {
    const grants = await Promise.all(Array.from({ length: 20 }, () => requestGrant()));
    for (const grant of grants) await database.query("UPDATE storyboard_media_upload_grants SET expires_at=$1 WHERE asset_id=$2", [new Date(Date.now() - 1_000), grant.json().assetId]);
    const repository = new (await import("../src/video-editing/asset-repository.js")).AssetRepository(database, storage);
    expect(await repository.expirePendingUploads(new Date())).toBe(20);
    expect((await requestGrant()).statusCode).toBe(201);
  });

  it("prevents overwriting the object after the customer has completed an upload", async () => {
    const grant = await requestGrant();
    await storage.put(grant.json().objectKey, { sizeBytes: 1, contentType: "video/mp4", durationSeconds: 1 });
    expect((await app.inject({ method: "POST", url: `/v1/stores/${scope.storeId}/content-tasks/${taskId}/shot-lists/${shotListId}/assets/${grant.json().assetId}/complete` })).statusCode).toBe(201);
    await expect(storage.put(grant.json().objectKey, { sizeBytes: 2, contentType: "video/mp4", durationSeconds: 2 })).rejects.toThrow("immutable");
    expect(await storage.inspect(grant.json().objectKey)).toMatchObject({ sizeBytes: 1, durationSeconds: 1 });
  });

  afterEach(async () => { await app.close(); });

  function requestGrant(overrides: Partial<Record<string, unknown>> = {}) {
    return app.inject({ method: "POST", url: `/v1/stores/${scope.storeId}/content-tasks/${taskId}/shot-lists/${shotListId}/assets/upload-grants`, payload: { ...grantBody(projectId), ...overrides } });
  }
});

function grantBody(projectId: string) { return { projectId, expectedSizeBytes: 10_000, contentType: "video/mp4" }; }

async function seedConfirmedShotList(database: Database) {
  const taskId = randomUUID(); const topicId = randomUUID(); const copyId = randomUUID(); const shotListId = randomUUID(); const projectId = randomUUID();
  await database.query("INSERT INTO content_tasks(id,enterprise_id,store_id,actor_id,profile_version,profile_snapshot_json,stage_snapshot_json,template_snapshot_json,persona,content_type,style,commercial_level,status,confirmed_copy_id) VALUES($1,$2,$3,$4,1,'{}','{}','[]','owner','story','sincere',1,'copy_confirmed',$5)", [taskId, scope.enterpriseId, scope.storeId, scope.actorId, copyId]);
  await database.query("INSERT INTO content_task_topics(id,task_id,position,title,angle,product_reference,goal_reference,commercial_level) VALUES($1,$2,1,'title','angle','product','goal',1)", [topicId, taskId]);
  await database.query("INSERT INTO content_task_copies(id,task_id,topic_id,position,title,body,strategy,product_reference,goal_reference,commercial_level,status,confirmed_at) VALUES($1,$2,$3,1,'title','body','strategy','product','goal',1,'confirmed',CURRENT_TIMESTAMP)", [copyId, taskId, topicId]);
  await database.query("INSERT INTO content_task_shot_lists(id,task_id,copy_id,shots_json) VALUES($1,$2,$3,'[]')", [shotListId, taskId, copyId]);
  return { taskId, shotListId, projectId };
}
