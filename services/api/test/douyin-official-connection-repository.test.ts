import { readFile } from "node:fs/promises";
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
    await repository.createOAuthState({
      state: "single-use-state", enterpriseId: "enterprise-1", storeId: "store-1", connectionType: "content_account",
      redirectPath: "/content/tasks/task-1", expiresAt: new Date("2099-01-01T00:00:00.000Z")
    });

    expect(await repository.consumeOAuthState({ state: "single-use-state", enterpriseId: "enterprise-2", storeId: "store-1" })).toBeNull();
    expect(await repository.consumeOAuthState({ state: "single-use-state", enterpriseId: "enterprise-1", storeId: "store-1" })).toMatchObject({
      connectionType: "content_account", redirectPath: "/content/tasks/task-1"
    });
    expect(await repository.consumeOAuthState({ state: "single-use-state", enterpriseId: "enterprise-1", storeId: "store-1" })).toBeNull();
  });

  it("does not consume an expired OAuth state", async () => {
    await repository.createOAuthState({
      state: "expired-state", enterpriseId: "enterprise-1", storeId: "store-1", connectionType: "life_service_store",
      redirectPath: "/connections", expiresAt: new Date("2000-01-01T00:00:00.000Z")
    });

    expect(await repository.consumeOAuthState({ state: "expired-state", enterpriseId: "enterprise-1", storeId: "store-1" })).toBeNull();
  });
});
