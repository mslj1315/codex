import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ACCESS_TOKEN_VERSION = 1;
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

export class AuthenticationError extends Error {}

export interface AccessTokenIdentity {
  accountId: string;
  sessionId: string;
}

interface AccessTokenPayload {
  v: number;
  sub: string;
  sid: string;
  iat: number;
  exp: number;
  jti: string;
}

export function issueAccessToken(identity: AccessTokenIdentity, secret: string, now: Date): string {
  const payload: AccessTokenPayload = {
    v: ACCESS_TOKEN_VERSION,
    sub: identity.accountId,
    sid: identity.sessionId,
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor((now.getTime() + ACCESS_TOKEN_TTL_MS) / 1000),
    jti: randomBytes(16).toString("base64url")
  };
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "ROT1" })).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${encodedPayload}.${sign(`${header}.${encodedPayload}`, secret)}`;
}

export function parseAccessToken(token: string, secret: string, now: Date): AccessTokenIdentity {
  const [header, encodedPayload, signature, extra] = token.split(".");
  if (!header || !encodedPayload || !signature || extra !== undefined) throw new AuthenticationError("Authentication required");
  const expected = sign(`${header}.${encodedPayload}`, secret);
  if (!constantTimeEqual(signature, expected)) throw new AuthenticationError("Authentication required");

  let payload: AccessTokenPayload;
  try {
    const decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<AccessTokenPayload>;
    if (decoded.v !== ACCESS_TOKEN_VERSION || typeof decoded.sub !== "string" || !decoded.sub || typeof decoded.sid !== "string" || !decoded.sid || typeof decoded.iat !== "number" || typeof decoded.exp !== "number" || typeof decoded.jti !== "string" || !decoded.jti) throw new Error("Invalid payload");
    payload = decoded as AccessTokenPayload;
  } catch {
    throw new AuthenticationError("Authentication required");
  }
  if (payload.iat > payload.exp || Math.floor(now.getTime() / 1000) >= payload.exp) throw new AuthenticationError("Authentication required");
  return { accountId: payload.sub, sessionId: payload.sid };
}

export function createRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
