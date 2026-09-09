/**
 * Unit tests — llm.ts OpenRouter integration.
 * Covers: fallback-array construction per short key, JSON mode, vision content
 * ordering, prompt-cache header, both OpenRouter failure modes (HTTP-level and
 * embedded finish_reason on a 200), and the cost-accounting rewrite that reads
 * OpenRouter's real usage.cost instead of a hardcoded price table.
 */

import { invokeLLM, startCostTracking, popCost } from '../lib/llm';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

function mockOpenRouterResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OPENROUTER_API_KEY = 'test-key';
});

test('sends the right fallback models array for a short key', async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({
    choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
    model: 'anthropic/claude-haiku-4.5',
    usage: { cost: 0.001 },
  }));

  await invokeLLM({ prompt: 'hello', model: 'haiku', skipCache: true });

  const body = JSON.parse(mockFetch.mock.calls[0][1].body);
  expect(body.models).toEqual(['anthropic/claude-haiku-4.5', 'google/gemini-3.5-flash', 'openai/gpt-4o-mini']);
});

test('sets response_format when response_json_schema is passed, and parses the result', async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({
    choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }],
    model: 'anthropic/claude-haiku-4.5',
    usage: { cost: 0.001 },
  }));

  const result = await invokeLLM({ prompt: 'hello', model: 'haiku', skipCache: true, response_json_schema: { type: 'object' } });

  const body = JSON.parse(mockFetch.mock.calls[0][1].body);
  expect(body.response_format).toEqual({ type: 'json_object' });
  expect(result).toEqual({ a: 1 });
});

test('vision: text content part comes before the image content part', async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({
    choices: [{ message: { content: 'a description' }, finish_reason: 'stop' }],
    model: 'anthropic/claude-haiku-4.5',
    usage: { cost: 0.001 },
  }));

  await invokeLLM({ prompt: 'describe', model: 'haiku', skipCache: true, imageBase64: 'AAAA', imageMediaType: 'image/png' });

  const body = JSON.parse(mockFetch.mock.calls[0][1].body);
  const userContent = body.messages[1].content;
  expect(userContent[0].type).toBe('text');
  expect(userContent[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
});

test('cache_control is set only when usePromptCache AND systemPrompt are both present', async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    model: 'anthropic/claude-haiku-4.5',
    usage: { cost: 0.001 },
  }));

  await invokeLLM({ prompt: 'hello', model: 'haiku', skipCache: true, usePromptCache: true, systemPrompt: 'you are a bot' });
  expect(JSON.parse(mockFetch.mock.calls[0][1].body).cache_control).toEqual({ type: 'ephemeral' });

  mockFetch.mockClear();
  await invokeLLM({ prompt: 'hello', model: 'haiku', skipCache: true, usePromptCache: true }); // no systemPrompt
  expect(JSON.parse(mockFetch.mock.calls[0][1].body).cache_control).toBeUndefined();
});

test("throws with OpenRouter's error message on HTTP failure", async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({ error: { message: 'rate limited' } }, false, 429));

  await expect(invokeLLM({ prompt: 'hello', model: 'haiku', skipCache: true }))
    .rejects.toThrow('OpenRouter 429: rate limited');
});

test('throws on an embedded provider error even with HTTP 200', async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({
    choices: [{ message: { content: '' }, finish_reason: 'error', error: { message: 'provider disconnected' } }],
  }));

  await expect(invokeLLM({ prompt: 'hello', model: 'haiku', skipCache: true }))
    .rejects.toThrow('OpenRouter provider error: provider disconnected');
});

test('popCost accumulates usage.cost from the OpenRouter response', async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    model: 'anthropic/claude-haiku-4.5',
    usage: { cost: 0.0042 },
  }));

  startCostTracking('biz-1');
  await invokeLLM({ prompt: 'hello', model: 'haiku', skipCache: true, costTrackingId: 'biz-1' });
  expect(popCost('biz-1')).toBeCloseTo(0.0042);
});

test('missing usage.cost (e.g. BYOK) does not throw and leaves cost unaccumulated', async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    model: 'anthropic/claude-haiku-4.5',
    usage: {}, // no cost field
  }));

  startCostTracking('biz-2');
  await invokeLLM({ prompt: 'hello', model: 'haiku', skipCache: true, costTrackingId: 'biz-2' });
  expect(popCost('biz-2')).toBe(0);
});
