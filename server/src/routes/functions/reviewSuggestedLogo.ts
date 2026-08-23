import { Request, Response } from 'express';
import { prisma } from '../../db';

/**
 * reviewSuggestedLogo — owner's verdict on the current AI-generated candidate
 * logo (see generateLogo.ts), same accept/reject pattern as the organic-post
 * review popup. Accept just marks it; reject discards the candidate (clears
 * the suggestion and its MediaAsset row) so the "generate a new logo" CTA
 * reappears. "Request change" isn't a distinct action here — the frontend
 * just calls generateLogo again with feedback, which produces a fresh
 * candidate and resets suggested_logo_accepted.
 *
 * Body: { businessProfileId, platform, action: 'accept' | 'reject' }
 */
export async function reviewSuggestedLogo(req: Request, res: Response) {
  const { businessProfileId, platform, action } = req.body;
  if (!businessProfileId || !platform || !['accept', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Missing businessProfileId/platform, or invalid action' });
  }

  try {
    const social = await prisma.businessSocialProfile.findFirst({
      where: { linked_business: businessProfileId, platform },
    });
    if (!social?.suggested_logo_url) {
      return res.status(400).json({ error: 'No suggested logo to review' });
    }

    if (action === 'accept') {
      await prisma.businessSocialProfile.update({
        where: { id: social.id },
        data: { suggested_logo_accepted: true },
      });
      return res.json({ platform, accepted: true });
    }

    await prisma.mediaAsset.deleteMany({
      where: { linked_business: businessProfileId, used_in: 'logo', url: social.suggested_logo_url },
    });
    await prisma.businessSocialProfile.update({
      where: { id: social.id },
      data: { suggested_logo_url: null, suggested_logo_at: null, suggested_logo_accepted: null },
    });
    return res.json({ platform, accepted: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
