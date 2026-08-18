/**
 * Regression test — the growth-plan competitor limit must count the same
 * "active" rows the Competitors UI shows (is_dismissed excluded), not just
 * not_relevant. Rejected/dismissed onboarding candidates must not eat quota.
 */
jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn() },
    competitor: { count: jest.fn(), create: jest.fn() },
  },
}));

jest.mock('../middleware/auth', () => ({
  getUserId: jest.fn().mockReturnValue('user_1'),
  isAdminKeyRequest: jest.fn().mockReturnValue(false),
}));

jest.mock('../lib/competitorRadiusCleanup', () => ({
  cleanupCompetitorsByRadius: jest.fn(),
}));

import router from '../routes/entities';
import { prisma } from '../db';

function getPostHandler() {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === '/:entity' && l.route.methods.post
  );
  return layer.route.stack[0].handle;
}

function makeRes() {
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  return { json, status } as any;
}

describe('POST /entities/Competitor — plan limit counts active rows only', () => {
  const ROWS = [
    { linked_business: 'biz_1', not_relevant: false, is_dismissed: false },
    { linked_business: 'biz_1', not_relevant: false, is_dismissed: false },
    ...Array.from({ length: 8 }, () => ({ linked_business: 'biz_1', not_relevant: false, is_dismissed: true })),
  ]; // 2 visible + 8 dismissed-during-onboarding = 10 total rows

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({ subscription_plan: 'growth' });
    (prisma.competitor.count as jest.Mock).mockImplementation(({ where }: any) =>
      ROWS.filter(r => {
        if (r.linked_business !== where.linked_business) return false;
        if (where.not_relevant?.not === true && r.not_relevant === true) return false;
        if (where.is_dismissed?.not === true && r.is_dismissed === true) return false;
        return true;
      }).length
    );
    (prisma.competitor.create as jest.Mock).mockResolvedValue({ id: 'new_comp' });
  });

  it('allows a manual add when only 2 of 10 rows are actually active', async () => {
    const req = { params: { entity: 'Competitor' }, body: { linked_business: 'biz_1', name: 'New Competitor' } } as any;
    const res = makeRes();

    await getPostHandler()(req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(prisma.competitor.create).toHaveBeenCalled();
  });

  it('still blocks once active (non-dismissed, non-irrelevant) rows hit the cap', async () => {
    (prisma.competitor.count as jest.Mock).mockImplementation(({ where }: any) =>
      where.is_dismissed?.not === true ? 10 : 10
    );
    const req = { params: { entity: 'Competitor' }, body: { linked_business: 'biz_1', name: 'New Competitor' } } as any;
    const res = makeRes();

    await getPostHandler()(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.competitor.create).not.toHaveBeenCalled();
  });
});
