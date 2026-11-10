// The language of a post/ad analysis follows the business it is for (business_profiles.locale).
const queryRaw = jest.fn();
jest.mock('../db', () => ({
  prisma: { $queryRawUnsafe: jest.fn(async () => [{ n: 1 }]), $queryRaw: (...a: any[]) => queryRaw(...a) },
}));
jest.mock('../lib/llm', () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/fetchImageBase64', () => ({
  fetchImageBase64: jest.fn(async () => ({ data: 'aGk=', mediaType: 'image/jpeg' })),
}));

import { invokeLLM } from '../lib/llm';
import { analyzePostCreative } from '../lib/analyzePostCreative';

const llm = invokeLLM as jest.Mock;
const HEBREW = /[֐-׿]/;
const post = (businessProfileId?: string) =>
  ({ caption: 'Two for one on Tuesdays', platform: 'instagram', mediaUrl: 'https://cdn.example/p.jpg', businessProfileId });

beforeEach(() => {
  llm.mockReset();
  // First call = the creative analysis (an offer), second = the offer breakdown.
  llm.mockResolvedValueOnce({ topic: 't', has_offer: true, offer_details: '2 for 1', visual_hooks: [], text_hooks: [], style: 's', has_cta: false, cta: null })
    .mockResolvedValueOnce({ offer_mechanic: 'bogo' });
});

it('an English business gets English prompts and an English system prompt on both calls', async () => {
  queryRaw.mockResolvedValue([{ locale: 'en-US', timezone: null }]);
  await analyzePostCreative(post('bp-en'));
  expect(llm).toHaveBeenCalledTimes(2);
  for (const [opts] of llm.mock.calls) {
    expect(opts.prompt).toContain('ALL string values must be in English');
    expect(opts.prompt).not.toMatch(HEBREW);
    expect(opts.systemPrompt).toContain('must be in English');
  }
});

it('a Hebrew business, or no business, keeps the Hebrew prompts and the default system prompt', async () => {
  queryRaw.mockResolvedValue([{ locale: null, timezone: null }]);
  await analyzePostCreative(post('bp-he'));
  await analyzePostCreative(post()); // mocks exhausted -> second run returns null after one call
  for (const [opts] of llm.mock.calls) {
    expect(opts.prompt).toContain('ALL string values must be in Hebrew');
    expect(opts.prompt).toMatch(HEBREW);
    expect(opts.systemPrompt).toBeUndefined();
  }
  expect(llm.mock.calls.length).toBeGreaterThanOrEqual(3);
});

it('falls back to Hebrew when the locale lookup fails', async () => {
  queryRaw.mockRejectedValue(new Error('column "locale" does not exist'));
  await analyzePostCreative(post('bp-broken'));
  expect(llm.mock.calls[0][0].prompt).toContain('ALL string values must be in Hebrew');
});
