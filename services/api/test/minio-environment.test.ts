import { describe, expect, it } from "vitest";
import {
  createMinioObjectStorageFromEnv,
  type MinioClient,
  type MinioClientOptions
} from "../src/storage/minio-object-storage.js";

const completeEnvironment = {
  MINIO_ENDPOINT: "http://minio.internal:9100",
  MINIO_ACCESS_KEY: "access",
  MINIO_SECRET_KEY: "secret",
  MINIO_BUCKET: "imports"
};

describe("createMinioObjectStorageFromEnv", () => {
  it("constructs a client from an explicit endpoint port", () => {
    const options: MinioClientOptions[] = [];
    const client = inertClient();

    const storage = createMinioObjectStorageFromEnv(completeEnvironment, (input) => {
      options.push(input);
      return client;
    });

    expect(storage).toBeDefined();
    expect(options).toEqual([{
      endPoint: "minio.internal",
      port: 9100,
      useSSL: false,
      accessKey: "access",
      secretKey: "secret"
    }]);
  });

  it.each([
    ["http://minio.internal", 80, false],
    ["https://minio.internal", 443, true]
  ] as const)("uses the protocol default for %s", (endpoint, port, useSSL) => {
    const options: MinioClientOptions[] = [];

    createMinioObjectStorageFromEnv(
      { ...completeEnvironment, MINIO_ENDPOINT: endpoint },
      (input) => { options.push(input); return inertClient(); }
    );

    expect(options[0]).toMatchObject({ endPoint: "minio.internal", port, useSSL });
  });

  it.each([
    "MINIO_ENDPOINT",
    "MINIO_ACCESS_KEY",
    "MINIO_SECRET_KEY",
    "MINIO_BUCKET"
  ] as const)("does not construct a partially configured client when %s is missing", (missingKey) => {
    const environment: Record<string, string | undefined> = { ...completeEnvironment };
    delete environment[missingKey];
    let factoryCalls = 0;

    const storage = createMinioObjectStorageFromEnv(environment, () => {
      factoryCalls += 1;
      return inertClient();
    });

    expect(storage).toBeUndefined();
    expect(factoryCalls).toBe(0);
  });

  it("treats whitespace-only values as missing", () => {
    let factoryCalls = 0;
    const storage = createMinioObjectStorageFromEnv(
      { ...completeEnvironment, MINIO_BUCKET: "   " },
      () => { factoryCalls += 1; return inertClient(); }
    );

    expect(storage).toBeUndefined();
    expect(factoryCalls).toBe(0);
  });
});

function inertClient(): MinioClient {
  return {
    async bucketExists() { return true; },
    async makeBucket() {},
    async putObject() { return {}; },
    async statObject() { return {}; },
    async removeObject() {}
  };
}
