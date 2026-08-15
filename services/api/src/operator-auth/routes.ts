import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database } from "../db.js";
import { clearSessionCookie, OperatorAuthRepository, readSessionCookie, sessionCookie } from "./repository.js";

declare module "fastify" {
  interface FastifyRequest { operatorSession?: Awaited<ReturnType<OperatorAuthRepository["authenticateSession"]>>; }
}

export interface OperatorAuthRouteOptions { publicOrigin?: string }

export function registerOperatorAuthRoutes(app: FastifyInstance, database: Database, options: OperatorAuthRouteOptions = {}): void {
  const repository = new OperatorAuthRepository(database, sessionTtl());
  const publicOrigin = parsePublicOrigin(options.publicOrigin);
  app.decorateRequest("operatorSession", undefined);
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/operator-content/")) return;
    const session = await repository.authenticateSession(readSessionCookie(request.headers.cookie));
    if (!session || (isStateChange(request.method) && (!isSameOrigin(request, publicOrigin) || request.headers["x-csrf-token"] !== session.csrfToken))) return reply.code(403).send({ error: "Forbidden" });
    request.operatorSession = session;
  });

  app.post("/v1/operator-auth/login", async (request, reply) => {
    const body = request.body;
    if (!isSameOrigin(request, publicOrigin) || !isCredentials(body) || !(await repository.verifyPassword(body.accountId, body.password))) return reply.code(403).send({ error: "Forbidden" });
    const created = await repository.createSession(body.accountId);
    reply.header("set-cookie", sessionCookie(created.cookieValue, created.session.expiresAt));
    return { csrfToken: created.session.csrfToken, capabilities: { operatorAdmin: true } };
  });
  app.get("/v1/operator-auth/session", async (request, reply) => {
    const session = await repository.authenticateSession(readSessionCookie(request.headers.cookie));
    if (!session) return reply.code(403).send({ error: "Forbidden" });
    return { csrfToken: session.csrfToken, capabilities: { operatorAdmin: true }, expiresAt: session.expiresAt.toISOString() };
  });
  app.post("/v1/operator-auth/logout", async (request, reply) => {
    const session = await repository.authenticateSession(readSessionCookie(request.headers.cookie));
    if (!session || !isSameOrigin(request, publicOrigin) || request.headers["x-csrf-token"] !== session.csrfToken) return reply.code(403).send({ error: "Forbidden" });
    await repository.revokeSession(readSessionCookie(request.headers.cookie));
    reply.header("set-cookie", clearSessionCookie());
    return reply.code(204).send();
  });
}

function isCredentials(value: unknown): value is { accountId: string; password: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as Record<string, unknown>).accountId === "string" && typeof (value as Record<string, unknown>).password === "string";
}
function isStateChange(method: string): boolean { return !["GET", "HEAD", "OPTIONS"].includes(method); }
function isSameOrigin(request: FastifyRequest, publicOrigin: string | undefined): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== "string") return false;
  try {
    const parsed = new URL(origin);
    return parsed.origin === (publicOrigin ?? `${request.protocol}://${request.headers.host}`);
  } catch { return false; }
}
function parsePublicOrigin(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || value !== url.origin) throw new Error();
    return url.origin;
  } catch {
    throw new Error("OPERATOR_PUBLIC_ORIGIN must be an exact HTTPS origin");
  }
}
function sessionTtl(): number { const value = Number(process.env.OPERATOR_SESSION_TTL_SECONDS ?? 8 * 60 * 60); return Number.isSafeInteger(value) && value >= 300 && value <= 86_400 ? value * 1000 : 8 * 60 * 60 * 1000; }
