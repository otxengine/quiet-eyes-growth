import { Request, Response } from 'express';
import { prisma } from '../../db';
import { applyOutlierAnalysis } from '../../lib/outlierPostAnalysis';
import { synthesizeContentTrends, ContentTrendPostSummary } from '../../lib/synthesizeContentTrends';

const MAX_POSTS_PER_CALL = 20; // pooled across all competitors, so a bit higher than the single-competitor cap

/**
 * analyzeContentTrends — like analyzeTopCompetitorPosts, but pools engagement-
 * outlier posts from ALL of a business's tracked competitors and synthesizes
 * a copy insight + a visual insight (BusinessProfile.content_trends_copy_insight /
 * content_trends_visual_insight) describing the pattern(s) recurring across the
 * whole competitive set, not one competitor.
 *
 * Body: { businessProfileId, posts: [{ id, competitorId, engagementMultiple }], force? }
 */
export async function analyzeContentTrends(req: Request, res: Response) {
  const { businessProfileId, posts, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (!Array.isArray(posts) || posts.length === 0) return res.status(400).json({ error: 'Missing posts' });

  try {
    const requested = posts.slice(0, MAX_POSTS_PER_CALL);
    const ids = requested.map((p: any) => p.id);
    const multById = new Map(requested.map((p: any) => [p.id, Number(p.engagementMultiple) || 2]));

    const owned = await (prisma as any).$queryRawUnsafe(
      `SELECT p.id FROM competitor_posts p
       JOIN competitors c ON c.id = p.competitor_id
       WHERE p.linked_business = $1 AND p.id = ANY($2::text[]) AND c.tracking_status = 'approved'`,
      businessProfileId, ids,
    ) as { id: string }[];
    const ownedIds = new Set(owned.map(r => r.id));

    let analyzed = 0, skipped = 0;
    for (const p of requested) {
      if (!ownedIds.has(p.id)) continue;
      const result = await applyOutlierAnalysis('competitor_posts', p.id, multById.get(p.id) ?? 2, !!force);
      if (result.analyzed) analyzed++;
      if (result.skipped) skipped++;
    }

    let copyInsight: string | null = null;
    let visualInsight: string | null = null;
    let copyExamples: { competitorName: string; text: string }[] = [];
    if (ownedIds.size) {
      const rows = await (prisma as any).$queryRawUnsafe(
        `SELECT p.id, p.platform, p.analysis, c.name AS competitor_name
         FROM competitor_posts p JOIN competitors c ON c.id = p.competitor_id
         WHERE p.id = ANY($1::text[])`,
        [...ownedIds],
      ) as { id: string; platform: string; analysis: string | null; competitor_name: string }[];

      const summaries: ContentTrendPostSummary[] = rows.flatMap(r => {
        let a: any = null;
        try { a = r.analysis ? JSON.parse(r.analysis) : null; } catch { /* ignore malformed */ }
        if (!a?.hook) return [];
        return [{
          competitorName: r.competitor_name,
          platform: r.platform,
          engagementMultiple: multById.get(r.id) ?? 2,
          topic: a.topic ?? null,
          hook: a.hook,
          content_pillar: a.content_pillar ?? null,
          audience_action_driver: a.audience_action_driver ?? null,
          text_hooks: Array.isArray(a.text_hooks) ? a.text_hooks : [],
          cta: a.cta ?? null,
          visual_hooks: Array.isArray(a.visual_hooks) ? a.visual_hooks : [],
          style: a.style ?? null,
        }];
      });

      if (summaries.length) {
        const trends = await synthesizeContentTrends(summaries);
        copyInsight = trends.copy_insight;
        visualInsight = trends.visual_insight;
        copyExamples = trends.copy_examples;
        if (copyInsight || visualInsight) {
          await prisma.businessProfile.update({
            where: { id: businessProfileId },
            data: {
              content_trends_copy_insight: copyInsight,
              content_trends_copy_examples: copyExamples.length ? JSON.stringify(copyExamples) : null,
              content_trends_visual_insight: visualInsight,
              content_trends_insight_at: new Date().toISOString(),
            },
          }).catch(() => {});
        }
      }
    }

    return res.json({
      analyzed, skipped, requested: posts.length,
      content_trends_copy_insight: copyInsight,
      content_trends_copy_examples: copyExamples,
      content_trends_visual_insight: visualInsight,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
