export interface OperatorSession {
  csrfToken: string;
  capabilities: { operatorAdmin: true };
  expiresAt?: string;
}

export interface SessionStore {
  current(): OperatorSession | undefined;
  set(session: OperatorSession): void;
  clear(): void;
}

export function createSessionStore(): SessionStore {
  let currentSession: OperatorSession | undefined;

  return {
    current: () => currentSession,
    set: (session) => { currentSession = session; },
    clear: () => { currentSession = undefined; }
  };
}
