import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { isS3Url, downloadFromS3 } from '../../lib/s3';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

const VALID_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

async function toBase64Image(url: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    if (isS3Url(url)) {
      const obj = await downloadFromS3(url);
      if (!obj) return null;
      const mt = VALID_MIME.has(obj.contentType) ? obj.contentType : 'image/jpeg';
      return { data: obj.body.toString('base64'), mediaType: mt };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ct  = res.headers.get('content-type') || 'image/jpeg';
    return { data: buf.toString('base64'), mediaType: VALID_MIME.has(ct) ? ct : 'image/jpeg' };
  } catch {
    return null;
  }
}

export async function analyzeSocialPosts(req: Request, res: Response) {
  const { competitorId, businessProfileId } = req.body;
  if (!competitorId || !businessProfileId) {
    return res.status(400).json({ error: 'Missing competitorId or businessProfileId' });
  }

  try {
    const competitor = await prisma.competitor.findFirst({
      where: { id: competitorId, linked_business: businessProfileId },
      select: {
        name: true, category: true,
        content_themes: true, engagement_level: true,
        strongest_channel: true, social_post_frequency: true,
        social_followers_est: true,
      },
    });
    if (!competitor) return res.status(404).json({ error: 'Competitor not found' });

    // Raw SQL to avoid Prisma P2023 on Render (TIMESTAMPTZ OID mismatch)
    const posts = await (prisma as any).$queryRawUnsafe(
      `SELECT caption, media_url, posted_at, likes, comments_count
       FROM competitor_posts WHERE competitor_id = $1
       ORDER BY posted_at DESC NULLS LAST LIMIT 20`,
      competitorId,
    ) as { caption: string | null; media_url: string | null; posted_at: Date | null; likes: number | null; comments_count: number | null }[];

    // Raw SQL for ads to avoid P2023 on TIMESTAMPTZ columns
    const ads = await (prisma as any).$queryRawUnsafe(
      `SELECT title, body, cta, platform, is_active
       FROM competitor_ad_history WHERE competitor_id = $1
       ORDER BY last_seen_at DESC NULLS LAST LIMIT 10`,
      competitorId,
    ) as { title: string | null; body: string | null; cta: string | null; platform: string; is_active: boolean }[];

    const captionSummary = posts
      .filter(p => p.caption)
      .slice(0, 10)
      .map((p, i) => `Post ${i + 1} (❤️${p.likes ?? '?'} 💬${p.comments_count ?? '?'}): "${p.caption!.substring(0, 200)}"`)
      .join('\n');

    const adSummary = ads.length
      ? ads.map(a => `[${a.platform}${a.is_active ? ' ACTIVE' : ''}] ${a.title || ''} | ${(a.body || '').substring(0, 150)} | CTA: ${a.cta || '—'}`).join('\n')
      : 'No ads found.';

    // Try vision analysis with Anthropic if credits available (fails gracefully)
    let visionNote = 'No images analyzed.';
    const mediaUrls = posts.map(p => p.media_url).filter(Boolean) as string[];
    let imagesAnalyzed = 0;

    if (process.env.ANTHROPIC_API_KEY && mediaUrls.length > 0) {
      try {
        const imageResults = await Promise.all(mediaUrls.slice(0, 3).map(toBase64Image));
        const images = imageResults.filter(Boolean) as { data: string; mediaType: string }[];
        if (images.length > 0) {
          const visionContent: any[] = [
            ...images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType as any, data: img.data } })),
            { type: 'text', text: `Describe the visual style of these ${images.length} competitor social media images in 2 sentences. Focus on: color palette, subject matter (people/food/product/location), composition style, and overall aesthetic.` },
          ];
          const visionMsg = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 200,
            system: 'You are a visual analyst. Be concise and specific.',
            messages: [{ role: 'user', content: visionContent }],
          });
          visionNote = (visionMsg.content[0] as any).text || visionNote;
          imagesAnalyzed = images.length;
        }
      } catch {
        // Vision failed (likely credits) — text analysis still runs below
      }
    }

    const prompt = `Analyze this competitor's social media strategy.

Competitor: "${competitor.name}" (${competitor.category || 'business'})
Known metadata: channel=${competitor.strongest_channel || '?'}, engagement=${competitor.engagement_level || '?'}, frequency=${competitor.social_post_frequency || '?'}, followers=${competitor.social_followers_est || '?'}, themes=${competitor.content_themes || '?'}
Visual identity (from images): ${visionNote}

Recent posts (${posts.length} total):
${captionSummary || 'No captions available.'}

Ads (${ads.length} total):
${adSummary}

Return JSON with these exact keys:
{
  "visual_identity": "2-3 sentences on visual style and aesthetic based on available data",
  "content_pillars": ["topic 1", "topic 2", "topic 3"],
  "caption_patterns": "1-2 sentences on caption style: CTA usage, hashtags, tone, length",
  "ad_messaging": "1-2 sentences on ad angle and targeting signals",
  "top_content_insight": "1 sentence on what content performs best based on engagement data",
  "our_opportunity": "1-2 sentences on what they are missing that we could exploit"
}`;

    const analysis = await invokeLLM({
      prompt,
      model: 'sonnet',
      maxTokens: 700,
      skipCache: true,
      response_json_schema: { type: 'object' },
    });

    return res.json({
      ...(analysis || {}),
      images_analyzed: imagesAnalyzed,
      posts_analyzed: posts.length,
      ads_analyzed: ads.length,
    });
  } catch (err: any) {
    console.error('[analyzeSocialPosts]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
