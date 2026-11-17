/**
 * Who the weekly digest goes to: the profile's own address, else the owner's verified primary
 * Clerk address (kept in owner_email), never an unverified one.
 */
const mockGetUser = jest.fn();
jest.mock('@clerk/express', () => ({ createClerkClient: () => ({ users: { getUser: mockGetUser } }) }));
jest.mock('../db', () => ({
  prisma: {
    $queryRaw:      jest.fn(),
    $executeRaw:    jest.fn(),
    lead:           { findMany: jest.fn(), count: jest.fn() },
    review:         { findMany: jest.fn() },
    proactiveAlert: { findFirst: jest.fn() },
    healthScore:    { findMany: jest.fn() },
  },
}));
jest.mock('../lib/email', () => ({ sendEmail: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn() }));

import { prisma } from '../db';
import { sendEmail } from '../lib/email';
import { weeklyEmailDigest } from '../routes/functions/weeklyEmailDigest';

const db = prisma as any;
const send = sendEmail as jest.Mock;

const run = async (row: Record<string, unknown>) => {
  db.$queryRaw.mockResolvedValue([{ name: 'Biz', created_by: null, notification_email: null, owner_email: null, ...row }]);
  const json = jest.fn();
  await weeklyEmailDigest({ body: { businessProfileId: 'biz-1' } } as any, { json } as any);
  return json.mock.calls[0][0];
};
const clerkUser = (status: string | null) => mockGetUser.mockResolvedValue({
  primaryEmailAddressId: 'idn_1',
  emailAddresses: [{ id: 'idn_1', emailAddress: 'owner@example.com', verification: status ? { status } : null }],
});
// The ownership lookup caches per Clerk id, so each Clerk test uses its own.
let n = 0;
const nextUserId = () => `user_digest_${++n}`;

beforeAll(() => { process.env.CLERK_SECRET_KEY = 'sk_test_dummy'; });
beforeEach(() => {
  jest.clearAllMocks();
  db.lead.findMany.mockResolvedValue([]);
  db.lead.count.mockResolvedValue(0);
  db.review.findMany.mockResolvedValue([]);
  db.proactiveAlert.findFirst.mockResolvedValue(null);
  db.healthScore.findMany.mockResolvedValue([]);
});

test('sends to the address already on the profile without asking Clerk', async () => {
  const out = await run({ created_by: nextUserId(), owner_email: 'set@example.com' });
  expect(out.success).toBe(true);
  expect(send.mock.calls[0][0].to).toBe('set@example.com');
  expect(mockGetUser).not.toHaveBeenCalled();
  expect(db.$executeRaw).not.toHaveBeenCalled();
});

test('falls back to the verified primary Clerk address and stores it in owner_email', async () => {
  clerkUser('verified');
  const out = await run({ created_by: nextUserId() });
  expect(out.success).toBe(true);
  expect(send.mock.calls[0][0].to).toBe('owner@example.com');
  const [sql, ...values] = db.$executeRaw.mock.calls[0];
  expect(sql.join('?')).toMatch(/SET owner_email = \?.*owner_email IS NULL/);
  expect(values).toEqual(['owner@example.com', 'biz-1']);
});

test('skips an unverified primary address: no email, nothing stored', async () => {
  clerkUser(null);
  const out = await run({ created_by: nextUserId() });
  expect(out).toEqual({ success: false, reason: 'no verified owner email' });
  expect(send).not.toHaveBeenCalled();
  expect(db.$executeRaw).not.toHaveBeenCalled();
});
