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

const logger = createLogger('GoogleBusinessClient');

export interface ReviewReplyPayload {
  reviewId: string;      // Prisma Review.id
  replyText: string;     // Hebrew response text
  googleReviewId?: string; // Google review ID for API call
}

export interface ReviewReplyResult {
  published: boolean;
  method: 'api' | 'suggested_only';
  error?: string;
}

export async function postReviewReply(
  businessProfileId: string,
  payload: ReviewReplyPayload,
): Promise<ReviewReplyResult> {
  const [profile, gmbAccount] = await Promise.all([
    prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
      select: { google_access_token: true, name: true },
    }),
    prisma.socialAccount.findFirst({
      where: { linked_business: businessProfileId, platform: 'google_business', is_connected: true },
    }),
  ]);

  const gmbToken = gmbAccount?.access_token || profile?.google_access_token;
  // gmbAccount.page_id is the full location path "accounts/123/locations/456"
  const locationPath = gmbAccount?.page_id;

  // Update suggested_response regardless
  await prisma.review.update({
    where: { id: payload.reviewId },
    data: {
      suggested_response: payload.replyText,
      response_status: 'suggested',
    },
  });

  // Try Google Business Profile API if we have token + location path + real review ID
  // googleReviewId should be the full review name "accounts/123/locations/456/reviews/AbcXyz"
  if (gmbToken && locationPath && locationPath.includes('/') && payload.googleReviewId) {
    try {
      // Extract just the review ID segment if full path provided
      const reviewSegment = payload.googleReviewId.includes('/')
        ? payload.googleReviewId.split('/').pop()
        : payload.googleReviewId;

      const replyRes = await fetch(
        `https://mybusiness.googleapis.com/v4/${locationPath}/reviews/${reviewSegment}/reply`,
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
      logger.warn('Google API reply failed', { status: replyRes.status, error: errData?.error?.message });
    } catch (err: any) {
      logger.warn('Google Business API error', { error: err.message });
    }
  }

  // Not published via API — stays as suggested_response for manual approval
  logger.info('Review reply saved as suggestion (no Google API token)', { businessProfileId, reviewId: payload.reviewId });
  return { published: false, method: 'suggested_only' };
}
