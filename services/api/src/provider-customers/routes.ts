import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthorizationError, type AuthService } from "../auth/service.js";
import { AuthenticationError } from "../auth/tokens.js";
import type { Database } from "../db.js";
import { ValidationError } from "../imports/repository.js";
import { ProviderFeedbackRepository } from "../provider-feedback/repository.js";
import { parseProviderFeedbackQuery, ProviderFeedbackService } from "../provider-feedback/service.js";
import { ProviderCustomerMetadataRepository } from "./repository.js";
import {
  parseMetadataReplacement,
  parseProviderCustomerScope,
  ProviderCustomerMetadataConflictError,
  ProviderCustomerNotFoundError,
  ProviderCustomerService
} from "./service.js";

const requiredRoles = ["provider_feedback_viewer", "provider_customer_metadata_editor"] as const;

export async function registerProviderCustomerRoutes(app: FastifyInstance, options: { auth: AuthService; database: Database; now: () => Date }): Promise<void> {
  const feedback = new ProviderFeedbackService(new ProviderFeedbackRepository(options.database), options.now);
  const service = new ProviderCustomerService(feedback, new ProviderCustomerMetadataRepository(options.database), options.now);

  app.get("/v1/provider-customers", async (request, reply) => {
    let accountId: string | undefined;
    let limit: number | null = null;
    let returnedCount = 0;
    let outcome = "error";
    const query = request.query as Record<string, unknown>;
    try {
      const token = bearerToken(request);
      if (!token) throw new AuthenticationError("Authentication required");
      const account = await options.auth.requireServiceOperatorRole(token, "provider_feedback_viewer");
      accountId = account.id;
      const parsed = parseProviderFeedbackQuery(query);
      limit = parsed.limit;
      const result = await service.list(parsed);
      returnedCount = result.items.length;
      outcome = "success";
      return result;
    } catch (error) {
      if (error instanceof AuthenticationError) { outcome = "authentication_required"; return reply.code(401).send({ error: "Authentication required" }); }
      if (error instanceof AuthorizationError) { outcome = "forbidden"; return reply.code(403).send({ error: "Provider customer metadata access is required" }); }
      if (error instanceof ValidationError) { outcome = "invalid_query"; return reply.code(422).send({ error: error.message }); }
      outcome = "unavailable";
      return reply.code(500).send({ error: "Provider customer metadata is unavailable" });
    } finally {
      try {
        request.log.info({
          event: "provider_customer_list_access", requestId: request.id, accountId,
          role: "provider_feedback_viewer", activityFilterApplied: query.activityState !== undefined,
          readinessFilterApplied: query.readinessState !== undefined, limit, outcome, returnedCount
        }, "Provider customer list accessed");
      } catch {}
    }
  });

  app.put("/v1/provider-customers/:enterpriseId/:storeId/metadata", async (request, reply) => {
    let accountId: string | undefined;
    let enterpriseId: string | undefined;
    let storeId: string | undefined;
    let operation: "create" | "replace" | "clear" | undefined;
    let expectedVersion: number | null | undefined;
    let resultingVersion: number | undefined;
    let outcome = "error";
    try {
      if (!hasProviderMarker(request)) throw new AuthorizationError("Provider console request is required");
      const token = bearerToken(request);
      if (!token) throw new AuthenticationError("Authentication required");
      const account = await options.auth.requireServiceOperatorRoles(token, requiredRoles);
      accountId = account.id;
      const scope = parseProviderCustomerScope(request.params);
      enterpriseId = scope.enterpriseId;
      storeId = scope.storeId;
      const replacement = parseMetadataReplacement(request.body);
      expectedVersion = replacement.expectedVersion;
      operation = replacement.customerAlias === null && replacement.providerNote === null
        ? "clear"
        : replacement.expectedVersion === null ? "create" : "replace";
      const result = await service.replace(scope, replacement, account.id);
      resultingVersion = result.metadata?.version;
      outcome = "success";
      return result;
    } catch (error) {
      if (error instanceof AuthenticationError) { outcome = "authentication_required"; return reply.code(401).send({ error: "Authentication required" }); }
      if (error instanceof AuthorizationError) { outcome = "forbidden"; return reply.code(403).send({ error: "Provider customer metadata access is required" }); }
      if (error instanceof ValidationError) { outcome = "invalid_request"; return reply.code(422).send({ error: error.message }); }
      if (error instanceof ProviderCustomerNotFoundError) { outcome = "not_available"; return reply.code(404).send({ error: "Provider customer is not available" }); }
      if (error instanceof ProviderCustomerMetadataConflictError) { outcome = "conflict"; return reply.code(409).send({ error: "Provider customer metadata has changed" }); }
      outcome = "unavailable";
      return reply.code(500).send({ error: "Provider customer metadata is unavailable" });
    } finally {
      try {
        request.log.info({
          event: "provider_customer_metadata_write", requestId: request.id, accountId, enterpriseId, storeId,
          operation, expectedVersion, resultingVersion, outcome, requiredRoles
        }, "Provider customer metadata written");
      } catch {}
    }
  });
}

function hasProviderMarker(request: FastifyRequest): boolean { return request.headers["x-provider-console-request"] === "1"; }
function bearerToken(request: FastifyRequest): string | undefined {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.authorization ?? "");
  return match?.[1];
}
