import { readdir, readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import { hashPassword } from "../src/auth/credentials.js";
import { buildServer } from "../src/server.js";

describe("provider feedback routes", () => {
  let database: Database;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    const memory = newDb();
    memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
    const { Pool } = memory.adapters.createPg();
    database = new Pool();
    await applyTestMigrations(database);
    const hash = await hashPassword("passphrase", () => Buffer.alloc(16, 5));
    for (const [id, login, name] of [["account_viewer", "viewer", "Viewer"], ["account_catalog", "catalog", "Catalog"], ["account_member", "member", "Member"]]) {
      await database.query("INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ($1, $2, $3, $4)", [id, login, name, hash]);
    }
    await database.query("INSERT INTO service_operator_roles (account_id, role) VALUES ('account_viewer', 'provider_feedback_viewer')");
    await database.query("INSERT INTO service_operator_roles (account_id, role) VALUES ('account_catalog', 'metric_catalog_operator')");
    await database.query("INSERT INTO store_memberships (account_id, enterprise_id, store_id, role) VALUES ('account_viewer', 'ent_member', 'store_member', 'operator')");
    await database.query("INSERT INTO import_batches (id, enterprise_id, store_id, actor_id, source_type, original_file_name, original_file_checksum, status, created_at) VALUES ('batch_feedback', 'ent_feedback', 'store_feedback', 'actor_sentinel', 'csv', 'sentinel-file.csv', 'sentinel-checksum', 'pending_confirmation', '2026-08-12T00:00:00.000Z')");
    app = buildServer({ database, authTokenSecret: "a sufficiently long test signing secret", now: () => new Date("2026-08-13T00:00:00.000Z"), objectStorage: { async putObject() {}, async deleteObject() { return "missing" as const; } } });
  });

  it("requires provider feedback role and returns an aggregate-only response", async () => {
    const viewer = await login("viewer"); const catalog = await login("catalog");
    const missing = await app.inject({ method: "GET", url: "/v1/provider-feedback/stores" });
    const denied = await app.inject({ method: "GET", url: "/v1/provider-feedback/stores", headers: bearer(catalog) });
    const allowed = await app.inject({ method: "GET", url: "/v1/provider-feedback/stores?limit=1&activityState=active", headers: bearer(viewer) });

    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toEqual({ error: "Authentication required" });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: "Provider feedback access is required" });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ items: [expect.objectContaining({ enterpriseId: "ent_feedback", storeId: "store_feedback", activityState: "active" })], nextCursor: null });
    expect(allowed.body).not.toMatch(/sentinel-file|sentinel-checksum|actor_sentinel|accessToken/i);
  });

  it("does not grant a feedback viewer store route access without membership", async () => {
    const viewer = await login("viewer");
    const response = await app.inject({ method: "GET", url: "/v1/stores/store_feedback/readiness?rangeStart=2026-08-01&rangeEnd=2026-08-07", headers: bearer(viewer) });
    expect(response.statusCode).toBe(403);
  });

  async function login(loginName: string): Promise<string> {
    const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName, password: "passphrase" } });
    return response.json<{ accessToken: string }>().accessToken;
  }
});

function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }
async function applyTestMigrations(database: Database): Promise<void> {
  const migrationsUrl = new URL("../migrations/", import.meta.url);
  const files = (await readdir(migrationsUrl)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationsUrl), "utf8");
    await database.query(sql.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
  }
}
