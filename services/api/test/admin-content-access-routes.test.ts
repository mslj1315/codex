import { describe, expect, test } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { hashPassword } from "../src/auth/credentials.js";
import { buildServer } from "../src/server.js";

describe("unified admin content and access routes", () => {
  test("denies content operations before querying their repositories and exposes no customer content routes", async () => {
    const { app, token } = await appWithAdmin();
    const response = await app.inject({ method: "GET", url: "/v1/admin/content/templates", headers: bearer(token) });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toMatch(/draft|inspiration|storyboard|object/i);
  });

  test("allows a super admin to create and publish a versioned template through bearer routes", async () => {
    const { app, token } = await appWithAdmin({ superAdmin: true });
    const created = await app.inject({ method: "POST", url: "/v1/admin/content/templates", headers: bearer(token), payload: { name: "到店模板", content: { hook: "开头", story: "过程", value: "价值", productAppearance: "产品", cta: "到店", shotRhythm: "快", captionVoiceRequirements: "字幕", prohibitedExpressions: ["最好"] }, constraints: { industryCode: "restaurant", categoryCode: "noodle", persona: "owner", contentType: "story", style: "warm", riskLevel: "low", commercialLevel: 1, priceDiscountEffectRestrictions: ["no-price"] }, fallbackScope: { allowCategoryFallback: true, allowIndustryFallback: false } } });
    expect(created.statusCode).toBe(201);
    const template = created.json<{ logicalId: string; version: number; status: string }>();
    const published = await app.inject({ method: "POST", url: `/v1/admin/content/templates/${template.logicalId}/versions/${template.version}/publish`, headers: bearer(token) });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({ status: "published" });
  });

  test("only permits safe internal role and assignment administration and rejects customer account bindings", async () => {
    const { app, token, database } = await appWithAdmin({ superAdmin: true });
    const roles = await app.inject({ method: "GET", url: "/v1/admin/access/roles", headers: bearer(token) });
    expect(roles.statusCode).toBe(200);
    const created = await app.inject({ method: "POST", url: "/v1/admin/access/roles", headers: bearer(token), payload: { code: "content_editor", displayName: "内容编辑", permissionCodes: ["content_templates.read", "content_templates.edit"] } });
    expect(created.statusCode).toBe(201);
    const role = created.json<{ id: string; code: string }>();
    await database.query("INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ('customer', '13800138000', 'Customer', 'x')");
    const denied = await app.inject({ method: "PUT", url: "/v1/admin/access/accounts/customer/roles", headers: bearer(token), payload: { roleIds: [role.id] } });
    expect(denied.statusCode).toBe(409);
    expect(denied.body).not.toContain("13800138000");
  });

  test("never allows the super administrator role to be changed or assigned through access endpoints", async () => {
    const { app, token } = await appWithAdmin({ superAdmin: true });
    const result = await app.inject({ method: "PUT", url: "/v1/admin/access/roles/internal-role-super-admin", headers: bearer(token), payload: { displayName: "改名", enabled: false, permissionCodes: [] } });
    expect(result.statusCode).toBe(409);
  });

  test("does not permit an assignment update to downgrade an existing super administrator and exposes only safe audit fields", async () => {
    const { app, token, database } = await appWithAdmin({ superAdmin: true });
    await database.query("INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ('second-admin', 'second-admin', 'Second', 'x')");
    await database.query("INSERT INTO internal_account_roles (account_id, role_id) VALUES ('second-admin', 'internal-role-super-admin')");
    const downgrade = await app.inject({ method: "PUT", url: "/v1/admin/access/accounts/second-admin/roles", headers: bearer(token), payload: { roleIds: [] } });
    expect(downgrade.statusCode).toBe(409);
    const audit = await app.inject({ method: "GET", url: "/v1/admin/access/audit", headers: bearer(token) });
    expect(audit.statusCode).toBe(200);
    expect(audit.body).not.toMatch(/password_hash|cipher|token|prompt|content|media/i);
  });
});

async function appWithAdmin(options: { superAdmin?: boolean } = {}) {
  const memory = newDb(); memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  const { Pool } = memory.adapters.createPg(); const database = new Pool(); await migrations(database);
  const hash = await hashPassword("passphrase", () => Buffer.alloc(16, 4));
  await database.query("INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ('admin', 'admin', 'Admin', $1)", [hash]);
  if (options.superAdmin) await database.query("INSERT INTO internal_account_roles (account_id, role_id) VALUES ('admin', 'internal-role-super-admin')");
  const app = buildServer({ database, authTokenSecret: "a sufficiently long test signing secret" });
  const token = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName: "admin", password: "passphrase" } })).json<{ accessToken: string }>().accessToken;
  return { app, token, database };
}
function bearer(token: string) { return { authorization: `Bearer ${token}` }; }
async function migrations(database: { query(sql: string): Promise<unknown> }) { const folder = new URL("../migrations/", import.meta.url); for (const file of (await readdir(folder)).filter(file => /^\d+.*\.sql$/.test(file)).sort()) await database.query((await readFile(new URL(file, folder), "utf8")).replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, "")); }
