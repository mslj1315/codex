import { Client } from "minio";
import { ObjectStorageError, type ObjectStorage, type StoredObjectInput } from "./object-storage.js";

export interface MinioClientOptions {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
}

export class ObjectStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStorageConfigurationError";
  }
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
      try {
        await this.client.makeBucket(this.bucket);
      } catch (error) {
        if (!hasErrorCode(error, "BucketAlreadyOwnedByYou")) throw error;
      }
    }
  }
}

export function createMinioObjectStorageFromEnv(
  environment: Record<string, string | undefined>,
  createClient: (options: MinioClientOptions) => MinioClient = (options) => new Client(options)
): MinioObjectStorage | undefined {
  const configured = minioEnvironmentKeys.filter((key) => isNonEmpty(environment[key]));
  if (configured.length === 0) return undefined;
  const missing = minioEnvironmentKeys.filter((key) => !isNonEmpty(environment[key]));
  if (missing.length > 0) {
    throw new ObjectStorageConfigurationError(`Missing MinIO configuration: ${missing.join(", ")}`);
  }

  const endpoint = parseEndpoint(environment.MINIO_ENDPOINT!);
  const bucket = environment.MINIO_BUCKET!.trim();
  if (!isValidBucketName(bucket)) {
    throw new ObjectStorageConfigurationError(`Invalid MINIO_BUCKET: ${bucket}`);
  }
  const useSSL = endpoint.protocol === "https:";
  const port = endpoint.port === "" ? (useSSL ? 443 : 80) : Number(endpoint.port);
  const client = createClient({
    endPoint: endpoint.hostname,
    port,
    useSSL,
    accessKey: environment.MINIO_ACCESS_KEY!,
    secretKey: environment.MINIO_SECRET_KEY!
  });
  return new MinioObjectStorage(client, bucket);
}

const missingObjectCodes = new Set(["NoSuchKey", "NotFound", "NoSuchObject"]);

function isMissingObject(error: unknown): boolean {
  return [...missingObjectCodes].some((code) => hasErrorCode(error, code));
}

function hasErrorCode(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return candidate.code === code || candidate.name === code;
}

function unwrapCause(error: unknown): unknown {
  return error instanceof ObjectStorageError ? error.cause : error;
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const minioEnvironmentKeys = [
  "MINIO_ENDPOINT",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "MINIO_BUCKET"
] as const;

function parseEndpoint(value: string): URL {
  const input = value.trim();
  if (!/^https?:\/\/[^/?#]+\/?$/i.test(input)) {
    throw new ObjectStorageConfigurationError("Invalid MINIO_ENDPOINT");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(input);
  } catch {
    throw new ObjectStorageConfigurationError("Invalid MINIO_ENDPOINT");
  }
  if (
    (endpoint.protocol !== "http:" && endpoint.protocol !== "https:")
    || endpoint.username !== ""
    || endpoint.password !== ""
    || (endpoint.pathname !== "" && endpoint.pathname !== "/")
    || endpoint.search !== ""
    || endpoint.hash !== ""
    || endpoint.port === "0"
  ) {
    throw new ObjectStorageConfigurationError("Invalid MINIO_ENDPOINT");
  }
  return endpoint;
}

// Mirrors the public behavior enforced by minio@8.0.7 without importing its blocked internal helper.
function isValidBucketName(bucket: string): boolean {
  return bucket.length >= 3
    && bucket.length <= 63
    && !bucket.includes("..")
    && !/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/.test(bucket)
    && /^[a-z0-9][a-z0-9.-]+[a-z0-9]$/.test(bucket);
}
