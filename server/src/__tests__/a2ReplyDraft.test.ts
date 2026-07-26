import { buildA2Prompt } from '../routes/social';

const BASE = {
  businessName: 'מסעדת הגן',
  reviewerName: 'יוסי',
  reviewText:   'האוכל היה טעים אבל השירות היה איטי',
  rating:       3,
  allAspects:   ['שירות', 'מחיר', 'איכות המזון', 'זמן המתנה'],
  closingStyle: 'professional — offer to discuss further or invite them to return',
};

describe('buildA2Prompt — KAN-125', () => {
  test('AC-4: prompt includes aspect checklist', () => {
    const p = buildA2Prompt({ ...BASE, positives: [], negatives: [] });
    expect(p).toContain('שירות');
    expect(p).toContain('איכות המזון');
  });

  test('AC-4: prompt includes star rating', () => {
    const p = buildA2Prompt({ ...BASE, positives: [], negatives: [] });
    expect(p).toContain('3/5');
  });

  test('AC-1: skeleton order instruction present', () => {
    const p = buildA2Prompt({ ...BASE, positives: ['איכות המזון'], negatives: ['שירות'] });
    const posIdx = p.indexOf('POSITIVES');
    const negIdx = p.indexOf('NEGATIVES');
    const closeIdx = p.indexOf('CLOSE');
    expect(posIdx).toBeLessThan(negIdx);
    expect(negIdx).toBeLessThan(closeIdx);
  });

  test('AC-2: negative aspects listed in prompt', () => {
    const p = buildA2Prompt({ ...BASE, positives: [], negatives: ['שירות', 'זמן המתנה'] });
    expect(p).toContain('שירות');
    expect(p).toContain('זמן המתנה');
    expect(p).toContain('add NO invented facts');
  });

  test('AC-3: closing style injected from tone', () => {
    const p = buildA2Prompt({ ...BASE, positives: [], negatives: [], closingStyle: 'casual and warm — invite them back by name' });
    expect(p).toContain('casual and warm');
  });

  test('AC-1: positives block skipped when no positives', () => {
    const p = buildA2Prompt({ ...BASE, positives: [], negatives: ['שירות'] });
    expect(p).toContain('skip this block entirely if none');
  });
});
