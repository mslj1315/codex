import type { TrustedContext } from "../imports/service.js";
import { RenderRepository } from "./render-repository.js";
export class RenderService { constructor(private readonly repository: RenderRepository) {} enqueue(context: TrustedContext, input: { taskId: string; shotListId: string; projectId: string; kind: unknown }) { return this.repository.enqueue(context, input); } }
