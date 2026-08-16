import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "../auth/credentials.js";
import type { StoreRole } from "../auth/repository.js";
import type { Database, Queryable } from "../db.js";
import { sanitizeInternalAuditMetadata } from "./rbac.js";

export interface CustomerAccountView {
  id: string;
  loginName: string;
  displayName: string;
  enterpriseId: string;
  storeId: string;
  storeRole: StoreRole;
  enabled: boolean;
  passwordChangeRequired: boolean;
}

export class CustomerAccountRepository {
  constructor(private readonly database: Database) {}

  async create(input: { mobile: string; displayName: string; enterpriseId: string; storeId: string; storeRole: StoreRole; actorId: string; temporaryPassword: string }): Promise<CustomerAccountView> {
    try { return await this.transaction(async (client) => {
      const duplicate = await client.query("SELECT 1 FROM accounts WHERE login_name = $1 FOR UPDATE", [input.mobile]);
      if (duplicate.rowCount) throw new CustomerAccountConflictError();
      const id = randomUUID();
      await client.query(
        "INSERT INTO accounts (id, login_name, display_name, password_hash, password_change_required) VALUES ($1, $2, $3, $4, true)",
        [id, input.mobile, input.displayName, await hashPassword(input.temporaryPassword)]
      );
      await client.query(
        "INSERT INTO store_memberships (account_id, enterprise_id, store_id, role) VALUES ($1, $2, $3, $4)",
        [id, input.enterpriseId, input.storeId, input.storeRole]
      );
      await writeAudit(client, input.actorId, "customer_account.created", "customer_account", id, { accountStatus: "enabled", operation: "create" });
      return { id, loginName: input.mobile, displayName: input.displayName, enterpriseId: input.enterpriseId, storeId: input.storeId, storeRole: input.storeRole, enabled: true, passwordChangeRequired: true };
    }); } catch (error) {
      if (isUniqueViolation(error)) throw new CustomerAccountConflictError();
      throw error;
    }
  }

  async resetPassword(input: { accountId: string; actorId: string; temporaryPassword: string }): Promise<CustomerAccountView | undefined> {
    return this.transaction(async (client) => {
      const found = await client.query<Row>("SELECT id, login_name, display_name, enabled FROM accounts WHERE id = $1 FOR UPDATE", [input.accountId]);
      if (found.rowCount !== 1 || !Boolean(found.rows[0]!.enabled)) return undefined;
      const membership = await client.query<Row>("SELECT enterprise_id, store_id, role FROM store_memberships WHERE account_id = $1 AND enabled = true ORDER BY enterprise_id, store_id LIMIT 1", [input.accountId]);
      if (membership.rowCount !== 1) return undefined;
      const row = { ...found.rows[0]!, ...membership.rows[0]! };
      await client.query("UPDATE accounts SET password_hash = $1, password_change_required = true, credential_version = credential_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [await hashPassword(input.temporaryPassword), input.accountId]);
      await client.query("UPDATE account_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE account_id = $1 AND revoked_at IS NULL", [input.accountId]);
      await writeAudit(client, input.actorId, "customer_account.password_reset", "customer_account", input.accountId, { operation: "reset_password" });
      return view(row, true);
    });
  }

  async list(limit: number): Promise<CustomerAccountView[]> {
    const result = await this.database.query<Row>(
      `SELECT account.id, account.login_name, account.display_name, account.enabled, account.password_change_required,
              membership.enterprise_id, membership.store_id, membership.role
       FROM accounts AS account JOIN store_memberships AS membership ON membership.account_id = account.id
       WHERE membership.enabled = true ORDER BY account.created_at DESC, account.id ASC LIMIT $1`, [limit]
    );
    return result.rows.map((row) => view(row, Boolean(row.password_change_required)));
  }

  private async transaction<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await this.database.connect();
    try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}

export function normalizeChineseMobile(value: unknown): string {
  if (typeof value !== "string") throw new CustomerAccountValidationError();
  const compact = value.trim().replace(/[\s-]/g, "").replace(/^\+?86/, "");
  if (!/^1[3-9]\d{9}$/.test(compact)) throw new CustomerAccountValidationError();
  return compact;
}

export function temporaryPassword(): string { return randomBytes(18).toString("base64url"); }

export class CustomerAccountValidationError extends Error {}
export class CustomerAccountConflictError extends Error {}
type Row = Record<string, unknown>;

function isUniqueViolation(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505"; }

function view(row: Row, passwordChangeRequired: boolean): CustomerAccountView {
  return { id: String(row.id), loginName: String(row.login_name), displayName: String(row.display_name), enterpriseId: String(row.enterprise_id), storeId: String(row.store_id), storeRole: String(row.role) as StoreRole, enabled: Boolean(row.enabled), passwordChangeRequired };
}

async function writeAudit(database: Queryable, actorId: string, actionCode: string, targetType: string, targetId: string, metadata: Record<string, unknown>) {
  await database.query(
    "INSERT INTO internal_audit_events (id, actor_account_id, action_code, target_type, target_id, succeeded, metadata_json) VALUES ($1, $2, $3, $4, $5, true, $6)",
    [randomUUID(), actorId, actionCode, targetType, targetId, JSON.stringify(sanitizeInternalAuditMetadata(metadata))]
  );
}
