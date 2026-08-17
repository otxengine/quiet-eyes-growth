import { Request, Response } from 'express';
import { prisma } from '../../db';
import { applyOutlierAnalysis } from '../../lib/outlierPostAnalysis';

const MAX_POSTS_PER_CALL = 15; // outlier sets are small by construction; this is just a defensive cap

/**
 * analyzeTopOwnPosts — AI hook/content-pillar/audience-action-driver analysis
 * for the business's own detected engagement-outlier posts.
 *
 * Body: { businessProfileId, posts: [{ id, engagementMultiple }], force? }
 */
export async function analyzeTopOwnPosts(req: Request, res: Response) {
  const { businessProfileId, posts, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (!Array.isArray(posts) || posts.length === 0) return res.status(400).json({ error: 'Missing posts' });

  try {
    const ids = posts.slice(0, MAX_POSTS_PER_CALL).map((p: any) => p.id);
    const owned = await (prisma as any).$queryRawUnsafe(
      `SELECT id FROM business_posts WHERE linked_business = $1 AND id = ANY($2::text[])`,
      businessProfileId, ids,
    ) as { id: string }[];
    const ownedIds = new Set(owned.map(r => r.id));

    let analyzed = 0, skipped = 0;
    for (const p of posts.slice(0, MAX_POSTS_PER_CALL)) {
      if (!ownedIds.has(p.id)) continue;
      const result = await applyOutlierAnalysis('business_posts', p.id, Number(p.engagementMultiple) || 2, !!force);
      if (result.analyzed) analyzed++;
      if (result.skipped) skipped++;
    }

    return res.json({ analyzed, skipped, requested: posts.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
