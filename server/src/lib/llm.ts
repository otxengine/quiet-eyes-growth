import { cacheGet, cacheSet, TTL, hashPrompt } from './agentCache';
import { buildAgentPromptContext } from './businessProfile';

// ── Surrogate sanitizer — prevents Anthropic 400 "no low surrogate in string" ──
// Scraped social/review text can carry a truncated 4-byte emoji (a lone UTF-16
// surrogate), which breaks JSON serialization before Anthropic even sees it.
export function sanitizeSurrogates(s: string): string {
  if (!s) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) { out += s[i] + s[i + 1]; i++; }
    } else if (c >= 0xDC00 && c <= 0xDFFF) {
      // lone low surrogate → drop
    } else {
      out += s[i];
    }
  }
  return out;
}

// ── LLM cost tracking (per-business accumulator, keyed by businessId) ─────────
const _costAccumulator = new Map<string, number>();
export function startCostTracking(id: string) { _costAccumulator.set(id, 0); }
export function popCost(id: string): number {
  const c = _costAccumulator.get(id) ?? 0;
  _costAccumulator.delete(id);
  return c;
}
// OpenRouter reports real per-call cost directly (correct for whichever model in
// the fallback list actually served the request) — no hardcoded price table needed.
function _addCost(id: string | undefined, modelId: string, usage: any) {
  if (!id) return;
  const usd = usage?.cost;
  if (typeof usd !== 'number') {
    console.warn('[LLM] OpenRouter response missing usage.cost — skipping cost accumulation for', modelId);
    return;
  }
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
   * Pass a separate system prompt. When combined with usePromptCache, the request
   * sets OpenRouter's top-level cache_control so it's cached (Claude models only).
   */
  systemPrompt?: string;
  /**
   * Enable prompt caching on the system prompt block (requires systemPrompt).
   * Only takes effect when the model that ends up serving the request is a
   * Claude model — a harmless no-op otherwise. Cuts input token cost for repeat callers.
   */
  usePromptCache?: boolean;
  costTrackingId?: string;
  /**
   * Optional image to send alongside the prompt (vision) — supported by every
   * model in the OpenRouter fallback list this request can land on.
   */
  imageBase64?: string;
  imageMediaType?: string; // e.g. 'image/jpeg' — defaults to 'image/jpeg'
}

