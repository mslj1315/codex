import type { Database } from "../db.js";
import type { ActionCardStatus, ActionCardVerificationOutcome } from "../imports/repository.js";

export type ActivityState = "active" | "stale" | "inactive";
export type ReadinessState = "ready" | "incomplete" | "unavailable";
export interface ProviderFeedbackRow {
  enterpriseId: string; storeId: string; lastSuccessfulImportAt: Date | null; lastConfirmedAt: Date | null;
  activityState: ActivityState; readinessState: ReadinessState; missingMetricCount: number;
  diagnosticCounts: Partial<Record<"revenue_decline", number>>;
  actionCardStatusCounts: Partial<Record<ActionCardStatus, number>>;
  verificationOutcomeCounts: Partial<Record<ActionCardVerificationOutcome, number>>;
  lastCoverageAt: Date | null;
}
export interface ProviderFeedbackListInput {
  now: Date; limit: number; activityState?: ActivityState; readinessState?: ReadinessState;
  after?: { lastSuccessfulImportAt: Date | null; enterpriseId: string; storeId: string };
}
export interface ProviderFeedbackPage { items: ProviderFeedbackRow[]; hasMore: boolean; }
type Row = Record<string, unknown>;
const STATUSES: ActionCardStatus[] = ["proposed", "in_progress", "completed", "verified", "cancelled"];
const OUTCOMES: ActionCardVerificationOutcome[] = ["effective", "ineffective", "not_executed", "data_insufficient"];

export class ProviderFeedbackRepository {
  constructor(private readonly database: Database) {}

