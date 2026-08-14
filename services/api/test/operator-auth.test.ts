import { readFile } from "node:fs/promises";
import { hash } from "bcryptjs";
import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { Database } from "../src/db.js";

describe("operator authentication", () => {
  let pool: Database;

  beforeEach(async () => {
    const memory = newDb({ noAstCoverageCheck: true });
    const { Pool } = memory.adapters.createPg();
    pool = new Pool();
    const migration = await readFile(new URL("../migrations/015_operator_accounts_sessions.sql", import.meta.url), "utf8");
    await pool.query(migration.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
    await pool.query(
      "INSERT INTO operator_accounts (account_id, password_hash, role) VALUES ($1, $2, 'operator_admin')",
      ["op-1", await hash("correct horse", 4)]
    );
  });

  it("returns neutral failures for incorrect and disabled operator accounts", async () => {
    const app = buildServer({ database: pool });
    const wrongPassword = await app.inject({ method: "POST", url: "/v1/operator-auth/login", payload: { accountId: "op-1", password: "wrong" } });
    expect(wrongPassword.statusCode).toBe(403);
    expect(wrongPassword.json()).toEqual({ error: "Forbidden" });

    await pool.query("UPDATE operator_accounts SET enabled = false, disabled_at = now() WHERE account_id = 'op-1'");
    const disabled = await app.inject({ method: "POST", url: "/v1/operator-auth/login", payload: { accountId: "op-1", password: "correct horse" } });
    expect(disabled.statusCode).toBe(403);
    expect(disabled.json()).toEqual({ error: "Forbidden" });
  });

  it("revokes a session on logout and requires CSRF plus same-origin for operator writes", async () => {
    const app = buildServer({ database: pool });
    const login = await app.inject({ method: "POST", url: "/v1/operator-auth/login", payload: { accountId: "op-1", password: "correct horse" } });
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
      payload: { accountId: "op-1", password: "correct horse" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Strict");
    expect(response.json()).toMatchObject({
      csrfToken: expect.any(String),
      capabilities: { operatorAdmin: true }
    });
  });
});
