import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { ObjectStorageError } from "../src/storage/object-storage.js";

describe("object storage failure logging", () => {
  it("logs one redacted structured storage error while returning a neutral 503", async () => {
    const logs: Record<string, unknown>[] = [];
    const cause = Object.assign(new Error("private-secret-marker visible-access-marker raw-file-marker"), {
      code: "AccessDenied",
      accessKey: "visible-access-marker",
      bytes: Buffer.from("raw-file-marker")
    });
    const app = buildServer({
      database: databaseWithoutSchema(),
      trustedContextResolver: async () => {
        throw new ObjectStorageError("private-secret-marker", cause);
      },
      logger: captureErrorLogs(logs)
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
      headers: { "content-type": "text/csv", "x-file-name": "weekly.csv" },
      payload: Buffer.from("raw-file-marker")
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "Unable to store import file" });
    const storageLogs = logs.filter((entry) => entry.event === "import_object_storage_error");
    expect(storageLogs).toHaveLength(1);
    expect(storageLogs[0]).toMatchObject({
      requestId: expect.any(String),
      route: "/v1/stores/:storeId/imports/file",
      storageError: {
        message: "Unable to store import file",
        cause: { type: "Error", code: "AccessDenied" }
      }
    });
    const serialized = JSON.stringify(storageLogs[0]);
    expect(serialized).not.toContain("private-secret-marker");
    expect(serialized).not.toContain("visible-access-marker");
    expect(serialized).not.toContain("raw-file-marker");
    expect(response.body).not.toContain("private-secret-marker");
    expect(response.body).not.toContain("AccessDenied");
    await app.close();
  });

  it("does not record a ValidationError as an object storage failure", async () => {
    const logs: Record<string, unknown>[] = [];
    const app = buildServer({
      database: databaseWithoutSchema(),
      trustedContextResolver: async () => ({
        enterpriseId: "ent_demo",
        storeId: "store_demo",
        actorId: "actor_demo"
      }),
      logger: captureErrorLogs(logs)
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/manual",
      payload: { rangeStart: "2026-08-01", rangeEnd: "2026-08-07", candidates: [] }
    });

    expect(response.statusCode).toBe(422);
    expect(logs.filter((entry) => entry.event === "import_object_storage_error")).toEqual([]);
    await app.close();
  });
});

function databaseWithoutSchema() {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  return new Pool();
}

function captureErrorLogs(logs: Record<string, unknown>[]) {
  return {
    level: "error",
    stream: {
      write(message: string) {
        logs.push(JSON.parse(message) as Record<string, unknown>);
      }
    }
  };
}
