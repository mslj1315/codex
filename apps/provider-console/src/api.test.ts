import { describe, expect, it, vi } from "vitest";
import { createProviderApiClient } from "./api";
import type { SessionClient } from "./session";

describe("provider API client", () => {
  it("marks whitelisted pricing reads as provider-console requests", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const session: SessionClient = { accessToken: () => "token", snapshot: () => null, set() {}, clear() {}, restore: async () => { throw new Error(); }, login: async () => { throw new Error(); }, logout: async () => {} };
    const api = createProviderApiClient(session, fetcher);
    await api.fetch("/v1/provider-model-pricing/versions"); await api.fetch("/v1/provider-model-pricing/usage?from=2026-08-01&to=2026-08-15");
    for (const [, init] of fetcher.mock.calls) expect(new Headers(init?.headers).get("X-Provider-Console-Request")).toBe("1");
  });
});
