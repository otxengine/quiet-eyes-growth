/**
 * gemini.ts — Gemini API wrapper (Google Generative AI)
 * gemini-flash  → gemini-3.5-flash     (text, fast/cheap)
 * gemini-pro    → gemini-3-pro-image   (native image generation + multimodal)
 */

const GEMINI_MODEL_MAP: Record<string, string> = {
  'gemini-flash': 'gemini-3.5-flash',
  'gemini-pro':   'gemini-3-pro-image',
};

// Rate-limit cooldown: on 429, pause Gemini for a short window then retry automatically.
// Short (not Tavily's 60min) because Gemini is the primary LLM and its quota resets per-minute.
let rateLimitUntil = 0; // epoch ms — 0 means not limited
const RATE_LIMIT_COOLDOWN_MS = 75 * 1000;

export function isGeminiRateLimited(): boolean {
  return Date.now() < rateLimitUntil;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Call Gemini generative model.
 * @param prompt       User prompt text
 * @param modelKey     'gemini-flash' | 'gemini-pro'
 * @param maxTokens    Max output tokens
 * @param options      jsonMode, systemPrompt, imageBase64 (vision)
 * @returns            Text response, or "data:image/jpeg;base64,..." for pro image responses
 */
export async function callGemini(
  prompt: string,
  modelKey: 'gemini-flash' | 'gemini-pro',
  maxTokens: number,
  options: {
    jsonMode?: boolean;
    systemPrompt?: string;
    imageBase64?: string;
    mediaMimeType?: string; // e.g. 'image/jpeg' (default) or 'video/mp4' for video understanding
  } = {},
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  if (isGeminiRateLimited()) {
    const secsLeft = Math.ceil((rateLimitUntil - Date.now()) / 1000);
    throw new Error(`[Gemini] rate-limited — cooling down for ${secsLeft}s`);
  }

  const modelId = GEMINI_MODEL_MAP[modelKey] || 'gemini-3.5-flash';
  const isProImage = modelKey === 'gemini-pro';
  const { jsonMode, systemPrompt, imageBase64, mediaMimeType } = options;

  // Build parts array
  const parts: any[] = [];
  if (imageBase64) {
    parts.push({ inlineData: { mimeType: mediaMimeType || 'image/jpeg', data: imageBase64 } });
  }
  parts.push({ text: prompt });

  const body: any = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      // gemini-3-pro-image requires high token budget (images consume many tokens)
      maxOutputTokens: isProImage ? Math.max(maxTokens, 8192) : maxTokens,
      temperature: 0.4,
      // gemini-3-pro-image: request both image + text modalities
      ...(isProImage ? { responseModalities: ['IMAGE', 'TEXT'] } : {}),
      // Disable thinking for Flash — saves tokens, faster response
      ...(!isProImage ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  };

  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  if (jsonMode && !isProImage) {
    body.generationConfig.responseMimeType = 'application/json';
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
  const fetchOpts = {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  };

  let res = await fetch(url, fetchOpts);

  if (res.status === 429) {
    // One bounded retry — Gemini is the primary provider, so don't give up on the first 429.
    const retryAfterHeader = Number(res.headers.get('retry-after'));
    const retryAfterMs = (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0)
      ? Math.min(retryAfterHeader, 20) * 1000
      : 15000;
    const jitterMs = Math.floor(Math.random() * 3000);
    console.warn(`[Gemini] ${modelId} 429 — retrying once in ${Math.round((retryAfterMs + jitterMs) / 1000)}s`);
    await sleep(retryAfterMs + jitterMs);
    res = await fetch(url, fetchOpts);
  }

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 429) {
      rateLimitUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      console.error(`[Gemini] ${modelId} still 429 after retry — cooling down until ${new Date(rateLimitUntil).toISOString()}`);
    }
    throw new Error(`[Gemini] ${modelId} ${res.status}: ${err.slice(0, 300)}`);
  }

  const data: any = await res.json();
  const responseParts: any[] = data.candidates?.[0]?.content?.parts || [];

  // For pro image model — return the first image as data URI, fall back to text
  if (isProImage) {
    const imgPart = responseParts.find((p: any) => p.inlineData?.data);
    if (imgPart) {
      const mime = imgPart.inlineData.mimeType || 'image/jpeg';
      console.log(`[Gemini] ${modelId} returned image (${imgPart.inlineData.data.length} chars base64)`);
      return `data:${mime};base64,${imgPart.inlineData.data}`;
    }
  }

  const text = responseParts.find((p: any) => p.text)?.text || '';

  if (!text) {
    const reason = data.candidates?.[0]?.finishReason;
    console.warn(`[Gemini] Empty response from ${modelId}, finishReason=${reason}`);
  }

  console.log(`[Gemini] ${modelId} responded (${text.length} chars)`);
  return text;
}
