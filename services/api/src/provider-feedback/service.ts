import { ValidationError } from "../imports/repository.js";
import type { ActivityState, ProviderFeedbackListInput, ProviderFeedbackPage, ProviderFeedbackRow, ReadinessState } from "./repository.js";

export interface ProviderFeedbackQuery { limit: number; cursor?: ProviderFeedbackCursor; activityState?: ActivityState; readinessState?: ReadinessState; }
interface ProviderFeedbackCursor { lastSuccessfulImportAt: Date | null; enterpriseId: string; storeId: string; }
interface ProviderFeedbackSource { list(input: ProviderFeedbackListInput): Promise<ProviderFeedbackPage>; }
const activities: ActivityState[] = ["active", "stale", "inactive"];
const readiness: ReadinessState[] = ["ready", "incomplete", "unavailable"];

export class ProviderFeedbackService {
  constructor(private readonly repository: ProviderFeedbackSource, private readonly now: () => Date) {}

  async list(query: ProviderFeedbackQuery): Promise<{ items: ProviderFeedbackRow[]; nextCursor: string | null }> {
    const result = await this.repository.list({ now: this.now(), limit: query.limit + 1, activityState: query.activityState, readinessState: query.readinessState, after: query.cursor });
    const items = result.items.slice(0, query.limit);
    return { items, nextCursor: result.hasMore ? encodeCursor(items[items.length - 1]!) : null };
  }
}

export function parseProviderFeedbackQuery(value: Record<string, unknown>): ProviderFeedbackQuery {
  for (const key of Object.keys(value)) if (!["limit", "cursor", "activityState", "readinessState"].includes(key)) throw new ValidationError("Provider feedback query is invalid");
  const limit = value.limit === undefined ? 50 : positiveInteger(value.limit, "limit");
  if (limit > 100) throw new ValidationError("limit is invalid");
  const activityState = optionalEnum(value.activityState, activities, "activityState");
  const readinessState = optionalEnum(value.readinessState, readiness, "readinessState");
  const cursor = value.cursor === undefined ? undefined : decodeCursor(value.cursor);
  return { limit, cursor, activityState, readinessState };
}
function positiveInteger(value: unknown, name: string): number { if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) throw new ValidationError(`${name} is invalid`); return Number(value); }
function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], name: string): T | undefined { if (value === undefined) return undefined; if (typeof value !== "string" || !allowed.includes(value as T)) throw new ValidationError(`${name} is invalid`); return value as T; }
function encodeCursor(item: ProviderFeedbackRow): string { return Buffer.from(JSON.stringify({ version: 1, lastSuccessfulImportAt: item.lastSuccessfulImportAt?.toISOString() ?? null, enterpriseId: item.enterpriseId, storeId: item.storeId })).toString("base64url"); }
function decodeCursor(value: unknown): ProviderFeedbackCursor { if (typeof value !== "string" || !value) throw new ValidationError("cursor is invalid"); try { const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>; if (Object.keys(decoded).length !== 4 || decoded.version !== 1 || typeof decoded.enterpriseId !== "string" || !decoded.enterpriseId || typeof decoded.storeId !== "string" || !decoded.storeId || !(typeof decoded.lastSuccessfulImportAt === "string" || decoded.lastSuccessfulImportAt === null)) throw new Error(); const date = decoded.lastSuccessfulImportAt === null ? null : new Date(decoded.lastSuccessfulImportAt); if (date !== null && (Number.isNaN(date.getTime()) || date.toISOString() !== decoded.lastSuccessfulImportAt)) throw new Error(); return { enterpriseId: decoded.enterpriseId, storeId: decoded.storeId, lastSuccessfulImportAt: date }; } catch { throw new ValidationError("cursor is invalid"); } }
