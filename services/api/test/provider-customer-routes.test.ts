import { readdir, readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../src/db.js";
import { hashPassword } from "../src/auth/credentials.js";
import { ProviderCustomerMetadataRepository } from "../src/provider-customers/repository.js";
import { buildServer } from "../src/server.js";

const now = new Date("2026-08-13T00:00:00.000Z");
const marker = { "x-provider-console-request": "1" };

describe("provider customer routes", () => {
  let database: Database;
  let app: ReturnType<typeof buildServer>;
  let logs: Record<string, unknown>[];

  afterEach(() => { vi.restoreAllMocks(); });

  beforeEach(async () => {
    const memory = newDb();
    memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
    const { Pool } = memory.adapters.createPg();
    database = new Pool();
    logs = [];
    await applyTestMigrations(database);
    const hash = await hashPassword("passphrase", () => Buffer.alloc(16, 3));
    for (const [id, login, name] of [["account_viewer_editor", "viewer_editor", "Viewer Editor"], ["account_editor", "editor", "Editor"], ["account_viewer", "viewer", "Viewer"]]) {
      await database.query("INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ($1, $2, $3, $4)", [id, login, name, hash]);
    }
    await database.query("INSERT INTO service_operator_roles (account_id, role) VALUES ('account_viewer_editor', 'provider_feedback_viewer'), ('account_viewer_editor', 'provider_customer_metadata_editor'), ('account_editor', 'provider_customer_metadata_editor'), ('account_viewer', 'provider_feedback_viewer')");
    await seedConfirmedScope();
    vi.spyOn(ProviderCustomerMetadataRepository.prototype, "listForScopes").mockResolvedValue(new Map());
    app = buildServer({ database, authTokenSecret: "a sufficiently long test signing secret", now: () => now, logger: captureInfoLogs(logs) });
  });

  it("lists only confirmed aggregate feedback combined with the current metadata", async () => {
    const accessToken = await login("viewer_editor");
    const response = await app.inject({ method: "GET", url: "/v1/provider-customers?limit=10", headers: bearer(accessToken) });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [expect.objectContaining({ feedback: expect.objectContaining({ enterpriseId: "ent_customer", storeId: "store_customer" }), metadata: null })],
      nextCursor: null
    });
    expect(response.body).not.toMatch(/customerAlias|providerNote|sentinel-alias|sentinel-private-note/);
    expect(logs.find((entry) => entry.event === "provider_customer_list_access")).toEqual(expect.objectContaining({
      accountId: "account_viewer_editor", role: "provider_feedback_viewer", outcome: "success", returnedCount: 1
    }));
    expect(JSON.stringify(logs)).not.toMatch(/ent_customer|store_customer|safe\.csv/i);
  });

  it("requires the provider marker before write authentication and requires both roles without revealing scope existence", async () => {
    const editor = await login("editor");
    const payload = { customerAlias: "sentinel-alias", providerNote: "sentinel-private-note", expectedVersion: null };
    const missingMarker = await app.inject({ method: "PUT", url: "/v1/provider-customers/ent_customer/store_customer/metadata", headers: bearer(editor), payload });
    const visibleScope = await app.inject({ method: "PUT", url: "/v1/provider-customers/ent_customer/store_customer/metadata", headers: { ...marker, ...bearer(editor) }, payload });
    const unknownScope = await app.inject({ method: "PUT", url: "/v1/provider-customers/ent_unknown/store_unknown/metadata", headers: { ...marker, ...bearer(editor) }, payload });

    for (const response of [missingMarker, visibleScope, unknownScope]) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "Provider customer metadata access is required" });
    }
    expect(JSON.stringify(auditLogs(logs))).not.toMatch(/sentinel-alias|sentinel-private-note|ent_customer|store_customer|ent_unknown|store_unknown/i);
  });

  it("rejects a viewer-only metadata write with the neutral required-role response", async () => {
    const viewer = await login("viewer");
    const response = await app.inject({
      method: "PUT", url: "/v1/provider-customers/ent_customer/store_customer/metadata",
      headers: { ...marker, ...bearer(viewer) },
      payload: { customerAlias: "sentinel-alias", providerNote: "sentinel-private-note", expectedVersion: null }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "Provider customer metadata access is required" });
    expect(JSON.stringify(auditLogs(logs))).not.toMatch(/sentinel-alias|sentinel-private-note|ent_customer|store_customer/i);
  });

  it("creates, replaces, clears, validates and protects metadata versions without leaking note content", async () => {
    const accessToken = await login("viewer_editor");
    const headers = { ...marker, ...bearer(accessToken) };
    const created = await app.inject({ method: "PUT", url: "/v1/provider-customers/ent_customer/store_customer/metadata", headers, payload: { customerAlias: "sentinel-alias", providerNote: "sentinel-private-note", expectedVersion: null } });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual({ metadata: { customerAlias: "sentinel-alias", providerNote: "sentinel-private-note", version: 1, updatedAt: now.toISOString() } });

    const stale = await app.inject({ method: "PUT", url: "/v1/provider-customers/ent_customer/store_customer/metadata", headers, payload: { customerAlias: "Other", providerNote: null, expectedVersion: 4 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: "Provider customer metadata has changed" });

    const invalid = await app.inject({ method: "PUT", url: "/v1/provider-customers/ent_customer/store_customer/metadata", headers, payload: { customerAlias: "Other" } });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toEqual({ error: "Provider customer metadata is invalid" });

    const clear = await app.inject({ method: "PUT", url: "/v1/provider-customers/ent_customer/store_customer/metadata", headers, payload: { customerAlias: null, providerNote: null, expectedVersion: 1 } });
    expect(clear.statusCode).toBe(200);
    expect(clear.json()).toEqual({ metadata: null });
    const unavailable = await app.inject({ method: "PUT", url: "/v1/provider-customers/ent_unknown/store_unknown/metadata", headers, payload: { customerAlias: null, providerNote: null, expectedVersion: null } });
    expect(unavailable.statusCode).toBe(404);
    expect(unavailable.json()).toEqual({ error: "Provider customer is not available" });
    expect(JSON.stringify(auditLogs(logs))).not.toMatch(/sentinel-alias|sentinel-private-note/i);
    expect(logs.filter((entry) => entry.event === "provider_customer_metadata_write").at(0)).toEqual(expect.objectContaining({
      accountId: "account_viewer_editor", enterpriseId: "ent_customer", storeId: "store_customer", operation: "create", outcome: "success", expectedVersion: null, resultingVersion: 1
    }));
  });

  it("replaces existing metadata at its current version and returns the incremented public value", async () => {
    const accessToken = await login("viewer_editor");
    await database.query(`INSERT INTO provider_customer_metadata
      (enterprise_id, store_id, customer_alias, provider_note, version, updated_by_account_id, updated_at)
      VALUES ('ent_customer', 'store_customer', 'Previous', 'Previous note', 1, 'account_viewer_editor', $1)`, [now]);

    const response = await app.inject({
      method: "PUT", url: "/v1/provider-customers/ent_customer/store_customer/metadata",
      headers: { ...marker, ...bearer(accessToken) },
      payload: { customerAlias: "Updated", providerNote: "Updated note", expectedVersion: 1 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ metadata: {
      customerAlias: "Updated", providerNote: "Updated note", version: 2, updatedAt: now.toISOString()
    } });
    expect(logs.filter((entry) => entry.event === "provider_customer_metadata_write").at(0)).toEqual(expect.objectContaining({
      operation: "replace", expectedVersion: 1, resultingVersion: 2, outcome: "success"
    }));
  });

  it("redacts an injected metadata infrastructure failure behind the neutral 500 response", async () => {
    const accessToken = await login("viewer_editor");
    vi.spyOn(ProviderCustomerMetadataRepository.prototype, "scopeExists").mockRejectedValue(
      new Error("database unavailable sentinel-alias sentinel-private-note")
    );

    const response = await app.inject({
      method: "PUT", url: "/v1/provider-customers/ent_customer/store_customer/metadata",
      headers: { ...marker, ...bearer(accessToken) },
      payload: { customerAlias: "sentinel-alias", providerNote: "sentinel-private-note", expectedVersion: null }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Provider customer metadata is unavailable" });
    expect(response.body).not.toMatch(/sentinel-alias|sentinel-private-note|database unavailable/i);
    expect(JSON.stringify(auditLogs(logs))).not.toMatch(/sentinel-alias|sentinel-private-note|database unavailable/i);
  });

  it("does not register provider customer routes in explicit development context", async () => {
    const development = buildServer({ database, developmentMode: true });
    const response = await development.inject({ method: "GET", url: "/v1/provider-customers" });
    expect(response.statusCode).toBe(404);
  });

  async function login(loginName: string): Promise<string> {
    const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName, password: "passphrase" } });
    return response.json<{ accessToken: string }>().accessToken;
  }

  async function seedConfirmedScope() {
    await database.query("INSERT INTO import_batches (id, enterprise_id, store_id, actor_id, source_type, original_file_name, original_file_checksum, status, created_at, confirmed_at) VALUES ('batch_customer', 'ent_customer', 'store_customer', 'actor', 'csv', 'safe.csv', 'safe', 'confirmed', $1, $2)", [now, now]);
    await database.query("INSERT INTO fact_versions (id, enterprise_id, store_id, source_batch_id, confirmation_actor_id, confirmation_status, confirmed_at) VALUES ('version_customer', 'ent_customer', 'store_customer', 'batch_customer', 'actor', 'confirmed', $1)", [now]);
  }
});

function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }
function captureInfoLogs(logs: Record<string, unknown>[]) { return { level: "info", stream: { write(message: string) { logs.push(JSON.parse(message) as Record<string, unknown>); } } }; }
function auditLogs(logs: Record<string, unknown>[]) { return logs.filter((entry) => typeof entry.event === "string"); }
async function applyTestMigrations(database: Database): Promise<void> {
  const migrationsUrl = new URL("../migrations/", import.meta.url);
  const files = (await readdir(migrationsUrl)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationsUrl), "utf8");
    await database.query(sql.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
  }
}
