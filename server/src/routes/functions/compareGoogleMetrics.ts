import { Request, Response } from 'express';
import { prisma } from '../../db';
import { computeThemeRollup } from './computeThemeRollup';

/**
 * compareGoogleMetrics — KAN-127
 * Returns Google-only rating + review_count + aspect rollups for own business and each competitor.
 * Non-Google reviews are excluded from aspects (AC2).
 */
export async function compareGoogleMetrics(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const [profile, competitors] = await Promise.all([
      prisma.businessProfile.findUnique({ where: { id: businessProfileId } }),
      prisma.competitor.findMany({
        where: { linked_business: businessProfileId, is_dismissed: false },
        select: { id: true, name: true, rating: true, review_count: true },
      }),
    ]);
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const [ownAspects, ...compAspects] = await Promise.all([
      computeThemeRollup(businessProfileId, 90, 'google'),
      ...competitors.map(c => computeThemeRollup(businessProfileId, 90, 'google', c.id)),
    ]);

    return res.json({
      own: {
        google_rating: profile.google_rating ?? null,
        review_count: profile.google_review_count ?? null,
        aspects: ownAspects,
      },
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
