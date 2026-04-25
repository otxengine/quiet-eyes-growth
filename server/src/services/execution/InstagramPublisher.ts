/**
 * InstagramPublisher — publishes posts to Instagram Business via Graph API.
 *
 * Two-step process (Meta requirement):
 *   1. Create media container (POST /{ig-user-id}/media)
 *   2. Publish container   (POST /{ig-user-id}/media_publish)
 *
 * Requires instagram_access_token + instagram_page_id on BusinessProfile.
 * Falls back to Task update with status='ready_to_publish' if no token.
 *
 * Also handles Facebook Page publishing via facebook_page_token + facebook_page_id.
 */

import { prisma } from '../../db';
import { createLogger } from '../../infra/logger';

const logger = createLogger('InstagramPublisher');

export interface PublishPayload {
  taskId?: string;          // Task.id to mark as done after publish
  caption: string;          // Post caption (Hebrew)
  imageUrl?: string;        // Public image URL for media posts
  platform?: 'instagram' | 'facebook' | 'both';
}

export interface PublishResult {
  published: boolean;
  platforms: string[];
  method: 'api' | 'queued';
  postIds?: Record<string, string>;
  error?: string;
}

export async function publishPost(
  businessProfileId: string,
  payload: PublishPayload,
): Promise<PublishResult> {
  const profile = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: {
      instagram_access_token: true,
      instagram_page_id: true,
      facebook_page_token: true,
      facebook_page_id: true,
    },
  });

  const platform = payload.platform ?? 'instagram';
  const publishedPlatforms: string[] = [];
  const postIds: Record<string, string> = {};

  // Instagram publish
  if ((platform === 'instagram' || platform === 'both') &&
      profile?.instagram_access_token && profile?.instagram_page_id) {
    try {
      const igUserId = profile.instagram_page_id;
      const token = profile.instagram_access_token;

      // Step 1: Create container
      const containerBody: Record<string, string> = { caption: payload.caption, access_token: token };
      if (payload.imageUrl) {
        containerBody.image_url = payload.imageUrl;
        containerBody.media_type = 'IMAGE';
      } else {
        // Text-only not supported directly; skip if no image
        logger.warn('Instagram post skipped — no image URL provided');
      }

      if (payload.imageUrl) {
        const containerRes = await fetch(
          `https://graph.facebook.com/v19.0/${igUserId}/media`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(containerBody) },
        );

        if (containerRes.ok) {
          const { id: containerId } = await containerRes.json() as any;

          // Step 2: Publish container
          const publishRes = await fetch(
            `https://graph.facebook.com/v19.0/${igUserId}/media_publish`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ creation_id: containerId, access_token: token }),
            },
          );

          if (publishRes.ok) {
            const { id: postId } = await publishRes.json() as any;
            postIds['instagram'] = postId;
            publishedPlatforms.push('instagram');
            logger.info('Instagram post published', { businessProfileId, postId });
          }
        }
      }
    } catch (err: any) {
      logger.warn('Instagram publish error', { error: err.message });
    }
  }

  // Facebook Page publish
  if ((platform === 'facebook' || platform === 'both') &&
      profile?.facebook_page_token && profile?.facebook_page_id) {
    try {
      const fbBody: Record<string, string> = {
        message: payload.caption,
        access_token: profile.facebook_page_token,
      };
      if (payload.imageUrl) fbBody.url = payload.imageUrl;

      const endpoint = payload.imageUrl
        ? `https://graph.facebook.com/v19.0/${profile.facebook_page_id}/photos`
        : `https://graph.facebook.com/v19.0/${profile.facebook_page_id}/feed`;

      const fbRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fbBody),
      });

      if (fbRes.ok) {
        const { id: postId } = await fbRes.json() as any;
        postIds['facebook'] = postId;
        publishedPlatforms.push('facebook');
        logger.info('Facebook post published', { businessProfileId, postId });
      }
    } catch (err: any) {
      logger.warn('Facebook publish error', { error: err.message });
    }
  }

  // Update Task if provided
  if (payload.taskId) {
    await prisma.task.update({
      where: { id: payload.taskId },
      data: {
        status: publishedPlatforms.length > 0 ? 'done' : 'ready_to_publish',
        completed_at: publishedPlatforms.length > 0 ? new Date().toISOString() : null,
        notes: publishedPlatforms.length > 0
          ? `פורסם ב: ${publishedPlatforms.join(', ')} · ${new Date().toLocaleDateString('he-IL')}`
          : 'מוכן לפרסום — חסרים פרטי חשבון רשת חברתית',
      },
    }).catch(() => null);
  }

  if (publishedPlatforms.length > 0) {
    return { published: true, platforms: publishedPlatforms, method: 'api', postIds };
  }

  return { published: false, platforms: [], method: 'queued', error: 'No social API credentials configured' };
}
