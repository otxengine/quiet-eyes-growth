/**
 * trendContext.ts — Shared intelligence layer for ALL trend detection agents.
 *
 * Solves the "dumb agent" problem:
 *  - Before this file, trend agents bypassed the entire intelligence stack
 *    (sector_profile, agent_missions, deep_profile) and used hardcoded assumptions.
 *  - Now every trend agent calls getTrendContext() first to get full business DNA.
 *
 * Provides:
 *  1. Enriched business context (sector_profile + agent_missions + deep_profile)
 *  2. Temporal validation — rejects Apify content older than maxDaysOld
 *  3. Expanded 10-type trend definition (not just purchase intent)
 *  4. Discovery-first query builder (find what's trending broadly, then filter)
 *  5. Relevance filter — checks signal against irrelevant_topics
 */

import { prisma } from '../db';
import { getSectorProfile, buildAgentPromptContext, type SectorProfile } from './businessProfile';
import { getAgentMission } from './missionPlanner';

// ── Expanded trend taxonomy (10 types) ────────────────────────────────────────
//
// "Trend" is NOT just "people want to buy X more".
// A trend is any detectable shift in the sector's content, language, or behavior
// that a business could act on within days/weeks to gain a competitive edge.

export const TREND_TYPES = [
  { key: 'purchase_intent',    he: 'כוונת רכישה',         desc: 'עלייה בביקוש לשירות/מוצר ספציפי' },
  { key: 'content_format',     he: 'פורמט תוכן חדש',      desc: 'פורמט ויזואלי או וידאו שהפך לויראלי' },
  { key: 'ad_method',          he: 'שיטת פרסום עולה',     desc: 'דרך פרסום חדשה שעובדת טוב בסקטור' },
  { key: 'language_shift',     he: 'שינוי שפה/ז\'רגון',   desc: 'מילים וביטויים חדשים שנכנסים לשיח' },
  { key: 'new_product_service',he: 'מוצר/שירות חדש',      desc: 'קטגוריה חדשה שצומחת בסקטור' },
  { key: 'cultural_value',     he: 'שינוי ערכי/תרבותי',   desc: 'ערך חברתי חדש שמשפיע על ההחלטה לקנות' },
  { key: 'pricing_trend',      he: 'מגמת תמחור',          desc: 'שינוי במודל תמחור או ציפיות מחיר' },
  { key: 'sound_music',        he: 'טרנד סאונד/מוזיקה',   desc: 'סאונד או מוזיקה ספציפי שמניע engagement' },
  { key: 'viral_challenge',    he: 'אתגר/ויראל קמפיין',   desc: 'challenge או קמפיין שאפשר להצטרף אליו' },
  { key: 'seasonal_early',     he: 'מגמה עונתית מוקדמת', desc: 'אות עונתי שמגיע 2-4 שבועות לפני הפיק' },
] as const;

export type TrendTypeKey = typeof TREND_TYPES[number]['key'];

// ── Trend context return type ──────────────────────────────────────────────────

export interface TrendContext {
  // Parsed sector intelligence
  sectorProfile: SectorProfile | null;
  // Agent-specific mission instructions from LLM planner
  agentMission: any | null;
  // Scraped website + social URL intelligence
  deepProfile: BusinessDeepProfile | null;
  // Ready-to-inject prompt blocks
  sectorBlock: string;          // sector_profile as LLM-readable text
  missionBlock: string;         // agent mission as LLM-readable text
  deepProfileBlock: string;     // deep profile key facts as LLM text
  trendTypesBlock: string;      // expanded 10-type definition for the LLM
  relevantTopics: string[];     // from sector_profile.relevant_topics
  irrelevantTopics: string[];   // from sector_profile.irrelevant_topics
  serviceKeywords: string[];    // lower-cased service terms for fast filtering
}

