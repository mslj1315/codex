import { readdir, readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import yazl from "yazl";
import { buildServer } from "../src/server.js";
import type { Database } from "../src/db.js";
import { FakeObjectStorage } from "./support/fake-object-storage.js";

describe("import API routes", () => {
  let app: ReturnType<typeof buildServer>;
  let pool: Database;
  let storage: FakeObjectStorage;
  const now = new Date("2026-08-11T03:04:05.000Z");

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
    storage = new FakeObjectStorage();
    app = buildServer({ database: pool, developmentMode: true, objectStorage: storage, now: () => now });
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

  it("returns store-scoped readiness without exposing source identifiers", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/stores/store_demo/readiness?rangeStart=2026-08-01&rangeEnd=2026-08-07" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      rangeStart: "2026-08-01", rangeEnd: "2026-08-07",
      requiredMetrics: ["revenue", "orders", "average_spend"], confidence: "low"
    });
    expect(response.body).not.toContain("batch_");
  });

  it("keeps manual imports available but routes unconfigured file storage through a neutral 503", async () => {
    const unconfigured = buildServer({ database: pool, developmentMode: true });
    const manual = await unconfigured.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/manual",
      payload: {
        rangeStart: "2026-08-01",
        rangeEnd: "2026-08-07",
        candidates: [{ metricKey: "orders", metricDisplayName: "Orders", value: 12, unit: "count", status: "ready" }]
      }
    });

    expect(manual.statusCode).toBe(201);

    const file = await unconfigured.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
      headers: { "content-type": "text/csv", "x-file-name": "weekly.csv" },
      payload: Buffer.from("订单数\n12\n")
    });

    expect(file.statusCode).toBe(503);
    expect(file.json()).toEqual({ error: "Unable to store import file" });
    expect((await pool.query("SELECT source_type FROM import_batches ORDER BY created_at")).rows).toEqual([
      { source_type: "manual" }
    ]);
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
    const bytes = Buffer.from("订单数\n12\n");
    const response = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
      headers: { "content-type": "text/csv", "x-file-name": "weekly.csv" },
      payload: bytes
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      sourceType: "csv",
      duplicate: false,
      candidates: [expect.objectContaining({ metricKey: "orders", value: 12, sourceLocator: "row:1:订单数" })]
    });
    expect(storage.objects.size).toBe(1);
    const [object] = storage.objects.values();
    expect(object).toMatchObject({ contentType: "text/csv" });
    expect(object.key).toMatch(/^imports\/ent_demo\/store_demo\/[0-9a-f-]{36}\/[0-9a-f]{64}\.csv$/);
    expect(object.bytes).not.toBe(bytes);
    expect(object.bytes.equals(bytes)).toBe(true);

    const files = await pool.query("SELECT * FROM import_files");
    expect(files.rows).toHaveLength(1);
    expect(files.rows[0]).toMatchObject({
      original_file_name: "weekly.csv",
      normalized_mime_type: "text/csv",
      byte_count: bytes.byteLength,
      object_key: object.key
    });
    expect(new Date(files.rows[0].uploaded_at as string)).toEqual(now);
    expect(new Date(files.rows[0].expires_at as string)).toEqual(new Date("2026-11-09T03:04:05.000Z"));
  });

  it("stores XLSX bytes with the normalized content type and xlsx object suffix", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("weekly");
    sheet.addRow(["订单数"]);
    sheet.addRow([18]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());

    const response = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "x-file-name": "weekly.xlsx"
      },
      payload: bytes
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ sourceType: "xlsx", duplicate: false });
    const [object] = storage.objects.values();
    expect(object.key).toMatch(/\.xlsx$/);
    expect(object.contentType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(object.bytes.equals(bytes)).toBe(true);
  });

  it("uses the filename extension rather than an arbitrary multipart MIME type", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("weekly");
    sheet.addRow(["订单数"]);
    sheet.addRow([18]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const boundary = "----untrusted-mime";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="upload"; filename="weekly.xlsx"\r\nContent-Type: text/csv\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="rangeStart"\r\n\r\n2026-08-01\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="rangeEnd"\r\n\r\n2026-08-07\r\n--${boundary}--\r\n`)
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/file",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ sourceType: "xlsx", duplicate: false });
    const [object] = storage.objects.values();
    expect(object.key).toMatch(/\.xlsx$/);
    expect(object.contentType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  it("reopens a same-store duplicate before file type detection or parsing", async () => {
    const bytes = Buffer.from("订单数\n12\n");
    const first = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
      headers: { "content-type": "text/csv", "x-file-name": "weekly.csv" },
      payload: bytes
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "x-file-name": "renamed.xlsx"
      },
      payload: bytes
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ id: first.json().id, duplicate: true });
    expect(storage.objects.size).toBe(1);
    expect((await pool.query("SELECT * FROM import_batches")).rows).toHaveLength(1);
    expect((await pool.query("SELECT * FROM import_files")).rows).toHaveLength(1);
  });

  it("scopes duplicate identity to enterprise and store", async () => {
    const bytes = Buffer.from("订单数\n12\n");
    const upload = (server: ReturnType<typeof buildServer>, storeId: string) => server.inject({
      method: "POST",
      url: `/v1/stores/${storeId}/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07`,
      headers: { "content-type": "text/csv", "x-file-name": "weekly.csv" },
      payload: bytes
    });
    const otherStore = buildServer({
      database: pool,
      trustedContextResolver: async () => ({ enterpriseId: "ent_demo", storeId: "store_other", actorId: "actor_demo" }),
      objectStorage: storage,
      now: () => now
    });
    const otherEnterprise = buildServer({
      database: pool,
      trustedContextResolver: async () => ({ enterpriseId: "ent_other", storeId: "store_demo", actorId: "actor_other" }),
      objectStorage: storage,
      now: () => now
    });

    expect((await upload(app, "store_demo")).statusCode).toBe(201);
    expect((await upload(otherStore, "store_other")).statusCode).toBe(201);
    expect((await upload(otherEnterprise, "store_demo")).statusCode).toBe(201);
    expect(storage.objects.size).toBe(3);
    expect((await pool.query("SELECT * FROM import_batches")).rows).toHaveLength(3);
    await otherStore.close();
    await otherEnterprise.close();
  });

  it("creates independent batches for different contents in the same period", async () => {
    for (const value of [12, 13]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
        headers: { "content-type": "text/csv", "x-file-name": "weekly.csv" },
        payload: Buffer.from(`订单数\n${value}\n`)
      });
      expect(response.statusCode).toBe(201);
    }
    expect(storage.objects.size).toBe(2);
    expect((await pool.query("SELECT * FROM import_batches")).rows).toHaveLength(2);
  });

  it("does not store or persist an XLSX archive rejected by parser preflight", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "x-file-name": "expanded.xlsx"
      },
      payload: await createZip(Buffer.alloc(6 * 1024 * 1024), "xl/sharedStrings.xml")
    });

    expect(response.statusCode).toBe(422);
    expect(storage.objects.size).toBe(0);
    expect((await pool.query("SELECT * FROM import_batches")).rows).toHaveLength(0);
    expect((await pool.query("SELECT * FROM import_files")).rows).toHaveLength(0);
  });

  it("returns 422 without persistence for non-ZIP XLSX content despite a CSV MIME type", async () => {
    const boundary = "----invalid-xlsx-mime";
    const response = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/file",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipartFileBody(boundary, "report.xlsx", "text/csv", Buffer.from("not a zip archive"))
    });

    expect(response.statusCode).toBe(422);
    await expectNoFilePersistence(pool, storage);
  });

  it("returns 422 without persistence for a damaged XLSX ZIP", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("weekly");
    sheet.addRow(["订单数"]);
    sheet.addRow([18]);
    const valid = Buffer.from(await workbook.xlsx.writeBuffer());
    const damaged = valid.subarray(0, Math.floor(valid.length / 2));
    const response = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "x-file-name": "damaged.xlsx"
      },
      payload: damaged
    });

    expect(response.statusCode).toBe(422);
    await expectNoFilePersistence(pool, storage);
  });

  it("returns 422 without persistence for CSV bytes that are not valid UTF-8", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
      headers: { "content-type": "text/csv", "x-file-name": "invalid.csv" },
      payload: Buffer.from([0xff, 0xfe, 0xfd, 0x0a])
    });

    expect(response.statusCode).toBe(422);
    await expectNoFilePersistence(pool, storage);
  });

  it("returns 422 without persistence when a valid file has no supported metrics", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
      headers: { "content-type": "text/csv", "x-file-name": "weather.csv" },
      payload: Buffer.from("天气\n晴\n")
    });

    expect(response.statusCode).toBe(422);
    await expectNoFilePersistence(pool, storage);
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

async function createZip(contents: Buffer, fileName: string): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  const chunks: Buffer[] = [];
  zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
  const archive = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
  });
  zip.addBuffer(contents, fileName, { compress: true });
  zip.end();
  return archive;
}

function multipartFileBody(boundary: string, filename: string, mimeType: string, bytes: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="upload"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="rangeStart"\r\n\r\n2026-08-01\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="rangeEnd"\r\n\r\n2026-08-07\r\n--${boundary}--\r\n`)
  ]);
}

async function expectNoFilePersistence(database: Database, storage: FakeObjectStorage): Promise<void> {
  expect(storage.objects.size).toBe(0);
  expect((await database.query("SELECT * FROM import_batches")).rows).toHaveLength(0);
  expect((await database.query("SELECT * FROM import_files")).rows).toHaveLength(0);
}
