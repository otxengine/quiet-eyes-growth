/**
 * sectorContext — reads accumulated SectorKnowledge from DB and formats it
 * for injection into agent prompts.
 *
 * Usage in any agent:
 *   const sectorCtx = await getSectorContext(profile.category);
 *   // inject sectorCtx into the LLM prompt
 *
 * Data comes from updateSectorKnowledge which aggregates across ALL businesses
 * in the sector — so every new business immediately benefits from collective learning.
 */

import { prisma } from '../db';

export interface SectorLearning {
  businesses_analyzed:      number;
  alert_conversion_rates:   Record<string, number>;
  top_alert_type:           string | null;
  lead_conversion_rate_pct: number;
  top_lead_sources:         string[];
  top_closed_services:      string[];
  avg_competitor_rating:    number | null;
  sector_health_baseline:   number | null;
  winning_patterns:         string;
  risk_patterns:            string;
  peak_demand:              string;
  best_content_types:       string;
  key_insights:             string;
  last_learned:             string;
}

/**
 * Returns a formatted context block for LLM prompts.
 * Returns empty string if no sector knowledge exists yet.
 */
export async function getSectorContext(sector: string | null | undefined): Promise<string> {
  if (!sector) return '';

  try {
    const knowledge = await prisma.sectorKnowledge.findFirst({
      where: { sector },
      orderBy: { last_updated: 'desc' },
    });
    if (!knowledge) return '';

    const rich: Partial<SectorLearning> = knowledge.winner_lead_dna
      ? JSON.parse(knowledge.winner_lead_dna)
      : {};

    const lines: string[] = [
      `=== ידע מצטבר על סקטור "${sector}" (${rich.businesses_analyzed ?? 1} עסקים נותחו) ===`,
    ];

    if (knowledge.trending_services)
      lines.push(`שירותים מבוקשים בסקטור: ${knowledge.trending_services}`);

    if (knowledge.common_complaints)
      lines.push(`תלונות נפוצות שחוזרות: ${knowledge.common_complaints}`);

    if (rich.winning_patterns)
      lines.push(`מה שעובד בסקטור: ${rich.winning_patterns}`);

    if (rich.risk_patterns)
      lines.push(`גורמי כישלון/נטישה: ${rich.risk_patterns}`);

    if (rich.peak_demand)
      lines.push(`שיא ביקוש: ${rich.peak_demand}`);

    if (rich.best_content_types)
      lines.push(`תוכן שעובד: ${rich.best_content_types}`);

    if (rich.top_alert_type && rich.alert_conversion_rates?.[rich.top_alert_type] !== undefined)
      lines.push(`ההתראה הכי אפקטיבית בסקטור: ${rich.top_alert_type} (${rich.alert_conversion_rates[rich.top_alert_type]}% פעולה)`);

    if (rich.lead_conversion_rate_pct)
      lines.push(`שיעור המרת לידים ממוצע בסקטור: ${rich.lead_conversion_rate_pct}%`);

    if (rich.top_lead_sources?.length)
      lines.push(`מקורות הלידים שמובילים לסגירה: ${rich.top_lead_sources.join(', ')}`);

    if (rich.top_closed_services?.length)
      lines.push(`שירותים שמובילים לסגירת עסקאות: ${rich.top_closed_services.join(', ')}`);

    if (knowledge.avg_rating)
      lines.push(`דירוג ממוצע בסקטור: ${knowledge.avg_rating}★`);

    if (rich.avg_competitor_rating)
      lines.push(`דירוג ממוצע מתחרים: ${rich.avg_competitor_rating}★`);

    if (rich.sector_health_baseline)
      lines.push(`ציון בריאות עסקית ממוצע בסקטור: ${rich.sector_health_baseline}/100`);

    if (knowledge.price_range)
      lines.push(`טווח מחירים טיפוסי: ${knowledge.price_range}`);

    return lines.join('\n');
  } catch {
    return '';
  }
}

/**
 * Returns the raw parsed SectorLearning object (for programmatic use).
 */
export async function getSectorLearning(sector: string | null | undefined): Promise<SectorLearning | null> {
  if (!sector) return null;
  try {
    const knowledge = await prisma.sectorKnowledge.findFirst({ where: { sector } });
    if (!knowledge?.winner_lead_dna) return null;
    return JSON.parse(knowledge.winner_lead_dna) as SectorLearning;
  } catch {
    return null;
  }
}
