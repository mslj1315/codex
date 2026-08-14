import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TemplateList } from './template-list';

describe('TemplateList', () => {
  it('shows a neutral forbidden state without list content', async () => {
    render(<TemplateList api={{ request: vi.fn().mockRejectedValue({ status: 403 }) } as never} />);
    expect(await screen.findByText('Access is unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('Customer')).toBeNull();
  });

  it('filters by name, status, industry, and category locally', async () => {
    const api = { request: vi.fn().mockResolvedValue([{ logicalId: '11111111-1111-1111-1111-111111111111', version: 2, status: 'published', name: 'Noodle story', content: {}, constraints: { industryCode: 'restaurant', categoryCode: 'noodle' }, fallbackScope: {} }, { logicalId: '22222222-2222-2222-2222-222222222222', version: 1, status: 'draft', name: 'Tea story', content: {}, constraints: { industryCode: 'cafe', categoryCode: 'tea' }, fallbackScope: {} }]) };
    const user = userEvent.setup();
    render(<TemplateList api={api as never} />);
    await screen.findByText('Noodle story');
    await user.selectOptions(screen.getByLabelText('Template status'), 'published');
    await user.type(screen.getByLabelText('Template name filter'), 'Noodle');
    expect(screen.getByText('Noodle story')).toBeInTheDocument();
    expect(screen.queryByText('Tea story')).toBeNull();
  });
});
