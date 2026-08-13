import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthenticationError } from "./tokens.js";
import type { AuthService, ProviderCapabilities } from "./service.js";
import { clearProviderRefreshCookie, readProviderRefreshCookie, serializeProviderRefreshCookie } from "./cookies.js";

export async function registerProviderBrowserAuthRoutes(
  app: FastifyInstance,
  service: AuthService,
  options: { developmentMode: boolean }
): Promise<void> {
  app.post("/v1/provider-auth/login", async (request, reply) => {
    if (!hasProviderMarker(request)) return forbidden(reply);
    try {
      const body = record(request.body);
      const tokens = await service.login({ loginName: stringValue(body.loginName), password: stringValue(body.password) });
      return browserSession(tokens, await service.providerSession(tokens.accessToken), reply, options.developmentMode);
    } catch (error) { return authenticationFailure(error, reply); }
  });

  app.post("/v1/provider-auth/refresh", async (request, reply) => {
    if (!hasProviderMarker(request)) return forbidden(reply);
    try {
      const refreshToken = readProviderRefreshCookie(request.headers.cookie);
      if (!refreshToken) throw new AuthenticationError("Authentication required");
      const tokens = await service.refresh({ refreshToken });
      return browserSession(tokens, await service.providerSession(tokens.accessToken), reply, options.developmentMode);
    } catch (error) {
      reply.header("set-cookie", clearProviderRefreshCookie(options.developmentMode));
      return authenticationFailure(error, reply);
    }
  });

  app.post("/v1/provider-auth/logout", async (request, reply) => {
    if (!hasProviderMarker(request)) return forbidden(reply);
    reply.header("set-cookie", clearProviderRefreshCookie(options.developmentMode));
    try {
      await service.logout(requireBearer(request));
      return reply.code(204).send();
    } catch (error) { return authenticationFailure(error, reply); }
  });
}

function browserSession(
  tokens: { accessToken: string; refreshToken: string; expiresAt: string },
  session: { account: { id: string; displayName: string }; capabilities: ProviderCapabilities },
  reply: { header(name: string, value: string): unknown },
  developmentMode: boolean
) {
  reply.header("set-cookie", serializeProviderRefreshCookie(tokens.refreshToken, developmentMode));
  return { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt, account: session.account, capabilities: session.capabilities };
}

function hasProviderMarker(request: FastifyRequest): boolean { return request.headers["x-provider-console-request"] === "1"; }
function forbidden(reply: { code(statusCode: number): { send(value: unknown): unknown } }) { return reply.code(403).send({ error: "Forbidden" }); }
function authenticationFailure(error: unknown, reply: { code(statusCode: number): { send(value: unknown): unknown } }) {
  if (error instanceof AuthenticationError) return reply.code(401).send({ error: "Authentication required" });
  return reply.code(500).send({ error: "Provider authentication is unavailable" });
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AuthenticationError("Authentication required");
  return value as Record<string, unknown>;
}
function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new AuthenticationError("Authentication required");
  return value;
}
function requireBearer(request: FastifyRequest): string {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.authorization ?? "");
  if (!match) throw new AuthenticationError("Authentication required");
  return match[1]!;
}
