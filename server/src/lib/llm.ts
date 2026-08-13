import Anthropic from '@anthropic-ai/sdk';
import { cacheGet, cacheSet, TTL, hashPrompt } from './agentCache';
import { buildAgentPromptContext } from './businessProfile';
import { callGemini } from './gemini';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

// ── LLM cost tracking (per-business accumulator, keyed by businessId) ─────────
const _costAccumulator = new Map<string, number>();
// Pricing per 1M tokens (input / output)
const _PRICE: Record<string, [number, number]> = {
  'claude-haiku-4-5-20251001': [0.80,  4.00],
  'claude-sonnet-4-6':         [3.00, 15.00],
  'claude-opus-4-6':           [15.00, 75.00],
};
export function startCostTracking(id: string) { _costAccumulator.set(id, 0); }
export function popCost(id: string): number {
  const c = _costAccumulator.get(id) ?? 0;
  _costAccumulator.delete(id);
  return c;
}
function _addCost(id: string | undefined, modelId: string, inputTokens: number, outputTokens: number) {
  if (!id) return;
  const [pIn, pOut] = _PRICE[modelId] ?? [1.00, 5.00];
  const usd = (inputTokens / 1e6) * pIn + (outputTokens / 1e6) * pOut;
  _costAccumulator.set(id, (_costAccumulator.get(id) ?? 0) + usd);
}

export interface LLMOptions {
  response_json_schema?: any;
  model?: string;    // 'haiku' | 'sonnet' | 'opus' or full model ID
  maxTokens?: number; // override default
  skipCache?: boolean; // set true only for real-time / user-facing calls
  /**
   * When provided, automatically prepends the AI-parsed sector + mission context block
   * before the prompt. Every agent that passes profile gets deep business-awareness for free.
   */
  profile?: {
    name: string;
    category: string;
    city: string;
    description?: string | null;
    sector_profile?: string | null;
    business_goal?: string | null;
    price_tier?: string | null;
  };
  /**
   * Pass a separate system prompt. When combined with usePromptCache, the system
   * prompt is sent with Anthropic cache_control so it's cached for 5 min (80% token savings).
   */
  systemPrompt?: string;
  /**
   * Enable Anthropic prompt caching on the system prompt block (requires systemPrompt).
   * Only applies to Claude models. Cuts input token cost ~80% for repeat callers.
   */
  usePromptCache?: boolean;
  costTrackingId?: string;
  /**
   * Optional image to send alongside the prompt (vision). Anthropic and Gemini
   * both support it; the OpenAI fallback ignores it (text-only last resort).
   */
  imageBase64?: string;
  imageMediaType?: string; // e.g. 'image/jpeg' — defaults to 'image/jpeg'
}

const MODEL_MAP: Record<string, string> = {
  haiku:         'claude-haiku-4-5-20251001',
  sonnet:        'claude-sonnet-4-6',
  opus:          'claude-opus-4-6',
  'gemini-flash': 'gemini-3.5-flash',
  'gemini-pro':   'gemini-3-pro-image',
};

// Hard output caps per model — keeps token burn predictable
const MAX_TOKENS_DEFAULT: Record<string, number> = {
  haiku:         600,   // raised: 350 was too low for structured JSON
  sonnet:        1400,  // raised: complex agent outputs need more room
  opus:          2000,
  'gemini-flash': 800,
  'gemini-pro':   2000,
};

/**
 * Drop-in replacement for base44 InvokeLLM.
 * Returns parsed JSON if response_json_schema is provided, otherwise raw text.
 * model: 'haiku' (fast, cheap — DEFAULT), 'sonnet' (analysis), 'opus' (deep)
 * Automatically falls back to OpenAI GPT-4o-mini when Anthropic fails.
 * Caches responses for 4 hours to avoid duplicate AI calls across pipeline runs.
 */
