/**
 * ai_router.ts — Multi-Brain AI Router
 *
 * Routes AI tasks to the optimal model:
 *   Anthropic Claude  → deep analysis, strategy, audience segmentation
 *   OpenAI GPT-4o     → marketing copy, posts, captions
 *   OpenAI GPT-4o-mini → fast translation, classification
 *   OpenAI DALL-E 3   → images (via generateImage endpoint)
 *   OpenAI Embeddings → semantic search (future)
 *   Gemini Flash      → fast/cheap posts, captions, translation, vision
 *   Gemini Pro        → multimodal, advanced vision
 */

import { callGemini } from './gemini';

export type AITask =
  | 'analyze_market'
  | 'classify_intent'
  | 'build_audience'
  | 'generate_post'
  | 'generate_post_fast'
  | 'generate_caption'
  | 'generate_caption_fast'
  | 'translate_hebrew'
  | 'translate_hebrew_fast'
  | 'embed_text'
  | 'competitor_analysis'
  | 'multimodal_vision';

interface AIConfig {
  provider: 'anthropic' | 'openai' | 'gemini';
  model: string;
  max_tokens: number;
  temperature: number;
  reason: string;
}

export const AI_ROUTER: Record<AITask, AIConfig> = {
  // ── Claude — deep analysis + strategy ─────────────────────────────────────
  analyze_market: {
    provider:    'anthropic',
    model:       'claude-sonnet-4-6',
    max_tokens:  1000,
    temperature: 0.3,
    reason:      'ניתוח שוק — Sonnet לניתוח עמוק עם תובנות ספציפיות',
  },
  classify_intent: {
    provider:    'anthropic',
    model:       'claude-haiku-4-5-20251001',
    max_tokens:  200,
    temperature: 0.1,
    reason:      'סיווג מהיר — Haiku זול ומהיר לסיווג בינארי',
  },
  build_audience: {
    provider:    'anthropic',
    model:       'claude-sonnet-4-6',
    max_tokens:  900,
    temperature: 0.4,
    reason:      'פילוח קהל — Sonnet לפרופיל קהל מדויק עם תובנות שוק',
  },
  competitor_analysis: {
    provider:    'anthropic',
    model:       'claude-sonnet-4-6',
    max_tokens:  1000,
    temperature: 0.3,
    reason:      'ניתוח מתחרים — Sonnet לזיהוי הזדמנויות ופגיעויות ממשיות',
  },

  // ── GPT-4o — creative marketing content ───────────────────────────────────
  generate_post: {
    provider:    'openai',
    model:       'gpt-4o',
    max_tokens:  800,
    temperature: 0.8,
    reason:      'כתיבת פוסט — GPT-4o מצטיין בקופי שיווקי יצירתי',
  },
  generate_caption: {
    provider:    'openai',
    model:       'gpt-4o',
    max_tokens:  200,
    temperature: 0.9,
    reason:      'כיתוב תמונה — GPT-4o יצירתי לטקסטים קצרים',
  },
  translate_hebrew: {
    provider:    'openai',
    model:       'gpt-4o-mini',
    max_tokens:  60,
    temperature: 0.1,
    reason:      'תרגום מהיר — gpt-4o-mini זול ומדויק לתרגום',
  },

  // ── Gemini Flash — fast/cheap tasks ───────────────────────────────────────
  generate_post_fast: {
    provider:    'gemini',
    model:       'gemini-3.5-flash',
    max_tokens:  800,
    temperature: 0.8,
    reason:      'פוסט מהיר — Gemini Flash מהיר וזול לתוכן שיווקי',
  },
  generate_caption_fast: {
    provider:    'gemini',
    model:       'gemini-3.5-flash',
    max_tokens:  200,
    temperature: 0.9,
    reason:      'כיתוב מהיר — Gemini Flash לטקסטים קצרים במחיר נמוך',
  },
  translate_hebrew_fast: {
    provider:    'gemini',
    model:       'gemini-3.5-flash',
    max_tokens:  80,
    temperature: 0.1,
    reason:      'תרגום מהיר/זול — Gemini Flash לתרגום רב-כמות',
  },
  multimodal_vision: {
    provider:    'gemini',
    model:       'gemini-3.5-flash',
    max_tokens:  600,
    temperature: 0.3,
    reason:      'vision/multimodal — Gemini Flash לניתוח תמונות',
  },

  // ── Embeddings (placeholder) ───────────────────────────────────────────────
  embed_text: {
    provider:    'openai',
    model:       'text-embedding-3-small',
    max_tokens:  0,
    temperature: 0,
    reason:      'embeddings — OpenAI הוא הסטנדרט לvector search',
  },
};

