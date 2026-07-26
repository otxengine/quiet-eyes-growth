import { learnFromWebsite } from '../routes/functions/stubs';
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
jest.mock('../lib/llm', () => ({ invokeLLM: jest.fn() }));

const findUnique = prisma.businessProfile.findUnique as jest.Mock;
const update     = prisma.businessProfile.update     as jest.Mock;
const llm        = invokeLLM                          as jest.Mock;

const PROFILE = {
  id: 'bp1', name: 'פיצה רומא', category: 'מסעדה', city: 'תל אביב',
  description: null, target_market: null, relevant_services: null, custom_keywords: null,
};

const LLM_OK = {
  description: 'פיצה איטלקית אותנטית',
  services: ['פיצה', 'פסטה'],
  keywords: ['פיצה תל אביב', 'מסעדה איטלקית'],
  target_market: 'משפחות וצעירים',
  tone: 'casual',
};

function call(body: Record<string, any>) {
  return new Promise<{ statusCode: number; body: any }>((resolve) => {
    const req: any = { body };
    const res: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(data: any) { resolve({ statusCode: this.statusCode, body: data }); return this; },
    };
    learnFromWebsite(req, res);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  findUnique.mockResolvedValue(PROFILE);
  update.mockResolvedValue({});
  llm.mockResolvedValue(LLM_OK);
  // Default: fetch succeeds with minimal HTML
  global.fetch = jest.fn().mockResolvedValue({
    text: () => Promise.resolve('<html><body>Great pizza</body></html>'),
  }) as any;
});

describe('learnFromWebsite', () => {

  test('AC1: persists website context to profile when website_url provided', async () => {
    const { statusCode, body } = await call({ businessProfileId: 'bp1', websiteUrl: 'https://example.com' });

    expect(statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.services_found).toBe(2);
    expect(body.keywords_added).toBe(2);

    const { data } = update.mock.calls[0][0];
    expect(data.description).toBe('פיצה איטלקית אותנטית');
    expect(data.target_market).toBe('משפחות וצעירים');
    expect(data.relevant_services).toBe('פיצה, פסטה');
    expect(data.custom_keywords).toContain('פיצה תל אביב');
  });

  test('AC2: returns success:false immediately when websiteUrl is absent — no DB write', async () => {
    const { statusCode, body } = await call({ businessProfileId: 'bp1' });

    expect(statusCode).toBe(200);
    expect(body.success).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(llm).not.toHaveBeenCalled();
  });

  test('AC2: returns success:false when businessProfileId is absent — no DB write', async () => {
    const { body } = await call({ websiteUrl: 'https://example.com' });
    expect(body.success).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  test('AC3: fetch timeout/failure — logs error, falls back to profile text, still processes via LLM', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { body } = await call({ businessProfileId: 'bp1', websiteUrl: 'https://unreachable.example' });

    // logs the fetch failure (AC3 explicit requirement)
    expect(errorSpy.mock.calls[0][0]).toContain('[learnFromWebsite] fetch failed:');

    // LLM still runs with fallback text; profile context is persisted
    expect(llm).toHaveBeenCalled();
    expect(body.success).toBe(true);

    errorSpy.mockRestore();
  });

  test('AC3: onboarding not blocked — returns success:false (not a throw) when profile missing', async () => {
    findUnique.mockResolvedValue(null);
    const { statusCode, body } = await call({ businessProfileId: 'bp-unknown', websiteUrl: 'https://example.com' });
    expect(statusCode).toBe(404);
    expect(body.error).toBeDefined();
  });

  test('AC3: LLM failure — returns success:false without throwing', async () => {
    llm.mockRejectedValue(new Error('LLM timeout'));
    const { body } = await call({ businessProfileId: 'bp1', websiteUrl: 'https://example.com' });
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });

});
