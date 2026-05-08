import { Request, Response } from 'express';
import { prisma } from '../../db';
import { callAIJson } from '../../lib/ai_router';

/**
 * buildInsightAudience
 * Builds a single, insight-specific audience profile by searching for
 * relevant signals and leads that match the insight's keywords.
 *
 * Body: { businessProfileId, insight_text, action_label?, insight_type? }
 * Returns: { audience: AudienceProfile }
 */
export async function buildInsightAudience(req: Request, res: Response) {
  const { businessProfileId, insight_text, action_label, insight_type } = req.body;
  if (!businessProfileId || !insight_text) {
    return res.status(400).json({ error: 'Missing businessProfileId or insight_text' });
  }

  try {
    // Extract keywords from insight text (Hebrew + English)
    const keywords = insight_text
      .replace(/[^\u0590-\u05FFa-zA-Z\s]/g, '')
      .split(/\s+/)
      .filter((w: string) => w.length > 3)
      .slice(0, 4);

    const [profile, leads, recentReviews, signals] = await Promise.all([
      prisma.businessProfile.findUnique({ where: { id: businessProfileId } }),
      prisma.lead.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { score: 'desc' },
        take: 10,
        select: { service_needed: true, source: true, status: true, score: true },
      }),
      prisma.review.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 8,
        select: { text: true, sentiment: true, rating: true },
      }),
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { detected_at: 'desc' },
        take: 15,
        select: { summary: true, category: true },
      }),
    ]);

    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    // Find signals/reviews relevant to this insight's keywords
    const relevantSignals = signals
      .filter(s => keywords.some(kw => (s.summary || '').includes(kw)))
      .slice(0, 5)
      .map(s => `• ${s.summary.slice(0, 80)}`);

    const topLeads = leads
      .slice(0, 6)
      .map(l => `• [${l.source || '?'}] ${(l.service_needed || '').slice(0, 60)} (סטטוס: ${l.status})`);

    const reviewSample = recentReviews
      .slice(0, 5)
      .map(r => `• [${r.sentiment || '?'}/${r.rating || '?'}⭐] "${(r.text || '').slice(0, 70)}"`);

    let result: any = null;
    try {
      result = await callAIJson('build_audience', `You are an audience targeting expert for Israeli businesses.

Business: "${profile.name}" — ${profile.category} in ${profile.city}
Services: ${profile.relevant_services || 'לא צוינו'}
${profile.description ? `Description: ${profile.description}` : ''}
Specific insight: "${insight_text}"
Proposed action: "${action_label || 'לא צוינה'}"
Type: ${insight_type || 'כללי'}

Signals relevant to this insight:
${relevantSignals.length > 0 ? relevantSignals.join('\n') : 'אין סיגנלים ספציפיים'}

Top leads:
${topLeads.length > 0 ? topLeads.join('\n') : 'אין לידים'}

Recent reviews:
${reviewSample.length > 0 ? reviewSample.join('\n') : 'אין ביקורות'}

Build a target audience specific to this insight only — not a general audience.
Return ONLY valid JSON. ALL string values must be in Hebrew.
{
  "headline": "...",
  "age_range": "XX-XX",
  "gender": "נשים|גברים|מעורב",
  "interests": ["...", "...", "..."],
  "pain_point": "...",
  "why_this_insight_matters": "...",
  "best_channel": "instagram|facebook|whatsapp|google",
  "best_time": "HH:00-HH:00",
  "keywords": ["...", "...", "..."],
  "estimated_size": "קטן|בינוני|גדול",
  "confidence": "high|medium|low"
}`, {
        systemPrompt: 'You are an audience segmentation expert. Build a data-based profile, not general assumptions. ALL string values must be in Hebrew.',
      });
    } catch (aiErr: any) {
      console.warn('[buildInsightAudience] AI parse failed, using estimated fallback:', aiErr.message);
      // Estimated fallback based on profile data only — still useful
      result = {
        headline: `לקוחות ${profile.category} ב${profile.city}`,
        age_range: '25-45',
        gender: 'מעורב',
        interests: [profile.category, 'שירות מקומי'],
        pain_point: insight_text.slice(0, 80),
        why_this_insight_matters: 'התובנה רלוונטית לקהל היעד של העסק',
        best_channel: 'instagram',
        best_time: '18:00-21:00',
        keywords: [profile.category, profile.city],
        estimated_size: 'בינוני',
        confidence: 'low',
      };
    }

    return res.json({ audience: result });
  } catch (err: any) {
    console.error('[buildInsightAudience] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
