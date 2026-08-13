/**
 * Pure-logic test for the LLM output normalization guard in analyzePostCreative —
 * no DB/network mocking, mirrors eventDateGate.test.ts's style.
 */

import { normalizePostCreativeAnalysis } from '../lib/analyzePostCreative';

describe('normalizePostCreativeAnalysis', () => {
  it('returns null for non-object LLM output', () => {
    expect(normalizePostCreativeAnalysis(null)).toBeNull();
    expect(normalizePostCreativeAnalysis(undefined)).toBeNull();
    expect(normalizePostCreativeAnalysis('not json')).toBeNull();
    expect(normalizePostCreativeAnalysis(['array', 'not', 'object'])).toBeNull();
  });

  it('normalizes a well-formed response', () => {
    const result = normalizePostCreativeAnalysis({
      topic: 'מבצע קפה',
      has_offer: true,
      offer_details: '20% הנחה',
      visual_hooks: ['צבעים בהירים', 'תמונת מוצר'],
      text_hooks: ['רק היום'],
      style: 'צבעוני',
      cta: 'הזמינו עכשיו',
    });
    expect(result).toEqual({
      topic: 'מבצע קפה',
      has_offer: true,
      offer_details: '20% הנחה',
      visual_hooks: ['צבעים בהירים', 'תמונת מוצר'],
      text_hooks: ['רק היום'],
      style: 'צבעוני',
      cta: 'הזמינו עכשיו',
    });
  });

  it('defaults missing/malformed fields instead of throwing', () => {
    const result = normalizePostCreativeAnalysis({ topic: 'general post' });
    expect(result).toEqual({
      topic: 'general post',
      has_offer: false,
      offer_details: null,
      visual_hooks: [],
      text_hooks: [],
      style: '',
      cta: '',
    });
  });

  it('coerces has_offer to a real boolean and drops empty offer_details', () => {
    const result = normalizePostCreativeAnalysis({ has_offer: 'yes', offer_details: '' });
    expect(result?.has_offer).toBe(true);
    expect(result?.offer_details).toBeNull();
  });

  it('filters non-string entries out of hook arrays', () => {
    const result = normalizePostCreativeAnalysis({
      visual_hooks: ['ok', 42, null],
      text_hooks: 'not an array',
    });
    expect(result?.visual_hooks).toEqual(['ok']);
    expect(result?.text_hooks).toEqual([]);
  });
});
