import type { ModelHttpClient, ModelProvider, ProviderRequest, ProviderResponse } from "./provider.js";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

export class DeepSeekProvider implements ModelProvider {
  readonly id = "deepseek" as const;

  constructor(private readonly apiKey: string, private readonly http: ModelHttpClient, private readonly baseUrl = DEEPSEEK_URL) {}

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const response = await this.http.post({
      url: this.baseUrl,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: chatBody(request),
      signal: request.signal
    });
    return parseChatResponse(response);
  }
}

function chatBody(request: ProviderRequest): string {
  return JSON.stringify({
    model: request.model,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: JSON.stringify({ requestId: request.requestId, promptVersion: request.promptVersion, input: request.input }) }]
  });
}

export async function parseChatResponse(response: { status: number; json(): Promise<unknown> }): Promise<ProviderResponse> {
  if (response.status < 200 || response.status >= 300) throw new Error(`model provider returned HTTP ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("model provider response has no structured content");
  try {
    return {
      output: JSON.parse(content),
      usage: {
        inputTokens: positiveInteger(payload.usage?.prompt_tokens),
        outputTokens: positiveInteger(payload.usage?.completion_tokens),
        totalTokens: positiveInteger(payload.usage?.total_tokens)
      }
    };
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("model provider returned invalid JSON");
    throw error;
  }
}

function positiveInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