export async function invokeLLM(options: { prompt: string } & LLMOptions): Promise<any> {
  const { prompt, response_json_schema, model, maxTokens: maxTokensOverride, skipCache, profile, systemPrompt, usePromptCache, costTrackingId, imageBase64, imageMediaType } = options;

  const modelKey = model || 'haiku'; // default to Haiku (cheapest)
  const modelId = MODEL_MAP[modelKey] || model || 'claude-haiku-4-5-20251001';
  const maxTokens = maxTokensOverride ?? MAX_TOKENS_DEFAULT[modelKey] ?? 350;

  // Auto-inject sector + mission context block when profile is provided
  const finalPrompt = profile
    ? `${buildAgentPromptContext(profile)}\n\n${prompt}`
    : prompt;

  // ── LLM response cache (4h TTL) ───────────────────────────────────────────
  // Images bypass the cache — the prompt text alone doesn't uniquely identify them.
  if (!skipCache && !imageBase64) {
    const cacheKey = `llm:${modelKey}:${hashPrompt(finalPrompt)}`;
    const cached = cacheGet(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const result = await _invokeLLMRaw(finalPrompt, modelId, maxTokens, response_json_schema, systemPrompt, usePromptCache, costTrackingId, imageBase64, imageMediaType);
    cacheSet(cacheKey, result, TTL.LLM_RESPONSE);
    return result;
  }

  return _invokeLLMRaw(finalPrompt, modelId, maxTokens, response_json_schema, systemPrompt, usePromptCache, costTrackingId, imageBase64, imageMediaType);
}

async function _invokeLLMRaw(
  prompt: string,
  modelId: string,
  maxTokens: number,
  response_json_schema: any,
  systemPrompt?: string,
  usePromptCache?: boolean,
  costTrackingId?: string,
  imageBase64?: string,
  imageMediaType?: string,
): Promise<any> {

  // Gemini models — route directly without trying Anthropic first
  if (modelId.startsWith('gemini')) {
    try {
      return await _callGemini(prompt, modelId, maxTokens, response_json_schema, imageBase64);
    } catch (err: any) {
      console.warn('[invokeLLM] Gemini failed, trying OpenAI fallback:', err.message);
      if (process.env.OPENAI_API_KEY) {
        return await _callOpenAI(prompt, response_json_schema, maxTokens);
      }
      throw err;
    }
  }

  // Try Anthropic first
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await _callAnthropic(prompt, modelId, maxTokens, response_json_schema, systemPrompt, usePromptCache, costTrackingId, imageBase64, imageMediaType);
    } catch (err: any) {
      const isTokenExhausted = err.status === 429 || /credit|quota|rate.limit|overloaded/i.test(err.message || '');
      if (isTokenExhausted) {
        console.warn('[invokeLLM] Anthropic tokens/rate-limit — falling back to Gemini Flash');
      } else {
        console.warn('[invokeLLM] Anthropic failed, trying Gemini Flash fallback:', err.message);
      }
      // Fallback chain: Claude → Gemini Flash → OpenAI
      // Prepend systemPrompt so Gemini gets the full business context
      if (process.env.GEMINI_API_KEY) {
        try {
          const geminiPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
          return await _callGemini(geminiPrompt, 'gemini-3.5-flash', maxTokens, response_json_schema, imageBase64);
        } catch (geminiErr: any) {
          console.warn('[invokeLLM] Gemini Flash fallback failed:', geminiErr.message);
        }
      }
    }
  }

  // Fallback: OpenAI GPT-4o-mini (cheaper than GPT-4o) — text-only, image dropped
  if (process.env.OPENAI_API_KEY) {
    try {
      return await _callOpenAI(prompt, response_json_schema, maxTokens);
    } catch (err: any) {
      console.warn('[invokeLLM] OpenAI fallback also failed:', err.message);
    }
  }

  throw new Error('No AI provider available — set ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY');
}

async function _callGemini(
  prompt: string,
  modelId: string,
  maxTokens: number,
  response_json_schema: any,
  imageBase64?: string,
): Promise<any> {
  // Map full model IDs back to keys for callGemini
  const modelKey = modelId === 'gemini-3-pro-image' ? 'gemini-pro' : 'gemini-flash';

  const systemPrompt = response_json_schema
    ? 'You are a JSON-only assistant. Respond with a single valid JSON object only. No preamble, no explanation, no markdown fences. ALL string values must be in Hebrew unless the field explicitly requires English.'
    : undefined;

  const text = await callGemini(prompt, modelKey as 'gemini-flash' | 'gemini-pro', maxTokens, {
    jsonMode: !!response_json_schema,
    systemPrompt,
    imageBase64,
  });

  if (response_json_schema) {
    const parsed = _parseJson(text);
    if (!parsed) console.error('[LLM] Gemini _parseJson failed, raw (300):', text.substring(0, 300));
    return parsed;
  }
  return text;
}

