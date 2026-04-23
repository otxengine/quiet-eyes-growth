/**
 * WhiteSpaceRadar — Intelligence Engine
 *
 * Identifies market white spaces: services or segments that competitors
 * don't cover but customer demand signals suggest exist.
 *
 * Insight types: 'white_space'
 * Category: 'opportunity'
 *
 * Triggers:
 * - Sector trending services not explicitly mentioned in context
 * - Competitors have service gaps (low ratings in specific categories)
 * - High signal volume about services with no visible provider
 */

import { nanoid } from 'nanoid';
import type { EnrichedContext, Insight } from '../../../models';
import { createLogger } from '../../../infra/logger';

const logger = createLogger('WhiteSpaceRadar');

const ENGINE = 'WhiteSpaceRadar';

// Service categories commonly requested but underprovided
const COMMON_WHITE_SPACES: Record<string, { keywords: string[]; action: string }> = {
  online_booking:   { keywords: ['הזמנה', 'online', 'אפליקציה', 'booking'], action: 'content' },
  premium_tier:     { keywords: ['פרמיום', 'vip', 'איכות', 'יוקרה'],        action: 'pricing' },
  express_service:  { keywords: ['מהיר', 'דחוף', 'אקספרס', 'מיידי'],       action: 'campaign' },
  home_delivery:    { keywords: ['משלוח', 'הביתה', 'delivery', 'בית'],      action: 'expansion' },
  subscription:     { keywords: ['מנוי', 'חברות', 'subscription', 'חודשי'], action: 'retention' },
};

export function detectWhiteSpaces(ctx: EnrichedContext): Insight[] {
  const insights: Insight[] = [];
  const signalIds = ctx.recent_signals.slice(0, 4).map(s => s.id);
  const signalText = ctx.recent_signals.map(s => s.summary.toLowerCase()).join(' ');

  // ── Indicator 1: Sector trending services as white space ──────────────────
  if (ctx.sector_knowledge?.trending_services && (ctx.health_score ?? 0) > 40) {
    const trending = ctx.sector_knowledge.trending_services.toLowerCase();

    // Check if trending services overlap with what seems available locally
    const isUntapped = ctx.competitors.every(c =>
      // If competitor is falling or has no rating, they likely don't offer it well
      c.trend_direction === 'falling' || c.rating === null || (c.rating ?? 0) < 4.0,
    );

    if (isUntapped) {
      insights.push({
        id:          `ins_${nanoid(10)}`,
        business_id: ctx.business_id,
        engine:      ENGINE,
        type:        'white_space',
        category:    'opportunity',
        title:       `שירות מבוקש ללא ספק חזק: ${ctx.sector_knowledge.trending_services.slice(0, 40)}`,
        summary:     `הענף מציג ביקוש גבוה ל"${ctx.sector_knowledge.trending_services}" אך אף מתחרה אינו מספק שירות זה ברמה גבוהה (ממוצע דירוג מתחרים: ${ctx.competitors.filter(c => c.rating).map(c => c.rating).join(', ') || 'לא ידוע'}). זהו חלון פנוי לכניסה.`,
        supporting_signals:       signalIds,
        confidence:  0.70,
        urgency:     'medium',
        business_fit: Math.min(1, 0.5 + (ctx.health_score ?? 50) / 100),
        timeframe:   '7d',
        estimated_impact: 'high',
        recommended_action_types: ['expansion', 'content', 'campaign'],
        metadata: {
          trending_services: ctx.sector_knowledge.trending_services,
          competitor_count:  ctx.competitors.length,
        },
        dedup_key:   `ws:${ctx.business_id}:sector_trending`,
        created_at:  new Date().toISOString(),
      });
    }
  }

  // ── Indicator 2: Signal demand for specific unmet services ────────────────
  for (const [serviceKey, { keywords, action }] of Object.entries(COMMON_WHITE_SPACES)) {
    const mentionCount = keywords.filter(kw => signalText.includes(kw)).length;
    if (mentionCount >= 2) {
      const alreadyAdded = insights.some(i => i.metadata.service_key === serviceKey);
      if (!alreadyAdded) {
        insights.push({
          id:          `ins_${nanoid(10)}`,
          business_id: ctx.business_id,
          engine:      ENGINE,
          type:        'white_space',
          category:    'opportunity',
          title:       `ביקוש לשירות "${serviceKey.replace(/_/g, ' ')}" ללא מענה`,
          summary:     `אותות שוק מציינים ביקוש לשירות זה (${mentionCount} מילות מפתח נמצאו). אין עדות לכיסוי מספק מהמתחרים.`,
          supporting_signals:       signalIds,
          confidence:  Math.min(0.75, 0.50 + mentionCount * 0.08),
          urgency:     'low',
          business_fit: 0.60,
          timeframe:   '30d',
          estimated_impact: 'medium',
          recommended_action_types: [action as any],
          metadata: { service_key: serviceKey, mention_count: mentionCount },
          dedup_key:   `ws:${ctx.business_id}:${serviceKey}`,
          created_at:  new Date().toISOString(),
        });
      }
    }
  }

  // ── Indicator 3: No competitors offering premium AND health > 65 ──────────
  const hasStrongCompetitors = ctx.competitors.some(c => (c.rating ?? 0) >= 4.5);
  if (!hasStrongCompetitors && (ctx.health_score ?? 0) > 65 && ctx.competitors.length > 0) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'white_space',
      category:    'opportunity',
      title:       `חלל פרמיום פנוי — אין מתחרה עם דירוג 4.5+`,
      summary:     `אף מתחרה בסביבה אינו מציע שירות פרמיום (דירוג 4.5+). ניתן לתפוס את המקום הבכיר עם בריאות עסקית נוכחית של ${ctx.health_score}/100.`,
      supporting_signals:       [],
      confidence:  0.65,
      urgency:     'low',
      business_fit: (ctx.health_score ?? 0) / 100,
      timeframe:   '30d',
      estimated_impact: 'high',
      recommended_action_types: ['pricing', 'content', 'reputation'],
      metadata: {
        health_score:    ctx.health_score,
        competitor_max_rating: Math.max(0, ...ctx.competitors.map(c => c.rating ?? 0)),
      },
      dedup_key:   `ws:${ctx.business_id}:premium_vacuum`,
      created_at:  new Date().toISOString(),
    });
  }

  logger.debug('WhiteSpace detection complete', {
    businessId: ctx.business_id, found: insights.length,
  });

  return insights;
}
