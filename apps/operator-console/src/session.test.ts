import { describe, expect, it } from 'vitest';
import { createSessionStore } from './session';

describe('session store', () => {
  it('keeps only the CSRF token in memory', () => {
    const session = createSessionStore();

    session.set({ csrfToken: 'csrf-value', capabilities: { operatorAdmin: true } });

    expect(session.current()).toEqual({ csrfToken: 'csrf-value', capabilities: { operatorAdmin: true } });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
