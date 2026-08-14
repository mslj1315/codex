import { randomUUID } from "node:crypto";
import type { Database } from "../db.js";
import type { TrustedContext } from "../imports/service.js";
import type { VideoStorage } from "./storage.js";

export const MAX_SOURCE_ASSETS = 20;
export const MAX_SOURCE_BYTES = 500 * 1024 * 1024;
export const MAX_SOURCE_DURATION_SECONDS = 10 * 60;
const SOURCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const GRANT_TTL_MS = 10 * 60 * 1000;
type Row = Record<string, unknown>;

export class AssetError extends Error { constructor(message: string, readonly status: number) { super(message); } }

export class AssetRepository {
  constructor(private readonly database: Database, private readonly storage: VideoStorage) {}

  async createUploadGrant(context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string; expectedSizeBytes: number; contentType: string }) {
    validateGrantInput(input);
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await assertConfirmedShotList(client, context, input.taskId, input.shotListId);
      const count = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM storyboard_media_assets WHERE enterprise_id=$1 AND store_id=$2 AND task_id=$3 AND shot_list_id=$4 AND project_id=$5 AND status <> 'deleted'", [context.enterpriseId, context.storeId, input.taskId, input.shotListId, input.projectId]);
      if (Number(count.rows[0]?.count ?? 0) >= MAX_SOURCE_ASSETS) throw new AssetError("A storyboard project can contain at most 20 source assets", 409);
      const assetId = randomUUID(); const grantId = randomUUID(); const objectKey = `storyboard-source/${context.enterpriseId}/${context.storeId}/${input.projectId}/${assetId}`;
      const expiresAt = new Date(Date.now() + GRANT_TTL_MS); const sourceExpiry = new Date(Date.now() + SOURCE_RETENTION_MS);
      await client.query("INSERT INTO storyboard_media_assets(id,enterprise_id,store_id,task_id,shot_list_id,project_id,object_key,content_type,expected_size_bytes,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'upload_pending',$10)", [assetId, context.enterpriseId, context.storeId, input.taskId, input.shotListId, input.projectId, objectKey, input.contentType, input.expectedSizeBytes, sourceExpiry]);
      await client.query("INSERT INTO storyboard_media_upload_grants(id,asset_id,enterprise_id,store_id,task_id,shot_list_id,project_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [grantId, assetId, context.enterpriseId, context.storeId, input.taskId, input.shotListId, input.projectId, expiresAt]);
      const upload = await this.storage.createDirectUpload(objectKey, input.contentType, expiresAt);
      await client.query("COMMIT");
      return { assetId, objectKey, expiresAt: expiresAt.toISOString(), upload };
    } catch (error) { await rollback(client); throw error; } finally { client.release(); }
  }

  async acceptUploadedAsset(context: TrustedContext, input: { taskId: string; shotListId: string; assetId: string }) {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await assertConfirmedShotList(client, context, input.taskId, input.shotListId);
      const found = await client.query<Row>("SELECT a.*,g.expires_at AS grant_expires_at,g.consumed_at FROM storyboard_media_assets a JOIN storyboard_media_upload_grants g ON g.asset_id=a.id WHERE a.id=$1 AND a.enterprise_id=$2 AND a.store_id=$3 AND a.task_id=$4 AND a.shot_list_id=$5 FOR UPDATE", [input.assetId, context.enterpriseId, context.storeId, input.taskId, input.shotListId]);
      if (!found.rowCount) throw new AssetError("Media asset not found", 404);
      const asset = found.rows[0];
      if (asset.status !== "upload_pending" || asset.consumed_at || new Date(String(asset.grant_expires_at)).getTime() <= Date.now()) throw new AssetError("Upload grant is no longer usable", 409);
      const object = await this.storage.inspect(String(asset.object_key));
      if (!object || object.contentType !== asset.content_type || !Number.isSafeInteger(object.sizeBytes) || object.sizeBytes <= 0 || object.sizeBytes > Number(asset.expected_size_bytes) || object.sizeBytes > MAX_SOURCE_BYTES || !Number.isSafeInteger(object.durationSeconds) || object.durationSeconds <= 0) throw new AssetError("Uploaded media metadata is invalid", 422);
      const duration = await client.query<{ total: number }>("SELECT COALESCE(sum(duration_seconds),0)::int AS total FROM storyboard_media_assets WHERE enterprise_id=$1 AND store_id=$2 AND task_id=$3 AND shot_list_id=$4 AND project_id=$5 AND status='accepted'", [context.enterpriseId, context.storeId, input.taskId, input.shotListId, asset.project_id]);
      if (Number(duration.rows[0]?.total ?? 0) + object.durationSeconds > MAX_SOURCE_DURATION_SECONDS) throw new AssetError("Storyboard source duration cannot exceed ten minutes", 422);
      const updated = await client.query<Row>("UPDATE storyboard_media_assets SET size_bytes=$2,duration_seconds=$3,status='accepted' WHERE id=$1 AND status='upload_pending' RETURNING *", [input.assetId, object.sizeBytes, object.durationSeconds]);
      await client.query("UPDATE storyboard_media_upload_grants SET consumed_at=CURRENT_TIMESTAMP WHERE asset_id=$1 AND consumed_at IS NULL", [input.assetId]);
      await client.query("COMMIT");
      return assetJson(updated.rows[0]);
    } catch (error) { await rollback(client); throw error; } finally { client.release(); }
  }

  async deleteAsset(context: TrustedContext, input: { taskId: string; shotListId: string; assetId: string; reason?: "customer_deleted" | "retention_expired" }) {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<Row>("SELECT * FROM storyboard_media_assets WHERE id=$1 AND enterprise_id=$2 AND store_id=$3 AND task_id=$4 AND shot_list_id=$5 FOR UPDATE", [input.assetId, context.enterpriseId, context.storeId, input.taskId, input.shotListId]);
      if (!found.rowCount || found.rows[0].status === "deleted") throw new AssetError("Media asset not found", 404);
      await this.storage.delete(String(found.rows[0].object_key));
      await client.query("UPDATE storyboard_media_assets SET status='deleted',deleted_at=CURRENT_TIMESTAMP WHERE id=$1", [input.assetId]);
      await client.query("INSERT INTO storyboard_media_asset_deletions(id,asset_id,enterprise_id,store_id,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), input.assetId, context.enterpriseId, context.storeId, context.actorId, input.reason ?? "customer_deleted"]);
      await client.query("COMMIT");
    } catch (error) { await rollback(client); throw error; } finally { client.release(); }
  }

  /** Called by a server-side retention job; it never returns object locations. */
  async expireSources(now = new Date()): Promise<number> {
    const expired = await this.database.query<Row>("SELECT id,enterprise_id,store_id,task_id,shot_list_id,object_key FROM storyboard_media_assets WHERE status IN ('upload_pending','accepted') AND expires_at <= $1", [now]);
    let deleted = 0;
    for (const asset of expired.rows) {
      const client = await this.database.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query<Row>("SELECT * FROM storyboard_media_assets WHERE id=$1 AND status IN ('upload_pending','accepted') AND expires_at <= $2 FOR UPDATE", [asset.id, now]);
        if (!locked.rowCount) { await client.query("COMMIT"); continue; }
        await this.storage.delete(String(locked.rows[0].object_key));
        const update = await client.query("UPDATE storyboard_media_assets SET status='deleted',deleted_at=CURRENT_TIMESTAMP WHERE id=$1 AND status IN ('upload_pending','accepted')", [asset.id]);
        if (update.rowCount) {
          await client.query("INSERT INTO storyboard_media_asset_deletions(id,asset_id,enterprise_id,store_id,actor_id,reason) VALUES($1,$2,$3,$4,'system_retention','retention_expired')", [randomUUID(), asset.id, locked.rows[0].enterprise_id, locked.rows[0].store_id]);
          deleted++;
        }
        await client.query("COMMIT");
      } catch (error) { await rollback(client); throw error; } finally { client.release(); }
    }
    return deleted;
  }
}

