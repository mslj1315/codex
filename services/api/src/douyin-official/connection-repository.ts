import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../db.js";

export const DOUYIN_CONNECTION_TYPES = ["content_account", "life_service_store"] as const;
export type DouyinConnectionType = (typeof DOUYIN_CONNECTION_TYPES)[number];
export const DOUYIN_CONNECTION_STATES = ["active", "reauthorization_required", "disconnected"] as const;
export type DouyinConnectionState = (typeof DOUYIN_CONNECTION_STATES)[number];

export interface DouyinConnectionScope { enterpriseId: string; storeId: string; }
export interface UpsertDouyinConnection extends DouyinConnectionScope {
  connectionType: DouyinConnectionType;
  officialSubjectId: string;
  capabilities: string[];
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string;
  expiresAt: Date;
}
export interface DouyinConnection extends DouyinConnectionScope {
  id: string;
  connectionType: DouyinConnectionType;
  officialSubjectId: string;
  capabilities: string[];
  state: DouyinConnectionState;
  expiresAt: Date;
  version: number;
  diagnosticCategory: string | null;
  lastSuccessAt: Date | null;
}
export interface DouyinConnectionCredentials extends DouyinConnection {
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string;
}
export interface CreateOAuthState extends DouyinConnectionScope {
  state: string;
  connectionType: DouyinConnectionType;
  redirectPath: string;
  expiresAt: Date;
  nonce?: string;
}
export interface OAuthStateScope extends DouyinConnectionScope { state: string; }
export interface ConsumedOAuthState { connectionType: DouyinConnectionType; redirectPath: string; nonce: string; }
type Row = Record<string, unknown>;

export class DouyinConnectionRepository {
  constructor(private readonly database: Database, private readonly now: () => Date = () => new Date()) {}

  async upsertConnection(input: UpsertDouyinConnection): Promise<DouyinConnection> {
    validateConnection(input);
    const result = await this.database.query<Row>(`INSERT INTO douyin_data_connections
      (id, enterprise_id, store_id, connection_type, official_subject_id, capabilities_json, access_token_ciphertext, refresh_token_ciphertext, expires_at, state)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')
      ON CONFLICT (enterprise_id, store_id, connection_type) DO UPDATE SET
        official_subject_id = EXCLUDED.official_subject_id, capabilities_json = EXCLUDED.capabilities_json,
        access_token_ciphertext = EXCLUDED.access_token_ciphertext, refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
        expires_at = EXCLUDED.expires_at, state = 'active', diagnostic_category = NULL,
        version = douyin_data_connections.version + 1, updated_at = CURRENT_TIMESTAMP
      RETURNING *`, [randomUUID(), input.enterpriseId, input.storeId, input.connectionType, input.officialSubjectId,
      JSON.stringify(input.capabilities), input.accessTokenCiphertext, input.refreshTokenCiphertext, input.expiresAt]);
    return toConnection(result.rows[0]);
  }

  async listConnections(scope: DouyinConnectionScope): Promise<DouyinConnection[]> {
    const result = await this.database.query<Row>(`SELECT id, enterprise_id, store_id, connection_type, official_subject_id,
      capabilities_json, state, expires_at, version, diagnostic_category, last_success_at
      FROM douyin_data_connections WHERE enterprise_id = $1 AND store_id = $2 ORDER BY connection_type`, [scope.enterpriseId, scope.storeId]);
    return result.rows.map(toConnection);
  }

  async getConnectionCredentials(scope: DouyinConnectionScope & { connectionType: DouyinConnectionType }): Promise<DouyinConnectionCredentials | null> {
    const result = await this.database.query<Row>(`SELECT * FROM douyin_data_connections
      WHERE enterprise_id = $1 AND store_id = $2 AND connection_type = $3`, [scope.enterpriseId, scope.storeId, scope.connectionType]);
    return result.rows[0] ? toConnectionCredentials(result.rows[0]) : null;
  }

