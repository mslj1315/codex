import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database } from "../db.js";
import { ParserInputError, ImportService, type TrustedContext } from "./service.js";
import { ConflictError, ForbiddenError, ImportRepository, NotFoundError, ValidationError } from "./repository.js";

export const DEV_CONTEXT: TrustedContext = { enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo" };
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

declare module "fastify" {
  interface FastifyRequest { devContext: TrustedContext; }
}

export async function registerImportRoutes(app: FastifyInstance, database: Database): Promise<void> {
  const service = new ImportService(new ImportRepository(database));
  app.decorateRequest("devContext", { getter: () => DEV_CONTEXT });
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.includes("/imports/file")) return;
    const declared = Number(request.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) return reply.code(413).send(errorBody("Upload exceeds maximum size"));
  });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  app.addContentTypeParser(["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], { parseAs: "buffer", bodyLimit: MAX_UPLOAD_BYTES }, (_request, body, done) => done(null, body));

  app.post("/v1/stores/:storeId/imports/manual", async (request, reply) => {
    const context = scopedContext(request);
    const body = record(request.body);
    const batch = await service.createManual(context, { rangeStart: stringField(body, "rangeStart"), rangeEnd: stringField(body, "rangeEnd"), candidates: arrayField(body, "candidates") as never });
    return reply.code(201).send(batch);
  });
  app.post("/v1/stores/:storeId/imports/file", async (request, reply) => {
    const context = scopedContext(request);
    let bytes: Buffer; let filename: string; let mimeType: string; let fields: Record<string, unknown> = {};
    if (request.isMultipart()) {
      const part = await request.file();
      if (!part) throw new ValidationError("A file is required");
      bytes = await part.toBuffer(); filename = part.filename; mimeType = part.mimetype;
      fields = Object.fromEntries(Object.entries(part.fields).map(([key, value]) => [key, (value as { value?: unknown }).value]));
    } else {
      if (!Buffer.isBuffer(request.body)) throw new ValidationError("File bytes are required");
      bytes = request.body; filename = header(request, "x-file-name"); mimeType = request.headers["content-type"]?.split(";")[0] ?? "";
      fields = request.query as Record<string, unknown>;
    }
    if (bytes.byteLength > MAX_UPLOAD_BYTES) return reply.code(413).send(errorBody("Upload exceeds maximum size"));
    const batch = await service.createFile(context, { bytes, filename, mimeType, rangeStart: stringField(fields, "rangeStart"), rangeEnd: stringField(fields, "rangeEnd"), currencyUnit: optionalCurrency(fields.currencyUnit) });
    return reply.code(201).send(batch);
  });
  app.get("/v1/stores/:storeId/imports/:batchId", async (request) => service.getBatch(scopedContext(request), stringParam(request, "batchId")));
  app.patch("/v1/stores/:storeId/imports/:batchId/candidates/:candidateId", async (request) => service.updateCandidate(scopedContext(request), stringParam(request, "batchId"), stringParam(request, "candidateId"), record(request.body)));
  app.post("/v1/stores/:storeId/imports/:batchId/confirm", async (request, reply) => {
    const body = record(request.body); const candidateIds = arrayField(body, "candidateIds");
    const version = await service.confirm(scopedContext(request), stringParam(request, "batchId"), candidateIds.map((id) => {
      if (typeof id !== "string") throw new ValidationError("Candidate IDs must be strings"); return id;
    }));
    return reply.code(201).send(version);
  });
  app.get("/v1/stores/:storeId/facts/latest", async (request) => service.getLatest(scopedContext(request)));

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ParserInputError) return reply.code(error.code === "xlsx_too_large" ? 413 : 422).send(errorBody(error.message));
    if (error instanceof NotFoundError) return reply.code(404).send(errorBody(error.message));
    if (error instanceof ForbiddenError) return reply.code(403).send(errorBody(error.message));
    if (error instanceof ConflictError) return reply.code(409).send(errorBody(error.message));
    if (isUploadTooLarge(error)) return reply.code(413).send(errorBody("Upload exceeds maximum size"));
    if (error instanceof ValidationError) return reply.code(422).send(errorBody(error.message));
    return reply.code(500).send(errorBody("Internal server error"));
  });
}

function scopedContext(request: FastifyRequest): TrustedContext {
  const storeId = stringParam(request, "storeId");
  if (storeId !== request.devContext.storeId) throw new ForbiddenError("Store is outside trusted development context");
  return request.devContext;
}
function record(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ValidationError("Request body must be an object"); return value as Record<string, unknown>; }
function stringField(body: Record<string, unknown>, key: string): string { if (typeof body[key] !== "string") throw new ValidationError(`${key} is required`); return body[key]; }
function arrayField(body: Record<string, unknown>, key: string): unknown[] { if (!Array.isArray(body[key])) throw new ValidationError(`${key} is required`); return body[key] as unknown[]; }
function stringParam(request: FastifyRequest, key: string): string { const value = (request.params as Record<string, unknown>)[key]; if (typeof value !== "string") throw new ValidationError(`Missing ${key}`); return value; }
function header(request: FastifyRequest, key: string): string { const value = request.headers[key]; if (typeof value !== "string" || value === "") throw new ValidationError(`${key} header is required`); return value; }
function optionalCurrency(value: unknown): "yuan" | "cents" | undefined { if (value === undefined) return undefined; if (value === "yuan" || value === "cents") return value; throw new ValidationError("currencyUnit is invalid"); }
function errorBody(message: string) { return { error: message }; }
function isUploadTooLarge(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "FST_REQ_FILE_TOO_LARGE"; }
