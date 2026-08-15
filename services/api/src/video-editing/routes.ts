import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database } from "../db.js";
import { ForbiddenError } from "../imports/repository.js";
import type { TrustedContext } from "../imports/service.js";
import { AssetError, AssetRepository } from "./asset-repository.js";
import { ProjectError, ProjectRepository } from "./project-repository.js";
import { RenderError, RenderRepository } from "./render-repository.js";
import { RenderService } from "./render-service.js";
import type { ProtectedRenderStorage, VideoStorage } from "./storage.js";

export async function registerVideoAssetRoutes(app: FastifyInstance, database: Database, resolve: (request: FastifyRequest) => Promise<TrustedContext | undefined>, storage: VideoStorage) {
  const assets = new AssetRepository(database, storage);
  const projects = new ProjectRepository(database);
  const renders = new RenderService(new RenderRepository(database), isProtected(storage) ? storage : undefined);
  app.addHook("onRequest", async (request, reply) => { const context = await resolve(request); if (!context) return reply.code(403).send({ error: "No trusted request context" }); if (request.url.includes("/projects/") && request.url.includes("/renders")) { if (context.actorRole !== undefined) return reply.code(403).send({ error: "Storyboard media is available only to customer actors" }); const params = request.params as Record<string, unknown>; const owner = await database.query<{ actor_id: string }>("SELECT actor_id FROM content_tasks WHERE id=$1 AND enterprise_id=$2 AND store_id=$3", [String(params.taskId ?? ""), context.enterpriseId, context.storeId]); if (!owner.rowCount || owner.rows[0].actor_id !== context.actorId) return reply.code(403).send({ error: "Content task is outside trusted customer context" }); } request.trustedContext = context; });
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
  app.post("/v1/stores/:storeId/content-tasks/:taskId/shot-lists/:shotListId/projects", async (request, reply) => {
    const { taskId, shotListId } = ids(request); return reply.code(201).send(await projects.create(scope(request), { taskId, shotListId }));
  });
  app.get("/v1/stores/:storeId/content-tasks/:taskId/shot-lists/:shotListId/projects/:projectId", async (request) => {
    const { taskId, shotListId } = ids(request); return projects.get(scope(request), taskId, shotListId, String((request.params as Record<string, unknown>).projectId ?? ""));
  });
  app.post("/v1/stores/:storeId/content-tasks/:taskId/shot-lists/:shotListId/projects/:projectId/versions", async (request, reply) => {
    const context = scope(request); const body = record(request.body); const { taskId, shotListId } = ids(request);
    return reply.code(201).send(await projects.saveVersion(context, { taskId, shotListId, projectId: String((request.params as Record<string, unknown>).projectId ?? ""), slots: body.slots, coverAssetId: body.coverAssetId, coverFrameOffsetSeconds: body.coverFrameOffsetSeconds, coverTitle: body.coverTitle, finalize: body.finalize }));
  });
  app.post("/v1/stores/:storeId/content-tasks/:taskId/shot-lists/:shotListId/projects/:projectId/renders", async (request, reply) => {
    const context = scope(request); const body = record(request.body); const { taskId, shotListId } = ids(request);
    return reply.code(201).send(await renders.enqueue(context, { taskId, shotListId, projectId: String((request.params as Record<string, unknown>).projectId ?? ""), kind: body.kind }));
  });
  app.get("/v1/stores/:storeId/content-tasks/:taskId/shot-lists/:shotListId/projects/:projectId/renders", async request => {
    const context = scope(request); const { taskId, shotListId } = ids(request); return renders.list(context, { taskId, shotListId, projectId: String((request.params as Record<string, unknown>).projectId ?? "") });
  });
  app.post("/v1/stores/:storeId/content-tasks/:taskId/shot-lists/:shotListId/projects/:projectId/renders/:renderId/cancel", async request => {
    const context = scope(request); const { taskId, shotListId } = ids(request); return renders.cancel(context, { taskId, shotListId, projectId: String((request.params as Record<string, unknown>).projectId ?? ""), jobId: String((request.params as Record<string, unknown>).renderId ?? "") });
  });
  app.delete("/v1/stores/:storeId/content-tasks/:taskId/shot-lists/:shotListId/projects/:projectId/renders/:renderId", async (request, reply) => {
    const context = scope(request); const { taskId, shotListId } = ids(request); await renders.deleteSucceeded(context, { taskId, shotListId, projectId: String((request.params as Record<string, unknown>).projectId ?? ""), jobId: String((request.params as Record<string, unknown>).renderId ?? "") }); return reply.code(204).send();
  });
  app.get("/v1/stores/:storeId/content-tasks/:taskId/shot-lists/:shotListId/projects/:projectId/renders/:renderId/output", async (request, reply) => {
    const context = scope(request); const { taskId, shotListId } = ids(request); const item = await renders.delivery(context, { taskId, shotListId, projectId: String((request.params as Record<string, unknown>).projectId ?? ""), jobId: String((request.params as Record<string, unknown>).renderId ?? "") });
    return reply.header("content-type", item.contentType).header("content-disposition", `attachment; filename=storyboard-render-${String((request.params as Record<string, unknown>).renderId ?? "")}.mp4`).send(item.body);
  });
  app.get("/v1/stores/:storeId/content-tasks/:taskId/shot-lists/:shotListId/projects/:projectId/renders/:renderId/cover-candidates/:candidateId", async (request, reply) => {
    const context = scope(request); const { taskId, shotListId } = ids(request); const params = request.params as Record<string, unknown>; const item = await renders.delivery(context, { taskId, shotListId, projectId: String(params.projectId ?? ""), jobId: String(params.renderId ?? ""), artifactId: String(params.candidateId ?? "") });
    return reply.header("content-type", item.contentType).send(item.body);
  });
  app.post("/v1/stores/:storeId/content-tasks/:taskId/shot-lists/:shotListId/projects/:projectId/renders/:renderId/cover-selection", async request => {
    const context = scope(request); const { taskId, shotListId } = ids(request); const params = request.params as Record<string, unknown>; const body = record(request.body);
    return renders.selectCover(context, { taskId, shotListId, projectId: String(params.projectId ?? ""), jobId: String(params.renderId ?? ""), artifactId: body.candidateId, title: body.title });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ForbiddenError) return reply.code(403).send({ error: error.message });
    if (error instanceof AssetError) return reply.code(error.status).send({ error: error.message });
    if (error instanceof ProjectError) return reply.code(error.status).send({ error: error.message });
    if (error instanceof RenderError) return reply.code(error.status).send({ error: error.message });
    return reply.code(500).send({ error: "Internal server error" });
  });
}
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new AssetError("Request body must be an object", 422); return value as Record<string, unknown>; }
function isProtected(storage: VideoStorage): storage is VideoStorage & ProtectedRenderStorage { return "deleteProtected" in storage; }
