import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthenticationError } from "../auth/tokens.js";
import { AuthorizationError, AuthService } from "../auth/service.js";
import type { Database } from "../db.js";
import { CustomerAccountConflictError, CustomerAccountRepository, CustomerAccountValidationError, normalizeChineseMobile, temporaryPassword } from "./customer-accounts.js";

export async function registerCustomerAccountAdminRoutes(app: FastifyInstance, auth: AuthService, database: Database): Promise<void> {
  const accounts = new CustomerAccountRepository(database);
  app.get("/v1/admin/customer-accounts", async (request, reply) => {
    try {
      const limit = Math.min(100, Math.max(1, Number((request.query as Record<string, unknown>).limit ?? 50)));
      if (!Number.isInteger(limit)) throw new CustomerAccountValidationError();
      return { items: await auth.requireInternalPermission(requireBearer(request), "customer_accounts.read", () => accounts.list(limit)) };
    } catch (error) { return failure(error, reply); }
  });
  app.post("/v1/admin/customer-accounts", async (request, reply) => {
    try {
      const body = object(request.body);
      const password = temporaryPassword();
      const account = await auth.requireInternalPermission(requireBearer(request), "customer_accounts.create", (actor) => accounts.create({
        mobile: normalizeChineseMobile(body.mobile), displayName: displayName(body.displayName), enterpriseId: identifier(body.enterpriseId), storeId: identifier(body.storeId), storeRole: storeRole(body.storeRole), actorId: actor.id, temporaryPassword: password
      }));
      return reply.code(201).send({ account, temporaryPassword: password });
    } catch (error) { return failure(error, reply); }
  });
  app.post("/v1/admin/customer-accounts/:accountId/reset-password", async (request, reply) => {
    try {
      const password = temporaryPassword();
      const params = object(request.params);
      const account = await auth.requireInternalPermission(requireBearer(request), "customer_accounts.reset_password", (actor) => accounts.resetPassword({ accountId: identifier(params.accountId), actorId: actor.id, temporaryPassword: password }));
      if (!account) return reply.code(404).send({ error: "Customer account not found" });
      return { account, temporaryPassword: password };
    } catch (error) { return failure(error, reply); }
  });
  app.post("/v1/admin/customer-accounts/:accountId/disable", async (request, reply) => {
    try {
      const params = object(request.params);
      const account = await auth.requireInternalPermission(requireBearer(request), "customer_accounts.disable", (actor) => accounts.disable({ accountId: identifier(params.accountId), actorId: actor.id }));
      if (!account) return reply.code(404).send({ error: "Customer account not found or already disabled" });
      return { account };
    } catch (error) { return failure(error, reply); }
  });
}

function failure(error: unknown, reply: { code(statusCode: number): { send(value: unknown): unknown } }) {
  if (error instanceof AuthenticationError) return reply.code(401).send({ error: "Authentication required" });
  if (error instanceof AuthorizationError) return reply.code(403).send({ error: "Forbidden" });
  if (error instanceof CustomerAccountConflictError) return reply.code(409).send({ error: "Customer mobile already exists" });
  if (error instanceof CustomerAccountValidationError) return reply.code(400).send({ error: "Invalid customer account input" });
  throw error;
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new CustomerAccountValidationError(); return value as Record<string, unknown>; }
function displayName(value: unknown): string { if (typeof value !== "string" || !value.trim() || value.trim().length > 100) throw new CustomerAccountValidationError(); return value.trim(); }
function identifier(value: unknown): string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new CustomerAccountValidationError(); return value; }
function storeRole(value: unknown): "owner" | "operator" { if (value === "owner" || value === "operator") return value; throw new CustomerAccountValidationError(); }
function requireBearer(request: FastifyRequest): string { const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.authorization ?? ""); if (!match) throw new AuthenticationError("Authentication required"); return match[1]!; }
