import type { OperatorSession, SessionStore } from './session';

type OperatorMethod = 'GET' | 'POST' | 'PUT';

export interface OperatorApi {
  login(accountId: string, password: string): Promise<OperatorSession>;
  logout(): Promise<void>;
  restoreSession(): Promise<OperatorSession | undefined>;
  request(method: OperatorMethod, path: string, body?: unknown): Promise<unknown>;
}

export class OperatorApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const allowedRequests: ReadonlyArray<{ method: OperatorMethod; path: RegExp }> = [
  { method: 'GET', path: /^\/v1\/operator-auth\/session$/ },
  { method: 'POST', path: /^\/v1\/operator-auth\/(login|logout)$/ },
  { method: 'GET', path: /^\/v1\/operator-content\/templates(?:\/(?:match|[^/]+\/(?:versions(?:\/\d+)?|history)))?$/ },
  { method: 'POST', path: /^\/v1\/operator-content\/templates(?:\/[^/]+\/versions\/\d+\/(?:publish|disable))?$/ },
  { method: 'PUT', path: /^\/v1\/operator-content\/templates\/[^/]+\/draft$/ },
  { method: 'GET', path: /^\/v1\/operator-content\/rules(?:\/(?:active|[^/]+\/(?:versions(?:\/\d+)?|history)))?$/ },
  { method: 'POST', path: /^\/v1\/operator-content\/rules(?:\/(?:preview|[^/]+\/versions\/\d+\/(?:publish|disable)))?$/ },
  { method: 'PUT', path: /^\/v1\/operator-content\/rules\/[^/]+\/draft$/ }
];

export function createOperatorApi(sessionStore: SessionStore): OperatorApi {
  async function request(method: OperatorMethod, path: string, body?: unknown): Promise<unknown> {
    if (!isAllowed(method, path)) throw new Error('Unsupported operator API request');
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') {
      const csrfToken = sessionStore.current()?.csrfToken;
      if (path !== '/v1/operator-auth/login' && !csrfToken) throw new OperatorApiError(403, 'Session expired');
      if (path !== '/v1/operator-auth/login' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch(path, {
      method,
      credentials: 'include',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (!response.ok) throw new OperatorApiError(response.status, await errorMessage(response));
    if (response.status === 204) return undefined;
    return response.json() as Promise<unknown>;
  }

  return {
    async login(accountId, password) {
      const response = await request('POST', '/v1/operator-auth/login', { accountId, password });
      const session = readSession(response);
      sessionStore.set(session);
      return session;
    },
    async logout() {
      await request('POST', '/v1/operator-auth/logout');
      sessionStore.clear();
    },
    async restoreSession() {
      try {
        const response = await request('GET', '/v1/operator-auth/session');
        const session = readSession(response);
        sessionStore.set(session);
        return session;
      } catch (error) {
        if (error instanceof OperatorApiError && error.status === 403) {
          sessionStore.clear();
          return undefined;
        }
        throw error;
      }
    },
    request
  };
}

function isAllowed(method: OperatorMethod, path: string): boolean {
  return path.startsWith('/') && !path.includes('?') && allowedRequests.some((entry) => entry.method === method && entry.path.test(path));
}

function readSession(value: unknown): OperatorSession {
  if (!isRecord(value) || typeof value.csrfToken !== 'string' || !isRecord(value.capabilities) || value.capabilities.operatorAdmin !== true) {
    throw new OperatorApiError(403, 'Session expired');
  }
  return { csrfToken: value.csrfToken, capabilities: { operatorAdmin: true }, ...(typeof value.expiresAt === 'string' ? { expiresAt: value.expiresAt } : {}) };
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const value: unknown = await response.json();
    return isRecord(value) && typeof value.error === 'string' ? value.error : 'Request failed';
  } catch {
    return 'Request failed';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
