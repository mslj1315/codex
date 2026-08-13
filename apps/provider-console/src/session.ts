export interface ProviderAccount {
  id: string;
  displayName: string;
}

export interface ProviderCapabilities {
  providerFeedbackViewer: boolean;
  providerCustomerMetadataEditor: boolean;
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
  let restoreController: AbortController | null = null;
  let logoutInFlight: Promise<void> | null = null;
  let generation = 0;

  async function requestSession(
    path: string,
    init: RequestInit,
    signal?: AbortSignal
  ): Promise<ProviderSession> {
    const requestGeneration = generation;
    const request = fetcher(path, { ...init, ...(signal ? { signal } : {}) });
    const response = signal ? await abortable(request, signal) : await request;
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
        const controller = new AbortController();
        restoreController = controller;
        const pending = requestSession("/v1/provider-auth/refresh", {
          method: "POST",
          credentials: "same-origin",
          headers: authHeaders
        }, controller.signal);
        restoreInFlight = pending.finally(() => {
          if (restoreController === controller) restoreController = null;
          restoreInFlight = null;
        });
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
        restoreController?.abort(new Error("Session operation was superseded"));
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

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

export const sessionClient = createSessionClient();
