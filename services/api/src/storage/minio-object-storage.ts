import { Client } from "minio";
import { ObjectStorageError, type ObjectStorage, type StoredObjectInput } from "./object-storage.js";

export interface MinioClientOptions {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
}

export interface MinioClient {
  bucketExists(bucket: string): Promise<boolean>;
  makeBucket(bucket: string): Promise<void>;
  putObject(
    bucket: string,
    key: string,
    bytes: Buffer,
    size: number,
    metadata: Record<string, string>
  ): Promise<unknown>;
  statObject(bucket: string, key: string): Promise<unknown>;
  removeObject(bucket: string, key: string): Promise<void>;
}

export class MinioObjectStorage implements ObjectStorage {
  private bucketReady: Promise<void> | undefined;

  constructor(private readonly client: MinioClient, private readonly bucket: string) {}

  async putObject(input: StoredObjectInput): Promise<void> {
    try {
      await this.ensureBucket();
      await this.client.putObject(
        this.bucket,
        input.key,
        input.bytes,
        input.bytes.length,
        { "Content-Type": input.contentType }
      );
    } catch (error) {
      throw new ObjectStorageError("Unable to store import file", unwrapCause(error));
    }
  }

  async deleteObject(key: string): Promise<"deleted" | "missing"> {
    try {
      await this.ensureBucket();
    } catch (error) {
      throw new ObjectStorageError("Unable to inspect import file", unwrapCause(error));
    }

    try {
      await this.client.statObject(this.bucket, key);
    } catch (error) {
      if (isMissingObject(error)) return "missing";
      throw new ObjectStorageError("Unable to inspect import file", unwrapCause(error));
    }

    try {
      await this.client.removeObject(this.bucket, key);
      return "deleted";
    } catch (error) {
      throw new ObjectStorageError("Unable to delete import file", unwrapCause(error));
    }
  }

  private async ensureBucket(): Promise<void> {
    if (!this.bucketReady) this.bucketReady = this.initializeBucket();
    const pending = this.bucketReady;
    try {
      await pending;
    } catch (error) {
      if (this.bucketReady === pending) this.bucketReady = undefined;
      throw error;
    }
  }

  private async initializeBucket(): Promise<void> {
    if (!await this.client.bucketExists(this.bucket)) {
      await this.client.makeBucket(this.bucket);
    }
  }
}

export function createMinioObjectStorageFromEnv(
  environment: Record<string, string | undefined>,
  createClient: (options: MinioClientOptions) => MinioClient = (options) => new Client(options)
): MinioObjectStorage | undefined {
  const endpointValue = environment.MINIO_ENDPOINT;
  const accessKey = environment.MINIO_ACCESS_KEY;
  const secretKey = environment.MINIO_SECRET_KEY;
  const bucket = environment.MINIO_BUCKET;
  if (![endpointValue, accessKey, secretKey, bucket].every(isNonEmpty)) return undefined;

  const endpoint = new URL(endpointValue!.trim());
  const useSSL = endpoint.protocol === "https:";
  const port = endpoint.port === "" ? (useSSL ? 443 : 80) : Number(endpoint.port);
  const client = createClient({
    endPoint: endpoint.hostname,
    port,
    useSSL,
    accessKey: accessKey!,
    secretKey: secretKey!
  });
  return new MinioObjectStorage(client, bucket!.trim());
}

const missingObjectCodes = new Set(["NoSuchKey", "NotFound", "NoSuchObject"]);

function isMissingObject(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return missingObjectCodes.has(String(candidate.code)) || missingObjectCodes.has(String(candidate.name));
}

function unwrapCause(error: unknown): unknown {
  return error instanceof ObjectStorageError ? error.cause : error;
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
