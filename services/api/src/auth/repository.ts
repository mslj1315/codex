import type { Database, Queryable } from "../db.js";
import { randomUUID } from "node:crypto";

export type StoreRole = "owner" | "operator";
export type ServiceOperatorRole =
  | "metric_catalog_operator"
  | "provider_feedback_viewer"
  | "provider_customer_metadata_editor"
  | "model_pricing_operator";

export interface AuthAccount {
  id: string;
  loginName: string;
  displayName: string;
  passwordHash: string;
  enabled: boolean;
  passwordChangeRequired: boolean;
  credentialVersion: number;
}

export interface StoreMembership {
  enterpriseId: string;
  storeId: string;
  role: StoreRole;
}

interface SessionAccount extends AuthAccount {
  sessionId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  sessionCredentialVersion: number;
}

export class AuthRepository {
  constructor(private readonly database: Database) {}

  async findAccountByLoginName(loginName: string): Promise<AuthAccount | undefined> {
    const result = await this.database.query<Row>(
      "SELECT id, login_name, display_name, password_hash, enabled, password_change_required, credential_version FROM accounts WHERE login_name = $1",
      [loginName]
    );
    return result.rowCount === 1 ? account(result.rows[0]) : undefined;
  }

  async createSession(input: { id: string; accountId: string; credentialVersion: number; refreshTokenHash: string; expiresAt: Date }): Promise<void> {
    await this.database.query(
      "INSERT INTO account_sessions (id, account_id, credential_version, refresh_token_hash, expires_at) VALUES ($1, $2, $3, $4, $5)",
      [input.id, input.accountId, input.credentialVersion, input.refreshTokenHash, input.expiresAt]
    );
  }

  async rotateSession(input: { refreshTokenHash: string; nextSessionId: string; nextRefreshTokenHash: string; nextExpiresAt: Date; now: Date }): Promise<AuthAccount | undefined> {
    return this.transaction(async (client) => {
      const current = await readSessionByRefreshToken(client, input.refreshTokenHash, "FOR UPDATE");
      if (!current || !isActive(current, input.now)) return undefined;
      await client.query("UPDATE account_sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL", [input.now, current.sessionId]);
      await client.query(
        "INSERT INTO account_sessions (id, account_id, credential_version, refresh_token_hash, expires_at) VALUES ($1, $2, $3, $4, $5)",
        [input.nextSessionId, current.id, current.credentialVersion, input.nextRefreshTokenHash, input.nextExpiresAt]
      );
      return publicAccount(current);
    });
  }

  async findActiveSession(accountId: string, sessionId: string, now: Date): Promise<AuthAccount | undefined> {
    const current = await readSessionById(this.database, accountId, sessionId);
    return current && isActive(current, now) ? publicAccount(current) : undefined;
  }

  async revokeSession(accountId: string, sessionId: string, now: Date): Promise<boolean> {
    const result = await this.database.query(
      "UPDATE account_sessions SET revoked_at = $1 WHERE id = $2 AND account_id = $3 AND revoked_at IS NULL",
      [now, sessionId, accountId]
    );
    return result.rowCount === 1;
  }

  async findEnabledMembership(accountId: string, storeId: string): Promise<StoreMembership | undefined> {
    const result = await this.database.query<Row>(
      `SELECT enterprise_id, store_id, role FROM store_memberships
       WHERE account_id = $1 AND store_id = $2 AND enabled = true`,
      [accountId, storeId]
    );
    return result.rowCount === 1 ? membership(result.rows[0]) : undefined;
  }

  async listEnabledMemberships(accountId: string): Promise<StoreMembership[]> {
    const result = await this.database.query<Row>(
      `SELECT enterprise_id, store_id, role FROM store_memberships
       WHERE account_id = $1 AND enabled = true ORDER BY enterprise_id, store_id`,
      [accountId]
    );
    return result.rows.map(membership);
  }

  async hasEnabledServiceOperatorRole(accountId: string, role: ServiceOperatorRole): Promise<boolean> {
    const result = await this.database.query(
      "SELECT 1 FROM service_operator_roles WHERE account_id = $1 AND role = $2 AND enabled = true",
      [accountId, role]
    );
    return result.rowCount === 1;
  }

  async listEnabledServiceOperatorRoles(accountId: string): Promise<ServiceOperatorRole[]> {
    const result = await this.database.query<Row>(
      "SELECT role FROM service_operator_roles WHERE account_id = $1 AND enabled = true ORDER BY role",
      [accountId]
    );
    return result.rows.map((row) => row.role as ServiceOperatorRole);
  }

  async changePassword(input: { accountId: string; currentPasswordHash: string; nextPasswordHash: string }): Promise<boolean> {
    return this.transaction(async (client) => {
      const updated = await client.query(
        `UPDATE accounts SET password_hash = $1, password_change_required = false, credential_version = credential_version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND password_hash = $3 AND enabled = true`,
        [input.nextPasswordHash, input.accountId, input.currentPasswordHash]
      );
      if (updated.rowCount !== 1) return false;
      await client.query("UPDATE account_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE account_id = $1 AND revoked_at IS NULL", [input.accountId]);
      return true;
    });
  }

  async upgradeLegacyPasswordHash(accountId: string, legacyHash: string, bcryptHash: string): Promise<void> {
    await this.database.query(
      "UPDATE accounts SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND password_hash = $3",
      [bcryptHash, accountId, legacyHash]
    );
  }