// Short key -> ordered OpenRouter fallback list. OpenRouter tries each slug
// server-side on failure/rate-limit — no client-side retry loop needed.
// 'gemini-pro' (image-generation output, not text/vision-input) is deliberately
// excluded — nothing calls invokeLLM with that key; it still routes through the
// legacy raw-passthrough path in _invokeLLMRaw and fails loud via OpenRouter's
// own 400 if it's ever used, rather than silently misbehaving.
const OPENROUTER_MODEL_MAP: Record<string, string[]> = {
  haiku:  ['anthropic/claude-haiku-4.5', 'google/gemini-3.5-flash', 'openai/gpt-4o-mini'],
  sonnet: ['anthropic/claude-sonnet-4.6', 'anthropic/claude-haiku-4.5', 'openai/gpt-4o-mini'],
  opus:   ['anthropic/claude-opus-4.6', 'anthropic/claude-sonnet-4.6', 'anthropic/claude-haiku-4.5'],
  'gemini-flash': ['google/gemini-3.5-flash', 'anthropic/claude-haiku-4.5', 'openai/gpt-4o-mini'],
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
 * Routes through OpenRouter with a per-key fallback list (see OPENROUTER_MODEL_MAP).
 * Caches responses for 4 hours to avoid duplicate AI calls across pipeline runs.
 */
export async function invokeLLM(options: { prompt: string } & LLMOptions): Promise<any> {
  const { prompt, response_json_schema, model, maxTokens: maxTokensOverride, skipCache, profile, systemPrompt, usePromptCache, costTrackingId, imageBase64, imageMediaType } = options;

  const modelKey = model || 'haiku'; // default to Haiku (cheapest)
  const modelId = modelKey; // resolved to an OpenRouter fallback array inside _invokeLLMRaw
  const maxTokens = maxTokensOverride ?? MAX_TOKENS_DEFAULT[modelKey] ?? 350;

  // Auto-inject sector + mission context block when profile is provided
  const finalPrompt = sanitizeSurrogates(profile
    ? `${buildAgentPromptContext(profile)}\n\n${prompt}`
    : prompt);
  const finalSystemPrompt = systemPrompt ? sanitizeSurrogates(systemPrompt) : systemPrompt;

  // ── LLM response cache (4h TTL) ───────────────────────────────────────────
  // Images bypass the cache — the prompt text alone doesn't uniquely identify them.
  if (!skipCache && !imageBase64) {
    const cacheKey = `llm:${modelKey}:${hashPrompt(finalPrompt)}`;
    const cached = cacheGet(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const result = await _invokeLLMRaw(finalPrompt, modelId, maxTokens, response_json_schema, finalSystemPrompt, usePromptCache, costTrackingId, imageBase64, imageMediaType);
    cacheSet(cacheKey, result, TTL.LLM_RESPONSE);
    return result;
  }

  return _invokeLLMRaw(finalPrompt, modelId, maxTokens, response_json_schema, finalSystemPrompt, usePromptCache, costTrackingId, imageBase64, imageMediaType);
}

async function _invokeLLMRaw(
  prompt: string,
  modelKey: string,
  maxTokens: number,
  response_json_schema: any,
  systemPrompt?: string,
  usePromptCache?: boolean,
  costTrackingId?: string,
  imageBase64?: string,
  imageMediaType?: string,
): Promise<any> {
  // Raw-string passthrough for any unmapped key — fails loud via OpenRouter's
  // own 400 (invalid model) rather than silently misbehaving.
  const models = OPENROUTER_MODEL_MAP[modelKey] ?? [modelKey];
  return _callOpenRouter(prompt, models, maxTokens, response_json_schema, systemPrompt, usePromptCache, costTrackingId, imageBase64, imageMediaType);
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function _callOpenRouter(
  prompt: string,
  models: string[],
  maxTokens: number,
  response_json_schema: any,
  callerSystemPrompt?: string,
  usePromptCache?: boolean,
  costTrackingId?: string,
  imageBase64?: string,
  imageMediaType?: string,
): Promise<any> {
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
  if (!OPENROUTER_KEY) throw new Error('No AI provider available — set OPENROUTER_API_KEY');

  const defaultSystem = response_json_schema
    ? 'You are a JSON-only assistant. Respond with a single valid JSON object only. No preamble, no explanation, no markdown fences. ALL string values must be in Hebrew unless the field explicitly requires English.'
    : 'You are a helpful assistant.';

  // Text before image, per OpenRouter's documented recommendation.
  const userContent: any = imageBase64
    ? [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${imageMediaType || 'image/jpeg'};base64,${imageBase64}` } },
      ]
    : prompt;

  const body: any = {
    models, // ordered fallback array — OpenRouter tries each server-side, no client-side retry
    max_tokens: maxTokens,
    temperature: 0.3,
    messages: [
      { role: 'system', content: callerSystemPrompt || defaultSystem },
      { role: 'user', content: userContent },
    ],
  };
  if (response_json_schema) body.response_format = { type: 'json_object' };

  // Top-level (not per-block) — caches everything up to the last cacheable block
  // for Claude models. Harmless no-op if the model that actually served the
  // request isn't Claude.
  if (usePromptCache && callerSystemPrompt) {
    body.cache_control = { type: 'ephemeral' };
    console.log('[LLM] prompt cache enabled for system prompt');
  }

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_KEY}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    throw new Error(`OpenRouter ${res.status}: ${err.error?.message || res.statusText}`);
  }

  const data: any = await res.json();
  const choice = data.choices?.[0];
  // A provider error can arrive on an HTTP 200 as an embedded finish_reason.
  if (choice?.finish_reason === 'error') {
    throw new Error(`OpenRouter provider error: ${choice.error?.message || JSON.stringify(choice.error)}`);
  }

  const rawText = choice?.message?.content || '';
  _addCost(costTrackingId, data.model, data.usage); // data.model = whichever model actually served it

  if (choice?.finish_reason === 'length') {
    console.warn('[LLM] finish_reason=length — response truncated. models:', models, 'maxTokens:', maxTokens);
  }

  if (response_json_schema) {
    const parsed = _parseJson(rawText);
    if (!parsed) console.error('[LLM] _parseJson failed, raw (300):', rawText.substring(0, 300));
    return parsed;
  }
  return rawText;
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
