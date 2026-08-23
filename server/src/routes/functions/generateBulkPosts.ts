import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';

const SUPPORTED_PLATFORMS = ['facebook', 'instagram']; // tiktok not supported for this feature yet

/**
 * generateBulkPosts
 *
 * Generates up to 10 distinct organic post drafts in one LLM call, grounded in
 * whatever competitor outlier-analysis insights the business already has on
 * file (never triggers that analysis itself — it's slow/manual-trigger-only
 * elsewhere) and the business's own media library. Each post gets a matching
 * media asset only when one genuinely fits; otherwise no image.
 *
 * Body: { businessProfileId, count, platform?, special_request?, scheduled_at? }
 *   platform: 'facebook' | 'instagram' | 'both' (default 'both')
 *   special_request: optional free text the business owner wants reflected in the batch (an offer, event, announcement)
 *   scheduled_at: optional ISO datetime — stored on the created posts, informational only (no auto-publish)
 * Returns: { created, requested, posts }
 */
export async function generateBulkPosts(req: Request, res: Response) {
  const { businessProfileId, special_request, scheduled_at } = req.body;
  const count = Math.max(1, Math.min(10, parseInt(req.body.count, 10) || 0));
  const allowedPlatforms = SUPPORTED_PLATFORMS.includes(req.body.platform)
    ? [req.body.platform]
    : SUPPORTED_PLATFORMS; // 'both' or anything else/unset → either platform

  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (!count) return res.status(400).json({ error: 'count must be between 1 and 10' });

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    const [mediaAssets, recentPosts] = await Promise.all([
      prisma.mediaAsset.findMany({
        where: { linked_business: businessProfileId, media_type: 'image', description: { not: null } },
        select: { id: true, description: true },
        take: 40,
      }),
      prisma.organicPost.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: new Date(Date.now() - 14 * 86400000) } },
        orderBy: { created_date: 'desc' },
        take: 10,
        select: { content: true },
      }),
    ]);

    let copyExamples: { competitorName: string; text: string }[] = [];
    try { copyExamples = JSON.parse(profile.content_trends_copy_examples || '[]'); } catch {}

    const competitorCopyBlock = profile.content_trends_copy_insight
      ? `=== דפוסי תוכן מצליחים בענף (מבוסס ניתוח מתחרים) ===\n${profile.content_trends_copy_insight}${
          copyExamples.length ? `\nדוגמאות אמיתיות (השראה בלבד — אסור להעתיק):\n${copyExamples.map(e => `• [${e.competitorName}] "${e.text}"`).join('\n')}` : ''
        }`
      : '';

    const competitorVisualBlock = profile.content_trends_visual_insight
      ? `=== דפוסים ויזואליים מצליחים בענף ===\n${profile.content_trends_visual_insight}`
      : '';

    const ownOutlierBlock = profile.outlier_insight
      ? `=== מה עבד הכי טוב בפוסטים הקודמים של העסק עצמו ===\n${profile.outlier_insight}`
      : '';

    const avoidTopics = recentPosts.map(p => (p.content || '').slice(0, 60)).filter(Boolean);
    const avoidBlock = avoidTopics.length
      ? `=== נושאים שפורסמו לאחרונה — אל תחזור עליהם ===\n${avoidTopics.map(t => `• ${t}`).join('\n')}`
      : '';

    const mediaBlock = mediaAssets.length
      ? `=== ספריית מדיה זמינה (בחר תמונה רק אם היא באמת מתאימה לתוכן הפוסט) ===\n${mediaAssets.map(m => `[${m.id}] ${m.description}`).join('\n')}\nאם אף תמונה לא מתאימה לתוכן פוסט מסוים — אל תבחר תמונה בשבילו. אל תמציא id. עדיף פוסט בלי תמונה מאשר תמונה לא רלוונטית. עדיף גם לא לחזור על אותה תמונה בכמה פוסטים אלא אם באמת אין ברירה.`
      : `אין תמונות זמינות בספריית המדיה — כל הפוסטים יהיו ללא תמונה (media_asset_id: null).`;

    const descriptionLine = profile.description ? `תיאור העסק: ${profile.description}\n` : '';

    const specialRequestBlock = special_request?.trim()
      ? `=== בקשה ספציפית מבעל העסק — חובה לשלב בפוסטים (בכולם או בחלקם, לפי מה שהכי טבעי) ===\n${special_request.trim()}`
      : '';

    const prompt = `אתה קופירייטר בכיר לרשתות חברתיות עבור עסקים קטנים בישראל. המשימה: כתוב בדיוק ${count} טיוטות פוסטים שונות ומגוונות — מוכנות לפרסום ישיר, ללא עריכה.

עסק: "${profile.name}" (${profile.category}, ${profile.city})
${descriptionLine}
${specialRequestBlock ? `\n${specialRequestBlock}` : ''}
${competitorCopyBlock ? `\n${competitorCopyBlock}` : ''}
${competitorVisualBlock ? `\n${competitorVisualBlock}` : ''}
${ownOutlierBlock ? `\n${ownOutlierBlock}` : ''}
${avoidBlock ? `\n${avoidBlock}` : ''}

${mediaBlock}

כללי כתיבה:
1. כל פוסט בנושא/זווית/Hook שונה לגמרי מהאחרים — אסור פוסטים דומים.
2. כל פוסט: Hook פותח חזק, גוף עם ערך אמיתי (60-100 מילה), CTA ברור בסוף, 3-6 האשטאגים רלוונטיים.
3. platform לכל פוסט: ${allowedPlatforms.length > 1 ? `בחר ${allowedPlatforms.join('/')} לפי מה שהכי מתאים לתוכן, תוך גיוון בין הפוסטים` : `כל הפוסטים עבור ${allowedPlatforms[0]} בלבד`}.
4. media_asset_id: אך ורק id מדויק מהרשימה למעלה, או null. לעולם אל תמציא id.

Return ONLY valid JSON. ALL string values in Hebrew (except platform/media_asset_id):
{
  "posts": [
    {
      "platform": "${allowedPlatforms.join('|')}",
      "topic": "תווית פנימית קצרה",
      "hook": "...",
      "body": "...",
      "cta": "...",
      "hashtags": "#תג1 #תג2 #תג3",
      "media_asset_id": "id מדויק מהרשימה, או null"
    }
  ]
}`;

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: Math.min(4200, 600 + count * 350),
      skipCache: true,
      profile,
      prompt,
      response_json_schema: { type: 'object' },
    });

    const generated: any[] = (result?.posts || []).slice(0, count);
    const validAssetIds = new Set(mediaAssets.map(a => a.id));
    const usedAssetIds = new Set<string>();
    const serverBase = process.env.SERVER_BASE_URL || 'http://localhost:3007';
    const scheduledAt = scheduled_at ? new Date(scheduled_at) : null;

    const created: any[] = [];
    for (const p of generated) {
      const content = [p?.hook, p?.body, p?.cta ? `→ ${p.cta}` : '', p?.hashtags].filter(Boolean).join('\n\n').trim();
      if (!content) continue;

      let mediaAssetId: string | null = null;
      if (p?.media_asset_id && validAssetIds.has(p.media_asset_id) && !usedAssetIds.has(p.media_asset_id)) {
        mediaAssetId = p.media_asset_id;
        usedAssetIds.add(mediaAssetId);
      }
      const platform = allowedPlatforms.includes(p?.platform) ? p.platform : allowedPlatforms[0];

      const row = await prisma.organicPost.create({
        data: {
          linked_business: businessProfileId,
          platform,
          post_type: 'post',
          content,
          signal_summary: p?.topic || null,
          media_asset_id: mediaAssetId,
          image_url: mediaAssetId ? `${serverBase}/api/social/media/${mediaAssetId}` : null,
          status: 'draft',
          scheduled_at: scheduledAt,
        },
      });
      created.push(row);
    }

    return res.json({ created: created.length, requested: count, posts: created });
  } catch (err: any) {
    console.error('[generateBulkPosts]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
