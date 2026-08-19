import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';
import { getSectorProfile } from '../lib/businessProfile';
import { resolveTopicSet } from '../lib/reviewTopicPacks';
import { downloadFromS3 } from '../lib/s3';
import FormData from 'form-data';
import fetch from 'node-fetch';
import { randomUUID } from 'crypto';

const router = Router();

/**
 * GET /api/social/media/:assetId
 *
 * Serves a MediaAsset as a public https:// URL — the bucket is private, so
 * S3-backed assets are streamed through an authenticated download rather
 * than redirected; base64 fallback assets are served directly.
 */
router.get('/media/:assetId', async (req: Request, res: Response) => {
  const assetId = req.params.assetId as string;
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset) return res.status(404).json({ error: 'Media not found' });

  if (asset.url) {
    const obj = await downloadFromS3(asset.url);
    if (!obj) return res.status(404).json({ error: 'Media not found' });
    res.set('Content-Type', obj.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(obj.body);
  }
  if (!asset.image_base64) return res.status(404).json({ error: 'Media not found' });

  const mimeType = asset.mime_type || 'image/jpeg';
  const buffer   = Buffer.from(asset.image_base64, 'base64');
  res.set('Content-Type', mimeType);
  res.set('Cache-Control', 'public, max-age=86400');
  return res.send(buffer);
});

/**
 * POST /api/social/publish-organic
 *
 * Actually publishes an organic post to Facebook and/or Instagram
 * via the Graph API, then updates the OrganicPost record in DB.
 *
 * Body: { businessProfileId, postId, content, imageUrl?, mediaAssetId?, platform }
 *   platform: 'facebook' | 'instagram' | 'tiktok'
 */
