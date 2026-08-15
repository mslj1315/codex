import { describe, expect, test } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { hashPassword } from "../src/auth/credentials.js";
import { INTERNAL_PERMISSION_CODES, effectiveInternalPermissions, InternalPermissionRepository, requireInternalPermission, sanitizeInternalAuditMetadata } from "../src/admin/rbac.js";
import { buildServer } from "../src/server.js";

describe("internal RBAC", () => {
  test("defines the stable functional permissions required by the unified admin", () => {
    expect(INTERNAL_PERMISSION_CODES).toEqual([
      "customer_accounts.read",
      "customer_accounts.create",
      "customer_accounts.reset_password",
      "customer_accounts.disable",
      "content_templates.read",
      "content_templates.edit",
      "content_templates.publish",
      "review_rules.read",
      "review_rules.edit",
      "review_rules.publish",
      "model_configs.read",
      "model_configs.manage",
      "model_assignments.manage",
      "model_pricing.read",
      "model_pricing.manage",
      "model_usage.read",
      "internal_accounts.read",
      "internal_accounts.manage",
      "roles.manage",
      "audit.read"
    ]);
  });

  test("super administrator receives every internal permission", () => {
    expect(effectiveInternalPermissions({ superAdmin: true, rolePermissions: [] }))
      .toEqual(new Set(INTERNAL_PERMISSION_CODES));
  });

  test("combines permissions from every assigned role", () => {
    expect(effectiveInternalPermissions({
      superAdmin: false,
      rolePermissions: [["content_templates.edit"], ["model_pricing.read"]]
    })).toEqual(new Set(["content_templates.edit", "model_pricing.read"]));
  });

  test("rejects a missing permission before executing protected work", async () => {
    let repositoryRead = false;
    await expect(requireInternalPermission(new Set(), "internal_accounts.read", async () => {
      repositoryRead = true;
    })).rejects.toThrow("Internal permission is not authorized");
    expect(repositoryRead).toBe(false);
  });

  test("loads every permission for an assigned super administrator", async () => {
    const repository = new InternalPermissionRepository({
      async query(text: string) {
        return text.includes("SELECT role.code")
          ? { rows: [{ code: "super_admin" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
    } as never);
    expect(await repository.permissionsFor("admin-1")).toEqual(new Set(INTERNAL_PERMISSION_CODES));
  });

  test("returns a safe permission summary only for internal accounts", async () => {
    const { app, superAdminToken, customerToken } = await authenticatedRbacApp();

    const allowed = await app.inject({
      method: "GET",
      url: "/v1/auth/me/internal-permissions",
      headers: bearer(superAdminToken)
    });
    const denied = await app.inject({
      method: "GET",
      url: "/v1/auth/me/internal-permissions",
      headers: bearer(customerToken)
    });

    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({
      account: { id: "account_super_admin", displayName: "Admin" },
      permissions: [...INTERNAL_PERMISSION_CODES].sort()
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: "Forbidden" });
  });

  test("rejects an internal account before reading a customer resource even when it has store membership", async () => {
    const { app, superAdminToken } = await authenticatedRbacApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/stores/store_customer/content-profile",
      headers: bearer(superAdminToken)
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("store_customer");
  });

  test("rejects an internal account before querying customer store memberships", async () => {
    const { app, superAdminToken, customerMembershipQueryCount } = await authenticatedRbacApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/auth/me/stores",
      headers: bearer(superAdminToken)
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "Forbidden" });
    expect(customerMembershipQueryCount()).toBe(0);
  });

  test("rejects sensitive values from internal audit metadata", () => {
    expect(sanitizeInternalAuditMetadata({ roleCode: "super_admin", enabled: true }))
      .toEqual({ roleCode: "super_admin", enabled: true });
    for (const metadata of [
      { password: "do-not-store" },
      { apiKey: "do-not-store" },
      { prompt: "do-not-store" },
      { content: "do-not-store" },
      { enabled: Number.NaN }
    ]) {
      expect(() => sanitizeInternalAuditMetadata(metadata)).toThrow();
    }
  });

  test("makes internal role machine codes immutable in PostgreSQL", async () => {
    const migration = await readFile(new URL("../migrations/030_internal_rbac.sql", import.meta.url), "utf8");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION reject_internal_role_code_mutation()");
    expect(migration).toContain("internal role machine code is immutable");
    expect(migration).toContain("BEFORE UPDATE ON internal_roles");
  });
});

async function authenticatedRbacApp() {
  const memory = newDb();
  memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  const { Pool } = memory.adapters.createPg();
  const database = new Pool();
  await applyTestMigrations(database);
  const passwordHash = await hashPassword("passphrase", () => Buffer.alloc(16, 9));
  for (const [id, loginName, displayName] of [
    ["account_super_admin", "admin", "Admin"],
    ["account_customer", "customer", "Customer"]
  ]) {
    await database.query(
      "INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ($1, $2, $3, $4)",
      [id, loginName, displayName, passwordHash]
    );
  }
  await database.query("INSERT INTO internal_account_roles (account_id, role_id) VALUES ('account_super_admin', 'internal-role-super-admin')");
  await database.query("INSERT INTO store_memberships (account_id, enterprise_id, store_id, role) VALUES ('account_super_admin', 'enterprise_customer', 'store_customer', 'owner')");
  await database.query("INSERT INTO store_memberships (account_id, enterprise_id, store_id, role) VALUES ('account_customer', 'enterprise_customer', 'store_customer', 'owner')");
  const app = buildServer({ database, authTokenSecret: "a sufficiently long test signing secret" });
  const superAdminToken = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName: "admin", password: "passphrase" } })).json<{ accessToken: string }>().accessToken;
  const customerToken = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName: "customer", password: "passphrase" } })).json<{ accessToken: string }>().accessToken;
  let customerMembershipQueries = 0;
  const query = database.query.bind(database);
  database.query = async (text: string, ...rest: unknown[]) => {
    if (text.includes("FROM store_memberships")) customerMembershipQueries++;
    return query(text, ...rest as []);
  };
  return { app, superAdminToken, customerToken, customerMembershipQueryCount: () => customerMembershipQueries };
}

function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }

async function applyTestMigrations(database: { query(text: string): Promise<unknown> }) {
  const migrationsUrl = new URL("../migrations/", import.meta.url);
  const files = (await readdir(migrationsUrl)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationsUrl), "utf8");
    await database.query(sql.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
  }
}
