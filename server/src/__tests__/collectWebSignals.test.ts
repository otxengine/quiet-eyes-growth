import { Request, Response } from 'express';
import { collectWebSignals } from '../routes/functions/collectWebSignals';
import { prisma } from '../db';
import { tavilySearch } from '../lib/tavily';
import { shouldSkipAgent, setLastRun } from '../lib/agentCache';
import { buildSearchQueries } from '../lib/businessProfile';
import { buildKeywordQueries, buildUrlQueries } from '../lib/dataSources';
import { getAgentMission } from '../lib/missionPlanner';
import { writeAutomationLog } from '../lib/automationLog';

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findFirst: jest.fn() },
    rawSignal:       { findMany: jest.fn(), create: jest.fn() },
  },
}));
jest.mock('../lib/tavily',          () => ({ tavilySearch:      jest.fn() }));
jest.mock('../lib/agentCache',      () => ({ shouldSkipAgent:   jest.fn(), setLastRun: jest.fn() }));
jest.mock('../lib/businessProfile', () => ({ buildSearchQueries: jest.fn(), cityToEn: jest.fn(() => 'Tel Aviv') }));
jest.mock('../lib/dataSources',     () => ({ buildKeywordQueries: jest.fn(), buildUrlQueries: jest.fn() }));
jest.mock('../lib/missionPlanner',  () => ({ getAgentMission:   jest.fn() }));
jest.mock('../lib/automationLog',   () => ({ writeAutomationLog: jest.fn() }));

const bpFindFirst   = prisma.businessProfile.findFirst as jest.Mock;
const signalFindMany = prisma.rawSignal.findMany       as jest.Mock;
const signalCreate  = prisma.rawSignal.create          as jest.Mock;
const tavily        = tavilySearch        as jest.Mock;
const skipAgent     = shouldSkipAgent     as jest.Mock;
const bsq           = buildSearchQueries  as jest.Mock;
const bkq           = buildKeywordQueries as jest.Mock;
const buq           = buildUrlQueries     as jest.Mock;
const getMission    = getAgentMission     as jest.Mock;
const autoLog       = writeAutomationLog  as jest.Mock;

const PROFILE = {
  id: 'bp1', name: 'Test Biz', city: 'TLV',
  sector_profile: null, agent_missions: null, custom_keywords: null, custom_urls: null,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeReqRes(body: any): { req: Request; res: any; json: jest.Mock } {
  const json = jest.fn().mockReturnThis();
  const req = { body } as unknown as Request;
  const res: any = { status: jest.fn().mockReturnThis(), json };
  return { req, res, json };
}

// Capture the sequence of queries passed to tavilySearch
function capturedQueries(): string[] {
  return tavily.mock.calls.map((c: any[]) => c[0]);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  bpFindFirst.mockResolvedValue(PROFILE);
  signalFindMany.mockResolvedValue([]);
  signalCreate.mockResolvedValue({});
  tavily.mockResolvedValue([]);
  skipAgent.mockReturnValue(false);
  bsq.mockReturnValue(['bsq_query_1', 'bsq_query_2', 'bsq_query_3', 'bsq_query_4']);
  bkq.mockReturnValue([]);
  buq.mockReturnValue([]);
  getMission.mockReturnValue(null);
  autoLog.mockResolvedValue(undefined);
});

describe('collectWebSignals — AC#2 query ordering', () => {

  test('when priority_queries_en present: they appear before buildSearchQueries results', async () => {
    getMission.mockReturnValue({
      priority_queries_en: ['pq_alpha', 'pq_beta', 'pq_gamma'],
    });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectWebSignals(req, res);

    const queries = capturedQueries();
    const pqIndices  = ['pq_alpha', 'pq_beta', 'pq_gamma'].map(q => queries.indexOf(q));
    const bsqIndices = ['bsq_query_1', 'bsq_query_2', 'bsq_query_3'].map(q => queries.indexOf(q));

    // All priority queries must be found
    pqIndices.forEach(i => expect(i).toBeGreaterThanOrEqual(0));

    // Every priority query index must be less than every bsq index
    for (const pi of pqIndices) {
      for (const bi of bsqIndices) {
        expect(pi).toBeLessThan(bi);
      }
    }
  });

  test('when priority_queries_en present: they appear before custom_keywords queries', async () => {
    getMission.mockReturnValue({ priority_queries_en: ['pq_first'] });
    bkq.mockReturnValue(['kw_query_1', 'kw_query_2']);

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectWebSignals(req, res);

    const queries = capturedQueries();
    const pqIdx = queries.indexOf('pq_first');
    const kwIdx = queries.indexOf('kw_query_1');

    expect(pqIdx).toBeGreaterThanOrEqual(0);
    expect(kwIdx).toBeGreaterThanOrEqual(0);
    expect(pqIdx).toBeLessThan(kwIdx);
  });

  test('when priority_queries_en absent: falls back to buildSearchQueries only', async () => {
    getMission.mockReturnValue(null);

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectWebSignals(req, res);

    const queries = capturedQueries();
    // All 4 bsq queries appear (not sliced to 3 in fallback path)
    expect(queries).toContain('bsq_query_1');
    expect(queries).toContain('bsq_query_4');
    // No mission query
    expect(queries.some(q => q.startsWith('pq_'))).toBe(false);
  });

  test('when priority_queries_en is empty array: falls back to buildSearchQueries', async () => {
    getMission.mockReturnValue({ priority_queries_en: [] });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectWebSignals(req, res);

    const queries = capturedQueries();
    expect(queries).toContain('bsq_query_1');
    expect(queries.some(q => q.startsWith('pq_'))).toBe(false);
  });

  test('skipped flag returned when agent ran recently', async () => {
    skipAgent.mockReturnValue(true);

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectWebSignals(req, res);

    expect(json).toHaveBeenCalledWith({ new_signals: 0, skipped: true, reason: 'ran_recently' });
    expect(tavily).not.toHaveBeenCalled();
  });

  test('400 when businessProfileId missing', async () => {
    const { req, res } = makeReqRes({});
    await collectWebSignals(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

});