// ── env keys ──────────────────────────────────────────────────────────────────
const ANTHROPIC_KEY = () => process.env.ANTHROPIC_API_KEY || '';
const OPENAI_KEY    = () => process.env.OPENAI_API_KEY    || '';
const GEMINI_KEY    = () => process.env.GEMINI_API_KEY    || '';

const TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`AI timeout after ${ms}ms`)), ms),
    ),
  ]);
}

// ── Core router ───────────────────────────────────────────────────────────────

export async function callAI(
  task: AITask,
  prompt: string,
  options: { systemPrompt?: string; jsonMode?: boolean } = {},
): Promise<string> {
  const config = AI_ROUTER[task];
  const start  = Date.now();

  console.log(`[AI_ROUTER] task=${task} provider=${config.provider} model=${config.model}`);

  try {
    let result: string;
    if (config.provider === 'anthropic') {
      result = await withTimeout(callClaude(prompt, config, options), TIMEOUT_MS);
    } else if (config.provider === 'gemini') {
      result = await withTimeout(callGeminiProvider(prompt, config, options), TIMEOUT_MS);
    } else {
      result = await withTimeout(callGPT(prompt, config, options), TIMEOUT_MS);
    }
    console.log(`[AI_ROUTER] task=${task} done in ${Date.now() - start}ms`);
    return result;
  } catch (err: any) {
    console.warn(`[AI_ROUTER] task=${task} FAILED (${err.message}), trying fallback`);
    return callFallback(task, prompt, options, err);
  }
}

async function callFallback(
  task: AITask,
  prompt: string,
  options: { systemPrompt?: string; jsonMode?: boolean },
  originalErr: Error,
): Promise<string> {
  const config = AI_ROUTER[task];

  if (config.provider === 'gemini') {
    // Gemini failed → OpenAI GPT-4o-mini fallback
    if (OPENAI_KEY()) {
      console.warn(`[AI_ROUTER] fallback: gemini→openai(mini) for task=${task}`);
      return callGPT(prompt, { ...config, provider: 'openai', model: 'gpt-4o-mini' }, options);
    }
    if (ANTHROPIC_KEY()) {
      console.warn(`[AI_ROUTER] fallback: gemini→anthropic(haiku) for task=${task}`);
      return callClaude(prompt, { ...config, provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }, options);
    }
  } else if (config.provider === 'openai') {
    // OpenAI failed → Gemini Flash → Claude Haiku
    if (GEMINI_KEY()) {
      console.warn(`[AI_ROUTER] fallback: openai→gemini(flash) for task=${task}`);
      try {
        return await callGeminiProvider(prompt, { ...config, provider: 'gemini', model: 'gemini-3.5-flash' }, options);
      } catch (geminiErr: any) {
        console.warn(`[AI_ROUTER] Gemini fallback also failed: ${geminiErr.message}`);
      }
    }
    if (ANTHROPIC_KEY()) {
      console.warn(`[AI_ROUTER] fallback: openai→anthropic(haiku) for task=${task}`);
      return callClaude(prompt, { ...config, provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }, options);
    }
  } else if (config.provider === 'anthropic') {
    // Claude failed → Gemini Flash → GPT-4o-mini
    if (GEMINI_KEY()) {
      console.warn(`[AI_ROUTER] fallback: anthropic→gemini(flash) for task=${task}`);
      try {
        return await callGeminiProvider(prompt, { ...config, provider: 'gemini', model: 'gemini-3.5-flash' }, options);
      } catch (geminiErr: any) {
        console.warn(`[AI_ROUTER] Gemini fallback also failed: ${geminiErr.message}`);
      }
    }
    if (OPENAI_KEY()) {
      console.warn(`[AI_ROUTER] fallback: anthropic→openai(mini) for task=${task}`);
      return callGPT(prompt, { ...config, provider: 'openai', model: 'gpt-4o-mini' }, options);
    }
  }

  throw originalErr;
}

