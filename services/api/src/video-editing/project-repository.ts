import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../db.js";
import type { TrustedContext } from "../imports/service.js";

type Row = Record<string, unknown>;
export class ProjectError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export type ProjectSlot = { slotId: string; kind: "shot" | "supplemental"; shotIndex?: number; assetId: string; order: number; trimStartSeconds: number; trimEndSeconds: number; muted: boolean; subtitleText: string };

export class ProjectRepository {
  constructor(private readonly database: Database) {}

  async create(context: TrustedContext, input: { taskId: string; shotListId: string }) {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const source = await confirmedSource(client, context, input.taskId, input.shotListId, true);
      const id = projectId(context, input.taskId, input.shotListId);
      const existing = await client.query<Row>("SELECT * FROM storyboard_projects WHERE id=$1 FOR UPDATE", [id]);
      if (existing.rowCount) { await client.query("COMMIT"); return this.get(context, input.taskId, input.shotListId, id); }
      await client.query("INSERT INTO storyboard_projects(id,enterprise_id,store_id,task_id,shot_list_id,actor_id) VALUES($1,$2,$3,$4,$5,$6)", [id, context.enterpriseId, context.storeId, input.taskId, input.shotListId, context.actorId]);
      const slots = seedSlots(source.shots, String(source.copyBody));
      const inserted = await client.query<Row>("INSERT INTO storyboard_project_versions(id,project_id,version,status,slots_json,cover_title) VALUES($1,$2,1,'draft',$3,$4) RETURNING *", [randomUUID(), id, JSON.stringify(slots), String(source.copyTitle)]);
      await client.query("COMMIT"); return versionJson(id, inserted.rows[0]);
    } catch (error) { await rollback(client); throw error; } finally { client.release(); }
  }

  async saveVersion(context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string; slots: unknown; coverAssetId?: unknown; coverTitle?: unknown; finalize?: unknown }) {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const source = await confirmedSource(client, context, input.taskId, input.shotListId, true);
      const project = await client.query<Row>("SELECT * FROM storyboard_projects WHERE id=$1 AND enterprise_id=$2 AND store_id=$3 AND task_id=$4 AND shot_list_id=$5 AND actor_id=$6 FOR UPDATE", [input.projectId, context.enterpriseId, context.storeId, input.taskId, input.shotListId, context.actorId]);
      if (!project.rowCount) throw new ProjectError("Storyboard project not found", 404);
      const latest = await client.query<Row>("SELECT * FROM storyboard_project_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1 FOR UPDATE", [input.projectId]);
      if (!latest.rowCount) throw new ProjectError("Storyboard project has no draft", 409);
      if (latest.rows[0].status === "final") throw new ProjectError("Final storyboard versions are immutable", 409);
      const slots = validateSlots(input.slots, source.shots);
      await assertAssets(client, context, input, slots, stringOrUndefined(input.coverAssetId));
      const coverTitle = stringOrEmpty(input.coverTitle, "Cover title");
      const status = input.finalize === true ? "final" : "draft";
      const version = Number(latest.rows[0].version) + 1;
      const inserted = await client.query<Row>("INSERT INTO storyboard_project_versions(id,project_id,version,status,slots_json,cover_asset_id,cover_title) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *", [randomUUID(), input.projectId, version, status, JSON.stringify(slots), stringOrUndefined(input.coverAssetId) ?? null, coverTitle]);
      await client.query("COMMIT"); return versionJson(input.projectId, inserted.rows[0]);
    } catch (error) { await rollback(client); throw error; } finally { client.release(); }
  }

  async get(context: TrustedContext, taskId: string, shotListId: string, projectIdValue: string) {
    await confirmedSource(this.database, context, taskId, shotListId, false);
    const project = await this.database.query<Row>("SELECT id FROM storyboard_projects WHERE id=$1 AND enterprise_id=$2 AND store_id=$3 AND task_id=$4 AND shot_list_id=$5 AND actor_id=$6", [projectIdValue, context.enterpriseId, context.storeId, taskId, shotListId, context.actorId]);
    if (!project.rowCount) throw new ProjectError("Storyboard project not found", 404);
    const versions = await this.database.query<Row>("SELECT * FROM storyboard_project_versions WHERE project_id=$1 ORDER BY version", [projectIdValue]);
    return { id: projectIdValue, versions: versions.rows.map(row => versionJson(projectIdValue, row)) };
  }
}

