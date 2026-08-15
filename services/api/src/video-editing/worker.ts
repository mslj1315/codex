export type RenderManifest = { width: 1080; height: 1920; fps: 30; durationSeconds: number; subtitles: string[]; sources: Buffer[]; workspacePath?: string; slots?: Array<{ sourceIndex: number; trimStartSeconds: number; trimEndSeconds: number; muted: boolean; subtitleText?: string; subtitleEnabled: boolean }> };
export type RunnerResult = { output: Buffer; metadata: { width: number; height: number; fps: number; durationSeconds: number; contentType: string }; coverFrames: Array<{ positionSeconds: number; bytes: Buffer }> };
export interface RenderRunner { render(manifest: RenderManifest): Promise<RunnerResult>; }
export interface ClaimedRender { id: string; kind: "preview" | "final"; projectId: string; projectVersion: number; durationSeconds: number; subtitleText: string[]; sourceKeys: string[]; leaseToken?: string; slots?: Array<{ sourceKey: string; trimStartSeconds: number; trimEndSeconds: number; muted: boolean; subtitleText?: string; subtitleEnabled: boolean }>; }
export interface RenderWorkerRepository { claim(): Promise<ClaimedRender | undefined>; succeed(id: string, result: { outputExpiresAt: Date; coverCandidates: Array<{ positionSeconds: number }>; artifacts?: Array<{ objectKey: string; kind: "video" | "cover" }> }, leaseToken?: string): Promise<void>; fail(id: string, category: string, retryable: boolean, leaseToken?: string): Promise<void>; isCancelled(id: string): Promise<boolean>; ownsLease?(id: string, leaseToken: string): Promise<boolean>; }
export interface WorkerStorage { download(key: string): Promise<Buffer>; putProtected(key: string, bytes: Buffer, metadata: { contentType: "video/mp4" | "image/jpeg"; expiresAt: Date }): Promise<void>; deleteProtected?(key: string): Promise<void>; }
export interface TemporaryWorkspace { create(jobId: string): Promise<string>; remove(path: string): Promise<void>; }

export class StoryboardRenderWorker {
  constructor(private readonly repository: RenderWorkerRepository, private readonly workspace: TemporaryWorkspace, private readonly storage: WorkerStorage, private readonly runner: RenderRunner, private readonly now = () => new Date()) {}
  async runOnce(): Promise<boolean> {
    const job = await this.repository.claim(); if (!job) return false;
    let path: string;
    try { path = await this.workspace.create(job.id); } catch (error) { await this.repository.fail(job.id, "infrastructure_unavailable", true, job.leaseToken); return true; }
    const written: string[] = [];
    try {
      if (await this.repository.isCancelled(job.id) || !await this.owns(job)) return true;
      validateRenderManifest({ width: 1080, height: 1920, fps: 30, durationSeconds: job.durationSeconds });
      const sourceKeys = job.slots?.map(slot => slot.sourceKey) ?? job.sourceKeys;
      const uniqueSourceKeys = [...new Set(sourceKeys)]; const sources = await Promise.all(uniqueSourceKeys.map(key => this.storage.download(key)));
      const result = await this.runner.render({ width: 1080, height: 1920, fps: 30, durationSeconds: job.durationSeconds, subtitles: job.subtitleText, sources, workspacePath: path, slots: job.slots?.map(slot => ({ ...slot, sourceIndex: uniqueSourceKeys.indexOf(slot.sourceKey) })) });
      validateResult(result, job.durationSeconds);
      if (await this.repository.isCancelled(job.id) || !await this.owns(job)) return true;
      const expiresAt = new Date(this.now().getTime() + (job.kind === "final" ? 180 : 7) * 24 * 60 * 60 * 1000);
      const outputKey = `storyboard-render-output/${job.id}.mp4`; const covers = result.coverFrames.map((frame, index) => ({ frame, key: `storyboard-render-output/${job.id}-cover-${index + 1}.jpg` }));
      if (!await this.owns(job)) return true;
      await this.storage.putProtected(outputKey, result.output, { contentType: "video/mp4", expiresAt });
      written.push(outputKey);
      for (const { frame, key } of covers) {
        if (!await this.owns(job) || await this.repository.isCancelled(job.id)) { await this.removeWritten(written); return true; }
        await this.storage.putProtected(key, frame.bytes, { contentType: "image/jpeg", expiresAt }); written.push(key);
      }
      if (!await this.owns(job) || await this.repository.isCancelled(job.id)) { await this.removeWritten(written); return true; }
      await this.repository.succeed(job.id, { outputExpiresAt: expiresAt, coverCandidates: result.coverFrames.map(frame => ({ positionSeconds: frame.positionSeconds })), artifacts: [{ objectKey: outputKey, kind: "video" }, ...covers.map(({ key }) => ({ objectKey: key, kind: "cover" as const }))] }, job.leaseToken);
    } catch (error) { await this.removeWritten(written); await this.repository.fail(job.id, category(error), retryable(error), job.leaseToken); }
    finally { try { await this.workspace.remove(path); } catch {} }
    return true;
  }
  private async owns(job: ClaimedRender) { return !job.leaseToken || !this.repository.ownsLease || this.repository.ownsLease(job.id, job.leaseToken); }
  private async removeWritten(keys: string[]) { if (!this.storage.deleteProtected) return; await Promise.all(keys.map(async key => { try { await this.storage.deleteProtected!(key); } catch {} })); }
}
export function validateRenderManifest(manifest: { width: number; height: number; fps: number; durationSeconds: number }) { if (manifest.width !== 1080 || manifest.height !== 1920 || manifest.fps !== 30 || !Number.isFinite(manifest.durationSeconds) || manifest.durationSeconds <= 0 || manifest.durationSeconds > 90) throw new Error("Invalid render manifest"); }
function validateResult(result: RunnerResult, duration: number) { validateRenderManifest(result.metadata); if (result.metadata.durationSeconds > duration || result.metadata.contentType !== "video/mp4" || result.output.length === 0) throw new Error("Invalid FFmpeg output"); if (result.coverFrames.length !== 3 || new Set(result.coverFrames.map(frame => frame.positionSeconds)).size !== 3 || result.coverFrames.some(frame => frame.positionSeconds < 0 || frame.positionSeconds >= result.metadata.durationSeconds || frame.bytes.length === 0)) throw new Error("Invalid cover candidates"); }
function retryable(error: unknown) { const code = typeof error === "object" && error !== null ? String((error as { code?: unknown }).code ?? "") : ""; return /ECONN|ETIMEDOUT|EAI_AGAIN|INTERRUPTED/i.test(code); }
function category(error: unknown) { return retryable(error) ? "infrastructure_unavailable" : "render_validation_failed"; }
