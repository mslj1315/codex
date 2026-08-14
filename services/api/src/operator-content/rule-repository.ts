import { randomUUID } from "node:crypto";
import type { Queryable } from "../db.js";
import { OperatorContentConflictError, OperatorContentValidationError, type LifecycleStatus } from "./template-repository.js";

export interface RuleInput { name: string; ruleType: string; severity: "block" | "high" | "warning" | "notice"; patterns: string[]; }
export interface ReviewRule extends RuleInput { id: string; version: number; status: LifecycleStatus; returnReason: string | null; }
type Row = Record<string, unknown>;
export class RuleRepository {
  constructor(private readonly database: Queryable) {}
  async create(input: RuleInput, actorId: string): Promise<ReviewRule> { validate(input); const result = await this.database.query<Row>("INSERT INTO content_review_rules (id,name,status,rule_type,severity,patterns_json,created_by_actor_id) VALUES ($1,$2,'draft',$3,$4,$5,$6) RETURNING *", [randomUUID(), input.name.trim(), input.ruleType.trim(), input.severity, JSON.stringify(input.patterns), actorId]); return toRule(result.rows[0]); }
  async listActive(): Promise<ReviewRule[]> { return (await this.database.query<Row>("SELECT * FROM content_review_rules WHERE status='published' ORDER BY created_at DESC")).rows.map(toRule); }
  async submit(id: string): Promise<ReviewRule> { return this.transition(id, ["draft", "returned"], "UPDATE content_review_rules SET status='submitted',updated_at=now() WHERE id=$1 RETURNING *"); }
  async publish(id: string, actorId: string): Promise<ReviewRule> { return this.transition(id, ["submitted"], "UPDATE content_review_rules SET status='published',reviewed_by_actor_id=$2,updated_at=now() WHERE id=$1 RETURNING *", [actorId]); }
  async return(id: string, actorId: string, reason: string): Promise<ReviewRule> { if (!reason.trim()) throw new OperatorContentValidationError("return reason is required"); return this.transition(id, ["submitted"], "UPDATE content_review_rules SET status='returned',reviewed_by_actor_id=$2,return_reason=$3,updated_at=now() WHERE id=$1 RETURNING *", [actorId, reason.trim()]); }
  async disable(id: string, actorId: string): Promise<ReviewRule> { return this.transition(id, ["published"], "UPDATE content_review_rules SET status='disabled',reviewed_by_actor_id=$2,updated_at=now() WHERE id=$1 RETURNING *", [actorId]); }
  private async transition(id: string, allowed: LifecycleStatus[], sql: string, values: unknown[] = []): Promise<ReviewRule> { const current = await this.database.query<Row>("SELECT status FROM content_review_rules WHERE id=$1", [id]); if (current.rowCount !== 1) throw new OperatorContentValidationError("Rule not found"); if (!allowed.includes(String(current.rows[0].status) as LifecycleStatus)) throw new OperatorContentConflictError("Rule lifecycle transition is invalid"); const result = await this.database.query<Row>(sql, [id, ...values]); return toRule(result.rows[0]); }
}
function validate(input: RuleInput): void { if (!input || !input.name?.trim() || !input.ruleType?.trim() || !["block", "high", "warning", "notice"].includes(input.severity) || !Array.isArray(input.patterns) || input.patterns.length === 0 || input.patterns.some((item) => typeof item !== "string" || !item.trim())) throw new OperatorContentValidationError("A name, rule type, severity, and patterns are required"); }
function toRule(row: Row): ReviewRule { return { id: String(row.id), version: Number(row.version), name: String(row.name), status: String(row.status) as LifecycleStatus, ruleType: String(row.rule_type), severity: String(row.severity) as RuleInput["severity"], patterns: JSON.parse(String(row.patterns_json)), returnReason: row.return_reason == null ? null : String(row.return_reason) }; }
