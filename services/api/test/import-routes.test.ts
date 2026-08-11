import { readdir, readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { Database } from "../src/db.js";

describe("import API routes", () => {
  let app: ReturnType<typeof buildServer>;
  let pool: Database;

  beforeEach(async () => {
    const memory = newDb();
    memory.public.registerFunction({
      name: "length",
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (value: string) => value.length
    });
    const { Pool } = memory.adapters.createPg();
    pool = new Pool();
    await applyTestMigrations(pool);
    app = buildServer({ database: pool, developmentMode: true });
  });

  it("does not expose import routes without an explicit trusted context provider", async () => {
    const production = buildServer({ database: pool });
    const response = await production.inject({ method: "POST", url: "/v1/stores/store_demo/imports/manual", payload: {} });
    expect(response.statusCode).toBe(404);
  });

  it("allows the local Compose context only when explicitly enabled", async () => {
    const localCompose = buildServer({ database: pool, localContainerDevelopmentMode: true });
    const response = await localCompose.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/manual",
      remoteAddress: "172.18.0.1",
      payload: {
        rangeStart: "2026-08-01",
        rangeEnd: "2026-08-07",
        candidates: [{ metricKey: "orders", metricDisplayName: "Orders", value: 12, unit: "count", status: "ready" }]
      }
    });

    expect(response.statusCode).toBe(201);
  });

  it("creates a manual batch then confirms its ready candidate into an immutable fact version", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/manual",
      payload: {
        enterpriseId: "attacker_enterprise",
        actorId: "attacker_actor",
        rangeStart: "2026-08-01",
        rangeEnd: "2026-08-07",
        candidates: [{
          metricKey: "revenue", metricDisplayName: "Revenue", value: 4826000, unit: "cents",
          sourceLocator: "manual:revenue", confidence: 100, status: "ready"
        }]
      }
    });

    expect(created.statusCode).toBe(201);
    const batch = created.json();
    expect(batch.enterpriseId).toBe("ent_demo");
    expect(batch.actorId).toBe("actor_demo");
    expect(batch.candidates[0]).toMatchObject({ value: 4826000, unit: "cents", confidence: 100, status: "ready" });

    const confirmed = await app.inject({
      method: "POST",
      url: `/v1/stores/store_demo/imports/${batch.id}/confirm`,
      payload: { candidateIds: [batch.candidates[0].id], storeId: "store_other", actorId: "attacker_actor" }
    });

    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json()).toMatchObject({
      enterpriseId: "ent_demo", storeId: "store_demo", confirmationActorId: "actor_demo",
      confirmationStatus: "confirmed", values: [expect.objectContaining({ value: 4826000, unit: "cents" })]
    });
  });

  it("rejects every store route outside the trusted development store", async () => {
    const response = await app.inject({
      method: "POST", url: "/v1/stores/store_other/imports/manual",
      payload: { rangeStart: "2026-08-01", rangeEnd: "2026-08-07", candidates: [] }
    });
    expect(response.statusCode).toBe(403);
  });

  it("does not allow a body scope to override the trusted tenant and actor", async () => {
    const response = await app.inject({
      method: "POST", url: "/v1/stores/store_demo/imports/manual",
      payload: {
        storeId: "store_other", enterpriseId: "ent_other", actorId: "actor_other",
        rangeStart: "2026-08-01", rangeEnd: "2026-08-07",
        candidates: [{ metricKey: "orders", metricDisplayName: "Orders", value: 12, unit: "count", status: "ready" }]
      }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo" });
  });

  it("rejects confirmation of an unresolved candidate", async () => {
    const created = await app.inject({
      method: "POST", url: "/v1/stores/store_demo/imports/manual",
      payload: { rangeStart: "2026-08-01", rangeEnd: "2026-08-07", candidates: [{ metricKey: "revenue", metricDisplayName: "Revenue", value: 1, unit: "unknown", status: "needs_confirmation" }] }
    });
    const batch = created.json();
    const confirmed = await app.inject({ method: "POST", url: `/v1/stores/store_demo/imports/${batch.id}/confirm`, payload: { candidateIds: [batch.candidates[0].id] } });
    expect(confirmed.statusCode).toBe(422);
  });

  it("returns only the latest fact version scoped to the trusted store", async () => {
    const created = await app.inject({
      method: "POST", url: "/v1/stores/store_demo/imports/manual",
      payload: { rangeStart: "2026-08-01", rangeEnd: "2026-08-07", candidates: [{ metricKey: "orders", metricDisplayName: "Orders", value: 12, unit: "count", status: "ready" }] }
    });
    const batch = created.json();
    await app.inject({ method: "POST", url: `/v1/stores/store_demo/imports/${batch.id}/confirm`, payload: { candidateIds: [batch.candidates[0].id] } });
    const latest = await app.inject({ method: "GET", url: "/v1/stores/store_demo/facts/latest" });
    expect(latest.statusCode).toBe(200);
    expect(latest.json()).toMatchObject({ storeId: "store_demo", values: [expect.objectContaining({ metricKey: "orders", value: 12 })] });
    const other = await app.inject({ method: "GET", url: "/v1/stores/store_other/facts/latest" });
    expect(other.statusCode).toBe(403);
  });

  it("parses a bounded raw CSV upload into source-backed candidates", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
      headers: { "content-type": "text/csv", "x-file-name": "weekly.csv" },
      payload: Buffer.from("订单数\n12\n")
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ sourceType: "csv", candidates: [expect.objectContaining({ metricKey: "orders", value: 12, sourceLocator: "row:1:订单数" })] });
  });

  it("rejects an upload whose declared size exceeds the raw upload cap before parsing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
      headers: { "content-type": "text/csv", "x-file-name": "weekly.csv", "content-length": String(5 * 1024 * 1024 + 1) },
      payload: "订单数\n12\n"
    });
    expect(response.statusCode).toBe(413);
  });

  it("rolls back the whole manual import when a later candidate is invalid", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/stores/store_demo/imports/manual", payload: {
      rangeStart: "2026-08-01", rangeEnd: "2026-08-07",
      candidates: [
        { metricKey: "orders", metricDisplayName: "Orders", value: 12, unit: "count", status: "ready" },
        { metricKey: "orders", metricDisplayName: "Orders", value: 1.5, unit: "count", status: "ready" }
      ]
    } });
    expect(response.statusCode).toBe(422);
    expect(await pool.query("SELECT * FROM import_batches")).toMatchObject({ rows: [] });
  });

  it("rejects a resolved candidate with a metric-unit mismatch and rejects patching a confirmed batch", async () => {
    const invalid = await app.inject({ method: "POST", url: "/v1/stores/store_demo/imports/manual", payload: {
      rangeStart: "2026-08-01", rangeEnd: "2026-08-07",
      candidates: [{ metricKey: "orders", metricDisplayName: "Orders", value: 12, unit: "cents", status: "ready" }]
    } });
    expect(invalid.statusCode).toBe(422);

    const created = await app.inject({ method: "POST", url: "/v1/stores/store_demo/imports/manual", payload: {
      rangeStart: "2026-08-01", rangeEnd: "2026-08-07",
      candidates: [{ metricKey: "orders", metricDisplayName: "Orders", value: 12, unit: "count", status: "ready" }]
    } });
    const batch = created.json();
    await app.inject({ method: "POST", url: `/v1/stores/store_demo/imports/${batch.id}/confirm`, payload: { candidateIds: [batch.candidates[0].id] } });
    const patched = await app.inject({ method: "PATCH", url: `/v1/stores/store_demo/imports/${batch.id}/candidates/${batch.candidates[0].id}`, payload: { value: 13 } });
    expect(patched.statusCode).toBe(409);
  });

  it("accepts multipart fields that arrive after the file part", async () => {
    const boundary = "----codex-boundary";
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="upload"; filename="weekly.csv"\r\nContent-Type: text/csv\r\n\r\n订单数\n12\n\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="rangeStart"\r\n\r\n2026-08-01\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="rangeEnd"\r\n\r\n2026-08-07\r\n--${boundary}--\r\n`
    ].join("");
    const response = await app.inject({ method: "POST", url: "/v1/stores/store_demo/imports/file", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(response.statusCode).toBe(201);
  });

  it("maps Fastify raw body-limit errors to 413", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07", headers: { "content-type": "text/csv", "x-file-name": "weekly.csv" }, payload: Buffer.alloc(5 * 1024 * 1024 + 1) });
    expect(response.statusCode).toBe(413);
  });

  it("rejects multipart fields that exceed the upload request bound without a content length", async () => {
    const boundary = "----too-many-fields";
    const fields = Array.from({ length: 8 }, (_, index) => `--${boundary}\r\nContent-Disposition: form-data; name="extra${index}"\r\n\r\nvalue\r\n`).join("");
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="upload"; filename="weekly.csv"\r\nContent-Type: text/csv\r\n\r\n订单数\n12\n\r\n`,
      fields,
      `--${boundary}\r\nContent-Disposition: form-data; name="rangeStart"\r\n\r\n2026-08-01\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="rangeEnd"\r\n\r\n2026-08-07\r\n--${boundary}--\r\n`
    ].join("");
    const response = await app.inject({ method: "POST", url: "/v1/stores/store_demo/imports/file", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(response.statusCode).toBe(413);
  });

  it("rejects manual candidates with persisted-only statuses or invalid confidence before persistence", async () => {
    for (const candidate of [
      { metricKey: "orders", metricDisplayName: "Orders", value: 12, unit: "count", status: "confirmed", confidence: 100 },
      { metricKey: "orders", metricDisplayName: "Orders", value: 12, unit: "count", status: "rejected", confidence: 100 },
      { metricKey: "orders", metricDisplayName: "Orders", value: 12, unit: "count", status: "ready", confidence: 100.5 },
      { metricKey: "orders", metricDisplayName: "Orders", value: 12, unit: "count", status: "ready", confidence: 101 }
    ]) {
      const response = await app.inject({ method: "POST", url: "/v1/stores/store_demo/imports/manual", payload: { rangeStart: "2026-08-01", rangeEnd: "2026-08-07", candidates: [candidate] } });
      expect(response.statusCode).toBe(422);
    }
    expect(await pool.query("SELECT * FROM import_batches")).toMatchObject({ rows: [] });
  });
});

async function applyTestMigrations(database: Database): Promise<void> {
  const migrationsUrl = new URL("../migrations/", import.meta.url);
  const fileNames = (await readdir(migrationsUrl))
    .filter((fileName) => /^\d+.*\.sql$/.test(fileName))
    .sort();

  for (const fileName of fileNames) {
    const migration = await readFile(new URL(fileName, migrationsUrl), "utf8");
    // pg-mem supports relational constraints but not PostgreSQL PL/pgSQL triggers.
    await database.query(migration.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
  }
}
