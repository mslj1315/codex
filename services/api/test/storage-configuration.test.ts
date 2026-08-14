import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("object storage deployment configuration", () => {
  it("documents the API MinIO access, secret and bucket variables", async () => {
    const environment = await readFile(new URL("../../../.env.example", import.meta.url), "utf8");

    expect(environment).toContain("MINIO_ACCESS_KEY=localminio");
    expect(environment).toContain("MINIO_SECRET_KEY=local-development-placeholder");
    expect(environment).toContain("MINIO_BUCKET=restaurant-imports");
  });

  it("maps MinIO root credentials into API-only variables in Compose", async () => {
    const compose = await readFile(new URL("../../../docker-compose.yml", import.meta.url), "utf8");

    expect(compose).toContain("MINIO_ACCESS_KEY: ${MINIO_ROOT_USER}");
    expect(compose).toContain("MINIO_SECRET_KEY: ${MINIO_ROOT_PASSWORD}");
    expect(compose).toContain("MINIO_BUCKET: ${MINIO_BUCKET}");
  });

  it("does not put MinIO credentials into Gradle or the Android app", async () => {
    const gradleFiles = await Promise.all([
      "../../../build.gradle.kts",
      "../../../settings.gradle.kts",
      "../../../gradle.properties",
      "../../../apps/android/app/build.gradle.kts"
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

    expect(gradleFiles.join("\n")).not.toMatch(/MINIO_(?:ACCESS_KEY|SECRET_KEY|BUCKET|ROOT_USER|ROOT_PASSWORD)/);
  });
});
