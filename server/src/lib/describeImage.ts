import { invokeLLM } from './llm';

/**
 * Vision-describes an image in Hebrew for use as post-generation context.
 * Shared by describeBusinessMedia (on upload) and regenerateMediaDescriptions
 * (fixing old assets poisoned by the text-only-fallback bug in llm.ts).
 */
export async function describeImage(imageBase64: string, mimeType = 'image/jpeg'): Promise<string> {
  const result = await invokeLLM({
    model:      'sonnet',
    maxTokens:  100,
    systemPrompt: 'Return ONLY the description text. No markdown, no explanation, no surrounding quotes.',
    prompt:     'תאר בקצרה (עד 20 מילים) בעברית מה רואים בתמונה הזו, לשימוש כהקשר ליצירת פוסטים לרשתות חברתיות עבור העסק.',
    imageBase64,
    imageMediaType: mimeType,
  });
  return (typeof result === 'string' ? result : String(result || '')).trim();
}
