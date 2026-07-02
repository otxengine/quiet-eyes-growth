import { upsertSocialAccount } from '../routes/oauth';
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
    await upsertSocialAccount('biz-1', 'tiktok_business', { account_name: 'TikTok Biz', access_token: 'plain-token' });

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
