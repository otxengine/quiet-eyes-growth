/**
 * Israel market CPM/CPC/CTR benchmarks for paid advertising (2024-2025).
 * Used by estimateCampaignMetrics to produce realistic per-category predictions.
 */

export interface PlatformBenchmark {
  cpm_low:  number;  // ₪ per 1,000 impressions
  cpm_mid:  number;
  cpm_high: number;
  cpc_low:  number;  // ₪ per click
  cpc_mid:  number;
  cpc_high: number;
  ctr_low:  number;  // %
  ctr_mid:  number;
  ctr_high: number;
  cvr_lead: number;  // % clicks → lead (for lead objective)
  cvr_sale: number;  // % clicks → sale (for conversion objective)
  frequency: number; // avg impressions per unique person per day
}

export interface CategoryBenchmarks {
  meta:      PlatformBenchmark;
  instagram: PlatformBenchmark;
  google:    PlatformBenchmark;
}

// ── Per-category benchmarks (Israeli market) ─────────────────────────────────

const BENCHMARKS: Record<string, CategoryBenchmarks> = {
  'מסעדה': {
    meta:      { cpm_low: 14, cpm_mid: 22, cpm_high: 32, cpc_low: 1.5, cpc_mid: 2.8, cpc_high: 4.5, ctr_low: 1.2, ctr_mid: 2.0, ctr_high: 3.2, cvr_lead: 3.5, cvr_sale: 9,  frequency: 1.8 },
    instagram: { cpm_low: 17, cpm_mid: 26, cpm_high: 38, cpc_low: 1.8, cpc_mid: 3.2, cpc_high: 5.2, ctr_low: 0.8, ctr_mid: 1.6, ctr_high: 2.6, cvr_lead: 2.5, cvr_sale: 6,  frequency: 2.0 },
    google:    { cpm_low: 20, cpm_mid: 34, cpm_high: 55, cpc_low: 2.5, cpc_mid: 5.0, cpc_high: 10,  ctr_low: 3.0, ctr_mid: 5.5, ctr_high: 9.0, cvr_lead: 6,   cvr_sale: 14, frequency: 1.2 },
  },
  'קפה': {
    meta:      { cpm_low: 12, cpm_mid: 18, cpm_high: 27, cpc_low: 1.2, cpc_mid: 2.2, cpc_high: 3.8, ctr_low: 1.0, ctr_mid: 1.7, ctr_high: 2.8, cvr_lead: 3,   cvr_sale: 8,  frequency: 1.8 },
    instagram: { cpm_low: 14, cpm_mid: 21, cpm_high: 31, cpc_low: 1.5, cpc_mid: 2.6, cpc_high: 4.2, ctr_low: 0.7, ctr_mid: 1.4, ctr_high: 2.3, cvr_lead: 2,   cvr_sale: 5,  frequency: 1.9 },
    google:    { cpm_low: 17, cpm_mid: 27, cpm_high: 43, cpc_low: 2.0, cpc_mid: 4.0, cpc_high: 8.0, ctr_low: 2.5, ctr_mid: 4.5, ctr_high: 7.5, cvr_lead: 5,   cvr_sale: 12, frequency: 1.2 },
  },
  'יופי': {
    meta:      { cpm_low: 20, cpm_mid: 30, cpm_high: 44, cpc_low: 2.5, cpc_mid: 4.0, cpc_high: 6.5, ctr_low: 1.5, ctr_mid: 2.5, ctr_high: 3.8, cvr_lead: 5,   cvr_sale: 7,  frequency: 2.0 },
    instagram: { cpm_low: 22, cpm_mid: 34, cpm_high: 48, cpc_low: 2.8, cpc_mid: 4.5, cpc_high: 7.0, ctr_low: 1.0, ctr_mid: 2.0, ctr_high: 3.2, cvr_lead: 4,   cvr_sale: 6,  frequency: 2.1 },
    google:    { cpm_low: 25, cpm_mid: 40, cpm_high: 65, cpc_low: 4.0, cpc_mid: 7.5, cpc_high: 15,  ctr_low: 2.5, ctr_mid: 4.5, ctr_high: 7.5, cvr_lead: 7,   cvr_sale: 11, frequency: 1.2 },
  },
  'כושר': {
    meta:      { cpm_low: 17, cpm_mid: 27, cpm_high: 39, cpc_low: 2.0, cpc_mid: 3.5, cpc_high: 5.5, ctr_low: 1.2, ctr_mid: 2.2, ctr_high: 3.4, cvr_lead: 6,   cvr_sale: 9,  frequency: 2.0 },
    instagram: { cpm_low: 19, cpm_mid: 29, cpm_high: 42, cpc_low: 2.2, cpc_mid: 3.8, cpc_high: 6.0, ctr_low: 0.9, ctr_mid: 1.8, ctr_high: 2.9, cvr_lead: 5,   cvr_sale: 7,  frequency: 2.0 },
    google:    { cpm_low: 22, cpm_mid: 36, cpm_high: 58, cpc_low: 3.5, cpc_mid: 6.5, cpc_high: 13,  ctr_low: 2.5, ctr_mid: 4.5, ctr_high: 7.5, cvr_lead: 8,   cvr_sale: 13, frequency: 1.2 },
  },
  'ספא': {
    meta:      { cpm_low: 22, cpm_mid: 34, cpm_high: 48, cpc_low: 3.0, cpc_mid: 5.0, cpc_high: 8.0, ctr_low: 1.5, ctr_mid: 2.5, ctr_high: 3.8, cvr_lead: 5,   cvr_sale: 7,  frequency: 1.9 },
    instagram: { cpm_low: 24, cpm_mid: 36, cpm_high: 52, cpc_low: 3.5, cpc_mid: 5.5, cpc_high: 9.0, ctr_low: 1.0, ctr_mid: 2.0, ctr_high: 3.2, cvr_lead: 4,   cvr_sale: 6,  frequency: 2.0 },
    google:    { cpm_low: 28, cpm_mid: 45, cpm_high: 72, cpc_low: 5.0, cpc_mid: 9.0, cpc_high: 18,  ctr_low: 2.5, ctr_mid: 4.5, ctr_high: 7.5, cvr_lead: 6,   cvr_sale: 9,  frequency: 1.2 },
  },
  'מאפייה': {
    meta:      { cpm_low: 11, cpm_mid: 17, cpm_high: 25, cpc_low: 1.0, cpc_mid: 1.9, cpc_high: 3.3, ctr_low: 1.0, ctr_mid: 1.8, ctr_high: 2.8, cvr_lead: 2.5, cvr_sale: 7,  frequency: 1.8 },
    instagram: { cpm_low: 13, cpm_mid: 20, cpm_high: 29, cpc_low: 1.2, cpc_mid: 2.2, cpc_high: 3.8, ctr_low: 0.7, ctr_mid: 1.3, ctr_high: 2.2, cvr_lead: 2,   cvr_sale: 5,  frequency: 1.9 },
    google:    { cpm_low: 15, cpm_mid: 24, cpm_high: 38, cpc_low: 1.8, cpc_mid: 3.5, cpc_high: 7.0, ctr_low: 2.5, ctr_mid: 4.0, ctr_high: 6.5, cvr_lead: 4,   cvr_sale: 10, frequency: 1.2 },
  },
};

