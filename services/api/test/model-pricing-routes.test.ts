import { readdir, readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import { hashPassword } from "../src/auth/credentials.js";
import { buildServer } from "../src/server.js";

describe("model pricing provider routes", () => {
  let database: Database;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    const memory = newDb();
    memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
    const { Pool } = memory.adapters.createPg(); database = new Pool();
    await applyMigrations(database);
    const hash = await hashPassword("passphrase", () => Buffer.alloc(16, 4));
    await database.query("INSERT INTO accounts (id,login_name,display_name,password_hash) VALUES ('price','price','Price', $1), ('viewer','viewer','Viewer',$1)", [hash]);
    await database.query("INSERT INTO service_operator_roles (account_id,role) VALUES ('price','model_pricing_operator'),('viewer','provider_feedback_viewer')");
    app = buildServer({ database, authTokenSecret: "a sufficiently long test signing secret", now: () => new Date("2026-08-15T00:00:00Z") }); activeApp = app;
  });

  it("lets only the dedicated price role create a draft and exposes a safe global aggregate", async () => {
    const price = await login("price"); const viewer = await login("viewer");
    const denied = await app.inject({ method: "POST", url: "/v1/provider-model-pricing/versions", headers: bearer(viewer), payload: { provider: "openai_responses", model: "gpt", inputCnyPerMillionTokens: 8, outputCnyPerMillionTokens: 32, effectiveFrom: "2026-08-16T00:00:00Z" } });
    expect(denied.statusCode).toBe(403);
    const created = await app.inject({ method: "POST", url: "/v1/provider-model-pricing/versions", headers: providerHeaders(price), payload: { provider: "openai_responses", model: "gpt", inputCnyPerMillionTokens: 8, outputCnyPerMillionTokens: 32, effectiveFrom: "2026-08-16T00:00:00Z" } });
    expect(created.statusCode).toBe(201); expect(created.json()).toMatchObject({ status: "draft", currency: "CNY", provider: "openai_responses", model: "gpt" });
    const aggregate = await app.inject({ method: "GET", url: "/v1/provider-model-pricing/usage?from=2026-08-01&to=2026-08-31", headers: bearer(price) });
    expect(aggregate.statusCode).toBe(200); expect(aggregate.json()).toEqual({ items: [] });
    expect(aggregate.body).not.toMatch(/enterprise|store|actor|task|prompt|content|media|object/i);
  });

  it("requires the provider marker and dedicated role before reading price versions", async () => {
    const price = await login("price"); const viewer = await login("viewer");
    expect((await app.inject({ method: "GET", url: "/v1/provider-model-pricing/versions" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/provider-model-pricing/versions", headers: bearer(price) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/provider-model-pricing/versions", headers: providerHeaders(viewer) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/provider-model-pricing/versions", headers: providerHeaders(price) })).statusCode).toBe(200);
  });
});
let activeApp: ReturnType<typeof buildServer>;
async function login(loginName: string) { const r = await activeApp.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName, password: "passphrase" } }); return r.json<{accessToken:string}>().accessToken; }
function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }
function providerHeaders(accessToken: string) { return { ...bearer(accessToken), "x-provider-console-request": "1" }; }
async function applyMigrations(database: Database) { const url = new URL("../migrations/", import.meta.url); for (const file of (await readdir(url)).filter((f) => /^\d+.*\.sql$/.test(f)).sort()) { let sql = await readFile(new URL(file, url), "utf8"); if (file === "028_model_token_pricing.sql") sql = sql.slice(0, sql.indexOf("CREATE OR REPLACE FUNCTION")); await database.query(sql.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, "")); } }