export interface BusinessDeepProfile {
  actual_services: string[];
  actual_products: string[];
  price_range: string;
  tone_from_website: string;
  target_audience_detected: string;
  content_themes_detected: string[];
  unique_selling_points: string[];
  brand_keywords: string[];
  social_presence: {
    instagram?: { followers_approx?: string; post_frequency?: string; content_style?: string };
    tiktok?:    { active?: boolean; content_style?: string };
    facebook?:  { active?: boolean; page_type?: string };
  };
  website_content_summary: string;
  sector_specific_insights: string[];
  last_scraped_at: string;
}

// ── Main loader ────────────────────────────────────────────────────────────────

/**
 * Load full trend intelligence context for a business + agent.
 * Call this at the start of any trend agent before doing any scraping.
 */
export async function getTrendContext(
  businessProfileId: string,
  agentName: string,
): Promise<TrendContext> {
  const profile = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: {
      name: true,
      category: true,
      city: true,
      description: true,
      relevant_services: true,
      sector_profile: true,
      agent_missions: true,
      business_deep_profile: true,
      business_goal: true,
      price_tier: true,
    } as any,
  });

  const sectorProfile = profile ? getSectorProfile(profile as any) : null;
  const agentMission  = profile ? getAgentMission(profile as any, agentName) : null;

  let deepProfile: BusinessDeepProfile | null = null;
  try {
    const raw = (profile as any)?.business_deep_profile;
    if (raw) deepProfile = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {}

  // ── Build prompt blocks ────────────────────────────────────────────────────

  const sectorBlock = sectorProfile
    ? buildAgentPromptContext(profile as any)
    : `Business: ${profile?.name} | Category: ${profile?.category} | City: ${profile?.city}`;

  const missionBlock = agentMission
    ? `=== Mission for ${agentName} ===\n${
        typeof agentMission === 'string'
          ? agentMission
          : JSON.stringify(agentMission, null, 2)
      }`
    : '';

  const deepProfileBlock = deepProfile
    ? buildDeepProfileBlock(deepProfile)
    : '';

  const trendTypesBlock = buildTrendTypesBlock();

  const relevantTopics: string[]   = sectorProfile?.relevant_topics   || [];
  const irrelevantTopics: string[] = sectorProfile?.irrelevant_topics  || [];
  const serviceKeywords: string[]  = String(
    profile?.relevant_services || profile?.category || ''
  ).toLowerCase().split(/[,\s]+/).filter((k: string) => k.length > 2);

  return {
    sectorProfile,
    agentMission,
    deepProfile,
    sectorBlock,
    missionBlock,
    deepProfileBlock,
    trendTypesBlock,
    relevantTopics,
    irrelevantTopics,
    serviceKeywords,
  };
}

// ── Temporal validation ────────────────────────────────────────────────────────

/**
 * Returns true if the content is older than maxDaysOld and should be SKIPPED.
 * timestampSeconds = Unix timestamp (seconds). 0 or missing = allow through.
 */
export function isContentTooOld(timestampSeconds: number | undefined, maxDaysOld = 30): boolean {
  if (!timestampSeconds || timestampSeconds <= 0) return false; // no date info → allow
  const ageSeconds = Math.floor(Date.now() / 1000) - timestampSeconds;
  return ageSeconds > maxDaysOld * 86400;
}

/**
 * Filter an array of items to only those within maxDaysOld.
 * timestampFn extracts the Unix timestamp (seconds) from each item.
 */
export function filterByAge<T>(
  items: T[],
  timestampFn: (item: T) => number | undefined,
  maxDaysOld = 30,
): T[] {
  return items.filter(item => !isContentTooOld(timestampFn(item), maxDaysOld));
}

// ── Relevance filter ────────────────────────────────────────────────────────────

/**
 * Quick check: does this text touch any of the business's irrelevant topics?
 * If yes → skip the signal.
 */
export function isSignalIrrelevant(text: string, irrelevantTopics: string[]): boolean {
  if (!irrelevantTopics.length) return false;
  const lower = text.toLowerCase();
  return irrelevantTopics.some(t => lower.includes(t.toLowerCase()));
}

/**
 * Quick check: does this text contain at least one of the business's service keywords?
 * If no keywords provided → passes through (no false negatives).
 */
