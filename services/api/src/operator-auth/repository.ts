import { createHash, randomBytes, randomUUID } from "node:crypto";
import { compare, hash } from "bcryptjs";
import type { Queryable } from "../db.js";

export const OPERATOR_SESSION_COOKIE = "operator_session";
export const OPERATOR_ADMIN_ROLE = "operator_admin" as const;
export interface OperatorSession {
  accountId: string;
  role: typeof OPERATOR_ADMIN_ROLE;
  csrfToken: string;
  expiresAt: Date;
}

type Row = Record<string, unknown>;

export class OperatorAuthRepository {
  constructor(private readonly database: Queryable, private readonly sessionTtlMs = 8 * 60 * 60 * 1000) {}

  async verifyPassword(accountId: string, password: string): Promise<boolean> {
    const result = await this.database.query<Row>("SELECT password_hash, enabled, role FROM operator_accounts WHERE account_id=$1", [accountId]);
    if (result.rowCount !== 1 || result.rows[0].enabled !== true || result.rows[0].role !== OPERATOR_ADMIN_ROLE) return false;
    return compare(password, String(result.rows[0].password_hash));
  }

  async createSession(accountId: string, now = new Date()): Promise<{ cookieValue: string; session: OperatorSession }> {
    const cookieValue = randomToken();
    const csrfToken = randomToken();
    const expiresAt = new Date(now.getTime() + this.sessionTtlMs);
    await this.database.query("UPDATE operator_sessions SET revoked_at=$1 WHERE account_id=$2 AND revoked_at IS NULL AND expires_at <= $1", [now, accountId]);
    await this.database.query(
      "INSERT INTO operator_sessions (id, account_id, secret_hash, csrf_secret, expires_at) VALUES ($1,$2,$3,$4,$5)",
      [randomUUID(), accountId, sha256(cookieValue), csrfToken, expiresAt]
    );
    await this.audit(accountId, "session_created");
    return { cookieValue, session: { accountId, role: OPERATOR_ADMIN_ROLE, csrfToken, expiresAt } };
  }

  async authenticateSession(cookieValue: string | undefined, now = new Date()): Promise<OperatorSession | undefined> {
    if (!cookieValue) return undefined;
    const result = await this.database.query<Row>(
      `SELECT sessions.account_id, sessions.csrf_secret, sessions.expires_at, accounts.role
       FROM operator_sessions sessions JOIN operator_accounts accounts ON accounts.account_id=sessions.account_id
       WHERE sessions.secret_hash=$1 AND sessions.revoked_at IS NULL AND sessions.expires_at > $2 AND accounts.enabled=TRUE`,
      [sha256(cookieValue), now]
    );
    if (result.rowCount !== 1 || result.rows[0].role !== OPERATOR_ADMIN_ROLE) return undefined;
    const row = result.rows[0];
    return { accountId: String(row.account_id), role: OPERATOR_ADMIN_ROLE, csrfToken: String(row.csrf_secret), expiresAt: new Date(String(row.expires_at)) };
  }

  async revokeSession(cookieValue: string | undefined): Promise<void> {
    if (!cookieValue) return;
    const result = await this.database.query<Row>("UPDATE operator_sessions SET revoked_at=now() WHERE secret_hash=$1 AND revoked_at IS NULL RETURNING account_id", [sha256(cookieValue)]);
    if (result.rowCount === 1) await this.audit(String(result.rows[0].account_id), "session_revoked");
  }

  async provision(accountId: string, password: string, workFactor: number): Promise<boolean> {
    const passwordHash = await hash(password, workFactor);
    const result = await this.database.query<Row>(
      "INSERT INTO operator_accounts (account_id, password_hash, role) VALUES ($1,$2,$3) ON CONFLICT (account_id) DO NOTHING RETURNING account_id",
      [accountId, passwordHash, OPERATOR_ADMIN_ROLE]
    );
    if (result.rowCount !== 1) return false;
    await this.audit(accountId, "account_provisioned");
    return true;
  }

  private audit(accountId: string, eventType: "account_provisioned" | "session_created" | "session_revoked"): Promise<unknown> {
    return this.database.query("INSERT INTO operator_auth_audit_events (id, account_id, event_type) VALUES ($1,$2,$3)", [randomUUID(), accountId, eventType]);
  }
}

export function sessionCookie(value: string, expiresAt: Date): string {
  return `${OPERATOR_SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Expires=${expiresAt.toUTCString()}`;
}

export function clearSessionCookie(): string {
  return `${OPERATOR_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${OPERATOR_SESSION_COOKIE}=`));
  if (!match) return undefined;
  try { return decodeURIComponent(match.slice(OPERATOR_SESSION_COOKIE.length + 1)); } catch { return undefined; }
}

function randomToken(): string { return randomBytes(32).toString("base64url"); }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