  async list(input: ProviderFeedbackListInput): Promise<ProviderFeedbackPage> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await client.query<Row>(`WITH scopes AS (
        SELECT enterprise_id, store_id FROM import_batches
        UNION SELECT enterprise_id, store_id FROM fact_versions
        UNION SELECT enterprise_id, store_id FROM diagnostic_runs
        UNION SELECT enterprise_id, store_id FROM action_cards
      ), imports AS (
        SELECT enterprise_id, store_id, MAX(created_at) AS imported_at FROM import_batches GROUP BY enterprise_id, store_id
      ), latest_versions AS (
        SELECT DISTINCT ON (enterprise_id, store_id) id, enterprise_id, store_id, confirmed_at
        FROM fact_versions ORDER BY enterprise_id, store_id, confirmed_at DESC
      ), coverage AS (
        SELECT v.enterprise_id, v.store_id, COUNT(DISTINCT f.metric_key) AS covered_count
        FROM latest_versions v LEFT JOIN fact_values f ON f.fact_version_id = v.id AND f.enterprise_id = v.enterprise_id AND f.store_id = v.store_id
        GROUP BY v.enterprise_id, v.store_id
      ), required AS (
        SELECT COUNT(*) AS required_count FROM metric_definitions d
        JOIN metric_catalog_versions v ON v.id = d.metric_catalog_version_id
        WHERE v.state = 'published' AND d.enabled = true AND d.usable_for_readiness = true
      ), diagnostics AS (
        SELECT enterprise_id, store_id, COUNT(*) AS revenue_decline_count FROM diagnostic_runs
        WHERE kind = 'revenue_decline' GROUP BY enterprise_id, store_id
      ), cards AS (
        SELECT enterprise_id, store_id,
          SUM(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END) AS proposed_count,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
          SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified_count,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
          SUM(CASE WHEN verification_outcome = 'effective' THEN 1 ELSE 0 END) AS effective_count,
          SUM(CASE WHEN verification_outcome = 'ineffective' THEN 1 ELSE 0 END) AS ineffective_count,
          SUM(CASE WHEN verification_outcome = 'not_executed' THEN 1 ELSE 0 END) AS not_executed_count,
          SUM(CASE WHEN verification_outcome = 'data_insufficient' THEN 1 ELSE 0 END) AS data_insufficient_count
        FROM action_cards GROUP BY enterprise_id, store_id
      ) SELECT s.enterprise_id, s.store_id, i.imported_at, v.confirmed_at,
          COALESCE(c.covered_count, 0) AS covered_count, (SELECT required_count FROM required) AS required_count,
          COALESCE(d.revenue_decline_count, 0) AS revenue_decline_count,
          COALESCE(cards.proposed_count, 0) AS proposed_count, COALESCE(cards.in_progress_count, 0) AS in_progress_count,
          COALESCE(cards.completed_count, 0) AS completed_count, COALESCE(cards.verified_count, 0) AS verified_count,
          COALESCE(cards.cancelled_count, 0) AS cancelled_count, COALESCE(cards.effective_count, 0) AS effective_count,
          COALESCE(cards.ineffective_count, 0) AS ineffective_count, COALESCE(cards.not_executed_count, 0) AS not_executed_count,
          COALESCE(cards.data_insufficient_count, 0) AS data_insufficient_count
        FROM scopes s LEFT JOIN imports i ON i.enterprise_id = s.enterprise_id AND i.store_id = s.store_id
        LEFT JOIN latest_versions v ON v.enterprise_id = s.enterprise_id AND v.store_id = s.store_id
        LEFT JOIN coverage c ON c.enterprise_id = s.enterprise_id AND c.store_id = s.store_id
        LEFT JOIN diagnostics d ON d.enterprise_id = s.enterprise_id AND d.store_id = s.store_id
        LEFT JOIN cards ON cards.enterprise_id = s.enterprise_id AND cards.store_id = s.store_id
        ORDER BY i.imported_at DESC NULLS LAST, s.enterprise_id ASC, s.store_id ASC`);
      const items = result.rows.map((row) => toFeedbackRow(row, input.now));
      const filtered = items.filter((item) => (!input.activityState || item.activityState === input.activityState) && (!input.readinessState || item.readinessState === input.readinessState));
      const after = input.after ? filtered.filter((item) => follows(item, input.after!)) : filtered;
      await client.query("COMMIT");
      return { items: after.slice(0, input.limit), hasMore: after.length > input.limit };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

}
function toFeedbackRow(row: Row, now: Date): ProviderFeedbackRow {
  const imported = dateOrNull(row.imported_at); const confirmed = dateOrNull(row.confirmed_at);
  const missing = Math.max(Number(row.required_count) - Number(row.covered_count), 0); const actionCardStatusCounts: Partial<Record<ActionCardStatus, number>> = {}; const verificationOutcomeCounts: Partial<Record<ActionCardVerificationOutcome, number>> = {};
  for (const status of STATUSES) { const count = Number(row[`${status}_count`]); if (count) actionCardStatusCounts[status] = count; }
  for (const outcome of OUTCOMES) { const count = Number(row[`${outcome}_count`]); if (count) verificationOutcomeCounts[outcome] = count; }
  const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  return { enterpriseId: String(row.enterprise_id), storeId: String(row.store_id), lastSuccessfulImportAt: imported, lastConfirmedAt: confirmed,
    activityState: imported === null ? "inactive" : imported.getTime() >= cutoff ? "active" : "stale", readinessState: confirmed === null ? "unavailable" : missing === 0 ? "ready" : "incomplete", missingMetricCount: missing,
    diagnosticCounts: Number(row.revenue_decline_count) ? { revenue_decline: Number(row.revenue_decline_count) } : {}, actionCardStatusCounts, verificationOutcomeCounts, lastCoverageAt: confirmed };
}
function dateOrNull(value: unknown): Date | null { return value == null ? null : new Date(String(value)); }
function follows(item: ProviderFeedbackRow, cursor: { lastSuccessfulImportAt: Date | null; enterpriseId: string; storeId: string }): boolean {
  const time = item.lastSuccessfulImportAt?.getTime() ?? null;
  const cursorTime = cursor.lastSuccessfulImportAt?.getTime() ?? null;
  if (cursorTime === null) return time === null && (item.enterpriseId > cursor.enterpriseId || item.enterpriseId === cursor.enterpriseId && item.storeId > cursor.storeId);
  if (time === null) return true;
  if (time !== cursorTime) return time < cursorTime;
  return item.enterpriseId > cursor.enterpriseId || item.enterpriseId === cursor.enterpriseId && item.storeId > cursor.storeId;
}
