/**
 * googleBusinessClient.test.ts — KAN-126
 * AC-2: publishes to Google + updates response_status when GMB connected
 * AC-3: returns gmbRequired:true when GMB not connected
 */

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn() },
    socialAccount:   { findFirst: jest.fn() },
    review:          { update: jest.fn().mockResolvedValue(undefined) },
  },
}));

jest.mock('../infra/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../lib/googleTokenRefresh', () => ({
  getValidGoogleToken: jest.fn(),
}));

import { postReviewReply } from '../services/execution/GoogleBusinessClient';
import { prisma }          from '../db';
import { getValidGoogleToken } from '../lib/googleTokenRefresh';

const PAYLOAD = {
  reviewId:      'rev_001',
  replyText:     'תודה על הביקורת',
  googleReviewId: 'accounts/123/locations/456/reviews/AbcXyz',
};

function mockGmbConnected(token = 'tok_123', locationPath = 'accounts/123/locations/456') {
  (getValidGoogleToken as jest.Mock).mockResolvedValue(token);
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({ google_access_token: token, name: 'טסט' });
  (prisma.socialAccount.findFirst as jest.Mock).mockResolvedValue({ access_token: token, page_id: locationPath });
}

function mockGmbDisconnected() {
  (getValidGoogleToken as jest.Mock).mockResolvedValue(null);
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({ google_access_token: null, name: 'טסט' });
  (prisma.socialAccount.findFirst as jest.Mock).mockResolvedValue(null);
}

describe('postReviewReply — KAN-126', () => {
  // AC-2: GMB connected + Google API success
  describe('AC-2: GMB connected', () => {
    beforeEach(() => {
      mockGmbConnected();
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    });

    test('returns published:true, method:api', async () => {
      const r = await postReviewReply('biz_001', PAYLOAD);
      expect(r.published).toBe(true);
      expect(r.method).toBe('api');
    });

    test('updates response_status to published', async () => {
      await postReviewReply('biz_001', PAYLOAD);
      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ response_status: 'published' }) }),
      );
    });

    test('stores reply text in suggested_response', async () => {
      await postReviewReply('biz_001', PAYLOAD);
      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ suggested_response: PAYLOAD.replyText }) }),
      );
    });

    test('does not set gmbRequired when GMB is connected', async () => {
      const r = await postReviewReply('biz_001', PAYLOAD);
      expect(r.gmbRequired).toBeFalsy();
    });
  });

  // AC-2: Google API call failure falls back gracefully
  describe('AC-2: GMB connected but Google API rejects', () => {
    beforeEach(() => {
      mockGmbConnected();
      mockFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { message: 'Forbidden' } }) });
    });

    test('returns published:false on API error', async () => {
      const r = await postReviewReply('biz_001', PAYLOAD);
      expect(r.published).toBe(false);
    });

    test('still saves suggested_response even when API fails', async () => {
      await postReviewReply('biz_001', PAYLOAD);
      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ suggested_response: PAYLOAD.replyText }) }),
      );
    });
  });

  // AC-3: GMB not connected
  describe('AC-3: GMB not connected', () => {
    beforeEach(() => mockGmbDisconnected());

    test('returns gmbRequired:true', async () => {
      const r = await postReviewReply('biz_001', PAYLOAD);
      expect(r.gmbRequired).toBe(true);
    });

    test('returns published:false', async () => {
      const r = await postReviewReply('biz_001', PAYLOAD);
      expect(r.published).toBe(false);
    });

    test('still saves suggested_response for copy/paste', async () => {
      await postReviewReply('biz_001', PAYLOAD);
      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ suggested_response: PAYLOAD.replyText }) }),
      );
    });

    test('does not call Google API', async () => {
      await postReviewReply('biz_001', PAYLOAD);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
