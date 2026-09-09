/**
 * Unit tests — ai_router.ts OpenRouter integration.
 * Covers: fallback-array construction per task, JSON-mode system-prompt
 * injection, both OpenRouter failure modes (HTTP-level and embedded
 * finish_reason on a 200), and that no client-side fallback retry was
 * silently reintroduced (OpenRouter's models[] array does that server-side).
 */

import { callAI, callAIJson } from '../lib/ai_router';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

function mockOpenRouterResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OPENROUTER_API_KEY = 'test-key';
});

test('sends the configured fallback array for an anthropic-primary task', async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
  }));

  await callAI('classify_intent', 'hello');

  const body = JSON.parse(mockFetch.mock.calls[0][1].body);
  expect(body.models).toEqual(['anthropic/claude-haiku-4.5', 'google/gemini-3.5-flash', 'openai/gpt-4o-mini']);
});

test('sends the configured fallback array for an openai-primary task', async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
  }));

  await callAI('generate_post', 'hello');

  const body = JSON.parse(mockFetch.mock.calls[0][1].body);
  expect(body.models).toEqual(['openai/gpt-4o', 'google/gemini-3.5-flash', 'anthropic/claude-haiku-4.5']);
});

test('sends the configured fallback array for a gemini-primary task', async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
  }));

  await callAI('page_parsing', 'hello');

  const body = JSON.parse(mockFetch.mock.calls[0][1].body);
  expect(body.models).toEqual(['google/gemini-3.5-flash', 'openai/gpt-4o-mini', 'anthropic/claude-haiku-4.5']);
});

test('jsonMode with no systemPrompt injects the hardcoded JSON instruction and sets response_format', async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({
    choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
  }));

  await callAI('classify_intent', 'hello', { jsonMode: true });

  const body = JSON.parse(mockFetch.mock.calls[0][1].body);
  expect(body.messages[0]).toEqual({ role: 'system', content: 'Return ONLY valid JSON. No markdown, no explanation.' });
  expect(body.response_format).toEqual({ type: 'json_object' });
});

test('jsonMode with a caller systemPrompt uses the caller prompt verbatim', async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({
    choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
  }));

  await callAI('classify_intent', 'hello', { jsonMode: true, systemPrompt: 'custom system prompt' });

  const body = JSON.parse(mockFetch.mock.calls[0][1].body);
  expect(body.messages[0]).toEqual({ role: 'system', content: 'custom system prompt' });
});

test('no jsonMode and no systemPrompt sends no system message at all', async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({
    choices: [{ message: { content: 'plain text' }, finish_reason: 'stop' }],
  }));

  await callAI('generate_post', 'hello');

  const body = JSON.parse(mockFetch.mock.calls[0][1].body);
  expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
});

test("throws with OpenRouter's error message on HTTP failure", async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({ error: { message: 'rate limited' } }, false, 429));

  await expect(callAI('classify_intent', 'hello')).rejects.toThrow('OpenRouter 429: rate limited');
});

test('throws on an embedded provider error even with HTTP 200', async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({
    choices: [{ message: { content: '' }, finish_reason: 'error', error: { message: 'provider disconnected' } }],
  }));

  await expect(callAI('classify_intent', 'hello')).rejects.toThrow('OpenRouter provider error: provider disconnected');
});

test('does not perform a client-side second attempt on failure (OpenRouter fallback is server-side only)', async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({ error: { message: 'down' } }, false, 500));

  await expect(callAI('classify_intent', 'hello')).rejects.toThrow();
  expect(mockFetch.mock.calls.length).toBe(1);
});

test('callAIJson strips fences and parses the response end-to-end', async () => {
  mockFetch.mockResolvedValue(mockOpenRouterResponse({
    choices: [{ message: { content: '```json\n{"a":1}\n```' }, finish_reason: 'stop' }],
  }));

  const result = await callAIJson<{ a: number }>('classify_intent', 'hello');
  expect(result).toEqual({ a: 1 });
});
