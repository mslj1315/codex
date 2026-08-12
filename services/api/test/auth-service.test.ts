import { readdir, readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import { hashPassword } from "../src/auth/credentials.js";
import { AuthRepository } from "../src/auth/repository.js";
import { AuthService } from "../src/auth/service.js";
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
    await expect(service.resolveStoreContext(login.accessToken, "store_disabled")).rejects.toBeInstanceOf(AuthenticationError);
    await expect(service.listStores(login.accessToken)).resolves.toEqual([
      { enterpriseId: "ent_demo", storeId: "store_demo", role: "owner" }
    ]);
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

  it("revokes existing sessions when controlled provisioning resets a password", async () => {
    const login = await service.login({ loginName: "owner", password: "passphrase" });
    await new AuthRepository(database).provision({
      loginName: "owner", displayName: "Owner", passwordHash: "replacement_hash",
      enterpriseId: "ent_demo", storeId: "store_demo", storeRole: "owner"
    });

    await expect(service.authenticateAccessToken(login.accessToken)).rejects.toBeInstanceOf(AuthenticationError);
  });
});

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
