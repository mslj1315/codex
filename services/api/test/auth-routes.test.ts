import { readdir, readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import { hashPassword } from "../src/auth/credentials.js";
import { buildServer } from "../src/server.js";

describe("authentication routes", () => {
  let database: Database;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    const memory = newDb();
    memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
    const { Pool } = memory.adapters.createPg();
    database = new Pool();
    await applyTestMigrations(database);
    await database.query(
      "INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ($1, $2, $3, $4)",
      ["account_owner", "owner", "Owner", await hashPassword("passphrase", () => Buffer.alloc(16, 3))]
    );
    await database.query("INSERT INTO store_memberships (account_id, enterprise_id, store_id, role) VALUES ('account_owner', 'ent_demo', 'store_demo', 'owner')");
    await database.query("INSERT INTO store_memberships (account_id, enterprise_id, store_id, role, enabled) VALUES ('account_owner', 'ent_demo', 'store_disabled', 'operator', false)");
    app = buildServer({
      database,
      authTokenSecret: "a sufficiently long test signing secret",
      objectStorage: { async putObject() {}, async deleteObject() { return "missing" as const; } }
    });
  });

  it("uses one neutral 401 for bad credentials and missing or malformed authentication", async () => {
    const badCredentials = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName: "owner", password: "wrong" } });
    const missingToken = await app.inject({ method: "GET", url: "/v1/auth/me/stores" });
    const malformedToken = await app.inject({ method: "GET", url: "/v1/auth/me/stores", headers: { authorization: "Bearer forged" } });

    for (const response of [badCredentials, missingToken, malformedToken]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "Authentication required" });
      expect(response.body).not.toContain("owner");
    }
  });

  it("lists only enabled member stores and revokes the current session on logout", async () => {
    const login = await loginOwner(app);
    const accessToken = login.json<{ accessToken: string }>().accessToken;
    const stores = await app.inject({ method: "GET", url: "/v1/auth/me/stores", headers: bearer(accessToken) });

    expect(stores.statusCode).toBe(200);
    expect(stores.json()).toEqual({ stores: [{ enterpriseId: "ent_demo", storeId: "store_demo", role: "owner" }] });
    expect((await app.inject({ method: "POST", url: "/v1/auth/logout", headers: bearer(accessToken) })).statusCode).toBe(204);
    const afterLogout = await app.inject({ method: "GET", url: "/v1/auth/me/stores", headers: bearer(accessToken) });
    expect(afterLogout.statusCode).toBe(401);
  });

  it("accepts only policy-compliant password changes and keeps rejected changes neutral", async () => {
    const accessToken = (await loginOwner(app)).json<{ accessToken: string }>().accessToken;

    for (const newPassword of ["Abcdefg", "abcdefgh", "ABCDEFGH"]) {
      const rejected = await app.inject({ method: "POST", url: "/v1/auth/change-password", headers: bearer(accessToken), payload: { currentPassword: "passphrase", newPassword } });
      expect(rejected.statusCode).toBe(401);
      expect(rejected.json()).toEqual({ error: "Authentication required" });
    }

    const changed = await app.inject({ method: "POST", url: "/v1/auth/change-password", headers: bearer(accessToken), payload: { currentPassword: "passphrase", newPassword: "Abcdefgh" } });
    expect(changed.statusCode).toBe(204);
    expect((await app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName: "owner", password: "Abcdefgh" } })).statusCode).toBe(200);
  });

  it("derives existing store route context from the bearer membership", async () => {
    const accessToken = (await loginOwner(app)).json<{ accessToken: string }>().accessToken;
    const allowed = await app.inject({ method: "GET", url: "/v1/stores/store_demo/readiness?rangeStart=2026-08-01&rangeEnd=2026-08-07", headers: bearer(accessToken) });
    const denied = await app.inject({ method: "GET", url: "/v1/stores/store_other/readiness?rangeStart=2026-08-01&rangeEnd=2026-08-07", headers: bearer(accessToken) });
    const invalid = await app.inject({ method: "GET", url: "/v1/stores/store_demo/readiness?rangeStart=2026-08-01&rangeEnd=2026-08-07", headers: bearer("forged.token.value") });

    expect(allowed.statusCode).toBe(200);
    expect(denied.statusCode).toBe(403);
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json()).toEqual({ error: "Authentication required" });
  });

  it("never turns a provider-feedback account with a store membership into a customer data principal", async () => {
    await database.query(
      "INSERT INTO service_operator_roles (account_id, role) VALUES ('account_owner', 'provider_feedback_viewer')"
    );
    const accessToken = (await loginOwner(app)).json<{ accessToken: string }>().accessToken;
    const profile = {
      storeName: "Provider must not read this", industryCode: "fast_food", categoryCode: "rice_noodle",
      provinceCode: "sc", cityCode: "cd", districtCode: "sl", detailedAddress: "private address",
      businessDistrictType: "community", operatingMode: "dine_in"
    };

    const profileRead = await app.inject({ method: "GET", url: "/v1/stores/store_demo/content-profile", headers: bearer(accessToken) });
    const profileWrite = await app.inject({ method: "POST", url: "/v1/stores/store_demo/content-profile", headers: bearer(accessToken), payload: profile });
    const importWrite = await app.inject({
      method: "POST", url: "/v1/stores/store_demo/imports/manual", headers: bearer(accessToken),
      payload: { rangeStart: "2026-08-01", rangeEnd: "2026-08-07", candidates: [{ metricKey: "orders", metricDisplayName: "Orders", value: 12, unit: "count", status: "ready" }] }
    });

    for (const response of [profileRead, profileWrite, importWrite]) expect(response.statusCode).toBe(403);
    await expect(database.query("SELECT id FROM store_content_profile_versions")).resolves.toMatchObject({ rows: [] });
    await expect(database.query("SELECT id FROM import_batches")).resolves.toMatchObject({ rows: [] });
  });

  it("rejects production startup without an auth token secret", () => {
    expect(() => buildServer({ database })).toThrow("AUTH_TOKEN_SECRET is required");
  });
});

function loginOwner(app: ReturnType<typeof buildServer>) {
  return app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName: "owner", password: "passphrase" } });
}

function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }

async function applyTestMigrations(database: Database): Promise<void> {
  const migrationsUrl = new URL("../migrations/", import.meta.url);
  const files = (await readdir(migrationsUrl)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationsUrl), "utf8");
    await database.query(sql.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
  }
}
