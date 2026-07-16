import { prisma } from '../../db';

export interface ThemeCount {
  theme: string;
  positive: number;
  negative: number;
  neutral: number;
  total: number;
}

/**
 * Aggregates topic_sentiment JSON blobs from reviews into per-topic polarity counts.
 * windowDays defaults to 90.
 */
export async function computeThemeRollup(
  businessProfileId: string,
  windowDays = 90,
): Promise<ThemeCount[]> {
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const reviews = await prisma.review.findMany({
    where: {
      linked_business: businessProfileId,
      created_date: { gte: since.toISOString() },
      topic_sentiment: { not: null },
    },
    select: { topic_sentiment: true },
  });

  const counts: Record<string, { positive: number; negative: number; neutral: number }> = {};

  for (const r of reviews) {
    if (!r.topic_sentiment) continue;
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(r.topic_sentiment);
    } catch {
      continue;
    }
    for (const [topic, polarity] of Object.entries(parsed)) {
      if (!counts[topic]) counts[topic] = { positive: 0, negative: 0, neutral: 0 };
      const key = polarity === 'positive' ? 'positive' : polarity === 'negative' ? 'negative' : 'neutral';
      counts[topic][key]++;
    }
  }

  return Object.entries(counts)
    .map(([theme, c]) => ({ theme, ...c, total: c.positive + c.negative + c.neutral }))
    .sort((a, b) => b.total - a.total);
}
