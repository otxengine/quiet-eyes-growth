import { Request, Response } from 'express';
import { prisma } from '../../db';
import { synthesizeBioTrends, BioProfileSummary } from '../../lib/synthesizeBioTrends';

const MAX_PROFILES_PER_CALL = 30; // text-only, no vision cost, so a generous cap

/**
 * analyzeBioProfiles — pools the social bios of ALL of a business's tracked
 * competitors (one per competitor+platform, unlike posts there's nothing to
 * rank/select) and synthesizes what these bios commonly contain and how
 * they're commonly structured (BusinessProfile.content_trends_bio_insight),
 * illustrated with real verbatim bio examples spread across different
 * competitors.
 *
 * Body: { businessProfileId }
 */
export async function analyzeBioProfiles(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const rows = await (prisma as any).$queryRawUnsafe(
      `SELECT csp.platform, csp.bio, c.name AS competitor_name
       FROM competitor_social_profiles csp
       JOIN competitors c ON c.id = csp.competitor_id
       WHERE csp.linked_business = $1 AND c.tracking_status = 'approved'
         AND csp.bio IS NOT NULL AND btrim(csp.bio) <> ''
       LIMIT $2`,
      businessProfileId, MAX_PROFILES_PER_CALL,
    ) as { platform: string; bio: string; competitor_name: string }[];

    const profiles: BioProfileSummary[] = rows.map(r => ({
      competitorName: r.competitor_name,
      platform: r.platform,
      bio: r.bio,
    }));

    let bioInsight: string | null = null;
    let bioExamples: { competitorName: string; text: string }[] = [];
    if (profiles.length) {
      const trends = await synthesizeBioTrends(profiles);
      bioInsight = trends.bio_insight;
      bioExamples = trends.bio_examples;
      if (bioInsight) {
        await prisma.businessProfile.update({
          where: { id: businessProfileId },
          data: {
            content_trends_bio_insight: bioInsight,
            content_trends_bio_examples: bioExamples.length ? JSON.stringify(bioExamples) : null,
            content_trends_bio_insight_at: new Date().toISOString(),
          },
        }).catch(() => {});
      }
    }

    return res.json({
      profiles_analyzed: profiles.length,
      content_trends_bio_insight: bioInsight,
      content_trends_bio_examples: bioExamples,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