router.post('/publish-organic', async (req: Request, res: Response) => {
  const { businessProfileId, postId, content, imageUrl, mediaAssetId, platform } = req.body;

  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (!content)           return res.status(400).json({ error: 'Missing content' });
  if (!platform)          return res.status(400).json({ error: 'Missing platform' });

  const profile = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: {
      facebook_page_token: true,
      facebook_page_id:    true,
      instagram_access_token: true,
      instagram_page_id:      true,
    },
  });

  if (!profile) return res.status(404).json({ error: 'Business not found' });

  const results: Record<string, any> = {};

  try {
    // ── Facebook ──────────────────────────────────────────────────────────────
    if (platform === 'facebook') {
      if (!profile.facebook_page_token || !profile.facebook_page_id) {
        return res.status(400).json({ error: 'Facebook not connected — go to Integrations and connect your Page' });
      }

      const token  = profile.facebook_page_token;
      const pageId = profile.facebook_page_id;

      let fbResult: any;

      if (imageUrl && imageUrl.startsWith('data:')) {
        // Base64 image → multipart upload to /photos
        const mimeMatch = imageUrl.match(/^data:([^;]+);base64,/);
        const mimeType  = mimeMatch?.[1] || 'image/jpeg';
        const base64    = imageUrl.replace(/^data:[^;]+;base64,/, '');
        const buffer    = Buffer.from(base64, 'base64');

        const form = new FormData();
        form.append('source',       buffer,  { filename: 'photo.jpg', contentType: mimeType });
        form.append('message',      content);
        form.append('access_token', token);

        const fbRes = await fetch(
          `https://graph.facebook.com/v19.0/${pageId}/photos`,
          { method: 'POST', body: form },
        );
        fbResult = await fbRes.json() as any;
        if (!fbRes.ok || fbResult.error) {
          throw new Error(fbResult?.error?.message || `Facebook API error ${fbRes.status}`);
        }
        results.facebook = { postId: fbResult.id, method: 'photo' };

      } else if (imageUrl && imageUrl.startsWith('https://')) {
        // Public URL image → /photos with url param
        const fbRes = await fetch(
          `https://graph.facebook.com/v19.0/${pageId}/photos`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: imageUrl, message: content, access_token: token }),
          },
        );
        fbResult = await fbRes.json() as any;
        if (!fbRes.ok || fbResult.error) {
          throw new Error(fbResult?.error?.message || `Facebook API error ${fbRes.status}`);
        }
        results.facebook = { postId: fbResult.id, method: 'photo_url' };

      } else {
        // Text-only post → /feed
        const fbRes = await fetch(
          `https://graph.facebook.com/v19.0/${pageId}/feed`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: content, access_token: token }),
          },
        );
        fbResult = await fbRes.json() as any;
        if (!fbRes.ok || fbResult.error) {
          throw new Error(fbResult?.error?.message || `Facebook API error ${fbRes.status}`);
        }
        results.facebook = { postId: fbResult.id, method: 'feed' };
      }
    }

    // ── Instagram ─────────────────────────────────────────────────────────────
    if (platform === 'instagram') {
      if (!profile.instagram_access_token || !profile.instagram_page_id) {
        return res.status(400).json({ error: 'Instagram not connected — go to Integrations and connect your account' });
      }

      // Resolve the public image URL for Instagram.
      // If the image was uploaded locally (base64 data URL), serve it via our
      // /api/social/media/:id endpoint which Instagram can fetch over https.
      let igImageUrl = imageUrl;
      if ((!igImageUrl || igImageUrl.startsWith('data:')) && mediaAssetId) {
        const serverBase = process.env.SERVER_BASE_URL || 'http://localhost:3007';
        igImageUrl = `${serverBase}/api/social/media/${mediaAssetId}`;
      }

      if (!igImageUrl || igImageUrl.startsWith('data:')) {
        return res.status(400).json({
          error: 'Instagram requires a public image URL — save the post as draft first, or connect with ngrok running',
        });
      }

      const token   = profile.instagram_access_token;
      const igId    = profile.instagram_page_id;

      // Step 1: create container
      const containerRes = await fetch(
        `https://graph.facebook.com/v19.0/${igId}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: igImageUrl, caption: content, access_token: token }),
        },
      );
      const containerData = await containerRes.json() as any;
      if (!containerRes.ok || containerData.error) {
        throw new Error(containerData?.error?.message || `Instagram container error ${containerRes.status}`);
      }

      // Step 2: publish container
      const publishRes = await fetch(
        `https://graph.facebook.com/v19.0/${igId}/media_publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: containerData.id, access_token: token }),
        },
      );
      const publishData = await publishRes.json() as any;
      if (!publishRes.ok || publishData.error) {
        throw new Error(publishData?.error?.message || `Instagram publish error ${publishRes.status}`);
      }

      results.instagram = { postId: publishData.id };
    }

    // ── TikTok — not handled here (separate publisher) ────────────────────────
    if (platform === 'tiktok') {
      return res.status(400).json({ error: 'TikTok publishing is not yet supported from this flow' });
    }

    // ── Update OrganicPost in DB ──────────────────────────────────────────────
    if (postId) {
      await prisma.organicPost.update({
        where: { id: postId },
        data:  { status: 'published', published_at: new Date() },
      }).catch(() => null);
    }

    return res.json({ ok: true, platform, results });

  } catch (err: any) {
    console.error('[social/publish-organic]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

function hasOwnSocialUrl(profile: any): boolean {
  return !!(profile?.instagram_url || profile?.facebook_url || profile?.tiktok_url);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/social/snapshot/profile?businessProfileId=
// Profile-level data (avatar, cover, bio, follower/contact info, highlights)
// per connected platform, scraped via collectOwnSocialProfile.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/snapshot/profile', async (req: Request, res: Response) => {
  try {
    const { businessProfileId } = req.query as Record<string, string>;
    if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

    const profile = await prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
      select: { instagram_url: true, facebook_url: true, tiktok_url: true },
    });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    const profiles = await prisma.businessSocialProfile.findMany({
      where: { linked_business: businessProfileId },
    });

    const emptyState = !hasOwnSocialUrl(profile) ? 'no_url' : profiles.length === 0 ? 'no_data' : 'ok';
    return res.json({ profiles, emptyState });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/social/snapshot/feed?businessProfileId=&platform=
// Own-business twin of GET /api/competitors/social/feed — real posts scraped
// from the business's own pages via collectOwnSocialPosts.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/snapshot/feed', async (req: Request, res: Response) => {
  try {
    const { businessProfileId, platform } = req.query as Record<string, string>;
    if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

    const profile = await prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
      select: { instagram_url: true, facebook_url: true, tiktok_url: true },
    });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    const posts = await prisma.businessPost.findMany({
      where: { linked_business: businessProfileId, ...(platform ? { platform } : {}) },
      orderBy: { posted_at: 'desc' },
      take: 50,
    });

    const emptyState = !hasOwnSocialUrl(profile) ? 'no_url' : posts.length === 0 ? 'no_data' : 'ok';
    return res.json({ posts, emptyState });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/social/snapshot/ads/current?businessProfileId=
// Own-business twin of GET /api/competitors/social/ads/current. There's no
// denormalized summary row (like Competitor.active_ad_count) for the business
// itself, so this computes the current-state snapshot on the fly from
// business_ad_history — simpler than the competitor path, no extra columns needed.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/snapshot/ads/current', async (req: Request, res: Response) => {
  try {
    const { businessProfileId } = req.query as Record<string, string>;
    if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

    const profile = await prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
      select: { instagram_url: true, facebook_url: true, tiktok_url: true },
    });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    const activeAds = await prisma.businessAdHistory.findMany({
      where: { linked_business: businessProfileId, is_active: true },
      select: { platform: true, last_seen_at: true },
    });
    const platforms = [...new Set(activeAds.map(a => a.platform))];
    const lastSeenAt = activeAds.reduce<Date | null>((max, a) => (!max || a.last_seen_at > max) ? a.last_seen_at : max, null);

    const emptyState = !hasOwnSocialUrl(profile) ? 'no_url' : activeAds.length === 0 ? 'no_data' : 'ok';
    return res.json({
      active_ad_count: activeAds.length,
      active_ad_platforms: platforms,
      last_seen_at: lastSeenAt,
      emptyState,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/social/snapshot/ads/history?businessProfileId=&sort=last_seen|first_seen&platform=
// Own-business twin of GET /api/competitors/social/ads/history.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/snapshot/ads/history', async (req: Request, res: Response) => {
  try {
    const { businessProfileId, sort = 'last_seen', platform } = req.query as Record<string, string>;
    if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

    const profile = await prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
      select: { instagram_url: true, facebook_url: true, tiktok_url: true },
    });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    const ads = await prisma.businessAdHistory.findMany({
      where: { linked_business: businessProfileId, ...(platform ? { platform } : {}) },
      orderBy: sort === 'first_seen' ? { first_seen_at: 'asc' } : { last_seen_at: 'desc' },
    });

    const emptyState = !hasOwnSocialUrl(profile) ? 'no_url' : ads.length === 0 ? 'no_data' : 'ok';
    return res.json({ ads, emptyState });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

const GRAPH = 'https://graph.facebook.com/v19.0';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/social/comments?businessProfileId=xxx&platform=facebook|instagram|all
//
// Fetches recent comments from FB/IG Graph API, upserts into social_comments,
// and returns stored comments.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/comments', async (req: Request, res: Response) => {
  const { businessProfileId, platform = 'all' } = req.query as Record<string, string>;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const profile = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: {
      name: true,
      facebook_page_token: true,
      facebook_page_id:    true,
      instagram_access_token: true,
      instagram_page_id:      true,
    },
  });
  if (!profile) return res.status(404).json({ error: 'Business not found' });

  const errors: string[] = [];

  // Track all platform_comment_ids seen in this sync per platform
  // After upserts, any DB row NOT in this set = deleted on platform → remove from DB
  const seenIds: { facebook: Set<string>; instagram: Set<string> } = {
    facebook:  new Set(),
    instagram: new Set(),
  };

  // ── Fetch Facebook comments ──────────────────────────────────────────────
  if ((platform === 'all' || platform === 'facebook') && profile.facebook_page_token && profile.facebook_page_id) {
    try {
      const token  = profile.facebook_page_token;
      const pageId = profile.facebook_page_id;

      const postsRes = await fetch(
        `${GRAPH}/${pageId}/posts?fields=id,message,created_time&limit=10&access_token=${token}`,
      );
      const postsData: any = await postsRes.json();
      const posts: any[] = postsData?.data || [];

      for (const post of posts) {
        const commentsRes = await fetch(
          `${GRAPH}/${post.id}/comments?fields=id,message,from,created_time&limit=20&access_token=${token}`,
        );
        const commentsData: any = await commentsRes.json();
        const comments: any[] = commentsData?.data || [];

        for (const c of comments) {
          seenIds.facebook.add(c.id);
          await prisma.$executeRawUnsafe(
            `INSERT INTO social_comments
               (id, linked_business, platform, platform_comment_id, platform_post_id,
                post_message, author_name, author_id, comment_text, created_time, fetched_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
             ON CONFLICT (platform, platform_comment_id) DO UPDATE
               SET author_name = EXCLUDED.author_name, fetched_at = now()`,
            randomUUID(),
            businessProfileId,
            'facebook',
            c.id,
            post.id,
            (post.message || '').substring(0, 120),
            c.from?.name || null,
            c.from?.id   || null,
            c.message    || '',
            c.created_time ? new Date(c.created_time) : null,
          );
        }
      }

      // Remove DB rows for Facebook comments no longer on the platform
      if (seenIds.facebook.size > 0) {
        const placeholders = Array.from(seenIds.facebook).map((_, i) => `$${i + 3}`).join(',');
        await prisma.$executeRawUnsafe(
          `DELETE FROM social_comments
           WHERE linked_business = $1 AND platform = 'facebook'
             AND platform_comment_id NOT IN (${placeholders})`,
          businessProfileId,
          'facebook',
          ...Array.from(seenIds.facebook),
        );
      }
    } catch (e: any) {
      errors.push(`facebook: ${e.message}`);
    }
  }

  // ── Fetch Instagram comments ─────────────────────────────────────────────
  if ((platform === 'all' || platform === 'instagram') && profile.instagram_access_token && profile.instagram_page_id) {
    try {
      const token = profile.instagram_access_token;
      const igId  = profile.instagram_page_id;

      const mediaRes = await fetch(
        `${GRAPH}/${igId}/media?fields=id,caption,timestamp&limit=10&access_token=${token}`,
      );
      const mediaData: any = await mediaRes.json();
      const mediaList: any[] = mediaData?.data || [];

      for (const media of mediaList) {
        const commentsRes = await fetch(
          `${GRAPH}/${media.id}/comments?fields=id,text,username,from,timestamp&limit=20&access_token=${token}`,
        );
        const commentsData: any = await commentsRes.json();
        const comments: any[] = commentsData?.data || [];

        for (const c of comments) {
          seenIds.instagram.add(c.id);
          await prisma.$executeRawUnsafe(
            `INSERT INTO social_comments
               (id, linked_business, platform, platform_comment_id, platform_post_id,
                post_message, author_name, comment_text, created_time, fetched_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
             ON CONFLICT (platform, platform_comment_id) DO UPDATE
               SET author_name = EXCLUDED.author_name, fetched_at = now()`,
            randomUUID(),
            businessProfileId,
            'instagram',
            c.id,
            media.id,
            (media.caption || '').substring(0, 120),
            c.username || c.from?.name || null,
            c.text     || '',
            c.timestamp ? new Date(c.timestamp) : null,
          );
        }
      }

      // Remove DB rows for Instagram comments no longer on the platform
      if (seenIds.instagram.size > 0) {
        const placeholders = Array.from(seenIds.instagram).map((_, i) => `$${i + 3}`).join(',');
        await prisma.$executeRawUnsafe(
          `DELETE FROM social_comments
           WHERE linked_business = $1 AND platform = 'instagram'
             AND platform_comment_id NOT IN (${placeholders})`,
          businessProfileId,
          'instagram',
          ...Array.from(seenIds.instagram),
        );
      } else if (mediaList.length > 0) {
        // We fetched media successfully but got 0 comments — clean up all Instagram comments from DB
        await prisma.$executeRawUnsafe(
          `DELETE FROM social_comments WHERE linked_business = $1 AND platform = 'instagram'`,
          businessProfileId,
        );
      }
    } catch (e: any) {
      errors.push(`instagram: ${e.message}`);
    }
  }

  // ── Sentiment analysis for comments that don't have one yet ─────────────
  try {
    const unanalyzed = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, comment_text FROM social_comments
       WHERE linked_business = $1 AND sentiment IS NULL AND comment_text != ''
       LIMIT 30`,
      businessProfileId,
    );

    if (unanalyzed.length > 0) {
      const CHUNK = 15;
      for (let i = 0; i < unanalyzed.length; i += CHUNK) {
        const batch = unanalyzed.slice(i, i + CHUNK);
        try {
          const result = await invokeLLM({
            model: 'haiku',
            maxTokens: 400,
            prompt: `Classify the sentiment of each comment as positive, negative, or neutral.
Return ONLY valid JSON: { "sentiments": ["positive","negative","neutral",...] }
One entry per comment, in order.

${batch.map((c, idx) => `${idx + 1}. "${c.comment_text.substring(0, 120)}"`).join('\n')}`,
            response_json_schema: { type: 'object' },
          }) as any;

          const sentiments: string[] = result?.sentiments || [];
          for (let j = 0; j < batch.length; j++) {
            const s = sentiments[j];
            if (s === 'positive' || s === 'negative' || s === 'neutral') {
              await prisma.$executeRawUnsafe(
                `UPDATE social_comments SET sentiment = $1 WHERE id = $2`,
                s, batch[j].id,
              );
            }
          }
        } catch { /* sentiment analysis failed — non-blocking */ }
      }
    }
  } catch { /* non-blocking */ }

  // ── Return stored comments ───────────────────────────────────────────────
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM social_comments
     WHERE linked_business = $1
     ORDER BY COALESCE(created_time, fetched_at) DESC
     LIMIT 100`,
    businessProfileId,
  );

  return res.json({ ok: true, comments: rows, errors });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/social/comments/:id/suggest-reply
