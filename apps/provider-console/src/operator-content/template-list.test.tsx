import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TemplateList } from './template-list';
import type { Template } from './types';

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

  it('keeps the later selection when an earlier detail, versions, and history response arrives late', async () => {
    const a = item('11111111-1111-1111-1111-111111111111', 'A template', 1);
    const b = item('22222222-2222-2222-2222-222222222222', 'B template', 2);
    const pending = new Map<string, ReturnType<typeof deferred>>();
    const request = vi.fn((method: string, path: string) => {
      if (method === 'GET' && path === '/v1/operator-content/templates') return Promise.resolve([a, b]);
      const next = deferred<unknown>();
      pending.set(path, next);
      return next.promise;
    });
    const user = userEvent.setup();
    render(<TemplateList api={{ request } as never} />);
    await screen.findByText('A template');
    await user.click(screen.getByRole('button', { name: /A template/ }));
    await user.click(screen.getByRole('button', { name: /B template/ }));

    resolveSelection(pending, b, [{ ...b, version: 2 }, { ...b, version: 1, status: 'published' }], [{ version: 2, eventType: 'draft_saved' }]);
    expect(await screen.findByRole('heading', { name: 'B template v2' })).toBeInTheDocument();
    expect(screen.getByText('v2 · draft_saved')).toBeInTheDocument();

    resolveSelection(pending, a, [a], [{ version: 1, eventType: 'a_late_event' }]);
    expect(screen.getByRole('heading', { name: 'B template v2' })).toBeInTheDocument();
    expect(screen.getByText('v2 · draft_saved')).toBeInTheDocument();
    expect(screen.queryByText('v1 · a_late_event')).toBeNull();
  });

  it('keeps the new-template editor when an older selection completes late', async () => {
    const a = item('11111111-1111-1111-1111-111111111111', 'A template', 1);
    const pending = new Map<string, ReturnType<typeof deferred>>();
    const request = vi.fn((method: string, path: string) => method === 'GET' && path === '/v1/operator-content/templates' ? Promise.resolve([a]) : (() => { const next = deferred<unknown>(); pending.set(path, next); return next.promise; })());
    const user = userEvent.setup();
    render(<TemplateList api={{ request } as never} />);
    await user.click(await screen.findByRole('button', { name: /A template/ }));
    await user.click(screen.getByRole('button', { name: 'New template' }));
    resolveSelection(pending, a, [a], [{ version: 1, eventType: 'a_late_event' }]);
    expect(await screen.findByRole('heading', { name: 'New template' })).toBeInTheDocument();
    expect(screen.queryByText('v1 · a_late_event')).toBeNull();
  });
});

function item(logicalId: string, name: string, version: number): Template {
  return { logicalId, version, status: 'draft' as const, name, content: { hook: '', story: '', value: '', productAppearance: '', cta: '', shotRhythm: '', captionVoiceRequirements: '', prohibitedExpressions: [] }, constraints: { industryCode: 'restaurant', categoryCode: 'noodle', persona: 'owner', contentType: 'story', commercialLevel: 0, style: 'warm', priceDiscountEffectRestrictions: [], riskLevel: 'low' }, fallbackScope: { allowCategoryFallback: false, allowIndustryFallback: false } };
}

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((next) => { resolve = next; }); return { promise, resolve }; }

function resolveSelection(pending: Map<string, ReturnType<typeof deferred>>, current: Template, versions: Template[], events: Array<{ version: number; eventType: string }>) {
  pending.get(`/v1/operator-content/templates/${current.logicalId}/versions/${current.version}`)?.resolve(current);
  pending.get(`/v1/operator-content/templates/${current.logicalId}/versions`)?.resolve(versions);
  pending.get(`/v1/operator-content/templates/${current.logicalId}/history`)?.resolve({ events });
}
