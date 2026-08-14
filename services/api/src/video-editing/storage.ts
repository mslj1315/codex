export interface VideoObjectMetadata {
  sizeBytes: number;
  contentType: string;
  durationSeconds: number;
}

export interface DirectUploadTarget {
  method: "PUT";
  url: string;
}

/** Server-controlled storage boundary. Implementations must not expose credentials. */
export interface VideoStorage {
  createDirectUpload(objectKey: string, contentType: string, expiresAt: Date): Promise<DirectUploadTarget>;
  inspect(objectKey: string): Promise<VideoObjectMetadata | undefined>;
  delete(objectKey: string): Promise<void>;
}

export class InMemoryVideoStorage implements VideoStorage {
  private readonly objects = new Map<string, VideoObjectMetadata>();
  async createDirectUpload(objectKey: string): Promise<DirectUploadTarget> { return { method: "PUT", url: `memory-upload://${encodeURIComponent(objectKey)}` }; }
  async inspect(objectKey: string): Promise<VideoObjectMetadata | undefined> { return this.objects.get(objectKey); }
  async delete(objectKey: string): Promise<void> { this.objects.delete(objectKey); }
  async put(objectKey: string, metadata: VideoObjectMetadata): Promise<void> { this.objects.set(objectKey, metadata); }
}
