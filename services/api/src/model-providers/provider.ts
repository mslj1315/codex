export type ModelProviderId = "deepseek" | "qwen";

export interface ModelHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export interface ModelHttpResponse {
  status: number;
  json(): Promise<unknown>;
}

export interface ModelHttpClient {
  post(request: ModelHttpRequest): Promise<ModelHttpResponse>;
}

export interface ProviderRequest {
  model: string;
  requestId: string;
  promptVersion: string;
  input: unknown;
  signal: AbortSignal;
}

export interface ProviderResponse {
  output: unknown;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export interface ModelProvider {
  readonly id: ModelProviderId;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
}

export class ModelProviderError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

export class ModelProviderHttpError extends ModelProviderError {
  constructor(readonly status: number) {
    super(`model provider returned HTTP ${status}`, status === 408 || status === 429 || (status >= 500 && status <= 599));
  }
}

export class ModelProviderResponseError extends ModelProviderError {
  constructor(message: string) { super(message, false); }
}

export class ModelProviderTimeoutError extends ModelProviderError {
  constructor(timeoutMs: number) { super(`model provider timed out after ${timeoutMs}ms`, true); }
}
