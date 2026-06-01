/**
 * gemini.ts — Gemini API wrapper (Google Generative AI)
 * Supports gemini-flash (fast/cheap) and gemini-pro (advanced/multimodal).
 */

const GEMINI_MODEL_MAP: Record<string, string> = {
  'gemini-flash': 'gemini-2.5-flash',
  'gemini-pro':   'gemini-2.5-pro',
};

/**
 * Call Gemini generative model.
 * @param prompt       User prompt text
 * @param modelKey     'gemini-flash' | 'gemini-pro'
 * @param maxTokens    Max output tokens
 * @param options      jsonMode, systemPrompt, imageBase64 (vision)
 */
export async function callGemini(
  prompt: string,
  modelKey: 'gemini-flash' | 'gemini-pro',
  maxTokens: number,
  options: {
    jsonMode?: boolean;
    systemPrompt?: string;
    imageBase64?: string;
  } = {},
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const modelId = GEMINI_MODEL_MAP[modelKey] || 'gemini-2.5-flash';
  const { jsonMode, systemPrompt, imageBase64 } = options;

  // Build parts array
  const parts: any[] = [];
  if (imageBase64) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageBase64,
      },
    });
  }
  parts.push({ text: prompt });

  const body: any = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.4,
      // Disable thinking for Flash — saves tokens, faster response
      ...(modelKey === 'gemini-flash' ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  };

  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  if (jsonMode) {
    body.generationConfig.responseMimeType = 'application/json';
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`[Gemini] ${modelId} ${res.status}: ${err.slice(0, 300)}`);
  }

  const data: any = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  if (!text) {
    const reason = data.candidates?.[0]?.finishReason;
    console.warn(`[Gemini] Empty response from ${modelId}, finishReason=${reason}`);
  }

  console.log(`[Gemini] ${modelId} responded (${text.length} chars)`);
  return text;
}
