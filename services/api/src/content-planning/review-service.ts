import { randomUUID } from "node:crypto";
import type { Database } from "../db.js";
import type { CommercialLevel, ModelGenerationService, StructuredSchema } from "../model-providers/generation.js";

export interface CopyReviewFinding { pattern: string; severity: string; guidance: string; source: "deterministic" | "semantic"; }
const semanticSchema: StructuredSchema<{ approved: boolean; findings: Array<{ pattern: string; severity: string; guidance: string }> }> = { parse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid semantic review");
  const v=value as Record<string,unknown>; if(typeof v.approved!=="boolean"||!Array.isArray(v.findings)) throw new Error("invalid semantic review");
  return { approved:v.approved, findings:v.findings.map(x=>{if(!x||typeof x!=="object")throw new Error("invalid semantic finding");const f=x as Record<string,unknown>; if(![f.pattern,f.severity,f.guidance].every(y=>typeof y==="string"&&y.trim()))throw new Error("invalid semantic finding"); return {pattern:f.pattern as string,severity:f.severity as string,guidance:f.guidance as string};})};
} };

export class CopyReviewService {
  constructor(private readonly database: Database, private readonly generator: ModelGenerationService) {}
  async review(taskId:string, copyId:string, text:string, level:CommercialLevel): Promise<CopyReviewFinding[]> {
    const rules = await this.database.query<Record<string, unknown>>("SELECT * FROM operator_content_rule_versions WHERE status='published' ORDER BY logical_id,version DESC");
    const ruleSnapshot=rules.rows.map(rule=>({logicalId:rule.logical_id,version:rule.version,patterns:JSON.parse(String(rule.patterns_json)),semanticCategories:JSON.parse(String(rule.semantic_categories_json)),severity:rule.severity,guidance:rule.guidance,scope:rule.scope,platform:rule.platform}));
    const deterministic = ruleSnapshot.flatMap(rule => rule.patterns.filter((pattern: string) => text.includes(pattern)).map((pattern: string) => ({ pattern, severity: String(rule.severity), guidance: String(rule.guidance), source: "deterministic" as const })));
    if(deterministic.some(x=>x.severity==="block"||x.severity==="high")){await this.persist(taskId,copyId,ruleSnapshot,null,{approved:false,findings:deterministic},false);return deterministic;}
    const generated=await this.generator.generateStructured({requestId:`review:${taskId}:${copyId}`,promptVersion:"content-semantic-review-v1",commercialLevel:level,input:{text,rules:ruleSnapshot},schema:semanticSchema});
    const findings=generated.output.findings.map(x=>({...x,source:"semantic" as const})); const approved=generated.output.approved&&!findings.some(x=>x.severity==="block"||x.severity==="high");
    await this.persist(taskId,copyId,ruleSnapshot,{provider:generated.provider,model:generated.model,promptVersion:"content-semantic-review-v1"},{approved:generated.output.approved,findings},approved); return findings;
  }
  private async persist(taskId:string,copyId:string,rules:unknown,model:{provider:string;model:string;promptVersion:string}|null,result:unknown,approved:boolean){await this.database.query("INSERT INTO content_task_copy_reviews(id,task_id,copy_id,rule_snapshot_json,provider,model,prompt_version,result_json,approved) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[randomUUID(),taskId,copyId,JSON.stringify(rules),model?.provider??null,model?.model??null,model?.promptVersion??null,JSON.stringify(result),approved]);}
}
