import { invokeLLM } from './llm';

export interface ScoreOwnBioInput {
  businessName: string;
  category: string;
  city?: string | null;
  bio: string;
}

export interface BioScoreResult {
  score: number; // 0-100 raw, caller scales to its point cap
  reasoning: string | null;
}

// Neutral fallback when the LLM call fails — a missing signal shouldn't zero
// out the whole category, same convention as calculateHealthScore's defaults
// for sparse data (e.g. reputationScore = 50 when there are no reviews yet).
const FALLBACK: BioScoreResult = { score: 50, reasoning: null };

/**
 * LLM-judges the persuasiveness/clarity of a business's own bio text — the
 * qualitative half of the bio score (the other half, structure/completeness,
 * is a deterministic formula in calculateProfileScore.ts). Distinct from
 * suggestBioFix.ts: this only scores what exists, it doesn't rewrite it.
 */
export async function scoreOwnBio(input: ScoreOwnBioInput): Promise<BioScoreResult> {
  try {
    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 300,
      skipCache: true,
      response_json_schema: { type: 'object' },
      prompt: `אתה מומחה מיתוג ושיווק, מעריך את איכות הביו (תיאור הפרופיל) של עסק ברשת חברתית.

עסק: "${input.businessName}" | תחום: ${input.category}${input.city ? ` | עיר: ${input.city}` : ''}

הביו הנוכחי:
"""
${input.bio}
"""

דרג את הביו לפי: בהירות ומסר ברור, התאמה לתחום ולעיר, ייחודיות (לא כללי מדי), והאם יש הזמנה לפעולה מרומזת (לפנות, לבקר, להזמין).

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
    console.warn('[scoreOwnBio] failed:', err.message);
    return FALLBACK;
  }
}