export function isSignalRelevant(text: string, serviceKeywords: string[]): boolean {
  if (!serviceKeywords.length) return true;
  const lower = text.toLowerCase();
  return serviceKeywords.some(k => lower.includes(k));
}

// ── Discovery query builder ────────────────────────────────────────────────────
//
// "Discovery-first": find what's trending broadly on the platform,
// then let the LLM filter to what's relevant for this business.
// This solves the "closed loop" problem where agents only look for
// known keywords and can't discover new trends with unfamiliar vocabulary.

export function buildDiscoveryQueries(
  platform: 'tiktok' | 'instagram' | 'facebook',
  category: string,
  city: string,
  relevantTopics: string[],
  year: number,
): string[] {
  const queries: string[] = [];

  switch (platform) {
    case 'tiktok':
      queries.push(
        `TikTok Israel trending ${year} viral small business`,
        `TikTok ישראל ${year} ויראלי עסקים`,
        `TikTok trending content format ${category} Israel ${year}`,
        `מה הולך ויראלי עכשיו טיקטוק ישראל ${category}`,
      );
      break;
    case 'instagram':
      queries.push(
        `Instagram Israel trending Reels ${year} ${category}`,
        `Instagram ישראל ${year} טרנד Reels ויראלי`,
        `Instagram trending content format Israel ${year}`,
        `מה עובד עכשיו אינסטגרם ${category} ישראל`,
      );
      break;
    case 'facebook':
      queries.push(
        `Facebook Israel ${category} trending group discussion ${year}`,
        `פייסבוק ישראל ${category} נושאים חמים ${year}`,
        `Facebook groups Israel ${category} popular post ${year}`,
      );
      break;
  }

  // Add relevant-topic queries
  for (const topic of relevantTopics.slice(0, 3)) {
    queries.push(`${topic} ${platform} Israel trending ${year}`);
  }

  return queries;
}

// ── Prompt block builders ──────────────────────────────────────────────────────

function buildTrendTypesBlock(): string {
  return `=== 10 סוגי טרנד לאיתור (לא רק כוונת רכישה) ===
${TREND_TYPES.map((t, i) => `${i + 1}. [${t.key}] ${t.he}: ${t.desc}`).join('\n')}

CRITICAL: detect ALL 10 types, not just purchase intent. A rising content format
or a new piece of slang is as valuable as a spike in purchase intent.`;
}

function buildDeepProfileBlock(dp: BusinessDeepProfile): string {
  const lines: string[] = ['=== Deep Business Intelligence (scraped from website + social) ==='];

  if (dp.actual_services.length)       lines.push(`Services confirmed: ${dp.actual_services.join(', ')}`);
  if (dp.actual_products.length)       lines.push(`Products confirmed: ${dp.actual_products.join(', ')}`);
  if (dp.target_audience_detected)     lines.push(`Target audience: ${dp.target_audience_detected}`);
  if (dp.unique_selling_points.length) lines.push(`USPs: ${dp.unique_selling_points.join(' | ')}`);
  if (dp.brand_keywords.length)        lines.push(`Brand keywords: ${dp.brand_keywords.join(', ')}`);
  if (dp.content_themes_detected.length) lines.push(`Content themes already used: ${dp.content_themes_detected.join(', ')}`);
  if (dp.website_content_summary)      lines.push(`Website: ${dp.website_content_summary.slice(0, 200)}`);
  if (dp.sector_specific_insights.length)
    lines.push(`Sector insights: ${dp.sector_specific_insights.slice(0, 3).join(' | ')}`);

  const sp = dp.social_presence;
  const socialParts: string[] = [];
  if (sp.instagram?.followers_approx) socialParts.push(`Instagram ~${sp.instagram.followers_approx} followers, ${sp.instagram.post_frequency || '?'} posts`);
  if (sp.tiktok?.active)              socialParts.push(`TikTok active`);
  if (sp.facebook?.active)            socialParts.push(`Facebook active`);
  if (socialParts.length)             lines.push(`Social presence: ${socialParts.join(' | ')}`);

  return lines.join('\n');
}
