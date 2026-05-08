import { Request, Response } from 'express';
import { prisma } from '../../db';
import { callAI, callAIJson } from '../../lib/ai_router';

/**
 * generateSmartPost — Multi-brain post generation pipeline.
 *
 * Phase 1 (Claude Sonnet):  build per-insight audience profile
 * Phase 2 (GPT-4o):         write platform-optimised post copy
 * Phase 3 (GPT-4o-mini):    produce DALL-E image prompt (Hebrew→English)
 *
 * Body: { businessProfileId, insight_text, action_label?, platform? }
 * Returns: { post, audience, imagePrompt }
 */
export async function generateSmartPost(req: Request, res: Response) {
  const {
    businessProfileId,
    insight_text,
    action_label = '',
    platform     = 'instagram',
  } = req.body;

  if (!businessProfileId || !insight_text) {
    return res.status(400).json({ error: 'Missing businessProfileId or insight_text' });
  }

  try {
    const [profile, leads, reviews, competitors] = await Promise.all([
      prisma.businessProfile.findUnique({ where: { id: businessProfileId } }),
      prisma.lead.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { score: 'desc' },
        take: 8,
        select: { service_needed: true, source: true, status: true },
      }),
      prisma.review.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 6,
        select: { text: true, sentiment: true, rating: true },
      }),
      prisma.competitor.findMany({
        where: { linked_business: businessProfileId },
        take: 3,
        select: { name: true, strengths: true },
      }),
    ]);

    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    const leadSummary = leads
      .slice(0, 5)
      .map(l => `• [${l.source || '?'}] ${(l.service_needed || '').slice(0, 50)}`)
      .join('\n') || 'אין לידים';

    const reviewSummary = reviews
      .slice(0, 4)
      .map(r => `• [${r.sentiment || '?'}] "${(r.text || '').slice(0, 60)}"`)
      .join('\n') || 'אין ביקורות';

    // ── Phase 1: Claude builds audience profile ──────────────────────────────
    console.log('[generateSmartPost] Phase 1: Claude building audience...');
    const audience = await callAIJson<any>('build_audience', `
Business: "${profile.name}" — ${profile.category} in ${profile.city}
Services: ${profile.relevant_services || 'not specified'}
${profile.description ? `Description: ${profile.description}` : ''}
Specific insight: "${insight_text}"
Suggested action: "${action_label}"
Platform: ${platform}

Leads: ${leadSummary}
Reviews: ${reviewSummary}
Competitors: ${competitors.map(c => c.name).join(', ') || 'none'}

Build a precise target-audience profile for this insight. Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "age_range": "XX-XX",
  "gender": "נשים|גברים|מעורב",
  "pain_point": "הכאב המרכזי שהתובנה פותרת — משפט קצר",
  "purchase_trigger": "מה גורם להם לקנות — עד 8 מילים",
  "preferred_channel": "instagram|facebook|whatsapp",
  "best_time": "HH:00-HH:00",
  "insight_connection": "למה התובנה רלוונטית לקהל הזה — משפט אחד",
  "targeting_phrases": ["ביטוי פרסום 1", "ביטוי פרסום 2", "ביטוי פרסום 3"],
  "estimated_size": "קטן|בינוני|גדול",
  "confidence": "high|medium|low"
}`, {
      systemPrompt: 'You are an audience segmentation expert. Build a data-based profile, not general assumptions. ALL string values in the JSON must be in Hebrew.',
    });

    // ── Phase 2: GPT-4o writes the post ─────────────────────────────────────
    console.log('[generateSmartPost] Phase 2: GPT-4o writing post...');
    const platformStyle = {
      instagram: 'אימוג׳ים, hashtags, סגנון צעיר ויצירתי, מקסימום 120 מילים',
      facebook:  'קצת יותר טקסט, נרטיב, פחות אימוג׳ים, מקסימום 180 מילים',
      whatsapp:  'אישי, קצר, ישיר, מקסימום 50 מילים, ללא hashtags',
    }[platform as string] || 'קצר ומשפיע, מקסימום 120 מילים';

    const post = await callAIJson<any>('generate_post', `
Write a marketing post for ${platform} in Hebrew.

Business: "${profile.name}" — ${profile.category} in ${profile.city}
${profile.description ? `Description: ${profile.description}` : ''}
Insight: "${insight_text}"
Audience: ${audience.age_range}, ${audience.gender}
Pain point: ${audience.pain_point}
Trigger: ${audience.purchase_trigger}
Style: ${platformStyle}

Rules:
• Open with a hook that grabs attention within 2 seconds
• Touch the audience's pain point
• Offer a solution — the business
• End with a clear CTA
• Write natural Hebrew, not a translation from English

Return ONLY valid JSON. ALL string values must be in Hebrew, EXCEPT image_description which must be in English:
{
  "text": "הפוסט המלא",
  "hook": "המשפט הפותח בלבד",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "cta": "קריאה לפעולה — עד 5 מילים",
  "audience_note": "למה הפוסט מדבר לקהל הזה — משפט קצר",
  "image_description": "6-8 English words describing the ideal marketing photo for this post (no Hebrew, no punctuation, e.g.: fitness gym workout equipment modern bright)"
}`, {
      systemPrompt: `You are an experienced marketing copywriter for the Israeli market.
Write natural Hebrew — not a translation.
Avoid corporate speak such as "מומלץ לשקול" or "ניתן לשקול".
Write the way a real person speaks.
ALL string values in the JSON must be in Hebrew, except image_description which must be in English only.`,
    });

    // image_description is generated inline by GPT-4o in Phase 2 — no separate translation needed
    const imagePrompt = (post.image_description || '').trim().replace(/['"]/g, '');

    console.log('[generateSmartPost] Done. audience confidence:', audience?.confidence);

    return res.json({
      post: {
        ...post,
        platform,
        best_time: audience.best_time,
      },
      audience,
      imagePrompt,
    });
  } catch (err: any) {
    console.error('[generateSmartPost] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
