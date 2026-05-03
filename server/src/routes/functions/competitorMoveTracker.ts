import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

/**
 * competitorMoveTracker — detects meaningful changes in competitor data over time.
 * Rating drops/rises, new services, price changes, promotion activity.
 * Creates ProactiveAlerts with alert_type='competitor_move'.
 */
export async function competitorMoveTracker(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const competitors = await prisma.competitor.findMany({ where: { linked_business: businessProfileId } });
    if (competitors.length === 0) {
      await writeAutomationLog('competitorMoveTracker', businessProfileId, startTime, 0);
      return res.json({ moves_detected: 0, message: 'No competitors to track' });
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    // Load recent competitor_move alerts to avoid duplicates
    const recentAlerts = await prisma.proactiveAlert.findMany({
      where: { linked_business: businessProfileId, alert_type: 'competitor_move', created_at: { gte: sevenDaysAgo } },
      select: { title: true },
    });
    const recentTitles = new Set(recentAlerts.map(a => a.title));

    const competitorContext = competitors.map(c => {
      const changes: string[] = [];

      // Detect rating change (comparing trend_direction field)
      if (c.trend_direction === 'up') changes.push('דירוג עולה לאחרונה');
      if (c.trend_direction === 'down') changes.push('דירוג יורד לאחרונה');

      // Detect active promotions
      if (c.current_promotions) changes.push(`מבצע פעיל: ${c.current_promotions.substring(0, 80)}`);

      // Detect recent price changes
      if (c.price_changed_at && new Date(c.price_changed_at) > new Date(Date.now() - 14 * 86400000)) {
        changes.push(`מחירים שונו לאחרונה: ${c.last_known_prices?.substring(0, 60) || 'עדכון מחירים'}`);
      }

      return {
        name: c.name,
        rating: c.rating,
        review_count: c.review_count,
        services: c.services?.substring(0, 100),
        strengths: c.strengths?.substring(0, 100),
        weaknesses: c.weaknesses?.substring(0, 100),
        changes,
        price_range: c.price_range,
        current_promotions: c.current_promotions,
      };
    });

    const result = await invokeLLM({
      prompt: `אתה מנתח תחרות לעסק "${profile.name}" (${profile.category}, ${profile.city}).

מתחרים עם נתוניהם הנוכחיים:
${competitorContext.map(c => `
מתחרה: ${c.name} | דירוג: ${c.rating || 'N/A'}⭐ | ביקורות: ${c.review_count || 0}
שירותים: ${c.services || 'לא ידוע'}
חוזקות: ${c.strengths || 'N/A'} | חולשות: ${c.weaknesses || 'N/A'}
טווח מחירים: ${c.price_range || 'N/A'}
שינויים שזוהו: ${c.changes.join(', ') || 'ללא שינויים ברורים'}
מבצעים: ${c.current_promotions || 'אין'}
`).join('\n---\n')}

זהה:
1. מהלכים אסטרטגיים של מתחרים שדורשים תגובה
2. הזדמנויות שנוצרות מחולשות של מתחרים
3. איומים מהלכים של מתחרים

החזר JSON:
{
  "moves": [{
    "competitor_name": "שם המתחרה",
    "move_type": "price_change|new_service|promotion|rating_drop|expansion|weakness",
    "description": "תיאור המהלך — מה שינה המתחרה",
    "threat_level": "high|medium|low",
    "recommended_response": "מה לעשות בתגובה — פעולה ספציפית",
    "opportunity": "האם זו הזדמנות עבורנו?"
  }]
}`,
      response_json_schema: { type: 'object' },
    });

    const moves: any[] = result?.moves || [];
    let created = 0;

    for (const move of moves) {
      if (!move.competitor_name || !move.description) continue;
      const title = `${move.competitor_name}: ${move.description.substring(0, 60)}`;
      if (recentTitles.has(title)) continue;

      await prisma.proactiveAlert.create({
        data: {
          linked_business: businessProfileId,
          alert_type: 'competitor_move',
          title,
          description: `${move.description}${move.opportunity ? ` — הזדמנות: ${move.opportunity}` : ''}`,
          suggested_action: move.recommended_response || '',
          priority: move.threat_level === 'high' ? 'high' : move.threat_level === 'medium' ? 'medium' : 'low',
          source_agent: JSON.stringify({
            action_label: 'הגב עכשיו',
            action_type: 'task',
            urgency_hours: move.threat_level === 'high' ? 12 : 48,
            impact_reason: `${move.competitor_name} ביצע מהלך — חלון תגובה קצר`,
          }),
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
        },
      });
      recentTitles.add(title);
      created++;
    }

    await writeAutomationLog('competitorMoveTracker', businessProfileId, startTime, created);
    return res.json({ moves_detected: created, items_created: created });
  } catch (err: any) {
    console.error('competitorMoveTracker error:', err.message);
    await writeAutomationLog('competitorMoveTracker', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