function projectId(context: TrustedContext, taskId: string, shotListId: string) { return createHash("sha256").update(`${context.enterpriseId}:${context.storeId}:${taskId}:${shotListId}:${context.actorId}`).digest("hex"); }
async function confirmedSource(queryable: { query: Database["query"] }, context: TrustedContext, taskId: string, shotListId: string, lock: boolean) {
  const owner = await queryable.query<Row>("SELECT actor_id FROM content_tasks WHERE id=$1 AND enterprise_id=$2 AND store_id=$3", [taskId, context.enterpriseId, context.storeId]);
  if (owner.rowCount && owner.rows[0].actor_id !== context.actorId) throw new ProjectError("Content task is outside trusted customer context", 403);
  const result = await queryable.query<Row>(`SELECT s.shots_json,c.title AS copy_title,c.body AS copy_body FROM content_task_shot_lists s JOIN content_tasks t ON t.id=s.task_id JOIN content_task_copies c ON c.id=s.copy_id WHERE s.id=$1 AND s.task_id=$2 AND t.enterprise_id=$3 AND t.store_id=$4 AND t.actor_id=$5 AND t.status='copy_confirmed' AND t.confirmed_copy_id=s.copy_id AND c.status='confirmed'${lock ? " FOR UPDATE" : ""}`, [shotListId, taskId, context.enterpriseId, context.storeId, context.actorId]);
  if (!result.rowCount) throw new ProjectError("A confirmed shot list is required", 409);
  const row = result.rows[0];
  try { return { shots: JSON.parse(String(row.shots_json)) as unknown[], copyTitle: row.copy_title, copyBody: row.copy_body }; } catch { throw new ProjectError("Confirmed shot list is invalid", 409); }
}
function seedSlots(shots: unknown[], copyBody: string): ProjectSlot[] { return shots.map((shot, index) => { const item = object(shot); return { slotId: `shot-${index + 1}`, kind: "shot", shotIndex: index + 1, assetId: "", order: index + 1, trimStartSeconds: 0, trimEndSeconds: 0, muted: false, subtitleText: text(item.narration) || text(item.shot) || copyBody }; }); }
function validateSlots(value: unknown, shots: unknown[]): ProjectSlot[] {
  if (!Array.isArray(value) || value.length === 0) throw new ProjectError("At least one storyboard slot is required", 422);
  const ids = new Set<string>(), orders = new Set<number>(); let duration = 0;
  const slots = value.map(raw => {
    const item = object(raw); const slotId = nonempty(item.slotId, "Slot id"); const kind: "shot" | "supplemental" = item.kind === "shot" || item.kind === "supplemental" ? item.kind : invalidKind();
    if (kind !== "shot" && kind !== "supplemental") throw new ProjectError("Slot kind is invalid", 422);
    const shotIndex = kind === "shot" ? positive(item.shotIndex, "Shot index") : undefined;
    if (kind === "shot" && shotIndex! > shots.length) throw new ProjectError("Shot slot is outside the confirmed shot list", 422);
    const order = positive(item.order, "Slot order"); const start = nonnegative(item.trimStartSeconds, "Trim start"); const end = positive(item.trimEndSeconds, "Trim end");
    if (end <= start) throw new ProjectError("Trim end must be after trim start", 422);
    if (typeof item.muted !== "boolean") throw new ProjectError("Muted must be a boolean", 422);
    const subtitleText = nonempty(item.subtitleText, "Subtitle text"); const assetId = nonempty(item.assetId, "Asset id");
    if (ids.has(slotId) || orders.has(order)) throw new ProjectError("Slot ids and order values must be unique", 422); ids.add(slotId); orders.add(order); duration += end - start;
    return { slotId, kind, ...(shotIndex ? { shotIndex } : {}), assetId, order, trimStartSeconds: start, trimEndSeconds: end, muted: item.muted, subtitleText };
  });
  if (duration > 90) throw new ProjectError("Storyboard duration cannot exceed 90 seconds", 422);
  return slots.sort((a, b) => a.order - b.order);
}
async function assertAssets(client: { query: Database["query"] }, context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string }, slots: ProjectSlot[], coverAssetId?: string) {
  const ids = [...new Set([...slots.map(slot => slot.assetId), ...(coverAssetId ? [coverAssetId] : [])])];
  const expectedProject = projectId(context, input.taskId, input.shotListId);
  for (const id of ids) {
    const asset = await client.query<Row>("SELECT duration_seconds FROM storyboard_media_assets WHERE id=$1 AND enterprise_id=$2 AND store_id=$3 AND task_id=$4 AND shot_list_id=$5 AND project_id=$6 AND status='accepted' FOR UPDATE", [id, context.enterpriseId, context.storeId, input.taskId, input.shotListId, expectedProject]);
    if (!asset.rowCount) throw new ProjectError("Selected media asset is outside this storyboard project", 422);
    const slot = slots.find(item => item.assetId === id); if (slot && slot.trimEndSeconds > Number(asset.rows[0].duration_seconds)) throw new ProjectError("Trim range exceeds the source asset duration", 422);
  }
}
function versionJson(projectId: string, row: Row) { return { id: projectId, version: Number(row.version), status: row.status, slots: JSON.parse(String(row.slots_json)), coverAssetId: row.cover_asset_id ?? undefined, coverTitle: row.cover_title, createdAt: new Date(String(row.created_at)).toISOString() }; }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProjectError("Storyboard slot must be an object", 422); return value as Record<string, unknown>; }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function nonempty(value: unknown, label: string): string { const result = text(value); if (!result) throw new ProjectError(`${label} is required`, 422); return result; }
function stringOrUndefined(value: unknown): string | undefined { return value === undefined ? undefined : nonempty(value, "Cover asset id"); }
function stringOrEmpty(value: unknown, label: string): string { if (value === undefined) return ""; if (typeof value !== "string" || value.trim().length > 120) throw new ProjectError(`${label} is invalid`, 422); return value.trim(); }
function positive(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new ProjectError(`${label} is invalid`, 422); return value; }
function nonnegative(value: unknown, label: string): number { if (typeof value !== "number") throw new ProjectError(`${label} is invalid`, 422); if (!Number.isFinite(value) || value < 0) throw new ProjectError(`${label} is invalid`, 422); return value; }
function invalidKind(): never { throw new ProjectError("Slot kind is invalid", 422); }
async function rollback(client: { query: Database["query"] }) { try { await client.query("ROLLBACK"); } catch {} }
