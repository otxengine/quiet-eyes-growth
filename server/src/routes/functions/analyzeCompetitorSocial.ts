import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { tavilySearch } from '../../lib/tavily';

const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h between runs

/**
 * analyzeCompetitorSocial
 * Searches for competitor social media presence and analyzes it via LLM.
 *
 * Body: { businessProfileId, competitorId? }
 * Returns: { analyzed: number, insights: CompetitorSocialInsight[] }
 */
export async function analyzeCompetitorSocial(req: Request, res: Response) {
  const { businessProfileId, competitorId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();

  try {
    const where: any = { linked_business: businessProfileId };
    if (competitorId) where.id = competitorId;

    const competitors = await prisma.competitor.findMany({ where });
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });

    if (profile?.monitor_competitors_social === false) {
      await writeAutomationLog('analyzeCompetitorSocial', businessProfileId, new Date().toISOString(), 0);
      return res.json({ analyzed: 0, skipped: true, reason: 'competitor_monitoring_disabled' });
    }

    // 12h delta guard — social doesn't change faster than that
    if (!req.body.force && shouldSkipAgent(businessProfileId, 'analyzeCompetitorSocial', MIN_INTERVAL_MS)) {
      return res.json({ analyzed: 0, skipped: true, reason: 'ran_recently' });
    }

    const insights: any[] = [];

    for (const comp of competitors.slice(0, 5)) { // max 5 to control API usage
      try {
        const socialResults = await Promise.all([
          tavilySearch(`"${comp.name}" site:instagram.com`, 3),
          tavilySearch(`"${comp.name}" site:facebook.com`, 3),
          tavilySearch(`"${comp.name}" ביקורות לקוחות`, 3),
        ]);
        const allResults = socialResults.flat();
        if (allResults.length === 0) continue;

        const textBlob = allResults
          .map(r => `[${r.url}] ${r.title} — ${(r.content || '').slice(0, 200)}`)
          .join('\n\n');

        const analysis = await invokeLLM({
          model: 'sonnet',
          maxTokens: 600,
          prompt: `You are a senior competitive intelligence analyst. Analyze the digital presence of "${comp.name}" and identify the vulnerability that my business can exploit.

My business: "${profile?.name}" | Sector: ${profile?.category} | City: ${profile?.city}
Competitor: "${comp.name}"

Web findings:
${textBlob.slice(0, 2500)}

Required analysis:
- What channel do they focus on and what content do they publish?
- What is their most prominent weakness based on customer reviews?
- What specific service or gap exists that my business can fill?
- How often do they post?

Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "strongest_channel": "instagram|facebook|google|tiktok|unknown",
  "content_themes": ["specific topic 1", "specific topic 2"],
  "main_weakness": "their clearest weakness — based on review complaints",
  "our_opportunity": "one specific thing my business can do better — be concrete",
  "recommended_action": "verb + channel + specific content — up to 10 words",
  "sentiment_from_reviews": "positive|negative|mixed|unknown",
  "post_frequency": "e.g. 3 פוסטים בשבוע or daily or unknown",
  "has_clear_opportunity": true
}`,
          response_json_schema: { type: 'object' },
        }) as any;

        if (!analysis) continue;

        // ── Write structured social data to new competitor fields ─────────────
        const socialUpdate: Record<string, any> = {
          last_scanned: new Date().toISOString(),
        };
        if (analysis.strongest_channel)       socialUpdate.strongest_channel      = analysis.strongest_channel;
        if (analysis.sentiment_from_reviews)  socialUpdate.sentiment_from_reviews = analysis.sentiment_from_reviews;
        // Only update weaknesses from social if it's richer than what's stored
        if (analysis.main_weakness && (!comp.weaknesses || comp.weaknesses.length < 20)) {
          socialUpdate.weaknesses = analysis.main_weakness;
        }
        if (analysis.content_themes?.length)  socialUpdate.content_themes         = analysis.content_themes.join(', ');
        if (analysis.post_frequency)          socialUpdate.social_post_frequency  = analysis.post_frequency;

        // Extract social URLs from search results
        const igUrl = allResults.find(r => r.url?.includes('instagram.com'))?.url;
        const fbUrl = allResults.find(r => r.url?.includes('facebook.com'))?.url;
        if (igUrl) socialUpdate.instagram_url = igUrl;
        if (fbUrl) socialUpdate.facebook_url  = fbUrl;

        await prisma.competitor.update({
          where: { id: comp.id },
          data: socialUpdate,
        }).catch(() => {});

        // ── Surface opportunity as ProactiveAlert (only when clear) ─────────
        if (analysis.has_clear_opportunity && analysis.our_opportunity && analysis.recommended_action) {
          const alertTitle = `${comp.name}: ${analysis.our_opportunity.slice(0, 70)}`;
          const existing = await prisma.proactiveAlert.findFirst({
            where: {
              linked_business: businessProfileId,
              alert_type: 'competitor_intel',
              title: { contains: comp.name },
              is_dismissed: false,
              created_at: { gte: new Date(Date.now() - 7 * 86400000).toISOString() },
            },
            select: { id: true },
          });
          if (!existing) {
            await prisma.proactiveAlert.create({
              data: {
                linked_business:  businessProfileId,
                alert_type:       'competitor_intel',
                title:            `🔍 ${alertTitle}`,
                description:      analysis.our_opportunity,
                suggested_action: analysis.recommended_action,
                priority:         'medium',
                source_agent:     JSON.stringify({
                  action_label:  analysis.recommended_action.split(' ').slice(0, 5).join(' '),
                  action_type:   'social_post',
                  prefilled_text: `ההזדמנות שלנו מול ${comp.name}:\n\n${analysis.our_opportunity}\n\nפעולה מוצעת: ${analysis.recommended_action}`,
                  urgency_hours: 72,
                  impact_reason: analysis.main_weakness ? `${comp.name} חלש ב: ${analysis.main_weakness.slice(0, 60)}` : '',
                }),
                is_dismissed: false,
                is_acted_on:  false,
                created_at:   new Date().toISOString(),
              },
            }).catch(() => {});
          }
        }

        // ── Publish to agent_data_bus ─────────────────────────────────────────
        await prisma.$executeRawUnsafe(
          `INSERT INTO agent_data_bus (event_type, source_agent, payload) VALUES ($1, $2, $3::jsonb)`,
          'competitor_social_analyzed',
          'analyzeCompetitorSocial',
          JSON.stringify({ competitorId: comp.id, competitorName: comp.name, analysis })
        ).catch(() => {});

        insights.push({ competitor_name: comp.name, ...analysis });
      } catch (_) { /* skip */ }
    }

    setLastRun(businessProfileId, 'analyzeCompetitorSocial');
    await writeAutomationLog('analyzeCompetitorSocial', businessProfileId, startTime, insights.length);
    return res.json({ analyzed: insights.length, insights });
  } catch (err: any) {
    console.error('[analyzeCompetitorSocial] error:', err.message);
    await writeAutomationLog('analyzeCompetitorSocial', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
