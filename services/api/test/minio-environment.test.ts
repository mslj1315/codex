import { describe, expect, it } from "vitest";
import {
  createMinioObjectStorageFromEnv,
  type MinioClient,
  type MinioClientOptions
} from "../src/storage/minio-object-storage.js";

const completeEnvironment = {
  MINIO_ENDPOINT: "http://minio.internal:9100",
  MINIO_ACCESS_KEY: "visible-access-marker",
  MINIO_SECRET_KEY: "private-secret-marker",
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
      accessKey: "visible-access-marker",
      secretKey: "private-secret-marker"
    }]);
  });

  it.each([
    ["http://minio.internal", 80, false],
    ["https://minio.internal/", 443, true]
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
  ] as const)("rejects partial configuration when %s is missing", (missingKey) => {
    const environment: Record<string, string | undefined> = { ...completeEnvironment };
    delete environment[missingKey];
    let factoryCalls = 0;

    expect(() => createMinioObjectStorageFromEnv(environment, () => {
        factoryCalls += 1;
        return inertClient();
      }))
      .toThrow(`Missing MinIO configuration: ${missingKey}`);

    expect(factoryCalls).toBe(0);
  });

  it("returns undefined only when every MinIO value is absent or blank", () => {
    let factoryCalls = 0;
    const factory = () => { factoryCalls += 1; return inertClient(); };

    expect(createMinioObjectStorageFromEnv({}, factory)).toBeUndefined();
    expect(createMinioObjectStorageFromEnv({
      MINIO_ENDPOINT: " ", MINIO_ACCESS_KEY: "\t", MINIO_SECRET_KEY: "", MINIO_BUCKET: "  "
    }, factory)).toBeUndefined();
    expect(factoryCalls).toBe(0);
  });

  it("lists every blank variable in a partial configuration without exposing credentials", () => {
    expect(() => createMinioObjectStorageFromEnv({
      ...completeEnvironment,
      MINIO_ACCESS_KEY: " ",
      MINIO_SECRET_KEY: ""
    })).toThrow("Missing MinIO configuration: MINIO_ACCESS_KEY, MINIO_SECRET_KEY");

    try {
      createMinioObjectStorageFromEnv({ ...completeEnvironment, MINIO_BUCKET: "" });
    } catch (error) {
      expect(String(error)).not.toContain("visible-access-marker");
      expect(String(error)).not.toContain("private-secret-marker");
    }
  });

  it.each([
    "ftp://minio.internal",
    "htps://minio.internal",
    "http://user:password@minio.internal",
    "http://minio.internal/imports",
    "http://minio.internal/segment/../",
    "http://minio.internal?region=local",
    "http://minio.internal#fragment",
    "http://minio.internal:0",
    "http://minio.internal:99999"
  ])("rejects unsafe endpoint %s without exposing configuration values", (endpoint) => {
    let factoryCalls = 0;

    expect(() => createMinioObjectStorageFromEnv(
      { ...completeEnvironment, MINIO_ENDPOINT: endpoint },
      () => { factoryCalls += 1; return inertClient(); }
    )).toThrow(/Invalid MINIO_ENDPOINT/);

    try {
      createMinioObjectStorageFromEnv({ ...completeEnvironment, MINIO_ENDPOINT: endpoint });
    } catch (error) {
      expect(String(error)).not.toContain("visible-access-marker");
      expect(String(error)).not.toContain("private-secret-marker");
      expect(String(error)).not.toContain("user:password");
    }
    expect(factoryCalls).toBe(0);
  });

  it.each([
    "ab",
    "UPPERCASE",
    "bad_bucket",
    ".starts-with-dot",
    "ends-with-dot.",
    "successive..periods",
    "127.0.0.1",
    "a".repeat(64)
  ])("rejects invalid bucket name %s during construction", (bucket) => {
    expect(() => createMinioObjectStorageFromEnv({ ...completeEnvironment, MINIO_BUCKET: bucket }))
      .toThrow(`Invalid MINIO_BUCKET: ${bucket}`);
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
