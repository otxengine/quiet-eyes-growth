import { invokeLLM } from './llm';
import { fetchImageBase64 } from './fetchImageBase64';

export interface ScoreOwnPictureInput {
  businessName: string;
  category: string;
  platform: string;
  imageUrl: string;
}

export interface PictureScoreResult {
  score: number; // 0-100 raw, caller scales to its point cap
  reasoning: string | null;
}

// Neutral fallback when the image can't be fetched or the LLM call fails —
// same "sparse data ≠ zero" convention as scoreOwnBio's FALLBACK.
const FALLBACK: PictureScoreResult = { score: 50, reasoning: null };

/**
 * LLM vision-judges the professionalism/brand-fit of a business's own profile
 * picture — the qualitative half of the picture score (the other half,
 * presence/technical, is a deterministic formula in calculateProfileScore.ts).
 * Distinct from critiqueLogo.ts: this only scores what exists, it doesn't
 * critique for redesign or gate a "generate new logo" CTA.
 */
export async function scoreOwnPicture(input: ScoreOwnPictureInput): Promise<PictureScoreResult> {
  const image = await fetchImageBase64(input.imageUrl);
  if (!image) return FALLBACK;

  try {
    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 300,
      skipCache: true,
      imageBase64: image.data,
      imageMediaType: image.mediaType,
      response_json_schema: { type: 'object' },
      prompt: `אתה מומחה מיתוג, מעריך את איכות תמונת הפרופיל של עסק ברשת חברתית ${input.platform}.

עסק: "${input.businessName}" | תחום: ${input.category}

הסתכל על התמונה המצורפת ודרג לפי: קריאות בגודל קטן (כמו שהתמונה תיראה בפיד), ניגודיות ובהירות, האם נראית מקצועית ולא חובבנית, והתאמה למיתוג של עסק בתחום הזה.

Return ONLY valid JSON:
{
  "score": 0-100,
  "reasoning": "משפט-שניים בעברית שמסביר את הציון"
}`,
    });

    const score = Number(result?.score);
    if (!Number.isFinite(score)) return FALLBACK;
    return {
      score: Math.max(0, Math.min(100, score)),
      reasoning: typeof result?.reasoning === 'string' ? result.reasoning : null,
    };
  } catch (err: any) {
    console.warn('[scoreOwnPicture] failed:', err.message);
    return FALLBACK;
  }
}
