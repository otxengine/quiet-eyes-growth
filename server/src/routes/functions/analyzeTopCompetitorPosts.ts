import { Request, Response } from 'express';
import { prisma } from '../../db';
import { applyOutlierAnalysis } from '../../lib/outlierPostAnalysis';
import { synthesizeOutlierInsight, OutlierPostSummary } from '../../lib/synthesizeOutlierInsight';

const MAX_POSTS_PER_CALL = 15; // outlier sets are small by construction; this is just a defensive cap

/**
 * analyzeTopCompetitorPosts — AI hook/content-pillar/audience-action-driver
 * analysis for a competitor's detected engagement-outlier posts, plus a
 * synthesized cross-post insight (Competitor.outlier_insight) explaining the
 * common pattern(s) across the whole outlier set.
 *
 * Body: { businessProfileId, posts: [{ id, engagementMultiple }], force? }
 */
export async function analyzeTopCompetitorPosts(req: Request, res: Response) {
  const { businessProfileId, posts, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (!Array.isArray(posts) || posts.length === 0) return res.status(400).json({ error: 'Missing posts' });

  try {
    const requested = posts.slice(0, MAX_POSTS_PER_CALL);
    const ids = requested.map((p: any) => p.id);
    const multById = new Map(requested.map((p: any) => [p.id, Number(p.engagementMultiple) || 2]));

    const owned = await (prisma as any).$queryRawUnsafe(
      `SELECT p.id, p.competitor_id FROM competitor_posts p
       JOIN competitors c ON c.id = p.competitor_id
       WHERE p.linked_business = $1 AND p.id = ANY($2::text[]) AND c.tracking_status = 'approved'`,
      businessProfileId, ids,
    ) as { id: string; competitor_id: string }[];
    const ownedIds = new Set(owned.map(r => r.id));

    let analyzed = 0, skipped = 0;
    for (const p of requested) {
      if (!ownedIds.has(p.id)) continue;
      const result = await applyOutlierAnalysis('competitor_posts', p.id, multById.get(p.id) ?? 2, !!force);
      if (result.analyzed) analyzed++;
      if (result.skipped) skipped++;
    }

    // Synthesize a cross-post insight for the competitor these outliers belong
    // to (in practice always one competitor per call — outliers come from a
    // single RivalCard's own post set).
    let outlierInsight: string | null = null;
    const competitorId = owned[0]?.competitor_id;
    if (competitorId) {
      const rows = await (prisma as any).$queryRawUnsafe(
        `SELECT id, platform, analysis FROM competitor_posts WHERE id = ANY($1::text[])`,
        [...ownedIds],
      ) as { id: string; platform: string; analysis: string | null }[];

      const summaries: OutlierPostSummary[] = rows.flatMap(r => {
        let a: any = null;
        try { a = r.analysis ? JSON.parse(r.analysis) : null; } catch { /* ignore malformed */ }
        if (!a?.hook) return [];
        return [{
          platform: r.platform,
          engagementMultiple: multById.get(r.id) ?? 2,
          topic: a.topic ?? null,
          hook: a.hook,
          content_pillar: a.content_pillar ?? null,
          audience_action_driver: a.audience_action_driver ?? null,
        }];
      });

      if (summaries.length) {
        outlierInsight = await synthesizeOutlierInsight(summaries);
        if (outlierInsight) {
          await prisma.competitor.update({
            where: { id: competitorId },
            data: { outlier_insight: outlierInsight, outlier_insight_at: new Date().toISOString() },
          }).catch(() => {});
        }
      }
    }

    return res.json({ analyzed, skipped, requested: posts.length, outlier_insight: outlierInsight });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
