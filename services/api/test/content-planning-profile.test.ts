import { readFile } from "node:fs/promises";
import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { Database } from "../src/db.js";

describe("content planning store profile", () => {
  let app: ReturnType<typeof buildServer>;
  let pool: Database;

  beforeEach(async () => {
    const memory = newDb({ noAstCoverageCheck: true });
    const { Pool } = memory.adapters.createPg();
    pool = new Pool();
    const importsMigration = await readFile(new URL("../migrations/001_imports.sql", import.meta.url), "utf8");
    await pool.query(importsMigration.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
    await pool.query(await readFile(new URL("../migrations/013_content_planning_profile.sql", import.meta.url), "utf8"));
    app = buildServer({ database: pool, developmentMode: true });
  });

  it("requires the complete first-visit profile and returns completeness", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/stores/store_demo/content-profile", payload: {
      storeName: "双流小馆", industryCode: "fast_food", categoryCode: "rice_noodle", categoryCustomName: null,
      provinceCode: "sc", cityCode: "cd", districtCode: "sl", detailedAddress: "航空港街道 1 号",
      businessDistrictType: "community", businessDistrictNote: null, operatingMode: "dine_in_takeaway"
    } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ storeId: "store_demo", storeName: "双流小馆", completeness: { required: true } });
  });

  it("rejects a profile missing required address or industry fields", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/stores/store_demo/content-profile", payload: { storeName: "缺字段" } });
    expect(response.statusCode).toBe(422);
  });

  it("stores one primary goal and optional secondary goal per effective date", async () => {
    const first = await app.inject({ method: "POST", url: "/v1/stores/store_demo/operating-stages", payload: {
      effectiveDate: "2026-08-14", primaryGoal: "acquire_customers", secondaryGoal: "promote_product", note: "开业期"
    } });
    expect(first.statusCode).toBe(201);
    const duplicate = await app.inject({ method: "POST", url: "/v1/stores/store_demo/operating-stages", payload: {
      effectiveDate: "2026-08-14", primaryGoal: "raise_ticket"
    } });
    expect(duplicate.statusCode).toBe(409);
    const list = await app.inject({ method: "GET", url: "/v1/stores/store_demo/operating-stages" });
    expect(list.json()).toHaveLength(1);
  });

  it("keeps previous profile versions and stages immutable", async () => {
    const payload = { storeName: "版本店", industryCode: "full_service", categoryCode: "sichuan", provinceCode: "sc", cityCode: "cd", districtCode: "sl", detailedAddress: "旧地址", businessDistrictType: "mixed", operatingMode: "dine_in" };
    await app.inject({ method: "POST", url: "/v1/stores/store_demo/content-profile", payload });
    const updated = await app.inject({ method: "PUT", url: "/v1/stores/store_demo/content-profile", payload: { ...payload, detailedAddress: "新地址" } });
    expect(updated.statusCode).toBe(200);
    const versions = await pool.query("SELECT detailed_address FROM store_content_profile_versions ORDER BY version");
    expect(versions.rows.map((row) => row.detailed_address)).toEqual(["旧地址", "新地址"]);
  });
});
