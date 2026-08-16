import { prisma } from '../db';

const URL_COLUMNS = { instagram: 'instagram_url', facebook: 'facebook_url', tiktok: 'tiktok_url' } as const;
export type DonorPlatform = keyof typeof URL_COLUMNS;

export interface DonorCandidate {
  id: string;
  linked_business: string;
}

/**
 * Finds other businesses' Competitor rows that identify the SAME real-world
 * competitor as the one being scraped/analyzed — used to clone already-scraped
 * public content instead of paying for Apify/SearchAPI/LLM calls again.
 *
 * Exact-match only (google_place_id or the exact platform URL string) — no
 * normalized-URL fuzzy matching in this version. Excludes the requesting
 * competitor/business, and only considers donors that are themselves approved
 * and not dismissed/irrelevant (don't borrow from a shadow/rejected row).
 */
export async function findDonorCandidates(
  excludeCompetitorId: string,
  excludeBusinessId: string,
  identity: { googlePlaceId?: string | null; platform: DonorPlatform; urlValue?: string | null },
): Promise<DonorCandidate[]> {
  const { googlePlaceId, platform, urlValue } = identity;
  if (!googlePlaceId && !urlValue) return [];

  const urlColumn = URL_COLUMNS[platform];
  const rows = await (prisma as any).$queryRawUnsafe(
    `SELECT id, linked_business FROM competitors
     WHERE id != $1 AND linked_business != $2
       AND tracking_status = 'approved' AND not_relevant = false
       AND ( ($3::text IS NOT NULL AND google_place_id = $3) OR "${urlColumn}" = $4 )`,
    excludeCompetitorId, excludeBusinessId, googlePlaceId ?? null, urlValue ?? null,
  ) as DonorCandidate[];

  return rows;
}
