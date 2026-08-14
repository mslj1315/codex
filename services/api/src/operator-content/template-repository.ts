import { randomUUID } from "node:crypto";
import type { Queryable } from "../db.js";

export type LifecycleStatus = "draft" | "submitted" | "published" | "returned" | "disabled";
export class OperatorContentValidationError extends Error {}
export class OperatorContentConflictError extends Error {}
export interface TemplateInput { name: string; content: Record<string, unknown>; constraints: Record<string, unknown>; fallbackScope: Record<string, unknown>; }
export interface Template extends TemplateInput { id: string; version: number; status: LifecycleStatus; returnReason: string | null; createdByActorId: string; reviewedByActorId: string | null; }
type Row = Record<string, unknown>;

export class TemplateRepository {
  constructor(private readonly database: Queryable) {}
  async create(input: TemplateInput, actorId: string): Promise<Template> {
    validateTemplate(input);
    const result = await this.database.query<Row>("INSERT INTO content_templates (id,name,status,content_json,constraints_json,fallback_scope_json,created_by_actor_id) VALUES ($1,$2,'draft',$3,$4,$5,$6) RETURNING *", [randomUUID(), input.name.trim(), JSON.stringify(input.content), JSON.stringify(input.constraints), JSON.stringify(input.fallbackScope), actorId]);
    return toTemplate(result.rows[0]);
  }
  async list(): Promise<Template[]> { return (await this.database.query<Row>("SELECT * FROM content_templates ORDER BY created_at DESC")).rows.map(toTemplate); }
  async update(id: string, input: TemplateInput): Promise<Template> { validateTemplate(input); return this.transition(id, ["draft", "returned"], "UPDATE content_templates SET name=$2,content_json=$3,constraints_json=$4,fallback_scope_json=$5,return_reason=NULL,updated_at=now() WHERE id=$1 RETURNING *", [input.name.trim(), JSON.stringify(input.content), JSON.stringify(input.constraints), JSON.stringify(input.fallbackScope)]); }
  async submit(id: string): Promise<Template> { return this.transition(id, ["draft", "returned"], "UPDATE content_templates SET status='submitted',updated_at=now() WHERE id=$1 RETURNING *"); }
  async publish(id: string, actorId: string): Promise<Template> { return this.transition(id, ["submitted"], "UPDATE content_templates SET status='published',reviewed_by_actor_id=$2,updated_at=now() WHERE id=$1 RETURNING *", [actorId]); }
  async return(id: string, actorId: string, reason: string): Promise<Template> { if (!reason.trim()) throw new OperatorContentValidationError("return reason is required"); return this.transition(id, ["submitted"], "UPDATE content_templates SET status='returned',reviewed_by_actor_id=$2,return_reason=$3,updated_at=now() WHERE id=$1 RETURNING *", [actorId, reason.trim()]); }
  async disable(id: string, actorId: string): Promise<Template> { return this.transition(id, ["published"], "UPDATE content_templates SET status='disabled',reviewed_by_actor_id=$2,updated_at=now() WHERE id=$1 RETURNING *", [actorId]); }
  async match(criteria: Record<string, string>): Promise<Template[]> {
    const rows = await this.database.query<Row>("SELECT * FROM content_templates WHERE status='published'");
    return rows.rows.map(toTemplate).filter((template) => Object.entries(criteria).every(([key, value]) => String(template.constraints[key] ?? "") === value));
  }
  private async transition(id: string, allowed: LifecycleStatus[], sql: string, values: unknown[] = []): Promise<Template> {
    const current = await this.database.query<Row>("SELECT status FROM content_templates WHERE id=$1", [id]);
    if (current.rowCount !== 1) throw new OperatorContentValidationError("Template not found");
    if (!allowed.includes(String(current.rows[0].status) as LifecycleStatus)) throw new OperatorContentConflictError("Template lifecycle transition is invalid");
    const result = await this.database.query<Row>(sql, [id, ...values]); return toTemplate(result.rows[0]);
  }
}
function validateTemplate(input: TemplateInput): void { if (!input || typeof input !== "object" || !input.name?.trim()) throw new OperatorContentValidationError("name is required"); for (const key of ["content", "constraints", "fallbackScope"] as const) if (!isRecord(input[key])) throw new OperatorContentValidationError(`${key} is required`); for (const key of ["hook", "story", "value", "productAppearance", "cta", "shotRhythm", "captionVoiceRequirements"]) if (typeof input.content[key] !== "string" || !String(input.content[key]).trim()) throw new OperatorContentValidationError(`content.${key} is required`); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function toTemplate(row: Row): Template { return { id: String(row.id), version: Number(row.version), name: String(row.name), status: String(row.status) as LifecycleStatus, content: JSON.parse(String(row.content_json)), constraints: JSON.parse(String(row.constraints_json)), fallbackScope: JSON.parse(String(row.fallback_scope_json)), returnReason: row.return_reason == null ? null : String(row.return_reason), createdByActorId: String(row.created_by_actor_id), reviewedByActorId: row.reviewed_by_actor_id == null ? null : String(row.reviewed_by_actor_id) }; }
