import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { loadBusinessContext } from '../../lib/businessContext';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';

/**
 * competitorIntelAgent — OSINT cross-reference: competitor weaknesses × upcoming events
 *
 * For each known competitor:
 * 1. Enriches competitor profile with fresh Tavily search (reviews, mentions)
 * 2. LLM extracts weakness patterns (slow delivery, bad service at peak times, etc.)
 * 3. Cross-references with upcoming events found by detectEvents
 * 4. Generates a specific actionable insight: "During [event], [competitor] struggles with [X] — here's your edge"
 * 5. Creates ProactiveAlert + MarketSignal
 *
 * Runs every 6h alongside GoogleRankMonitor and SmartLeadNurture.
 */
export async function competitorIntelAgent(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city } = profile;

    const bizCtx = await loadBusinessContext(businessProfileId);
    const tone = bizCtx?.preferredTone || profile.tone_preference || 'professional';
    const toneInstruction = tone === 'casual' ? 'קליל וחברותי' : tone === 'warm' ? 'חם ואנושי' : 'מקצועי ואמין';

    // ── 1. Load competitors from DB ───────────────────────────────────────────
    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      orderBy: { created_date: 'desc' },
      take: 5,
    });

    if (competitors.length === 0) {
      await writeAutomationLog('competitorIntelAgent', businessProfileId, startTime, 0);
      return res.json({ insights_created: 0, note: 'No competitors found — add competitors first' });
    }

    // ── 2. Load upcoming events detected by detectEvents (last 14 days) ───────
    const recentEventSignals = await prisma.marketSignal.findMany({
      where: {
        linked_business: businessProfileId,
        category: 'event',
        detected_at: { gte: new Date(Date.now() - 14 * 24 * 3600000).toISOString() },
      },
      orderBy: { detected_at: 'desc' },
      take: 5,
    });

    // Also check proactive alerts for upcoming events
    const upcomingEventAlerts = await prisma.proactiveAlert.findMany({
      where: {
        linked_business: businessProfileId,
        alert_type: 'market_opportunity',
        is_dismissed: false,
      },
      select: { title: true, description: true },
      take: 5,
    });

    const eventsContext = [
      ...recentEventSignals.map(e => e.summary),
      ...upcomingEventAlerts.map(a => a.title.replace(/^[⚽📅🎯]\s*/, '')),
    ].filter(Boolean).join(' | ');

    // ── 3. Process each competitor (max 3 to conserve Tavily credits) ─────────
    let insightsCreated = 0;
    const toProcess = competitors.slice(0, 3);

    for (const competitor of toProcess) {
      try {
        const compName = competitor.name;
        const compRating = competitor.rating;
        const compReviewCount = competitor.review_count;
        const compWeaknesses = competitor.weaknesses || '';
        const compStrengths = competitor.strengths || '';
        const compNotes = competitor.notes || '';

        // ── 3a. Enrich with Tavily (fresh reviews/mentions) ──────────────────
        let freshReviewsText = '';
        if (!isTavilyRateLimited()) {
          const reviewResults = await tavilySearch(
            `"${compName}" ${city} ביקורות חוות דעת שירות 2025 2026`,
            3
          );
          freshReviewsText = reviewResults
            .map(r => `${r.title || ''}: ${(r.content || '').slice(0, 200)}`)
            .filter(t => t.length > 20)
            .join('\n');
        }

        // ── 3b. LLM: extract weakness patterns + cross-reference events ───────
        const insight: any = await invokeLLM({
          model: 'haiku',
          prompt: `אתה אנליסט תחרותי. ספק תובנה אסטרטגית חדה לבעל עסק ישראלי.

העסק שלי: "${name}" (${category}, ${city})
מתחרה: "${compName}"
דירוג מתחרה: ${compRating != null ? compRating + '/5' : 'לא ידוע'} (${compReviewCount != null ? compReviewCount + ' ביקורות' : '? ביקורות'})
חולשות ידועות: ${compWeaknesses || 'לא ידועות'}
חוזקות: ${compStrengths || 'לא ידועות'}
הערות נוספות: ${compNotes || 'אין'}
${freshReviewsText ? `\nביקורות אחרונות ממקורות חיצוניים:\n${freshReviewsText.slice(0, 600)}` : ''}
${eventsContext ? `\nאירועים קרובים שצפויים לגרום לעומס/ביקוש מוגבר: ${eventsContext}` : ''}

בהתבסס על המידע:
1. זהה את החולשה הכי גדולה של ${compName} שאתה יכול לנצל
2. אם יש אירועים קרובים — כיצד החולשה הזו תתגלה במיוחד באירוע?
3. מה הפעולה הספציפית שהעסק שלי צריך לעשות עכשיו?

החזר JSON בדיוק:
{
  "insight_title": "כותרת קצרה עד 8 מילים",
  "insight_body": "תובנה ספציפית ומעשית בעברית — 2-3 משפטים. הזכר את שם המתחרה ואת החולשה הספציפית. אם יש אירוע קרוב — הסבר איך זה קשור.",
  "action": "פעולה אחת ממוקדת שהעסק צריך לעשות עכשיו — עד 10 מילים",
  "prefilled_text": "טקסט מוכן לפרסום/הודעה לקהל לקוחות (2-3 שורות, בעברית, ללא אזכור המתחרה בשמו)",
  "impact": "high|medium",
  "relevant_event": "שם האירוע הקרוב הרלוונטי ביותר, או null אם אין"
}`,
          response_json_schema: { type: 'object' },
        });

        if (!insight?.insight_title || !insight?.action) continue;

        // ── 3c. Deduplicate ───────────────────────────────────────────────────
        const alertTitle = `🔍 ${compName}: ${insight.insight_title}`;
        const existing = await prisma.proactiveAlert.findFirst({
          where: {
            linked_business: businessProfileId,
            title: alertTitle,
            is_dismissed: false,
          },
        });
        if (existing) continue;

        const urgencyHours = insight.impact === 'high' ? 24 : 72;
        const impactReason = insight.relevant_event
          ? `${compName} צפוי להיות חלש במיוחד בזמן ${insight.relevant_event} — זה חלון הזדמנויות שלך`
          : `${compName} (${compRating ? compRating + '★' : '?'}) — ${insight.insight_body?.slice(0, 80)}...`;

        const actionMeta = JSON.stringify({
          action_label: insight.action.split(' ').slice(0, 5).join(' '),
          action_type: 'social_post',
          prefilled_text: insight.prefilled_text || '',
          urgency_hours: urgencyHours,
          impact_reason: impactReason,
        });

        // ── 3d. Create ProactiveAlert ─────────────────────────────────────────
        await prisma.proactiveAlert.create({
          data: {
            alert_type: 'competitor_intel',
            title: alertTitle,
            description: insight.insight_body || '',
            suggested_action: insight.action,
            priority: insight.impact === 'high' ? 'high' : 'medium',
            source_agent: actionMeta,
            is_dismissed: false,
            is_acted_on: false,
            created_at: new Date().toISOString(),
            linked_business: businessProfileId,
          },
        }).catch(() => {});

        // ── 3e. Also create a MarketSignal for the Intelligence page ──────────
        await prisma.marketSignal.create({
          data: {
            summary: `תובנה על ${compName}: ${insight.insight_title}`,
            category: 'competitor',
            impact_level: insight.impact === 'high' ? 'high' : 'medium',
            recommended_action: insight.action,
            confidence: freshReviewsText ? 78 : 65,
            source_signals: 'competitor_osint',
            source_description: JSON.stringify({
              action_label: insight.action.split(' ').slice(0, 5).join(' '),
              action_type: 'social_post',
              prefilled_text: insight.prefilled_text || '',
              time_minutes: 15,
              urgency_hours: urgencyHours,
            }),
            is_read: false,
            detected_at: new Date().toISOString(),
            linked_business: businessProfileId,
          },
        }).catch(() => {});

        // ── 3f. Update competitor's last_scanned + weaknesses if enriched ─────
        if (freshReviewsText && insight.insight_body) {
          const updatedWeaknesses = compWeaknesses
            ? `${compWeaknesses}\n[${new Date().toLocaleDateString('he-IL')}] ${insight.insight_title}`
            : `[${new Date().toLocaleDateString('he-IL')}] ${insight.insight_title}`;

          await prisma.competitor.update({
            where: { id: competitor.id },
            data: {
              last_scanned: new Date().toISOString(),
              weaknesses: updatedWeaknesses.slice(0, 1000),
            },
          }).catch(() => {});
        }

        insightsCreated++;
      } catch (_) {}
    }

    await writeAutomationLog('competitorIntelAgent', businessProfileId, startTime, insightsCreated);
    console.log(`competitorIntelAgent done: ${insightsCreated} insights from ${toProcess.length} competitors`);
    return res.json({ competitors_scanned: toProcess.length, insights_created: insightsCreated });
  } catch (err: any) {
    console.error('competitorIntelAgent error:', err.message);
    await writeAutomationLog('competitorIntelAgent', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
