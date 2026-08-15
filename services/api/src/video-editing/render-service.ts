import type { TrustedContext } from "../imports/service.js";
import { RenderRepository } from "./render-repository.js";
import type { ProtectedRenderStorage } from "./storage.js";
export class RenderService {
  constructor(private readonly repository: RenderRepository, private readonly protectedStorage?: ProtectedRenderStorage) {}
  enqueue(context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string; kind: unknown }) { return this.repository.enqueue(context, input); }
  list(context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string }) { return this.repository.list(context, input); }
  cancel(context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string; jobId: string }) { return this.repository.cancel(context, input); }
  async deleteSucceeded(context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string; jobId: string }) { if (!this.protectedStorage) throw new RenderRepositoryUnavailable(); await this.repository.deleteSucceeded(context, input, key => this.protectedStorage!.deleteProtected(key)); }
  async delivery(context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string; jobId: string; artifactId?: string }) { if (!this.protectedStorage) throw new RenderRepositoryUnavailable(); const item = await this.repository.delivery(context, input); return { ...(await this.protectedStorage.streamProtected(item.objectKey)), contentType: item.contentType }; }
  selectCover(context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string; jobId: string; artifactId: unknown; title: unknown }) { return this.repository.selectCover(context, input); }
}
class RenderRepositoryUnavailable extends Error {}
