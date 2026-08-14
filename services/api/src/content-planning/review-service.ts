import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../db.js";
export interface CopyReviewFinding { pattern:string; severity:string; guidance:string; source:"deterministic"|"semantic"; }
export interface CopyReviewResult { approved: boolean; findings: CopyReviewFinding[]; copyVersion: number; contentDigest: string; }
export class CopyReviewService {
  constructor(private readonly database:Database) {}
  async review(taskId:string,copyId:string,copyVersion:number,text:string):Promise<CopyReviewResult> {
    const contentDigest = digest(text);
    const rows=await this.database.query<Record<string,unknown>>("SELECT * FROM operator_content_rule_versions WHERE status='published'");
    const snapshot=rows.rows.map(row=>({logicalId:row.logical_id,version:row.version,patterns:JSON.parse(String(row.patterns_json)),semanticCategories:JSON.parse(String(row.semantic_categories_json)),severity:row.severity,guidance:row.guidance}));
    const findings:CopyReviewFinding[]=snapshot.flatMap<CopyReviewFinding>(rule=>{const literal:CopyReviewFinding[]=(rule.patterns as string[]).filter(x=>text.includes(x)).map(pattern=>({pattern,severity:String(rule.severity),guidance:String(rule.guidance),source:"deterministic"}));return literal.length?literal:(rule.semanticCategories as string[]).filter(category=>category==="absolute"?/最|第一|顶级|全网|百分之百/.test(text):text.includes(category)).map(pattern=>({pattern,severity:String(rule.severity),guidance:String(rule.guidance),source:"semantic"}));});
    const approved=!findings.some(x=>x.severity==="block"||x.severity==="high");
    await this.database.query("INSERT INTO content_task_copy_reviews(id,task_id,copy_id,copy_version,content_digest,rule_snapshot_json,result_json,approved) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[randomUUID(),taskId,copyId,copyVersion,contentDigest,JSON.stringify(snapshot),JSON.stringify({approved,findings}),approved]);
    return { approved, findings, copyVersion, contentDigest };
  }
}
export function digest(text: string): string { return createHash("sha256").update(text, "utf8").digest("hex"); }
