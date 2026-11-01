/**
 * Spend guards in lib/analyzePostCreative: posts older than MAX_POST_AGE_DAYS are skipped
 * before any download or LLM call, and a per-day counter (ai_daily_usage) caps analyses.
 * A backlog of old posts drained the whole OpenRouter balance on 2026-10-25.
 */
jest.mock('../db', () => ({ prisma: { $queryRawUnsafe: jest.fn() } }));
jest.mock('../lib/llm', () => ({ invokeLLM: jest.fn(async () => ({})) }));
jest.mock('../lib/fetchImageBase64', () => ({
  fetchImageBase64: jest.fn(async () => ({ data: 'aGk=', mediaType: 'image/jpeg' })),
}));

import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';
import { fetchImageBase64 } from '../lib/fetchImageBase64';
import { analyzePostCreative, MAX_POST_AGE_DAYS } from '../lib/analyzePostCreative';

const counter = prisma.$queryRawUnsafe as jest.Mock;
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
const post = (postedAt?: Date | null) =>
  ({ caption: 'x', platform: 'instagram', mediaUrl: 'https://cdn.example/p.jpg', postedAt });

beforeEach(() => counter.mockResolvedValue([{ n: 1 }]));

it(`skips posts older than ${MAX_POST_AGE_DAYS} days without downloading, counting or calling the LLM`, async () => {
  expect(await analyzePostCreative(post(daysAgo(MAX_POST_AGE_DAYS + 10)))).toBeNull();
  expect(counter).not.toHaveBeenCalled();
  expect(fetchImageBase64).not.toHaveBeenCalled();
  expect(invokeLLM).not.toHaveBeenCalled();
});

it('analyzes a recent post and takes one daily slot', async () => {
  await analyzePostCreative(post(daysAgo(2)));
  expect(counter).toHaveBeenCalledTimes(1);
  expect(counter.mock.calls[0][0]).toContain('ai_daily_usage');
  expect(invokeLLM).toHaveBeenCalledTimes(1);
});

it('stops at the daily cap (default 150) before any download', async () => {
  counter.mockResolvedValue([{ n: 151 }]);
  expect(await analyzePostCreative(post(daysAgo(1)))).toBeNull();
  expect(fetchImageBase64).not.toHaveBeenCalled();
  expect(invokeLLM).not.toHaveBeenCalled();
});

it('skips (bounded spend) when the counter cannot be reached', async () => {
  counter.mockRejectedValue(new Error('relation "ai_daily_usage" does not exist'));
  expect(await analyzePostCreative(post(daysAgo(1)))).toBeNull();
  expect(invokeLLM).not.toHaveBeenCalled();
});

it('still analyzes undated items (stories, running ads), under the cap', async () => {
  await analyzePostCreative(post(undefined));
  expect(counter).toHaveBeenCalledTimes(1);
  expect(invokeLLM).toHaveBeenCalledTimes(1);
});
