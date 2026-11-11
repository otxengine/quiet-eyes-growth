// A report-only business is billed through an org of its own — never the user's app org, whose
// subscription and businesses a checkout or a Paddle webhook would otherwise change.
const queryRaw = jest.fn();
const executeRaw = jest.fn(async () => 1);
jest.mock('../db', () => ({
  prisma: { $queryRawUnsafe: (...a: any[]) => queryRaw(...a), $executeRawUnsafe: (...a: any[]) => (executeRaw as any)(...a) },
}));

import { getOrCreateOrgForProfile } from '../lib/orgHelpers';

const profile = { id: 'bp_en', name: "Joe's Pizza" };
const sqlOf = (i: number) => String(queryRaw.mock.calls[i][0]);

beforeEach(() => { queryRaw.mockReset(); executeRaw.mockClear(); });

it('not linked yet: creates its own org with no plan, even when the user already has one', async () => {
  queryRaw
    .mockResolvedValueOnce([])                 // not linked to an org
    .mockResolvedValueOnce([{ id: 'org_new' }]); // INSERT … RETURNING id
  expect(await getOrCreateOrgForProfile(profile, 'user_1', 'brief_daily', { dedicated: true })).toBe('org_new');
  expect(queryRaw).toHaveBeenCalledTimes(2); // the "user's existing org" lookup is skipped
  expect(sqlOf(1)).toContain('INSERT INTO organizations');
  expect(queryRaw.mock.calls[1].slice(1)).toEqual(["Joe's Pizza", 'user_1', 'brief_free', 'none']);
  expect(String((executeRaw.mock.calls[1] as any[])[0])).toContain('UPDATE business_profiles SET organization_id');
  expect((executeRaw.mock.calls[1] as any[]).slice(1)).toEqual(['org_new', 'bp_en']);
});

it('linked to an org that holds other businesses: moves to an org of its own', async () => {
  queryRaw
    .mockResolvedValueOnce([{ organization_id: 'org_app' }])
    .mockResolvedValueOnce([{ n: 2 }])         // two other businesses share it
    .mockResolvedValueOnce([{ id: 'org_new' }]);
  expect(await getOrCreateOrgForProfile(profile, 'user_1', 'brief_weekly', { dedicated: true })).toBe('org_new');
  expect((executeRaw.mock.calls[1] as any[]).slice(1)).toEqual(['org_new', 'bp_en']);
});

it('already alone in its org: keeps it', async () => {
  queryRaw.mockResolvedValueOnce([{ organization_id: 'org_own' }]).mockResolvedValueOnce([{ n: 0 }]);
  expect(await getOrCreateOrgForProfile(profile, 'user_1', 'brief_plus', { dedicated: true })).toBe('org_own');
  expect(executeRaw).not.toHaveBeenCalled();
});

it('app plans are unchanged: reuse the linked org, or the user\'s existing one, seeded as before', async () => {
  queryRaw.mockResolvedValueOnce([{ organization_id: 'org_app' }]);
  expect(await getOrCreateOrgForProfile(profile, 'user_1', 'starter')).toBe('org_app');
  queryRaw.mockReset();
  queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'org_existing' }]);
  expect(await getOrCreateOrgForProfile(profile, 'user_1', 'growth')).toBe('org_existing');
  queryRaw.mockReset();
  queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'org_new' }]);
  await getOrCreateOrgForProfile(profile, 'user_1', 'growth');
  expect(queryRaw.mock.calls[2].slice(1)).toEqual(["Joe's Pizza", 'user_1', 'growth', 'active']);
});
