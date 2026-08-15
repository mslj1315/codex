import type { SessionClient } from "./session";

export interface ProviderApiClient {
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

export function createProviderApiClient(
  session: SessionClient,
  fetcher: typeof fetch = fetch
): ProviderApiClient {
  let refreshInFlight: Promise<boolean> | null = null;

  async function refresh(): Promise<boolean> {
    if (!refreshInFlight) {
      refreshInFlight = session.restore()
        .then(() => true)
        .catch(() => {
          session.clear();
          return false;
        })
        .finally(() => { refreshInFlight = null; });
    }
    return refreshInFlight;
  }

  async function send(path: string, init: RequestInit, token: string | null, requiresProviderMarker: boolean): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.delete("Authorization");
    headers.delete("X-Provider-Console-Request");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (requiresProviderMarker) headers.set("X-Provider-Console-Request", "1");
    return fetcher(path, {
      ...init,
      credentials: "same-origin",
      headers
    });
  }

  return {
    async fetch(path, init = {}) {
      const target = new URL(path, window.location.origin);
      const method = (init.method ?? "GET").toUpperCase();
      const metadataRoute = /^\/v1\/provider-customers\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/metadata$/;
      const isList = method === "GET" && (target.pathname === "/v1/provider-customers" || target.pathname === "/v1/provider-model-pricing/versions" || target.pathname === "/v1/provider-model-pricing/usage");
      const priceMutation = /^\/v1\/provider-model-pricing\/versions(?:\/[A-Za-z0-9-]+(?:\/(?:publish|retire))?)?$/.test(target.pathname) && ["POST", "PUT"].includes(method);
      const isMutation = (method === "PUT" && metadataRoute.test(target.pathname) && target.search === "") || priceMutation;
      const requiresProviderMarker = isMutation || (method === "GET" && (target.pathname === "/v1/provider-model-pricing/versions" || target.pathname === "/v1/provider-model-pricing/usage"));
      if (
        !path.startsWith("/")
        || path.startsWith("//")
        || target.origin !== window.location.origin
        || target.hash !== ""
        || (!isList && !isMutation)
      ) {
        throw new Error("Provider API client only supports approved provider routes");
      }
      const normalizedPath = target.pathname + target.search;
      const initialToken = session.accessToken();
      const initial = await send(normalizedPath, init, initialToken, requiresProviderMarker);
      if (initial.status !== 401) return initial;
      const replacementToken = session.accessToken();
      if (replacementToken === initialToken && !await refresh()) return initial;

      const retry = await send(normalizedPath, init, session.accessToken(), requiresProviderMarker);
      if (retry.status === 401) session.clear();
      return retry;
    }
  };
}

import { sessionClient } from "./session";

export const providerApiClient = createProviderApiClient(sessionClient);
