/**
 * gemini.ts — Gemini API wrapper (Google Generative AI)
 * gemini-flash  → gemini-3.5-flash     (text, fast/cheap)
 * gemini-pro    → gemini-3-pro-image   (native image generation + multimodal)
 */

const GEMINI_MODEL_MAP: Record<string, string> = {
  'gemini-flash': 'gemini-3.5-flash',
  'gemini-pro':   'gemini-3-pro-image',
};

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
  } = {},
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const modelId = GEMINI_MODEL_MAP[modelKey] || 'gemini-3.5-flash';
  const isProImage = modelKey === 'gemini-pro';
  const { jsonMode, systemPrompt, imageBase64 } = options;

  // Build parts array
  const parts: any[] = [];
  if (imageBase64) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } });
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