function validateGrantInput(input: { projectId: string; expectedSizeBytes: number; contentType: string }) {
  if (!isId(input.projectId)) throw new AssetError("projectId is required", 422);
  if (!Number.isSafeInteger(input.expectedSizeBytes) || input.expectedSizeBytes <= 0 || input.expectedSizeBytes > MAX_SOURCE_BYTES) throw new AssetError("Source asset must be at most 500MB", 422);
  if (input.contentType !== "video/mp4" && input.contentType !== "video/quicktime") throw new AssetError("Only MP4 and MOV source videos are supported", 422);
}
function isId(value: string) { return /^[A-Za-z0-9_-]{8,128}$/.test(value); }
async function assertConfirmedShotList(client: { query: Database["query"] }, context: TrustedContext, taskId: string, shotListId: string) {
  // The shot-list lock serializes quota checks and acceptance for all assets derived from it.
  const result = await client.query("SELECT s.id FROM content_task_shot_lists s JOIN content_tasks t ON t.id=s.task_id JOIN content_task_copies c ON c.id=s.copy_id WHERE s.id=$1 AND s.task_id=$2 AND t.enterprise_id=$3 AND t.store_id=$4 AND t.status='copy_confirmed' AND t.confirmed_copy_id=s.copy_id AND c.status='confirmed' FOR UPDATE", [shotListId, taskId, context.enterpriseId, context.storeId]);
  if (!result.rowCount) throw new AssetError("A confirmed shot list is required", 409);
}
function assetJson(row: Row) { return { id: row.id, projectId: row.project_id, sizeBytes: Number(row.size_bytes), durationSeconds: Number(row.duration_seconds), expiresAt: new Date(String(row.expires_at)).toISOString(), status: row.status }; }
async function rollback(client: { query: Database["query"] }) { try { await client.query("ROLLBACK"); } catch {} }
