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

  async function send(path: string, init: RequestInit, token: string | null): Promise<Response> {
    return fetcher(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
  }

  return {
    async fetch(path, init = {}) {
      const target = new URL(path, window.location.origin);
      if (
        !path.startsWith("/")
        || target.origin !== window.location.origin
        || target.pathname !== "/v1/provider-feedback/stores"
        || target.hash !== ""
      ) {
        throw new Error("Provider API client only supports feedback routes");
      }
      const normalizedPath = target.pathname + target.search;
      const initialToken = session.accessToken();
      const initial = await send(normalizedPath, init, initialToken);
      if (initial.status !== 401) return initial;
      const replacementToken = session.accessToken();
      if (replacementToken === initialToken && !await refresh()) return initial;

      const retry = await send(normalizedPath, init, session.accessToken());
      if (retry.status === 401) session.clear();
      return retry;
    }
  };
}

import { sessionClient } from "./session";

export const providerApiClient = createProviderApiClient(sessionClient);
