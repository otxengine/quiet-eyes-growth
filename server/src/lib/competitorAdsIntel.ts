/**
 * competitorAdsIntel — shared loader for competitor paid ad intelligence.
 *
 * Reads all competitors with active ad data and formats a structured context
 * block that can be injected into any agent prompt.
 *
 * Includes: what they advertise, who they target, spend level, strategy, gaps.
 */

import { prisma } from '../db';

export interface CompetitorAdIntel {
  competitorName: string;
  platforms: string;
  adCount: number;
  promoted: string;
  targetAudience: string;
  strategy: string;
  spendSignal: string;     // 'low' | 'medium' | 'high'
  gaps: string;            // what they're NOT advertising = our opportunity
  updatedAt: string | null;
}

export async function loadCompetitorAdsIntel(
  businessProfileId: string,
): Promise<CompetitorAdIntel[]> {
  try {
    const rows = await (prisma.competitor as any).findMany({
      where: {
        linked_business: businessProfileId,
        sponsored_ads_detected: true,
      },
      select: {
        name:                 true,
        active_ad_platforms:  true,
        active_ad_count:      true,
        last_promo_detected:  true,
        ad_target_audience:   true,
        ad_strategy_summary:  true,
        ad_spend_signal:      true,
        ad_gaps:              true,
        ad_intel_updated_at:  true,
      },
      orderBy: { ad_intel_updated_at: 'desc' },
      take: 8,
    });

    return rows.map((r: any): CompetitorAdIntel => ({
      competitorName: r.name,
      platforms:      r.active_ad_platforms || '',
      adCount:        r.active_ad_count     || 0,
      promoted:       r.last_promo_detected || '',
      targetAudience: r.ad_target_audience  || '',
      strategy:       r.ad_strategy_summary || '',
      spendSignal:    r.ad_spend_signal     || 'low',
      gaps:           r.ad_gaps             || '',
      updatedAt:      r.ad_intel_updated_at || null,
    }));
  } catch {
    return [];
  }
}

/**
 * Format competitor ad intel as a Hebrew context block for agent prompts.
 * Returns empty string if no intel is available.
 */
export function formatCompetitorAdsForPrompt(intel: CompetitorAdIntel[]): string {
  if (!intel || intel.length === 0) return '';

  const activeAds = intel.filter(i => i.platforms || i.promoted);
  if (activeAds.length === 0) return '';

  const lines: string[] = ['=== מודעות ממומנות של מתחרים (מידע עדכני) ==='];

  for (const comp of activeAds) {
    lines.push(`\n📣 ${comp.competitorName} (${comp.platforms || 'לא ידוע'}, ${comp.adCount} מודעות):`);
    if (comp.promoted)       lines.push(`  מקדמים: ${comp.promoted}`);
    if (comp.targetAudience) lines.push(`  קהל יעד: ${comp.targetAudience}`);
    if (comp.strategy)       lines.push(`  אסטרטגיה: ${comp.strategy}`);
    if (comp.spendSignal !== 'low') lines.push(`  עוצמת השקעה: ${comp.spendSignal === 'high' ? 'גבוהה' : 'בינונית'}`);
    if (comp.gaps)           lines.push(`  פערים (הזדמנויות לנו): ${comp.gaps}`);
  }

  lines.push('\n=== סוף מידע מודעות מתחרים ===');
  return '\n' + lines.join('\n') + '\n';
}
