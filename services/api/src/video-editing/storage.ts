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

export class InMemoryVideoStorage implements VideoStorage {
  private readonly objects = new Map<string, VideoObjectMetadata>(); private readonly closed = new Set<string>();
  async createDirectUpload(objectKey: string): Promise<DirectUploadTarget> { return { method: "PUT", url: `memory-upload://${encodeURIComponent(objectKey)}` }; }
  async inspect(objectKey: string): Promise<VideoObjectMetadata | undefined> { return this.objects.get(objectKey); }
  async finalizeUpload(objectKey: string): Promise<VideoObjectMetadata | undefined> { const object = this.objects.get(objectKey); if (object) this.closed.add(objectKey); return object; }
  async revokeUpload(objectKey: string): Promise<void> { this.closed.add(objectKey); this.objects.delete(objectKey); }
  async delete(objectKey: string): Promise<void> { this.objects.delete(objectKey); }
  async put(objectKey: string, metadata: Omit<VideoObjectMetadata, "etag" | "version">): Promise<void> { if (this.closed.has(objectKey) || this.objects.has(objectKey)) throw new Error("immutable upload"); this.objects.set(objectKey, { ...metadata, etag: `etag-${objectKey}`, version: `version-${objectKey}` }); }
}

/** Video routes are fail-closed until a server-side object-storage signer is installed. */
export function createConfiguredVideoStorage(environment: Record<string, string | undefined>): VideoStorage | undefined {
  const mode = environment.VIDEO_STORAGE_MODE;
  if (!mode || mode === "disabled") return undefined;
  throw new Error("VIDEO_STORAGE_MODE requires a server-side immutable object-storage signer; no credential-bearing client mode is supported");
}
