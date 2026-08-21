import { invokeLLM } from './llm';
import { fetchImageBase64 } from './fetchImageBase64';

export interface OwnLogoCritiqueInput {
  businessName: string;
  category: string;
  platform: string;
  logoUrl: string;
  competitorLogoInsight: string;
}

/**
 * Vision-critiques the business's OWN logo/profile picture, grounded in the
 * visual pattern already synthesized across competitors (synthesizeLogoTrends)
 * — concrete, actionable feedback (contrast, legibility at small sizes,
 * professional vs informal), not a generated replacement image (an LLM can't
 * produce that the way it rewrites bio text).
 */
export async function critiqueOwnLogo(input: OwnLogoCritiqueInput): Promise<string | null> {
  const image = await fetchImageBase64(input.logoUrl);
  if (!image) return null;

  try {
    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 400,
      skipCache: true,
      imageBase64: image.data,
      imageMediaType: image.mediaType,
      response_json_schema: { type: 'object' },
      prompt: `You are a brand designer reviewing a business's ${input.platform} logo/profile picture.

Business: "${input.businessName}" | Sector: ${input.category}

Visual pattern that's common across this business's competitors' logos: ${input.competitorLogoInsight}

Look at the attached image. Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "critique": "2-4 sentences: concrete, actionable feedback on this specific logo — legibility at small sizes, contrast, whether it reads as professional vs informal, and how it compares to the competitor pattern above. If it's already strong, say so honestly instead of forcing criticism."
}`,
    });
    return typeof result?.critique === 'string' && result.critique ? result.critique : null;
  } catch (err: any) {
    console.warn('[critiqueOwnLogo] failed:', err.message);
    return null;
  }
}
