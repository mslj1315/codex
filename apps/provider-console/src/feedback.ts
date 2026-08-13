import type { ProviderApiClient } from "./api";

export type ActivityState = "active" | "stale" | "inactive";
export type ReadinessState = "ready" | "incomplete" | "unavailable";
export type ActionCardStatus = "proposed" | "in_progress" | "completed" | "verified" | "cancelled";
export type VerificationOutcome = "effective" | "ineffective" | "not_executed" | "data_insufficient";

export interface ProviderFeedbackRow {
  enterpriseId: string;
  storeId: string;
  lastSuccessfulImportAt: string | null;
  lastConfirmedAt: string | null;
  lastCoverageAt: string | null;
  activityState: ActivityState;
  readinessState: ReadinessState;
  missingMetricCount: number;
  diagnosticCounts: Partial<Record<"revenue_decline", number>>;
  actionCardStatusCounts: Partial<Record<ActionCardStatus, number>>;
  verificationOutcomeCounts: Partial<Record<VerificationOutcome, number>>;
}

export interface FeedbackPage {
  items: ProviderFeedbackRow[];
  nextCursor: string | null;
}

export interface FeedbackFilter {
  activityState?: ActivityState;
  readinessState?: ReadinessState;
  cursor?: string;
}

const activityStates: ActivityState[] = ["active", "stale", "inactive"];
const readinessStates: ReadinessState[] = ["ready", "incomplete", "unavailable"];
const actionCardStatuses: ActionCardStatus[] = ["proposed", "in_progress", "completed", "verified", "cancelled"];
const verificationOutcomes: VerificationOutcome[] = ["effective", "ineffective", "not_executed", "data_insufficient"];

export async function listFeedback(api: ProviderApiClient, filter: FeedbackFilter): Promise<FeedbackPage> {
  const query = new URLSearchParams({ limit: "50" });
  if (filter.activityState) query.set("activityState", filter.activityState);
  if (filter.readinessState) query.set("readinessState", filter.readinessState);
  if (filter.cursor) query.set("cursor", filter.cursor);
  const response = await api.fetch(`/v1/provider-feedback/stores?${query.toString()}`);
  if (!response.ok) throw response;
  return parseFeedbackPage(await response.json());
}

export function parseFeedbackPage(value: unknown): FeedbackPage {
  const page = object(value);
  if (!Array.isArray(page.items) || !(typeof page.nextCursor === "string" || page.nextCursor === null)) invalid();
  return {
    items: page.items.map(parseFeedbackRow),
    nextCursor: page.nextCursor as string | null
  };
}

function parseFeedbackRow(value: unknown): ProviderFeedbackRow {
  const row = object(value);
  return {
    enterpriseId: text(row.enterpriseId),
    storeId: text(row.storeId),
    lastSuccessfulImportAt: timestamp(row.lastSuccessfulImportAt),
    lastConfirmedAt: timestamp(row.lastConfirmedAt),
    lastCoverageAt: timestamp(row.lastCoverageAt),
    activityState: enumeration(row.activityState, activityStates),
    readinessState: enumeration(row.readinessState, readinessStates),
    missingMetricCount: count(row.missingMetricCount),
    diagnosticCounts: countMap(row.diagnosticCounts, ["revenue_decline"]),
    actionCardStatusCounts: countMap(row.actionCardStatusCounts, actionCardStatuses),
    verificationOutcomeCounts: countMap(row.verificationOutcomeCounts, verificationOutcomes)
  };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) invalid();
  return value;
}

function timestamp(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") invalid();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) invalid();
  return value;
}

function enumeration<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid();
  return value as T;
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
  return Number(value);
}

function countMap<K extends string>(value: unknown, allowed: readonly K[]): Partial<Record<K, number>> {
  const input = object(value);
  const result: Partial<Record<K, number>> = {};
  for (const [key, rawCount] of Object.entries(input)) {
    if (!allowed.includes(key as K)) invalid();
    result[key as K] = count(rawCount);
  }
  return result;
}

function invalid(): never {
  throw new Error("Invalid feedback response");
}
