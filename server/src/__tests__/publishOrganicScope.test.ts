/**
 * POST /api/social/publish-organic marks the OrganicPost as published. The router checks
 * businessProfileId, so the update must stay inside that business: postId alone could
 * name another tenant's post.
 */
jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn(() => Promise.resolve({})) },
    organicPost: { update: jest.fn(), updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
  },
}));

import { Request, Response } from 'express';
import { prisma } from '../db';

const publishHandler = () => {
  const router = require('../routes/social').default;
  const layer = router.stack.find((l: any) => l.route?.path === '/publish-organic' && l.route?.methods?.post);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};

// A platform with no publisher branch goes straight to the status update (no Meta calls).
const publish = (body: object) => {
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() } as unknown as Response;
  return publishHandler()({ body: { businessProfileId: 'biz-a', content: 'hi', platform: 'none', ...body } } as Request, res);
};

beforeEach(() => jest.clearAllMocks());

it('updates the post only inside the verified business', async () => {
  await publish({ postId: 'post-1' });
  expect((prisma as any).organicPost.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'post-1', linked_business: 'biz-a' },
  }));
  expect((prisma as any).organicPost.update).not.toHaveBeenCalled();
});

it('ignores a non-string postId instead of passing it to Prisma', async () => {
  await publish({ postId: { not: 'x' } });
  expect((prisma as any).organicPost.updateMany).not.toHaveBeenCalled();
});
