import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database } from "../db.js";
import { AuthorizationError, type AuthService } from "../auth/service.js";
import { AuthenticationError } from "../auth/tokens.js";
import { ValidationError } from "../imports/repository.js";
import { ProviderFeedbackRepository } from "./repository.js";
import { parseProviderFeedbackQuery, ProviderFeedbackService } from "./service.js";

export async function registerProviderFeedbackRoutes(app: FastifyInstance, options: { auth: AuthService; database: Database; now: () => Date }): Promise<void> {
  const service = new ProviderFeedbackService(new ProviderFeedbackRepository(options.database), options.now);
  app.get("/v1/provider-feedback/stores", async (request, reply) => {
    let accountId: string | undefined; let limit: number | null = null; let returnedCount = 0; let outcome = "error";
    const query = request.query as Record<string, unknown>;
    try {
      const token = bearerToken(request);
      if (!token) throw new AuthenticationError("Authentication required");
      const account = await options.auth.requireServiceOperatorRole(token, "provider_feedback_viewer");
      accountId = account.id;
      const parsed = parseProviderFeedbackQuery(query); limit = parsed.limit;
      const result = await service.list(parsed); returnedCount = result.items.length; outcome = "success";
      return result;
    } catch (error) {
      if (error instanceof AuthenticationError) { outcome = "authentication_required"; return reply.code(401).send({ error: "Authentication required" }); }
      if (error instanceof AuthorizationError) { outcome = "forbidden"; return reply.code(403).send({ error: "Provider feedback access is required" }); }
      if (error instanceof ValidationError) { outcome = "invalid_query"; return reply.code(422).send({ error: error.message }); }
      throw error;
    } finally {
      try { request.log.info({ event: "provider_feedback_access", requestId: request.id, accountId, role: "provider_feedback_viewer", activityFilterApplied: query.activityState !== undefined, readinessFilterApplied: query.readinessState !== undefined, limit, outcome, returnedCount }, "Provider feedback accessed"); } catch {}
    }
  });
}
function bearerToken(request: FastifyRequest): string | undefined { const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.authorization ?? ""); return match?.[1]; }
