import { invokeLLM } from './llm';
import { fetchImageBase64 } from './fetchImageBase64';

/**
 * Vision-describes ONE logo/profile picture — a short factual description of
 * its visual style (colors, wordmark vs icon vs photo, professional-quality
 * markers), used as a pooled text input for synthesizeLogoTrends. Kept as a
 * plain description (not a critique) since this runs on competitor logos too,
 * where "what would you improve" isn't the point — "what does it look like" is.
 */
export async function describeLogo(imageUrl: string): Promise<string | null> {
  const image = await fetchImageBase64(imageUrl);
  if (!image) return null;

  try {
    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 350,
      skipCache: true,
      imageBase64: image.data,
      imageMediaType: image.mediaType,
      response_json_schema: { type: 'object' },
      prompt: `You are a brand designer. Describe this logo/profile picture in ONE short factual sentence: is it a wordmark, an icon/symbol, or a photo; its dominant colors; and whether it reads as professionally designed or informal/low-effort. Return ONLY valid JSON, the value in Hebrew:
{ "description": "..." }`,
    });
    return typeof result?.description === 'string' && result.description ? result.description : null;
  } catch (err: any) {
    console.warn('[describeLogo] failed:', err.message);
    return null;
  }
}
