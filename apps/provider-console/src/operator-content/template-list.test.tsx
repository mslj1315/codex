import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TemplateList } from './template-list';

describe('TemplateList', () => {
  it('shows a neutral forbidden state without list content', async () => {
    render(<TemplateList api={{ request: vi.fn().mockRejectedValue({ status: 403 }) } as never} />);
    expect(await screen.findByText('Access is unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('Customer')).toBeNull();
  });
});
