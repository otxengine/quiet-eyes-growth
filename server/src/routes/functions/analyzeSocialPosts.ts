import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../../db';
import { isS3Url, downloadFromS3 } from '../../lib/s3';

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
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
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

    const posts = await (prisma as any).$queryRawUnsafe(
      `SELECT caption, media_url, posted_at, likes, comments_count
       FROM competitor_posts WHERE competitor_id = $1
       ORDER BY posted_at DESC NULLS LAST LIMIT 20`,
      competitorId,
    ) as { caption: string | null; media_url: string | null; posted_at: Date | null; likes: number | null; comments_count: number | null }[];

    const ads = await prisma.competitorAdHistory.findMany({
      where: { competitor_id: competitorId },
      select: { title: true, body: true, cta: true, platform: true, is_active: true },
      orderBy: { last_seen_at: 'desc' },
      take: 10,
    });

    // Download up to 3 images in parallel
    const mediaUrls = posts.map(p => p.media_url).filter(Boolean) as string[];
    const imageResults = await Promise.all(mediaUrls.slice(0, 3).map(toBase64Image));
    const images = imageResults.filter(Boolean) as { data: string; mediaType: string }[];

    const captionSummary = posts
      .filter(p => p.caption)
      .slice(0, 10)
      .map((p, i) => `Post ${i + 1} (❤️${p.likes ?? '?'} 💬${p.comments_count ?? '?'}): "${p.caption!.substring(0, 200)}"`)
      .join('\n');

    const adSummary = ads.length
      ? ads.map((a: { platform: string; is_active: boolean; title: string | null; body: string | null; cta: string | null }) => `[${a.platform}${a.is_active ? ' ACTIVE' : ''}] ${a.title || ''} | ${(a.body || '').substring(0, 150)} | CTA: ${a.cta || '—'}`).join('\n')
      : 'No ads found.';

    const contextText = `Competitor: "${competitor.name}" (${competitor.category || 'business'})
Metadata: channel=${competitor.strongest_channel || '?'}, engagement=${competitor.engagement_level || '?'}, frequency=${competitor.social_post_frequency || '?'}, followers=${competitor.social_followers_est || '?'}, themes=${competitor.content_themes || '?'}

Recent posts (${posts.length} total):
${captionSummary || 'No captions available.'}

Ads (${ads.length} total):
${adSummary}

Analyze this competitor's social media presence${images.length > 0 ? ' and the provided images' : ''}.
Return ONLY valid JSON:
{
  "visual_identity": "2-3 sentences on visual style, color palette, composition, subject matter${images.length === 0 ? ' (no images available — infer from captions/context)' : ''}",
  "content_pillars": ["topic 1", "topic 2", "topic 3"],
  "caption_patterns": "1-2 sentences on caption style: CTA usage, hashtags, tone, length",
  "ad_messaging": "1-2 sentences on ad angle (discount/lifestyle/urgency/quality) and targeting signals",
  "top_content_insight": "1 sentence on what content performs best based on engagement data",
  "our_opportunity": "1-2 sentences on what they are NOT doing well or missing that we could exploit"
}`;

    const userContent: any[] = [
      ...images.map(img => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType as any, data: img.data },
      })),
      { type: 'text', text: contextText },
    ];

    const msg = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 600,
      system:     'Return ONLY valid JSON. No markdown, no explanation.',
      messages:   [{ role: 'user', content: userContent }],
    });

    const raw = (msg.content[0] as any).text || '{}';
    let analysis: any = {};
    try {
      analysis = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      analysis = { visual_identity: raw.substring(0, 300) };
    }

    return res.json({ ...analysis, images_analyzed: images.length, posts_analyzed: posts.length, ads_analyzed: ads.length });
  } catch (err: any) {
    console.error('[analyzeSocialPosts]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
