import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RuleEditor } from './rule-editor';

const rule = { logicalId: '22222222-2222-2222-2222-222222222222', version: 1, status: 'draft' as const, name: 'Absolute claims', ruleType: 'absolute_word', patterns: ['best'], semanticCategories: ['absolute claim'], severity: 'block' as const, platform: 'douyin', scope: 'caption', guidance: 'Use verifiable wording.' };

describe('RuleEditor', () => {
  it('previews transient text and displays returned matches as text', async () => {
    const preview = vi.fn().mockResolvedValue({ matches: [{ pattern: '<strong>best</strong>', guidance: 'Use verifiable wording.' }] });
    const user = userEvent.setup();
    render(<RuleEditor rule={rule} onSave={vi.fn()} onPublish={vi.fn()} onDisable={vi.fn()} onPreview={preview} />);

    await user.type(screen.getByLabelText('Preview text'), 'Our best bowl');
    await user.click(screen.getByRole('button', { name: 'Test rule' }));

    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ name: 'Absolute claims' }), 'Our best bowl');
    expect(await screen.findByText('<strong>best</strong>')).toBeInTheDocument();
    expect(document.querySelector('strong')).toBeNull();
  });
});
