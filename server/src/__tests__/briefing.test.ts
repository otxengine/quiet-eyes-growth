// The English report-only product: sign-up endpoints, settings, and the first-report period label.
const bp = { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() };
const executeRaw = jest.fn(async () => 1);
const queryRaw = jest.fn(async () => [{ timezone: 'America/Chicago', report_recipients: 'owner@example.com' }]);
jest.mock('../db', () => ({
  prisma: { businessProfile: bp, $executeRaw: (...a: any[]) => (executeRaw as any)(...a), $queryRaw: (...a: any[]) => (queryRaw as any)(...a) },
}));
jest.mock('../middleware/auth', () => ({ getUserId: () => 'user_1', isAdminKeyRequest: () => false }));
jest.mock('../middleware/businessAccess', () => ({ requireOwnsBusinessFields: (_q: any, _s: any, next: any) => next() }));
jest.mock('../middleware/rateLimits', () => ({ strictLimiter: (_q: any, _s: any, next: any) => next(), freeRequestLimiter: (_q: any, _s: any, next: any) => next() }));
jest.mock('../lib/ownership', () => ({ getUserEmail: jest.fn(async () => 'owner@example.com') }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn() }));
const sendFreeLink = jest.fn(async (..._a: any[]) => true);
jest.mock('../lib/freeAccess', () => ({
  FREE_CONSENT_TEXT: 'consent text', sendFreeLink: (...a: any[]) => sendFreeLink(...a), isFreeIdentity: (id: string) => id.includes('@'),
}));
jest.mock('../lib/extractSocialLinksFromWebsite', () => ({
  extractSocialLinksFromWebsite: jest.fn(async () => ({ instagram_url: 'https://www.instagram.com/joespizza/', facebook_url: null })),
}));
const collectors = { posts: jest.fn(), stories: jest.fn(), ads: jest.fn(), reviews: jest.fn() };
jest.mock('../routes/functions/collectCompetitorSocialProfileAndPosts', () => ({ collectCompetitorSocialProfileAndPosts: (...a: any[]) => collectors.posts(...a) }));
jest.mock('../routes/functions/collectCompetitorSocialStories', () => ({ collectCompetitorSocialStories: (...a: any[]) => collectors.stories(...a) }));
jest.mock('../routes/functions/detectCompetitorAds', () => ({ detectCompetitorAds: (...a: any[]) => collectors.ads(...a) }));
jest.mock('../routes/functions/collectReviews', () => ({ collectReviews: (...a: any[]) => collectors.reviews(...a) }));

process.env.GOOGLE_PLACES_API_KEY = 'k';
import router, { cityOf } from '../routes/briefing';
import { reportPeriodLabel } from '../lib/reportPdf/html';

const call = async (path: string, method: string, req: any) => {
  const layer = (router as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  await layer.route.stack[layer.route.stack.length - 1].handle({ headers: {}, query: {}, body: {}, ...req }, r);
  return r;
};
const PLACE = {
  id: 'ChIJ_place_id_0001', displayName: { text: "Joe's Pizza" }, formattedAddress: '1 Main St, Austin, TX 78701, USA',
  primaryTypeDisplayName: { text: 'Pizza restaurant' }, websiteUri: 'https://joes.example.com',
  addressComponents: [
    { longText: 'Austin', shortText: 'Austin', types: ['locality'] },
    { longText: 'Texas', shortText: 'TX', types: ['administrative_area_level_1'] },
    { longText: 'United States', shortText: 'US', types: ['country'] },
  ],
};
const places = (body: any, ok = true) => { (global as any).fetch = jest.fn(async () => ({ ok, json: async () => body })); };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.BRIEFING_BLOCK_ISRAEL;
  bp.findMany.mockResolvedValue([]);
  bp.create.mockResolvedValue({ id: 'bp_new' });
  bp.updateMany.mockResolvedValue({ count: 0 });
});

test('cityOf: "Austin, TX" from address components', () => {
  expect(cityOf(PLACE.addressComponents)).toBe('Austin, TX');
  expect(cityOf([])).toBe('');
});

