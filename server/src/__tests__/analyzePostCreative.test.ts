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
      has_cta: true,
      cta: 'הזמינו עכשיו',
      hook: 'רק היום',
      content_pillar: 'promotion',
      audience_action_driver: 'urgency',
      video_description: 'barista pours latte',
      video_script: 'רק היום!',
      video_content_type: 'UGC',
    });
    expect(result).toEqual({
      topic: 'מבצע קפה',
      has_offer: true,
      offer_details: '20% הנחה',
      // offer_* breakdown is filled by the second-pass analyzeOfferBreakdown, never by this normalizer
      offer_mechanic: null, offer_value_framing: null, offer_urgency: null,
      offer_conditions: null, offer_redemption: null, offer_in_image: false, offer_audience_intent: null,
      visual_hooks: ['צבעים בהירים', 'תמונת מוצר'],
      text_hooks: ['רק היום'],
      style: 'צבעוני',
      has_cta: true,
      cta: 'הזמינו עכשיו',
      hook: 'רק היום',
      content_pillar: 'promotion',
      audience_action_driver: 'urgency',
      video_description: 'barista pours latte',
      video_script: 'רק היום!',
      video_content_type: 'UGC',
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
      has_cta: false,
      cta: null,
      offer_mechanic: null, offer_value_framing: null, offer_urgency: null,
      offer_conditions: null, offer_redemption: null, offer_in_image: false, offer_audience_intent: null,
      hook: null,
      content_pillar: null,
      audience_action_driver: null,
      video_description: null,
      video_script: null,
      video_content_type: null,
    });
  });

  it('coerces has_offer/has_cta to real booleans and drops empty text fields', () => {
    const result = normalizePostCreativeAnalysis({ has_offer: 'yes', offer_details: '', has_cta: 1, cta: '' });
    expect(result?.has_offer).toBe(true);
    expect(result?.offer_details).toBeNull();
    expect(result?.has_cta).toBe(true);
    expect(result?.cta).toBeNull();
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
