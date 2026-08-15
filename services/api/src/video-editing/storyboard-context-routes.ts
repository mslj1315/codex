import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database } from "../db.js";
import { ForbiddenError } from "../imports/repository.js";
import type { TrustedContext } from "../imports/service.js";
import { StoryboardContextRepository } from "./storyboard-context-repository.js";

export async function registerStoryboardContextRoutes(app: FastifyInstance, database: Database, resolve: (request: FastifyRequest) => Promise<TrustedContext | undefined>) {
  const contexts = new StoryboardContextRepository(database);
  app.addHook("onRequest", async (request, reply) => {
    const context = await resolve(request);
    if (!context) return reply.code(403).send({ error: "No trusted request context" });
    if (context.actorRole !== undefined) return reply.code(403).send({ error: "Storyboard contexts are available only to customer actors" });
    request.trustedContext = context;
  });
  app.get("/v1/stores/:storeId/storyboard-contexts", async request => {
    const context = request.trustedContext;
    const storeId = String((request.params as Record<string, unknown>).storeId ?? "");
    if (!context || context.storeId !== storeId) throw new ForbiddenError("Store is outside trusted request context");
    return { contexts: await contexts.list(context) };
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ForbiddenError) return reply.code(403).send({ error: error.message });
    return reply.code(500).send({ error: "Internal server error" });
  });
}
