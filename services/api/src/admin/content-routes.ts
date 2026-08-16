import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthenticationError } from "../auth/tokens.js";
import { AuthorizationError, AuthService } from "../auth/service.js";
import type { Database } from "../db.js";
import { RuleRepository, type RuleInput } from "../operator-content/rule-repository.js";
import { OperatorContentConflictError, OperatorContentValidationError, TemplateRepository, type TemplateInput } from "../operator-content/template-repository.js";

/** Internal bearer-only facade over immutable versioned operational content. */
export function registerAdminContentRoutes(app: FastifyInstance, auth: AuthService, database: Database): void {
  const templates = new TemplateRepository(database); const rules = new RuleRepository(database);
  app.get("/v1/admin/content/templates", (request, reply) => run(request, reply, "content_templates.read", () => templates.listLogicalItems()));
  app.post("/v1/admin/content/templates", (request, reply) => run(request, reply, "content_templates.edit", actor => templates.createLogicalItem(template(request.body), actor.id), 201));
  app.put("/v1/admin/content/templates/:id/draft", (request, reply) => run(request, reply, "content_templates.edit", actor => templates.saveDraft(id(request), template(request.body), actor.id)));
  app.post("/v1/admin/content/templates/:id/versions/:version/publish", (request, reply) => run(request, reply, "content_templates.publish", actor => templates.publishDraft(id(request), version(request), actor.id)));
  app.get("/v1/admin/content/rules", (request, reply) => run(request, reply, "review_rules.read", () => rules.listLogicalItems()));
  app.post("/v1/admin/content/rules", (request, reply) => run(request, reply, "review_rules.edit", actor => rules.createLogicalItem(rule(request.body), actor.id), 201));
  app.put("/v1/admin/content/rules/:id/draft", (request, reply) => run(request, reply, "review_rules.edit", actor => rules.saveDraft(id(request), rule(request.body), actor.id)));
  app.post("/v1/admin/content/rules/:id/versions/:version/publish", (request, reply) => run(request, reply, "review_rules.publish", actor => rules.publishDraft(id(request), version(request), actor.id)));
  async function run(request: FastifyRequest, reply: { code(status: number): { send(value: unknown): unknown } }, permission: "content_templates.read" | "content_templates.edit" | "content_templates.publish" | "review_rules.read" | "review_rules.edit" | "review_rules.publish", work: (actor: { id: string }) => Promise<unknown>, created = 200) {
    try { const value = await auth.requireInternalPermission(bearer(request), permission, work); return created === 201 ? reply.code(201).send(value) : value; }
    catch (error) { if (error instanceof AuthenticationError) return reply.code(401).send({ error: "Authentication required" }); if (error instanceof AuthorizationError) return reply.code(403).send({ error: "Forbidden" }); if (error instanceof OperatorContentValidationError) return reply.code(400).send({ error: "Invalid content operation" }); if (error instanceof OperatorContentConflictError) return reply.code(409).send({ error: "Content version transition is invalid" }); throw error; }
  }
}
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new OperatorContentValidationError("Invalid content operation"); return value as Record<string, unknown>; }
function template(value: unknown): TemplateInput { return record(value) as unknown as TemplateInput; }
function rule(value: unknown): RuleInput { return record(value) as unknown as RuleInput; }
function id(request: FastifyRequest): string { const value = record(request.params).id; if (typeof value !== "string" || !value) throw new OperatorContentValidationError("Invalid content operation"); return value; }
function version(request: FastifyRequest): number { const value = Number(record(request.params).version); if (!Number.isInteger(value) || value < 1) throw new OperatorContentValidationError("Invalid content operation"); return value; }
function bearer(request: FastifyRequest): string { const found = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.authorization ?? ""); if (!found) throw new AuthenticationError("Authentication required"); return found[1]!; }
