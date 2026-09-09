/**
 * ai_router.ts — Multi-Brain AI Router
 *
 * Routes AI tasks to the optimal model via OpenRouter (one account/key, one
 * dashboard) — each task's `models` array is an ordered fallback list that
 * OpenRouter itself retries server-side on failure/rate-limit, no client-side
 * retry loop needed.
 */

export type AITask =
  | 'analyze_market'
  | 'classify_intent'
  | 'classify_sector'
  | 'build_audience'
  | 'generate_post'
  | 'generate_post_fast'
  | 'generate_caption'
  | 'generate_caption_fast'
  | 'translate_hebrew'
  | 'translate_hebrew_fast'
  | 'competitor_analysis'
  | 'multimodal_vision'
  | 'page_parsing'
  | 'draft_strategy';

interface AIConfig {
  models: string[];    // ordered OpenRouter fallback array — server-side retry, no client-side loop
  max_tokens: number;
  temperature: number;
  reason: string;
}

export const AI_ROUTER: Record<AITask, AIConfig> = {
  // ── Claude-primary — deep analysis + strategy ─────────────────────────────
  analyze_market: {
    models:      ['anthropic/claude-sonnet-4.6', 'google/gemini-3.5-flash', 'openai/gpt-4o-mini'],
    max_tokens:  1000,
    temperature: 0.3,
    reason:      'ניתוח שוק — Sonnet לניתוח עמוק עם תובנות ספציפיות',
  },
  classify_intent: {
    models:      ['anthropic/claude-haiku-4.5', 'google/gemini-3.5-flash', 'openai/gpt-4o-mini'],
    max_tokens:  200,
    temperature: 0.1,
    reason:      'סיווג מהיר — Haiku זול ומהיר לסיווג בינארי',
  },
  build_audience: {
    models:      ['anthropic/claude-sonnet-4.6', 'google/gemini-3.5-flash', 'openai/gpt-4o-mini'],
    max_tokens:  900,
    temperature: 0.4,
    reason:      'פילוח קהל — Sonnet לפרופיל קהל מדויק עם תובנות שוק',
  },
  competitor_analysis: {
    models:      ['anthropic/claude-sonnet-4.6', 'google/gemini-3.5-flash', 'openai/gpt-4o-mini'],
    max_tokens:  1000,
    temperature: 0.3,
    reason:      'ניתוח מתחרים — Sonnet לזיהוי הזדמנויות ופגיעויות ממשיות',
  },

  // ── GPT-4o-primary — creative marketing content ───────────────────────────
  generate_post: {
    models:      ['openai/gpt-4o', 'google/gemini-3.5-flash', 'anthropic/claude-haiku-4.5'],
    max_tokens:  800,
    temperature: 0.8,
    reason:      'כתיבת פוסט — GPT-4o מצטיין בקופי שיווקי יצירתי',
  },
  generate_caption: {
    models:      ['openai/gpt-4o', 'google/gemini-3.5-flash', 'anthropic/claude-haiku-4.5'],
    max_tokens:  200,
    temperature: 0.9,
    reason:      'כיתוב תמונה — GPT-4o יצירתי לטקסטים קצרים',
  },
  translate_hebrew: {
    models:      ['openai/gpt-4o-mini', 'google/gemini-3.5-flash', 'anthropic/claude-haiku-4.5'],
    max_tokens:  60,
    temperature: 0.1,
    reason:      'תרגום מהיר — gpt-4o-mini זול ומדויק לתרגום',
  },

  // ── Gemini Flash-primary — fast/cheap tasks ───────────────────────────────
  generate_post_fast: {
    models:      ['google/gemini-3.5-flash', 'openai/gpt-4o-mini', 'anthropic/claude-haiku-4.5'],
    max_tokens:  800,
    temperature: 0.8,
    reason:      'פוסט מהיר — Gemini Flash מהיר וזול לתוכן שיווקי',
  },
  generate_caption_fast: {
    models:      ['google/gemini-3.5-flash', 'openai/gpt-4o-mini', 'anthropic/claude-haiku-4.5'],
    max_tokens:  200,
    temperature: 0.9,
    reason:      'כיתוב מהיר — Gemini Flash לטקסטים קצרים במחיר נמוך',
  },
  translate_hebrew_fast: {
    models:      ['google/gemini-3.5-flash', 'openai/gpt-4o-mini', 'anthropic/claude-haiku-4.5'],
    max_tokens:  80,
    temperature: 0.1,
    reason:      'תרגום מהיר/זול — Gemini Flash לתרגום רב-כמות',
  },
  multimodal_vision: {
    models:      ['google/gemini-3.5-flash', 'openai/gpt-4o-mini', 'anthropic/claude-haiku-4.5'],
    max_tokens:  600,
    temperature: 0.3,
    reason:      'vision/multimodal — Gemini Flash לניתוח תמונות',
  },

  // ── Gemini Flash-primary — web page parsing (Gatherers layer) ────────────
  // Gemini Flash excels at extracting structured data from noisy HTML/web
  // pages across ANY business sector — no hard-coded domain assumptions.
  // Large context window handles full Tavily raw_content without truncation.
  page_parsing: {
    models:      ['google/gemini-3.5-flash', 'openai/gpt-4o-mini', 'anthropic/claude-haiku-4.5'],
    max_tokens:  600,
    temperature: 0.1,
    reason:      'חילוץ נתונים מדפי web — Gemini Flash מצטיין בניקוי רעשי HTML עם הקשר רחב',
  },

  // ── Claude Haiku-primary — sector-agnostic fast classification ───────────
  // Sector-universal intent/topic classification — works identically for
  // a hair salon, a law firm, or a restaurant without prompt changes.
  classify_sector: {
    models:      ['anthropic/claude-haiku-4.5', 'google/gemini-3.5-flash', 'openai/gpt-4o-mini'],
    max_tokens:  300,
    temperature: 0.1,
    reason:      'סיווג אגנוסטי לסקטור — Haiku מהיר לזיהוי נושאים/כוונות בכל סוג עסק',
  },

  // ── Claude Sonnet-primary — Human-in-the-loop strategic drafts ───────────
  // All Strategist agents output pending_approval AutoAction records.
  // Sonnet produces richer, more nuanced recommendations than Haiku
  // but the human still approves/rejects before any real-world action.
  draft_strategy: {
    models:      ['anthropic/claude-sonnet-4.6', 'google/gemini-3.5-flash', 'openai/gpt-4o-mini'],
    max_tokens:  1200,
    temperature: 0.4,
    reason:      'טיוטת אסטרטגיה לאישור — Sonnet לניתוח עמוק, פלט ממתין לאישור אנושי',
  },
};

const TIMEOUT_MS = 35_000;

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

  console.log(`[AI_ROUTER] task=${task} models=${config.models.join(',')}`);

  const result = await withTimeout(callOpenRouter(prompt, config, options), TIMEOUT_MS);
  console.log(`[AI_ROUTER] task=${task} done in ${Date.now() - start}ms`);
  return result;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function callOpenRouter(
  prompt: string,
  config: AIConfig,
  options: { systemPrompt?: string; jsonMode?: boolean },
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY || '';
  if (!key) throw new Error('OPENROUTER_API_KEY not set');

  const systemPrompt = options.systemPrompt
    || (options.jsonMode ? 'Return ONLY valid JSON. No markdown, no explanation.' : undefined);

  const messages: any[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const body: any = {
    models: config.models, // ordered fallback array — OpenRouter tries each server-side
    max_tokens: config.max_tokens || 512,
    temperature: config.temperature,
    messages,
  };
  if (options.jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
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
  return choice?.message?.content || '';
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