//
// Uses LLM to generate a suggested reply for a comment.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/comments/:id/suggest-reply', async (req: Request, res: Response) => {
  const commentId = req.params.id as string;
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const [comment] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM social_comments WHERE id = $1`, commentId,
  );
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  const profile = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: { name: true, category: true, city: true },
  });

  try {
    const suggestion = await invokeLLM({
      model: 'haiku',
      maxTokens: 250,
      prompt: `אתה עוזר לעסק ישראלי לכתוב תגובה מקצועית לתגובה ברשת חברתית.

עסק: "${profile?.name}" | תחום: ${profile?.category || ''} | עיר: ${profile?.city || ''}
פלטפורמה: ${comment.platform}
${comment.post_message ? `הפוסט: "${comment.post_message}"` : ''}
תגובת לקוח (מאת ${comment.author_name}): "${comment.comment_text}"

כתוב תגובה קצרה (1-3 משפטים), חמה ומקצועית בעברית.
- אם התגובה חיובית — תודה וחיזוק
- אם שלילית — הכרה בבעיה, הצעת פתרון
- אל תבטיח דברים שלא ניתן לקיים
כתוב את הטקסט בלבד, ללא מרכאות עוטפות.`,
    });

    const text = typeof suggestion === 'string' ? suggestion.trim() : (suggestion as any)?.content?.trim() || '';

    await prisma.$executeRawUnsafe(
      `UPDATE social_comments SET ai_suggested_reply = $1 WHERE id = $2`,
      text, commentId,
    );

    return res.json({ ok: true, suggestion: text });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/social/comments/:id/reply
//
// Posts a reply to the comment via Facebook/Instagram Graph API.
// Body: { businessProfileId, replyText }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/comments/:id/reply', async (req: Request, res: Response) => {
  const commentId = req.params.id as string;
  const { businessProfileId, replyText } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (!replyText?.trim())  return res.status(400).json({ error: 'Reply text is required' });

  const [comment] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM social_comments WHERE id = $1`, commentId,
  );
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  const profile = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: {
      facebook_page_token:    true,
      instagram_access_token: true,
    },
  });

  try {
    if (comment.platform === 'facebook') {
      const token = profile?.facebook_page_token;
      if (!token) return res.status(400).json({ error: 'Facebook not connected' });

      const fbRes = await fetch(`${GRAPH}/${comment.platform_comment_id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: replyText, access_token: token }),
      });
      const fbData: any = await fbRes.json();
      if (!fbRes.ok || fbData.error) {
        throw new Error(fbData?.error?.message || `Facebook reply error ${fbRes.status}`);
      }
    } else if (comment.platform === 'instagram') {
      const token = profile?.instagram_access_token;
      if (!token) return res.status(400).json({ error: 'Instagram not connected' });

      const igRes = await fetch(`${GRAPH}/${comment.platform_comment_id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: replyText, access_token: token }),
      });
      const igData: any = await igRes.json();
      if (!igRes.ok || igData.error) {
        throw new Error(igData?.error?.message || `Instagram reply error ${igRes.status}`);
      }
    }

    await prisma.$executeRawUnsafe(
      `UPDATE social_comments
       SET reply_sent = true, reply_text = $1, reply_sent_at = now()
       WHERE id = $2`,
      replyText, commentId,
    );

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[social/comments/reply]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/social/comments/:id/dismiss
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/comments/:id/dismiss', async (req: Request, res: Response) => {
  const commentId = req.params.id as string;
  await prisma.$executeRawUnsafe(
    `UPDATE social_comments SET is_dismissed = true WHERE id = $1`, commentId,
  );
  return res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/social/comments/:id
