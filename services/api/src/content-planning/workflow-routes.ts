import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database, Queryable } from "../db.js";
import { ForbiddenError } from "../imports/repository.js";
import type { TrustedContext } from "../imports/service.js";
import { copyDraftsSchema, shotListSchema, topicArraySchema, type GenerationResult, type ModelGenerationService } from "../model-providers/generation.js";
import { CopyReviewService, digest } from "./review-service.js";

type Row = Record<string, unknown>;
type GenerationKind = "topics" | "copies" | "shots";
interface GenerationClaim { existing?: Row[]; claimId?: string; }
class WorkflowError extends Error { constructor(message: string, readonly status = 422, readonly findings?: unknown[]) { super(message); } }

export async function registerWorkflowRoutes(app: FastifyInstance, database: Database, resolve: (request: FastifyRequest) => Promise<TrustedContext | undefined>, generator?: ModelGenerationService): Promise<void> {
  if (!generator) throw new Error("workflow routes require a generation service");
  const generationService = generator;
  const review = new CopyReviewService(database);
  app.addHook("onRequest", async (request, reply) => {
    const context = await resolve(request);
    if (!context) return reply.code(403).send({ error: "No trusted request context" });
    request.trustedContext = context;
  });
  const scoped = (request: FastifyRequest) => {
    const storeId = String((request.params as Row).storeId ?? "");
    const context = request.trustedContext;
    if (!context || context.storeId !== storeId) throw new ForbiddenError("Store is outside trusted request context");
    return context;
  };
  const body = (request: FastifyRequest): Row => {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) throw new WorkflowError("Request body must be an object");
    return request.body as Row;
  };
  const task = async (request: FastifyRequest) => {
    const context = scoped(request);
    const id = String((request.params as Row).id ?? "");
    const found = await database.query<Row>("SELECT * FROM content_tasks WHERE id=$1 AND enterprise_id=$2 AND store_id=$3", [id, context.enterpriseId, context.storeId]);
    if (!found.rowCount) throw new WorkflowError("Content task not found", 404);
    return found.rows[0];
  };

  app.post("/v1/stores/:storeId/content-tasks", async (request, reply) => {
    const context = scoped(request); const input = body(request);
    const required = ["persona", "contentType", "style"];
    if (required.some((key) => typeof input[key] !== "string" || !String(input[key]).trim()) || !Number.isSafeInteger(input.commercialLevel) || Number(input.commercialLevel) < 0 || Number(input.commercialLevel) > 3 || (input.inspiration !== undefined && typeof input.inspiration !== "string")) throw new WorkflowError("persona, contentType, style, and commercialLevel are required");
    const profile = await database.query<Row>("SELECT * FROM store_content_profile_versions WHERE enterprise_id=$1 AND store_id=$2 ORDER BY version DESC LIMIT 1", [context.enterpriseId, context.storeId]);
    if (!profile.rowCount) throw new WorkflowError("Content profile is required", 409);
    const stage = await database.query<Row>("SELECT * FROM store_operating_stages WHERE enterprise_id=$1 AND store_id=$2 ORDER BY effective_date DESC LIMIT 1", [context.enterpriseId, context.storeId]);
    if (!stage.rowCount) throw new WorkflowError("Operating stage is required", 409);
    const templateRows = await database.query<Row>("SELECT * FROM operator_content_template_versions WHERE status='published' ORDER BY logical_id,version DESC");
    const templates = templateRows.rows.filter(row => matchesTemplate(row, profile.rows[0], input));
    const id = randomUUID();
    const row = await database.query<Row>("INSERT INTO content_tasks(id,enterprise_id,store_id,actor_id,profile_version,profile_snapshot_json,stage_snapshot_json,template_snapshot_json,inspiration,persona,content_type,style,commercial_level,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'topic_draft') RETURNING *", [id, context.enterpriseId, context.storeId, context.actorId, profile.rows[0].version, JSON.stringify(profile.rows[0]), JSON.stringify(stage.rows[0]), JSON.stringify(templates), optional(input.inspiration), String(input.persona).trim(), String(input.contentType).trim(), String(input.style).trim(), input.commercialLevel]);
    return reply.code(201).send(taskJson(row.rows[0]));
  });

  app.post("/v1/stores/:storeId/content-tasks/:id/topics/generate", async (request, reply) => reply.code(201).send(await generateTopics(await task(request))));
  app.post("/v1/stores/:storeId/content-tasks/:id/topics/:topicId/copies/generate", async (request, reply) => {
    const item = await task(request); const topicId = String((request.params as Row).topicId ?? "");
    return reply.code(201).send(await generateCopies(item, topicId));
  });
  app.post("/v1/stores/:storeId/content-tasks/:id/shots/generate", async (request, reply) => reply.code(201).send(await generateShots(await task(request))));

  app.put("/v1/stores/:storeId/content-tasks/:id/copies/:copyId", async request => {
    const item = await task(request); const input = body(request); const copyId = String((request.params as Row).copyId);
    if (![input.title, input.body].every(value => typeof value === "string" && value.trim())) throw new WorkflowError("title and body are required");
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<Row>("SELECT id FROM content_task_copies WHERE id=$1 AND task_id=$2 FOR UPDATE", [copyId, item.id]);
      if (!locked.rowCount) throw new WorkflowError("Editable draft copy not found", 409);
      const result = await client.query<Row>("UPDATE content_task_copies SET title=$3,body=$4,version=version+1 WHERE id=$1 AND task_id=$2 AND status='draft' RETURNING *", [copyId, item.id, String(input.title).trim(), String(input.body).trim()]);
      if (!result.rowCount) throw new WorkflowError("Editable draft copy not found", 409);
      const copy = result.rows[0];
      await client.query("INSERT INTO content_task_copy_versions(id,copy_id,version,title,body) VALUES($1,$2,$3,$4,$5)", [randomUUID(), copy.id, copy.version, copy.title, copy.body]);
      await client.query("COMMIT"); return copyJson(copy);
    } catch (error) { await rollback(client); throw error; } finally { client.release(); }
  });
  app.post("/v1/stores/:storeId/content-tasks/:id/copies/:copyId/confirm", async request => {
    const item = await task(request); const id = String((request.params as Row).copyId);
    const copy = await database.query<Row>("SELECT * FROM content_task_copies WHERE id=$1 AND task_id=$2", [id, item.id]);
    if (!copy.rowCount || copy.rows[0].status !== "draft") throw new WorkflowError("Draft copy not found", 409);
    const reviewed = await review.review(String(item.id), id, Number(copy.rows[0].version), `${copy.rows[0].title} ${copy.rows[0].body}`);
    if (!reviewed.approved) throw new WorkflowError("Copy has blocking review findings", 422, reviewed.findings);
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<Row>("SELECT confirmed_copy_id FROM content_tasks WHERE id=$1 FOR UPDATE", [item.id]);
      if (!locked.rowCount || locked.rows[0].confirmed_copy_id) throw new WorkflowError("A copy is already confirmed", 409);
      const current = await client.query<Row>("SELECT * FROM content_task_copies WHERE id=$1 AND task_id=$2 FOR UPDATE", [id, item.id]);
      if (!current.rowCount || current.rows[0].status !== "draft") throw new WorkflowError("Draft copy not found", 409);
      if (Number(current.rows[0].version) !== reviewed.copyVersion || digest(`${current.rows[0].title} ${current.rows[0].body}`) !== reviewed.contentDigest) throw new WorkflowError("Copy changed after review", 409);
      const approvedReview = await client.query("SELECT id FROM content_task_copy_reviews WHERE task_id=$1 AND copy_id=$2 AND copy_version=$3 AND content_digest=$4 AND approved=true", [item.id, id, reviewed.copyVersion, reviewed.contentDigest]);
      if (!approvedReview.rowCount) throw new WorkflowError("Copy review is no longer valid", 409);
      const result = await client.query<Row>("UPDATE content_task_copies SET status='confirmed',confirmed_at=CURRENT_TIMESTAMP WHERE id=$1 AND task_id=$2 AND status='draft' AND version=$3 RETURNING *", [id, item.id, reviewed.copyVersion]);
      if (!result.rowCount) throw new WorkflowError("Copy changed after review", 409);
      const pointer = await client.query("UPDATE content_tasks SET status='copy_confirmed',confirmed_copy_id=$2 WHERE id=$1 AND confirmed_copy_id IS NULL", [item.id, id]);
      if (!pointer.rowCount) throw new WorkflowError("A copy is already confirmed", 409);
      await client.query("COMMIT"); return copyJson(result.rows[0]);
    } catch (error) { await rollback(client); throw error; } finally { client.release(); }
  });

  async function generateTopics(item: Row): Promise<unknown[]> {
    const claim = await acquireClaim(item, "topics", "", client => findTopics(client, item.id));
    if (claim.existing) return claim.existing.map(topicJson);
    let output: GenerationResult<Array<Record<string, string | number>>>;
    try {
      output = await generationService.generateStructured({ requestId: String(item.id), promptVersion: "content-topic-v1", commercialLevel: level(item), input: generationInput(item), schema: topicArraySchema });
      if (output.output.length !== 3) throw new WorkflowError("Topic generation must return exactly three topics", 502);
      return (await completeClaim(item, "topics", "", claim.claimId!, output, async client => {
        const saved: Row[] = [];
        for (const [index, topic] of output.output.entries()) saved.push((await client.query<Row>("INSERT INTO content_task_topics(id,task_id,position,title,angle,product_reference,goal_reference,commercial_level) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [randomUUID(), item.id, index + 1, topic.title, topic.angle, topic.productReference, topic.goalReference, topic.commercialLevel])).rows[0]);
        return saved;
      }, client => findTopics(client, item.id))).map(topicJson);
    } catch (error) { await failClaim(item, "topics", "", claim.claimId!, "content-topic-v1", error); throw error; }
  }

  async function generateCopies(item: Row, topicId: string): Promise<unknown[]> {
    const topic = await database.query<Row>("SELECT * FROM content_task_topics WHERE id=$1 AND task_id=$2", [topicId, item.id]);
    if (!topic.rowCount) throw new WorkflowError("Topic not found", 404);
    const claim = await acquireClaim(item, "copies", topicId, client => findCopies(client, item.id, topicId));
    if (claim.existing) return claim.existing.map(copyJson);
    let output: GenerationResult<Array<Record<string, string | number>>>;
    try {
      output = await generationService.generateStructured({ requestId: `${item.id}:${topicId}`, promptVersion: "content-copy-v1", commercialLevel: level(item), input: { ...generationInput(item), topic: topicJson(topic.rows[0]) }, schema: copyDraftsSchema });
      return (await completeClaim(item, "copies", topicId, claim.claimId!, output, async client => {
        const saved: Row[] = [];
        for (const [index, generated] of output.output.entries()) {
          const copy = (await client.query<Row>("INSERT INTO content_task_copies(id,task_id,topic_id,position,title,body,strategy,product_reference,goal_reference,commercial_level) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *", [randomUUID(), item.id, topicId, index + 1, generated.title, generated.body, generated.strategy, generated.productReference, generated.goalReference, generated.commercialLevel])).rows[0];
          await client.query("INSERT INTO content_task_copy_versions(id,copy_id,version,title,body) VALUES($1,$2,1,$3,$4)", [randomUUID(), copy.id, copy.title, copy.body]);
          saved.push(copy);
        }
        return saved;
      }, client => findCopies(client, item.id, topicId))).map(copyJson);
    } catch (error) { await failClaim(item, "copies", topicId, claim.claimId!, "content-copy-v1", error); throw error; }
  }

  async function generateShots(item: Row): Promise<unknown> {
    if (item.status !== "copy_confirmed" || !item.confirmed_copy_id) throw new WorkflowError("A confirmed copy is required before shots", 409);
    const copy = (await database.query<Row>("SELECT * FROM content_task_copies WHERE id=$1 AND task_id=$2", [item.confirmed_copy_id, item.id])).rows[0];
    const copyId = String(item.confirmed_copy_id);
    const claim = await acquireClaim(item, "shots", copyId, client => findShots(client, item.id, copyId));
    if (claim.existing) return shotsJson(claim.existing[0]);
    let output: GenerationResult<Array<Record<string, string | number>>>;
    try {
      output = await generationService.generateStructured({ requestId: `${item.id}:${copy.id}`, promptVersion: "content-shots-v1", commercialLevel: level(item), input: { ...generationInput(item), copy: copyJson(copy) }, schema: shotListSchema });
      const saved = await completeClaim(item, "shots", copyId, claim.claimId!, output, client => client.query<Row>("INSERT INTO content_task_shot_lists(id,task_id,copy_id,shots_json) VALUES($1,$2,$3,$4) RETURNING *", [randomUUID(), item.id, copy.id, JSON.stringify(output.output)]).then(result => result.rows), client => findShots(client, item.id, copyId));
      return shotsJson(saved[0]);
    } catch (error) { await failClaim(item, "shots", copyId, claim.claimId!, "content-shots-v1", error); throw error; }
  }

  async function acquireClaim(item: Row, kind: GenerationKind, subjectId: string, findExisting: (client: PoolClient) => Promise<Row[]>): Promise<GenerationClaim> {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM content_tasks WHERE id=$1 FOR UPDATE", [item.id]);
      const existing = await findExisting(client);
      if (existing.length) { await client.query("COMMIT"); return { existing }; }
      const claimId = randomUUID();
      const inserted = await client.query<Row>("INSERT INTO content_task_generation_claims(task_id,kind,subject_id,claim_id,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING claim_id", [item.id, kind, subjectId, claimId, leaseExpiry()]);
      let claim = inserted;
      if (!claim.rowCount) {
        const active = await client.query<Row>("SELECT claim_id,expires_at FROM content_task_generation_claims WHERE task_id=$1 AND kind=$2 AND subject_id=$3 FOR UPDATE", [item.id, kind, subjectId]);
        if (!active.rowCount || new Date(String(active.rows[0].expires_at)).getTime() > Date.now()) throw new WorkflowError("Generation is already in progress", 409);
        claim = await client.query<Row>("UPDATE content_task_generation_claims SET claim_id=$4,claimed_at=CURRENT_TIMESTAMP,expires_at=$5 WHERE task_id=$1 AND kind=$2 AND subject_id=$3 RETURNING claim_id", [item.id, kind, subjectId, claimId, leaseExpiry()]);
      }
      await client.query("COMMIT");
      if (!claim.rowCount) throw new WorkflowError("Generation is already in progress", 409);
      return { claimId: String(claim.rows[0].claim_id) };
    } catch (error) { await rollback(client); throw error; } finally { client.release(); }
  }

  async function completeClaim<T extends Row>(item: Row, kind: GenerationKind, subjectId: string, claimId: string, output: GenerationResult<unknown>, persist: (client: PoolClient) => Promise<T[]>, findExisting: (client: PoolClient) => Promise<Row[]>): Promise<T[]> {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM content_tasks WHERE id=$1 FOR UPDATE", [item.id]);
      const ownership = await client.query("SELECT claim_id FROM content_task_generation_claims WHERE task_id=$1 AND kind=$2 AND subject_id=$3 AND claim_id=$4 FOR UPDATE", [item.id, kind, subjectId, claimId]);
      if (!ownership.rowCount) throw new WorkflowError("Generation claim is no longer owned", 409);
      const existing = await findExisting(client);
      const rows = existing.length ? existing as T[] : await persist(client);
      await recordRun(client, item, kind, subjectId, output, "succeeded");
      await client.query("DELETE FROM content_task_generation_claims WHERE task_id=$1 AND kind=$2 AND subject_id=$3 AND claim_id=$4", [item.id, kind, subjectId, claimId]);
      await client.query("COMMIT");
      return rows;
    } catch (error) { await rollback(client); throw error; } finally { client.release(); }
  }

  async function failClaim(item: Row, kind: GenerationKind, subjectId: string, claimId: string, promptVersion: string, error: unknown): Promise<void> {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM content_tasks WHERE id=$1 FOR UPDATE", [item.id]);
      const ownership = await client.query("SELECT claim_id FROM content_task_generation_claims WHERE task_id=$1 AND kind=$2 AND subject_id=$3 AND claim_id=$4 FOR UPDATE", [item.id, kind, subjectId, claimId]);
      if (!ownership.rowCount) { await client.query("COMMIT"); return; }
      await recordRun(client, item, kind, subjectId, { provider: "unknown", model: "unknown", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs: 0 }, "failed", promptVersion, failureCode(error));
      await client.query("DELETE FROM content_task_generation_claims WHERE task_id=$1 AND kind=$2 AND subject_id=$3 AND claim_id=$4", [item.id, kind, subjectId, claimId]);
      await client.query("COMMIT");
    } catch (recordError) { await rollback(client); if (!(recordError instanceof WorkflowError)) return; throw recordError; } finally { client.release(); }
  }

  function findTopics(queryable: Queryable, taskId: unknown) { return queryable.query<Row>("SELECT * FROM content_task_topics WHERE task_id=$1 ORDER BY position", [taskId]).then(result => result.rows); }
  function findCopies(queryable: Queryable, taskId: unknown, topicId: string) { return queryable.query<Row>("SELECT * FROM content_task_copies WHERE task_id=$1 AND topic_id=$2 ORDER BY position", [taskId, topicId]).then(result => result.rows); }
  function findShots(queryable: Queryable, taskId: unknown, copyId: string) { return queryable.query<Row>("SELECT * FROM content_task_shot_lists WHERE task_id=$1 AND copy_id=$2", [taskId, copyId]).then(result => result.rows); }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ForbiddenError) return reply.code(403).send({ error: error.message });
    if (error instanceof WorkflowError) return reply.code(error.status).send({ error: error.message, ...(error.findings ? { findings: error.findings } : {}) });
    return reply.code(500).send({ error: "Internal server error" });
  });
}

