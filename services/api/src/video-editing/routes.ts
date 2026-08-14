import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database } from "../db.js";
import { ForbiddenError } from "../imports/repository.js";
import type { TrustedContext } from "../imports/service.js";
import { AssetError, AssetRepository } from "./asset-repository.js";
import type { VideoStorage } from "./storage.js";

export async function registerVideoAssetRoutes(app: FastifyInstance, database: Database, resolve: (request: FastifyRequest) => Promise<TrustedContext | undefined>, storage: VideoStorage) {
  const assets = new AssetRepository(database, storage);
  app.addHook("onRequest", async (request, reply) => { const context = await resolve(request); if (!context) return reply.code(403).send({ error: "No trusted request context" }); request.trustedContext = context; });
  const scope = (request: FastifyRequest) => {
    const context = request.trustedContext; const storeId = String((request.params as Record<string, unknown>).storeId ?? "");
    if (!context || context.storeId !== storeId) throw new ForbiddenError("Store is outside trusted request context");
    if (context.actorRole !== undefined) throw new ForbiddenError("Storyboard media is available only to customer actors");
    return context;
  };
  const ids = (request: FastifyRequest) => { const params = request.params as Record<string, unknown>; return { taskId: String(params.taskId ?? ""), shotListId: String(params.shotListId ?? ""), assetId: String(params.assetId ?? "") }; };
  app.post("/v1/stores/:storeId/content-tasks/:taskId/shot-lists/:shotListId/assets/upload-grants", async (request, reply) => {
    const body = record(request.body); const result = await assets.createUploadGrant(scope(request), { ...ids(request), expectedSizeBytes: body.expectedSizeBytes as number, contentType: String(body.contentType ?? "") });
    return reply.code(201).send(result);
  });
  app.post("/v1/stores/:storeId/content-tasks/:taskId/shot-lists/:shotListId/assets/:assetId/complete", async (request, reply) => reply.code(201).send(await assets.acceptUploadedAsset(scope(request), ids(request))));
  app.delete("/v1/stores/:storeId/content-tasks/:taskId/shot-lists/:shotListId/assets/:assetId", async (request, reply) => { await assets.deleteAsset(scope(request), ids(request)); return reply.code(204).send(); });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ForbiddenError) return reply.code(403).send({ error: error.message });
    if (error instanceof AssetError) return reply.code(error.status).send({ error: error.message });
    return reply.code(500).send({ error: "Internal server error" });
  });
}
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new AssetError("Request body must be an object", 422); return value as Record<string, unknown>; }
