import { readdir, readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import {
  ProviderCustomerMetadataRepository,
  providerCustomerScopeKey
} from "../src/provider-customers/repository.js";
import {
  parseMetadataReplacement,
  parseProviderCustomerScope,
  ProviderCustomerMetadataConflictError,
  ProviderCustomerNotFoundError,
  ProviderCustomerService
} from "../src/provider-customers/service.js";
import type { ProviderFeedbackQuery } from "../src/provider-feedback/service.js";
import type { ProviderFeedbackRow } from "../src/provider-feedback/repository.js";

describe("provider customer metadata repository", () => {
  let database: Database;
  let repository: ProviderCustomerMetadataRepository;
  const now = new Date("2026-08-13T00:00:00.000Z");

  beforeEach(async () => {
    const memory = newDb();
    memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
    const { Pool } = memory.adapters.createPg();
    database = new Pool();
    await applyTestMigrations(database);
    await database.query("INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ('account_editor', 'editor', 'Editor', 'hash')");
    repository = new ProviderCustomerMetadataRepository(database);
  });

  it("creates metadata at version one, replaces it, and rejects a stale version", async () => {
    const scope = { enterpriseId: "ent_demo", storeId: "store_demo" };
    const later = new Date("2026-08-13T00:01:00.000Z");

    const created = await repository.replace({
      ...scope, customerAlias: "Pilot", providerNote: "Call next week",
      expectedVersion: null, accountId: "account_editor", now
    });
    expect(created).toEqual({
      status: "saved",
      metadata: { customerAlias: "Pilot", providerNote: "Call next week", version: 1, updatedAt: now }
    });
    const replaced = await repository.replace({
      ...scope, customerAlias: "Pilot North", providerNote: null,
      expectedVersion: 1, accountId: "account_editor", now: later
    });
    expect(replaced).toEqual({
      status: "saved",
      metadata: { customerAlias: "Pilot North", providerNote: null, version: 2, updatedAt: later }
    });

    await expect(repository.replace({
      ...scope, customerAlias: "Stale", providerNote: null,
      expectedVersion: 1, accountId: "account_editor", now: later
    })).resolves.toEqual({ status: "conflict" });
  });

  it("recognizes scopes from each feedback source and never from metadata alone", async () => {
    const scopes = [
      { enterpriseId: "ent_import", storeId: "store_import", source: "import" },
      { enterpriseId: "ent_fact", storeId: "store_fact", source: "fact" },
      { enterpriseId: "ent_diagnostic", storeId: "store_diagnostic", source: "diagnostic" },
      { enterpriseId: "ent_action", storeId: "store_action", source: "action" }
    ] as const;
    await seedImport(scopes[0].enterpriseId, scopes[0].storeId, "batch_import");
    await seedImport(scopes[1].enterpriseId, scopes[1].storeId, "batch_fact");
    await database.query("INSERT INTO fact_versions (id, enterprise_id, store_id, source_batch_id, confirmation_actor_id, confirmation_status, confirmed_at) VALUES ('version_fact', 'ent_fact', 'store_fact', 'batch_fact', 'actor', 'confirmed', $1)", [now]);
    await database.query("INSERT INTO diagnostic_runs (id, enterprise_id, store_id, kind, range_start, range_end, prior_range_start, prior_range_end, rule_version, confidence, snapshot_key) VALUES ('diagnostic', 'ent_diagnostic', 'store_diagnostic', 'revenue_decline', '2026-08-01', '2026-08-07', '2026-07-25', '2026-07-31', 'v1', 'high', 'snapshot')");
    await database.query("INSERT INTO action_cards (id, enterprise_id, store_id, created_by_actor_id, diagnostic_kind, range_start, range_end, title, action, verification_metric, status) VALUES ('action', 'ent_action', 'store_action', 'actor', 'manual', '2026-08-01', '2026-08-07', 'private', 'private', 'private', 'proposed')");
    await database.query("INSERT INTO provider_customer_metadata (enterprise_id, store_id, customer_alias, updated_by_account_id) VALUES ('ent_metadata', 'store_metadata', 'not a scope', 'account_editor')");

    await expect(Promise.all(scopes.map((scope) => repository.scopeExists(scope)))).resolves.toEqual([true, true, true, true]);
    await expect(repository.scopeExists({ enterpriseId: "ent_metadata", storeId: "store_metadata" })).resolves.toBe(false);
  });

  it("classifies a duplicate initial creation as a conflict", async () => {
    let calls = 0;
    const repository = new ProviderCustomerMetadataRepository({
      async query() {
        calls += 1;
        return calls === 1
          ? { rows: [{ customer_alias: "Pilot", provider_note: null, version: 1, updated_at: now }], rowCount: 1, command: "INSERT", oid: 0, fields: [] } as never
          : { rows: [], rowCount: 0, command: "INSERT", oid: 0, fields: [] } as never;
      },
      async connect() { throw new Error("not used"); }
    });
    const input = { enterpriseId: "ent_duplicate", storeId: "store_duplicate", customerAlias: "Pilot", providerNote: null, expectedVersion: null, accountId: "account_editor", now };

    await expect(repository.replace(input)).resolves.toMatchObject({ status: "saved" });
    await expect(repository.replace(input)).resolves.toEqual({ status: "conflict" });
  });

  it("queries every feedback scope source when checking existence", async () => {
    const queries: string[] = [];
    const repository = new ProviderCustomerMetadataRepository({
      async query(text: string) {
        queries.push(text);
        return { rows: [{ exists: true }], rowCount: 1, command: "SELECT", oid: 0, fields: [] } as never;
      },
      async connect() { throw new Error("not used"); }
    });

    await expect(repository.scopeExists({ enterpriseId: "ent", storeId: "store" })).resolves.toBe(true);

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("FROM import_batches");
    expect(queries[0]).toContain("FROM fact_versions");
    expect(queries[0]).toContain("FROM diagnostic_runs");
    expect(queries[0]).toContain("FROM action_cards");
    expect(queries[0]).not.toContain("provider_customer_metadata");
  });

  it("batch loads metadata in one query with collision-safe keys", async () => {
    const first = { enterpriseId: "a|b", storeId: "c" };
    const second = { enterpriseId: "a", storeId: "b|c" };
    const calls: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
    const observed: Database = {
      async query(text, values) {
        calls.push({ text, values });
        return {
          rows: [
            { enterprise_id: first.enterpriseId, store_id: first.storeId, customer_alias: "First", provider_note: null, version: 1, updated_at: now },
            { enterprise_id: second.enterpriseId, store_id: second.storeId, customer_alias: "Second", provider_note: null, version: 1, updated_at: now }
          ], rowCount: 2, command: "SELECT", oid: 0, fields: []
        } as never;
      },
      async connect() { throw new Error("not used"); }
    };
    const observedRepository = new ProviderCustomerMetadataRepository(observed);

    const items = await observedRepository.listForScopes([first, second]);

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("IN (VALUES ($1, $2), ($3, $4))");
    expect(calls[0].values).toEqual(["a|b", "c", "a", "b|c"]);
    expect(items.get(providerCustomerScopeKey(first))).toMatchObject({ customerAlias: "First" });
    expect(items.get(providerCustomerScopeKey(second))).toMatchObject({ customerAlias: "Second" });
    expect(providerCustomerScopeKey(first)).not.toBe(providerCustomerScopeKey(second));
    await expect(observedRepository.listForScopes([])).resolves.toEqual(new Map());
    expect(calls).toHaveLength(1);
  });

  it("clears only at the expected version and makes an absent null clear idempotent", async () => {
    const scope = { enterpriseId: "ent_clear", storeId: "store_clear" };
    await repository.replace({ ...scope, customerAlias: "Clear me", providerNote: null, expectedVersion: null, accountId: "account_editor", now });

    await expect(repository.replace({ ...scope, customerAlias: null, providerNote: null, expectedVersion: 1, accountId: "account_editor", now })).resolves.toEqual({ status: "cleared" });
    await expect(database.query("SELECT * FROM provider_customer_metadata WHERE enterprise_id = $1 AND store_id = $2", [scope.enterpriseId, scope.storeId])).resolves.toMatchObject({ rows: [] });
    await expect(repository.replace({ ...scope, customerAlias: null, providerNote: null, expectedVersion: null, accountId: "account_editor", now })).resolves.toEqual({ status: "cleared" });
    await expect(repository.replace({ ...scope, customerAlias: null, providerNote: null, expectedVersion: 1, accountId: "account_editor", now })).resolves.toEqual({ status: "conflict" });
  });

  it("uses conditional SQL for create, replacement, and clear", async () => {
    const queries: string[] = [];
    const repository = new ProviderCustomerMetadataRepository({
      async query(text: string) {
        queries.push(text);
        return { rows: [{ customer_alias: "Alias", provider_note: null, version: 1, updated_at: now }], rowCount: 1, command: "INSERT", oid: 0, fields: [] } as never;
      },
      async connect() { throw new Error("not used"); }
    });
    const input = { enterpriseId: "ent_sql", storeId: "store_sql", accountId: "account_editor", now };

    await repository.replace({ ...input, customerAlias: "Alias", providerNote: null, expectedVersion: null });
    await repository.replace({ ...input, customerAlias: "Alias", providerNote: null, expectedVersion: 1 });
    await repository.replace({ ...input, customerAlias: null, providerNote: null, expectedVersion: 1 });

    expect(queries[0]).toContain("ON CONFLICT (enterprise_id, store_id) DO NOTHING");
    expect(queries[0]).toContain("RETURNING");
    expect(queries[1]).toMatch(/WHERE enterprise_id = \$1 AND store_id = \$2 AND version = \$6[\s\S]*RETURNING/);
    expect(queries[2]).toMatch(/DELETE FROM provider_customer_metadata[\s\S]*WHERE enterprise_id = \$1 AND store_id = \$2 AND version = \$3[\s\S]*RETURNING/);
  });

  it("propagates database failures instead of classifying them as conflicts", async () => {
    const failure = new Error("database unavailable");
    const repository = new ProviderCustomerMetadataRepository({
      async query() { throw failure; },
      async connect() { throw failure; }
    });

    await expect(repository.replace({ enterpriseId: "ent_failure", storeId: "store_failure", customerAlias: "Alias", providerNote: null, expectedVersion: null, accountId: "account_editor", now })).rejects.toBe(failure);
  });

  async function seedImport(enterpriseId: string, storeId: string, id: string) {
    await database.query("INSERT INTO import_batches (id, enterprise_id, store_id, actor_id, source_type, original_file_name, original_file_checksum, status) VALUES ($1, $2, $3, 'actor', 'csv', 'file.csv', $1, 'pending_confirmation')", [id, enterpriseId, storeId]);
  }
});

describe("provider customer metadata service", () => {
  const now = new Date("2026-08-13T00:00:00.000Z");

  it("requires the exact metadata replacement body and normalizes valid text", () => {
    expect(parseMetadataReplacement({
      customerAlias: "  Pilot \r\n North  ",
      providerNote: "\tCall next week\r\n",
      expectedVersion: null
    })).toEqual({
      customerAlias: "Pilot \n North",
      providerNote: "Call next week",
      expectedVersion: null
    });
    expect(parseMetadataReplacement({
      customerAlias: " \t\r\n ", providerNote: "  ", expectedVersion: 1
    })).toEqual({ customerAlias: null, providerNote: null, expectedVersion: 1 });

    for (const value of [
      {},
      { customerAlias: null, providerNote: null },
      { customerAlias: null, providerNote: null, expectedVersion: null, extra: true },
      { customerAlias: 1, providerNote: null, expectedVersion: null },
      { customerAlias: null, providerNote: null, expectedVersion: 0 },
      { customerAlias: null, providerNote: null, expectedVersion: Number.MAX_SAFE_INTEGER + 1 }
    ]) expect(() => parseMetadataReplacement(value)).toThrow();
  });

  it("validates Unicode code point limits and disallowed controls", () => {
    expect(parseMetadataReplacement({
      customerAlias: "😀".repeat(120), providerNote: "😀".repeat(2000), expectedVersion: null
    })).toMatchObject({ customerAlias: "😀".repeat(120), providerNote: "😀".repeat(2000) });
    expect(() => parseMetadataReplacement({
      customerAlias: "x".repeat(121), providerNote: null, expectedVersion: null
    })).toThrow("customerAlias is invalid");
    expect(() => parseMetadataReplacement({
      customerAlias: "Pilot\u0000", providerNote: null, expectedVersion: null
    })).toThrow("customerAlias is invalid");
    expect(() => parseMetadataReplacement({
      customerAlias: null, providerNote: "\u000Bnot allowed", expectedVersion: null
    })).toThrow("providerNote is invalid");
  });

  it("validates both provider customer route identifiers", () => {
    expect(parseProviderCustomerScope({ enterpriseId: "ent.demo-1", storeId: "store_1" })).toEqual({
      enterpriseId: "ent.demo-1", storeId: "store_1"
    });
    for (const value of [
      { enterpriseId: "", storeId: "store" },
      { enterpriseId: "ent/slash", storeId: "store" },
      { enterpriseId: "ent", storeId: "store/extra" },
      { enterpriseId: "ent", storeId: "x".repeat(129) }
    ]) expect(() => parseProviderCustomerScope(value)).toThrow();
  });

  it("composes one feedback page with batched metadata while preserving its order and cursor", async () => {
    const first = feedbackRow("ent_first", "store_first");
    const second = feedbackRow("ent_second", "store_second");
    const query: ProviderFeedbackQuery = { limit: 2, activityState: "active" };
    const feedbackCalls: ProviderFeedbackQuery[] = [];
    const metadataCalls: Array<readonly { enterpriseId: string; storeId: string }[]> = [];
    const metadata = { customerAlias: "Pilot", providerNote: "Call next week", version: 2, updatedAt: now };
    const service = new ProviderCustomerService({
      async list(input) {
        feedbackCalls.push(input);
        return { items: [first, second], nextCursor: "opaque-next-cursor" };
      }
    }, {
      async listForScopes(scopes) {
        metadataCalls.push(scopes);
        return new Map([[providerCustomerScopeKey(first), metadata]]);
      },
      async scopeExists() { return true; },
      async replace() { throw new Error("not used"); }
    }, () => now);

    await expect(service.list(query)).resolves.toEqual({
      items: [{ feedback: first, metadata }, { feedback: second, metadata: null }],
      nextCursor: "opaque-next-cursor"
    });
    expect(feedbackCalls).toEqual([query]);
    expect(metadataCalls).toEqual([[{ enterpriseId: "ent_first", storeId: "store_first" }, { enterpriseId: "ent_second", storeId: "store_second" }]]);
  });

  it("checks feedback scope before replacement and maps conflict and public results", async () => {
    const scope = { enterpriseId: "ent_demo", storeId: "store_demo" };
    const replacement = { customerAlias: "Pilot", providerNote: null, expectedVersion: null };
    let replaceCalls = 0;
    const unavailable = new ProviderCustomerService(unusedFeedback(), {
      async listForScopes() { return new Map(); },
      async scopeExists() { return false; },
      async replace() { replaceCalls += 1; throw new Error("not used"); }
    }, () => now);
    await expect(unavailable.replace(scope, replacement, "account_editor")).rejects.toBeInstanceOf(ProviderCustomerNotFoundError);
    expect(replaceCalls).toBe(0);

    const conflict = new ProviderCustomerService(unusedFeedback(), {
      async listForScopes() { return new Map(); },
      async scopeExists() { return true; },
      async replace() { return { status: "conflict" as const }; }
    }, () => now);
    await expect(conflict.replace(scope, replacement, "account_editor")).rejects.toBeInstanceOf(ProviderCustomerMetadataConflictError);

    const savedMetadata = { customerAlias: "Pilot", providerNote: null, version: 1, updatedAt: now };
    const saved = new ProviderCustomerService(unusedFeedback(), {
      async listForScopes() { return new Map(); },
      async scopeExists() { return true; },
      async replace(input) {
        expect(input).toEqual({ ...scope, ...replacement, accountId: "account_editor", now });
        return { status: "saved" as const, metadata: savedMetadata };
      }
    }, () => now);
    await expect(saved.replace(scope, replacement, "account_editor")).resolves.toEqual({ metadata: savedMetadata });

    const cleared = new ProviderCustomerService(unusedFeedback(), {
      async listForScopes() { return new Map(); },
      async scopeExists() { return true; },
      async replace() { return { status: "cleared" as const }; }
    }, () => now);
    await expect(cleared.replace(scope, { customerAlias: null, providerNote: null, expectedVersion: 1 }, "account_editor")).resolves.toEqual({ metadata: null });
  });

  function unusedFeedback() {
    return { async list() { throw new Error("not used"); } };
  }
});

async function applyTestMigrations(database: Database): Promise<void> {
  const migrationsUrl = new URL("../migrations/", import.meta.url);
  const files = (await readdir(migrationsUrl)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationsUrl), "utf8");
    await database.query(sql.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
  }
}

function feedbackRow(enterpriseId: string, storeId: string): ProviderFeedbackRow {
  return {
    enterpriseId, storeId, lastSuccessfulImportAt: null, lastConfirmedAt: null,
    activityState: "active", readinessState: "ready", missingMetricCount: 0,
    diagnosticCounts: {}, actionCardStatusCounts: {}, verificationOutcomeCounts: {}, lastCoverageAt: null
  };
}
