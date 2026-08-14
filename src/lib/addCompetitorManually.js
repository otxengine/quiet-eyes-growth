import { base44 } from '@/api/base44Client';

/**
 * Creates a manually-added competitor, then auto-discovers whichever
 * website/social URLs the caller didn't already provide. Shared by the
 * onboarding discover-competitors screen and the post-onboarding
 * Competitors page so the two never drift.
 */
export async function addCompetitorManually({ businessProfileId, name, urls = {} }) {
  const providedFields = Object.keys(urls).filter((k) => urls[k]);
  const created = await base44.entities.Competitor.create({
    linked_business: businessProfileId,
    name,
    ...urls,
    manual_url_fields: providedFields,
  });

  if (providedFields.length === 4) return created; // nothing left to discover

  try {
    const result = await base44.raw.post(`/competitors/${created.id}/enrich-urls`, {}, 45000);
    return result.competitor || created;
  } catch {
    return created; // enrichment is best-effort — row is still usable without it
  }
}
