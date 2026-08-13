export interface ProviderAccount {
  id: string;
  displayName: string;
}

export interface ProviderCapabilities {
  providerFeedbackViewer: boolean;
  metricCatalogOperator: boolean;
}

export interface ProviderSession {
  accessToken: string;
  expiresAt: string;
  account: ProviderAccount;
  capabilities: ProviderCapabilities;
}

export interface SessionClient {
  accessToken(): string | null;
  snapshot(): ProviderSession | null;
  set(session: ProviderSession): void;
  clear(): void;
  restore(): Promise<ProviderSession>;
  login(loginName: string, password: string): Promise<ProviderSession>;
  logout(): Promise<void>;
}

const authHeaders = { "X-Provider-Console-Request": "1" } as const;

export function createSessionClient(fetcher: typeof fetch = fetch): SessionClient {
  let current: ProviderSession | null = null;
  let restoreInFlight: Promise<ProviderSession> | null = null;
  let logoutInFlight: Promise<void> | null = null;
  let generation = 0;

  async function requestSession(path: string, init: RequestInit): Promise<ProviderSession> {
    const requestGeneration = generation;
    const response = await fetcher(path, init);
    if (!response.ok) throw response;
    const session = await response.json() as ProviderSession;
    if (requestGeneration !== generation) throw new Error("Session operation was superseded");
    current = session;
    return session;
  }

  return {
    accessToken: () => current?.accessToken ?? null,
    snapshot: () => current,
    set(session) {
      generation += 1;
      current = session;
    },
    clear() {
      generation += 1;
      current = null;
    },
    restore() {
      if (logoutInFlight) return Promise.reject(new Error("Logout is in progress"));
      if (!restoreInFlight) {
        restoreInFlight = requestSession("/v1/provider-auth/refresh", {
          method: "POST",
          credentials: "same-origin",
          headers: authHeaders
        }).finally(() => { restoreInFlight = null; });
      }
      return restoreInFlight;
    },
    login(loginName, password) {
      return requestSession("/v1/provider-auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders
        },
        body: JSON.stringify({ loginName, password })
      });
    },
    logout() {
      if (!logoutInFlight) {
        const accessToken = current?.accessToken;
        generation += 1;
        current = null;
        logoutInFlight = (async () => {
          if (restoreInFlight) {
            try { await restoreInFlight; } catch { /* Logout still clears the cookie. */ }
          }
          try {
            await fetcher("/v1/provider-auth/logout", {
              method: "POST",
              credentials: "same-origin",
              headers: {
                ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                ...authHeaders
              }
            });
          } catch {
            // Local logout is authoritative even when the revocation request fails.
          } finally {
            current = null;
          }
        })().finally(() => { logoutInFlight = null; });
      }
      return logoutInFlight;
    }
  };
}

export const sessionClient = createSessionClient();