describe('search-business', () => {
  it('returns Google candidates, searched in English in the US', async () => {
    places({ places: [{ id: 'p1', displayName: { text: "Joe's Pizza" }, formattedAddress: 'Austin, TX', rating: 4.5, userRatingCount: 120 }] });
    const r = await call('/search-business', 'post', { body: { query: "Joe's Pizza Austin" } });
    expect(r.body.results).toEqual([{ placeId: 'p1', name: "Joe's Pizza", address: 'Austin, TX', category: '', rating: 4.5, reviewCount: 120 }]);
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toMatchObject({ languageCode: 'en', regionCode: 'us', maxResultCount: 5 });
  });
  it('needs a real query and, with BRIEFING_BLOCK_ISRAEL on, is refused from Israel', async () => {
    places({});
    expect((await call('/search-business', 'post', { body: { query: 'a' } })).statusCode).toBe(400);
    process.env.BRIEFING_BLOCK_ISRAEL = 'true';
    const il = await call('/search-business', 'post', { body: { query: 'Cafe Tel Aviv' }, headers: { 'cloudfront-viewer-country': 'IL' } });
    expect(il.statusCode).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('visitors from Israel are let through while the block is off (the default)', async () => {
    places({ places: [] });
    const il = await call('/search-business', 'post', { body: { query: 'Home Slice Pizza Austin' }, headers: { 'cloudfront-viewer-country': 'IL' } });
    expect(il.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('start', () => {
  it('creates an English, free report-only business from what Google says — not from the browser', async () => {
    places(PLACE);
    const r = await call('/start', 'post', { body: { placeId: PLACE.id, timezone: 'America/Chicago', name: 'Hacked', subscription_plan: 'brief_plus' } });
    expect(r.body).toEqual({ businessProfileId: 'bp_new', resumed: false, onboardingCompleted: false });
    expect(bp.create.mock.calls[0][0].data).toEqual({
      instagram_url: 'https://www.instagram.com/joespizza/', facebook_url: null, // read off the business's website
      name: "Joe's Pizza", category: 'Pizza restaurant', city: 'Austin, TX', full_address: PLACE.formattedAddress,
      website_url: 'https://joes.example.com', google_place_id: PLACE.id, google_place_id_verified: true,
      created_by: 'user_1', subscription_plan: 'brief_free', onboarding_completed: false,
    });
    const [, tz, email, id] = executeRaw.mock.calls[0] as any[];
    expect([tz, email, id]).toEqual(['America/Chicago', 'owner@example.com', 'bp_new']);
  });
  it('a second start resumes the same business', async () => {
    bp.findMany.mockResolvedValue([{ id: 'bp_old', subscription_plan: 'brief_weekly', onboarding_completed: true }]);
    places(PLACE);
    const r = await call('/start', 'post', { body: { placeId: PLACE.id } });
    expect(r.body).toEqual({ businessProfileId: 'bp_old', resumed: true, onboardingCompleted: true });
    expect(bp.create).not.toHaveBeenCalled();
  });
  it('refuses a business in Israel, a visitor from Israel and a bad place id', async () => {
    places({ ...PLACE, addressComponents: [{ shortText: 'IL', longText: 'Israel', types: ['country'] }] });
    expect((await call('/start', 'post', { body: { placeId: PLACE.id } })).statusCode).toBe(403);
    places(PLACE);
    process.env.BRIEFING_BLOCK_ISRAEL = 'true';
    expect((await call('/start', 'post', { body: { placeId: PLACE.id }, headers: { 'cloudfront-viewer-country': 'il' } })).statusCode).toBe(403);
    expect((await call('/start', 'post', { body: { placeId: '../etc' } })).statusCode).toBe(400);
    expect(bp.create).not.toHaveBeenCalled();
  });
});

describe('finish', () => {
  it('ends onboarding and starts the first collection with force', async () => {
    bp.findUnique.mockResolvedValue({ subscription_plan: 'brief_free' });
    const r = await call('/finish', 'post', { body: { businessProfileId: 'bp_new' } });
    expect(r.body).toEqual({ ok: true });
    expect(bp.update).toHaveBeenCalledWith({ where: { id: 'bp_new' }, data: { onboarding_completed: true } });
    await new Promise(setImmediate);
    for (const c of Object.values(collectors)) expect(c.mock.calls[0][0].body).toMatchObject({ businessProfileId: 'bp_new', force: true });
  });
  it('is only for report-only businesses', async () => {
    bp.findUnique.mockResolvedValue({ subscription_plan: 'starter' });
    expect((await call('/finish', 'post', { body: { businessProfileId: 'bp_x' } })).statusCode).toBe(404);
    expect(bp.update).not.toHaveBeenCalled();
  });
});

describe('settings', () => {
  it('reads plan limits, recipients and timezone', async () => {
    bp.findUnique.mockResolvedValue({ name: "Joe's Pizza", city: 'Austin, TX', subscription_plan: 'brief_weekly' });
    const r = await call('/settings', 'get', { query: { businessProfileId: 'bp_new' } });
    expect(r.body).toMatchObject({ plan: 'brief_weekly', competitorsMax: 3, reports: ['weekly', 'monthly'], recipients: ['owner@example.com'], timezone: 'America/Chicago', youVsThem: true });
    bp.findUnique.mockResolvedValue({ name: 'x', city: 'y', subscription_plan: 'brief_free' });
    expect((await call('/settings', 'get', { query: { businessProfileId: 'bp_new' } })).body).toMatchObject({ competitorsMax: 2, reports: ['monthly'], youVsThem: false });
  });
  it('saves the business\'s own Instagram / Facebook links, and only those hosts', async () => {
    const put = (body: any) => call('/settings', 'put', { body: { businessProfileId: 'bp_new', ...body } });
    expect((await put({ instagramUrl: 'https://www.instagram.com/joespizza/', facebookUrl: '' })).body).toEqual({ ok: true });
    expect(bp.update.mock.calls.map(c => c[0].data)).toEqual([{ instagram_url: 'https://www.instagram.com/joespizza/' }, { facebook_url: null }]);
    bp.update.mockClear();
    expect((await put({ instagramUrl: 'https://evil.example.com/instagram.com' })).statusCode).toBe(400);
    expect((await put({ facebookUrl: 'javascript:alert(1)' })).statusCode).toBe(400);
    expect(bp.update).not.toHaveBeenCalled();
  });
  it('saves valid recipients and a known timezone; rejects bad ones', async () => {
    const put = (body: any) => call('/settings', 'put', { body: { businessProfileId: 'bp_new', ...body } });
    expect((await put({ recipients: ['A@x.com', 'b@y.io'], timezone: 'America/Denver' })).body).toEqual({ ok: true });
    expect((executeRaw.mock.calls[0] as any[])[1]).toBe('a@x.com,b@y.io');
    expect((executeRaw.mock.calls[1] as any[])[1]).toBe('America/Denver');
    executeRaw.mockClear();
    expect((await put({ recipients: ['not-an-email'] })).statusCode).toBe(400);
    expect((await put({ recipients: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com'] })).statusCode).toBe(400);
    expect((await put({ timezone: 'Mars/Phobos' })).statusCode).toBe(400);
    expect(executeRaw).not.toHaveBeenCalled();
  });
});

test('the first report (a monthly row over the last 30 days) is labelled as a range, a calendar month by name', () => {
  const NY = { lang: 'en' as const, intl: 'en-US', tz: 'America/New_York' };
  expect(reportPeriodLabel('monthly', '2026-10-11T04:00:00Z', '2026-11-10T05:00:00Z', NY)).toBe('October 11 – November 9, 2026');
  expect(reportPeriodLabel('monthly', '2026-10-01T04:00:00Z', '2026-11-01T04:00:00Z', NY)).toBe('October 2026');
});

describe('account-less Free plan', () => {
  const request = (body: any, headers = {}) => call('/free/request', 'post', { body, headers });

  // The handler's three queries, in order: today's new addresses, the lead row, the claim for one email.
  const db = (today: number, claim: any[]) => queryRaw
    .mockResolvedValueOnce([{ n: today }] as any).mockResolvedValueOnce([{ id: 'lead_1' }] as any).mockResolvedValueOnce(claim as any);

  it('needs a valid address and the newsletter consent', async () => {
    expect((await request({ email: 'not-an-address', consent: true })).statusCode).toBe(400);
    expect((await request({ email: '"x"<owner@example.com>', consent: true })).statusCode).toBe(400);
    expect((await request({ email: 'owner@example.com' })).body).toMatchObject({ needsConsent: true });
    expect((await request({ email: 'owner@example.com', consent: 'yes' })).statusCode).toBe(400);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(sendFreeLink).not.toHaveBeenCalled();
  });

  it('stores the lead and emails the setup link to the lower-cased address', async () => {
    db(0, [{ id: 'lead_1' }]);
    const r = await request({ email: ' Owner@Example.com ', consent: true });
    expect(r.body).toEqual({ ok: true });
    expect(sendFreeLink).toHaveBeenCalledWith('lead_1', 'owner@example.com');
  });

  it('answers the same but sends nothing when the address has no email left to claim (unsubscribed, or too many)', async () => {
    db(0, []);
    expect((await request({ email: 'owner@example.com', consent: true })).body).toEqual({ ok: true });
    expect(sendFreeLink).not.toHaveBeenCalled();
  });

  it('stops taking new addresses at the daily ceiling', async () => {
    queryRaw.mockResolvedValueOnce([{ n: 300 }] as any);
    expect((await request({ email: 'owner@example.com', consent: true })).statusCode).toBe(429);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(sendFreeLink).not.toHaveBeenCalled();
  });

  it('is refused from Israel when the block is on', async () => {
    process.env.BRIEFING_BLOCK_ISRAEL = 'true';
    expect((await request({ email: 'owner@example.com', consent: true }, { 'cloudfront-viewer-country': 'IL' })).statusCode).toBe(403);
  });

  it('start links the new business to the lead, and refuses an address whose business an account has claimed', async () => {
    places(PLACE);
    queryRaw.mockResolvedValueOnce([{ id: 'lead_1' }] as any); // the lead's one slot was free
    const r = await call('/start', 'post', { body: { placeId: PLACE.id }, freeLeadId: 'lead_1' });
    expect(r.body).toMatchObject({ businessProfileId: 'bp_new' });
    expect(executeRaw).toHaveBeenCalledTimes(2); // locale/timezone/recipients, then the lead's business link

    bp.create.mockClear();
    queryRaw.mockResolvedValueOnce([] as any); // the slot is taken
    const again = await call('/start', 'post', { body: { placeId: PLACE.id }, freeLeadId: 'lead_1' });
    expect(again.statusCode).toBe(409);
    expect(again.body).toMatchObject({ has_account: true });
    expect(bp.create).not.toHaveBeenCalled();
  });

  it('an account with the verified address takes the Free business over, on its first visit', async () => {
    const free = { id: 'bp_free', name: "Joe's Pizza", subscription_plan: 'brief_free', onboarding_completed: true };
    bp.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([free]); // nothing under the account id, then the claimed one
    bp.updateMany.mockResolvedValueOnce({ count: 1 });
    const r = await call('/me', 'get', {});
    expect(bp.updateMany).toHaveBeenCalledWith({
      where: { created_by: { in: ['owner@example.com', 'owner@example.com'] }, subscription_plan: { startsWith: 'brief_' } },
      data: { created_by: 'user_1' },
    });
    expect(r.body.business).toMatchObject({ businessProfileId: 'bp_free', onboardingCompleted: true });
  });

  it('an account without a verified address claims nothing', async () => {
    const { getUserEmail } = jest.requireMock('../lib/ownership');
    getUserEmail.mockResolvedValueOnce(null);
    const r = await call('/me', 'get', {});
    expect(r.body).toEqual({ business: null });
    expect(bp.updateMany).not.toHaveBeenCalled();
  });

  it('a second finish does not start the paid first collection again', async () => {
    bp.findUnique.mockResolvedValue({ subscription_plan: 'brief_free', onboarding_completed: true });
    const r = await call('/finish', 'post', { body: { businessProfileId: 'bp_1' } });
    expect(r.body).toEqual({ ok: true });
    expect(bp.update).not.toHaveBeenCalled();
    expect(collectors.posts).not.toHaveBeenCalled();
  });
});
