import { Request, Response } from 'express';
import { prisma } from '../../db';
import { suggestOwnBioFix } from '../../lib/suggestOwnBioFix';

/**
 * suggestBioFix — takes the business's OWN social bio(s) and suggests a
 * rewrite for each platform, grounded in the winning-bio pattern already
 * synthesized across tracked competitors (content_trends_bio_insight/
 * _examples). Requires that bio-trends analysis has already run.
 *
 * Body: { businessProfileId }
 */
export async function suggestBioFix(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });
    if (!profile.content_trends_bio_insight) {
      return res.status(400).json({ error: 'Run competitor bio analysis first (content_trends_bio_insight is empty)' });
    }

    const ownProfiles = await prisma.businessSocialProfile.findMany({
      where: { linked_business: businessProfileId, bio: { not: null } },
    });
    const withBio = ownProfiles.filter(p => p.bio?.trim());
    if (!withBio.length) return res.status(400).json({ error: 'No own bio found to suggest a fix for' });

    let competitorBioExamples: { competitorName: string; text: string }[] = [];
    try { competitorBioExamples = profile.content_trends_bio_examples ? JSON.parse(profile.content_trends_bio_examples) : []; }
    catch { /* ignore malformed */ }

    const suggestions: { platform: string; suggested_bio: string | null; rationale: string | null }[] = [];
    for (const p of withBio) {
      const fix = await suggestOwnBioFix({
        businessName: profile.name,
        category: profile.category,
        city: profile.city,
        services: profile.relevant_services,
        platform: p.platform,
        ownBio: p.bio as string,
        competitorBioInsight: profile.content_trends_bio_insight,
        competitorBioExamples,
      });
      suggestions.push({ platform: p.platform, suggested_bio: fix.suggested_bio, rationale: fix.rationale });
      if (fix.suggested_bio) {
        await prisma.businessSocialProfile.updateMany({
          where: { linked_business: businessProfileId, platform: p.platform },
          data: {
            suggested_bio: fix.suggested_bio,
            suggested_bio_rationale: fix.rationale,
            suggested_bio_at: new Date().toISOString(),
          },
        }).catch(() => {});
      }
    }

    return res.json({ suggestions });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
