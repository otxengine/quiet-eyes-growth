/**
 * Long scans (BACKGROUND_FUNCTIONS in server/src/routes/functions/index.ts) must answer
 * the browser right away — CloudFront cuts origin requests at 120s on AWS — and keep
 * running in the background, logging failures to automation_logs.
 */
jest.mock('../db', () => ({ prisma: {} }));
jest.mock('../middleware/auth', () => ({ getUserId: jest.fn(() => 'user-a'), isAdminKeyRequest: jest.fn(() => false) }));
jest.mock('../lib/ownership', () => ({
  getUserBusinessIds: jest.fn(async () => ['biz-1']),
  getUserWritableBusinessIds: jest.fn(async () => ['biz-1']),
  getUserEmail: jest.fn(),
}));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn() }));
jest.mock('../routes/functions/detectCompetitorAds', () => ({ detectCompetitorAds: jest.fn() }));

import { Request, Response } from 'express';
import { writeAutomationLog } from '../lib/automationLog';
import { detectCompetitorAds } from '../routes/functions/detectCompetitorAds';

let router: any;
beforeAll(() => {
  router = require('../routes/functions').default;
});

function makeRes() {
  const res: any = { json: jest.fn(() => res), status: jest.fn(() => res) };
  return res as Response & { json: jest.Mock; status: jest.Mock };
}

async function dispatch(name: string, body: object, res: Response) {
  const req = { body, params: { name }, headers: {} } as unknown as Request;
  const layer = router.stack.find((l: any) => l.route?.path === '/:name' && l.route?.methods?.post);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  let i = 0;
  const next = async (err?: any) => {
    if (err) throw err;
    const h = handlers[i++];
    if (h) await h(req, res, next);
  };
  await next();
}

const drain = () => new Promise(r => setImmediate(r));

describe('POST /api/functions/:name — background scans', () => {
  it('answers 202 with started_at before the handler finishes', async () => {
    let finish!: () => void;
    (detectCompetitorAds as jest.Mock).mockImplementation((_req: any, res: any) =>
      new Promise<void>(resolve => { finish = () => { res.json({ processed: 3 }); resolve(); }; }));

    const res = makeRes();
    await dispatch('detectCompetitorAds', { businessProfileId: 'biz-1', force: true }, res);
    await drain();

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0]).toEqual({ started: true, started_at: expect.any(String) });
    expect(detectCompetitorAds).toHaveBeenCalledWith(expect.objectContaining({ body: { businessProfileId: 'biz-1', force: true } }), expect.anything());

    finish();
    await drain();
    expect(res.json).toHaveBeenCalledTimes(1); // the handler's own json never reaches the browser
    expect(writeAutomationLog).not.toHaveBeenCalled(); // success rows are the handler's job
  });

  it('logs a failed run when the background handler throws', async () => {
    (detectCompetitorAds as jest.Mock).mockRejectedValue(new Error('apify down'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = makeRes();
    await dispatch('detectCompetitorAds', { businessProfileId: 'biz-1' }, res);
    await drain();

    const startedAt = res.json.mock.calls[0][0].started_at;
    expect(writeAutomationLog).toHaveBeenCalledWith('detectCompetitorAds', 'biz-1', startedAt, 0, 'failed', 'apify down');
    errSpy.mockRestore();
  });

  it('logs a failed run when the handler exits with a 4xx it did not log itself', async () => {
    (detectCompetitorAds as jest.Mock).mockImplementation((_req: any, res: any) =>
      res.status(404).json({ error: 'No business profile' }));

    const res = makeRes();
    await dispatch('detectCompetitorAds', { businessProfileId: 'biz-1' }, res);
    await drain();

    expect(writeAutomationLog).toHaveBeenCalledWith('detectCompetitorAds', 'biz-1', expect.any(String), 0, 'failed', 'No business profile');
  });

  it('rejects a missing businessProfileId up front instead of starting a run', async () => {
    const res = makeRes();
    await dispatch('detectCompetitorAds', {}, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(detectCompetitorAds).not.toHaveBeenCalled();
  });
});
