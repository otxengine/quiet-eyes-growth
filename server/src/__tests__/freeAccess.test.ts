// Account-less Free plan: the emailed-link token and the middleware that turns it into a limited login.
const queryRaw = jest.fn();
const executeRaw = jest.fn(async () => 1);
const bp = { findMany: jest.fn() };
const competitor = { count: jest.fn() };
const report = { count: jest.fn() };
jest.mock('../db', () => ({
  prisma: { businessProfile: bp, competitor, report, $queryRaw: (...a: any[]) => queryRaw(...a), $executeRaw: (...a: any[]) => (executeRaw as any)(...a) },
}));
jest.mock('express-rate-limit', () => () => (_q: any, _s: any, next: any) => next());
jest.mock('../lib/email', () => ({ sendEmail: jest.fn(async () => true) }));

process.env.REPORT_UNSUBSCRIBE_SECRET = 'test-secret';
process.env.FRONTEND_URL = 'https://app.example.com';
import { freeAccess, freeToken, readFreeToken, isFreeIdentity, sendFreeLink, freeCompetitorWriteOk, freeReportInfo } from '../lib/freeAccess';
import { getUserId } from '../middleware/auth';
import { reportViewUrl } from '../lib/reportDelivery';
import { sendEmail } from '../lib/email';

const run = async (r: Record<string, any>) => {
  const req: any = { method: 'GET', path: '/briefing/me', headers: {}, ...r };
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  const next = jest.fn();
  await freeAccess(req, res, next);
  return { req, res, next };
};
const withToken = (token: string | null, r: Record<string, any> = {}) => run({ ...r, headers: { 'x-briefing-token': token } });

beforeEach(() => {
  jest.clearAllMocks();
  queryRaw.mockResolvedValue([{ email: 'owner@example.com', unsubscribed_at: null }]);
  bp.findMany.mockResolvedValue([]);
  competitor.count.mockResolvedValue(0);
});

describe('token', () => {
  it('round-trips the lead id and rejects expired, altered and foreign tokens', () => {
    const now = Date.UTC(2026, 10, 12);
    const token = freeToken('lead_1', 1, now)!;
    expect(readFreeToken(token, now)).toBe('lead_1');
    expect(readFreeToken(token, now + 25 * 3600_000)).toBeNull();
    expect(readFreeToken(token.replace('lead_1', 'lead_2'), now)).toBeNull();
    expect(readFreeToken(`${token}.x`, now)).toBeNull();
    expect(readFreeToken('', now)).toBeNull();
    // A report link's signature (same secret, different message) is not a login.
    const view = new URL(reportViewUrl('lead_1', now)!);
    expect(readFreeToken(`lead_1.${view.searchParams.get('e')}.${view.searchParams.get('t')}`, now)).toBeNull();
  });

  it('is an email address, never a Clerk id', () => {
    expect(isFreeIdentity('owner@example.com')).toBe(true);
    expect(isFreeIdentity('user_2abc')).toBe(false);
    expect(isFreeIdentity(null)).toBe(false);
  });
});

