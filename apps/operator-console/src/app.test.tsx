import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './app';
import type { OperatorApi } from './api';

function apiWith(overrides: Partial<OperatorApi>): OperatorApi {
  return {
    login: vi.fn(),
    logout: vi.fn(),
    restoreSession: vi.fn().mockResolvedValue(undefined),
    request: vi.fn(),
    onSessionExpired: vi.fn(() => () => undefined),
    ...overrides
  };
}

describe('App', () => {
  it('submits account credentials to login', async () => {
    const user = userEvent.setup();
    const api = apiWith({ login: vi.fn().mockResolvedValue({ csrfToken: 'csrf', capabilities: { operatorAdmin: true } }) });
    render(<App api={api} />);

    const accountId = await screen.findByRole('textbox');
    const password = document.querySelector<HTMLInputElement>('input[name="password"]')!;
    await user.type(accountId, 'operator-1');
    await user.type(password, 'correct horse');
    await user.click(screen.getByRole('button'));

    expect(api.login).toHaveBeenCalledWith('operator-1', 'correct horse');
    expect(await screen.findByRole('navigation')).toBeInTheDocument();
  });

  it('does not render navigation when the restored session is absent', async () => {
    render(<App api={apiWith({ restoreSession: vi.fn().mockResolvedValue(undefined) })} />);

    expect(await screen.findByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('returns to login and removes navigation when a protected request expires', async () => {
    let expireSession: (() => void) | undefined;
    const api = apiWith({
      restoreSession: vi.fn().mockResolvedValue({ csrfToken: 'csrf', capabilities: { operatorAdmin: true } }),
      onSessionExpired: vi.fn((listener) => { expireSession = listener; return () => undefined; })
    });
    render(<App api={api} />);

    expect(await screen.findByRole('navigation')).toBeInTheDocument();
    expireSession?.();

    expect(await screen.findByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
