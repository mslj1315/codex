import { readFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { Database } from "../src/db.js";
import { OperatorAuthRepository, operatorCookieSecure, sessionCookie } from "../src/operator-auth/repository.js";
import type { TrustedContext } from "../src/imports/service.js";

describe("operator authentication", () => {
  let pool: Database;

  beforeEach(async () => {
    const memory = newDb({ noAstCoverageCheck: true });
    const { Pool } = memory.adapters.createPg();
    pool = new Pool();
    const contentMigration = await readFile(new URL("../migrations/014_content_templates_rules.sql", import.meta.url), "utf8");
    await pool.query(contentMigration.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
    const migration = await readFile(new URL("../migrations/015_operator_accounts_sessions.sql", import.meta.url), "utf8");
    await pool.query(migration.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
    const versionsMigration = await readFile(new URL("../migrations/016_operator_content_versions.sql", import.meta.url), "utf8");
    await pool.query(versionsMigration.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
    await pool.query(
      "INSERT INTO operator_accounts (account_id, password_hash, role) VALUES ($1, $2, 'operator_admin')",
      ["op-1", await bcrypt.hash("correct horse", 4)]
    );
  });

  it("returns neutral failures for incorrect operator credentials", async () => {
    const app = buildServer({ database: pool });
    const wrongPassword = await app.inject({ method: "POST", url: "/v1/operator-auth/login", headers: { host: "localhost", origin: "http://localhost" }, payload: { accountId: "op-1", password: "wrong" } });
    expect(wrongPassword.statusCode).toBe(403);
    expect(wrongPassword.json()).toEqual({ error: "Forbidden" });

  });

  it("runs a password comparison even when an account cannot authenticate", async () => {
    const comparisons: string[] = [];
    const repository = new OperatorAuthRepository(pool, undefined, async (_password, passwordHash) => { comparisons.push(passwordHash); return false; });
    expect(await repository.verifyPassword("missing", "password")).toBe(false);
    expect(comparisons).toHaveLength(1);
  });

  it("disables an account atomically, revokes its session, and audits the action", async () => {
    const repository = new OperatorAuthRepository(pool);
    const created = await repository.createSession("op-1");
    expect(await repository.disableAccount("op-1")).toBe(true);
    expect(await repository.authenticateSession(created.cookieValue)).toBeUndefined();
    expect((await pool.query("SELECT event_type FROM operator_auth_audit_events WHERE account_id='op-1' ORDER BY occurred_at DESC")).rows).toContainEqual({ event_type: "account_disabled" });
  });

  it("returns a neutral HTTP failure for a disabled account", async () => {
    await new OperatorAuthRepository(pool).disableAccount("op-1");
    const app = buildServer({ database: pool });
    const response = await app.inject({ method: "POST", url: "/v1/operator-auth/login", headers: { host: "localhost", origin: "http://localhost" }, payload: { accountId: "op-1", password: "correct horse" } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "Forbidden" });
  });

  it("rejects expired sessions and malformed login bodies", async () => {
    const repository = new OperatorAuthRepository(pool);
    const session = await repository.createSession("op-1");
    await pool.query("UPDATE operator_sessions SET expires_at='2000-01-01T00:00:00.000Z'");
    const app = buildServer({ database: pool });
    expect((await app.inject({ method: "GET", url: "/v1/operator-auth/session", headers: { cookie: `operator_session=${session.cookieValue}` } })).statusCode).toBe(403);
    const malformed = await app.inject({ method: "POST", url: "/v1/operator-auth/login", headers: { host: "localhost", origin: "http://localhost" }, payload: [] });
    expect(malformed.statusCode).toBe(403);
    expect(malformed.json()).toEqual({ error: "Forbidden" });
  });

  it("revokes a session on logout and requires CSRF plus same-origin for operator writes", async () => {
    const app = buildServer({ database: pool });
    const login = await app.inject({ method: "POST", url: "/v1/operator-auth/login", headers: { host: "localhost", origin: "http://localhost" }, payload: { accountId: "op-1", password: "correct horse" } });
    const cookie = login.headers["set-cookie"]!;

    const missingCsrf = await app.inject({ method: "POST", url: "/v1/operator-content/templates", headers: { cookie, host: "localhost", origin: "http://localhost" }, payload: {} });
    expect(missingCsrf.statusCode).toBe(403);
    expect(missingCsrf.json()).toEqual({ error: "Forbidden" });

    const logout = await app.inject({ method: "POST", url: "/v1/operator-auth/logout", headers: { cookie, host: "localhost", origin: "http://localhost", "x-csrf-token": login.json().csrfToken } });
    expect(logout.statusCode).toBe(204);
    const session = await app.inject({ method: "GET", url: "/v1/operator-auth/session", headers: { cookie } });
    expect(session.statusCode).toBe(403);
    expect(session.json()).toEqual({ error: "Forbidden" });
  });

  it("returns an HttpOnly session and admin capability for a valid operator login", async () => {
    const app = buildServer({ database: pool });

    const response = await app.inject({
      method: "POST",
      url: "/v1/operator-auth/login",
      headers: { host: "localhost", origin: "http://localhost" }, payload: { accountId: "op-1", password: "correct horse" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Strict");
    expect(response.json()).toMatchObject({
      csrfToken: expect.any(String),
      capabilities: { operatorAdmin: true }
    });
  });

  it("rejects a cross-origin login attempt", async () => {
    const app = buildServer({ database: pool });
    const response = await app.inject({ method: "POST", url: "/v1/operator-auth/login", headers: { host: "localhost", origin: "https://localhost" }, payload: { accountId: "op-1", password: "correct horse" } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "Forbidden" });
  });

  it("never accepts a legacy trusted role without a session and accepts a valid admin session at the protected write gate", async () => {
    const legacyEditor: TrustedContext = { enterpriseId: "platform", storeId: "operator", actorId: "legacy-editor", actorRole: "operator_editor" };
    const app = buildServer({ database: pool, trustedContextResolver: async () => legacyEditor });
    const payload = { name: "template", content: { hook: "hook", story: "story", value: "value", productAppearance: "product", cta: "cta", shotRhythm: "rhythm", captionVoiceRequirements: "voice", prohibitedExpressions: ["best"] }, constraints: { industryCode: "fast_food", categoryCode: "noodle", persona: "owner", contentType: "story", commercialLevel: 1, style: "natural", priceDiscountEffectRestrictions: ["no_absolute"], riskLevel: "low" }, fallbackScope: { allowCategoryFallback: true, allowIndustryFallback: false } };
    const legacy = await app.inject({ method: "POST", url: "/v1/operator-content/templates", payload });
    expect(legacy.statusCode).toBe(403);
    expect(legacy.json()).toEqual({ error: "Forbidden" });

    const login = await app.inject({ method: "POST", url: "/v1/operator-auth/login", headers: { host: "localhost", origin: "http://localhost" }, payload: { accountId: "op-1", password: "correct horse" } });
    const allowed = await app.inject({ method: "POST", url: "/v1/operator-content/templates", headers: { cookie: login.headers["set-cookie"]!, host: "localhost", origin: "http://localhost", "x-csrf-token": login.json().csrfToken }, payload });
    expect(allowed.statusCode).toBe(201);
    const invalidCsrf = await app.inject({ method: "POST", url: "/v1/operator-content/templates", headers: { cookie: login.headers["set-cookie"]!, host: "localhost", origin: "http://localhost", "x-csrf-token": "wrong" }, payload });
    expect(invalidCsrf.statusCode).toBe(403);
  });

  it("uses Secure cookies in production or when explicitly configured", () => {
    expect(operatorCookieSecure({ NODE_ENV: "production" })).toBe(true);
    expect(operatorCookieSecure({ NODE_ENV: "development" })).toBe(false);
    expect(operatorCookieSecure({ NODE_ENV: "development", OPERATOR_COOKIE_SECURE: "true" })).toBe(true);
    expect(sessionCookie("opaque", new Date("2026-01-01T00:00:00.000Z"), true)).toContain("Secure");
  });

  it("rejects a same-host Origin when its scheme differs from the direct request", async () => {
    const app = buildServer({ database: pool, trustedContextResolver: async () => ({ enterpriseId: "platform", storeId: "operator", actorId: "legacy-editor", actorRole: "operator_editor" }) });
    const login = await app.inject({ method: "POST", url: "/v1/operator-auth/login", headers: { host: "localhost", origin: "http://localhost" }, payload: { accountId: "op-1", password: "correct horse" } });
    const response = await app.inject({
      method: "POST",
      url: "/v1/operator-content/templates",
      headers: { cookie: login.headers["set-cookie"]!, host: "localhost", origin: "https://localhost", "x-csrf-token": login.json().csrfToken },
      payload: { name: "template", content: { hook: "hook", story: "story", value: "value", productAppearance: "product", cta: "cta", shotRhythm: "rhythm", captionVoiceRequirements: "voice" }, constraints: {}, fallbackScope: {} }
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "Forbidden" });
  });
});
