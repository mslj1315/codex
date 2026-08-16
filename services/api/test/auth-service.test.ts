import { readdir, readFile } from "node:fs/promises";
import { scrypt as nodeScrypt } from "node:crypto";
import { promisify } from "node:util";
import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import { hashPassword } from "../src/auth/credentials.js";
import { AuthRepository } from "../src/auth/repository.js";
import { AuthService, AuthorizationError } from "../src/auth/service.js";
import { AuthenticationError } from "../src/auth/tokens.js";
import { authenticatedContextResolver } from "../src/imports/routes.js";

describe("auth service", () => {
  let database: Database;
  let service: AuthService;
  const now = new Date("2026-08-12T00:00:00.000Z");

  beforeEach(async () => {
    const memory = newDb();
    memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
    const { Pool } = memory.adapters.createPg();
    database = new Pool();
    await applyTestMigrations(database);
    await database.query(
      "INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ($1, $2, $3, $4)",
      ["account_owner", "owner", "Owner", await hashPassword("passphrase", () => Buffer.alloc(16, 9))]
    );
    await database.query("INSERT INTO store_memberships (account_id, enterprise_id, store_id, role) VALUES ('account_owner', 'ent_demo', 'store_demo', 'owner')");
    await database.query("INSERT INTO store_memberships (account_id, enterprise_id, store_id, role, enabled) VALUES ('account_owner', 'ent_demo', 'store_disabled', 'operator', false)");
    service = new AuthService(new AuthRepository(database), "a sufficiently long test signing secret", () => now);
  });

  it("rotates refresh sessions and rejects replay", async () => {
    const first = await service.login({ loginName: "OWNER", password: "passphrase" });
    const second = await service.refresh({ refreshToken: first.refreshToken });

    expect(second.accessToken).not.toEqual(first.accessToken);
    await expect(service.authenticateAccessToken(second.accessToken)).resolves.toEqual({ id: "account_owner", displayName: "Owner" });
    await expect(service.refresh({ refreshToken: first.refreshToken })).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("revokes the access token session on logout", async () => {
    const login = await service.login({ loginName: "owner", password: "passphrase" });
    await service.logout(login.accessToken);

    await expect(service.authenticateAccessToken(login.accessToken)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("derives only enabled store context from membership", async () => {
    const login = await service.login({ loginName: "owner", password: "passphrase" });

    await expect(service.resolveStoreContext(login.accessToken, "store_demo")).resolves.toEqual({
      enterpriseId: "ent_demo", storeId: "store_demo", actorId: "account_owner"
    });
    await expect(service.resolveStoreContext(login.accessToken, "store_disabled")).rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.listStores(login.accessToken)).resolves.toEqual([
      { enterpriseId: "ent_demo", storeId: "store_demo", role: "owner" }
    ]);
  });

  it("requires every independent enabled provider role through one authorization check", async () => {
    const passwordHash = await hashPassword("passphrase", () => Buffer.alloc(16, 8));
    await database.query("INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ('account_viewer', 'viewer', 'Viewer', $1)", [passwordHash]);
    await database.query("INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ('account_catalog', 'catalog', 'Catalog', $1)", [passwordHash]);
    await database.query("INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ('account_editor', 'editor', 'Editor', $1)", [passwordHash]);
    await database.query("INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ('account_disabled_viewer', 'disabled_viewer', 'Disabled viewer', $1)", [passwordHash]);
    await database.query("INSERT INTO service_operator_roles (account_id, role) VALUES ('account_viewer', 'provider_feedback_viewer')");
    await database.query("INSERT INTO service_operator_roles (account_id, role) VALUES ('account_catalog', 'metric_catalog_operator')");
    await database.query("INSERT INTO service_operator_roles (account_id, role) VALUES ('account_editor', 'provider_customer_metadata_editor')");
    await database.query("INSERT INTO service_operator_roles (account_id, role, enabled) VALUES ('account_disabled_viewer', 'provider_feedback_viewer', false)");

    const viewer = await service.login({ loginName: "viewer", password: "passphrase" });
    const catalog = await service.login({ loginName: "catalog", password: "passphrase" });
    const editor = await service.login({ loginName: "editor", password: "passphrase" });
    const disabled = await service.login({ loginName: "disabled_viewer", password: "passphrase" });

    await expect(service.requireServiceOperatorRole(viewer.accessToken, "provider_feedback_viewer"))
      .resolves.toEqual({ id: "account_viewer", displayName: "Viewer" });
    await expect(service.requireServiceOperatorRole(catalog.accessToken, "provider_feedback_viewer"))
      .rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.requireServiceOperatorRole(disabled.accessToken, "provider_feedback_viewer"))
      .rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.requireServiceOperatorRoles(viewer.accessToken, ["provider_feedback_viewer", "provider_customer_metadata_editor"]))
      .rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.requireServiceOperatorRoles(editor.accessToken, ["provider_feedback_viewer", "provider_customer_metadata_editor"]))
      .rejects.toBeInstanceOf(AuthorizationError);

    await database.query("INSERT INTO service_operator_roles (account_id, role) VALUES ('account_viewer', 'provider_customer_metadata_editor')");
    await expect(service.requireServiceOperatorRoles(viewer.accessToken, ["provider_feedback_viewer", "provider_customer_metadata_editor"]))
      .resolves.toEqual({ id: "account_viewer", displayName: "Viewer" });
  });

  it("returns exact provider capabilities from independent enabled service roles", async () => {
    const login = await service.login({ loginName: "owner", password: "passphrase" });

    await expect(service.providerSession(login.accessToken)).resolves.toEqual({
      account: { id: "account_owner", displayName: "Owner" },
      capabilities: { providerFeedbackViewer: false, metricCatalogOperator: false, providerCustomerMetadataEditor: false, modelPricingOperator: false }
    });

    await database.query(
      "INSERT INTO service_operator_roles (account_id, role) VALUES ('account_owner', 'provider_feedback_viewer')"
    );
    await expect(service.providerSession(login.accessToken)).resolves.toEqual({
      account: { id: "account_owner", displayName: "Owner" },
      capabilities: { providerFeedbackViewer: true, metricCatalogOperator: false, providerCustomerMetadataEditor: false, modelPricingOperator: false }
    });

    await database.query(
      "UPDATE service_operator_roles SET enabled = false WHERE account_id = 'account_owner' AND role = 'provider_feedback_viewer'"
    );
    await database.query(
      "INSERT INTO service_operator_roles (account_id, role) VALUES ('account_owner', 'metric_catalog_operator')"
    );
    await expect(service.providerSession(login.accessToken)).resolves.toEqual({
      account: { id: "account_owner", displayName: "Owner" },
      capabilities: { providerFeedbackViewer: false, metricCatalogOperator: true, providerCustomerMetadataEditor: false, modelPricingOperator: false }
    });

    await database.query(
      "UPDATE service_operator_roles SET enabled = true WHERE account_id = 'account_owner' AND role = 'provider_feedback_viewer'"
    );
    const providerSession = await service.providerSession(login.accessToken);
    expect(providerSession).toEqual({
      account: { id: "account_owner", displayName: "Owner" },
      capabilities: { providerFeedbackViewer: true, metricCatalogOperator: true, providerCustomerMetadataEditor: false, modelPricingOperator: false }
    });
    await database.query(
      "INSERT INTO service_operator_roles (account_id, role) VALUES ('account_owner', 'provider_customer_metadata_editor')"
    );
    await expect(service.providerSession(login.accessToken)).resolves.toEqual({
      account: { id: "account_owner", displayName: "Owner" },
      capabilities: { providerFeedbackViewer: true, metricCatalogOperator: true, providerCustomerMetadataEditor: true, modelPricingOperator: false }
    });
    expect(JSON.stringify(providerSession)).not.toMatch(/loginName|passwordHash|refreshToken|sessionId|store_demo/);
  });

  it("resolves only a bearer token and its URL store into trusted context", async () => {
    const login = await service.login({ loginName: "owner", password: "passphrase" });
    const resolver = authenticatedContextResolver(service);

    await expect(resolver(request("Bearer " + login.accessToken, "store_demo"))).resolves.toEqual({
      enterpriseId: "ent_demo", storeId: "store_demo", actorId: "account_owner"
    });
    await expect(resolver(request("Bearer " + login.accessToken, "store_other"))).resolves.toBeUndefined();
    await expect(resolver(request("Bearer forged", "store_demo"))).resolves.toBeUndefined();
  });

  it("does not hide infrastructure failures as authorization failures", async () => {
    const resolver = authenticatedContextResolver({
      async resolveStoreContext() { throw new Error("database unavailable"); }
    } as never);

    await expect(resolver(request("Bearer one.two.three", "store_demo"))).rejects.toThrow("database unavailable");
  });

  it("provisions one account and upserts its store and provider grants", async () => {
    const repository = new AuthRepository(database);
    const first = await repository.provision({
      loginName: "provider", displayName: "Provider", passwordHash: "hash_one",
      enterpriseId: "ent_demo", storeId: "store_provider", storeRole: "operator",
      serviceOperatorRole: "provider_feedback_viewer"
    });
    const second = await repository.provision({
      loginName: "provider", displayName: "Provider Updated", passwordHash: "hash_two",
      enterpriseId: "ent_demo", storeId: "store_provider", storeRole: "owner"
    });

    expect(second.accountId).toBe(first.accountId);
    await expect(database.query("SELECT login_name, display_name, password_hash FROM accounts WHERE id = $1", [first.accountId]))
      .resolves.toMatchObject({ rows: [{ login_name: "provider", display_name: "Provider Updated", password_hash: "hash_two" }] });
    await expect(database.query("SELECT role FROM store_memberships WHERE account_id = $1 AND store_id = 'store_provider'", [first.accountId]))
      .resolves.toMatchObject({ rows: [{ role: "owner" }] });
    await expect(database.query("SELECT role FROM service_operator_roles WHERE account_id = $1", [first.accountId]))
      .resolves.toMatchObject({ rows: [{ role: "provider_feedback_viewer" }] });
  });

  it("grants the metadata editor role without changing an authenticated account", async () => {
    const repository = new AuthRepository(database);
    const login = await service.login({ loginName: "owner", password: "passphrase" });
    const before = await database.query(
      "SELECT password_hash FROM accounts WHERE id = 'account_owner'"
    );
    const membershipBefore = await database.query(
      "SELECT enterprise_id, store_id, role, enabled FROM store_memberships WHERE account_id = 'account_owner'"
    );

    await expect(repository.grantServiceOperatorRole("account_owner", "provider_customer_metadata_editor")).resolves.toBe(true);

    await expect(service.authenticateAccessToken(login.accessToken)).resolves.toEqual({ id: "account_owner", displayName: "Owner" });
    await expect(database.query("SELECT password_hash FROM accounts WHERE id = 'account_owner'"))
      .resolves.toEqual(before);
    await expect(database.query("SELECT enterprise_id, store_id, role, enabled FROM store_memberships WHERE account_id = 'account_owner'"))
      .resolves.toEqual(membershipBefore);
    await expect(repository.listEnabledServiceOperatorRoles("account_owner"))
      .resolves.toEqual(["provider_customer_metadata_editor"]);
  });

  it("does not create a role row for a missing or disabled account", async () => {
    const repository = new AuthRepository(database);
    await database.query(
      "INSERT INTO accounts (id, login_name, display_name, password_hash, enabled) VALUES ('account_disabled', 'disabled', 'Disabled', 'hash', false)"
    );

    await expect(repository.grantServiceOperatorRole("account_missing", "provider_customer_metadata_editor")).resolves.toBe(false);
    await expect(repository.grantServiceOperatorRole("account_disabled", "provider_customer_metadata_editor")).resolves.toBe(false);
    await expect(database.query("SELECT account_id FROM service_operator_roles WHERE role = 'provider_customer_metadata_editor'"))
      .resolves.toMatchObject({ rowCount: 0 });
  });

  it("revokes existing sessions when controlled provisioning resets a password", async () => {
    const login = await service.login({ loginName: "owner", password: "passphrase" });
    await new AuthRepository(database).provision({
      loginName: "owner", displayName: "Owner", passwordHash: "replacement_hash",
      enterpriseId: "ent_demo", storeId: "store_demo", storeRole: "owner"
    });

    await expect(service.authenticateAccessToken(login.accessToken)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("accepts a formatted customer mobile login and upgrades a verified legacy password hash", async () => {
    const legacyHash = await legacyScryptHash("passphrase");
    await database.query("UPDATE accounts SET login_name = '13800138000', password_hash = $1 WHERE id = 'account_owner'", [legacyHash]);

    const login = await service.login({ loginName: " +86 138-0013-8000 ", password: "passphrase" });

    expect(login.account).toEqual({ id: "account_owner", displayName: "Owner" });
    await expect(database.query("SELECT password_hash FROM accounts WHERE id = 'account_owner'"))
      .resolves.toMatchObject({ rows: [{ password_hash: expect.stringMatching(/^\$2[aby]\$/) }] });
  });

  it("rejects a session created from a credential version invalidated by a concurrent reset", async () => {
    const repository = new AuthRepository(database);
    await database.query("UPDATE accounts SET credential_version = 1 WHERE id = 'account_owner'");
    await database.query("UPDATE accounts SET credential_version = credential_version + 1 WHERE id = 'account_owner'");
    await repository.createSession({ id: "stale_session", accountId: "account_owner", credentialVersion: 1, refreshTokenHash: "stale", expiresAt: new Date("2026-09-01T00:00:00.000Z") });

    await expect(repository.findActiveSession("account_owner", "stale_session", now)).resolves.toBeUndefined();
  });
});

async function legacyScryptHash(password: string): Promise<string> {
  const salt = Buffer.alloc(16, 5);
  const derive = promisify(nodeScrypt) as (value: string, salt: Buffer, length: number) => Promise<Buffer>;
  const derived = await derive(password, salt, 32);
  return `scrypt$v1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function applyTestMigrations(database: Database): Promise<void> {
  const migrationsUrl = new URL("../migrations/", import.meta.url);
  const files = (await readdir(migrationsUrl)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationsUrl), "utf8");
    await database.query(sql.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
  }
}

function request(authorization: string, storeId: string) {
  return { headers: { authorization }, params: { storeId } } as never;
}
