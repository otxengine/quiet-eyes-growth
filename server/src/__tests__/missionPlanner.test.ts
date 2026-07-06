import { generateAgentMissions, getAgentMission } from '../lib/missionPlanner';
import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';
import { createLogger } from '../infra/logger';

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../db', () => ({
  prisma: {
    businessProfile: {
      findUnique: jest.fn(),
      update:     jest.fn(),
    },
    sectorKnowledge: {
      findFirst: jest.fn(),
    },
  },
}));
jest.mock('../lib/llm', () => ({ invokeLLM: jest.fn() }));
jest.mock('../infra/logger', () => ({
  createLogger: jest.fn(() => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() })),
}));

// GPT-4o fetch is called inside callGPT4o — stub it globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

const findUnique = prisma.businessProfile.findUnique as jest.Mock;
const update     = prisma.businessProfile.update     as jest.Mock;
const llm        = invokeLLM as jest.Mock;
const skFindFirst = prisma.sectorKnowledge.findFirst as jest.Mock;

// ── Fixtures ───────────────────────────────────────────────────────────────────

const SECTOR_PROFILE = JSON.stringify({
  sub_sector: 'italian_restaurant',
  sector_label_he: 'מסעדה',
  business_type: 'B2C',
  service_model: 'walk_in',
  target_audience_he: 'משפחות',
  relevant_topics: ['pasta', 'pizza'],
  irrelevant_topics: [],
  competitor_type_he: 'מסעדות שכונתיות',
  lead_urgency: 'medium',
  content_tone: 'friendly',
  content_themes_he: [],
  price_context_he: '',
  key_trust_signals_he: [],
  seasonality_he: '',
});

const DB_PROFILE = {
  id: 'bp1',
  name: 'Bella Italia',
  city: 'Tel Aviv',
  description: 'Authentic Italian restaurant',
  business_goal: 'grow',
  price_tier: 'mid',
  customer_sources: 'walk-in',
  category: 'restaurant',
  sector_profile: SECTOR_PROFILE,
  agent_missions: null,
};

const STRATEGIC_RESPONSE = {
  generated_at: '2026-06-26T00:00:00.000Z',
  business_summary: 'תקציר',
  collectWebSignals: {
    priority_queries_en: ['italian restaurant Tel Aviv', 'pasta delivery Tel Aviv'],
    priority_sources: ['rest.co.il'],
    include_topics: ['food', 'restaurant'],
    exclude_topics: ['sports'],
  },
  runIntelligenceEngines: {
    market_context_he: 'שוק המסעדות בתל אביב',
    watch_signals_he: ['טרנד פסטה'],
    ignore_signals_he: [],
  },
};

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  findUnique.mockResolvedValue(DB_PROFILE);
  update.mockResolvedValue({});
  llm.mockResolvedValue(STRATEGIC_RESPONSE);
  skFindFirst.mockResolvedValue(null);
  // GPT-4o call — return valid JSON
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ post_hooks_he: ['hook1'] }) } }],
    }),
  });
});

describe('generateAgentMissions', () => {

  test('AC#1 happy path: persists agent_missions with priority_queries_en', async () => {
    const result = await generateAgentMissions('bp1');

    expect(result).not.toBeNull();

    // DB update was called
    expect(update).toHaveBeenCalledTimes(1);
    const dbArg = update.mock.calls[0][0];
    expect(dbArg.where).toEqual({ id: 'bp1' });

    // Persisted payload contains priority_queries_en
    const persisted = JSON.parse(dbArg.data.agent_missions);
    expect(Array.isArray(persisted.collectWebSignals?.priority_queries_en)).toBe(true);
    expect(persisted.collectWebSignals.priority_queries_en.length).toBeGreaterThan(0);
    expect(persisted.collectWebSignals.priority_queries_en[0]).toBe('italian restaurant Tel Aviv');
  });

  test('AC#1 sector_profile is used: buildStrategicPrompt receives sp fields', async () => {
    await generateAgentMissions('bp1');

    // invokeLLM was called with a prompt that embeds sector-specific content
    const promptArg: string = llm.mock.calls[0][0].prompt;
    expect(promptArg).toContain('italian_restaurant');
    expect(promptArg).toContain('משפחות');
  });

  test('AC#1 guard: returns null and skips DB write when LLM omits priority_queries_en', async () => {
    llm.mockResolvedValue({ business_summary: 'no collectWebSignals key at all' });

    const result = await generateAgentMissions('bp1');

    expect(result).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  test('AC#2 prompt template uses canonical key runIntelligenceEngines', async () => {
    await generateAgentMissions('bp1');

    const promptArg: string = llm.mock.calls[0][0].prompt;
    expect(promptArg).toContain('runIntelligenceEngines');
    expect(promptArg).not.toContain('runMarketIntelligence');
  });

  test('AC#2 persisted blob uses canonical key runIntelligenceEngines, not legacy', async () => {
    const result = await generateAgentMissions('bp1');

    expect(result).not.toBeNull();
    const dbArg = update.mock.calls[0][0];
    const persisted = JSON.parse(dbArg.data.agent_missions);
    expect(persisted).toHaveProperty('runIntelligenceEngines');
    expect(persisted).not.toHaveProperty('runMarketIntelligence');
  });

  test('AC#1 guard: returns null when priority_queries_en is an empty array', async () => {
    llm.mockResolvedValue({
      ...STRATEGIC_RESPONSE,
      collectWebSignals: { priority_queries_en: [] },
    });

    const result = await generateAgentMissions('bp1');

    expect(result).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  test('returns null when both LLM calls fail', async () => {
    llm.mockRejectedValue(new Error('LLM down'));
    mockFetch.mockRejectedValue(new Error('OpenAI down'));

    const result = await generateAgentMissions('bp1');

    expect(result).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  test('returns null when profile does not exist', async () => {
    findUnique.mockResolvedValue(null);

    const result = await generateAgentMissions('bp1');

    expect(result).toBeNull();
    expect(llm).not.toHaveBeenCalled();
  });

});

describe('getAgentMission — backward-compat (KAN-56)', () => {

  test('resolves canonical key from new missions blob', () => {
    const profile = {
      agent_missions: JSON.stringify({ runIntelligenceEngines: { market_context_he: 'new' } }),
    };
    expect(getAgentMission(profile, 'runIntelligenceEngines')).toEqual({ market_context_he: 'new' });
  });

  test('falls back to legacy key for old agent_missions blobs', () => {
    const profile = {
      agent_missions: JSON.stringify({ runMarketIntelligence: { market_context_he: 'old' } }),
    };
    expect(getAgentMission(profile, 'runIntelligenceEngines')).toEqual({ market_context_he: 'old' });
  });

  test('returns null when neither key is present', () => {
    const profile = { agent_missions: JSON.stringify({ collectWebSignals: {} }) };
    expect(getAgentMission(profile, 'runIntelligenceEngines')).toBeNull();
  });

});
