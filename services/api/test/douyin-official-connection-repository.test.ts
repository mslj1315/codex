import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { DouyinConnectionRepository } from "../src/douyin-official/connection-repository.js";
import type { Database } from "../src/db.js";

describe("Douyin official connection repository", () => {
  let database: Database;
  let repository: DouyinConnectionRepository;

  beforeEach(async () => {
    const memory = newDb({ noAstCoverageCheck: true });
    const { Pool } = memory.adapters.createPg();
    database = new Pool();
    const migration = await readFile(new URL("../migrations/017_douyin_official_connections.sql", import.meta.url), "utf8");
    await database.query(migration);
    repository = new DouyinConnectionRepository(database);
  });

  it("persists content and life-service connections separately for one store without plain token columns", async () => {
    await repository.upsertConnection({
      enterpriseId: "enterprise-1", storeId: "store-1", connectionType: "content_account",
      officialSubjectId: "content-subject", capabilities: ["works.read", "plays.read"],
      accessTokenCiphertext: "encrypted-access", refreshTokenCiphertext: "encrypted-refresh", expiresAt: new Date("2026-08-15T00:00:00.000Z")
    });
    await repository.upsertConnection({
      enterpriseId: "enterprise-1", storeId: "store-1", connectionType: "life_service_store",
      officialSubjectId: "life-subject", capabilities: ["orders.aggregate.read"],
      accessTokenCiphertext: "encrypted-other-access", refreshTokenCiphertext: "encrypted-other-refresh", expiresAt: new Date("2026-08-15T00:00:00.000Z")
    });

    expect(await repository.listConnections({ enterpriseId: "enterprise-1", storeId: "store-1" })).toMatchObject([
      { connectionType: "content_account", state: "active", officialSubjectId: "content-subject", capabilities: ["works.read", "plays.read"] },
      { connectionType: "life_service_store", state: "active", officialSubjectId: "life-subject", capabilities: ["orders.aggregate.read"] }
    ]);
    const columns = await database.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'douyin_data_connections'");
    expect(columns.rows.map((row) => row.column_name)).not.toContain("access_token");
    expect(columns.rows.map((row) => row.column_name)).not.toContain("refresh_token");
  });

  it("consumes a state only once within its enterprise and store scope", async () => {
    const now = new Date("2026-08-14T00:00:00.000Z");
    repository = new DouyinConnectionRepository(database, () => now);
    await repository.createOAuthState({
      state: "single-use-state", enterpriseId: "enterprise-1", storeId: "store-1", connectionType: "content_account",
      redirectPath: "/content/tasks/task-1", expiresAt: new Date("2026-08-14T00:05:00.000Z")
    });

    expect(await repository.consumeOAuthState({ state: "single-use-state", enterpriseId: "enterprise-2", storeId: "store-1" })).toBeNull();
    expect(await repository.consumeOAuthState({ state: "single-use-state", enterpriseId: "enterprise-1", storeId: "store-1" })).toMatchObject({
      connectionType: "content_account", redirectPath: "/content/tasks/task-1"
    });
    expect(await repository.consumeOAuthState({ state: "single-use-state", enterpriseId: "enterprise-1", storeId: "store-1" })).toBeNull();
  });

  it("does not consume an expired OAuth state", async () => {
    repository = new DouyinConnectionRepository(database, () => new Date("2026-08-14T00:00:00.000Z"));
    await database.query(`INSERT INTO douyin_oauth_states
      (id, state_hash, enterprise_id, store_id, connection_type, redirect_path, nonce, expires_at)
      VALUES ('expired-id', $1, 'enterprise-1', 'store-1', 'life_service_store', '/connections', 'nonce', '2026-08-13T23:59:59.999Z')`, [createHash("sha256").update("expired-state").digest("hex")]);

    expect(await repository.consumeOAuthState({ state: "expired-state", enterpriseId: "enterprise-1", storeId: "store-1" })).toBeNull();
  });

  it("stores only the SHA-256 OAuth state digest", async () => {
    const now = new Date("2026-08-14T00:00:00.000Z");
    repository = new DouyinConnectionRepository(database, () => now);
    await repository.createOAuthState({
      state: "untrusted-browser-state", enterpriseId: "enterprise-1", storeId: "store-1", connectionType: "content_account",
      redirectPath: "/connections", expiresAt: new Date("2026-08-14T00:01:00.000Z")
    });

    const stored = await database.query<{ state_hash: string }>("SELECT state_hash FROM douyin_oauth_states");
    expect(stored.rows).toEqual([{ state_hash: createHash("sha256").update("untrusted-browser-state").digest("hex") }]);
    expect(stored.rows[0].state_hash).not.toBe("untrusted-browser-state");
  });

  it("allows only one concurrent state consumer", async () => {
    const now = new Date("2026-08-14T00:00:00.000Z");
    repository = new DouyinConnectionRepository(database, () => now);
    await repository.createOAuthState({
      state: "concurrent-state", enterpriseId: "enterprise-1", storeId: "store-1", connectionType: "content_account",
      redirectPath: "/connections", expiresAt: new Date("2026-08-14T00:01:00.000Z")
    });

    const results = await Promise.all([1, 2].map(() => repository.consumeOAuthState({ state: "concurrent-state", enterpriseId: "enterprise-1", storeId: "store-1" })));
    expect(results.filter((result) => result !== null)).toHaveLength(1);
  });

  it("only creates OAuth state that expires within ten minutes of its injected clock", async () => {
    const now = new Date("2026-08-14T00:00:00.000Z");
    repository = new DouyinConnectionRepository(database, () => now);
    await expect(repository.createOAuthState({
      state: "already-expired", enterpriseId: "enterprise-1", storeId: "store-1", connectionType: "content_account",
      redirectPath: "/connections", expiresAt: now
    })).rejects.toThrow("expiresAt must be in the future");
    await expect(repository.createOAuthState({
      state: "too-long", enterpriseId: "enterprise-1", storeId: "store-1", connectionType: "content_account",
      redirectPath: "/connections", expiresAt: new Date("2026-08-14T00:10:00.001Z")
    })).rejects.toThrow("expiresAt must be within 10 minutes");
    await expect(repository.createOAuthState({
      state: "ten-minutes", enterpriseId: "enterprise-1", storeId: "store-1", connectionType: "content_account",
      redirectPath: "/connections", expiresAt: new Date("2026-08-14T00:10:00.000Z")
    })).resolves.toBeUndefined();
  });

  it.each(["https://attacker.invalid", "//attacker.invalid", "/\\attacker", "/safe\nheader", "relative/path"])("rejects unsafe OAuth redirect path %j", async (redirectPath) => {
    await expect(repository.createOAuthState({
      state: `unsafe-${redirectPath}`, enterpriseId: "enterprise-1", storeId: "store-1", connectionType: "content_account",
      redirectPath, expiresAt: new Date(Date.now() + 60_000)
    })).rejects.toThrow("redirectPath must be an internal path");
  });
});
