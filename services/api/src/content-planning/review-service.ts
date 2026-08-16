import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../db.js";
import type { CommercialLevel, ModelGenerationService, StructuredSchema } from "../model-providers/generation.js";

export interface CopyReviewFinding { pattern: string; severity: string; guidance: string; source: "deterministic" | "semantic"; }
export interface CopyReviewResult { approved: boolean; findings: CopyReviewFinding[]; copyVersion: number; contentDigest: string; }
export class CopyReviewUnavailableError extends Error {}

const semanticSchema: StructuredSchema<{ approved: boolean; findings: Array<{ pattern: string; severity: string; guidance: string }> }> = {
  parse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid semantic review");
    const result = value as Record<string, unknown>;
    if (typeof result.approved !== "boolean" || !Array.isArray(result.findings)) throw new Error("invalid semantic review");
    return {
      approved: result.approved,
      findings: result.findings.map(finding => {
        if (!finding || typeof finding !== "object" || Array.isArray(finding)) throw new Error("invalid semantic finding");
        const item = finding as Record<string, unknown>;
        if (![item.pattern, item.severity, item.guidance].every(value => typeof value === "string" && value.trim())) throw new Error("invalid semantic finding");
        return { pattern: item.pattern as string, severity: item.severity as string, guidance: item.guidance as string };
      })
    };
  }
};

export class CopyReviewService {
  constructor(private readonly database: Database, private readonly generator: ModelGenerationService) {}

  async review(taskId: string, copyId: string, copyVersion: number, text: string, commercialLevel: CommercialLevel): Promise<CopyReviewResult> {
    const contentDigest = digest(text);
    const rows = await this.database.query<Record<string, unknown>>("SELECT * FROM operator_content_rule_versions WHERE status='published' ORDER BY logical_id,version DESC");
    const snapshot = rows.rows.map(row => ({ logicalId: row.logical_id, version: row.version, patterns: JSON.parse(String(row.patterns_json)), semanticCategories: JSON.parse(String(row.semantic_categories_json)), severity: row.severity, guidance: row.guidance, scope: row.scope, platform: row.platform }));
    const deterministic = snapshot.flatMap(rule => (rule.patterns as string[]).filter(pattern => text.includes(pattern)).map(pattern => ({ pattern, severity: String(rule.severity), guidance: String(rule.guidance), source: "deterministic" as const })));
    if (hasBlocker(deterministic)) return this.persist(taskId, copyId, copyVersion, contentDigest, snapshot, null, { approved: false, findings: deterministic }, false);

    let generated;
    try {
      generated = await this.generator.generateStructured({ requestId: `review:${taskId}:${copyId}:${copyVersion}`, promptVersion: "content-semantic-review-v1", commercialLevel, input: { text, rules: snapshot }, schema: semanticSchema });
    } catch {
      throw new CopyReviewUnavailableError("Semantic review is unavailable");
    }
    const findings = generated.output.findings.map(finding => ({ ...finding, source: "semantic" as const }));
    const approved = generated.output.approved && !hasBlocker(findings);
    return this.persist(taskId, copyId, copyVersion, contentDigest, snapshot, { provider: generated.provider, model: generated.model, promptVersion: "content-semantic-review-v1" }, { approved: generated.output.approved, findings }, approved);
  }

  private async persist(taskId: string, copyId: string, copyVersion: number, contentDigest: string, rules: unknown, model: { provider: string; model: string; promptVersion: string } | null, result: { approved: boolean; findings: CopyReviewFinding[] }, approved: boolean): Promise<CopyReviewResult> {
    await this.database.query("INSERT INTO content_task_copy_reviews(id,task_id,copy_id,copy_version,content_digest,rule_snapshot_json,provider,model,prompt_version,result_json,approved) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [randomUUID(), taskId, copyId, copyVersion, contentDigest, JSON.stringify(rules), model?.provider ?? null, model?.model ?? null, model?.promptVersion ?? null, JSON.stringify(result), approved]);
    return { approved, findings: result.findings, copyVersion, contentDigest };
  }
}

function hasBlocker(findings: Array<{ severity: string }>): boolean { return findings.some(finding => finding.severity === "block" || finding.severity === "high"); }
export function digest(text: string): string { return createHash("sha256").update(text, "utf8").digest("hex"); }
