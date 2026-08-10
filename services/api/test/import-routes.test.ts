import { readFile } from "node:fs/promises";
import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("import API routes", () => {
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    const memory = newDb();
    const { Pool } = memory.adapters.createPg();
    const pool = new Pool();
    const migration = await readFile(new URL("../migrations/001_imports.sql", import.meta.url), "utf8");
    await pool.query(migration.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
    app = buildServer({ database: pool });
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
});
