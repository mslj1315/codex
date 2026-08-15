import { randomUUID } from "node:crypto";
import type { Database } from "../db.js";
import type { TrustedContext } from "../imports/service.js";
import type { ClaimedRender, RenderWorkerRepository } from "./worker.js";
import type { ArtifactCleanupRepository, ClaimedArtifact } from "./render-cleanup.js";

type Row = Record<string, unknown>;
export class RenderError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export type RenderKind = "preview" | "final";
export type RenderJob = { id: string; projectId: string; projectVersion: number; kind: RenderKind; state: string; createdAt: string; completedAt?: string; error?: string; coverCandidates?: Array<{ id: string; positionSeconds: number }> };

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
    const renders = await Promise.all(result.rows.map(async row => {
      const item = json(row); const positions = Array.isArray(item.coverCandidates) ? item.coverCandidates.map(candidate => candidate.positionSeconds) : [];
      if (!positions.length) return item;
      const artifacts = await this.database.query<Row>("SELECT id FROM storyboard_render_artifacts WHERE render_job_id=$1 AND kind='cover' AND deleted_at IS NULL ORDER BY created_at,id", [row.id]);
      return { ...item, coverCandidates: positions.map((positionSeconds, index) => ({ id: String(artifacts.rows[index]?.id ?? ""), positionSeconds })).filter(candidate => candidate.id) };
    }));
    return { renders };
  }
  async cancel(context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string; jobId: string }): Promise<RenderJob> {
    const owner = await this.database.query<Row>("SELECT id FROM storyboard_projects WHERE id=$1 AND enterprise_id=$2 AND store_id=$3 AND task_id=$4 AND shot_list_id=$5 AND actor_id=$6", [input.projectId, context.enterpriseId, context.storeId, input.taskId, input.shotListId, context.actorId]);
    if (!owner.rowCount) throw new RenderError("Render is not available for cancellation", 403);
    const result = await this.database.query<Row>("UPDATE storyboard_render_jobs SET state='cancelled',cancelled_at=CURRENT_TIMESTAMP,completed_at=CURRENT_TIMESTAMP WHERE id=$1 AND project_id=$2 AND enterprise_id=$3 AND store_id=$4 AND task_id=$5 AND shot_list_id=$6 AND state IN ('queued','processing') RETURNING *", [input.jobId, input.projectId, context.enterpriseId, context.storeId, input.taskId, input.shotListId]);
    if (!result.rowCount) throw new RenderError("Render is not available for cancellation", 409); return json(result.rows[0]);
  }
  async deleteSucceeded(context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string; jobId: string }, remove: (key: string) => Promise<void>): Promise<void> {
    const owner = await this.database.query<Row>("SELECT id FROM storyboard_projects WHERE id=$1 AND enterprise_id=$2 AND store_id=$3 AND task_id=$4 AND shot_list_id=$5 AND actor_id=$6", [input.projectId, context.enterpriseId, context.storeId, input.taskId, input.shotListId, context.actorId]);
    if (!owner.rowCount) throw new RenderError("Render output is not available", 404);
    // pg-mem cannot evaluate a parameterized predicate on this FK column. The
    // render id is unique; compare every persisted scope field before storage.
    const found = await this.database.query<Row>("SELECT project_id,enterprise_id,store_id,task_id,shot_list_id,state,deleted_at,output_object_key FROM storyboard_render_jobs WHERE id=$1", [input.jobId]);
    const row = found.rows[0];
    if (!row || String(row.project_id) !== input.projectId || String(row.enterprise_id) !== context.enterpriseId || String(row.store_id) !== context.storeId || String(row.task_id) !== input.taskId || String(row.shot_list_id) !== input.shotListId || row.state !== "succeeded" || row.deleted_at || typeof row.output_object_key !== "string" || !row.output_object_key) throw new RenderError("Render output is not available", 404);
    const outputKey = row.output_object_key; await remove(outputKey); await Promise.all([1, 2, 3].map(index => remove(outputKey.replace(/\.mp4$/, `-cover-${index}.jpg`))));
    await this.database.query("UPDATE storyboard_render_jobs SET deleted_at=CURRENT_TIMESTAMP WHERE id=$1 AND deleted_at IS NULL", [input.jobId]);
    await this.database.query("INSERT INTO storyboard_render_output_deletions(id,render_job_id,enterprise_id,store_id,actor_id,reason) VALUES($1,$2,$3,$4,$5,'customer_deleted')", [randomUUID(), input.jobId, context.enterpriseId, context.storeId, context.actorId]);
  }
  async delivery(context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string; jobId: string; artifactId?: string }) {
    const owner = await this.database.query<Row>("SELECT id FROM storyboard_projects WHERE id=$1 AND enterprise_id=$2 AND store_id=$3 AND task_id=$4 AND shot_list_id=$5 AND actor_id=$6", [input.projectId, context.enterpriseId, context.storeId, input.taskId, input.shotListId, context.actorId]);
    if (!owner.rowCount) throw new RenderError("Render output is not available", 404);
    // The render id is globally unique. Compare persisted scope fields here so
    // delivery remains fail-closed in pg-mem and production PostgreSQL alike.
    const found = await this.database.query<Row>("SELECT * FROM storyboard_render_jobs WHERE id=$1", [input.jobId]);
    const row = found.rows[0];
    if (!row || String(row.project_id) !== input.projectId || String(row.enterprise_id) !== context.enterpriseId || String(row.store_id) !== context.storeId || String(row.task_id) !== input.taskId || String(row.shot_list_id) !== input.shotListId || row.state !== "succeeded" || row.deleted_at || !row.output_expires_at || new Date(String(row.output_expires_at)) <= new Date()) throw new RenderError("Render output is not available", 404);
    const artifact = input.artifactId ? (await this.database.query<Row>("SELECT * FROM storyboard_render_artifacts WHERE id=$1", [input.artifactId])).rows[0] : undefined;
    if (input.artifactId && (!artifact || String(artifact.render_job_id) !== input.jobId || artifact.kind !== "cover" || artifact.deleted_at)) throw new RenderError("Render output is not available", 404);
    const key = input.artifactId ? artifact!.object_key : row.output_object_key;
    if (typeof key !== "string" || !key) throw new RenderError("Render output is not available", 404);
    return { objectKey: key, contentType: input.artifactId ? "image/jpeg" as const : "video/mp4" as const };
  }
  async selectCover(context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string; jobId: string; artifactId: unknown; title: unknown }) {
    if (typeof input.artifactId !== "string" || !input.artifactId || typeof input.title !== "string" || input.title.trim().length > 120) throw new RenderError("Cover selection is invalid", 422);
    const row = await this.database.query<Row>("SELECT j.project_version FROM storyboard_render_jobs j JOIN storyboard_projects p ON p.id=j.project_id JOIN storyboard_render_artifacts a ON a.id=$7 AND a.render_job_id=j.id AND a.kind='cover' AND a.deleted_at IS NULL WHERE j.id=$1 AND j.project_id=$2 AND j.enterprise_id=$3 AND j.store_id=$4 AND j.task_id=$5 AND j.shot_list_id=$6 AND p.actor_id=$8 AND j.kind='final' AND j.state='succeeded' AND j.deleted_at IS NULL AND j.output_expires_at>$9", [input.jobId, input.projectId, context.enterpriseId, context.storeId, input.taskId, input.shotListId, input.artifactId, context.actorId, new Date()]);
    if (!row.rowCount) throw new RenderError("Cover candidate is not available", 404);
    await this.database.query("INSERT INTO storyboard_render_cover_selections(project_id,project_version,render_job_id,artifact_id,title) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,project_version) DO UPDATE SET render_job_id=EXCLUDED.render_job_id,artifact_id=EXCLUDED.artifact_id,title=EXCLUDED.title", [input.projectId, row.rows[0].project_version, input.jobId, input.artifactId, input.title.trim()]);
    return { selectedCoverCandidateId: input.artifactId, selectedCoverTitle: input.title.trim() };
  }
  workerRepository(now = () => new Date()): RenderWorkerRepository { return new DatabaseRenderWorkerRepository(this.database, now); }
  cleanupRepository(now = () => new Date()): ArtifactCleanupRepository { return new DatabaseArtifactCleanupRepository(this.database, now); }
}
class DatabaseArtifactCleanupRepository implements ArtifactCleanupRepository {
  constructor(private readonly database: Database, private readonly now: () => Date) {}
  async claimDue(): Promise<ClaimedArtifact | undefined> { const client = await this.database.connect(); try { await client.query("BEGIN"); const now = this.now(); const result = await client.query<Row>("SELECT a.id,a.object_key FROM storyboard_render_artifacts a JOIN storyboard_render_jobs j ON j.id=a.render_job_id WHERE a.deleted_at IS NULL AND j.output_expires_at<=$1 AND (a.next_cleanup_attempt_at IS NULL OR a.next_cleanup_attempt_at<=$1) AND (a.cleanup_lease_expires_at IS NULL OR a.cleanup_lease_expires_at<$1) ORDER BY a.created_at LIMIT 1 FOR UPDATE", [now]); if (!result.rowCount) { await client.query("COMMIT"); return undefined; } const row = result.rows[0]; await client.query("UPDATE storyboard_render_artifacts SET cleanup_attempt_count=cleanup_attempt_count+1,cleanup_lease_expires_at=$2 WHERE id=$1", [row.id, new Date(now.getTime() + 10 * 60 * 1000)]); await client.query("COMMIT"); return { id: String(row.id), objectKey: String(row.object_key) }; } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; } finally { client.release(); } }
  async markDeleted(id: string) {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const artifact = await client.query<Row>("UPDATE storyboard_render_artifacts SET deleted_at=CURRENT_TIMESTAMP,cleanup_lease_expires_at=NULL,next_cleanup_attempt_at=NULL,last_cleanup_error=NULL WHERE id=$1 RETURNING render_job_id", [id]);
      const renderJobId = artifact.rows[0]?.render_job_id;
      if (renderJobId) {
        const remaining = await client.query<Row>("SELECT count(*)::int AS count FROM storyboard_render_artifacts WHERE render_job_id=$1 AND deleted_at IS NULL", [renderJobId]);
        if (Number(remaining.rows[0]?.count) === 0) {
          const retired = await client.query<Row>("UPDATE storyboard_render_jobs SET deleted_at=CURRENT_TIMESTAMP WHERE id=$1 AND deleted_at IS NULL AND output_expires_at<=$2 RETURNING enterprise_id,store_id,project_id", [renderJobId, this.now()]);
          if (retired.rowCount) {
            const job = retired.rows[0]; const project = await client.query<Row>("SELECT actor_id FROM storyboard_projects WHERE id=$1", [job.project_id]);
            if (project.rowCount) await client.query("INSERT INTO storyboard_render_output_deletions(id,render_job_id,enterprise_id,store_id,actor_id,reason) VALUES($1,$2,$3,$4,$5,'retention_expired')", [randomUUID(), renderJobId, job.enterprise_id, job.store_id, project.rows[0].actor_id]);
          }
        }
      }
      await client.query("COMMIT");
    } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; } finally { client.release(); }
  }
  async retry(id: string) { await this.database.query("UPDATE storyboard_render_artifacts SET cleanup_lease_expires_at=NULL,next_cleanup_attempt_at=$2,last_cleanup_error='storage_unavailable' WHERE id=$1", [id, new Date(this.now().getTime() + 60_000)]); }
}
export class DatabaseRenderWorkerRepository implements RenderWorkerRepository {
  constructor(private readonly database: Database, private readonly now: () => Date) {}
  async claim(): Promise<ClaimedRender | undefined> {
    const client = await this.database.connect(); try { await client.query("BEGIN"); const now = this.now();
      await client.query("UPDATE storyboard_render_jobs SET state='queued',lease_expires_at=NULL WHERE state='processing' AND lease_expires_at<$1", [now]);
      const found = await client.query<Row>("SELECT * FROM storyboard_render_jobs WHERE state='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=$1) ORDER BY created_at LIMIT 1 FOR UPDATE", [now]); if (!found.rowCount) { await client.query("COMMIT"); return undefined; }
      const job = found.rows[0]; const leaseToken = randomUUID(); const update = await client.query<Row>("UPDATE storyboard_render_jobs SET state='processing',started_at=COALESCE(started_at,$2),lease_expires_at=$3,lease_token=$4,attempt_count=attempt_count+1 WHERE id=$1 AND state='queued' RETURNING *", [job.id, now, new Date(now.getTime() + 10 * 60 * 1000), leaseToken]); if (!update.rowCount) { await client.query("COMMIT"); return undefined; }
      const version = await client.query<Row>("SELECT slots_json FROM storyboard_project_versions WHERE project_id=$1 AND version=$2 AND status='final'", [job.project_id, job.project_version]); const slots = slotsArray(version.rows[0]?.slots_json); const selected = [...new Set(slots.map(slot => slot.assetId).filter((id): id is string => typeof id === "string" && id.length > 0))]; if (!selected.length) throw new Error("Final storyboard has no source slots");
      const assets = await client.query<Row>("SELECT id,object_key,duration_seconds FROM storyboard_media_assets WHERE project_id=$1 AND status='accepted' AND expires_at>$2", [job.project_id, now]); const byId = new Map(assets.rows.map(row => [String(row.id), row])); const ordered = slots.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)); let durationSeconds = 0; const sourceKeys: string[] = []; const subtitleText: string[] = []; const renderSlots: NonNullable<ClaimedRender["slots"]> = []; for (const slot of ordered) { const asset = byId.get(String(slot.assetId)); const start = Number(slot.trimStartSeconds); const end = Number(slot.trimEndSeconds); if (!asset || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > Number(asset.duration_seconds)) throw new Error("Final storyboard media is invalid"); durationSeconds += end - start; const sourceKey = String(asset.object_key); sourceKeys.push(sourceKey); const enabled = slot.subtitleEnabled === true && typeof slot.subtitleText === "string" && slot.subtitleText.trim().length > 0; if (enabled) subtitleText.push(slot.subtitleText!.trim()); renderSlots.push({ sourceKey, trimStartSeconds: start, trimEndSeconds: end, muted: slot.muted === true, subtitleEnabled: enabled, ...(enabled ? { subtitleText: slot.subtitleText!.trim() } : {}) }); } if (durationSeconds > 90) throw new Error("Final storyboard exceeds 90 seconds"); await client.query("COMMIT"); return { id: String(job.id), kind: job.kind as "preview" | "final", projectId: String(job.project_id), projectVersion: Number(job.project_version), durationSeconds, subtitleText, sourceKeys, slots: renderSlots, leaseToken };
    } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; } finally { client.release(); }
  }
  async succeed(id: string, result: { outputExpiresAt: Date; coverCandidates: Array<{ positionSeconds: number }>; artifacts?: Array<{ objectKey: string; kind: "video" | "cover" }> }, leaseToken?: string) { const output = result.artifacts?.find(item => item.kind === "video")?.objectKey ?? `storyboard-render-output/${id}.mp4`; const client = await this.database.connect(); try { await client.query("BEGIN"); const done = await client.query("UPDATE storyboard_render_jobs SET state='succeeded',output_object_key=$2,output_expires_at=$3,cover_candidates_json=$4,completed_at=CURRENT_TIMESTAMP,lease_expires_at=NULL,lease_token=NULL WHERE id=$1 AND state='processing' AND cancelled_at IS NULL AND ($5::text IS NULL OR lease_token=$5) AND lease_expires_at>$6", [id, output, result.outputExpiresAt, JSON.stringify(result.coverCandidates), leaseToken ?? null, this.now()]); if (!done.rowCount) throw new Error("render completion lost lease"); for (const artifact of result.artifacts ?? [{ objectKey: output, kind: "video" as const }]) await client.query("INSERT INTO storyboard_render_artifacts(id,render_job_id,object_key,kind) VALUES($1,$2,$3,$4)", [randomUUID(), id, artifact.objectKey, artifact.kind]); await client.query("COMMIT"); } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; } finally { client.release(); } }
  async fail(id: string, category: string, retry: boolean, leaseToken?: string) { const next = retry ? new Date(this.now().getTime() + 60_000) : null; await this.database.query("UPDATE storyboard_render_jobs SET state=$2,error_message=$3,next_attempt_at=$4,lease_expires_at=NULL,lease_token=NULL,completed_at=CASE WHEN $2='failed' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=$1 AND state='processing' AND ($5::text IS NULL OR lease_token=$5)", [id, retry ? "queued" : "failed", category, next, leaseToken ?? null]); }
  async ownsLease(id: string, leaseToken: string) { const result = await this.database.query<Row>("SELECT id FROM storyboard_render_jobs WHERE id=$1 AND state='processing' AND lease_token=$2 AND lease_expires_at>$3 AND cancelled_at IS NULL", [id, leaseToken, this.now()]); return result.rowCount === 1; }
  async renewLease(id: string, leaseToken: string) { const now = this.now(); const result = await this.database.query<Row>("UPDATE storyboard_render_jobs SET lease_expires_at=$3 WHERE id=$1 AND state='processing' AND lease_token=$2 AND lease_expires_at>$4 AND cancelled_at IS NULL RETURNING id", [id, leaseToken, new Date(now.getTime() + 10 * 60 * 1000), now]); return result.rowCount === 1; }
  async isCancelled(id: string) { const result = await this.database.query<Row>("SELECT state FROM storyboard_render_jobs WHERE id=$1", [id]); return result.rows[0]?.state === "cancelled"; }
}
function isActiveConflict(error: unknown) { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505"; }
function slotsArray(value: unknown): Array<{ assetId?: string; subtitleText?: string; subtitleEnabled?: boolean; trimStartSeconds?: number; trimEndSeconds?: number; order?: number; muted?: boolean }> { const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value ?? []; if (!Array.isArray(parsed)) throw new Error("Stored storyboard slots are invalid"); return parsed as Array<{ assetId?: string; subtitleText?: string; subtitleEnabled?: boolean; trimStartSeconds?: number; trimEndSeconds?: number; order?: number; muted?: boolean }>; }
function json(row: Row): RenderJob { return { id: String(row.id), projectId: String(row.project_id), projectVersion: Number(row.project_version), kind: row.kind as RenderKind, state: String(row.state), createdAt: new Date(String(row.created_at)).toISOString(), ...(row.completed_at ? { completedAt: new Date(String(row.completed_at)).toISOString() } : {}), ...(row.error_message ? { error: String(row.error_message) } : {}), ...(row.cover_candidates_json ? { coverCandidates: jsonValue(row.cover_candidates_json) as Array<{ id: string; positionSeconds: number }> } : {}) }; }
function jsonValue(value: unknown): unknown { return typeof value === "string" ? JSON.parse(value) : value; }
