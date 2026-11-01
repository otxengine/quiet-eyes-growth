/**
 * GoogleBusinessClient — posts review replies via Google Business Profile API.
 *
 * Requires google_access_token on BusinessProfile (OAuth, scope:
 * https://www.googleapis.com/auth/business.manage).
 *
 * If no token is configured, the reply is saved as suggested_response only
 * and a ProactiveAlert is created for manual publishing.
 */

import { prisma } from '../../db';
import { createLogger } from '../../infra/logger';
import { getValidGoogleToken } from '../../lib/googleTokenRefresh';
import { tryDecryptToken } from '../../lib/crypto';

const logger = createLogger('GoogleBusinessClient');

export interface ReviewReplyPayload {
  reviewId: string;      // Prisma Review.id
  replyText: string;     // Hebrew response text
  googleReviewId?: string; // Google review ID for API call
}

export interface ReviewReplyResult {
  published: boolean;
  method: 'api' | 'suggested_only';
  gmbRequired?: boolean;
  error?: string;
}

/** Resolves the auto-refreshing token + full location path for a business's own connected GBP account. */
async function resolveOwnGmbConnection(businessProfileId: string) {
  const [profile, gmbAccount] = await Promise.all([
    prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
      select: { google_access_token: true },
    }),
    prisma.socialAccount.findFirst({
      where: { linked_business: businessProfileId, platform: 'google_business', is_connected: true },
    }),
  ]);
  const freshToken = await getValidGoogleToken(businessProfileId).catch(() => null);
  const gmbToken = freshToken || (gmbAccount?.access_token ? tryDecryptToken(gmbAccount.access_token) : undefined)
    || (profile?.google_access_token ? tryDecryptToken(profile.google_access_token) : undefined);
  const locationPath = gmbAccount?.page_id;
  return { gmbToken, locationPath, connected: !!(gmbToken && locationPath && locationPath.includes('/')) };
}

export async function postReviewReply(
  businessProfileId: string,
  payload: ReviewReplyPayload,
): Promise<ReviewReplyResult> {
  const { gmbToken, connected } = await resolveOwnGmbConnection(businessProfileId);

  // Update suggested_response regardless
  await prisma.review.update({
    where: { id: payload.reviewId },
    data: {
      suggested_response: payload.replyText,
      response_status: 'suggested',
    },
  });

  if (!connected) {
    logger.info('Review reply saved as suggestion (Google Business not connected)', { businessProfileId, reviewId: payload.reviewId });
    return { published: false, method: 'suggested_only', gmbRequired: true };
  }
  // Only GBP API review names ("accounts/123/locations/456/reviews/AbcXyz") are replyable —
  // scraped IDs get linked to one by collectReviews once the GBP review is fetched.
  if (!payload.googleReviewId?.includes('/reviews/')) {
    return { published: false, method: 'suggested_only', error: 'Review is not linked to Google Business yet — sync reviews and retry' };
  }

  try {
    const replyRes = await fetch(
      `https://mybusiness.googleapis.com/v4/${payload.googleReviewId}/reply`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${gmbToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comment: payload.replyText }),
      },
    );

    if (replyRes.ok) {
      await prisma.review.update({
        where: { id: payload.reviewId },
        data: { response_status: 'published' },
      });
      logger.info('Review reply published via Google API', { businessProfileId, reviewId: payload.reviewId });
      return { published: true, method: 'api' };
    }

    const errData = await replyRes.json().catch(() => ({})) as any;
    const error = errData?.error?.message || `Google API error ${replyRes.status}`;
    logger.warn('Google API reply failed', { status: replyRes.status, error });
    return { published: false, method: 'api', error };
  } catch (err: any) {
    logger.warn('Google Business API error', { error: err.message });
    return { published: false, method: 'api', error: err.message };
  }
}
