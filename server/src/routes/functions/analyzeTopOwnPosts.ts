import { Request, Response } from 'express';
import { prisma } from '../../db';
import { applyOutlierAnalysis } from '../../lib/outlierPostAnalysis';
import { synthesizeOutlierInsight, OutlierPostSummary } from '../../lib/synthesizeOutlierInsight';

const MAX_POSTS_PER_CALL = 15; // outlier sets are small by construction; this is just a defensive cap

/**
 * analyzeTopOwnPosts — AI hook/content-pillar/audience-action-driver analysis
 * for the business's own detected engagement-outlier posts, plus a synthesized
 * cross-post insight (BusinessProfile.outlier_insight) explaining the common
 * pattern(s) across the whole outlier set.
 *
 * Body: { businessProfileId, posts: [{ id, engagementMultiple }], force? }
 */
export async function analyzeTopOwnPosts(req: Request, res: Response) {
  const { businessProfileId, posts, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (!Array.isArray(posts) || posts.length === 0) return res.status(400).json({ error: 'Missing posts' });

  try {
    const requested = posts.slice(0, MAX_POSTS_PER_CALL);
    const ids = requested.map((p: any) => p.id);
    const multById = new Map(requested.map((p: any) => [p.id, Number(p.engagementMultiple) || 2]));

    // Typed Prisma, not raw SQL — this only selects `id` (clean cuid text), so
    // it doesn't need the invalid-byte-sequence workaround other queries in
    // this codebase use for TEXT columns with scraped caption/analysis content.
    // Also avoid `id: { in: ids } }` — Prisma compiles that to an `= ANY($N)`
    // array-bind param, which silently returned zero rows in production here
    // (both as raw SQL and as typed Prisma) — looks like Supabase's PgBouncer
    // transaction-pooling mishandling array-bound params. `OR` of equality
    // checks sidesteps that wire path entirely — confirmed live.
    const owned = await prisma.businessPost.findMany({
      where: { linked_business: businessProfileId, OR: ids.map((id: string) => ({ id })) },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map(r => r.id));

    let analyzed = 0, skipped = 0;
    for (const p of requested) {
      if (!ownedIds.has(p.id)) continue;
      const result = await applyOutlierAnalysis('business_posts', p.id, multById.get(p.id) ?? 2, !!force);
      if (result.analyzed) analyzed++;
      if (result.skipped) skipped++;
    }

    // Synthesize a cross-post insight for this business's own outlier set.
    let outlierInsight: string | null = null;
    if (ownedIds.size) {
      const rows = await prisma.businessPost.findMany({
        where: { OR: [...ownedIds].map(id => ({ id })) },
        select: { id: true, platform: true, analysis: true },
      });

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
          await prisma.businessProfile.update({
            where: { id: businessProfileId },
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