const DEFAULT: CategoryBenchmarks = {
  meta:      { cpm_low: 17, cpm_mid: 25, cpm_high: 37, cpc_low: 2.0, cpc_mid: 3.5, cpc_high: 5.5, ctr_low: 1.2, ctr_mid: 2.0, ctr_high: 3.2, cvr_lead: 4,   cvr_sale: 8,  frequency: 1.9 },
  instagram: { cpm_low: 19, cpm_mid: 28, cpm_high: 41, cpc_low: 2.2, cpc_mid: 3.8, cpc_high: 6.0, ctr_low: 0.8, ctr_mid: 1.6, ctr_high: 2.7, cvr_lead: 3,   cvr_sale: 6,  frequency: 2.0 },
  google:    { cpm_low: 22, cpm_mid: 35, cpm_high: 55, cpc_low: 3.0, cpc_mid: 5.5, cpc_high: 11,  ctr_low: 2.5, ctr_mid: 4.5, ctr_high: 7.5, cvr_lead: 5.5, cvr_sale: 11, frequency: 1.2 },
};

export function getBenchmark(category: string, platform: 'meta' | 'instagram' | 'google'): PlatformBenchmark {
  return (BENCHMARKS[category] || DEFAULT)[platform];
}

// Budget tiers (₪/day) recommended per category
export const BUDGET_TIERS: Record<string, { starter: number; growth: number; aggressive: number }> = {
  'מסעדה': { starter: 30,  growth: 70,  aggressive: 150 },
  'קפה':   { starter: 25,  growth: 55,  aggressive: 120 },
  'יופי':  { starter: 40,  growth: 90,  aggressive: 200 },
  'כושר':  { starter: 35,  growth: 80,  aggressive: 180 },
  'ספא':   { starter: 50,  growth: 110, aggressive: 250 },
  'מאפייה':{ starter: 20,  growth: 45,  aggressive: 100 },
  default:  { starter: 35,  growth: 80,  aggressive: 170 },
};

export function getBudgetTiers(category: string) {
  return BUDGET_TIERS[category] || BUDGET_TIERS.default;
}
