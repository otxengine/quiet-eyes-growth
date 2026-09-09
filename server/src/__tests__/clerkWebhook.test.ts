/**
 * Clerk account-deletion sync webhook — signature gate + deactivation cascade.
 */

const mockVerify = jest.fn();
jest.mock('svix', () => ({
  Webhook: jest.fn().mockImplementation(() => ({ verify: mockVerify })),
}));

const txExecuteRawUnsafe = jest.fn();
const txQueryRawUnsafe = jest.fn();
jest.mock('../db', () => ({
  prisma: {
    $executeRawUnsafe: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    $transaction: jest.fn((cb: any) => cb({
      $executeRawUnsafe: txExecuteRawUnsafe,
      $queryRawUnsafe: txQueryRawUnsafe,
    })),
  },
}));

import { prisma } from '../db';
import { clerkWebhookHandler, processClerkWebhookEvent } from '../routes/webhooks/clerk';

const rootExecuteRawUnsafe = prisma.$executeRawUnsafe as jest.Mock;
const rootQueryRawUnsafe   = prisma.$queryRawUnsafe as jest.Mock;

const OLD_ENV = process.env;

// rawBody: omit to auto-compute from body; pass null to force it truly missing
// (a default parameter can't tell "omitted" from "explicitly undefined").
function makeReqRes(headers: any, body: any, rawBody?: Buffer | null) {
  const sendStatus = jest.fn().mockReturnThis();
  const resolvedRawBody = rawBody === null ? undefined : (rawBody ?? Buffer.from(JSON.stringify(body)));
  const req: any = { headers, body, rawBody: resolvedRawBody };
  const res: any = { sendStatus };
  return { req, res, sendStatus };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV, CLERK_WEBHOOK_SECRET: 'whsec_test' };
  rootQueryRawUnsafe.mockResolvedValue([]); // default: no cached email, no owned orgs
});

afterAll(() => { process.env = OLD_ENV; });

describe('clerkWebhookHandler — signature gate', () => {
  test('rejects with 403 when CLERK_WEBHOOK_SECRET is unset on the server', () => {
    delete process.env.CLERK_WEBHOOK_SECRET;
    const { req, res, sendStatus } = makeReqRes({}, { type: 'user.deleted', data: { id: 'u1' } });
    clerkWebhookHandler(req, res);
    expect(sendStatus).toHaveBeenCalledWith(403);
  });

  test('rejects with 403 when raw body is missing', () => {
    const { req, res, sendStatus } = makeReqRes({}, { type: 'user.deleted', data: { id: 'u1' } }, null);
    clerkWebhookHandler(req, res);
    expect(sendStatus).toHaveBeenCalledWith(403);
  });

  test('rejects with 403 when svix verification throws', () => {
    mockVerify.mockImplementation(() => { throw new Error('bad signature'); });
    const { req, res, sendStatus } = makeReqRes(
      { 'svix-id': 'a', 'svix-timestamp': 'b', 'svix-signature': 'c' },
      { type: 'user.deleted', data: { id: 'u1' } },
    );
    clerkWebhookHandler(req, res);
    expect(sendStatus).toHaveBeenCalledWith(403);
  });

  test('acks 200 immediately on a valid signature, before async processing resolves', () => {
    mockVerify.mockReturnValue(undefined);
    const { req, res, sendStatus } = makeReqRes(
      { 'svix-id': 'a', 'svix-timestamp': 'b', 'svix-signature': 'c' },
      { type: 'user.created', data: { id: 'u1', email_addresses: [] } },
    );
    clerkWebhookHandler(req, res);
    expect(sendStatus).toHaveBeenCalledWith(200);
  });
});

describe('processClerkWebhookEvent', () => {
  test('ignores payloads missing data.id', async () => {
    await processClerkWebhookEvent({ type: 'user.deleted', data: {} as any });
    expect(rootExecuteRawUnsafe).not.toHaveBeenCalled();
  });

  test('user.created upserts the cache and backfills owner_email for active profiles', async () => {
    await processClerkWebhookEvent({
      type: 'user.created',
      data: {
        id: 'u1',
        primary_email_address_id: 'e1',
        email_addresses: [{ id: 'e1', email_address: 'Owner@Example.com', verification: { status: 'verified' } }],
      },
    });

    expect(rootExecuteRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO clerk_user_cache'), 'u1', 'owner@example.com',
    );
    expect(rootExecuteRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE business_profiles SET owner_email'), 'owner@example.com', 'u1',
    );
  });

  test('user.created does not backfill owner_email when the email is unverified', async () => {
    await processClerkWebhookEvent({
      type: 'user.created',
      data: {
        id: 'u1',
        primary_email_address_id: 'e1',
        email_addresses: [{ id: 'e1', email_address: 'owner@example.com', verification: { status: 'unverified' } }],
      },
    });

    expect(rootExecuteRawUnsafe).toHaveBeenCalledTimes(1); // only the cache upsert (email=null)
    expect(rootExecuteRawUnsafe).toHaveBeenCalledWith(expect.any(String), 'u1', null);
  });

  test('user.deleted deactivates directly-owned profiles, owned-org branches, and revokes memberships', async () => {
    rootQueryRawUnsafe.mockResolvedValueOnce([{ email: 'cached@example.com' }]); // clerk_user_cache lookup
    txQueryRawUnsafe.mockResolvedValueOnce([{ id: 'org1' }, { id: 'org2' }]); // owned orgs

    await processClerkWebhookEvent({ type: 'user.deleted', data: { id: 'u1' } });

    expect(txExecuteRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('WHERE created_by = $2'), 'cached@example.com', 'u1',
    );
    expect(txExecuteRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('WHERE organization_id = $2'), 'cached@example.com', 'org1',
    );
    expect(txExecuteRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('WHERE organization_id = $2'), 'cached@example.com', 'org2',
    );
    expect(txExecuteRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'revoked'"), 'u1',
    );
  });

  test('user.deleted proceeds with a null email when the cache has no entry', async () => {
    rootQueryRawUnsafe.mockResolvedValueOnce([]); // no cache row
    txQueryRawUnsafe.mockResolvedValueOnce([]); // no owned orgs

    await processClerkWebhookEvent({ type: 'user.deleted', data: { id: 'u1' } });

    expect(txExecuteRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('WHERE created_by = $2'), null, 'u1',
    );
  });

  test('user.deleted does not throw when the org tables are unavailable', async () => {
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('relation "organizations" does not exist'));
    await expect(
      processClerkWebhookEvent({ type: 'user.deleted', data: { id: 'u1' } }),
    ).resolves.toBeUndefined();
  });
});