// ── Gemini call ───────────────────────────────────────────────────────────────
async function callGeminiProvider(
  prompt: string,
  config: AIConfig,
  options: { systemPrompt?: string; jsonMode?: boolean; imageBase64?: string },
): Promise<string> {
  const key = GEMINI_KEY();
  if (!key) throw new Error('GEMINI_API_KEY not set');

  // Normalize model to key
  const modelKey = config.model === 'gemini-3-pro-image' ? 'gemini-pro' : 'gemini-flash';

  return callGemini(prompt, modelKey as 'gemini-flash' | 'gemini-pro', config.max_tokens || 800, {
    jsonMode:     options.jsonMode,
    systemPrompt: options.systemPrompt,
    imageBase64:  (options as any).imageBase64,
  });
}

// ── Claude call ───────────────────────────────────────────────────────────────
async function callClaude(
  prompt: string,
  config: AIConfig,
  options: { systemPrompt?: string; jsonMode?: boolean },
): Promise<string> {
  const key = ANTHROPIC_KEY();
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');

  const body: any = {
    model:      config.model,
    max_tokens: config.max_tokens || 512,
    messages:   [{ role: 'user', content: prompt }],
  };

  if (options.systemPrompt) body.system = options.systemPrompt;

  // Claude 4.x does not support assistant-turn prefill — rely on system prompt for JSON
  if (options.jsonMode && !body.system) {
    body.system = 'Return ONLY valid JSON. No markdown, no explanation.';
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    throw new Error(`Claude ${config.model} ${res.status}: ${err.error?.message || res.statusText}`);
  }

  const data: any = await res.json();
  return data.content?.[0]?.text || '';
}

// ── GPT call ──────────────────────────────────────────────────────────────────
async function callGPT(
  prompt: string,
  config: AIConfig,
  options: { systemPrompt?: string; jsonMode?: boolean },
): Promise<string> {
  const key = OPENAI_KEY();
  if (!key) throw new Error('OPENAI_API_KEY not set');

  const messages: any[] = [];
  if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const body: any = {
    model:       config.model,
    max_tokens:  config.max_tokens || 512,
    temperature: config.temperature,
    messages,
  };

  if (options.jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    throw new Error(`GPT ${config.model} ${res.status}: ${err.error?.message || res.statusText}`);
  }

  const data: any = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── JSON helper ───────────────────────────────────────────────────────────────
export async function callAIJson<T = any>(
  task: AITask,
  prompt: string,
  options?: { systemPrompt?: string },
): Promise<T> {
  const raw   = await callAI(task, prompt, { ...options, jsonMode: true });
  const clean = raw.replace(/```json?|```/g, '').trim();

  // Try direct parse
  try { return JSON.parse(clean) as T; } catch {}

  // Try to extract the first JSON object from the response
  const objMatch = clean.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]) as T; } catch {}
  }

  // Try JSON array
  const arrMatch = clean.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]) as T; } catch {}
  }

  throw new Error(`[callAIJson] task=${task} — failed to parse AI response as JSON`);
}
