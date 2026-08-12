/**
 * Unit tests — buildIdentityCompetitorTerms (KAN-211 AC1/AC3/AC4)
 */
import { buildIdentityCompetitorTerms } from '../lib/businessProfile';

const APPROVED_IDENTITY = {
  business_name: 'Cafe A',
  sector_key: 'restaurant',
  sub_sector_key: 'coffee_shop',
  business_type: 'B2C',
  service_model: ['walk_in'],
  relevant_topics: ['קפה מיוחד', 'עוגות', 'ברישטה', 'קפה שחור', 'קפה קר'],
};

test('AC1: not approved → empty (caller falls back per AC3)', () => {
  const terms = buildIdentityCompetitorTerms({ about_status: 'pending', about_approved: JSON.stringify(APPROVED_IDENTITY) });
  expect(terms).toEqual([]);
});

test('AC1: missing about_approved → empty', () => {
  const terms = buildIdentityCompetitorTerms({ about_status: 'approved', about_approved: null });
  expect(terms).toEqual([]);
});

test('AC1: sub_sector_key primary + relevant_topics capped at 5, business_name/type/service_model excluded', () => {
  const terms = buildIdentityCompetitorTerms({ about_status: 'approved', about_approved: JSON.stringify(APPROVED_IDENTITY) });
  expect(terms[0]).toBe('coffee_shop'); // no sector_profile.sector_label_he available → raw sub_sector_key
  expect(terms).not.toContain('Cafe A');
  expect(terms).not.toContain('B2C');
  expect(terms).not.toContain('walk_in');
  expect(terms.length).toBeLessThanOrEqual(6);
});

test('AC1: sector_key added as thin fallback only when primary yields <2 terms', () => {
  const thin = { ...APPROVED_IDENTITY, relevant_topics: [] };
  const terms = buildIdentityCompetitorTerms({ about_status: 'approved', about_approved: JSON.stringify(thin) });
  expect(terms).toContain('restaurant');
});

test('AC1: uses sector_profile Hebrew label for the primary term when available', () => {
  const terms = buildIdentityCompetitorTerms({
    about_status: 'approved',
    about_approved: JSON.stringify(APPROVED_IDENTITY),
    sector_profile: JSON.stringify({ sector_label_he: 'בית קפה' }),
  });
  expect(terms[0]).toBe('בית קפה');
});
