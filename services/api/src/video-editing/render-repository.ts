import { randomUUID } from "node:crypto";
import type { Database } from "../db.js";
import type { TrustedContext } from "../imports/service.js";

type Row = Record<string, unknown>;
export class RenderError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export type RenderKind = "preview" | "final";
export type RenderJob = { id: string; projectId: string; projectVersion: number; kind: RenderKind; state: string; createdAt: string; completedAt?: string; error?: string; coverCandidates?: Array<{ positionSeconds: number }> };

export class RenderRepository {
  constructor(private readonly database: Database) {}
  async enqueue(context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string; kind: unknown }): Promise<RenderJob> {
    if (input.kind !== "preview" && input.kind !== "final") throw new RenderError("Render kind is invalid", 422);
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const source = await client.query<Row>("SELECT t.id FROM content_tasks t JOIN content_task_shot_lists s ON s.id=$2 AND s.task_id=t.id JOIN content_task_copies c ON c.id=s.copy_id WHERE t.id=$1 AND t.enterprise_id=$3 AND t.store_id=$4 AND t.actor_id=$5 AND t.status='copy_confirmed' AND t.confirmed_copy_id=s.copy_id AND c.status='confirmed' FOR UPDATE", [input.taskId, input.shotListId, context.enterpriseId, context.storeId, context.actorId]);
      if (!source.rowCount) throw new RenderError("A confirmed copy and shot list are required", 409);
      const version = await client.query<Row>("SELECT v.version FROM storyboard_projects p JOIN storyboard_project_versions v ON v.project_id=p.id WHERE p.id=$1 AND p.enterprise_id=$2 AND p.store_id=$3 AND p.task_id=$4 AND p.shot_list_id=$5 AND p.actor_id=$6 AND v.status='final' ORDER BY v.version DESC LIMIT 1 FOR UPDATE", [input.projectId, context.enterpriseId, context.storeId, input.taskId, input.shotListId, context.actorId]);
      if (!version.rowCount) throw new RenderError("A finalized storyboard project is required", 409);
      const assets = await client.query<Row>("SELECT count(*)::int AS count FROM storyboard_media_assets WHERE enterprise_id=$1 AND store_id=$2 AND task_id=$3 AND shot_list_id=$4 AND project_id=$5 AND status='accepted' AND expires_at>$6", [context.enterpriseId, context.storeId, input.taskId, input.shotListId, input.projectId, new Date()]);
      if (Number(assets.rows[0]?.count ?? 0) === 0) throw new RenderError("At least one unexpired accepted source asset is required", 409);
      const job = await client.query<Row>("INSERT INTO storyboard_render_jobs(id,enterprise_id,store_id,task_id,shot_list_id,project_id,project_version,kind,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued') RETURNING *", [randomUUID(), context.enterpriseId, context.storeId, input.taskId, input.shotListId, input.projectId, version.rows[0].version, input.kind]);
      await client.query("COMMIT"); return json(job.rows[0]);
    } catch (error) { try { await client.query("ROLLBACK"); } catch {} if (isActiveConflict(error)) throw new RenderError("A render is already active for this storyboard project", 409); throw error; } finally { client.release(); }
  }
  async list(context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string }) {
    const result = await this.database.query<Row>("SELECT j.* FROM storyboard_render_jobs j JOIN storyboard_projects p ON p.id=j.project_id WHERE j.project_id=$1 AND j.enterprise_id=$2 AND j.store_id=$3 AND j.task_id=$4 AND j.shot_list_id=$5 AND p.actor_id=$6 AND j.deleted_at IS NULL ORDER BY j.created_at DESC", [input.projectId, context.enterpriseId, context.storeId, input.taskId, input.shotListId, context.actorId]);
    return { renders: result.rows.map(json) };
  }
  async cancel(context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string; jobId: string }): Promise<RenderJob> {
    const owner = await this.database.query<Row>("SELECT id FROM storyboard_projects WHERE id=$1 AND enterprise_id=$2 AND store_id=$3 AND task_id=$4 AND shot_list_id=$5 AND actor_id=$6", [input.projectId, context.enterpriseId, context.storeId, input.taskId, input.shotListId, context.actorId]);
    if (!owner.rowCount) throw new RenderError("Render is not available for cancellation", 403);
    const result = await this.database.query<Row>("UPDATE storyboard_render_jobs SET state='cancelled',cancelled_at=CURRENT_TIMESTAMP,completed_at=CURRENT_TIMESTAMP WHERE id=$1 AND project_id=$2 AND enterprise_id=$3 AND store_id=$4 AND task_id=$5 AND shot_list_id=$6 AND state IN ('queued','processing') RETURNING *", [input.jobId, input.projectId, context.enterpriseId, context.storeId, input.taskId, input.shotListId]);
    if (!result.rowCount) throw new RenderError("Render is not available for cancellation", 409); return json(result.rows[0]);
  }
}
function isActiveConflict(error: unknown) { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505"; }
function json(row: Row): RenderJob { return { id: String(row.id), projectId: String(row.project_id), projectVersion: Number(row.project_version), kind: row.kind as RenderKind, state: String(row.state), createdAt: new Date(String(row.created_at)).toISOString(), ...(row.completed_at ? { completedAt: new Date(String(row.completed_at)).toISOString() } : {}), ...(row.error_message ? { error: String(row.error_message) } : {}), ...(row.cover_candidates_json ? { coverCandidates: JSON.parse(String(row.cover_candidates_json)) as Array<{ positionSeconds: number }> } : {}) }; }
