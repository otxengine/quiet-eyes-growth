/**
 * WorkforcePatternOpportunity — Intelligence Engine
 *
 * Detects B2B and consumer opportunities driven by workforce demographic shifts:
 * - Remote/hybrid work patterns creating new service demand
 * - Industry hiring surges in the local area
 * - Seasonal workforce influx (students, tourists, seasonal workers)
 * - Economic activity indicators from signals
 *
 * Insight types: 'workforce_pattern'
 * Category: 'opportunity'
 */

import { nanoid } from 'nanoid';
import type { EnrichedContext, Insight } from '../../../models';
import { createLogger } from '../../../infra/logger';

const logger = createLogger('WorkforcePatternOpportunity');

const ENGINE = 'WorkforcePatternOpportunity';

// Keywords that indicate workforce activity in signals
const WORKFORCE_KEYWORDS = {
  b2b_opportunity:  ['חברה', 'עסק', 'צוות', 'עובדים', 'משרד', 'corporate', 'b2b', 'ארגון'],
  remote_work:      ['עבודה מהבית', 'היברידי', 'remote', 'עצמאי', 'freelance', 'co-working'],
  hiring_surge:     ['גיוס', 'דרוש', 'משרה', 'hiring', 'דרושים', 'קרייר'],
  seasonal_workers: ['עונתי', 'קיץ', 'סטודנטים', 'תיירים', 'seasonal'],
};

function countKeywordMatches(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter(k => lower.includes(k.toLowerCase())).length;
}

export function detectWorkforcePatterns(ctx: EnrichedContext): Insight[] {
  const insights: Insight[] = [];

  const signalText = ctx.recent_signals.map(s => s.summary).join(' ');
  const signalIds  = ctx.recent_signals.slice(0, 4).map(s => s.id);

  // ── Indicator 1: B2B opportunity from corporate signals ────────────────────
  const b2bMatches = countKeywordMatches(signalText, WORKFORCE_KEYWORDS.b2b_opportunity);
  if (b2bMatches >= 2 && ctx.sector_knowledge) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'workforce_pattern',
      category:    'opportunity',
      title:       `הזדמנות B2B: ${b2bMatches} אותות פעילות עסקית`,
      summary:     `אותות שוק מצביעים על פעילות עסקית ארגונית בסביבה. שירותי B2B (ספק לעסקים, הסכמי נפח, שירות ארגוני) עשויים לפתוח ערוץ הכנסה נוסף.`,
      supporting_signals:       signalIds,
      confidence:  Math.min(0.72, 0.50 + b2bMatches * 0.05),
      urgency:     'low',
      business_fit: 0.60,
      timeframe:   '30d',
      estimated_impact: 'medium',
      recommended_action_types: ['expansion', 'campaign', 'outreach'],
      metadata: { b2b_signal_count: b2bMatches },
      dedup_key:   `wp:${ctx.business_id}:b2b_opportunity`,
      created_at:  new Date().toISOString(),
    });
  }

  // ── Indicator 2: Remote work creates new demand windows ───────────────────
  const remoteMatches = countKeywordMatches(signalText, WORKFORCE_KEYWORDS.remote_work);
  if (remoteMatches >= 2) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'workforce_pattern',
      category:    'opportunity',
      title:       `שינוי תבנית עבודה: ביקוש בשעות לא שגרתיות`,
      summary:     `עבודה מהבית ומרחוק (${remoteMatches} אותות) יוצרת ביקוש בשעות שאינן שעות פנאי מסורתיות. כיסוי של חלונות שעות חדשים (בוקר מוקדם, שעות אחה"צ) עשוי להגדיל את התפוסה.`,
      supporting_signals:       signalIds,
      confidence:  0.63,
      urgency:     'low',
      business_fit: 0.55,
      timeframe:   '30d',
      estimated_impact: 'medium',
      recommended_action_types: ['campaign', 'content'],
      metadata: { remote_signal_count: remoteMatches },
      dedup_key:   `wp:${ctx.business_id}:remote_work_demand`,
      created_at:  new Date().toISOString(),
    });
  }

  // ── Indicator 3: Local hiring surge → new residents/workers ───────────────
  const hiringMatches = countKeywordMatches(signalText, WORKFORCE_KEYWORDS.hiring_surge);
  if (hiringMatches >= 3) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'workforce_pattern',
      category:    'opportunity',
      title:       `גאות גיוס מקומי — עובדים חדשים = לקוחות פוטנציאליים`,
      summary:     `${hiringMatches} אותות על גיוס בסביבה המקומית מרמזים על גל של עובדים חדשים באזור. כל עובד חדש הוא לקוח פוטנציאלי שמחפש ספקי שירות מקומיים.`,
      supporting_signals:       signalIds,
      confidence:  0.58,
      urgency:     'medium',
      business_fit: 0.65,
      timeframe:   '7d',
      estimated_impact: 'medium',
      recommended_action_types: ['campaign', 'content', 'promotion'],
      metadata: { hiring_signal_count: hiringMatches },
      dedup_key:   `wp:${ctx.business_id}:hiring_surge`,
      created_at:  new Date().toISOString(),
    });
  }

  // ── Indicator 4: Health score mismatch — potential workforce constraint ────
  // If health score is high but lead count is low → internal capacity issue
  if ((ctx.health_score ?? 0) > 70 && ctx.leads.total < 8) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'workforce_pattern',
      category:    'optimization',
      title:       `בריאות גבוהה, לידים נמוכים — בדוק מגבלת כוח אדם`,
      summary:     `ציון בריאות ${ctx.health_score}/100 אך רק ${ctx.leads.total} לידים מצביע על אפשרי מגבלת כוח אדם. הרחבת צוות או מיקור חוץ עשויים לשחרר קיבולת נוספת.`,
      supporting_signals:       [],
      confidence:  0.55,
      urgency:     'low',
      business_fit: (ctx.health_score ?? 0) / 100,
      timeframe:   '30d',
      estimated_impact: 'medium',
      recommended_action_types: ['expansion', 'content'],
      metadata: {
        health_score:  ctx.health_score,
        total_leads:   ctx.leads.total,
      },
      dedup_key:   `wp:${ctx.business_id}:capacity_gap`,
      created_at:  new Date().toISOString(),
    });
  }

  logger.debug('WorkforcePattern detection complete', {
    businessId: ctx.business_id, found: insights.length,
  });

  return insights;
}
