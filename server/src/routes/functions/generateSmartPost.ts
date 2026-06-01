import { Request, Response } from 'express';
import { prisma } from '../../db';
import { callAI, callAIJson } from '../../lib/ai_router';
import { callGemini } from '../../lib/gemini';
import { loadBusinessContext, formatContextForPrompt } from '../../lib/businessContext';
import { buildAgentPromptContext } from '../../lib/businessProfile';
import { getAllMissions } from '../../lib/missionPlanner';

/**
 * generateSmartPost — Multi-brain post generation pipeline.
 *
 * Phase 1a (Claude Sonnet):    deep audience profile from OSINT data
 * Phase 1b (Gemini Flash):     behavioral keywords + targeting angle (parallel)
 * Phase 2a (GPT-4o):           variant A post copy — creative/quality
 * Phase 2b (Gemini Flash):     variant B post copy — fast/different angle
 *
 * Body: { businessProfileId, insight_text, action_label?, platform? }
 * Returns: { post, variant_b, audience, imagePrompt }
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
    const [profile, leads, reviews, competitors, bizCtx, recentPosts] = await Promise.all([
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
      loadBusinessContext(businessProfileId),
      prisma.organicPost.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 5,
        select: { content: true },
      }),
    ]);

    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    // ML context: inject learned tone/style preferences into post generation
    const mlContext = formatContextForPrompt(bizCtx, 'generateSmartPost');

    // Mission intelligence: sector-tuned hooks, hashtags, content strategy
    const allMissions = getAllMissions(profile);
    const contentMissions = allMissions?.content;
    const sectorCtxBlock = buildAgentPromptContext(profile);
    const hooksBlock = contentMissions?.post_hooks_he?.slice(0, 3).join('\n• ') || '';
    const hashtagGuide = contentMissions?.hashtags
      ? `Sector hashtags — primary: ${(contentMissions.hashtags.primary || []).join(' ')} | local: ${(contentMissions.hashtags.local || []).join(' ')} | trending: ${(contentMissions.hashtags.trending || []).join(' ')}`
      : '';

    // Recent post hooks to avoid repeating
    const recentHooks = recentPosts
      .map(p => (p.content || '').split('\n')[0].slice(0, 80))
      .filter(Boolean);
    const avoidHooksBlock = recentHooks.length > 0
      ? `Recent post openers (DO NOT repeat these hooks):\n${recentHooks.map(h => `• ${h}`).join('\n')}`
      : '';

    const leadSummary = leads
      .slice(0, 5)
      .map(l => `• [${l.source || '?'}] ${(l.service_needed || '').slice(0, 50)}`)
      .join('\n') || 'אין לידים';

    const reviewSummary = reviews
      .slice(0, 4)
      .map(r => `• [${r.sentiment || '?'}] "${(r.text || '').slice(0, 60)}"`)
      .join('\n') || 'אין ביקורות';

    // ── Phase 1: Dual-brain audience analysis (Claude + Gemini in parallel) ──
    console.log('[generateSmartPost] Phase 1: building audience (Claude + Gemini)...');

    const audienceBasePrompt = `
${sectorCtxBlock}

Business: "${profile.name}" — ${profile.category} in ${profile.city}
Services: ${profile.relevant_services || 'not specified'}
${profile.description ? `Description: ${profile.description}` : ''}
Specific insight: "${insight_text}"
Suggested action: "${action_label}"
Platform: ${platform}

Leads (OSINT): ${leadSummary}
Reviews (OSINT): ${reviewSummary}
Competitors: ${competitors.map(c => c.name).join(', ') || 'none'}`;

    // Phase 1a: Claude Sonnet — deep demographic + behavioral profile
    const claudeAudiencePromise = callAIJson<any>('build_audience', `${audienceBasePrompt}

Build a precise target-audience profile. Return ONLY valid JSON. ALL string values must be in Hebrew:
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

    // Phase 1b: Gemini Flash — behavioral keywords + content angle (fast, parallel)
    const geminiAudiencePromise = callGemini(
      `${audienceBasePrompt}

Based on this data, suggest 3 behavioral targeting keywords and 1 content angle for ${platform}. Return ONLY valid JSON in Hebrew:
{"behavioral_keywords":["מילה1","מילה2","מילה3"],"content_angle":"זווית תוכן ספציפית שתעבוד לקהל הזה — עד 10 מילים"}`,
      'gemini-flash', 200,
      { jsonMode: true },
    ).then(raw => {
      try {
        const clean = raw.replace(/```json?|```/g, '').trim();
        return JSON.parse(clean);
      } catch { return null; }
    }).catch(() => null);

    const [audience, geminiAudienceHints] = await Promise.all([claudeAudiencePromise, geminiAudiencePromise]);

    // Merge Gemini behavioral hints into audience
    if (geminiAudienceHints?.behavioral_keywords?.length) {
      audience.targeting_phrases = [
        ...(audience.targeting_phrases || []),
        ...geminiAudienceHints.behavioral_keywords,
      ].slice(0, 6);
    }
    if (geminiAudienceHints?.content_angle) {
      audience.gemini_angle = geminiAudienceHints.content_angle;
    }

    // ── Phase 2: Dual-brain post generation (GPT-4o variant A + Gemini Flash variant B) ──
    console.log('[generateSmartPost] Phase 2: GPT-4o (A) + Gemini Flash (B) writing posts...');
    const platformStyle = {
      instagram: 'אימוג׳ים, hashtags, סגנון צעיר ויצירתי, מקסימום 120 מילים',
      facebook:  'קצת יותר טקסט, נרטיב, פחות אימוג׳ים, מקסימום 180 מילים',
      whatsapp:  'אישי, קצר, ישיר, מקסימום 50 מילים, ללא hashtags',
    }[platform as string] || 'קצר ומשפיע, מקסימום 120 מילים';

    const postBaseContext = `
${mlContext}
Business: "${profile.name}" — ${profile.category} in ${profile.city}
${profile.description ? `Description: ${profile.description}` : ''}
Insight: "${insight_text}"
Audience: ${audience.age_range}, ${audience.gender}
Pain point: ${audience.pain_point}
Trigger: ${audience.purchase_trigger}
Style: ${platformStyle}
${hooksBlock ? `\nHook examples for this sector (DO NOT copy, use as tone guide):\n• ${hooksBlock}` : ''}
${hashtagGuide ? `\n${hashtagGuide}` : ''}
${avoidHooksBlock ? `\n${avoidHooksBlock}` : ''}
${audience.gemini_angle ? `\nContent angle to explore: ${audience.gemini_angle}` : ''}`;

    // Phase 2a: GPT-4o — variant A (question hook, high quality)
    const gptPostPromise = callAIJson<any>('generate_post', `
Write ONE marketing post (variant A) for ${platform} in Hebrew. Open with a QUESTION hook.
${postBaseContext}

Rules:
• Open with a question hook
• Touch the pain point precisely (not generic)
• End with a clear CTA
• Write natural Hebrew, not a translation from English

Return ONLY valid JSON. image_description must be in English only:
{
  "text": "הפוסט המלא",
  "hook": "ה-hook בלבד",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "cta": "קריאה לפעולה — עד 5 מילים",
  "audience_note": "למה הפוסט מדבר לקהל — משפט קצר",
  "image_description": "6-8 English words for ideal marketing photo (no Hebrew, no punctuation)"
}`, {
      systemPrompt: `You are an experienced marketing copywriter for the Israeli market. Write natural Hebrew — not a translation. Avoid corporate speak. ALL string values in Hebrew, except image_description which must be English only.`,
    });

    // Phase 2b: Gemini Flash — variant B (bold statement hook, different angle, faster/cheaper)
    const geminiPostPromise = callAI('generate_post_fast', `
Write ONE marketing post (variant B) for ${platform} in Hebrew. Open with a BOLD STATEMENT or surprising fact.
${postBaseContext}

Rules:
• Open with a bold statement or surprising fact — NOT a question
• Use a different angle from the obvious one
• Touch the pain point precisely
• End with a clear CTA
• Write natural Hebrew

Return ONLY valid JSON. ALL string values in Hebrew:
{
  "text": "הפוסט המלא",
  "hook": "ה-hook בלבד",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "cta": "קריאה לפעולה — עד 5 מילים"
}`,
    ).then(raw => {
      try {
        const clean = raw.replace(/```json?|```/g, '').trim();
        const obj = JSON.parse(clean.match(/\{[\s\S]*\}/)?.[0] || clean);
        return obj;
      } catch { return null; }
    }).catch(() => null);

    const [postResult, geminiVariantB] = await Promise.all([gptPostPromise, geminiPostPromise]);

    const post = postResult || {};
    if (geminiVariantB?.text) {
      post.variant_b = geminiVariantB;
    }

    const imagePrompt = (post.image_description || '').trim().replace(/['"]/g, '');

    console.log('[generateSmartPost] Done. audience confidence:', audience?.confidence);

    return res.json({
      post: {
        ...post,
        platform,
        best_time: audience.best_time,
      },
      variant_b: post.variant_b || null,
      audience,
      imagePrompt,
    });
  } catch (err: any) {
    console.error('[generateSmartPost] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
