import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOperatorApi } from './api';
import { createSessionStore } from './session';

describe('operator API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends account credentials only to the fixed login endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ csrfToken: 'csrf', capabilities: { operatorAdmin: true } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createOperatorApi(createSessionStore());

    await api.login('operator-1', 'correct horse');

    expect(fetchMock).toHaveBeenCalledWith('/v1/operator-auth/login', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'operator-1', password: 'correct horse' })
    }));
  });

  it('adds same-origin credentials and CSRF to allowed mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const session = createSessionStore();
    session.set({ csrfToken: 'csrf', capabilities: { operatorAdmin: true } });
    const api = createOperatorApi(session);

    await api.request('POST', '/v1/operator-content/templates', { name: 'test' });

    expect(fetchMock).toHaveBeenCalledWith('/v1/operator-content/templates', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf' }
    }));
  });

  it.each(['/v1/operator-content/templates', '/v1/operator-content/rules'])('allows a fixed create endpoint %s', async (path) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const session = createSessionStore();
    session.set({ csrfToken: 'csrf', capabilities: { operatorAdmin: true } });

    await createOperatorApi(session).request('POST', path, { name: 'draft' });

    expect(fetchMock).toHaveBeenCalledWith(path, expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf' }) }));
  });

  it('rejects arbitrary URLs and caller supplied authorization', async () => {
    const api = createOperatorApi(createSessionStore());

    await expect(api.request('GET', 'https://example.test/steal')).rejects.toThrow('Unsupported operator API request');
    await expect(api.request('GET', '/v1/provider/customers')).rejects.toThrow('Unsupported operator API request');
  });

  it('clears session and notifies the shell when a protected request is forbidden', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const session = createSessionStore();
    session.set({ csrfToken: 'csrf', capabilities: { operatorAdmin: true } });
    const api = createOperatorApi(session);
    const expired = vi.fn();
    api.onSessionExpired(expired);

    await expect(api.request('POST', '/v1/operator-content/templates', { name: 'test' })).rejects.toMatchObject({ status: 403 });

    expect(session.current()).toBeUndefined();
    expect(expired).toHaveBeenCalledOnce();
  });

  it('clears session and notifies the shell on an unauthorized protected request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const session = createSessionStore();
    session.set({ csrfToken: 'csrf', capabilities: { operatorAdmin: true } });
    const api = createOperatorApi(session);
    const expired = vi.fn();
    api.onSessionExpired(expired);

    await expect(api.request('GET', '/v1/operator-content/templates')).rejects.toMatchObject({ status: 401 });
    expect(session.current()).toBeUndefined();
    expect(expired).toHaveBeenCalledOnce();
  });

  it.each(['/v1/operator-content/templates/%2e%2e/rules', '/v1/operator-content/templates/%2F', '/v1/operator-content/templates/..', '/v1/operator-content/templates\\x', '/v1/operator-content/templates?x=1', '/v1/operator-content/templates#x'])('rejects normalized route escape %s', async (path) => {
    const api = createOperatorApi(createSessionStore());

    await expect(api.request('GET', path)).rejects.toThrow('Unsupported operator API request');
  });
});
