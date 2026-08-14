import { describe, expect, it, vi } from "vitest";
import {
  copyDraftsSchema,
  createConfiguredGenerationService,
  createGenerationService,
  type ModelHttpClient,
  shotListSchema,
  topicArraySchema
} from "../src/model-providers/generation.js";

function successfulResponse(content: unknown) {
  return {
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
    })
  };
}

describe("model providers", () => {
  it("normalizes DeepSeek requests and returns provider/model/usage metadata", async () => {
    const http: ModelHttpClient = { post: vi.fn().mockResolvedValue(successfulResponse([{ title: "午市排队的原因", angle: "后厨备料", productReference: "招牌牛肉面", goalReference: "到店", commercialLevel: 1 }])) };
    const service = createGenerationService({ provider: "deepseek", model: "deepseek-chat", apiKey: "deepseek-secret", maxRetries: 0 }, { http });

    const result = await service.generateStructured({ requestId: "request-1", promptVersion: "topic-v1", commercialLevel: 1, input: { inspiration: "早上熬汤" }, schema: topicArraySchema });

    expect(result).toMatchObject({ provider: "deepseek", model: "deepseek-chat", output: [{ title: "午市排队的原因" }], usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(http.post).toHaveBeenCalledWith(expect.objectContaining({ url: "https://api.deepseek.com/chat/completions", headers: { authorization: "Bearer deepseek-secret", "content-type": "application/json" } }));
    expect(JSON.parse((http.post as ReturnType<typeof vi.fn>).mock.calls[0][0].body)).toMatchObject({ model: "deepseek-chat", response_format: { type: "json_object" } });
  });

  it("normalizes Qwen requests without changing the configured provider", async () => {
    const http: ModelHttpClient = { post: vi.fn().mockResolvedValue(successfulResponse([{ title: "师傅备料", angle: "手艺", productReference: "米线", goalReference: "认知", commercialLevel: 1 }])) };
    const service = createGenerationService({ provider: "qwen", model: "qwen-plus", apiKey: "qwen-secret", maxRetries: 0 }, { http });

    await service.generateStructured({ requestId: "request-2", promptVersion: "topic-v1", commercialLevel: 1, input: { inspiration: "现熬" }, schema: topicArraySchema });

    expect(http.post).toHaveBeenCalledWith(expect.objectContaining({ url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", headers: { authorization: "Bearer qwen-secret", "content-type": "application/json" } }));
  });

  it("retries a transient failure only with the same configured provider", async () => {
    const http: ModelHttpClient = { post: vi.fn().mockRejectedValueOnce(new Error("temporary upstream failure")).mockResolvedValueOnce(successfulResponse([{ title: "午市", angle: "过程", productReference: "米线", goalReference: "到店", commercialLevel: 1 }])) };
    const service = createGenerationService({ provider: "deepseek", model: "deepseek-chat", apiKey: "key", maxRetries: 1 }, { http, sleep: async () => undefined });

    const result = await service.generateStructured({ requestId: "request-3", promptVersion: "topic-v1", commercialLevel: 1, input: {}, schema: topicArraySchema });

    expect(result.provider).toBe("deepseek");
    expect(http.post).toHaveBeenCalledTimes(2);
    expect((http.post as ReturnType<typeof vi.fn>).mock.calls.every((call) => call[0].url.includes("deepseek.com"))).toBe(true);
  });

  it("aborts a timed-out request and does not retry beyond its configured bound", async () => {
    let aborted = false;
    const http: ModelHttpClient = { post: vi.fn(({ signal }: Parameters<ModelHttpClient["post"]>[0]): Promise<never> => new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }))) };
    const service = createGenerationService({ provider: "qwen", model: "qwen-plus", apiKey: "key", timeoutMs: 5, maxRetries: 0 }, { http });

    await expect(service.generateStructured({ requestId: "request-4", promptVersion: "topic-v1", commercialLevel: 1, input: {}, schema: topicArraySchema })).rejects.toThrow("timed out");
    expect(aborted).toBe(true);
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed model output before it can become a structured result", async () => {
    const http: ModelHttpClient = { post: vi.fn().mockResolvedValue(successfulResponse([{ title: "no required fields" }])) };
    const service = createGenerationService({ provider: "deepseek", model: "deepseek-chat", apiKey: "key", maxRetries: 0 }, { http });

    await expect(service.generateStructured({ requestId: "request-5", promptVersion: "topic-v1", commercialLevel: 1, input: {}, schema: topicArraySchema })).rejects.toThrow("structured output");
  });

  it("enforces future copy and shot-list safety bounds", () => {
    expect(() => copyDraftsSchema.parse([{ title: "one", body: "a", strategy: "story", productReference: "米线", goalReference: "到店", commercialLevel: 1 }, { title: "two", body: "b", strategy: "expert", productReference: "米线", goalReference: "到店", commercialLevel: 1 }, { title: "three", body: "c", strategy: "life", productReference: "米线", goalReference: "到店", commercialLevel: 1 }], 1)).not.toThrow();
    expect(() => copyDraftsSchema.parse([{ title: "one", body: "a", strategy: "story", productReference: "米线", goalReference: "到店", commercialLevel: 1 }, { title: "two", body: "b", strategy: "story", productReference: "米线", goalReference: "到店", commercialLevel: 1 }, { title: "three", body: "c", strategy: "life", productReference: "米线", goalReference: "到店", commercialLevel: 1 }], 1)).toThrow("distinct strategies");
    expect(() => copyDraftsSchema.parse([{ title: "same", body: "same", strategy: "story", productReference: "米线", goalReference: "到店", commercialLevel: 1 }, { title: "same", body: "same", strategy: "expert", productReference: "米线", goalReference: "到店", commercialLevel: 1 }, { title: "same", body: "same", strategy: "life", productReference: "米线", goalReference: "到店", commercialLevel: 1 }], 1)).toThrow("materially distinct");
    expect(() => topicArraySchema.parse([{ title: "午市", angle: "过程", productReference: "米线", goalReference: "到店", commercialLevel: 2 }], 1)).toThrow("commercial level");
    expect(() => copyDraftsSchema.parse([{ title: "one", body: "a", strategy: "story", productReference: "米线", goalReference: "到店", commercialLevel: 2 }, { title: "two", body: "b", strategy: "expert", productReference: "米线", goalReference: "到店", commercialLevel: 1 }, { title: "three", body: "c", strategy: "life", productReference: "米线", goalReference: "到店", commercialLevel: 1 }], 1)).toThrow("commercial level");
    expect(() => shotListSchema.parse([{ order: 0, shot: "汤锅", durationSeconds: 3, narration: "现熬", productReference: "米线", goalReference: "到店", commercialLevel: 1 }], 1)).toThrow("safe integer");
    expect(() => shotListSchema.parse([{ order: 1, shot: "汤锅", durationSeconds: 3, narration: "现熬", productReference: "米线", goalReference: "到店", commercialLevel: 2 }], 1)).toThrow("commercial level");
  });

  it("does not create a callable service when model configuration is absent or partial", () => {
    expect(createConfiguredGenerationService({})).toBeUndefined();
    expect(() => createConfiguredGenerationService({ MODEL_PROVIDER: "deepseek", MODEL_API_KEY: "key" })).toThrow("MODEL_MODEL");
  });
});
