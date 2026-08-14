import { DeepSeekProvider } from "./deepseek.js";
import { ModelProviderError, ModelProviderResponseError, ModelProviderTimeoutError, type ModelHttpClient, type ModelProvider, type ModelProviderId } from "./provider.js";
import { QwenProvider } from "./qwen.js";

export type { ModelHttpClient } from "./provider.js";

export type CommercialLevel = 0 | 1 | 2 | 3;
export interface StructuredSchema<T> { parse(value: unknown, commercialLevel: CommercialLevel): T }
export interface GenerationConfig { provider: ModelProviderId; model: string; apiKey: string; baseUrl?: string; timeoutMs?: number; maxRetries?: number }
export interface GenerationDependencies { http?: ModelHttpClient; sleep?: (milliseconds: number) => Promise<void>; now?: () => number }
export interface GenerateStructuredRequest<T> { requestId: string; promptVersion: string; commercialLevel: CommercialLevel; input: unknown; schema: StructuredSchema<T> }
export interface GenerationResult<T> { provider: ModelProviderId; model: string; output: T; usage: { inputTokens: number; outputTokens: number; totalTokens: number }; latencyMs: number }
export interface ModelGenerationService { generateStructured<T>(request: GenerateStructuredRequest<T>): Promise<GenerationResult<T>> }

const defaultHttp: ModelHttpClient = {
  async post(request) {
    const response = await fetch(request.url, { method: "POST", headers: request.headers, body: request.body, signal: request.signal });
    return { status: response.status, json: () => response.json() };
  }
};

export function createGenerationService(config: GenerationConfig, dependencies: GenerationDependencies = {}): ModelGenerationService {
  validateConfig(config);
  const http = dependencies.http ?? defaultHttp;
  const provider: ModelProvider = config.provider === "deepseek"
    ? new DeepSeekProvider(config.apiKey, http, config.baseUrl)
    : new QwenProvider(config.apiKey, http, config.baseUrl);
  const now = dependencies.now ?? Date.now;
  const maxRetries = config.maxRetries ?? 1;
  const timeoutMs = config.timeoutMs ?? 15_000;
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  return {
    async generateStructured<T>(request: GenerateStructuredRequest<T>): Promise<GenerationResult<T>> {
      if (!isCommercialLevel(request.commercialLevel)) throw new Error("commercialLevel must be a safe integer from 0 to 3");
      const startedAt = now();
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await provider.generate({ model: config.model, requestId: request.requestId, promptVersion: request.promptVersion, commercialLevel: request.commercialLevel, input: request.input, signal: controller.signal });
          const output = parseStructured(request.schema, response.output, request.commercialLevel);
          return { provider: provider.id, model: config.model, output, usage: response.usage, latencyMs: Math.max(0, now() - startedAt) };
        } catch (error) {
          const classifiedError = controller.signal.aborted ? new ModelProviderTimeoutError(timeoutMs) : error;
          if (attempt === maxRetries || !isRetryable(classifiedError)) throw classifiedError;
        } finally {
          clearTimeout(timeout);
        }
        await sleep(25 * (attempt + 1));
      }
      throw new Error("unreachable model generation retry state");
    }
  };
}

export function createConfiguredGenerationService(environment: Record<string, string | undefined>): ModelGenerationService | undefined {
  const provider = environment.MODEL_PROVIDER;
  const model = environment.MODEL_MODEL;
  const apiKey = environment.MODEL_API_KEY;
  if (!provider && !model && !apiKey) return undefined;
  if (provider !== "deepseek" && provider !== "qwen") throw new Error("MODEL_PROVIDER must be deepseek or qwen");
  if (!model) throw new Error("MODEL_MODEL is required when MODEL_PROVIDER is configured");
  if (!apiKey) throw new Error("MODEL_API_KEY is required when MODEL_PROVIDER is configured");
  return createGenerationService({ provider, model, apiKey, baseUrl: baseUrlFromEnv(environment.MODEL_BASE_URL), timeoutMs: numberFromEnv(environment.MODEL_TIMEOUT_MS), maxRetries: numberFromEnv(environment.MODEL_MAX_RETRIES) });
}

