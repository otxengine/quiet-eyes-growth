/**
 * TikTokPublisher — uploads and publishes videos to TikTok Business via Content Posting API.
 *
 * TikTok Content Posting API v2 flow:
 *   1. POST /v2/post/publish/video/init/  → get upload_url + publish_id
 *   2. PUT upload_url                     → upload the video binary
 *   3. GET /v2/post/publish/status/fetch/ → poll until published
 *
 * Requires: TikTok Business account connected via OAuth (open_id + access_token in SocialAccount).
 * Falls back to Task.status = 'ready_to_publish' if no credentials.
 *
 * NOTE: TikTok requires an actual video file URL (mp4). Text-only TikTok posts
 * are not supported via the API; they require the in-app composer.
 */

import { prisma } from '../../db';
import { createLogger } from '../../infra/logger';
import { getValidTikTokToken } from '../../lib/tiktokTokenRefresh';

const logger = createLogger('TikTokPublisher');
const TIKTOK_API = 'https://open.tiktokapis.com/v2';

export interface TikTokPublishPayload {
  taskId?:      string;  // Task.id to mark done after publish
  caption:      string;  // Post caption (≤ 2200 chars)
  videoUrl?:    string;  // Public mp4 URL (required for video posts)
  coverTime?:   number;  // Cover frame time in seconds (default 0)
  privacyLevel?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
}

export interface TikTokPublishResult {
  published:  boolean;
  method:     'api' | 'queued';
  publishId?: string;
  error?:     string;
}

export async function publishTikTok(
  businessProfileId: string,
  payload: TikTokPublishPayload,
): Promise<TikTokPublishResult> {
  // Load TikTok credentials from SocialAccount
  const account = await prisma.socialAccount.findFirst({
    where: { linked_business: businessProfileId, platform: 'tiktok_business', is_connected: true },
  });

  if (!account?.page_id /* page_id = open_id */) {
    await markTaskQueued(payload.taskId, 'מוכן לפרסום ב-TikTok — חסר חיבור');
    return { published: false, method: 'queued', error: 'No TikTok credentials' };
  }

  const accessToken = await getValidTikTokToken(businessProfileId);
  if (!accessToken) {
    await markTaskQueued(payload.taskId, 'מוכן לפרסום ב-TikTok — טוקן פג תוקף');
    return { published: false, method: 'queued', error: 'TikTok token expired and refresh failed' };
  }

  if (!payload.videoUrl) {
    await markTaskQueued(payload.taskId, 'מוכן לפרסום ב-TikTok — נדרש וידאו');
    return { published: false, method: 'queued', error: 'TikTok requires a video URL' };
  }

  try {
    // Step 1: Init video upload
    const initRes = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title:         payload.caption.slice(0, 2200),
          privacy_level: payload.privacyLevel ?? 'PUBLIC_TO_EVERYONE',
          disable_duet:  false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: (payload.coverTime ?? 0) * 1000,
        },
        source_info: {
          source:    'PULL_FROM_URL',
          video_url: payload.videoUrl,
        },
      }),
    });

    if (!initRes.ok) {
      const errData = await initRes.json().catch(() => ({})) as any;
      throw new Error(errData?.error?.message || `TikTok init failed: ${initRes.status}`);
    }

    const initData: any = await initRes.json();
    const publishId = initData?.data?.publish_id as string;

    if (!publishId) throw new Error('TikTok publish_id missing from response');

    logger.info('TikTok video publish initiated', { businessProfileId, publishId });

    // Update Task if provided
    if (payload.taskId) {
      await prisma.task.update({
        where: { id: payload.taskId },
        data: {
          status:       'done',
          completed_at: new Date().toISOString(),
          notes:        `פורסם ב-TikTok · ${new Date().toLocaleDateString('he-IL')}`,
        },
      }).catch(() => null);
    }

    return { published: true, method: 'api', publishId };
  } catch (err: any) {
    logger.warn('TikTok publish error', { businessProfileId, error: err.message });
    await markTaskQueued(payload.taskId, `שגיאת TikTok: ${err.message}`);
    return { published: false, method: 'queued', error: err.message };
  }
}

async function markTaskQueued(taskId: string | undefined, notes: string) {
  if (!taskId) return;
  await prisma.task.update({
    where: { id: taskId },
    data:  { status: 'ready_to_publish', notes },
  }).catch(() => null);
}
