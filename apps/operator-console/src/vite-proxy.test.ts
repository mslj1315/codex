// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import config, { operatorApiProxy } from '../vite.config';

describe('Vite operator API proxy', () => {
  it('proxies only API requests to the local API target', () => {
    expect(config.server?.proxy).toMatchObject({
      '/v1': expect.objectContaining({ target: 'http://127.0.0.1:3000', changeOrigin: true })
    });
  });

  it('rewrites the proxied Origin to the API origin', () => {
    const setHeader = vi.fn();
    const on = vi.fn((event: string, listener: (request: { setHeader(name: string, value: string): void }) => void) => {
      if (event === 'proxyReq') listener({ setHeader });
    });

    operatorApiProxy.configure({ on } as never);

    expect(setHeader).toHaveBeenCalledWith('origin', 'http://127.0.0.1:3000');
  });
});
