import { Request, Response } from 'express';
import { prisma } from '../../db';
import { computeThemeRollup } from './computeThemeRollup';

const LOW_CONFIDENCE_THRESHOLD = 50;

function volumeWeightedRating(competitors: { rating: number | null; review_count: number | null }[]) {
  let sumWeightedRating = 0;
  let sumReviews = 0;
  for (const c of competitors) {
    if (c.rating == null || !c.review_count) continue; // AC2: exclude nulls + zero-count
    sumWeightedRating += c.rating * c.review_count;
    sumReviews += c.review_count;
  }
  if (sumReviews === 0) return null;
  return { rating: sumWeightedRating / sumReviews, total_reviews: sumReviews };
}

/**
 * compareGoogleMetrics — KAN-127 / KAN-140
 * Returns Google-only rating + review_count + aspect rollups for own business and each competitor,
 * plus a volume-weighted market aggregate and delta (KAN-140 R2-4).
 */
export async function compareGoogleMetrics(req: Request, res: Response) {
  const { businessProfileId, competitorIds } = req.body as {
    businessProfileId?: string;
    competitorIds?: string[]; // AC3: optional subset
  };
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const [profile, competitors] = await Promise.all([
      prisma.businessProfile.findUnique({ where: { id: businessProfileId } }),
      prisma.competitor.findMany({
        where: {
          linked_business: businessProfileId,
          is_dismissed: false,
          ...(competitorIds?.length ? { id: { in: competitorIds } } : {}),
        },
        select: { id: true, name: true, rating: true, review_count: true },
      }),
    ]);
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const [ownAspects, ...compAspects] = await Promise.all([
      computeThemeRollup(businessProfileId, 90, 'google'),
      ...competitors.map(c => computeThemeRollup(businessProfileId, 90, 'google', c.id)),
    ]);

    const agg = volumeWeightedRating(competitors); // AC1 + AC2
    const ownRating = profile.google_rating ?? null;
    const delta = ownRating != null && agg != null ? ownRating - agg.rating : null;

    return res.json({
      own: {
        google_rating: ownRating,
        review_count: profile.google_review_count ?? null,
        aspects: ownAspects,
      },
      market: agg
        ? {
            rating: agg.rating,
            total_reviews: agg.total_reviews,
            low_confidence: agg.total_reviews < LOW_CONFIDENCE_THRESHOLD, // optional note
          }
        : null,
      delta, // AC4: r_own − r_market
      competitors: competitors.map((c, i) => ({
        id: c.id,
        name: c.name,
        rating: c.rating ?? null,
        review_count: c.review_count ?? null,
        aspects: compAspects[i] ?? [],
      })),
    });
  } catch (err: any) {
    console.error('[compareGoogleMetrics] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