async function recordRun(client: PoolClient, item: Row, kind: GenerationKind, subjectId: string, output: { provider: string; model: string; usage: GenerationResult<unknown>["usage"]; latencyMs: number }, status: "succeeded" | "failed", promptVersion?: string, failure?: string): Promise<void> {
  await client.query("INSERT INTO content_task_generation_runs(id,task_id,kind,subject_id,provider,model,prompt_version,template_snapshot_json,status,usage_json,latency_ms,failure_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [randomUUID(), item.id, kind, subjectId, output.provider, output.model, promptVersion ?? ({ topics: "content-topic-v1", copies: "content-copy-v1", shots: "content-shots-v1" } as const)[kind], item.template_snapshot_json, status, JSON.stringify(output.usage), output.latencyMs, failure ?? null]);
}
async function rollback(client: PoolClient): Promise<void> { try { await client.query("ROLLBACK"); } catch { /* transaction was not started or already closed */ } }
function failureCode(error: unknown): string { return error instanceof Error ? error.constructor.name.slice(0, 120) : "UnknownError"; }
function leaseExpiry(): Date { return new Date(Date.now() + 10 * 60 * 1000); }
function level(item: Row): 0 | 1 | 2 | 3 { return Number(item.commercial_level) as 0 | 1 | 2 | 3; }
function optional(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function generationInput(item: Row) { return { profile: JSON.parse(String(item.profile_snapshot_json)), stage: JSON.parse(String(item.stage_snapshot_json)), templates: JSON.parse(String(item.template_snapshot_json)), inspiration: item.inspiration }; }
function taskJson(row: Row) { const stage = JSON.parse(String(row.stage_snapshot_json)); return { id: row.id, profileVersion: Number(row.profile_version), primaryGoal: stage.primary_goal, status: row.status }; }
function topicJson(row: Row) { return { id: row.id, title: row.title, angle: row.angle, productReference: row.product_reference, goalReference: row.goal_reference, commercialLevel: Number(row.commercial_level) }; }
function copyJson(row: Row) { return { id: row.id, title: row.title, body: row.body, strategy: row.strategy, productReference: row.product_reference, goalReference: row.goal_reference, commercialLevel: Number(row.commercial_level), version: Number(row.version), status: row.status }; }
function shotsJson(row: Row) { return { id: row.id, copyId: row.copy_id, status: row.status, shots: JSON.parse(String(row.shots_json)) }; }
function matchesTemplate(row: Row, profile: Row, input: Row) { const constraints = JSON.parse(String(row.constraints_json)) as Row; return constraints.industryCode === profile.industry_code && constraints.categoryCode === profile.category_code && constraints.persona === input.persona && constraints.contentType === input.contentType && constraints.style === input.style && Number(constraints.commercialLevel) === Number(input.commercialLevel); }
