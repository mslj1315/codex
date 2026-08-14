import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TemplateEditor } from './template-editor';

const template = {
  logicalId: '11111111-1111-1111-1111-111111111111', version: 1, status: 'draft' as const, name: 'Lunch story',
  content: { hook: 'Fresh today', story: 'Kitchen story', value: 'Good value', productAppearance: 'Show bowl', cta: 'Visit today', shotRhythm: 'Fast', captionVoiceRequirements: 'Captions', prohibitedExpressions: ['best'] },
  constraints: { industryCode: 'restaurant', categoryCode: 'noodle', persona: 'owner', contentType: 'story', commercialLevel: 1, style: 'warm', priceDiscountEffectRestrictions: ['No absolute price claim'], riskLevel: 'low' },
  fallbackScope: { allowCategoryFallback: true, allowIndustryFallback: false }
};

describe('TemplateEditor', () => {
  it('saves a complete structured draft with its logical item id', async () => {
    const save = vi.fn().mockResolvedValue(template);
    const user = userEvent.setup();
    render(<TemplateEditor template={template} onSave={save} onPublish={vi.fn()} onDisable={vi.fn()} />);

    await user.clear(screen.getByLabelText('Template name'));
    await user.type(screen.getByLabelText('Template name'), 'Updated lunch story');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(save).toHaveBeenCalledWith(template.logicalId, expect.objectContaining({ name: 'Updated lunch story', content: expect.objectContaining({ hook: 'Fresh today' }) }));
  });

  it('renders published content as read-only and creates the next draft explicitly', async () => {
    const save = vi.fn().mockResolvedValue(template);
    const user = userEvent.setup();
    render(<TemplateEditor template={{ ...template, status: 'published' }} onSave={save} onPublish={vi.fn()} onDisable={vi.fn()} />);

    expect(screen.getByText('Published versions are immutable. Saving creates the next draft version.')).toBeInTheDocument();
    expect(screen.getByLabelText('Template name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Create next draft' }));
    expect(save).toHaveBeenCalledWith(template.logicalId, expect.objectContaining({ name: 'Lunch story' }));
  });
});
