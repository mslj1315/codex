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
