import { Request, Response } from 'express';
import { prisma } from '../../db';
import { describeLogo } from '../../lib/describeLogo';
import { synthesizeLogoTrends, LogoDescription } from '../../lib/synthesizeLogoTrends';

const MAX_LOGOS_PER_CALL = 10; // one vision call per logo (not batched), keep tight to bound cost

/**
 * analyzeLogoTrends — vision-describes a sample of tracked competitors'
 * logos/profile pictures (one vision call each) and synthesizes what's
 * visually common across them (BusinessProfile.content_trends_logo_insight),
 * the grounding context critiqueOwnLogo uses for the business's own logo.
 *
 * Body: { businessProfileId }
 */
export async function analyzeLogoTrends(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const rows = await (prisma as any).$queryRawUnsafe(
      `SELECT csp.profile_picture_url, c.name AS competitor_name
       FROM competitor_social_profiles csp
       JOIN competitors c ON c.id = csp.competitor_id
       WHERE csp.linked_business = $1 AND c.tracking_status = 'approved'
         AND csp.profile_picture_url IS NOT NULL
       LIMIT $2`,
      businessProfileId, MAX_LOGOS_PER_CALL,
    ) as { profile_picture_url: string; competitor_name: string }[];

    const descriptions: LogoDescription[] = [];
    for (const r of rows) {
      const description = await describeLogo(r.profile_picture_url);
      if (description) descriptions.push({ competitorName: r.competitor_name, description });
    }

    let logoInsight: string | null = null;
    if (descriptions.length) {
      logoInsight = await synthesizeLogoTrends(descriptions);
      if (logoInsight) {
        await prisma.businessProfile.update({
          where: { id: businessProfileId },
          data: { content_trends_logo_insight: logoInsight, content_trends_logo_insight_at: new Date().toISOString() },
        }).catch(() => {});
      }
    }

    return res.json({ logos_analyzed: descriptions.length, content_trends_logo_insight: logoInsight });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
