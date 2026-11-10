import { prisma } from '../db';
import { BizLocale, IL_LOCALE, localeOf, searchGeo } from './locale';

// ponytail: per-process cache — a collector asks once per post; a changed locale shows up within TTL_MS.
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; loc: BizLocale }>();

/**
 * Language + timezone of a business. `locale` / `timezone` are raw-SQL columns (index.ts), like
 * notification_email — not in the Prisma model. No id, or a failed lookup, is Hebrew / Israel time.
 */
export async function businessLocale(bpId?: string | null): Promise<BizLocale> {
  if (!bpId) return IL_LOCALE;
  const hit = cache.get(bpId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.loc;
  try {
    const rows = await prisma.$queryRaw<{ locale: string | null; timezone: string | null }[]>`
      SELECT locale, timezone FROM business_profiles WHERE id = ${bpId}`;
    const loc = localeOf(rows[0]);
    cache.set(bpId, { at: Date.now(), loc });
    return loc;
  } catch (e: any) {
    console.warn('[businessLocale] lookup failed, using Hebrew defaults:', e.message);
    return IL_LOCALE;
  }
}

/** Search region + language of a business (see SearchGeo). No id, or a failed lookup, is Israel. */
export const businessGeo = async (bpId?: string | null) => searchGeo(await businessLocale(bpId));
