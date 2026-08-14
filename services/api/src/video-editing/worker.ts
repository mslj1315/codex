export type RenderManifest = { width: 1080; height: 1920; fps: 30; durationSeconds: number; subtitles: string[]; sources: Buffer[] };
export type RunnerResult = { output: Buffer; metadata: { width: number; height: number; fps: number; durationSeconds: number; contentType: string }; coverFrames: Array<{ positionSeconds: number; bytes: Buffer }> };
export interface RenderRunner { render(manifest: RenderManifest): Promise<RunnerResult>; }
export interface ClaimedRender { id: string; kind: "preview" | "final"; projectId: string; projectVersion: number; durationSeconds: number; subtitleText: string[]; sourceKeys: string[]; }
export interface RenderWorkerRepository { claim(): Promise<ClaimedRender | undefined>; succeed(id: string, result: { outputExpiresAt: Date; coverCandidates: Array<{ positionSeconds: number }> }): Promise<void>; fail(id: string, category: string, retryable: boolean): Promise<void>; isCancelled(id: string): Promise<boolean>; }
export interface WorkerStorage { download(key: string): Promise<Buffer>; putProtected(key: string, bytes: Buffer, metadata: { contentType: "video/mp4"; expiresAt: Date }): Promise<void>; }
export interface TemporaryWorkspace { create(jobId: string): Promise<string>; remove(path: string): Promise<void>; }

export class StoryboardRenderWorker {
  constructor(private readonly repository: RenderWorkerRepository, private readonly workspace: TemporaryWorkspace, private readonly storage: WorkerStorage, private readonly runner: RenderRunner, private readonly now = () => new Date()) {}
  async runOnce(): Promise<boolean> {
    const job = await this.repository.claim(); if (!job) return false;
    const path = await this.workspace.create(job.id);
    try {
      if (await this.repository.isCancelled(job.id)) return true;
      validateRenderManifest({ width: 1080, height: 1920, fps: 30, durationSeconds: job.durationSeconds });
      const sources = await Promise.all(job.sourceKeys.map(key => this.storage.download(key)));
      const result = await this.runner.render({ width: 1080, height: 1920, fps: 30, durationSeconds: job.durationSeconds, subtitles: job.subtitleText, sources });
      validateResult(result, job.durationSeconds);
      if (await this.repository.isCancelled(job.id)) return true;
      const expiresAt = new Date(this.now().getTime() + (job.kind === "final" ? 180 : 7) * 24 * 60 * 60 * 1000);
      await this.storage.putProtected(`storyboard-render/${job.projectId}/${job.projectVersion}/${job.id}.mp4`, result.output, { contentType: "video/mp4", expiresAt });
      await this.repository.succeed(job.id, { outputExpiresAt: expiresAt, coverCandidates: result.coverFrames.map(frame => ({ positionSeconds: frame.positionSeconds })) });
    } catch (error) { await this.repository.fail(job.id, category(error), retryable(error)); }
    finally { await this.workspace.remove(path); }
    return true;
  }
}
export function validateRenderManifest(manifest: { width: number; height: number; fps: number; durationSeconds: number }) { if (manifest.width !== 1080 || manifest.height !== 1920 || manifest.fps !== 30 || !Number.isFinite(manifest.durationSeconds) || manifest.durationSeconds <= 0 || manifest.durationSeconds > 90) throw new Error("Invalid render manifest"); }
function validateResult(result: RunnerResult, duration: number) { validateRenderManifest(result.metadata); if (result.metadata.durationSeconds > duration || result.metadata.contentType !== "video/mp4" || result.output.length === 0) throw new Error("Invalid FFmpeg output"); if (result.coverFrames.length !== 3 || new Set(result.coverFrames.map(frame => frame.positionSeconds)).size !== 3 || result.coverFrames.some(frame => frame.positionSeconds < 0 || frame.positionSeconds >= result.metadata.durationSeconds || frame.bytes.length === 0)) throw new Error("Invalid cover candidates"); }
function retryable(error: unknown) { const code = typeof error === "object" && error !== null ? String((error as { code?: unknown }).code ?? "") : ""; return /ECONN|ETIMEDOUT|EAI_AGAIN|INTERRUPTED/i.test(code); }
function category(error: unknown) { return retryable(error) ? "infrastructure_unavailable" : "render_validation_failed"; }