//
// Permanently deletes the comment from Facebook or Instagram via Graph API,
// then removes it from the local DB.
// Body: { businessProfileId }
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/comments/:id', async (req: Request, res: Response) => {
  const commentId = req.params.id as string;
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const [comment] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM social_comments WHERE id = $1`, commentId,
  );
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  const profile = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: {
      facebook_page_token:    true,
      instagram_access_token: true,
    },
  });

  try {
    const token = comment.platform === 'facebook'
      ? profile?.facebook_page_token
      : profile?.instagram_access_token;

    if (!token) {
      return res.status(400).json({ error: `${comment.platform} not connected` });
    }

    // Call Graph API to delete the comment
    const delRes = await fetch(
      `${GRAPH}/${comment.platform_comment_id}?access_token=${token}`,
      { method: 'DELETE' },
    );
    const delData: any = await delRes.json();

    if (!delRes.ok || delData.error) {
      throw new Error(delData?.error?.message || `Graph API error ${delRes.status}`);
    }

    // Remove from local DB
    await prisma.$executeRawUnsafe(
      `DELETE FROM social_comments WHERE id = $1`, commentId,
    );

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[social/comments/delete]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/social/reviews/:id/reply
// Body: { businessProfileId, replyText }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/reviews/:id/reply', async (req: Request, res: Response) => {
  const reviewId = req.params.id as string;
  const { businessProfileId, replyText } = req.body;
  if (!businessProfileId || !replyText) {
    return res.status(400).json({ error: 'Missing businessProfileId or replyText' });
  }
  try {
    const review = await prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) return res.status(404).json({ error: 'Review not found' });
    const { postReviewReply } = await import('../services/execution/GoogleBusinessClient');
    const result = await postReviewReply(businessProfileId, {
      reviewId,
      replyText,
      googleReviewId: (review as any).google_review_id || undefined,
    });
    if (result.gmbRequired) {
      return res.json({ ok: true, published: false, gmbRequired: true, draft: replyText });
    }
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[social/reviews/reply]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/social/reviews/topic-set?businessProfileId=xxx
 * KAN-122 — returns the resolved review aspect set for a business.
 * UI uses id→label_he from this response to render aspect pills.
 */
router.get('/reviews/topic-set', async (req: Request, res: Response) => {
  const { businessProfileId } = req.query as { businessProfileId?: string };
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const profile = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: { sector_profile: true },
  });
  if (!profile) return res.status(404).json({ error: 'Business not found' });

  const sp = getSectorProfile(profile);
  const topics = resolveTopicSet(
    sp?.sector_key ?? 'other',
    sp?.onboarding_review_extras ?? [],
  );
  return res.json({ topics });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/social/reviews/:id/suggest-reply
// KAN-125 — A2 structured reply draft from aspect checklist + star rating.
// Body: { businessProfileId }
// Returns: { draft: string } — no auto-send, no DB write.
// ─────────────────────────────────────────────────────────────────────────────

/** Pure prompt builder — exported for unit testing. */
export function buildA2Prompt(opts: {
  businessName: string;
  reviewerName: string;
  reviewText:   string;
  rating:       number;
  positives:    string[];   // aspect label_he values with positive sentiment
  negatives:    string[];   // aspect label_he values with negative sentiment
  allAspects:   string[];   // full resolved checklist (label_he)
  closingStyle: string;
}): string {
  const posLine = opts.positives.length
    ? `Positive aspects mentioned: ${opts.positives.join(', ')}`
    : 'No clearly positive aspects identified.';
  const negLine = opts.negatives.length
    ? `Negative aspects mentioned: ${opts.negatives.join(', ')}`
    : 'No clearly negative aspects identified.';

  return `You are writing a structured Google review reply in Hebrew for "${opts.businessName}".