  databaseConnection(): Database {
    return this.database;
  }

  async grantServiceOperatorRole(accountId: string, role: ServiceOperatorRole): Promise<boolean> {
    return this.transaction(async (client) => {
      const account = await client.query(
        "SELECT id FROM accounts WHERE id = $1 AND enabled = true FOR UPDATE",
        [accountId]
      );
      if (account.rowCount !== 1) return false;
      await client.query(
        `INSERT INTO service_operator_roles (account_id, role, enabled)
         VALUES ($1, $2, true)
         ON CONFLICT (account_id, role)
         DO UPDATE SET enabled = true, updated_at = CURRENT_TIMESTAMP`,
        [accountId, role]
      );
      return true;
    });
  }

  async provision(input: {
    loginName: string;
    displayName: string;
    passwordHash: string;
    enterpriseId: string;
    storeId: string;
    storeRole: StoreRole;
    serviceOperatorRole?: ServiceOperatorRole;
  }): Promise<{ accountId: string; membershipGranted: boolean; serviceOperatorRoleGranted: boolean }> {
    return this.transaction(async (client) => {
      const existing = await client.query<Row>("SELECT id FROM accounts WHERE login_name = $1 FOR UPDATE", [input.loginName]);
      const accountId = existing.rowCount === 1 ? String(existing.rows[0].id) : randomUUID();
      if (existing.rowCount === 1) {
        await client.query(
          "UPDATE accounts SET display_name = $1, password_hash = $2, enabled = true, credential_version = credential_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
          [input.displayName, input.passwordHash, accountId]
        );
        await client.query("UPDATE account_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE account_id = $1 AND revoked_at IS NULL", [accountId]);
      } else {
        await client.query(
          "INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ($1, $2, $3, $4)",
          [accountId, input.loginName, input.displayName, input.passwordHash]
        );
      }
      await client.query(
        `INSERT INTO store_memberships (account_id, enterprise_id, store_id, role, enabled)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (account_id, enterprise_id, store_id) DO UPDATE SET role = EXCLUDED.role, enabled = true, updated_at = CURRENT_TIMESTAMP`,
        [accountId, input.enterpriseId, input.storeId, input.storeRole]
      );
      if (input.serviceOperatorRole) {
        await client.query(
          `INSERT INTO service_operator_roles (account_id, role, enabled) VALUES ($1, $2, true)
           ON CONFLICT (account_id, role) DO UPDATE SET enabled = true, updated_at = CURRENT_TIMESTAMP`,
          [accountId, input.serviceOperatorRole]
        );
      }
      return { accountId, membershipGranted: true, serviceOperatorRoleGranted: input.serviceOperatorRole !== undefined };
    });
  }

  private async transaction<T>(operation: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

type Row = Record<string, unknown>;

async function readSessionByRefreshToken(database: Queryable, refreshTokenHash: string, lock = ""): Promise<SessionAccount | undefined> {
  const result = await database.query<Row>(
    `SELECT session.id AS session_id, session.expires_at, session.revoked_at,
            account.id, account.login_name, account.display_name, account.password_hash, account.enabled, account.password_change_required, account.credential_version, session.credential_version AS session_credential_version
     FROM account_sessions AS session JOIN accounts AS account ON account.id = session.account_id
     WHERE session.refresh_token_hash = $1 ${lock}`,
    [refreshTokenHash]
  );
  return result.rowCount === 1 ? sessionAccount(result.rows[0]) : undefined;
}

async function readSessionById(database: Queryable, accountId: string, sessionId: string): Promise<SessionAccount | undefined> {
  const result = await database.query<Row>(
    `SELECT session.id AS session_id, session.expires_at, session.revoked_at,
            account.id, account.login_name, account.display_name, account.password_hash, account.enabled, account.password_change_required, account.credential_version, session.credential_version AS session_credential_version
     FROM account_sessions AS session JOIN accounts AS account ON account.id = session.account_id
     WHERE session.id = $1 AND session.account_id = $2`,
    [sessionId, accountId]
  );
  return result.rowCount === 1 ? sessionAccount(result.rows[0]) : undefined;
}

function isActive(value: SessionAccount, now: Date): boolean {
  return value.enabled && value.revokedAt === null && value.expiresAt.getTime() > now.getTime() && value.credentialVersion === value.sessionCredentialVersion;
}

function account(row: Row): AuthAccount {
  return {
    id: String(row.id), loginName: String(row.login_name), displayName: String(row.display_name),
    passwordHash: String(row.password_hash), enabled: Boolean(row.enabled), passwordChangeRequired: Boolean(row.password_change_required), credentialVersion: Number(row.credential_version)
  };
}

function publicAccount(value: AuthAccount): AuthAccount {
  return {
    id: value.id,
    loginName: value.loginName,
    displayName: value.displayName,
    passwordHash: value.passwordHash,
    enabled: value.enabled, passwordChangeRequired: value.passwordChangeRequired, credentialVersion: value.credentialVersion
  };
}

function sessionAccount(row: Row): SessionAccount {
  return {
    ...account(row), sessionId: String(row.session_id), expiresAt: new Date(String(row.expires_at)),
    revokedAt: row.revoked_at == null ? null : new Date(String(row.revoked_at)), sessionCredentialVersion: Number(row.session_credential_version)
  };
}

function membership(row: Row): StoreMembership {
  return { enterpriseId: String(row.enterprise_id), storeId: String(row.store_id), role: row.role as StoreRole };
}
