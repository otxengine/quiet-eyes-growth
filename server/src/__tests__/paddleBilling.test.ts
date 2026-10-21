/**
 * Paddle billing — webhook signature gate + subscription → org/plan sync.
 */

jest.mock('../db', () => ({
  prisma: {
    $executeRawUnsafe: jest.fn(),
    $queryRawUnsafe: jest.fn(),
  },
}));

import crypto from 'crypto';
import { prisma } from '../db';
import { verifyPaddleSignature, planFromPriceId } from '../lib/paddle';
import { handlePaddleEvent } from '../routes/billing';

const executeRaw = prisma.$executeRawUnsafe as jest.Mock;
const queryRaw   = prisma.$queryRawUnsafe as jest.Mock;

const OLD_ENV = process.env;
const SECRET = 'pdl_ntfset_test';

function sign(body: string, ts: number, secret = SECRET) {
  const h1 = crypto.createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env = {
    ...OLD_ENV,
    PADDLE_PRICE_STARTER: 'pri_starter',
    PADDLE_PRICE_GROWTH:  'pri_growth',
    PADDLE_PRICE_PRO:     'pri_pro',
  };
  executeRaw.mockResolvedValue(1);
  queryRaw.mockResolvedValue([]);
});

afterAll(() => { process.env = OLD_ENV; });

describe('verifyPaddleSignature', () => {
  const body = JSON.stringify({ event_type: 'subscription.created' });
  const now = 1_700_000_000;

  test('accepts a correctly signed, fresh request', () => {
    expect(verifyPaddleSignature(Buffer.from(body), sign(body, now), SECRET, now)).toBe(true);
  });

  test('rejects a body that was modified after signing', () => {
    const header = sign(body, now);
    expect(verifyPaddleSignature(Buffer.from(body + ' '), header, SECRET, now)).toBe(false);
  });

  test('rejects a signature made with a different secret', () => {
    expect(verifyPaddleSignature(Buffer.from(body), sign(body, now, 'other'), SECRET, now)).toBe(false);
  });

  test('rejects a replayed request older than the tolerance window', () => {
    expect(verifyPaddleSignature(Buffer.from(body), sign(body, now - 600), SECRET, now)).toBe(false);
  });

  test('rejects when header, body or secret is missing', () => {
    const header = sign(body, now);
    expect(verifyPaddleSignature(undefined, header, SECRET, now)).toBe(false);
    expect(verifyPaddleSignature(Buffer.from(body), undefined, SECRET, now)).toBe(false);
    expect(verifyPaddleSignature(Buffer.from(body), header, undefined, now)).toBe(false);
    expect(verifyPaddleSignature(Buffer.from(body), 'garbage', SECRET, now)).toBe(false);
  });
});

describe('planFromPriceId', () => {
  test('maps configured prices to plans and unknown prices to null', () => {
    expect(planFromPriceId('pri_growth')).toBe('growth');
    expect(planFromPriceId('pri_unknown')).toBeNull();
    expect(planFromPriceId('')).toBeNull();
  });
});

describe('handlePaddleEvent — subscription sync', () => {
  const baseSub = {
    id: 'sub_1',
    customer_id: 'ctm_1',
    status: 'active',
    custom_data: { org_id: 'org_1', plan_id: 'growth' },
    items: [{ price: { id: 'pri_pro' }, quantity: 3 }],
    current_billing_period: { ends_at: '2026-11-21T00:00:00Z' },
  };

  test('active subscription stores ids and the plan derived from the price', async () => {
    await handlePaddleEvent({ event_type: 'subscription.created', occurred_at: '2026-10-21T10:00:00Z', data: baseSub });

    const [orgSql, ...orgArgs] = executeRaw.mock.calls[0];
    expect(orgSql).toMatch(/UPDATE organizations/);
    // price wins over custom_data.plan_id (plan switches change the price, not custom_data)
    expect(orgArgs.slice(0, 5)).toEqual(['ctm_1', 'sub_1', 'active', 'pro', 3]);
    expect(executeRaw.mock.calls[1]).toEqual([expect.stringMatching(/business_profiles/), 'pro', 'org_1']);
  });

  test('canceled subscription drops the org back to free_trial', async () => {
    await handlePaddleEvent({ event_type: 'subscription.canceled', data: { ...baseSub, status: 'canceled' } });

    const orgArgs = executeRaw.mock.calls[0].slice(1);
    expect(orgArgs[2]).toBe('cancelled');
    expect(orgArgs[3]).toBe('free_trial');
    expect(executeRaw.mock.calls[1]).toEqual([expect.stringMatching(/business_profiles/), 'free_trial', 'org_1']);
  });

  test('past_due keeps the paid plan while Paddle retries the card', async () => {
    await handlePaddleEvent({ event_type: 'subscription.past_due', data: { ...baseSub, status: 'past_due' } });
    const orgArgs = executeRaw.mock.calls[0].slice(1);
    expect(orgArgs[2]).toBe('past_due');
    expect(orgArgs[3]).toBe('pro');
  });

  test('falls back to looking the org up by subscription id when custom_data is absent', async () => {
    queryRaw.mockResolvedValueOnce([{ id: 'org_9' }]);
    await handlePaddleEvent({ event_type: 'subscription.updated', data: { ...baseSub, custom_data: null } });
    expect(executeRaw.mock.calls[0][7]).toBe('org_9');
  });

  test('stale event (newer state already stored) does not touch business profiles', async () => {
    executeRaw.mockResolvedValueOnce(0); // org UPDATE matched no row: paddle_event_at is newer
    await handlePaddleEvent({ event_type: 'subscription.created', occurred_at: '2026-10-01T00:00:00Z', data: baseSub });
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  test('subscription with no matching org writes nothing', async () => {
    await handlePaddleEvent({ event_type: 'subscription.updated', data: { ...baseSub, custom_data: null } });
    expect(executeRaw).not.toHaveBeenCalled();
  });

  test('transaction events are ignored (a declined card in checkout must not change the plan)', async () => {
    await handlePaddleEvent({ event_type: 'transaction.payment_failed', data: { id: 'txn_1' } });
    expect(executeRaw).not.toHaveBeenCalled();
  });
});
