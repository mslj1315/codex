import type { Database } from "../db.js";

export interface CopyReviewFinding { pattern: string; severity: string; guidance: string; source: "deterministic" | "semantic"; }

// This is a local semantic-category guard. It intentionally does not send customer drafts to a model.
export class CopyReviewService {
  constructor(private readonly database: Database) {}

  async review(text: string): Promise<CopyReviewFinding[]> {
    const rules = await this.database.query<Record<string, unknown>>("SELECT * FROM operator_content_rule_versions WHERE status='published'");
    return rules.rows.flatMap((rule) => {
      const patterns = JSON.parse(String(rule.patterns_json)) as string[];
      const categories = JSON.parse(String(rule.semantic_categories_json)) as string[];
      const deterministic = patterns.filter((pattern) => text.includes(pattern)).map((pattern) => finding(pattern, rule, "deterministic"));
      const semantic = categories.filter((category) => semanticMatch(category, text) && !deterministic.length).map((category) => finding(category, rule, "semantic"));
      return [...deterministic, ...semantic];
    });
  }
}

function finding(pattern: string, rule: Record<string, unknown>, source: CopyReviewFinding["source"]): CopyReviewFinding { return { pattern, severity: String(rule.severity), guidance: String(rule.guidance), source }; }
function semanticMatch(category: string, text: string): boolean {
  if (category === "absolute") return /最|第一|顶级|全网|百分之百/.test(text);
  return text.includes(category);
}
