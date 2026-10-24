import { upsertSocialAccount, listGbpLocations, pickGbpLocation } from '../routes/oauth';
import { prisma } from '../db';
import { tryEncryptToken } from '../lib/crypto';

jest.mock('../db', () => ({
  prisma: {
    socialAccount: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}));
jest.mock('../lib/crypto', () => ({
  tryEncryptToken: jest.fn((v: string) => `enc:${v}`),
}));

const saFindFirst = prisma.socialAccount.findFirst as jest.Mock;
const saCreate    = prisma.socialAccount.create    as jest.Mock;
const saUpdate    = prisma.socialAccount.update    as jest.Mock;
const encrypt     = tryEncryptToken                as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  saFindFirst.mockResolvedValue(null);
  saCreate.mockResolvedValue({ id: 'new-sa' });
  saUpdate.mockResolvedValue({ id: 'sa1' });
  encrypt.mockImplementation((v: string) => `enc:${v}`);
});

// ── AC1 KAN-21 — token stored in SocialAccount tied to correct linked_business ─

describe('AC1 KAN-21 — upsertSocialAccount', () => {

  test('creates SocialAccount with correct linked_business when none exists', async () => {
    await upsertSocialAccount('biz-1', 'facebook_page', { account_name: 'My Page', access_token: 'raw-tok', page_id: 'pg1' });

    expect(saCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        linked_business: 'biz-1',
        platform:        'facebook_page',
        account_name:    'My Page',
        page_id:         'pg1',
        is_connected:    true,
      }),
    }));
  });

  test('updates existing SocialAccount (scoped to same business) when one exists', async () => {
    saFindFirst.mockResolvedValue({ id: 'sa-existing' });

    await upsertSocialAccount('biz-1', 'google_business', { account_name: 'Google Biz', access_token: 'raw-tok' });

    expect(saUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sa-existing' },
      data:  expect.objectContaining({ is_connected: true }),
    }));
    expect(saCreate).not.toHaveBeenCalled();
  });

  test('findFirst scoped to linked_business + platform — never touches another business', async () => {
    await upsertSocialAccount('biz-A', 'instagram_business', { account_name: 'Biz A IG', access_token: 'tok' });

    expect(saFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ linked_business: 'biz-A', platform: 'instagram_business' }),
    }));
  });

  test('access_token is encrypted before storage (security NFR §7.4)', async () => {
    await upsertSocialAccount('biz-1', 'facebook_page', { account_name: 'FB Biz', access_token: 'plain-token' });

    expect(encrypt).toHaveBeenCalledWith('plain-token');
    expect(saCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ access_token: 'enc:plain-token' }),
    }));
  });

  test('google_business scoped to correct business', async () => {
    await upsertSocialAccount('biz-google', 'google_business', { account_name: 'G Biz', access_token: 'g-tok', page_id: 'acct/1/loc/2' });

    expect(saFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ linked_business: 'biz-google', platform: 'google_business' }),
    }));
    expect(saCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ linked_business: 'biz-google', page_id: 'acct/1/loc/2' }),
    }));
  });

});

// ── listGbpLocations / pickGbpLocation — v4 path, place-ID match, picker ──────

describe('listGbpLocations', () => {
  const okJson = (body: any) => ({ ok: true, json: async () => body });
  const origFetch = global.fetch;
  afterEach(() => { global.fetch = origFetch; });

  test('lists every location across accounts with its v4 path, title and address', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(okJson({ accounts: [{ name: 'accounts/1' }, { name: 'accounts/2' }] }))
      .mockResolvedValueOnce(okJson({ locations: [{ name: 'locations/10', title: 'Branch A', storefrontAddress: { addressLines: ['Herzl 1'], locality: 'Haifa' }, metadata: { placeId: 'P_A' } }] }))
      .mockResolvedValueOnce(okJson({ locations: [{ name: 'locations/20', title: 'Branch B', metadata: { placeId: 'P_B' } }] })) as any;
    await expect(listGbpLocations('tok')).resolves.toEqual([
      { id: 'accounts/1/locations/10', name: 'Branch A', detail: 'Herzl 1, Haifa', placeId: 'P_A' },
      { id: 'accounts/2/locations/20', name: 'Branch B', detail: '', placeId: 'P_B' },
    ]);
  });

  test('throws with the status when the API rejects (e.g. 0 QPM quota → 429)', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'RESOURCE_EXHAUSTED' }) as any;
    await expect(listGbpLocations('tok')).rejects.toThrow('429');
  });

  test('throws when the Google account manages no locations', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(okJson({ accounts: [] })) as any;
    await expect(listGbpLocations('tok')).rejects.toThrow();
  });
});

describe('pickGbpLocation', () => {
  const a = { id: 'accounts/1/locations/10', name: 'A', detail: '', placeId: 'P_A' };
  const b = { id: 'accounts/1/locations/20', name: 'B', detail: '', placeId: 'P_B' };

  test('picks the location matching the business place ID', () => {
    expect(pickGbpLocation([a, b], 'P_B')).toBe(b);
  });
  test('picks a lone location even without a place ID match', () => {
    expect(pickGbpLocation([a], 'P_OTHER')).toBe(a);
  });
  test('several locations and no match → undefined, so the owner is asked', () => {
    expect(pickGbpLocation([a, b], null)).toBeUndefined();
    expect(pickGbpLocation([a, b], 'P_OTHER')).toBeUndefined();
  });
});