Reviewer: ${opts.reviewerName}
Stars: ${opts.rating}/5
Review text: "${opts.reviewText}"

Full aspect checklist for this business type:
${opts.allAspects.map(a => `- ${a}`).join('\n')}

${posLine}
${negLine}

Write the reply following this EXACT skeleton — preserve this order, no exceptions:
1. POSITIVES: Acknowledge and thank the reviewer for each positive aspect (skip this block entirely if none).
2. NEGATIVES: Address each negative aspect in its own sentence — be specific to what the reviewer said, add NO invented facts, claim no knowledge of events not in the review.
3. CLOSE: One sentence — ${opts.closingStyle}.

Output ONLY the final Hebrew reply text. No intro, no quotes, no markdown.`;
}

const TONE_CLOSE: Record<string, string> = {
  casual:       'casual and warm — invite them back by name',
  warm:         'warm and personal — offer a direct conversation or follow-up',
  professional: 'professional — offer to discuss further or invite them to return',
  friendly:     'friendly — thank them and invite them back',
};

router.post('/reviews/:id/suggest-reply', async (req: Request, res: Response) => {
  const reviewId = req.params.id as string;
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) return res.status(404).json({ error: 'Review not found' });

  const profile = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: { name: true, tone_preference: true, sector_profile: true },
  });
  if (!profile) return res.status(404).json({ error: 'Business not found' });

  const sp      = getSectorProfile(profile);
  const aspects = resolveTopicSet(sp?.sector_key ?? 'other', sp?.onboarding_review_extras ?? []);
  const tone    = profile.tone_preference || sp?.content_tone || 'professional';

  // Parse topic_sentiment (from KAN-124 aspect extraction) to split into pos/neg lists
  let topicSentiment: Record<string, string> = {};
  try { topicSentiment = review.topic_sentiment ? JSON.parse(review.topic_sentiment) : {}; } catch { /* ignore */ }

  const labelById = Object.fromEntries(aspects.map(a => [a.id, a.label_he]));
  const positives = Object.entries(topicSentiment)
    .filter(([, s]) => s === 'positive')
    .map(([id]) => labelById[id] || id);
  const negatives = Object.entries(topicSentiment)
    .filter(([, s]) => s === 'negative' || s === 'mixed')
    .map(([id]) => labelById[id] || id);

  try {
    const raw = await invokeLLM({
      model: 'sonnet',
      maxTokens: 1000,
      prompt: buildA2Prompt({
        businessName: profile.name || '',
        reviewerName: review.reviewer_name || 'לקוח',
        reviewText:   review.text || '',
        rating:       review.rating ?? 3,
        positives,
        negatives,
        allAspects:   aspects.map(a => a.label_he),
        closingStyle: TONE_CLOSE[tone] ?? TONE_CLOSE.professional,
      }),
    });

    const draft = typeof raw === 'string' ? raw.trim() : (raw as any)?.content?.trim() || '';
    return res.json({ ok: true, draft });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
