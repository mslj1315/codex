import { createReadStream, createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface VideoObjectMetadata {
  sizeBytes: number;
  contentType: string;
  durationSeconds: number;
  etag: string;
  version: string;
}

export interface DirectUploadTarget {
  method: "PUT";
  url: string;
}

/** Server-controlled storage boundary. Implementations must not expose credentials. */
export interface VideoStorage {
  createDirectUpload(objectKey: string, contentType: string, expiresAt: Date): Promise<DirectUploadTarget>;
  inspect(objectKey: string): Promise<VideoObjectMetadata | undefined>;
  finalizeUpload(objectKey: string): Promise<VideoObjectMetadata | undefined>;
  revokeUpload(objectKey: string): Promise<void>;
  delete(objectKey: string): Promise<void>;
}
/** Worker-only credentialed port. It is never passed to a customer response. */
export interface ProtectedRenderStorage {
  downloadToFile(objectKey: string, destinationPath: string): Promise<void>;
  putProtectedFile(objectKey: string, sourcePath: string, metadata: { contentType: "video/mp4" | "image/jpeg"; expiresAt: Date }): Promise<void>;
  deleteProtected(objectKey: string): Promise<void>;
  streamProtected(objectKey: string): Promise<{ body: Readable; contentType: "video/mp4" | "image/jpeg" }>;
}

export class InMemoryVideoStorage implements VideoStorage, ProtectedRenderStorage {
  private readonly objects = new Map<string, VideoObjectMetadata>(); private readonly closed = new Set<string>();
  private readonly protectedObjects = new Map<string, "video/mp4" | "image/jpeg">();
  async createDirectUpload(objectKey: string): Promise<DirectUploadTarget> { return { method: "PUT", url: `memory-upload://${encodeURIComponent(objectKey)}` }; }
  async inspect(objectKey: string): Promise<VideoObjectMetadata | undefined> { return this.objects.get(objectKey); }
  async finalizeUpload(objectKey: string): Promise<VideoObjectMetadata | undefined> { const object = this.objects.get(objectKey); if (object) this.closed.add(objectKey); return object; }
  async revokeUpload(objectKey: string): Promise<void> { this.closed.add(objectKey); this.objects.delete(objectKey); }
  async delete(objectKey: string): Promise<void> { this.objects.delete(objectKey); }
  async put(objectKey: string, metadata: Omit<VideoObjectMetadata, "etag" | "version">): Promise<void> { if (this.closed.has(objectKey) || this.objects.has(objectKey)) throw new Error("immutable upload"); this.objects.set(objectKey, { ...metadata, etag: `etag-${objectKey}`, version: `version-${objectKey}` }); }
  async downloadToFile(objectKey: string, destinationPath: string): Promise<void> { if (!this.objects.has(objectKey)) throw Object.assign(new Error("source unavailable"), { code: "ENOENT" }); await writeFile(destinationPath, "source"); }
  async putProtectedFile(objectKey: string, _sourcePath: string, metadata: { contentType: "video/mp4" | "image/jpeg"; expiresAt: Date }): Promise<void> { if (this.protectedObjects.has(objectKey)) throw new Error("immutable output"); this.protectedObjects.set(objectKey, metadata.contentType); }
  async deleteProtected(objectKey: string): Promise<void> { this.protectedObjects.delete(objectKey); }
  async streamProtected(objectKey: string) { const contentType = this.protectedObjects.get(objectKey); if (!contentType) throw Object.assign(new Error("protected output unavailable"), { code: "ENOENT" }); return { body: Readable.from(["protected"]), contentType }; }
}

/** Video routes are fail-closed until a server-side object-storage signer is installed. */
export function createConfiguredVideoStorage(environment: Record<string, string | undefined>): VideoStorage | undefined {
  const mode = environment.VIDEO_STORAGE_MODE;
  if (!mode || mode === "disabled") return undefined;
  if (mode !== "internal_signer" || !environment.VIDEO_STORAGE_SIGNER_URL || !environment.VIDEO_STORAGE_SIGNER_TOKEN) throw new Error("VIDEO_STORAGE_MODE requires internal_signer plus VIDEO_STORAGE_SIGNER_URL and VIDEO_STORAGE_SIGNER_TOKEN");
  return new InternalSignerVideoStorage(environment.VIDEO_STORAGE_SIGNER_URL, environment.VIDEO_STORAGE_SIGNER_TOKEN);
}

class InternalSignerVideoStorage implements VideoStorage, ProtectedRenderStorage {
  constructor(private readonly endpoint: string, private readonly token: string) { const url = new URL(endpoint); if (url.protocol !== "https:" || !url.hostname) throw new Error("VIDEO_STORAGE_SIGNER_URL must be an absolute HTTPS URL"); }
  async createDirectUpload(objectKey: string, contentType: string, expiresAt: Date) { return uploadTarget(await this.call<unknown>("create", { objectKey, contentType, expiresAt: expiresAt.toISOString() })); }
  async inspect(objectKey: string) { return this.call<VideoObjectMetadata | undefined>("inspect", { objectKey }); }
  async finalizeUpload(objectKey: string) { return this.call<VideoObjectMetadata | undefined>("finalize", { objectKey }); }
  async revokeUpload(objectKey: string) { await this.call<void>("revoke", { objectKey }); }
  async delete(objectKey: string) { await this.call<void>("delete", { objectKey }); }
  async downloadToFile(objectKey: string, destinationPath: string) { const response = await this.callResponse("worker-download", { objectKey }); if (!response.body) throw Object.assign(new Error("video storage signer request failed"), { code: "ETIMEDOUT" }); await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(destinationPath)); }
  async putProtectedFile(objectKey: string, sourcePath: string, metadata: { contentType: "video/mp4" | "image/jpeg"; expiresAt: Date }) { await this.call<void>("worker-put-protected", { objectKey, contentType: metadata.contentType, expiresAt: metadata.expiresAt.toISOString() }, createReadStream(sourcePath)); }
  async deleteProtected(objectKey: string) { await this.call<void>("worker-delete-protected", { objectKey }); }
  async streamProtected(objectKey: string) { const response = await this.callResponse("delivery-stream", { objectKey }); if (!response.body) throw Object.assign(new Error("video storage signer request failed"), { code: "ETIMEDOUT" }); const contentType = response.headers.get("content-type"); if (contentType !== "video/mp4" && contentType !== "image/jpeg") throw new Error("invalid protected content type"); return { body: Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), contentType: contentType as "video/mp4" | "image/jpeg" }; }
  private async call<T>(action: string, body: unknown, file?: ReturnType<typeof createReadStream>): Promise<T> { const response = await this.callResponse(action, body, file); return response.status === 204 ? undefined as T : await response.json() as T; }
  private async callResponse(action: string, body: unknown, file?: ReturnType<typeof createReadStream>): Promise<Response> { let response: Response; try { const request = file ? { method: "POST", headers: { authorization: `Bearer ${this.token}`, "x-object-key": String((body as { objectKey: string }).objectKey), "x-content-type": String((body as { contentType: string }).contentType), "x-expires-at": String((body as { expiresAt: string }).expiresAt) }, body: file as unknown as ReadableStream, duplex: "half" } as RequestInit : { method: "POST", headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" }, body: JSON.stringify(body) }; response = await fetch(`${this.endpoint.replace(/\/$/, "")}/${action}`, request); } catch { throw Object.assign(new Error("video storage signer request failed"), { code: "ECONNRESET" }); } if (!response.ok) throw Object.assign(new Error("video storage signer request failed"), { code: "ETIMEDOUT" }); return response; }
}
function uploadTarget(value: unknown): DirectUploadTarget { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid upload target"); const item = value as Record<string, unknown>; if (item.method !== "PUT" || typeof item.url !== "string" || Object.keys(item).some(key => /secret|token|credential|access.?key/i.test(key))) throw new Error("invalid upload target"); try { const url = new URL(item.url); if (url.protocol !== "https:" || !url.hostname) throw new Error(); } catch { throw new Error("invalid upload target"); } return { method: "PUT", url: item.url }; }
