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
  download(objectKey: string): Promise<Buffer>;
  putProtected(objectKey: string, bytes: Buffer, metadata: { contentType: "video/mp4"; expiresAt: Date }): Promise<void>;
  deleteProtected(objectKey: string): Promise<void>;
}

export class InMemoryVideoStorage implements VideoStorage, ProtectedRenderStorage {
  private readonly objects = new Map<string, VideoObjectMetadata>(); private readonly closed = new Set<string>();
  private readonly protectedObjects = new Map<string, Buffer>();
  async createDirectUpload(objectKey: string): Promise<DirectUploadTarget> { return { method: "PUT", url: `memory-upload://${encodeURIComponent(objectKey)}` }; }
  async inspect(objectKey: string): Promise<VideoObjectMetadata | undefined> { return this.objects.get(objectKey); }
  async finalizeUpload(objectKey: string): Promise<VideoObjectMetadata | undefined> { const object = this.objects.get(objectKey); if (object) this.closed.add(objectKey); return object; }
  async revokeUpload(objectKey: string): Promise<void> { this.closed.add(objectKey); this.objects.delete(objectKey); }
  async delete(objectKey: string): Promise<void> { this.objects.delete(objectKey); }
  async put(objectKey: string, metadata: Omit<VideoObjectMetadata, "etag" | "version">): Promise<void> { if (this.closed.has(objectKey) || this.objects.has(objectKey)) throw new Error("immutable upload"); this.objects.set(objectKey, { ...metadata, etag: `etag-${objectKey}`, version: `version-${objectKey}` }); }
  async download(objectKey: string): Promise<Buffer> { if (!this.objects.has(objectKey)) throw Object.assign(new Error("source unavailable"), { code: "ENOENT" }); return Buffer.from("source"); }
  async putProtected(objectKey: string, bytes: Buffer, _metadata?: { contentType: "video/mp4"; expiresAt: Date }): Promise<void> { if (this.protectedObjects.has(objectKey)) throw new Error("immutable output"); this.protectedObjects.set(objectKey, Buffer.from(bytes)); }
  async deleteProtected(objectKey: string): Promise<void> { this.protectedObjects.delete(objectKey); }
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
  async download(objectKey: string) { const value = await this.call<{ bytes: string }>("worker-download", { objectKey }); return Buffer.from(value.bytes, "base64"); }
  async putProtected(objectKey: string, bytes: Buffer, metadata: { contentType: "video/mp4"; expiresAt: Date }) { await this.call<void>("worker-put-protected", { objectKey, bytes: bytes.toString("base64"), contentType: metadata.contentType, expiresAt: metadata.expiresAt.toISOString() }); }
  async deleteProtected(objectKey: string) { await this.call<void>("worker-delete-protected", { objectKey }); }
  private async call<T>(action: string, body: unknown): Promise<T> { const response = await fetch(`${this.endpoint.replace(/\/$/, "")}/${action}`, { method: "POST", headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" }, body: JSON.stringify(body) }); if (!response.ok) throw new Error("video storage signer request failed"); return response.status === 204 ? undefined as T : await response.json() as T; }
}
function uploadTarget(value: unknown): DirectUploadTarget { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid upload target"); const item = value as Record<string, unknown>; if (item.method !== "PUT" || typeof item.url !== "string" || Object.keys(item).some(key => /secret|token|credential|access.?key/i.test(key))) throw new Error("invalid upload target"); try { const url = new URL(item.url); if (url.protocol !== "https:" || !url.hostname) throw new Error(); } catch { throw new Error("invalid upload target"); } return { method: "PUT", url: item.url }; }
