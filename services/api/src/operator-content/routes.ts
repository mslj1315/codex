import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database } from "../db.js";
import type { TrustedContext } from "../imports/service.js";
import { RuleRepository } from "./rule-repository.js";
import { OperatorContentConflictError, OperatorContentValidationError, TemplateRepository, type TemplateInput } from "./template-repository.js";
class OperatorContentForbiddenError extends Error {}

export async function registerOperatorContentRoutes(app: FastifyInstance, database: Database, contextResolver: (request: FastifyRequest) => Promise<TrustedContext | undefined>): Promise<void> {
  const templates = new TemplateRepository(database); const rules = new RuleRepository(database);
  app.addHook("onRequest", async (request, reply) => { const context = await contextResolver(request); if (!context || !isOperator(context)) return reply.code(403).send({ error: "Forbidden" }); request.trustedContext = context; });
  app.post("/v1/operator-content/templates", async (request, reply) => reply.code(201).send(await templates.create(templateBody(request.body), actor(request))));
  app.get("/v1/operator-content/templates", async () => templates.list());
  app.put("/v1/operator-content/templates/:id", async (request) => requireEditor(request, () => templates.update(param(request, "id"), templateBody(request.body))));
  app.post("/v1/operator-content/templates/:id/submit", async (request) => requireEditor(request, () => templates.submit(param(request, "id"))));
  app.post("/v1/operator-content/templates/:id/publish", async (request) => requireReviewer(request, () => templates.publish(param(request, "id"), actor(request))));
  app.post("/v1/operator-content/templates/:id/return", async (request) => requireReviewer(request, () => templates.return(param(request, "id"), actor(request), reason(request.body))));
  app.post("/v1/operator-content/templates/:id/disable", async (request) => requireReviewer(request, () => templates.disable(param(request, "id"), actor(request))));
  app.get("/v1/operator-content/templates/match", async (request) => templates.match(queryStrings(request)));
  app.post("/v1/operator-content/rules", async (request, reply) => reply.code(201).send(await rules.create(ruleBody(request.body), actor(request))));
  app.get("/v1/operator-content/rules/active", async () => rules.listActive());
  app.post("/v1/operator-content/rules/:id/submit", async (request) => requireEditor(request, () => rules.submit(param(request, "id"))));
  app.post("/v1/operator-content/rules/:id/publish", async (request) => requireReviewer(request, () => rules.publish(param(request, "id"), actor(request))));
  app.post("/v1/operator-content/rules/:id/return", async (request) => requireReviewer(request, () => rules.return(param(request, "id"), actor(request), reason(request.body))));
  app.post("/v1/operator-content/rules/:id/disable", async (request) => requireReviewer(request, () => rules.disable(param(request, "id"), actor(request))));
  app.setErrorHandler((error, _request, reply) => { if (error instanceof OperatorContentForbiddenError) return reply.code(403).send({ error: "Forbidden" }); if (error instanceof OperatorContentValidationError) return reply.code(422).send({ error: error.message }); if (error instanceof OperatorContentConflictError) return reply.code(409).send({ error: error.message }); return reply.code(500).send({ error: "Internal server error" }); });
}
function isOperator(context: TrustedContext): boolean { return context.actorRole === "operator_editor" || context.actorRole === "operator_reviewer"; }
function actor(request: FastifyRequest): string { return request.trustedContext!.actorId; }
function requireEditor<T>(request: FastifyRequest, callback: () => Promise<T>): Promise<T> { if (request.trustedContext?.actorRole !== "operator_editor") throw new OperatorContentForbiddenError(); return callback(); }
function requireReviewer<T>(request: FastifyRequest, callback: () => Promise<T>): Promise<T> { if (request.trustedContext?.actorRole !== "operator_reviewer") throw new OperatorContentForbiddenError(); return callback(); }
function param(request: FastifyRequest, key: string): string { const value = (request.params as Record<string, unknown>)[key]; if (typeof value !== "string" || !value) throw new OperatorContentValidationError(`Missing ${key}`); return value; }
function templateBody(value: unknown): TemplateInput { if (!record(value)) throw new OperatorContentValidationError("Request body must be an object"); return value as unknown as TemplateInput; }
function ruleBody(value: unknown): { name: string; ruleType: string; severity: "block" | "high" | "warning" | "notice"; patterns: string[] } { if (!record(value)) throw new OperatorContentValidationError("Request body must be an object"); return value as never; }
function reason(value: unknown): string { if (!record(value) || typeof value.reason !== "string") throw new OperatorContentValidationError("return reason is required"); return value.reason; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function queryStrings(request: FastifyRequest): Record<string, string> { return Object.fromEntries(Object.entries(request.query as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string")); }
