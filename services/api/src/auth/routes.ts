import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthService } from "./service.js";
import { AuthenticationError } from "./tokens.js";

export async function registerAuthRoutes(app: FastifyInstance, service: AuthService): Promise<void> {
  app.post("/v1/auth/login", async (request, reply) => {
    try {
      const body = record(request.body);
      return await service.login({ loginName: stringValue(body.loginName), password: stringValue(body.password) });
    } catch (error) {
      return authenticationFailure(error, reply);
    }
  });

  app.post("/v1/auth/refresh", async (request, reply) => {
    try {
      const body = record(request.body);
      return await service.refresh({ refreshToken: stringValue(body.refreshToken) });
    } catch (error) {
      return authenticationFailure(error, reply);
    }
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    try {
      await service.logout(requireBearer(request));
      return reply.code(204).send();
    } catch (error) {
      return authenticationFailure(error, reply);
    }
  });

  app.get("/v1/auth/me/stores", async (request, reply) => {
    try {
      return { stores: await service.listStores(requireBearer(request)) };
    } catch (error) {
      return authenticationFailure(error, reply);
    }
  });
}

function authenticationFailure(error: unknown, reply: { code(statusCode: number): { send(value: unknown): unknown } }) {
  if (error instanceof AuthenticationError) return reply.code(401).send({ error: "Authentication required" });
  throw error;
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
  const value = request.headers.authorization;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(value ?? "");
  if (!match) throw new AuthenticationError("Authentication required");
  return match[1]!;
}
