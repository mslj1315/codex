import { ValidationError } from "../imports/repository.js";
import type { ProviderFeedbackQuery } from "../provider-feedback/service.js";
import type { ProviderFeedbackRow } from "../provider-feedback/repository.js";
import {
  providerCustomerScopeKey,
  type ProviderCustomerMetadata,
  type ProviderCustomerScope,
  type ReplaceMetadataResult
} from "./repository.js";

export interface MetadataReplacement {
  customerAlias: string | null;
  providerNote: string | null;
  expectedVersion: number | null;
}

export class ProviderCustomerNotFoundError extends Error {}
export class ProviderCustomerMetadataConflictError extends Error {}

interface ProviderFeedbackSource {
  list(query: ProviderFeedbackQuery): Promise<{ items: ProviderFeedbackRow[]; nextCursor: string | null }>;
}

interface ProviderCustomerMetadataSource {
  listForScopes(scopes: readonly ProviderCustomerScope[]): Promise<Map<string, ProviderCustomerMetadata>>;
  scopeExists(scope: ProviderCustomerScope): Promise<boolean>;
  replace(input: ProviderCustomerScope & MetadataReplacement & { accountId: string; now: Date }): Promise<ReplaceMetadataResult>;
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DISALLOWED_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export class ProviderCustomerService {
  constructor(
    private readonly feedback: ProviderFeedbackSource,
    private readonly metadata: ProviderCustomerMetadataSource,
    private readonly now: () => Date
  ) {}

  async list(query: ProviderFeedbackQuery): Promise<{
    items: Array<{ feedback: ProviderFeedbackRow; metadata: ProviderCustomerMetadata | null }>;
    nextCursor: string | null;
  }> {
    const feedbackPage = await this.feedback.list(query);
    const metadataByScope = await this.metadata.listForScopes(feedbackPage.items.map(({ enterpriseId, storeId }) => ({ enterpriseId, storeId })));
    return {
      items: feedbackPage.items.map((feedback) => ({
        feedback,
        metadata: metadataByScope.get(providerCustomerScopeKey(feedback)) ?? null
      })),
      nextCursor: feedbackPage.nextCursor
    };
  }

  async replace(
    scope: ProviderCustomerScope,
    input: MetadataReplacement,
    accountId: string
  ): Promise<{ metadata: ProviderCustomerMetadata | null }> {
    if (!await this.metadata.scopeExists(scope)) throw new ProviderCustomerNotFoundError();
    const result = await this.metadata.replace({ ...scope, ...input, accountId, now: this.now() });
    if (result.status === "conflict") throw new ProviderCustomerMetadataConflictError();
    return { metadata: result.status === "saved" ? result.metadata : null };
  }
}

export function parseMetadataReplacement(value: unknown): MetadataReplacement {
  if (!isRecord(value) || !hasExactKeys(value, ["customerAlias", "providerNote", "expectedVersion"])) {
    throw new ValidationError("Provider customer metadata is invalid");
  }
  return {
    customerAlias: normalizeText(value.customerAlias, "customerAlias", 120),
    providerNote: normalizeText(value.providerNote, "providerNote", 2000),
    expectedVersion: normalizeExpectedVersion(value.expectedVersion)
  };
}

export function parseProviderCustomerScope(value: unknown): ProviderCustomerScope {
  if (!isRecord(value)) throw new ValidationError("Provider customer scope is invalid");
  return {
    enterpriseId: parseIdentifier(value.enterpriseId, "enterpriseId"),
    storeId: parseIdentifier(value.storeId, "storeId")
  };
}

function normalizeText(value: unknown, name: "customerAlias" | "providerNote", maximumCodePoints: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new ValidationError(`${name} is invalid`);
  if (DISALLOWED_CONTROL_PATTERN.test(value)) throw new ValidationError(`${name} is invalid`);
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (normalized === "") return null;
  if ([...normalized].length > maximumCodePoints) {
    throw new ValidationError(`${name} is invalid`);
  }
  return normalized;
}

function normalizeExpectedVersion(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new ValidationError("expectedVersion is invalid");
  }
  return value;
}

function parseIdentifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) throw new ValidationError(`${name} is invalid`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}
