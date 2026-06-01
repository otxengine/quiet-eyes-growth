import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';

const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h between runs

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

    // 24h delta guard
    if (!req.body.force && shouldSkipAgent(businessProfileId, 'competitorMoveTracker', MIN_INTERVAL_MS)) {
      return res.json({ moves_detected: 0, skipped: true, reason: 'ran_recently' });
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

      // Only real detected changes — not static data
      if (c.trend_direction === 'up') changes.push('דירוג עלה לאחרונה');
      if (c.trend_direction === 'down') changes.push('דירוג ירד לאחרונה');
      if (c.price_changed_at && new Date(c.price_changed_at) > new Date(Date.now() - 14 * 86400000)) {
        changes.push(`מחירים שונו לאחרונה: ${c.last_known_prices?.substring(0, 60) || 'עדכון מחירים'}`);
      }
      if (c.current_promotions) changes.push(`מבצע חדש: ${c.current_promotions.substring(0, 80)}`);
      if (c.menu_highlights) changes.push(`שירות/מוצר חדש: ${c.menu_highlights.substring(0, 80)}`);

      return {
        name: c.name,
        weaknesses: c.weaknesses?.substring(0, 100),
        changes,
      };
    });

    // Only pass competitors that have real detected changes
    const competitorsWithChanges = competitorContext.filter(c => c.changes.length > 0);
    if (competitorsWithChanges.length === 0) {
      setLastRun(businessProfileId, 'competitorMoveTracker');
      await writeAutomationLog('competitorMoveTracker', businessProfileId, startTime, 0);
      return res.json({ moves_detected: 0, message: 'No real changes detected' });
    }

    const result = await invokeLLM({
      maxTokens: 600,
      prompt: `You are a competitive analyst for the business "${profile.name}" (${profile.category}, ${profile.city}).

The following competitors have REAL DETECTED CHANGES from recent monitoring. Report ONLY on these specific changes — do NOT invent or generalize from static data.

${competitorsWithChanges.map(c => `
Competitor: ${c.name}
Detected changes: ${c.changes.join(' | ')}
Known weakness: ${c.weaknesses || 'N/A'}
`).join('\n---\n')}

For each detected change, create ONE move entry describing what changed and what to do.
Do NOT create entries for competitors with no changes.
Do NOT invent moves based on rating comparisons or general market observations.

Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "moves": [{
    "competitor_name": "competitor name",
    "move_type": "price_change|new_service|promotion|rating_drop|rating_rise",
    "description": "exact description of the specific detected change — 10-15 words",
    "threat_level": "high|medium|low",
    "recommended_response": "one specific action to take — verb + channel + content",
    "opportunity": "one specific opportunity this creates for us, or null",
    "has_actionable_move": true
  }]
}`,
      response_json_schema: { type: 'object' },
    });

    const moves: any[] = result?.moves || [];
    let created = 0;

    for (const move of moves) {
      if (!move.competitor_name || !move.description) continue;
      if (!move.has_actionable_move) continue;
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
            action_label: move.recommended_response?.split(' ').slice(0, 5).join(' ') || 'בצע פעולה',
            action_type: 'task',
            urgency_hours: move.threat_level === 'high' ? 12 : 48,
            impact_reason: `${move.competitor_name} עדכן — ${move.move_type === 'promotion' ? 'מבצע פעיל שעלול למשוך לקוחות' : move.move_type === 'price_change' ? 'שינוי מחירים שמשפיע על התחרותיות' : 'שינוי שדורש תגובה'}`,
          }),
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
        },
      });
      recentTitles.add(title);
      created++;
    }

    setLastRun(businessProfileId, 'competitorMoveTracker');
    await writeAutomationLog('competitorMoveTracker', businessProfileId, startTime, created);
    return res.json({ moves_detected: created, items_created: created });
  } catch (err: any) {
    console.error('competitorMoveTracker error:', err.message);
    await writeAutomationLog('competitorMoveTracker', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
