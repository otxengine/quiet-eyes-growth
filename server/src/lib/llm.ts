import Anthropic from '@anthropic-ai/sdk';
import { cacheGet, cacheSet, TTL, hashPrompt } from './agentCache';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

export interface LLMOptions {
  response_json_schema?: any;
  model?: string;    // 'haiku' | 'sonnet' | 'opus' or full model ID
  maxTokens?: number; // override default
  skipCache?: boolean; // set true only for real-time / user-facing calls
}

const MODEL_MAP: Record<string, string> = {
  haiku:  'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-6',
};

// Hard output caps per model — keeps token burn predictable
const MAX_TOKENS_DEFAULT: Record<string, number> = {
  haiku:  350,
  sonnet: 900,  // raised: most sonnet calls need 600-900 for quality output
  opus:   1200,
};

/**
 * Drop-in replacement for base44 InvokeLLM.
 * Returns parsed JSON if response_json_schema is provided, otherwise raw text.
 * model: 'haiku' (fast, cheap — DEFAULT), 'sonnet' (analysis), 'opus' (deep)
 * Automatically falls back to OpenAI GPT-4o-mini when Anthropic fails.
 * Caches responses for 4 hours to avoid duplicate AI calls across pipeline runs.
 */
export async function invokeLLM(options: { prompt: string } & LLMOptions): Promise<any> {
  const { prompt, response_json_schema, model, maxTokens: maxTokensOverride, skipCache } = options;

  const modelKey = model || 'haiku'; // default to Haiku (cheapest)
  const modelId = MODEL_MAP[modelKey] || model || 'claude-haiku-4-5-20251001';
  const maxTokens = maxTokensOverride ?? MAX_TOKENS_DEFAULT[modelKey] ?? 350;

  // ── LLM response cache (4h TTL) ───────────────────────────────────────────
  if (!skipCache) {
    const cacheKey = `llm:${modelKey}:${hashPrompt(prompt)}`;
    const cached = cacheGet(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const result = await _invokeLLMRaw(prompt, modelId, maxTokens, response_json_schema);
    cacheSet(cacheKey, result, TTL.LLM_RESPONSE);
    return result;
  }

  return _invokeLLMRaw(prompt, modelId, maxTokens, response_json_schema);
}

async function _invokeLLMRaw(
  prompt: string,
  modelId: string,
  maxTokens: number,
  response_json_schema: any,
): Promise<any> {

  // Try Anthropic first
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await _callAnthropic(prompt, modelId, maxTokens, response_json_schema);
    } catch (err: any) {
      console.warn('[invokeLLM] Anthropic failed, trying OpenAI fallback:', err.message);
    }
  }

  // Fallback: OpenAI GPT-4o-mini (cheaper than GPT-4o)
  if (process.env.OPENAI_API_KEY) {
    try {
      return await _callOpenAI(prompt, response_json_schema, maxTokens);
    } catch (err: any) {
      console.warn('[invokeLLM] OpenAI fallback also failed:', err.message);
    }
  }

  throw new Error('No AI provider available — set ANTHROPIC_API_KEY or OPENAI_API_KEY');
}

async function _callAnthropic(
  prompt: string,
  modelId: string,
  maxTokens: number,
  response_json_schema: any,
): Promise<any> {

  const systemPrompt = response_json_schema
    ? 'You are a JSON-only assistant. Respond with a single valid JSON object only. No preamble, no explanation, no markdown fences. ALL string values must be in Hebrew unless the field explicitly requires English.'
    : 'You are a helpful assistant.';

  // Assistant prefill: inject opening brace so Claude MUST continue with valid JSON
  const messages: Anthropic.MessageParam[] = response_json_schema
    ? [{ role: 'user', content: prompt }, { role: 'assistant', content: '{' }]
    : [{ role: 'user', content: prompt }];

  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  const rawText = ((response.content || [])[0] as any)?.text || '';

  if (response_json_schema) {
    // Prepend the prefilled '{' that we injected
    const text = '{' + rawText;
    console.log('[LLM] Anthropic raw (300 chars):', text.substring(0, 300), '| stop_reason:', response.stop_reason);
    const parsed = _parseJson(text);
    if (!parsed) console.error('[LLM] _parseJson failed on above text');
    return parsed;
  }
  return rawText;
}

async function _callOpenAI(prompt: string, response_json_schema: any, maxTokens = 1600): Promise<any> {
  const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
  const messages: any[] = [
    {
      role: 'system',
      content: response_json_schema
        ? 'You are a helpful assistant. Return ONLY valid JSON. No markdown, no explanation. ALL string values must be in Hebrew.'
        : 'You are a helpful assistant.',
    },
    { role: 'user', content: prompt },
  ];

  const body: any = {
    model: 'gpt-4o-mini',
    max_tokens: maxTokens,
    temperature: 0.3,
    messages,
  };
  if (response_json_schema) body.response_format = { type: 'json_object' };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    throw new Error(`OpenAI GPT-4o ${res.status}: ${err.error?.message || res.statusText}`);
  }

  const data: any = await res.json();
  const text = data.choices?.[0]?.message?.content || '';

  if (response_json_schema) {
    return _parseJson(text);
  }
  return text;
}

function _parseJson(text: string): any {
  const clean = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(clean); } catch {}
  // Try extracting object or array
  const objMatch = clean.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch {} }
  const arrMatch = clean.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch {} }
  // Last resort: try to close truncated JSON by appending closing brackets
  if (clean.startsWith('{')) {
    const openBraces = (clean.match(/\{/g) || []).length;
    const closeBraces = (clean.match(/\}/g) || []).length;
    const missing = openBraces - closeBraces;
    if (missing > 0) {
      const patched = clean.trimEnd().replace(/,\s*$/, '') + '}'.repeat(missing);
      try { return JSON.parse(patched); } catch {}
    }
  }
  console.warn('[_parseJson] Failed to parse LLM output, first 200 chars:', clean.substring(0, 200));
  return null;
}
