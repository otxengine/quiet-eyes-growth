import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

export async function runMarketIntelligence(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const twoDaysAgo = new Date(Date.now() - 48 * 3600000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000);
    const [allRawSignals, competitors] = await Promise.all([
      prisma.rawSignal.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 50 }),
      prisma.competitor.findMany({ where: { linked_business: businessProfileId } }),
    ]);

    // Three-tier fallback: 48h → 7 days → all → empty
    let signals = allRawSignals.filter(s => new Date(s.detected_at || s.created_date) >= twoDaysAgo).slice(0, 18);
    if (signals.length === 0) signals = allRawSignals.filter(s => new Date(s.detected_at || s.created_date) >= sevenDaysAgo).slice(0, 18);
    if (signals.length === 0) signals = allRawSignals.slice(0, 18);
    const competitorContext = competitors.length > 0
      ? `\nמתחרים מזוהים:\n${competitors.slice(0, 5).map(c => `- ${c.name}: דירוג ${c.rating || '?'}, חוזקות: ${c.strengths || '?'}`).join('\n')}`
      : '';

    // ── Cold-start: no raw signals yet — generate sector-level insights from context alone ──
    if (signals.length === 0) {
      const coldResult = await invokeLLM({
        prompt: `אתה אנליסט מודיעין שוק לעסקים קטנים בישראל.
עסק חדש ללא נתוני שוק עדיין. בנה תובנות ראשוניות רלוונטיות לסקטור ולעיר.

עסק: "${profile.name}" | תחום: ${profile.category} | עיר: ${profile.city}
${profile.description ? `תיאור: ${profile.description}` : ''}${competitorContext}
צור 3 תובנות אסטרטגיות ראשוניות ספציפיות לסקטור זה בישראל.
כל תובנה חייבת להיות ספציפית לסקטור ולעיר — לא גנרית.

JSON בלבד:
{"insights":[{
  "summary": "כותרת ספציפית לסקטור ולעיר",
  "impact_level": "high|medium|low",
  "category": "opportunity|trend|threat|competitor_move",
  "recommended_action": "פועל ציווי + פעולה ספציפית",
  "action_label": "3-4 מילים עם פועל",
  "action_type": "social_post|promote|task|call",
  "prefilled_text": "טקסט מוכן לשימוש ישיר בעברית — 30-50 מילים",
  "time_minutes": 15,
  "confidence": 65,
  "urgency_hours": 48,
  "impact_reason": "מה יקרה אם לא יפעלו עכשיו — משפט אחד"
}]}`,
        response_json_schema: { type: 'object' },
      });

      const coldInsights = coldResult?.insights || [];
      const existingCold = await prisma.marketSignal.findMany({ where: { linked_business: businessProfileId } });
      const existingSumsCold = new Set(existingCold.map(e => e.summary));
      let coldCreated = 0;

      for (const insight of coldInsights) {
        if (!insight.summary || existingSumsCold.has(insight.summary)) continue;
        const actionMeta = JSON.stringify({
          action_label:  insight.action_label || 'פתח משימה',
          action_type:   insight.action_type || 'task',
          prefilled_text: insight.prefilled_text || '',
          time_minutes:  insight.time_minutes || 15,
          urgency_hours: insight.urgency_hours || 48,
          impact_reason: insight.impact_reason || '',
        });
        await prisma.marketSignal.create({
          data: {
            summary: insight.summary,
            impact_level: insight.impact_level || 'medium',
            category: insight.category || 'opportunity',
            recommended_action: insight.recommended_action || '',
            confidence: insight.confidence || 65,
            source_urls: '',
            source_description: actionMeta,
            is_read: false,
            detected_at: new Date().toISOString(),
            linked_business: businessProfileId,
          },
        });
        existingSumsCold.add(insight.summary);
        coldCreated++;
      }

      await writeAutomationLog('runMarketIntelligence', businessProfileId, startTime, coldCreated);
      return res.json({ signals_processed: 0, insights_generated: coldCreated, cold_start: true });
    }

    const contextBlock = signals.map(s =>
      `[${s.signal_type}/${s.platform || 'web'}] Source: ${s.source}\nContent: ${s.content}\nURL: ${s.url}`
    ).join('\n---\n');

    const result = await invokeLLM({
      prompt: `אתה אנליסט מודיעין שוק לעסקים קטנים בישראל. ניתח את האותות הבאים וצור תובנות ספציפיות ואקציונביליות.

עסק: "${profile.name}" | תחום: ${profile.category} | עיר: ${profile.city}
${profile.description ? `תיאור: ${profile.description}` : ''}
${competitorContext}
אותות גולמיים (${signals.length} אותות):
${contextBlock}

כללים קריטיים לתובנות:
1. כל summary חייב לכלול שם ספציפי, מספר, או מיקום (לא "עלייה בביקוש" — אלא "עלייה של 30% בחיפושי מסעדות בתל אביב")
2. כל recommended_action חייבת להתחיל בפועל ציווי ספציפי ("פרסם", "הגב", "התקשר", "שלח")
3. action_label חייב להיות קצר, ספציפי, עם פועל (מקסימום 5 מילים)
4. action_type: אחד מ: social_post / respond / promote / call / task
5. prefilled_text: טקסט מוכן לפעולה (פוסט/תגובה/הצעה) בעברית — 30-80 מילים
6. time_minutes: זמן ביצוע ריאלי (5-60 דקות)

החזר JSON בדיוק:
{"insights":[{
  "summary": "כותרת ספציפית עם מספר/שם/מיקום",
  "impact_level": "high|medium|low",
  "category": "threat|opportunity|trend|competitor_move|mention",
  "recommended_action": "פעולה ספציפית בעברית",
  "action_label": "פועל + עצם קצר",
  "action_type": "social_post|respond|promote|call|task",
  "prefilled_text": "טקסט מוכן לשימוש...",
  "time_minutes": 15,
  "confidence": 75,
  "source_urls": ["url1","url2"],
  "urgency_hours": 24,
  "impact_reason": "מה יקרה אם לא יפעלו עכשיו — משפט אחד"
}]}`,
      response_json_schema: { type: 'object' },
    });

    const insights = result?.insights || [];
    const existingSignals = await prisma.marketSignal.findMany({ where: { linked_business: businessProfileId } });
    const existingSummaries = new Set(existingSignals.map(e => e.summary));

    let created = 0;
    let dupes = 0;
    for (const insight of insights) {
      if (!insight.summary || existingSummaries.has(insight.summary)) { dupes++; continue; }
      const sourceUrls = (insight.source_urls || []).filter((u: string) => u?.startsWith('http'));
      // Store action metadata in source_description as JSON for use by UI
      const actionMeta = JSON.stringify({
        action_label:  insight.action_label || insight.recommended_action?.split(' ').slice(0, 4).join(' ') || 'פתח משימה',
        action_type:   insight.action_type || 'task',
        prefilled_text: insight.prefilled_text || '',
        time_minutes:  insight.time_minutes || 15,
        urgency_hours: insight.urgency_hours || 24,
        impact_reason: insight.impact_reason || '',
      });
      await prisma.marketSignal.create({
        data: {
          summary: insight.summary,
          impact_level: insight.impact_level || 'medium',
          category: insight.category || 'trend',
          recommended_action: insight.recommended_action || '',
          confidence: insight.confidence || 70,
          source_urls: sourceUrls.join(' | '),
          source_description: actionMeta,
          is_read: false,
          detected_at: new Date().toISOString(),
          linked_business: businessProfileId,
        },
      });
      existingSummaries.add(insight.summary);
      created++;
    }

    await writeAutomationLog('runMarketIntelligence', businessProfileId, startTime, created);
    console.log(`runMarketIntelligence done: ${created} insights from ${signals.length} signals`);
    return res.json({ signals_processed: signals.length, insights_generated: created, duplicates_skipped: dupes });
  } catch (err: any) {
    console.error('runMarketIntelligence error:', err.message);
    await writeAutomationLog('runMarketIntelligence', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
