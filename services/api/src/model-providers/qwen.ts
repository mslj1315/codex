import { parseChatResponse } from "./deepseek.js";
import type { ModelHttpClient, ModelProvider, ProviderRequest, ProviderResponse } from "./provider.js";

const QWEN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

export class QwenProvider implements ModelProvider {
  readonly id = "qwen" as const;

  constructor(private readonly apiKey: string, private readonly http: ModelHttpClient, private readonly baseUrl = QWEN_URL) {}

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const response = await this.http.post({
      url: this.baseUrl,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: JSON.stringify({ requestId: request.requestId, promptVersion: request.promptVersion, commercialLevel: request.commercialLevel, input: request.input }) }]
      }),
      signal: request.signal
    });
    return parseChatResponse(response);
  }
}
