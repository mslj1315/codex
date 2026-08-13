import { readdir, readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import { hashPassword } from "../src/auth/credentials.js";
import { issueAccessToken } from "../src/auth/tokens.js";
import { buildServer } from "../src/server.js";

const marker = { "x-provider-console-request": "1" };

describe("provider browser authentication routes", () => {
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
      ["account_viewer", "viewer", "Viewer", await hashPassword("passphrase", () => Buffer.alloc(16, 7))]
    );
    await database.query("INSERT INTO service_operator_roles (account_id, role) VALUES ('account_viewer', 'provider_feedback_viewer')");
    await database.query("INSERT INTO service_operator_roles (account_id, role) VALUES ('account_viewer', 'provider_customer_metadata_editor')");
    app = buildServer({ database, authTokenSecret: "a sufficiently long test signing secret" });
  });

  it("sets a strict production refresh cookie and returns only browser session fields", async () => {
    const response = await providerLogin(app);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accessToken: expect.any(String), expiresAt: expect.any(String),
      account: { id: "account_viewer", displayName: "Viewer" },
      capabilities: { providerFeedbackViewer: true, metricCatalogOperator: false, providerCustomerMetadataEditor: true }
    });
    expect(response.body).not.toContain("refreshToken");
    expect(cookie(response)).toMatch(/^provider_refresh=[A-Za-z0-9_-]+; HttpOnly; Secure; SameSite=Strict; Path=\/v1\/provider-auth\/; Max-Age=2592000$/);
  });

  it("allows a non-secure local cookie only with explicit provider browser development mode", async () => {
    const developmentApp = buildServer({
      database, authTokenSecret: "a sufficiently long test signing secret", providerBrowserDevelopmentMode: true
    });
    const response = await providerLogin(developmentApp);
    expect(cookie(response)).not.toContain("Secure");
    expect(cookie(response)).toContain("HttpOnly; SameSite=Strict; Path=/v1/provider-auth/; Max-Age=2592000");
  });

  it("rotates the cookie on refresh and clears it on missing, duplicate, or invalid cookies", async () => {
    const login = await providerLogin(app);
    const firstCookie = cookieValue(login);
    const refreshed = await app.inject({ method: "POST", url: "/v1/provider-auth/refresh", headers: { ...marker, cookie: firstCookie } });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json()).not.toHaveProperty("refreshToken");
    expect(cookieValue(refreshed)).not.toBe(firstCookie);

    for (const value of [undefined, "provider_refresh=one; provider_refresh=two", "provider_refresh=forged"]) {
      const response = await app.inject({ method: "POST", url: "/v1/provider-auth/refresh", headers: { ...marker, ...(value ? { cookie: value } : {}) } });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "Authentication required" });
      expect(cookie(response)).toContain("provider_refresh=; HttpOnly; Secure; SameSite=Strict; Path=/v1/provider-auth/; Max-Age=0");
    }
  });

  it("always clears the cookie on logout, revokes a valid bearer, and uses neutral failures", async () => {
    const login = await providerLogin(app);
    const accessToken = login.json<{ accessToken: string }>().accessToken;
    const refreshCookie = cookieValue(login);
    const valid = await app.inject({ method: "POST", url: "/v1/provider-auth/logout", headers: { ...marker, authorization: `Bearer ${accessToken}`, cookie: refreshCookie } });
    expect(valid.statusCode).toBe(204);
    expect(cookie(valid)).toContain("Max-Age=0");

    const missing = await app.inject({ method: "POST", url: "/v1/provider-auth/logout", headers: marker });
    const invalid = await app.inject({ method: "POST", url: "/v1/provider-auth/logout", headers: { ...marker, authorization: "Bearer forged" } });
    for (const response of [missing, invalid]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "Authentication required" });
      expect(cookie(response)).toContain("Max-Age=0");
    }
  });

  it("rejects absent or invalid console markers with a neutral 403", async () => {
    for (const request of [
      { method: "POST" as const, url: "/v1/provider-auth/login", payload: { loginName: "viewer", password: "passphrase" } },
      { method: "POST" as const, url: "/v1/provider-auth/refresh", headers: { cookie: "provider_refresh=forged" } },
      { method: "POST" as const, url: "/v1/provider-auth/logout", headers: { "x-provider-console-request": "0" } }
    ]) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "Forbidden" });
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("redacts unexpected provider authentication failures while retaining cookie clearing", async () => {
    const unavailable = buildServer({
      database: {
        async query() { throw new Error("database unavailable secret-dsn-marker"); },
        async connect() { throw new Error("database unavailable secret-dsn-marker"); }
      } as never,
      authTokenSecret: "a sufficiently long test signing secret"
    });
    const accessToken = issueAccessToken(
      { accountId: "account_viewer", sessionId: "session_unavailable" },
      "a sufficiently long test signing secret",
      new Date()
    );
    const responses = [
      await unavailable.inject({ method: "POST", url: "/v1/provider-auth/login", headers: marker, payload: { loginName: "viewer", password: "passphrase" } }),
      await unavailable.inject({ method: "POST", url: "/v1/provider-auth/refresh", headers: { ...marker, cookie: "provider_refresh=token" } }),
      await unavailable.inject({ method: "POST", url: "/v1/provider-auth/logout", headers: { ...marker, authorization: `Bearer ${accessToken}` } })
    ];

    for (const response of responses) {
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "Provider authentication is unavailable" });
      expect(response.body).not.toContain("secret-dsn-marker");
    }
    expect(responseCookie(responses[0]!)).toBeUndefined();
    expect(cookie(responses[1]!)).toContain("Max-Age=0");
    expect(cookie(responses[2]!)).toContain("Max-Age=0");
  });
});

function providerLogin(app: ReturnType<typeof buildServer>) {
  return app.inject({ method: "POST", url: "/v1/provider-auth/login", headers: marker, payload: { loginName: "viewer", password: "passphrase" } });
}

function cookie(response: { headers: Record<string, unknown> }): string {
  const value = responseCookie(response);
  return Array.isArray(value) ? String(value[0]) : String(value);
}

function responseCookie(response: { headers: Record<string, unknown> }): unknown { return response.headers["set-cookie"]; }

function cookieValue(response: { headers: Record<string, unknown> }): string {
  return cookie(response).split(";", 1)[0]!;
}

async function applyTestMigrations(database: Database): Promise<void> {
  const migrationsUrl = new URL("../migrations/", import.meta.url);
  const files = (await readdir(migrationsUrl)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationsUrl), "utf8");
    await database.query(sql.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
  }
}