async function _callAnthropic(
  prompt: string,
  modelId: string,
  maxTokens: number,
  response_json_schema: any,
  callerSystemPrompt?: string,
  usePromptCache?: boolean,
  costTrackingId?: string,
  imageBase64?: string,
  imageMediaType?: string,
): Promise<any> {

  const defaultSystem = response_json_schema
    ? 'You are a JSON-only assistant. Respond with a single valid JSON object only. No preamble, no explanation, no markdown fences. ALL string values must be in Hebrew unless the field explicitly requires English.'
    : 'You are a helpful assistant.';

  const finalSystem = callerSystemPrompt || defaultSystem;
  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: imageBase64
      ? [
          { type: 'image', source: { type: 'base64', media_type: (imageMediaType || 'image/jpeg') as any, data: imageBase64 } },
          { type: 'text', text: prompt },
        ]
      : prompt,
  }];

  // Use prompt caching when requested — caches the system prompt for 5 min (~80% input token savings)
  const systemParam: any = (usePromptCache && callerSystemPrompt)
    ? [{ type: 'text', text: finalSystem, cache_control: { type: 'ephemeral' } }]
    : finalSystem;

  if (usePromptCache && callerSystemPrompt) {
    console.log('[LLM] prompt cache enabled for system prompt');
  }

  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: maxTokens,
    system: systemParam,
    messages,
  });

  const rawText = ((response.content || [])[0] as any)?.text || '';
  if (response.usage) _addCost(costTrackingId, modelId, response.usage.input_tokens, response.usage.output_tokens);

  if (response.stop_reason === 'max_tokens') {
    console.warn('[LLM] stop_reason=max_tokens — response truncated. model:', modelId, 'maxTokens:', maxTokens);
  }

  if (response_json_schema) {
    const parsed = _parseJson(rawText);
    if (!parsed) console.error('[LLM] _parseJson failed, raw (300):', rawText.substring(0, 300));
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
  // Last resort: find the last COMPLETE item, truncate there, close remaining structure.
  // This handles mid-string truncation (stop_reason: max_tokens) that bracket-counting can't fix.
  const recovered = _recoverTruncated(clean);
  if (recovered !== null) return recovered;
  console.warn('[_parseJson] Failed to parse LLM output, first 200 chars:', clean.substring(0, 200));
  return null;
}

/**
 * Find the last position where a complete nested item was closed (depth drops to 1),
 * then truncate and close any remaining open structures.
 * Works on both { "key": [...] } and [...] root shapes.
 */
function _recoverTruncated(text: string): any {
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastItemCloseIdx = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape)                        { escape = false; continue; }
    if (ch === '\\' && inString)       { escape = true;  continue; }
    if (ch === '"')                    { inString = !inString; continue; }
    if (inString)                      continue;
    if (ch === '{' || ch === '[')      depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      // depth 1 or 2 → we just closed an item inside the root container
      // (depth 1 for root arrays like [{...}], depth 2 for {"key":[{...}]} shapes)
      if (depth >= 1 && depth <= 2) lastItemCloseIdx = i;
    }
  }

  if (lastItemCloseIdx === -1) return null;

  const truncated = text.substring(0, lastItemCloseIdx + 1).trimEnd().replace(/,\s*$/, '');

  // Re-trace to build the closing sequence
  let inStr2 = false, esc2 = false;
  const stack: string[] = [];
  for (const ch of truncated) {
    if (esc2)                          { esc2 = false;  continue; }
    if (ch === '\\' && inStr2)         { esc2 = true;   continue; }
    if (ch === '"')                    { inStr2 = !inStr2; continue; }
    if (inStr2)                        continue;
    if (ch === '{')                    stack.push('}');
    else if (ch === '[')               stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }

  try { return JSON.parse(truncated + stack.reverse().join('')); } catch { return null; }
}
