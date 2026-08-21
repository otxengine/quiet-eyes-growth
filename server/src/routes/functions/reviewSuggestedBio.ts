import { Request, Response } from 'express';
import { prisma } from '../../db';

/**
 * reviewSuggestedBio — owner's verdict on the current AI-suggested bio
 * rewrite (see suggestBioFix.ts), same accept/reject pattern as the
 * organic-post and logo review popups. Accept just marks it; reject
 * discards the suggestion so the "fix my bio" CTA can be run fresh.
 * "Request change" isn't a distinct action here — the frontend just calls
 * suggestBioFix again with feedback, which produces a fresh suggestion and
 * resets suggested_bio_accepted.
 *
 * Body: { businessProfileId, platform, action: 'accept' | 'reject' }
 */
export async function reviewSuggestedBio(req: Request, res: Response) {
  const { businessProfileId, platform, action } = req.body;
  if (!businessProfileId || !platform || !['accept', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Missing businessProfileId/platform, or invalid action' });
  }

  try {
    const social = await prisma.businessSocialProfile.findFirst({
      where: { linked_business: businessProfileId, platform },
    });
    if (!social?.suggested_bio) {
      return res.status(400).json({ error: 'No suggested bio to review' });
    }

    if (action === 'accept') {
      await prisma.businessSocialProfile.update({
        where: { id: social.id },
        data: { suggested_bio_accepted: true },
      });
      return res.json({ platform, accepted: true });
    }

    await prisma.businessSocialProfile.update({
      where: { id: social.id },
      data: { suggested_bio: null, suggested_bio_rationale: null, suggested_bio_at: null, suggested_bio_accepted: null },
    });
    return res.json({ platform, accepted: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
