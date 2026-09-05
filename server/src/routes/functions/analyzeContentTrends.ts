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

    // Typed Prisma, not raw SQL — see analyzeTopOwnPosts.ts for why. Also
    // avoid `id: { in: ids } }` there and here — it compiles to an `= ANY($N)`
    // array-bind param, which silently returned zero rows in production
    // (both as raw SQL and as typed Prisma) — looks like Supabase's PgBouncer
    // transaction-pooling mishandling array-bound params. `OR` of equality
    // checks sidesteps that wire path entirely — confirmed live.
    const owned = await prisma.competitorPost.findMany({
      where: {
        linked_business: businessProfileId,
        OR: ids.map((id: string) => ({ id })),
        competitor: { tracking_status: 'approved' },
      },
      select: { id: true },
    });
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
      const postRows = await prisma.competitorPost.findMany({
        where: { OR: [...ownedIds].map(id => ({ id })) },
        select: { id: true, platform: true, analysis: true, competitor: { select: { name: true } } },
      });
      const rows = postRows.map(r => ({ id: r.id, platform: r.platform, analysis: r.analysis, competitor_name: r.competitor.name }));

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
