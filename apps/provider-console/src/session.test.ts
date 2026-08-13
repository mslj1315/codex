import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProviderApiClient } from "./api";
import { createSessionClient, type ProviderSession } from "./session";

const session: ProviderSession = {
  accessToken: "access-token",
  expiresAt: "2026-08-13T12:00:00.000Z",
  account: { id: "account-viewer", displayName: "Viewer" },
  capabilities: {
    providerFeedbackViewer: true,
    metricCatalogOperator: false
  }
};

describe("provider console session", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("restores a session with same-origin credentials and the exact browser marker", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(session));
    const client = createSessionClient(fetcher);

    await expect(client.restore()).resolves.toEqual(session);

    expect(fetcher).toHaveBeenCalledWith("/v1/provider-auth/refresh", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Provider-Console-Request": "1" },
      signal: expect.any(AbortSignal)
    }));
    expect(client.accessToken()).toBe("access-token");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("shares one restore request across concurrent callers", async () => {
    let resolveRestore!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => {
      resolveRestore = resolve;
    }));
    const client = createSessionClient(fetcher);

    const first = client.restore();
    const second = client.restore();
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveRestore(jsonResponse(session));

    await expect(Promise.all([first, second])).resolves.toEqual([session, session]);
  });

  it("logs in with the marker and clears memory after logout even when logout fails", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(session))
      .mockRejectedValueOnce(new Error("network unavailable"));
    const client = createSessionClient(fetcher);

    await client.login("viewer", "secret");
    expect(fetcher).toHaveBeenNthCalledWith(1, "/v1/provider-auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Provider-Console-Request": "1"
      },
      body: JSON.stringify({ loginName: "viewer", password: "secret" })
    });

    await expect(client.logout()).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenNthCalledWith(2, "/v1/provider-auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Authorization: "Bearer access-token",
        "X-Provider-Console-Request": "1"
      }
    });
    expect(client.snapshot()).toBeNull();
  });

  it("shares one refresh across concurrent 401 responses and retries each request once", async () => {
    let resolveRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => { resolveRefresh = resolve; });
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get("Authorization");
      if (url === "/v1/provider-auth/refresh") return refreshResponse;
      if (authorization === "Bearer access-token") return new Response(null, { status: 401 });
      return jsonResponse({ ok: true });
    });
    const client = createSessionClient(fetcher);
    client.set(session);
    const api = createProviderApiClient(client, fetcher);

    const first = api.fetch("/v1/provider-feedback/stores?limit=50");
    const second = api.fetch("/v1/provider-feedback/stores?limit=25");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    resolveRefresh(jsonResponse({ ...session, accessToken: "replacement-token" }));

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 200 }),
      expect.objectContaining({ status: 200 })
    ]);
    expect(fetcher.mock.calls.filter(([url]) => url === "/v1/provider-auth/refresh")).toHaveLength(1);
    const retries = fetcher.mock.calls.filter(([, init]) =>
      new Headers(init?.headers).get("Authorization") === "Bearer replacement-token"
    );
    expect(retries).toHaveLength(2);
  });

  it("reuses the refreshed token when a concurrent old-token 401 arrives late", async () => {
    let releaseLateUnauthorized!: () => void;
    const lateUnauthorized = new Promise<Response>((resolve) => {
      releaseLateUnauthorized = () => resolve(new Response(null, { status: 401 }));
    });
    let oldTokenRequests = 0;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get("Authorization");
      if (url === "/v1/provider-auth/refresh") {
        return jsonResponse({ ...session, accessToken: "replacement-token" });
      }
      if (authorization === "Bearer access-token") {
        oldTokenRequests += 1;
        return oldTokenRequests === 1
          ? new Response(null, { status: 401 })
          : lateUnauthorized;
      }
      return jsonResponse({ ok: true });
    });
    const client = createSessionClient(fetcher);
    client.set(session);
    const api = createProviderApiClient(client, fetcher);

    const first = api.fetch("/v1/provider-feedback/stores?limit=50");
    const second = api.fetch("/v1/provider-feedback/stores?limit=25");
    await expect(first).resolves.toMatchObject({ status: 200 });
    releaseLateUnauthorized();
    await expect(second).resolves.toMatchObject({ status: 200 });

    expect(fetcher.mock.calls.filter(([url]) => url === "/v1/provider-auth/refresh")).toHaveLength(1);
  });

  it("clears the session when refresh fails after a 401", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const client = createSessionClient(fetcher);
    client.set(session);
    const api = createProviderApiClient(client, fetcher);

    await expect(api.fetch("/v1/provider-feedback/stores?limit=50"))
      .resolves.toMatchObject({ status: 401 });
    expect(client.snapshot()).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns a 403 without refreshing or clearing the session", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }));
    const client = createSessionClient(fetcher);
    client.set(session);
    const api = createProviderApiClient(client, fetcher);

    await expect(api.fetch("/v1/provider-feedback/stores?limit=50"))
      .resolves.toMatchObject({ status: 403 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.snapshot()).toEqual(session);
  });

  it("refuses to send a bearer token outside the provider feedback boundary", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createSessionClient(fetcher);
    client.set(session);
    const api = createProviderApiClient(client, fetcher);

    await expect(api.fetch("/v1/provider-auth/logout")).rejects.toThrow(
      "Provider API client only supports feedback routes"
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a feedback-looking path that normalizes outside the feedback route", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createSessionClient(fetcher);
    client.set(session);
    const api = createProviderApiClient(client, fetcher);

    await expect(api.fetch("/v1/provider-feedback/../provider-auth/logout")).rejects.toThrow(
      "Provider API client only supports feedback routes"
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects encoded traversal outside the feedback route", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createSessionClient(fetcher);
    client.set(session);
    const api = createProviderApiClient(client, fetcher);

    await expect(api.fetch("/v1/provider-feedback/%2e%2e/provider-auth/logout")).rejects.toThrow(
      "Provider API client only supports feedback routes"
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin network path even when its pathname is allowed", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createSessionClient(fetcher);
    client.set(session);
    const api = createProviderApiClient(client, fetcher);

    await expect(api.fetch("//provider-console.invalid/v1/provider-feedback/stores")).rejects.toThrow(
      "Provider API client only supports feedback routes"
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("makes logout the final operation when a restore is already pending", async () => {
    let resolveRestore!: (response: Response) => void;
    let restoreSignal: AbortSignal | null = null;
    const fetcher = vi.fn<typeof fetch>((input) => {
      if (String(input) === "/v1/provider-auth/refresh") {
        return new Promise<Response>((resolve) => { resolveRestore = resolve; });
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    const client = createSessionClient(fetcher);
    client.set(session);

    const restore = client.restore();
    const logout = client.logout();
    await expect(restore).rejects.toThrow("Session operation was superseded");
    await expect(logout).resolves.toBeUndefined();
    restoreSignal = fetcher.mock.calls[0][1]?.signal ?? null;
    expect(restoreSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenNthCalledWith(2, "/v1/provider-auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Authorization: "Bearer access-token",
        "X-Provider-Console-Request": "1"
      }
    });
    expect(client.snapshot()).toBeNull();

    resolveRestore(jsonResponse({ ...session, accessToken: "rotated-token" }));
    await Promise.resolve();
    expect(client.snapshot()).toBeNull();
  });

  it("does not let a stalled restore block logout", async () => {
    const fetcher = vi.fn<typeof fetch>((input) => {
      if (String(input) === "/v1/provider-auth/refresh") return new Promise<Response>(() => {});
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    const client = createSessionClient(fetcher);
    client.set(session);

    const restore = client.restore();
    const outcome = Promise.race([
      client.logout().then(() => "logged-out"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timed-out"), 100))
    ]);

    await expect(outcome).resolves.toBe("logged-out");
    await expect(restore).rejects.toThrow("Session operation was superseded");
    expect(fetcher).toHaveBeenNthCalledWith(2, "/v1/provider-auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Authorization: "Bearer access-token",
        "X-Provider-Console-Request": "1"
      }
    });
    expect(client.snapshot()).toBeNull();
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
