/**
 * KAN-69 AC3: POST /api/orchestrator/run triggers MasterOrchestrator pipeline stages.
 */

jest.mock('../orchestration/MasterOrchestrator', () => ({
  runPipeline:        jest.fn(),
  runDecisionOnly:    jest.fn(),
  getRunningBusinesses: jest.fn(() => []),
}));
jest.mock('../services/learning/OutcomeTracker', () => ({
  recordOutcome:     jest.fn(),
  getOutcomeSummary: jest.fn(),
}));
jest.mock('../db', () => ({
  prisma: { $queryRawUnsafe: jest.fn(() => Promise.resolve([])), proactiveAlert: { findMany: jest.fn(() => []) } },
}));
jest.mock('../infra/logger', () => ({
  createLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }),
}));

import { Request, Response } from 'express';
import { runPipeline } from '../orchestration/MasterOrchestrator';

// Load the router after mocks are set
let router: any;
beforeAll(() => {
  router = require('../routes/orchestrator').default;
});

function makeReq(body: object): Request {
  return { body, params: {} } as unknown as Request;
}

function makeRes() {
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() } as unknown as Response;
  return { res, json };
}

describe('KAN-69 AC3: POST /api/orchestrator/run', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls runPipeline with businessProfileId and default options', async () => {
    (runPipeline as jest.Mock).mockResolvedValue({ run_id: 'r1', status: 'completed' });

    // Find the /run POST handler registered on the router
    const runLayer = router.stack.find(
      (l: any) => l.route?.path === '/run' && l.route?.methods?.post,
    );
    expect(runLayer).toBeDefined();

    const { res } = makeRes();
    await runLayer.route.stack[0].handle(makeReq({ businessProfileId: 'bp1' }), res);

    expect(runPipeline).toHaveBeenCalledWith('bp1', expect.objectContaining({
      mode:        'full',
      triggeredBy: 'manual',
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ run_id: 'r1' }));
  });

  it('returns 400 when businessProfileId is missing', async () => {
    const runLayer = router.stack.find(
      (l: any) => l.route?.path === '/run' && l.route?.methods?.post,
    );

    const { res } = makeRes();
    await runLayer.route.stack[0].handle(makeReq({}), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it('returns 500 and does not throw when runPipeline rejects', async () => {
    (runPipeline as jest.Mock).mockRejectedValue(new Error('pipeline boom'));

    const runLayer = router.stack.find(
      (l: any) => l.route?.path === '/run' && l.route?.methods?.post,
    );

    const { res } = makeRes();
    await runLayer.route.stack[0].handle(makeReq({ businessProfileId: 'bp1' }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'pipeline boom' }));
  });
});
