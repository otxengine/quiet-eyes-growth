import { Request, Response } from 'express';
import { prisma } from '../../db';
import { critiqueOwnLogo } from '../../lib/critiqueOwnLogo';

/**
 * critiqueLogo — vision-critiques the business's OWN logo/profile picture per
 * platform, grounded in the visual pattern already synthesized across
 * tracked competitors (content_trends_logo_insight). Requires that
 * analyzeLogoTrends has already run.
 *
 * Body: { businessProfileId, platform? } — platform restricts the critique to
 * one own platform instead of every platform with a picture.
 */
export async function critiqueLogo(req: Request, res: Response) {
  const { businessProfileId, platform } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });
    if (!profile.content_trends_logo_insight) {
      return res.status(400).json({ error: 'Run competitor logo analysis first (content_trends_logo_insight is empty)' });
    }

    const ownProfiles = await prisma.businessSocialProfile.findMany({
      where: { linked_business: businessProfileId, profile_picture_url: { not: null }, ...(platform ? { platform } : {}) },
    });
    if (!ownProfiles.length) return res.status(400).json({ error: 'No own logo found to critique' });

    const critiques: { platform: string; critique: string | null; needs_redesign: boolean }[] = [];
    for (const p of ownProfiles) {
      const result = await critiqueOwnLogo({
        businessName: profile.name,
        category: profile.category,
        platform: p.platform,
        logoUrl: p.profile_picture_url as string,
        competitorLogoInsight: profile.content_trends_logo_insight,
      });
      critiques.push({ platform: p.platform, critique: result.critique, needs_redesign: result.needs_redesign });
      if (result.critique) {
        await prisma.businessSocialProfile.updateMany({
          where: { linked_business: businessProfileId, platform: p.platform },
          data: {
            logo_critique: result.critique,
            logo_critique_at: new Date().toISOString(),
            logo_needs_redesign: result.needs_redesign,
          },
        }).catch(() => {});
      }
    }

    return res.json({ critiques });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
