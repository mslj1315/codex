import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database } from "../db.js";
import { ProfileConflictError, ProfileNotFoundError, ProfileRepository, ProfileValidationError, type ContentProfileInput, type OperatingStageInput } from "./profile-repository.js";
import { ForbiddenError } from "../imports/repository.js";
import type { TrustedContext } from "../imports/service.js";

export async function registerProfileRoutes(app: FastifyInstance, database: Database, contextResolver: (request: FastifyRequest) => Promise<TrustedContext | undefined>): Promise<void> {
  const repository = new ProfileRepository(database);
  app.addHook("onRequest", async (request, reply) => {
    const context = await contextResolver(request);
    if (!context) return reply.code(403).send({ error: "No trusted request context" });
    request.trustedContext = context;
  });
  app.get("/v1/stores/:storeId/content-profile", async (request) => repository.getCurrentProfile(scope(request)));
  app.post("/v1/stores/:storeId/content-profile", async (request, reply) => reply.code(201).send(await repository.saveProfile(scope(request), contentProfileBody(request.body))));
  app.put("/v1/stores/:storeId/content-profile", async (request) => repository.saveProfile(scope(request), contentProfileBody(request.body)));
  app.get("/v1/stores/:storeId/operating-stages", async (request) => repository.listStages(scope(request)));
  app.post("/v1/stores/:storeId/operating-stages", async (request, reply) => reply.code(201).send(await repository.createStage(scope(request), request.body as OperatingStageInput)));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProfileNotFoundError) return reply.code(404).send({ error: error.message });
    if (error instanceof ForbiddenError) return reply.code(403).send({ error: error.message });
    if (error instanceof ProfileConflictError) return reply.code(409).send({ error: error.message });
    if (error instanceof ProfileValidationError) return reply.code(422).send({ error: error.message });
    return reply.code(500).send({ error: "Internal server error" });
  });
}

function scope(request: FastifyRequest): TrustedContext {
  const storeId = String((request.params as Record<string, unknown>).storeId ?? "");
  const context = request.trustedContext;
  if (!context || context.storeId !== storeId) throw new ForbiddenError("Store is outside trusted request context");
  return context;
}

function contentProfileBody(value: unknown): ContentProfileInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ProfileValidationError("Request body must be an object");
  return value as ContentProfileInput;
}
