import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { getSectorContentStrategy } from '../../lib/sectorPrompts';
import { getSectorContext as getAccumulatedSectorCtx } from '../../lib/sectorContext';
import { buildAgentPromptContext, isSignalRelevant } from '../../lib/businessProfile';
import { publishEvent } from '../../lib/eventBus';

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
    const [allRawSignals, competitors, accumulatedSectorCtx] = await Promise.all([
      prisma.rawSignal.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 50 }),
      prisma.competitor.findMany({ where: { linked_business: businessProfileId } }),
      getAccumulatedSectorCtx(profile.category),
    ]);

    // Three-tier fallback: 48h → 7 days → all → empty
    // Filter out signals on irrelevant topics based on AI sector profile
    let signals = allRawSignals
      .filter(s => isSignalRelevant(s, profile))
      .filter(s => new Date(s.detected_at || s.created_date) >= twoDaysAgo).slice(0, 18);
    if (signals.length === 0) signals = allRawSignals.filter(s => isSignalRelevant(s, profile) && new Date(s.detected_at || s.created_date) >= sevenDaysAgo).slice(0, 18);
    if (signals.length === 0) signals = allRawSignals.filter(s => isSignalRelevant(s, profile)).slice(0, 18);
    if (signals.length === 0) signals = allRawSignals.slice(0, 18); // absolute fallback

    const competitorContext = competitors.length > 0
      ? `\nמתחרים מזוהים:\n${competitors.slice(0, 5).map(c => `- ${c.name}: דירוג ${c.rating || '?'}, חוזקות: ${c.strengths || '?'}`).join('\n')}`
      : '';

    const sectorCtx = getSectorContentStrategy(profile.category);
    const profileCtx = buildAgentPromptContext(profile);

    // ── Cold-start: no raw signals yet — generate sector-level insights from context alone ──
    if (signals.length === 0) {
      const coldResult = await invokeLLM({
        model: 'sonnet',
        maxTokens: 1200,
        prompt: `You are a senior market intelligence analyst for small businesses in Israel.
Return ONLY valid JSON. ALL string values must be in Hebrew.

${profileCtx}
${profile.relevant_services ? `Services: ${profile.relevant_services}` : ''}
${competitorContext}

${sectorCtx}
${accumulatedSectorCtx ? `\n${accumulatedSectorCtx}` : ''}
Generate 4-5 initial market insights that are specific and actionable for this sector and city in Israel.
Each insight must:
• stem from understanding of the specific sector (not generic)
• include a focused action that ${profile.name} can take as early as tomorrow
• include a realistic prefilled_text the user can copy directly

Return ONLY valid JSON:
{"insights":[{
  "summary": "תובנה ספציפית לסקטור + עיר — עם מספר או שם",
  "impact_level": "high|medium|low",
  "category": "opportunity|trend|threat|competitor_move|demand_gap",
  "recommended_action": "פועל ציווי + ערוץ + תוכן ספציפי",
  "action_label": "3-4 מילים עם פועל",
  "action_type": "social_post|promote|task|call",
  "action_platform": "instagram|facebook|tiktok|google|whatsapp|wolt|ten_bis|website|general",
  "platform_reason": "מדוע פלטפורמה זו מתאימה לסקטור זה — נימוק ספציפי",
  "prefilled_text": "טקסט מוכן לשימוש ישיר בעברית — 40-70 מילים עם Hook + ערך + CTA",
  "time_minutes": 15,
  "confidence": 70,
  "urgency_hours": 48,
  "impact_reason": "נזק/רווח קונקרטי אם לא/כן יפעלו"
}]}`,
        response_json_schema: { type: 'object' },
      });

      const coldInsights = coldResult?.insights || [];
      const existingCold = await prisma.marketSignal.findMany({ where: { linked_business: businessProfileId } });
      const existingSumsCold = new Set(existingCold.map(e => e.summary));
      let coldCreated = 0;

      for (const insight of coldInsights) {
        if (!insight.summary || existingSumsCold.has(insight.summary)) continue;
        if ((insight.confidence ?? 100) < 40) continue; // skip low-confidence insights
        const actionMeta = JSON.stringify({
          action_label:    insight.action_label || 'פתח משימה',
          action_type:     insight.action_type || 'task',
          action_platform: insight.action_platform || '',
          platform_reason: insight.platform_reason || '',
          prefilled_text:  insight.prefilled_text || '',
          time_minutes:    insight.time_minutes || 15,
          urgency_hours:   insight.urgency_hours || 48,
          impact_reason:   insight.impact_reason || '',
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
      model: 'sonnet',
      maxTokens: 1500,
      prompt: `You are a senior market intelligence analyst for small businesses in Israel. Analyze the following signals and generate specific, actionable insights.
Return ONLY valid JSON. ALL string values must be in Hebrew.

${profileCtx}
${profile.relevant_services ? `Services: ${profile.relevant_services}` : ''}
${competitorContext}

${sectorCtx}
${accumulatedSectorCtx ? `\n${accumulatedSectorCtx}` : ''}
Raw signals (${signals.length} signals):
${contextBlock}

Critical rules for insights:
1. Every summary must include a specific name, number, or location (not "rise in demand" — but "30% rise in restaurant searches in Tel Aviv")
2. Every recommended_action must start with a specific imperative verb ("פרסם", "הגב", "התקשר", "שלח")
3. action_label must be short, specific, with a verb (maximum 5 words)
4. action_type: one of: social_post / respond / promote / call / task
5. action_platform: the most suitable platform for this action — choose: instagram (visual content, audience 18-40, restaurants/beauty/fashion) | facebook (events, local audience, 30+) | tiktok (viral content, audience 16-30) | google (reviews, local SEO) | whatsapp (direct communication, blasts) | wolt / ten_bis (delivery promos) | general (when all platforms are relevant)
6. platform_reason: one sentence in Hebrew — why this platform suits this business and this insight
7. prefilled_text: ready-to-use action text (post/reply/offer) in Hebrew — 30-80 words
8. time_minutes: realistic execution time (5-60 minutes)

Return ONLY valid JSON:
{"insights":[{
  "summary": "כותרת ספציפית עם מספר/שם/מיקום",
  "impact_level": "high|medium|low",
  "category": "threat|opportunity|trend|competitor_move|mention",
  "recommended_action": "פעולה ספציפית בעברית",
  "action_label": "פועל + עצם קצר",
  "action_type": "social_post|respond|promote|call|task",
  "action_platform": "instagram|facebook|tiktok|google|whatsapp|wolt|ten_bis|general",
  "platform_reason": "מדוע פלטפורמה זו — משפט אחד",
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
      if ((insight.confidence ?? 100) < 40) continue; // skip low-confidence insights
      const sourceUrls = (insight.source_urls || []).filter((u: string) => u?.startsWith('http'));
      // Store action metadata in source_description as JSON for use by UI
      const actionMeta = JSON.stringify({
        action_label:    insight.action_label || insight.recommended_action?.split(' ').slice(0, 4).join(' ') || 'פתח משימה',
        action_type:     insight.action_type || 'task',
        action_platform: insight.action_platform || '',
        platform_reason: insight.platform_reason || '',
        prefilled_text:  insight.prefilled_text || '',
        time_minutes:    insight.time_minutes || 15,
        urgency_hours:   insight.urgency_hours || 24,
        impact_reason:   insight.impact_reason || '',
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

    // OTX-001: publish market_signal event for each high-impact insight generated
    if (created > 0) {
      publishEvent({
        businessId: businessProfileId,
        eventType: 'market_signal',
        source: 'runMarketIntelligence',
        payload: { insights_generated: created, signals_analyzed: signals.length },
        contextAttrs: { category: profile.category, city: profile.city, impact: created >= 3 ? 'high' : 'medium' },
      }).catch(() => {});
    }

    console.log(`runMarketIntelligence done: ${created} insights from ${signals.length} signals`);
    return res.json({ signals_processed: signals.length, insights_generated: created, duplicates_skipped: dupes });
  } catch (err: any) {
    console.error('runMarketIntelligence error:', err.message);
    await writeAutomationLog('runMarketIntelligence', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
