import { autoConfigOsint } from '../routes/functions/stubs';
import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';

jest.mock('../db', () => ({
  prisma: {
    businessProfile: {
      findUnique: jest.fn(),
      update:     jest.fn(),
    },
  },
}));
jest.mock('../lib/llm',    () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/tavily', () => ({
  isTavilyRateLimited: jest.fn(() => true), // skip live Tavily in tests
  tavilySearch:        jest.fn(() => Promise.resolve([])),
}));

const findUnique = prisma.businessProfile.findUnique as jest.Mock;
const update     = prisma.businessProfile.update     as jest.Mock;
const llm        = invokeLLM                          as jest.Mock;

const PROFILE = {
  id: 'bp1', name: 'פיצה רומא', category: 'מסעדה', city: 'תל אביב',
  relevant_services: 'פיצה, פסטה',
  website_url: null, facebook_url: null, instagram_url: null, tiktok_url: null,
  created_by: 'user1',
};

const LLM_OK = {
  keywords: ['פיצה תל אביב', 'מסעדה איטלקית', 'משלוח פיצה'],
};

function call(body: Record<string, any>) {
  return new Promise<{ statusCode: number; body: any }>((resolve) => {
    const req: any = { body };
    const res: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(data: any) { resolve({ statusCode: this.statusCode, body: data }); return this; },
    };
    autoConfigOsint(req, res);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  findUnique.mockResolvedValue(PROFILE);
  update.mockResolvedValue({});
  llm.mockResolvedValue(LLM_OK);
});

describe('autoConfigOsint', () => {

  test('AC#1 happy path: persists keywords and curated URLs, does not create competitors', async () => {
    const { statusCode, body } = await call({ businessProfileId: 'bp1' });

    expect(statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.keywords_count).toBe(3);
    expect(body.competitors_created).toBeUndefined();

    const { data } = update.mock.calls[0][0];
    expect(data.custom_keywords).toBe('פיצה תל אביב, מסעדה איטלקית, משלוח פיצה');
    expect(data.custom_urls).toBeTruthy();

    // No prisma.competitor.* calls at all — competitor discovery is runCompetitorIdentification's job.
    expect((prisma as any).competitor).toBeUndefined();
  });

  test('AC#2 null LLM result: curated URLs still persisted, no crash, warns', async () => {
    llm.mockResolvedValue(null);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { statusCode, body } = await call({ businessProfileId: 'bp1' });

    expect(statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.keywords_count).toBe(0);

    const { data } = update.mock.calls[0][0];
    expect(data.custom_keywords).toBe('');
    expect(data.custom_urls).toBeTruthy(); // curated list still written

    expect(warnSpy.mock.calls[0][0]).toContain('[autoConfigOsint]');
    warnSpy.mockRestore();
  });

  test('AC#2 LLM throws: curated URLs still persisted, no crash, warns', async () => {
    llm.mockRejectedValue(new Error('API timeout'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { statusCode, body } = await call({ businessProfileId: 'bp1' });

    expect(statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.keywords_count).toBe(0);

    const { data } = update.mock.calls[0][0];
    expect(data.custom_urls).toBeTruthy(); // curated list still written

    expect(warnSpy.mock.calls[0][0]).toContain('[autoConfigOsint]');
    warnSpy.mockRestore();
  });

});
