export type Status = 'draft' | 'published' | 'disabled';

export interface TemplateInput {
  name: string;
  content: Record<string, string | string[]>;
  constraints: Record<string, string | number | string[]>;
  fallbackScope: { allowCategoryFallback: boolean; allowIndustryFallback: boolean };
}

export interface Template extends TemplateInput { logicalId: string; version: number; status: Status; }

export interface RuleInput {
  name: string; ruleType: string; patterns: string[]; semanticCategories: string[];
  severity: 'block' | 'high' | 'warning' | 'notice'; platform: string; scope: string; guidance: string;
}

export interface Rule extends RuleInput { logicalId: string; version: number; status: Status; }

export const emptyTemplate = (): TemplateInput => ({
  name: '',
  content: { hook: '', story: '', value: '', productAppearance: '', cta: '', shotRhythm: '', captionVoiceRequirements: '', prohibitedExpressions: [] },
  constraints: { industryCode: '', categoryCode: '', persona: '', contentType: '', commercialLevel: 0, style: '', priceDiscountEffectRestrictions: [], riskLevel: '' },
  fallbackScope: { allowCategoryFallback: false, allowIndustryFallback: false }
});

export const emptyRule = (): RuleInput => ({ name: '', ruleType: '', patterns: [], semanticCategories: [], severity: 'warning', platform: '', scope: '', guidance: '' });
