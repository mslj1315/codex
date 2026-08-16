import { readdir, readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import { hashPassword } from "../src/auth/credentials.js";
import { buildServer } from "../src/server.js";

describe("customer account administration", () => {
  let database: Database;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    const memory = newDb();
    memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
    const { Pool } = memory.adapters.createPg();
    database = new Pool();
    await applyMigrations(database);
    await database.query("INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ('super', 'super', 'Super', $1)", [await hashPassword("passphrase")]);
    await database.query("INSERT INTO internal_account_roles (account_id, role_id) VALUES ('super', 'internal-role-super-admin')");
    app = buildServer({ database, authTokenSecret: "a sufficiently long test signing secret" });
  });

  it("creates a customer with a normalized mobile and returns the temporary password once", async () => {
    const response = await app.inject({
      method: "POST", url: "/v1/admin/customer-accounts", headers: await superBearer(app),
      payload: { mobile: " +86 138-0013-8000 ", displayName: "测试门店", enterpriseId: "ent_demo", storeId: "store_demo", storeRole: "owner" }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ account: { id: string; loginName: string; passwordChangeRequired: boolean }; temporaryPassword: string }>();
    expect(body.account).toMatchObject({ loginName: "13800138000", passwordChangeRequired: true });
    expect(body.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(await database.query("SELECT password_hash, password_change_required FROM accounts WHERE id = $1", [body.account.id]))
      .toMatchObject({ rows: [{ password_hash: expect.stringMatching(/^\$2[aby]\$/), password_change_required: true }] });
    expect(response.body).not.toContain("password_hash");
    expect((await database.query("SELECT metadata_json FROM internal_audit_events")).rows[0]?.metadata_json).not.toContain(body.temporaryPassword);
  });

  it("requires the first customer password change and invalidates all sessions on reset", async () => {
    const created = await app.inject({
      method: "POST", url: "/v1/admin/customer-accounts", headers: await superBearer(app),
      payload: { mobile: "13900139000", displayName: "测试门店", enterpriseId: "ent_demo", storeId: "store_demo", storeRole: "owner" }
    });
    const account = created.json<{ account: { id: string }; temporaryPassword: string }>();
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName: "13900139000", password: account.temporaryPassword } });
    const accessToken = login.json<{ accessToken: string; passwordChangeRequired: boolean }>();

    expect(accessToken.passwordChangeRequired).toBe(true);
    expect((await app.inject({ method: "GET", url: "/v1/auth/me/stores", headers: bearer(accessToken.accessToken) })).statusCode).toBe(403);
    const changed = await app.inject({ method: "POST", url: "/v1/auth/change-password", headers: bearer(accessToken.accessToken), payload: { currentPassword: account.temporaryPassword, newPassword: "a-new-safe-password" } });
    expect(changed.statusCode).toBe(204);

    const usable = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName: "13900139000", password: "a-new-safe-password" } });
    const currentToken = usable.json<{ accessToken: string }>().accessToken;
    const reset = await app.inject({ method: "POST", url: `/v1/admin/customer-accounts/${account.account.id}/reset-password`, headers: await superBearer(app) });
    expect(reset.statusCode).toBe(200);
    expect(reset.json<{ temporaryPassword: string }>().temporaryPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect((await app.inject({ method: "GET", url: "/v1/auth/me/stores", headers: bearer(currentToken) })).statusCode).toBe(401);
  });

  it("disables a customer through the internal permission route and revokes its active session", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/admin/customer-accounts", headers: await superBearer(app), payload: { mobile: "13600136001", displayName: "停用测试", enterpriseId: "ent_demo", storeId: "store_demo", storeRole: "owner" } });
    const body = created.json<{ account: { id: string }; temporaryPassword: string }>();
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName: "13600136001", password: body.temporaryPassword } });
    const disabled = await app.inject({ method: "POST", url: `/v1/admin/customer-accounts/${body.account.id}/disable`, headers: await superBearer(app) });

    expect(disabled.statusCode).toBe(200);
    expect(disabled.json<{ account: { enabled: boolean } }>().account.enabled).toBe(false);
    expect((await app.inject({ method: "GET", url: "/v1/auth/me/stores", headers: bearer(login.json<{ accessToken: string }>().accessToken) })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName: "13600136001", password: body.temporaryPassword } })).statusCode).toBe(401);
    expect(JSON.stringify((await database.query("SELECT metadata_json FROM internal_audit_events WHERE action_code = 'customer_account.disabled'")).rows)).not.toMatch(/password|secret|token/i);
  });

  it("resets a customer with more than one enabled store membership", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/admin/customer-accounts", headers: await superBearer(app), payload: { mobile: "13600136000", displayName: "多门店", enterpriseId: "ent_demo", storeId: "store_first", storeRole: "owner" } });
    const account = created.json<{ account: { id: string } }>().account;
    await database.query("INSERT INTO store_memberships (account_id, enterprise_id, store_id, role) VALUES ($1, 'ent_demo', 'store_second', 'operator')", [account.id]);

    const reset = await app.inject({ method: "POST", url: `/v1/admin/customer-accounts/${account.id}/reset-password`, headers: await superBearer(app) });

    expect(reset.statusCode).toBe(200);
    expect(reset.json<{ account: { id: string } }>().account.id).toBe(account.id);
  });

  it("returns 409 when a normalized mobile already exists", async () => {
    const headers = await superBearer(app);
    const payload = { mobile: "13500135000", displayName: "重复", enterpriseId: "ent_demo", storeId: "store_demo", storeRole: "owner" };
    expect((await app.inject({ method: "POST", url: "/v1/admin/customer-accounts", headers, payload })).statusCode).toBe(201);

    expect((await app.inject({ method: "POST", url: "/v1/admin/customer-accounts", headers, payload: { ...payload, mobile: "+86 135-0013-5000" } })).statusCode).toBe(409);
  });

  it("rejects a password change that exceeds bcrypt's 72 UTF-8 byte limit", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/admin/customer-accounts", headers: await superBearer(app), payload: { mobile: "13700137000", displayName: "长度", enterpriseId: "ent_demo", storeId: "store_demo", storeRole: "owner" } });
    const body = created.json<{ temporaryPassword: string }>();
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName: "13700137000", password: body.temporaryPassword } });

    const response = await app.inject({ method: "POST", url: "/v1/auth/change-password", headers: bearer(login.json<{ accessToken: string }>().accessToken), payload: { currentPassword: body.temporaryPassword, newPassword: "密".repeat(25) } });

    expect(response.statusCode).toBe(401);
  });

  it("rejects customers from admin routes before customer account data is queried", async () => {
    await database.query("INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ('customer', '13800138001', 'Customer', $1)", [await hashPassword("passphrase")]);
    await database.query("INSERT INTO store_memberships (account_id, enterprise_id, store_id, role) VALUES ('customer', 'ent_demo', 'store_demo', 'owner')");
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName: "13800138001", password: "passphrase" } });
    const response = await app.inject({ method: "POST", url: "/v1/admin/customer-accounts", headers: bearer(login.json<{ accessToken: string }>().accessToken), payload: { mobile: "13700137000", displayName: "No", enterpriseId: "ent_demo", storeId: "store_no", storeRole: "owner" } });

    expect(response.statusCode).toBe(403);
    expect(await database.query("SELECT login_name FROM accounts WHERE login_name = '13700137000'"))
      .toMatchObject({ rowCount: 0 });
  });
});

async function superBearer(app: ReturnType<typeof buildServer>) {
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName: "super", password: "passphrase" } });
  return bearer(login.json<{ accessToken: string }>().accessToken);
}

function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }

async function applyMigrations(database: Database) {
  const url = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(url)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()) {
    const sql = await readFile(new URL(file, url), "utf8");
    await database.query(sql.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
  }
}