  async createOAuthState(input: CreateOAuthState): Promise<void> {
    validateOAuthState(input, this.now());
    await this.database.query(`INSERT INTO douyin_oauth_states
      (id, state_hash, enterprise_id, store_id, connection_type, redirect_path, nonce, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [randomUUID(), hashState(input.state), input.enterpriseId, input.storeId,
      input.connectionType, input.redirectPath, input.nonce ?? randomUUID(), input.expiresAt]);
  }

  async consumeOAuthState(input: OAuthStateScope): Promise<ConsumedOAuthState | null> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const consumedAt = this.now();
      const result = await client.query<Row>(`UPDATE douyin_oauth_states SET consumed_at = $4
        WHERE state_hash = $1 AND enterprise_id = $2 AND store_id = $3
          AND consumed_at IS NULL AND expires_at > $4
        RETURNING connection_type, redirect_path, nonce`, [hashState(input.state), input.enterpriseId, input.storeId, consumedAt]);
      await client.query("COMMIT");
      return result.rows[0] ? { connectionType: asConnectionType(result.rows[0].connection_type), redirectPath: String(result.rows[0].redirect_path), nonce: String(result.rows[0].nonce) } : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function hashState(state: string): string { return createHash("sha256").update(state).digest("hex"); }
function validateConnection(input: UpsertDouyinConnection): void {
  required(input.enterpriseId, "enterpriseId"); required(input.storeId, "storeId"); required(input.officialSubjectId, "officialSubjectId");
  required(input.accessTokenCiphertext, "accessTokenCiphertext"); required(input.refreshTokenCiphertext, "refreshTokenCiphertext");
  if (!DOUYIN_CONNECTION_TYPES.includes(input.connectionType)) throw new Error("connectionType is invalid");
  if (!Array.isArray(input.capabilities) || input.capabilities.some((capability) => typeof capability !== "string" || !capability.trim())) throw new Error("capabilities must be strings");
  if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.valueOf())) throw new Error("expiresAt is invalid");
}
function validateOAuthState(input: CreateOAuthState, now: Date): void {
  required(input.state, "state"); required(input.enterpriseId, "enterpriseId"); required(input.storeId, "storeId"); required(input.redirectPath, "redirectPath");
  if (!DOUYIN_CONNECTION_TYPES.includes(input.connectionType)) throw new Error("connectionType is invalid");
  if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.valueOf())) throw new Error("expiresAt is invalid");
  const lifetimeMs = input.expiresAt.valueOf() - now.valueOf();
  if (lifetimeMs <= 0) throw new Error("expiresAt must be in the future");
  if (lifetimeMs > 10 * 60 * 1000) throw new Error("expiresAt must be within 10 minutes");
  if (!isInternalRedirectPath(input.redirectPath)) throw new Error("redirectPath must be an internal path");
}
function isInternalRedirectPath(value: string): boolean {
  return /^\/(?!\/)[^\\\x00-\x1F\x7F]*$/.test(value) && !/%(?:2f|5c)/i.test(value);
}
function required(value: string, name: string): void { if (!value?.trim()) throw new Error(`${name} is required`); }
function asConnectionType(value: unknown): DouyinConnectionType { if (!DOUYIN_CONNECTION_TYPES.includes(value as DouyinConnectionType)) throw new Error("invalid stored connection type"); return value as DouyinConnectionType; }
function asConnectionState(value: unknown): DouyinConnectionState { if (!DOUYIN_CONNECTION_STATES.includes(value as DouyinConnectionState)) throw new Error("invalid stored connection state"); return value as DouyinConnectionState; }
function toConnection(row: Row): DouyinConnection { return { id: String(row.id), enterpriseId: String(row.enterprise_id), storeId: String(row.store_id), connectionType: asConnectionType(row.connection_type), officialSubjectId: String(row.official_subject_id), capabilities: JSON.parse(String(row.capabilities_json)), state: asConnectionState(row.state), expiresAt: new Date(String(row.expires_at)), version: Number(row.version), diagnosticCategory: row.diagnostic_category == null ? null : String(row.diagnostic_category), lastSuccessAt: row.last_success_at == null ? null : new Date(String(row.last_success_at)) }; }
function toConnectionCredentials(row: Row): DouyinConnectionCredentials { return { ...toConnection(row), accessTokenCiphertext: String(row.access_token_ciphertext), refreshTokenCiphertext: String(row.refresh_token_ciphertext) }; }
