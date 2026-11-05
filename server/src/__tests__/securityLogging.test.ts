/**
 * Access log (middleware/requestLog.ts) and the admin user delete's transaction + audit record
 * (routes/adminUsers.ts).
 */
const tx = { $executeRawUnsafe: jest.fn(), businessProfile: { delete: jest.fn() } };
const prismaMock = {
  businessProfile: { findUnique: jest.fn() },
  $queryRawUnsafe: jest.fn(),
  $transaction: jest.fn(async (fn: any) => fn(tx)),
};
jest.mock('../db', () => ({ prisma: prismaMock }));
jest.mock('../middleware/auth', () => ({ getUserId: jest.fn(() => null), isAdminKeyRequest: jest.fn(() => true) }));
jest.mock('../infra/AuditLogger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../lib/bootstrapIntelligence', () => ({}));
jest.mock('../lib/dataforseo', () => ({}));
jest.mock('../lib/collectorMetrics', () => ({}));
jest.mock('../lib/ownership', () => ({}));

import express from 'express';
import type { AddressInfo } from 'net';
import { requestLog } from '../middleware/requestLog';
import adminUsersRouter from '../routes/adminUsers';
import { writeAuditLog } from '../infra/AuditLogger';

async function serve(app: express.Express) {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

describe('requestLog', () => {
  const prevEnv = process.env.NODE_ENV;
  beforeAll(() => { process.env.NODE_ENV = 'production'; }); // JSON lines, as in prod
  afterAll(() => { process.env.NODE_ENV = prevEnv; });

  it('logs one line per request with a request id, never the query string, 401 as warn', async () => {
    const app = express();
    app.use(requestLog);
    app.post('/api/cron/run', (_req, res) => { res.status(401).json({ error: 'unauthorized' }); });
    app.get('/healthz', (_req, res) => { res.json({ ok: true }); });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { url, close } = await serve(app);
    try {
      const res = await fetch(`${url}/api/cron/run?secret=s3cret-value`, { method: 'POST' });
      await fetch(`${url}/healthz`);
      await new Promise(r => setImmediate(r));
      expect(res.status).toBe(401);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).not.toContain('s3cret-value');
      const entry = JSON.parse(line);
      expect(entry).toMatchObject({ level: 'warn', module: 'http', message: 'POST /api/cron/run 401', data: { status: 401 } });
      expect(entry.trace_id).toBe(res.headers.get('x-request-id'));
      expect(log).not.toHaveBeenCalled(); // health checks stay out of the log
    } finally {
      close();
      warn.mockRestore();
      log.mockRestore();
    }
  });
});

describe('DELETE /api/admin/users/:businessId', () => {
  const app = express();
  app.use(requestLog);
  app.use('/api/admin', adminUsersRouter);
  let srv: Awaited<ReturnType<typeof serve>>;
  beforeAll(async () => { srv = await serve(app); });
  afterAll(() => srv.close());
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    prismaMock.businessProfile.findUnique.mockResolvedValue({ id: 'bp1', created_by: 'user_1' });
    // Only two of the listed tables exist here; the rest must be skipped, not run inside the transaction.
    prismaMock.$queryRawUnsafe.mockResolvedValue([{ c: 'leads.linked_business' }, { c: 'otx_decisions.business_id' }]);
    tx.$executeRawUnsafe.mockResolvedValue(3);
    tx.businessProfile.delete.mockResolvedValue({});
  });
  afterEach(() => jest.restoreAllMocks());

  it('deletes in one transaction and writes an audit record', async () => {
    const body: any = await (await fetch(`${srv.url}/api/admin/users/bp1`, { method: 'DELETE' })).json();
    expect(body.ok).toBe(true);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRawUnsafe.mock.calls.map(c => c[0])).toEqual([
      'DELETE FROM leads WHERE linked_business = $1',
      'DELETE FROM otx_decisions WHERE business_id = $1',
    ]);
    expect(tx.businessProfile.delete).toHaveBeenCalledWith({ where: { id: 'bp1' } });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      business_id: 'bp1', action: 'admin_deleted', actor_id: 'admin-key',
      metadata: expect.objectContaining({ request_id: expect.any(String), errors: [] }),
    }));
  });

  it('reports a rolled-back delete as failed and audits that too', async () => {
    tx.$executeRawUnsafe.mockRejectedValueOnce(new Error('deadlock detected'));
    const body: any = await (await fetch(`${srv.url}/api/admin/users/bp1`, { method: 'DELETE' })).json();
    expect(body.ok).toBe(false);
    expect(body.results.some((r: string) => r.includes('deleted'))).toBe(false); // nothing claimed as deleted
    expect(tx.businessProfile.delete).not.toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin_delete_failed' }));
  });
});
