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
    ...overrides
  };
}

describe('App', () => {
  it('submits account ID and password to login', async () => {
    const user = userEvent.setup();
    const api = apiWith({ login: vi.fn().mockResolvedValue({ csrfToken: 'csrf', capabilities: { operatorAdmin: true } }) });
    render(<App api={api} />);

    await screen.findByLabelText('账号');
    await user.type(screen.getByLabelText('账号'), 'operator-1');
    await user.type(screen.getByLabelText('密码'), 'correct horse');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(api.login).toHaveBeenCalledWith('operator-1', 'correct horse');
    expect(await screen.findByRole('navigation')).toHaveTextContent('模板库');
  });

  it('returns to login when the restored session is absent', async () => {
    render(<App api={apiWith({ restoreSession: vi.fn().mockResolvedValue(undefined) })} />);

    expect(await screen.findByLabelText('账号')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
