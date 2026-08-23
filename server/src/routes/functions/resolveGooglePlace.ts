import { Request, Response } from 'express';
import { prisma } from '../../db';
import { findPlaceId } from '../../lib/googlePlaces';

// Resolves and persists the business's own google_place_id during onboarding,
// so it's already available (e.g. to generate-about) instead of waiting for
// the first post-onboarding collectReviews run. Same lookup collectReviews
// falls back to — first Places text-search match, not a verified/human-confirmed pick.
export async function resolveGooglePlace(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    if (profile.google_place_id) {
      return res.json({ google_place_id: profile.google_place_id, already_set: true });
    }

    const placeId = await findPlaceId(profile.name, profile.city);
    if (placeId) {
      await prisma.businessProfile.update({
        where: { id: businessProfileId },
        data: { google_place_id: placeId, google_place_id_verified: true },
      });
    }
    return res.json({ google_place_id: placeId, already_set: false });
  } catch (err: any) {
    console.warn('[resolveGooglePlace] failed:', err.message);
    return res.json({ google_place_id: null, error: err.message });
  }
}
