import { invokeLLM } from './llm';
import { fetchImageBase64 } from './fetchImageBase64';

export interface OwnLogoCritiqueInput {
  businessName: string;
  category: string;
  platform: string;
  logoUrl: string;
  competitorLogoInsight: string;
}

export interface OwnLogoCritique {
  critique: string | null;
  needs_redesign: boolean;
}

/**
 * Vision-critiques the business's OWN logo/profile picture, grounded in the
 * visual pattern already synthesized across competitors (synthesizeLogoTrends)
 * — concrete, actionable feedback (contrast, legibility at small sizes,
 * professional vs informal), not a generated replacement image (an LLM can't
 * produce that the way it rewrites bio text — see generateLogo.ts for the
 * separate AI-generated-candidate flow this critique's needs_redesign gates).
 */
export async function critiqueOwnLogo(input: OwnLogoCritiqueInput): Promise<OwnLogoCritique> {
  const image = await fetchImageBase64(input.logoUrl);
  if (!image) return { critique: null, needs_redesign: false };

  try {
    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 700, // observed 400 truncate mid-JSON on a verbose critique, cutting it off invalid — this model tends to write long here
      skipCache: true,
      imageBase64: image.data,
      imageMediaType: image.mediaType,
      response_json_schema: { type: 'object' },
      prompt: `You are a brand designer reviewing a business's ${input.platform} logo/profile picture.

Business: "${input.businessName}" | Sector: ${input.category}

Visual pattern that's common across this business's competitors' logos: ${input.competitorLogoInsight}

Look at the attached image. Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "critique": "2-4 sentences: concrete, actionable feedback on this specific logo — legibility at small sizes, contrast, whether it reads as professional vs informal, and how it compares to the competitor pattern above. If it's already strong, say so honestly instead of forcing criticism.",
  "needs_redesign": true or false — true only if the logo has a real, meaningful problem (illegible, unprofessional, not actually a logo, poor contrast) that a redesign would genuinely fix; false if it's already reasonably solid, even if not perfect
}`,
    });
    return {
      critique: typeof result?.critique === 'string' && result.critique ? result.critique : null,
      needs_redesign: !!result?.needs_redesign,
    };
  } catch (err: any) {
    console.warn('[critiqueOwnLogo] failed:', err.message);
    return { critique: null, needs_redesign: false };
  }
}
