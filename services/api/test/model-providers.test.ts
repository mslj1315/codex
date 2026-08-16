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

function successfulResponsesResponse(content: unknown) {
  return {
    status: 200,
    json: async () => ({
      status: "completed",
      output: [{
        type: "message",
        status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(content) }]
      }],
      usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 }
    })
  };
}

describe("model providers", () => {
  it("uses the Responses API with disabled storage and maps completed structured output", async () => {
    const http: ModelHttpClient = { post: vi.fn().mockResolvedValue(successfulResponsesResponse([{ title: "午市排队的原因", angle: "后厨备料", productReference: "招牌牛肉面", goalReference: "到店", commercialLevel: 1 }])) };
    const service = createGenerationService({ provider: "openai_responses", model: "gpt-5.6-terra-openai-compact", apiKey: "openai-secret", baseUrl: "https://gateway.example/v1/", maxRetries: 0 }, { http });

    const result = await service.generateStructured({ requestId: "request-responses", promptVersion: "topic-v1", commercialLevel: 1, input: { inspiration: "早上熬汤" }, schema: topicArraySchema });

    expect(result).toMatchObject({ provider: "openai_responses", model: "gpt-5.6-terra-openai-compact", output: [{ title: "午市排队的原因" }], usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } });
    expect(http.post).toHaveBeenCalledWith(expect.objectContaining({ url: "https://gateway.example/v1/responses", headers: { authorization: "Bearer openai-secret", "content-type": "application/json" } }));
    expect(JSON.parse((http.post as ReturnType<typeof vi.fn>).mock.calls[0][0].body)).toMatchObject({
      model: "gpt-5.6-terra-openai-compact",
      store: false,
      text: { format: { type: "json_object" } },
      input: [{ role: "user", content: [{ type: "input_text", text: expect.any(String) }] }]
    });
    expect(JSON.parse(JSON.parse((http.post as ReturnType<typeof vi.fn>).mock.calls[0][0].body).input[0].content[0].text)).toMatchObject({ commercialLevel: 1, input: { inspiration: "早上熬汤" } });
  });

  it("rejects incomplete or malformed Responses output without retrying", async () => {
    const request = { requestId: "request-incomplete", promptVersion: "topic-v1", commercialLevel: 1 as const, input: {}, schema: topicArraySchema };
    const incomplete: ModelHttpClient = { post: vi.fn().mockResolvedValue({ status: 200, json: async () => ({ status: "in_progress", output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }) }) };
    const malformed: ModelHttpClient = { post: vi.fn().mockResolvedValue({ status: 200, json: async () => ({ status: "completed", output: [{ type: "message", status: "completed", content: [{ type: "output_text", text: "not json" }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }) }) };

    await expect(createGenerationService({ provider: "openai_responses", model: "test", apiKey: "key", maxRetries: 1 }, { http: incomplete }).generateStructured(request)).rejects.toThrow("structured content");
    await expect(createGenerationService({ provider: "openai_responses", model: "test", apiKey: "key", maxRetries: 1 }, { http: malformed }).generateStructured(request)).rejects.toThrow("invalid JSON");
    expect(incomplete.post).toHaveBeenCalledTimes(1);
    expect(malformed.post).toHaveBeenCalledTimes(1);
  });

  it("retries HTTP 429 Responses failures", async () => {
    const http: ModelHttpClient = { post: vi.fn().mockResolvedValueOnce({ status: 429, json: async () => ({}) }).mockResolvedValueOnce(successfulResponsesResponse([{ title: "午市", angle: "过程", productReference: "米线", goalReference: "到店", commercialLevel: 1 }])) };
    const service = createGenerationService({ provider: "openai_responses", model: "test", apiKey: "key", maxRetries: 1 }, { http, sleep: async () => undefined });

    await expect(service.generateStructured({ requestId: "request-429", promptVersion: "topic-v1", commercialLevel: 1, input: {}, schema: topicArraySchema })).resolves.toMatchObject({ provider: "openai_responses" });
    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it("rejects Responses output with missing usage instead of fabricating token counts", async () => {
    const http: ModelHttpClient = { post: vi.fn().mockResolvedValue({ status: 200, json: async () => ({ status: "completed", output: [{ type: "message", status: "completed", content: [{ type: "output_text", text: JSON.stringify([{ title: "午市", angle: "过程", productReference: "米线", goalReference: "到店", commercialLevel: 1 }]) }] }], usage: { input_tokens: 1, output_tokens: 1 } }) }) };
    const service = createGenerationService({ provider: "openai_responses", model: "test", apiKey: "key", maxRetries: 1 }, { http });

    await expect(service.generateStructured({ requestId: "request-missing-usage", promptVersion: "topic-v1", commercialLevel: 1, input: {}, schema: topicArraySchema })).rejects.toThrow("invalid usage");
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it("rejects non-object Responses envelopes without retrying", async () => {
    const request = { requestId: "request-non-object", promptVersion: "topic-v1", commercialLevel: 1 as const, input: {}, schema: topicArraySchema };
    for (const payload of [null, [], "completed"]) {
      const http: ModelHttpClient = { post: vi.fn().mockResolvedValue({ status: 200, json: async () => payload }) };
      await expect(createGenerationService({ provider: "openai_responses", model: "test", apiKey: "key", maxRetries: 1 }, { http }).generateStructured(request)).rejects.toThrow("invalid response");
      expect(http.post).toHaveBeenCalledTimes(1);
    }
  });
  it("normalizes DeepSeek requests and returns provider/model/usage metadata", async () => {
    const http: ModelHttpClient = { post: vi.fn().mockResolvedValue(successfulResponse([{ title: "午市排队的原因", angle: "后厨备料", productReference: "招牌牛肉面", goalReference: "到店", commercialLevel: 1 }])) };
    const service = createGenerationService({ provider: "deepseek", model: "deepseek-chat", apiKey: "deepseek-secret", maxRetries: 0 }, { http });

    const result = await service.generateStructured({ requestId: "request-1", promptVersion: "topic-v1", commercialLevel: 1, input: { inspiration: "早上熬汤" }, schema: topicArraySchema });

    expect(result).toMatchObject({ provider: "deepseek", model: "deepseek-chat", output: [{ title: "午市排队的原因" }], usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(http.post).toHaveBeenCalledWith(expect.objectContaining({ url: "https://api.deepseek.com/chat/completions", headers: { authorization: "Bearer deepseek-secret", "content-type": "application/json" } }));
    expect(JSON.parse((http.post as ReturnType<typeof vi.fn>).mock.calls[0][0].body)).toMatchObject({ model: "deepseek-chat", response_format: { type: "json_object" } });
    expect(JSON.parse(JSON.parse((http.post as ReturnType<typeof vi.fn>).mock.calls[0][0].body).messages[0].content)).toMatchObject({ commercialLevel: 1 });
  });

  it("normalizes Qwen requests without changing the configured provider", async () => {
    const http: ModelHttpClient = { post: vi.fn().mockResolvedValue(successfulResponse([{ title: "师傅备料", angle: "手艺", productReference: "米线", goalReference: "认知", commercialLevel: 1 }])) };
    const service = createGenerationService({ provider: "qwen", model: "qwen-plus", apiKey: "qwen-secret", maxRetries: 0 }, { http });

    await service.generateStructured({ requestId: "request-2", promptVersion: "topic-v1", commercialLevel: 1, input: { inspiration: "现熬" }, schema: topicArraySchema });

    expect(http.post).toHaveBeenCalledWith(expect.objectContaining({ url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", headers: { authorization: "Bearer qwen-secret", "content-type": "application/json" } }));
    expect(JSON.parse(JSON.parse((http.post as ReturnType<typeof vi.fn>).mock.calls[0][0].body).messages[0].content)).toMatchObject({ commercialLevel: 1 });
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
    const service = createGenerationService({ provider: "deepseek", model: "deepseek-chat", apiKey: "key", maxRetries: 2 }, { http });

    await expect(service.generateStructured({ requestId: "request-5", promptVersion: "topic-v1", commercialLevel: 1, input: {}, schema: topicArraySchema })).rejects.toThrow("structured output");
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it("does not retry upstream client failures or malformed provider responses", async () => {
    const clientFailure: ModelHttpClient = { post: vi.fn().mockResolvedValue({ status: 400, json: async () => ({}) }) };
    const malformed: ModelHttpClient = { post: vi.fn().mockResolvedValue({ status: 200, json: async () => ({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) }) };
    const request = { requestId: "request-no-retry", promptVersion: "topic-v1", commercialLevel: 1 as const, input: {}, schema: topicArraySchema };

    await expect(createGenerationService({ provider: "deepseek", model: "deepseek-chat", apiKey: "key", maxRetries: 2 }, { http: clientFailure }).generateStructured(request)).rejects.toThrow("HTTP 400");
    await expect(createGenerationService({ provider: "deepseek", model: "deepseek-chat", apiKey: "key", maxRetries: 2 }, { http: malformed }).generateStructured(request)).rejects.toThrow("structured content");
    expect(clientFailure.post).toHaveBeenCalledTimes(1);
    expect(malformed.post).toHaveBeenCalledTimes(1);
  });

  it("does not retry 401 or 403 but retries a selected upstream 5xx", async () => {
    const request = { requestId: "request-status", promptVersion: "topic-v1", commercialLevel: 1 as const, input: {}, schema: topicArraySchema };
    for (const status of [401, 403]) {
      const http: ModelHttpClient = { post: vi.fn().mockResolvedValue({ status, json: async () => ({}) }) };
      await expect(createGenerationService({ provider: "qwen", model: "qwen-plus", apiKey: "key", maxRetries: 1 }, { http }).generateStructured(request)).rejects.toThrow(`HTTP ${status}`);
      expect(http.post).toHaveBeenCalledTimes(1);
    }
    const retryable: ModelHttpClient = { post: vi.fn().mockResolvedValueOnce({ status: 503, json: async () => ({}) }).mockResolvedValueOnce(successfulResponse([{ title: "午市", angle: "过程", productReference: "米线", goalReference: "到店", commercialLevel: 1 }])) };
    await expect(createGenerationService({ provider: "qwen", model: "qwen-plus", apiKey: "key", maxRetries: 1 }, { http: retryable, sleep: async () => undefined }).generateStructured(request)).resolves.toMatchObject({ provider: "qwen" });
    expect(retryable.post).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed upstream usage rather than fabricating zero values", async () => {
    const http: ModelHttpClient = { post: vi.fn().mockResolvedValue({ status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify([{ title: "午市", angle: "过程", productReference: "米线", goalReference: "到店", commercialLevel: 1 }]) } }], usage: { prompt_tokens: -1, completion_tokens: 1.5, total_tokens: "2" } }) }) };
    const service = createGenerationService({ provider: "deepseek", model: "deepseek-chat", apiKey: "key", maxRetries: 2 }, { http });

    await expect(service.generateStructured({ requestId: "request-usage", promptVersion: "topic-v1", commercialLevel: 1, input: {}, schema: topicArraySchema })).rejects.toThrow("usage");
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it("does not retry an outer provider JSON parsing failure", async () => {
    const http: ModelHttpClient = { post: vi.fn().mockResolvedValue({ status: 200, json: async () => { throw new SyntaxError("unexpected end of JSON input"); } }) };
    const service = createGenerationService({ provider: "qwen", model: "qwen-plus", apiKey: "key", maxRetries: 1 }, { http });

    await expect(service.generateStructured({ requestId: "request-json", promptVersion: "topic-v1", commercialLevel: 1, input: {}, schema: topicArraySchema })).rejects.toThrow("invalid JSON");
    expect(http.post).toHaveBeenCalledTimes(1);
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
    expect(() => createConfiguredGenerationService({ MODEL_PROVIDER: "deepseek", MODEL_MODEL: "deepseek-chat", MODEL_API_KEY: "key", MODEL_BASE_URL: " " })).toThrow("MODEL_BASE_URL");
    expect(() => createConfiguredGenerationService({ MODEL_PROVIDER: "deepseek", MODEL_MODEL: "deepseek-chat", MODEL_API_KEY: "key", MODEL_BASE_URL: "http://provider.example/v1" })).toThrow("MODEL_BASE_URL");
    expect(() => createConfiguredGenerationService({ MODEL_PROVIDER: "deepseek", MODEL_MODEL: "deepseek-chat", MODEL_API_KEY: "key", MODEL_BASE_URL: "not-a-url" })).toThrow("MODEL_BASE_URL");
    expect(() => createConfiguredGenerationService({ MODEL_PROVIDER: "openai_responses", MODEL_MODEL: "test", MODEL_API_KEY: "key", MODEL_BASE_URL: "https://gateway.example/v1?tenant=one" })).toThrow("MODEL_BASE_URL");
    expect(() => createConfiguredGenerationService({ MODEL_PROVIDER: "openai_responses", MODEL_MODEL: "test", MODEL_API_KEY: "key", MODEL_BASE_URL: "https://gateway.example/v1#fragment" })).toThrow("MODEL_BASE_URL");
    expect(createConfiguredGenerationService({ MODEL_PROVIDER: "openai_responses", MODEL_MODEL: "gpt-5.6-terra-openai-compact", MODEL_API_KEY: "key", MODEL_BASE_URL: "https://gateway.example/v1" })).toBeDefined();
  });
});