function validateConfig(config: GenerationConfig): void {
  if (!config.model.trim()) throw new Error("model is required");
  if (!config.apiKey.trim()) throw new Error("api key is required");
  if (!Number.isSafeInteger(config.maxRetries ?? 1) || (config.maxRetries ?? 1) < 0 || (config.maxRetries ?? 1) > 3) throw new Error("maxRetries must be a safe integer from 0 to 3");
  if (!Number.isSafeInteger(config.timeoutMs ?? 15_000) || (config.timeoutMs ?? 15_000) < 1 || (config.timeoutMs ?? 15_000) > 60_000) throw new Error("timeoutMs must be a safe integer from 1 to 60000");
}

function numberFromEnv(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("model timeout and retry values must be safe integers");
  return parsed;
}

function baseUrlFromEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname) throw new Error();
    return url.toString();
  } catch {
    throw new Error("MODEL_BASE_URL must be a non-empty absolute HTTPS URL");
  }
}

function isRetryable(error: unknown): boolean {
  return error instanceof ModelProviderError ? error.retryable : true;
}

function parseStructured<T>(schema: StructuredSchema<T>, value: unknown, commercialLevel: CommercialLevel): T {
  try { return schema.parse(value, commercialLevel); } catch { throw new ModelProviderResponseError("model returned invalid structured output"); }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expected object");
  return value as Record<string, unknown>;
}
function text(value: unknown): string { if (typeof value !== "string" || !value.trim() || value.length > 4_000) throw new Error("expected bounded text"); return value; }
function reference(item: Record<string, unknown>): void { text(item.productReference); text(item.goalReference); }
function commercialLevel(item: Record<string, unknown>, requestedLevel: CommercialLevel): CommercialLevel {
  const value = item.commercialLevel;
  if (!isCommercialLevel(value) || value > requestedLevel) throw new Error("commercial level exceeds the requested level");
  return value;
}
function isCommercialLevel(value: unknown): value is CommercialLevel { return Number.isSafeInteger(value) && typeof value === "number" && value >= 0 && value <= 3; }

export const topicArraySchema: StructuredSchema<Array<Record<string, string | CommercialLevel>>> = { parse(value, requestedLevel) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw new Error("expected one to three topics");
  return value.map((entry) => { const item = object(entry); reference(item); return { title: text(item.title), angle: text(item.angle), productReference: text(item.productReference), goalReference: text(item.goalReference), commercialLevel: commercialLevel(item, requestedLevel) }; });
} };

export const copyDraftsSchema: StructuredSchema<Array<Record<string, string | CommercialLevel>>> = { parse(value, requestedLevel) {
  if (!Array.isArray(value) || value.length !== 3) throw new Error("expected exactly three copy drafts");
  const copies = value.map((entry) => { const item = object(entry); reference(item); return { title: text(item.title), body: text(item.body), strategy: text(item.strategy), productReference: text(item.productReference), goalReference: text(item.goalReference), commercialLevel: commercialLevel(item, requestedLevel) }; });
  if (new Set(copies.map((copy) => copy.strategy)).size !== 3) throw new Error("copy drafts must have distinct strategies");
  if (new Set(copies.map((copy) => `${copy.title}|${copy.body}`)).size !== 3) throw new Error("copy drafts must be materially distinct");
  return copies;
} };

export const shotListSchema: StructuredSchema<Array<Record<string, string | number>>> = { parse(value, requestedLevel) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) throw new Error("expected bounded shot list");
  return value.map((entry, index) => { const item = object(entry); reference(item); if (item.order !== index + 1 || !Number.isSafeInteger(item.durationSeconds) || (item.durationSeconds as number) < 1 || (item.durationSeconds as number) > 60) throw new Error("shot order and duration must be safe integers"); return { order: item.order as number, shot: text(item.shot), durationSeconds: item.durationSeconds as number, narration: text(item.narration), productReference: text(item.productReference), goalReference: text(item.goalReference), commercialLevel: commercialLevel(item, requestedLevel) }; });
} };