describe('freeAccess', () => {
  it('does nothing without a token', async () => {
    const { req, next } = await run({});
    expect(next).toHaveBeenCalled();
    expect(req.freeIdentity).toBeUndefined();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('ignores a valid token on any route outside its list', async () => {
    const token = freeToken('lead_1', 1);
    for (const [method, path] of [
      ['PUT', '/briefing/settings'], ['GET', '/reports'], ['POST', '/billing/checkout'], ['POST', '/functions/generateReport'],
      ['DELETE', '/entities/Competitor/c1'], ['GET', '/entities/BusinessProfile'], ['POST', '/Briefing/start'], ['POST', '/functions/run%43ompetitorIdentification'],
    ]) {
      const { req, next } = await withToken(token, { method, path });
      expect(next).toHaveBeenCalled();
      expect(req.freeIdentity).toBeUndefined();
    }
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('signs the lead in as its email address, which getUserId then returns', async () => {
    const { req, next } = await withToken(freeToken('lead_1', 1));
    expect(next).toHaveBeenCalled();
    expect(getUserId(req)).toBe('owner@example.com');
    expect(executeRaw).not.toHaveBeenCalled(); // a GET does not confirm the address
  });

  it('confirms the address on the first write', async () => {
    const { next } = await withToken(freeToken('lead_1', 1), { method: 'POST', path: '/briefing/start' });
    expect(next).toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('refuses a bad token, an unknown lead and an unsubscribed lead', async () => {
    expect((await withToken('nope')).res.body).toMatchObject({ link_expired: true });
    queryRaw.mockResolvedValueOnce([]);
    expect((await withToken(freeToken('lead_1', 1))).res.statusCode).toBe(401);
    queryRaw.mockResolvedValueOnce([{ email: 'owner@example.com', unsubscribed_at: new Date() }]);
    const { res, next, req } = await withToken(freeToken('lead_1', 1));
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(req.freeIdentity).toBeUndefined();
  });

  it('runs competitor discovery only while the database still grants the address a run', async () => {
    const discover = { method: 'POST', path: '/functions/runCompetitorIdentification' };
    const lead = [{ email: 'owner@example.com', unsubscribed_at: null }];
    queryRaw.mockResolvedValueOnce(lead).mockResolvedValueOnce([{ id: 'lead_1' }]); // the claim found a run left
    expect((await withToken(freeToken('lead_1', 1), discover)).next).toHaveBeenCalled();
    queryRaw.mockResolvedValueOnce(lead).mockResolvedValueOnce([]); // both runs used
    const { res, next } = await withToken(freeToken('lead_1', 1), discover);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ already_discovered: true });
    expect(next).not.toHaveBeenCalled();
  });
});

test('a Free-link caller may name a competitor and fix its links, nothing else', () => {
  const free = 'owner@example.com';
  expect(freeCompetitorWriteOk(free, { linked_business: 'bp_1', name: 'Rival', instagram_url: 'https://www.instagram.com/rival/', manual_url_fields: ['instagram_url'] })).toBe(true);
  for (const field of ['tracking_status', 'not_relevant', 'is_dismissed', 'google_place_id', 'created_by']) {
    expect(freeCompetitorWriteOk(free, { name: 'Rival', [field]: 'x' })).toBe(false);
  }
  expect(freeCompetitorWriteOk('user_2abc', { tracking_status: 'approved' })).toBe(true); // accounts are unchanged
});

describe('freeReportInfo', () => {
  it('is null for a business that is not an account-less Free one', async () => {
    queryRaw.mockResolvedValueOnce([]);
    expect(await freeReportInfo('bp_1')).toBeNull();
    expect(report.count).not.toHaveBeenCalled();
  });

  it('numbers the first two reports and gives a working change-competitors link', async () => {
    queryRaw.mockResolvedValue([{ id: 'lead_1', unclaimed: true }]);
    report.count.mockResolvedValueOnce(1);
    const first = (await freeReportInfo('bp_1'))!;
    expect(first).toMatchObject({ number: 1, total: 3, last: false });
    // The upgrade link opens sign-up and carries the token, so the form can start with the address.
    const upgrade = new URL(first.upgradeUrl);
    expect(upgrade.pathname + '?briefing=' + upgrade.searchParams.get('briefing')).toBe('/sign-up?briefing=1');
    expect(readFreeToken(upgrade.searchParams.get('t')!)).toBe('lead_1');
    expect(readFreeToken(new URL(first.manageUrl!).searchParams.get('t')!)).toBe('lead_1');
    // Good for a month, so it lasts until the next report.
    expect(readFreeToken(new URL(first.manageUrl!).searchParams.get('t')!, Date.now() + 34 * 86_400_000)).toBe('lead_1');
    expect(report.count).toHaveBeenCalledWith({ where: { linked_business: 'bp_1', status: 'ready' } });
  });

  it('the third report is the last and has no change-competitors link', async () => {
    queryRaw.mockResolvedValue([{ id: 'lead_1', unclaimed: true }]);
    report.count.mockResolvedValueOnce(3);
    const third = (await freeReportInfo('bp_1'))!;
    expect(third).toMatchObject({ number: 3, last: true, manageUrl: null });
    expect(readFreeToken(new URL(third.upgradeUrl).searchParams.get('t')!)).toBe('lead_1'); // the upgrade link still works
    report.count.mockResolvedValueOnce(5); // never shown as "5 of 3"
    expect(await freeReportInfo('bp_1')).toMatchObject({ number: 3, last: true });
  });

  it('once an account has taken the business over, the links go to the account and carry no token', async () => {
    queryRaw.mockResolvedValue([{ id: 'lead_1', unclaimed: false }]);
    report.count.mockResolvedValueOnce(2);
    expect(await freeReportInfo('bp_1')).toMatchObject({
      number: 2, last: false,
      manageUrl: 'https://app.example.com/en/briefing?tab=competitors', upgradeUrl: 'https://app.example.com/en/briefing?tab=plan',
    });
  });
});

test('sendFreeLink emails a link to the setup page that carries the token', async () => {
  expect(await sendFreeLink('lead_1', 'owner@example.com')).toBe(true);
  const { to, html } = (sendEmail as jest.Mock).mock.calls[0][0];
  expect(to).toBe('owner@example.com');
  const token = /https:\/\/app\.example\.com\/en\/start\?t=([^"]+)"/.exec(html)![1];
  expect(readFreeToken(token)).toBe('lead_1');
  expect(html).not.toContain('owner@example.com'); // no address in the link or the body
});
