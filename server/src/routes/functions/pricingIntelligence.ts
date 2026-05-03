import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { getSectorContext } from '../../lib/sectorPrompts';

/**
 * pricingIntelligence — analyzes competitor pricing and recommends optimal pricing strategy.
 * Detects pricing windows, opportunities to raise/lower prices, and value positioning.
 */
export async function pricingIntelligence(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const [competitors, leads, reviews, existingAlerts] = await Promise.all([
      prisma.competitor.findMany({ where: { linked_business: businessProfileId }, take: 10 }),
      prisma.lead.findMany({
        where: { linked_business: businessProfileId, status: { in: ['hot', 'closed_won'] } },
        select: { budget_range: true, deal_value: true, closed_value: true },
        take: 20,
      }),
      prisma.review.findMany({
        where: { linked_business: businessProfileId },
        select: { rating: true, text: true },
        take: 20,
        orderBy: { created_date: 'desc' },
      }),
      prisma.proactiveAlert.findMany({
        where: { linked_business: businessProfileId, alert_type: 'pricing_opportunity', is_acted_on: false, is_dismissed: false },
        select: { title: true },
      }),
    ]);

    const existingTitles = new Set(existingAlerts.map(a => a.title));
    const sectorCtx = getSectorContext(profile.category);

    const competitorPricing = competitors
      .filter(c => c.price_range || c.last_known_prices || c.price_points)
      .map(c => `${c.name}: ${c.price_range || c.price_points || c.last_known_prices || 'לא ידוע'}`)
      .join('\n');

    const leadBudgets = leads
      .filter(l => l.budget_range || l.deal_value)
      .map(l => l.budget_range || `₪${l.deal_value}`)
      .join(', ');

    // Check for price-related review mentions
    const priceReviews = reviews.filter(r => r.text?.includes('מחיר') || r.text?.includes('יקר') || r.text?.includes('זול') || r.text?.includes('שווה')).length;

    const result = await invokeLLM({
      prompt: `אתה יועץ תמחור לעסק "${profile.name}" (${profile.category}, ${profile.city}).
${sectorCtx}

מחירי מתחרים:
${competitorPricing || 'אין מידע מחירים על מתחרים'}

טווחי תקציב של לידים/לקוחות: ${leadBudgets || 'לא ידוע'}
ביקורות המזכירות מחיר: ${priceReviews} מתוך ${reviews.length}
טווח מחירים נוכחי: ${profile.min_budget || 'לא צוין'}

נתח והמלץ על אסטרטגיית תמחור:

החזר JSON:
{
  "market_position": "premium|mid|budget — עמדת התמחור הנוכחית של העסק",
  "recommended_position": "premium|mid|budget — עמדה מומלצת",
  "opportunities": [{
    "title": "שם ההזדמנות (קצר)",
    "description": "תיאור הזדמנות התמחור",
    "action": "פעולה ספציפית (שנה מחיר X ל-Y, הוסף חבילה...",
    "expected_revenue_impact": "השפעה על הכנסות (כמותי)",
    "urgency": "high|medium|low"
  }],
  "pricing_insight": "תובנה מרכזית אחת על תמחור בסקטור זה"
}`,
      response_json_schema: { type: 'object' },
    });

    let created = 0;

    for (const opp of (result?.opportunities || []).slice(0, 2)) {
      if (!opp.title) continue;
      if (existingTitles.has(opp.title)) continue;

      await prisma.proactiveAlert.create({
        data: {
          linked_business: businessProfileId,
          alert_type: 'pricing_opportunity',
          title: opp.title,
          description: `${opp.description}${result?.pricing_insight ? ' | ' + result.pricing_insight : ''}`,
          suggested_action: opp.action || '',
          priority: opp.urgency === 'high' ? 'high' : 'medium',
          source_agent: JSON.stringify({
            action_label: 'עדכן מחיר',
            action_type: 'task',
            urgency_hours: opp.urgency === 'high' ? 24 : 72,
            impact_reason: opp.expected_revenue_impact || 'אופטימיזציית תמחור יכולה להגדיל הכנסות',
          }),
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
        },
      });
      existingTitles.add(opp.title);
      created++;
    }

    await writeAutomationLog('pricingIntelligence', businessProfileId, startTime, created);
    return res.json({ opportunities_found: created, items_created: created, market_position: result?.market_position, analysis: result });
  } catch (err: any) {
    console.error('pricingIntelligence error:', err.message);
    await writeAutomationLog('pricingIntelligence', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
