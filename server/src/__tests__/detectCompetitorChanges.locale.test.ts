// The "changes detected" lines of the report: search queries, the LLM prompt and the stored signal
// follow the business's language.
const locale = jest.fn();
jest.mock('../lib/businessLocale', () => ({ businessLocale: (...a: any[]) => locale(...a) }));
jest.mock('../lib/llm', () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn() }));
jest.mock('../lib/businessContext', () => ({ loadBusinessContext: jest.fn(async () => null) }));
jest.mock('../db', () => ({
  prisma: {
    competitor: { findMany: jest.fn(async () => [{ id: 'c1', name: 'Rival Pizza' }]), update: jest.fn(async () => ({})) },
    marketSignal: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})) },
  },
}));

process.env.TAVILY_API_KEY = 'test-key';
import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';
import { detectCompetitorChanges } from '../routes/functions/detectCompetitorChanges';

const HEBREW = /[֐-׿]/;
const llm = invokeLLM as jest.Mock;
const create = prisma.marketSignal.create as jest.Mock;
const queries: string[] = [];
const res = () => { const r: any = { json: jest.fn(() => r), status: jest.fn(() => r) }; return r; };

beforeEach(() => {
  queries.length = 0;
  create.mockClear();
  llm.mockReset().mockResolvedValue({
    changes_found: true, new_promotion: { found: true, summary: '20% off lunch' }, overall_summary: 'started a lunch discount',
  });
  (global as any).fetch = jest.fn(async (_url: string, init: any) => {
    queries.push(JSON.parse(init.body).query);
    return { ok: true, json: async () => ({ results: [{ url: 'https://example.com', title: 't', content: 'c' }] }) };
  });
});

it('an English business searches, analyses and stores in English', async () => {
  locale.mockResolvedValue({ lang: 'en', intl: 'en-US', tz: 'America/New_York' });
  await detectCompetitorChanges({ body: { businessProfileId: 'b1' } } as any, res());

  expect(queries).toHaveLength(4);
  queries.forEach(q => expect(q).not.toMatch(HEBREW));
  const opts = llm.mock.calls[0][0];
  expect(opts.prompt).toContain('ALL string values must be in English');
  expect(opts.systemPrompt).toContain('must be in English');

  const signal = create.mock.calls[0][0].data;
  expect(signal.summary).toBe('Change at Rival Pizza: started a lunch discount');
  expect(signal.category).toBe('competitor_move');
  expect(JSON.stringify(signal)).not.toMatch(HEBREW);
});

it('a Hebrew business is unchanged', async () => {
  locale.mockResolvedValue({ lang: 'he', intl: 'he-IL', tz: 'Asia/Jerusalem' });
  await detectCompetitorChanges({ body: { businessProfileId: 'b1' } } as any, res());

  expect(queries[0]).toBe('"Rival Pizza" מבצע הנחה חדש');
  const opts = llm.mock.calls[0][0];
  expect(opts.prompt).toContain('ALL string values must be in Hebrew');
  expect(opts.systemPrompt).toBeUndefined();
  expect(create.mock.calls[0][0].data.summary).toBe('שינוי אצל Rival Pizza: started a lunch discount');
});
