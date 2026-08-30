/**
 * approvalGate.test.ts — KAN-126
 * AC-1: review_reply is NEVER auto-dispatched regardless of autonomy_level
 * AC-4: executeOrQueue never calls dispatch (postReviewReply) for review_reply
 */

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn() },
    autoAction:      { create: jest.fn().mockResolvedValue({ id: 'aa_test' }) },
  },
}));

jest.mock('../infra/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../services/execution/WhatsAppExecutor', () => ({ sendWhatsApp: jest.fn() }));
jest.mock('../services/execution/GoogleBusinessClient', () => ({
  postReviewReply: jest.fn().mockResolvedValue({ published: false, method: 'suggested_only' }),
}));
jest.mock('../services/execution/InstagramPublisher', () => ({ publishPost: jest.fn() }));
jest.mock('../services/execution/EmailExecutor',      () => ({ sendEmail: jest.fn() }));

import { executeOrQueue } from '../services/execution/executeOrQueue';
import { prisma }          from '../db';
import { postReviewReply } from '../services/execution/GoogleBusinessClient';

const BASE = {
  businessProfileId: 'biz_001',
  agentName:         'autoRespondToReviews',
  actionType:        'review_reply' as const,
  description:       'תגובה לביקורת של יוסי',
  payload:           { reviewId: 'rev_001', replyText: 'תגובה', googleReviewId: 'g_001' },
};

function setAutonomy(level: string) {
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({ autonomy_level: level });
}

describe('executeOrQueue — review_reply approval gate (KAN-126)', () => {
  test('full_auto: returns executed:false', async () => {
    setAutonomy('full_auto');
    const r = await executeOrQueue(BASE);
    expect(r.executed).toBe(false);
  });

  test('semi_auto: returns executed:false', async () => {
    setAutonomy('semi_auto');
    const r = await executeOrQueue(BASE);
    expect(r.executed).toBe(false);
  });

  test('manual: returns executed:false', async () => {
    setAutonomy('manual');
    const r = await executeOrQueue(BASE);
    expect(r.executed).toBe(false);
  });

  test('full_auto: postReviewReply (dispatch) is never called', async () => {
    setAutonomy('full_auto');
    await executeOrQueue(BASE);
    expect(postReviewReply).not.toHaveBeenCalled();
  });

  test('creates an AutoAction record with pending_approval status', async () => {
    setAutonomy('full_auto');
    const r = await executeOrQueue(BASE);
    expect(prisma.autoAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending_approval' }),
      }),
    );
    expect(r.autoActionId).toBe('aa_test');
  });
});
