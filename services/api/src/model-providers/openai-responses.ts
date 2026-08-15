import { ModelProviderHttpError, ModelProviderResponseError, type ModelHttpClient, type ModelProvider, type ProviderRequest, type ProviderResponse } from "./provider.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1";

export class OpenAIResponsesProvider implements ModelProvider {
  readonly id = "openai_responses" as const;

  constructor(private readonly apiKey: string, private readonly http: ModelHttpClient, private readonly baseUrl = OPENAI_RESPONSES_URL) {}

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const response = await this.http.post({
      url: responsesUrl(this.baseUrl),
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        store: false,
        text: { format: { type: "json_object" } },
        input: [{
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify({ requestId: request.requestId, promptVersion: request.promptVersion, commercialLevel: request.commercialLevel, input: request.input }) }]
        }]
      }),
      signal: request.signal
    });
    return parseResponsesResponse(response);
  }
}

function responsesUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/responses") ? normalized : `${normalized}/responses`;
}

async function parseResponsesResponse(response: { status: number; json(): Promise<unknown> }): Promise<ProviderResponse> {
  if (response.status < 200 || response.status >= 300) throw new ModelProviderHttpError(response.status);
  let payload: ResponsesPayload;
  try {
    payload = await response.json() as ResponsesPayload;
  } catch {
    throw new ModelProviderResponseError("model provider returned invalid JSON");
  }
  if (payload.status !== "completed") throw new ModelProviderResponseError("model provider response has no structured content");
  const content = finalOutputText(payload.output);
  if (content === undefined) throw new ModelProviderResponseError("model provider response has no structured content");
  try {
    return {
      output: JSON.parse(content),
      usage: {
        inputTokens: nonNegativeInteger(payload.usage?.input_tokens),
        outputTokens: nonNegativeInteger(payload.usage?.output_tokens),
        totalTokens: nonNegativeInteger(payload.usage?.total_tokens)
      }
    };
  } catch (error) {
    if (error instanceof SyntaxError) throw new ModelProviderResponseError("model provider returned invalid JSON");
    throw error;
  }
}

interface ResponsesPayload {
  status?: unknown;
  output?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown };
}

function finalOutputText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const item = value[index];
    if (!isObject(item) || item.type !== "message" || item.status !== "completed" || !Array.isArray(item.content)) continue;
    for (let contentIndex = item.content.length - 1; contentIndex >= 0; contentIndex -= 1) {
      const content = item.content[contentIndex];
      if (isObject(content) && content.type === "output_text" && typeof content.text === "string" && content.text.trim()) return content.text;
    }
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ModelProviderResponseError("model provider returned invalid usage");
  return value;
}
