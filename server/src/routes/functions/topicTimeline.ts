import { Request, Response } from 'express';
import { prisma } from '../../db';
import { GOOGLE_REVIEW_SOURCES as GOOGLE_SOURCES } from '../../lib/signalGuard';

interface TopicBucket { period: string; positive: number; negative: number }
interface TopicSeries { topic_id: string; buckets: TopicBucket[] }
type RawMap = Record<string, Record<string, { positive: number; negative: number }>>;

function quarterStart(d: Date): string {
  const year = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${year}-Q${q}`;
}

function parseReviews(
  reviews: { topic_sentiment: string | null; created_date: Date; created_at?: string | null }[],
  allPeriods: Set<string>,
): RawMap {
  const map: RawMap = {};
  for (const r of reviews) {
    if (!r.topic_sentiment) continue;
    let parsed: Record<string, string>;
    try { parsed = JSON.parse(r.topic_sentiment); } catch { continue; }
    // Use actual review publish date for bucketing; fall back to DB insertion time
    const period = quarterStart(r.created_at ? new Date(r.created_at) : r.created_date);
    allPeriods.add(period);
    for (const [topic, polarity] of Object.entries(parsed)) {
      if (!map[topic]) map[topic] = {};
      if (!map[topic][period]) map[topic][period] = { positive: 0, negative: 0 };
      if (polarity === 'positive') map[topic][period].positive++;
      else if (polarity === 'negative') map[topic][period].negative++;
    }
  }
  return map;
}

function toSeries(map: RawMap, allPeriods: Set<string>): TopicSeries[] {
  const periods = [...allPeriods].sort();
  return Object.entries(map).map(([topic_id, periodMap]) => ({
    topic_id,
    buckets: periods.map(period => ({
      period,
      positive: periodMap[period]?.positive ?? 0,
      negative: periodMap[period]?.negative ?? 0,
    })),
  }));
}

/**
 * KAN-146 — Topic timeline aggregation (R3-2).
 * Returns per-topic weekly pos/neg series for own business + active competitors.
 * Google-only. Shape: { own: TopicSeries[], competitors: [{ id, name, series }] }
 */
export async function topicTimeline(req: Request, res: Response) {
  const { businessProfileId, competitorIds, windowDays = 730 } = req.body as {
    businessProfileId?: string;
    competitorIds?: string[];
    windowDays?: number;
  };
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const since = new Date();
    since.setDate(since.getDate() - windowDays);

    const competitors = await prisma.competitor.findMany({
      where: {
        linked_business: businessProfileId,
        is_dismissed: false,
        ...(competitorIds?.length ? { id: { in: competitorIds } } : {}),
      },
      select: { id: true, name: true },
    });

    const baseWhere = {
      created_date: { gte: since },
      topic_sentiment: { not: null },
      source_origin: { in: GOOGLE_SOURCES },
    };

    const [ownReviews, ...compReviews] = await Promise.all([
      prisma.review.findMany({
        where: { ...baseWhere, linked_business: businessProfileId },
        select: { topic_sentiment: true, created_date: true, created_at: true },
      }),
      ...competitors.map(c =>
        prisma.review.findMany({
          // ponytail: spread-ternary avoids strict object-literal check on un-regenerated Prisma client
          where: { ...baseWhere, ...(true ? { linked_competitor: c.id } : {}) },
          select: { topic_sentiment: true, created_date: true, created_at: true },
        }),
      ),
    ]);

    const allPeriods = new Set<string>();
    const ownMap = parseReviews(ownReviews, allPeriods);
    const compMaps = compReviews.map(r => parseReviews(r, allPeriods));

    return res.json({
      own: toSeries(ownMap, allPeriods),
      competitors: competitors.map((c, i) => ({
        id: c.id,
        name: c.name,
        series: toSeries(compMaps[i] ?? {}, allPeriods),
      })),
    });
  } catch (err: any) {
    console.error('[topicTimeline] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
