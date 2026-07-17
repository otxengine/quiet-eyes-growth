import { invokeLLM } from './llm';

export const TOPIC_IDS = [
  'service', 'price', 'quality', 'cleanliness',
  'atmosphere', 'availability', 'delivery',
] as const;

export type TopicId = typeof TOPIC_IDS[number];

const TOPIC_SET = new Set<string>(TOPIC_IDS);
const ALLOWED   = TOPIC_IDS.join(', ');

/**
 * KAN-123 — shared aspect extractor for own + competitor reviews.
 * Returns up to 6 topic IDs from TOPIC_IDS with wording-derived polarity.
 * Empty `topics` / `topic_sentiment: '{}'` on failure or no valid topics.
 */
export async function batchExtractTopics(
  reviews: Array<{ text: string }>,
  costTrackingId?: string,
): Promise<Array<{ topics: string; topic_sentiment: string }>> {
  const empty = { topics: '', topic_sentiment: '{}' };
  if (reviews.length === 0) return [];

  const itemsStr = reviews
    .map((r, i) => `[${i}] "${r.text.substring(0, 1500)}"`)
    .join('\n');

  try {
    const result = await invokeLLM({
      prompt: `Extract topics from these reviews. For each review pick up to 6 topics from this exact list only: ${ALLOWED}. Map any phrasing to the nearest id — do not invent new labels.\n\nPolarity rules (must follow):\n- Derive polarity ONLY from the wording of that specific topic — NEVER from the star rating or overall tone.\n- A 5-star review can have a topic marked "negative" if the wording criticizes it.\n- If the wording for a topic has no clear positive or negative signal → assign "neutral". Do not guess.\n\nExamples:\n"האוכל היה מעולה אבל השירות איטי ומאכזב" (5★) → {topics:["quality","service"], sentiments:{quality:"positive",service:"negative"}}\n"מקום סביר, היינו שם" → {topics:["atmosphere"], sentiments:{atmosphere:"neutral"}}\n\n${itemsStr}\nReturn ONLY valid JSON: {"results":[{"topics":["service"],"sentiments":{"service":"positive"}},...]}, same length and order as input.`,
      response_json_schema: { type: 'object' },
      model: 'haiku',
      maxTokens: 900,
      costTrackingId,
    });

    const results: any[] = result?.results || [];
    return reviews.map((_, i) => {
      const item = results[i];
      if (!item?.topics || !Array.isArray(item.topics)) return empty;
      const valid = (item.topics as string[]).filter(t => TOPIC_SET.has(t)).slice(0, 6);
      if (valid.length === 0) return empty;
      const sentiments: Record<string, string> = {};
      for (const t of valid) {
        if (item.sentiments?.[t]) sentiments[t] = item.sentiments[t];
      }
      // AC5: topic_sentiment must be non-empty when topics are present
      if (Object.keys(sentiments).length === 0) return empty;
      return { topics: valid.join(','), topic_sentiment: JSON.stringify(sentiments) };
    });
  } catch {
    return reviews.map(() => empty);
  }
}
