import type { Database, Queryable } from "../db.js";

export type StoreRole = "owner" | "operator";

export interface AuthAccount {
  id: string;
  loginName: string;
  displayName: string;
  passwordHash: string;
  enabled: boolean;
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
}

export class AuthRepository {
  constructor(private readonly database: Database) {}

  async findAccountByLoginName(loginName: string): Promise<AuthAccount | undefined> {
    const result = await this.database.query<Row>(
      "SELECT id, login_name, display_name, password_hash, enabled FROM accounts WHERE login_name = $1",
      [loginName]
    );
    return result.rowCount === 1 ? account(result.rows[0]) : undefined;
  }

  async createSession(input: { id: string; accountId: string; refreshTokenHash: string; expiresAt: Date }): Promise<void> {
    await this.database.query(
      "INSERT INTO account_sessions (id, account_id, refresh_token_hash, expires_at) VALUES ($1, $2, $3, $4)",
      [input.id, input.accountId, input.refreshTokenHash, input.expiresAt]
    );
  }

  async rotateSession(input: { refreshTokenHash: string; nextSessionId: string; nextRefreshTokenHash: string; nextExpiresAt: Date; now: Date }): Promise<AuthAccount | undefined> {
    return this.transaction(async (client) => {
      const current = await readSessionByRefreshToken(client, input.refreshTokenHash, "FOR UPDATE");
      if (!current || !isActive(current, input.now)) return undefined;
      await client.query("UPDATE account_sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL", [input.now, current.sessionId]);
      await client.query(
        "INSERT INTO account_sessions (id, account_id, refresh_token_hash, expires_at) VALUES ($1, $2, $3, $4)",
        [input.nextSessionId, current.id, input.nextRefreshTokenHash, input.nextExpiresAt]
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
            account.id, account.login_name, account.display_name, account.password_hash, account.enabled
     FROM account_sessions AS session JOIN accounts AS account ON account.id = session.account_id
     WHERE session.refresh_token_hash = $1 ${lock}`,
    [refreshTokenHash]
  );
  return result.rowCount === 1 ? sessionAccount(result.rows[0]) : undefined;
}

async function readSessionById(database: Queryable, accountId: string, sessionId: string): Promise<SessionAccount | undefined> {
  const result = await database.query<Row>(
    `SELECT session.id AS session_id, session.expires_at, session.revoked_at,
            account.id, account.login_name, account.display_name, account.password_hash, account.enabled
     FROM account_sessions AS session JOIN accounts AS account ON account.id = session.account_id
     WHERE session.id = $1 AND session.account_id = $2`,
    [sessionId, accountId]
  );
  return result.rowCount === 1 ? sessionAccount(result.rows[0]) : undefined;
}

function isActive(value: SessionAccount, now: Date): boolean {
  return value.enabled && value.revokedAt === null && value.expiresAt.getTime() > now.getTime();
}

function account(row: Row): AuthAccount {
  return {
    id: String(row.id), loginName: String(row.login_name), displayName: String(row.display_name),
    passwordHash: String(row.password_hash), enabled: Boolean(row.enabled)
  };
}

function publicAccount(value: AuthAccount): AuthAccount {
  return {
    id: value.id,
    loginName: value.loginName,
    displayName: value.displayName,
    passwordHash: value.passwordHash,
    enabled: value.enabled
  };
}

function sessionAccount(row: Row): SessionAccount {
  return {
    ...account(row), sessionId: String(row.session_id), expiresAt: new Date(String(row.expires_at)),
    revokedAt: row.revoked_at == null ? null : new Date(String(row.revoked_at))
  };
}

function membership(row: Row): StoreMembership {
  return { enterpriseId: String(row.enterprise_id), storeId: String(row.store_id), role: row.role as StoreRole };
}
