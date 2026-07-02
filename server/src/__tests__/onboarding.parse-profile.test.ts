import router from '../routes/onboarding';
import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';
import { writeAutomationLog } from '../lib/automationLog';
import { createLogger } from '../infra/logger';

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../db', () => ({
  prisma: {
    businessProfile: {
      findUnique: jest.fn(),
      update:     jest.fn(),
    },
  },
}));
jest.mock('../lib/llm',            () => ({ invokeLLM:              jest.fn() }));
jest.mock('../lib/automationLog',  () => ({ writeAutomationLog:     jest.fn() }));
jest.mock('../lib/missionPlanner', () => ({ generateAgentMissions:  jest.fn() }));
jest.mock('../infra/logger', () => ({
  createLogger: jest.fn(() => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() })),
}));

const findUnique = prisma.businessProfile.findUnique as jest.Mock;
const update     = prisma.businessProfile.update     as jest.Mock;
const llm        = invokeLLM        as jest.Mock;
const autoLog    = writeAutomationLog as jest.Mock;

// createLogger is called at module-load time (once), so capture the instance
// in beforeAll — before clearMocks wipes mock.results between tests.
let logWarn: jest.Mock;
beforeAll(() => {
  const inst = (createLogger as jest.Mock).mock.results[0]?.value;
  logWarn = inst?.warn;
});

// ── Fixtures ───────────────────────────────────────────────────────────────────

const DB_PROFILE = {
  id: 'bp1', name: 'Test Biz',
  description: '', category: 'food', city: 'TLV',
  business_goal: '', price_tier: '',
};

const LLM_PROFILE = {
  sector_key: 'restaurant', sub_sector: 'italian',
  sector_label_he: 'מסעדה', business_type: 'B2C', service_model: 'walk_in',
  target_audience_he: 'משפחות',
  relevant_topics: [], irrelevant_topics: [], irrelevant_signal_types: [],
  competitor_type_he: '', content_themes_he: [], price_context_he: '',
  lead_urgency: 'medium', content_tone: 'friendly',
  seasonality_he: '', key_trust_signals_he: [],
};

// ── Helper — invoke the router with a minimal fake req/res ────────────────────

function post(body: Record<string, any>): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req: any = {
      method: 'POST',
      url: '/parse-profile',
      originalUrl: '/parse-profile',
      params: {},
      headers: {},
      body,
    };
    const res: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(data: any) { resolve({ statusCode: this.statusCode, body: data }); return this; },
    };
    router(req, res, (err?: any) =>
      err ? reject(err) : resolve({ statusCode: 200, body: null })
    );
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  findUnique.mockResolvedValue(DB_PROFILE);
  update.mockResolvedValue({});
  llm.mockResolvedValue(LLM_PROFILE);
  autoLog.mockResolvedValue(undefined);
});

describe('POST /parse-profile', () => {

  test('AC#1 + AC#3 happy path: persists sector_profile and writes success AutomationLog', async () => {
    const { body } = await post({
      businessProfileId: 'bp1',
      description: 'Italian restaurant in Tel Aviv',
      category: 'food',
      city: 'TLV',
      goal: 'grow',
      price_tier: 'mid',
    });

    expect(body.ok).toBe(true);
    expect(body.sector_profile).toMatchObject({ sector_key: 'restaurant' });

    // sector_profile persisted to DB
    const dbArg = update.mock.calls[0][0];
    const written = JSON.parse(dbArg.data.sector_profile);
    expect(written.sector_key).toBe('restaurant');
    expect(written._fallback).toBeUndefined();

    // AutomationLog: success, 1 item processed
    expect(autoLog).toHaveBeenCalledWith('parseProfile', 'bp1', expect.any(String), 1);
  });

  test('AC#2 + AC#3 LLM throws: fallback profile is persisted and AutomationLog records it', async () => {
    llm.mockRejectedValue(new Error('LLM timeout'));

    const { body } = await post({
      businessProfileId: 'bp1',
      description: 'A cafe',
      category: 'food',
      city: 'TLV',
    });

    // Still ok — onboarding must not break
    expect(body.ok).toBe(true);

    // Fallback written to DB with sentinel
    const dbArg = update.mock.calls[0][0];
    const written = JSON.parse(dbArg.data.sector_profile);
    expect(written._fallback).toBe(true);
    expect(written.sector_key).toBe('other');

    // AutomationLog: status='success' (profile WAS persisted), itemsProcessed=0, errorMessage explains fallback
    expect(autoLog).toHaveBeenCalledWith(
      'parseProfile', 'bp1', expect.any(String), 0, 'success',
      expect.stringContaining('fallback profile used'),
    );
  });

  test('AC#2 sparse input: logger.warn names every missing field', async () => {
    // DB profile also empty so the handler cannot fill gaps from stored values
    findUnique.mockResolvedValueOnce({
      ...DB_PROFILE, description: '', category: '', city: '', business_goal: '', price_tier: '',
    });
    await post({ businessProfileId: 'bp1' }); // body has no contextual fields

    expect(logWarn).toHaveBeenCalled();
    const msg: string = logWarn.mock.calls.find((c: string[]) =>
      c[0].includes('missing fields')
    )?.[0] ?? '';

    expect(msg).toContain('description');
    expect(msg).toContain('category');
    expect(msg).toContain('city');
    expect(msg).toContain('goal');
    expect(msg).toContain('price_tier');
  });

});
