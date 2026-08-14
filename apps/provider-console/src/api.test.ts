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

  it('rejects arbitrary URLs and caller supplied authorization', async () => {
    const api = createOperatorApi(createSessionStore());

    await expect(api.request('GET', 'https://example.test/steal')).rejects.toThrow('Unsupported operator API request');
    await expect(api.request('GET', '/v1/provider/customers')).rejects.toThrow('Unsupported operator API request');
  });
});
