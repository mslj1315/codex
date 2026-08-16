import { readdir, readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import { hashPassword } from "../src/auth/credentials.js";
import { ModelConfigurationRepository, ModelConfigurationUnavailableError } from "../src/admin/model-configs.js";
import { buildServer } from "../src/server.js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

describe("admin model configurations", () => {
  let database: Database;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    const memory = newDb();
    memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
    const { Pool } = memory.adapters.createPg();
    database = new Pool();
    await applyMigrations(database);
    await database.query("INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ('super', 'super', 'Super', $1), ('customer', '13800138000', 'Customer', $1)", [await hashPassword("passphrase")]);
    await database.query("INSERT INTO internal_account_roles (account_id, role_id) VALUES ('super', 'internal-role-super-admin')");
    await database.query("INSERT INTO store_memberships (account_id, enterprise_id, store_id, role) VALUES ('customer', 'ent_demo', 'store_demo', 'owner')");
    app = buildServer({ database, authTokenSecret: "a sufficiently long test signing secret", modelConfigEncryptionKey: encryptionKey });
  });

  it("stores API keys encrypted and never exposes plaintext or ciphertext in configuration reads", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/admin/model-configs", headers: await superBearer(app), payload: {
      label: "GPT", provider: "openai_responses", model: "gpt-test", baseUrl: "https://gateway.example/v1", apiKey: "sk-top-secret", enabled: true, makeDefault: true
    } });
    expect(response.statusCode).toBe(201);
    const id = response.json<{ id: string; apiKeySuffix: string }>().id;
    expect(response.body).not.toContain("sk-top-secret");
    const stored = await database.query("SELECT api_key_ciphertext FROM model_configurations WHERE id=$1", [id]);
    expect(String(stored.rows[0]!.api_key_ciphertext)).not.toContain("sk-top-secret");
    const read = await app.inject({ method: "GET", url: `/v1/admin/model-configs/${id}`, headers: await superBearer(app) });
    expect(read.statusCode).toBe(200);
    expect(read.body).not.toMatch(/sk-top-secret|ciphertext|nonce|tag/i);
    expect(read.json()).toMatchObject({ id, label: "GPT", provider: "openai_responses", baseUrl: "https://gateway.example/v1", apiKeySuffix: "cret" });
  });

  it("uses a customer override before the default and rejects a disabled selection", async () => {
    const repository = new ModelConfigurationRepository(database, encryptionKey);
    const defaultConfig = await repository.create({ label: "Default", provider: "deepseek", model: "default-model", baseUrl: "https://default.example/v1", apiKey: "key-default", enabled: true, makeDefault: true, actorId: "super" });
    const override = await repository.create({ label: "Override", provider: "qwen", model: "override-model", baseUrl: "https://override.example/v1", apiKey: "key-override", enabled: true, makeDefault: false, actorId: "super" });
    await repository.assignCustomer({ enterpriseId: "ent_demo", storeId: "store_demo", configurationId: override.id, actorId: "super" });
    await expect(repository.resolveForCustomer({ enterpriseId: "ent_demo", storeId: "store_demo" })).resolves.toMatchObject({ id: override.id, model: "override-model", apiKey: "key-override" });
    await repository.setEnabled({ id: override.id, enabled: false, actorId: "super" });
    await expect(repository.resolveForCustomer({ enterpriseId: "ent_demo", storeId: "store_demo" })).rejects.toBeInstanceOf(ModelConfigurationUnavailableError);
    await expect(repository.resolveForCustomer({ enterpriseId: "ent_other", storeId: "store_other" })).resolves.toMatchObject({ id: defaultConfig.id, model: "default-model" });
  });

  it("requires model configuration permission before configuration lookup or customer assignment", async () => {
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName: "13800138000", password: "passphrase" } });
    const response = await app.inject({ method: "GET", url: "/v1/admin/model-configs", headers: bearer(login.json<{ accessToken: string }>().accessToken) });
    expect(response.statusCode).toBe(403);
    expect((await database.query("SELECT id FROM model_configurations")).rowCount).toBe(0);
  });

  it("rejects insecure model base URLs and audits key rotation without sensitive data", async () => {
    const invalid = await app.inject({ method: "POST", url: "/v1/admin/model-configs", headers: await superBearer(app), payload: { label: "bad", provider: "deepseek", model: "m", baseUrl: "http://insecure.example", apiKey: "secret", enabled: true } });
    expect(invalid.statusCode).toBe(400);
    const created = await app.inject({ method: "POST", url: "/v1/admin/model-configs", headers: await superBearer(app), payload: { label: "good", provider: "deepseek", model: "m", baseUrl: "https://safe.example/v1", apiKey: "old-secret", enabled: true } });
    const id = created.json<{ id: string }>().id;
    const updated = await app.inject({ method: "PUT", url: `/v1/admin/model-configs/${id}`, headers: await superBearer(app), payload: { label: "renamed", provider: "deepseek", model: "new-model", baseUrl: "https://safe.example/v2" } });
    expect(updated.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/v1/admin/model-configs/${id}`, headers: await superBearer(app) })).json()).toMatchObject({ label: "renamed", model: "new-model", baseUrl: "https://safe.example/v2" });
    const rotated = await app.inject({ method: "POST", url: `/v1/admin/model-configs/${id}/rotate-key`, headers: await superBearer(app), payload: { apiKey: "new-secret" } });
    expect(rotated.statusCode).toBe(204);
    const audit = JSON.stringify((await database.query("SELECT action_code,metadata_json FROM internal_audit_events WHERE target_id=$1", [id])).rows);
    expect(audit).toContain("model_configuration.key_rotated");
    expect(audit).not.toMatch(/old-secret|new-secret|ciphertext|nonce/i);
  });

  it("rejects creating a disabled default configuration", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/admin/model-configs", headers: await superBearer(app), payload: {
      label: "Invalid default", provider: "deepseek", model: "m", baseUrl: "https://safe.example/v1", apiKey: "secret", enabled: false, makeDefault: true
    } });
    expect(response.statusCode).toBe(400);
    expect((await database.query("SELECT id FROM model_configurations")).rowCount).toBe(0);
  });

  it("rejects disabling the current default configuration", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/admin/model-configs", headers: await superBearer(app), payload: {
      label: "Default", provider: "qwen", model: "m", baseUrl: "https://safe.example/v1", apiKey: "secret", enabled: true, makeDefault: true
    } });
    const id = created.json<{ id: string }>().id;
    const response = await app.inject({ method: "POST", url: `/v1/admin/model-configs/${id}/enabled`, headers: await superBearer(app), payload: { enabled: false } });
    expect(response.statusCode).toBe(422);
    expect((await database.query("SELECT enabled,is_default FROM model_configurations WHERE id=$1", [id])).rows[0]).toMatchObject({ enabled: true, is_default: true });
  });
});

async function superBearer(app: ReturnType<typeof buildServer>) { const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { loginName: "super", password: "passphrase" } }); return bearer(login.json<{ accessToken: string }>().accessToken); }
function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }
async function applyMigrations(database: Database) { const url = new URL("../migrations/", import.meta.url); for (const file of (await readdir(url)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()) { const sql = await readFile(new URL(file, url), "utf8"); await database.query(sql.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, "")); } }
