import { Request, Response } from 'express';
import { prisma } from '../../db';
import { extractSocialLinksFromWebsite } from '../../lib/extractSocialLinksFromWebsite';
import { writeAutomationLog } from '../../lib/automationLog';
import { getPlaceDetails } from '../../lib/googlePlaces';
import { searchOrganic } from '../../lib/dataforseo';
import { serpGoogleOrganic } from '../../lib/serpapi';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';
import { SITE_BLACKLIST, IG_NON_PROFILE, FB_NON_PROFILE, isProfileUrl, handleMatchesBusiness } from './discoverCompetitorUrls';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CATCH_UP_CAP = 10; // same cap as discoverCompetitorUrls' own scheduler job

function isValidHost(url: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
}

// KAN-220 "SERP transport" AC: DataForSEO organic is primary, SerpAPI is the soft-fail fallback.
async function organicSearch(queries: string[]): Promise<string[]> {
  const df = await Promise.all(queries.map(searchOrganic));
  const dfUrls = df.flatMap(r => r.urls);
  if (dfUrls.length) return dfUrls;
  const sp = await Promise.all(queries.map(serpGoogleOrganic));
  return sp.flat();
}

type Found = { url: string; source: 'places' | 'site_extract' | 'serp' | 'tavily' };

// KAN-220 AC3: Places Details (if place_id) → organic SERP → Tavily last resort.
async function enrichWebsite(placeId: string | null | undefined, name: string, loc: string | null | undefined): Promise<Found | null> {
  if (placeId) {
    const details = await getPlaceDetails(placeId);
    if (details.websiteUri && isValidHost(details.websiteUri)) return { url: details.websiteUri, source: 'places' };
  }
  const location = loc || '';
  const validHost = (u: string) => isValidHost(u) && !SITE_BLACKLIST.some(b => u.includes(b));

  const serpHit = (await organicSearch([`"${name}" ${location}`, `"${name}" אתר`])).find(validHost);
  if (serpHit) return { url: serpHit, source: 'serp' };

  if (isTavilyRateLimited()) return null;
  const tavilyResults = await tavilySearch(`"${name}" ${location} אתר רשמי`, 3);
  const tavilyHit = tavilyResults.map((r: any) => r.url).find(validHost);
  return tavilyHit ? { url: tavilyHit, source: 'tavily' } : null;
}

// KAN-220 AC4/AC6: organic SERP → Tavily last resort for one still-empty social platform.
async function enrichSocial(domain: string, nonProfile: string[], name: string, loc: string | null | undefined): Promise<Found | null> {
  const location = loc || '';
  const matches = (u: string) => isProfileUrl(u, `${domain}/`, nonProfile) && handleMatchesBusiness(u, name, null);

  const serpHit = (await organicSearch([`"${name}" ${location} site:${domain}`, `"${name}" site:${domain}`])).find(matches);
  if (serpHit) return { url: serpHit, source: 'serp' };

  if (isTavilyRateLimited()) return null;
  const tavilyResults = await tavilySearch(`"${name}" ${location} site:${domain}`, 3);
  const tavilyHit = tavilyResults.map((r: any) => r.url).find(matches);
  return tavilyHit ? { url: tavilyHit, source: 'tavily' } : null;
}

const SOCIAL_PLATFORMS: [string, string, string[]][] = [
  ['instagram_url', 'instagram.com', IG_NON_PROFILE],
  ['facebook_url',  'facebook.com',  FB_NON_PROFILE],
];

/**
 * enrichCompetitorUrls — KAN-219 (site-extract) + KAN-220 (ordered fallback).
 *
 * Primary: site-extract off the competitor's own website_url (KAN-218's
 * extractSocialLinksFromWebsite). For fields still empty afterwards — including a
 * missing website_url itself — falls back in order: Places Details (if place_id) /
 * organic SERP (DataForSEO → SerpAPI soft-fail), then Tavily strictly last (AC3/AC4/AC6).
 * Fill-if-empty only (AC5 — never overwrites a manual or previously-set value). Called
 * inline from runCompetitorIdentification for the batch of touched ids (AC0), not on a
 * deferred scheduler tick — independent of the snapshot 6h/7d skip (AC2).
 */
export async function enrichCompetitorUrls(
  competitorIds: string[],
  opts: { force?: boolean } = {}
): Promise<{ enriched: number; skipped: number }> {
  if (!competitorIds.length) return { enriched: 0, skipped: 0 };

  const competitors = await prisma.competitor.findMany({ where: { id: { in: competitorIds } } });

  let enriched = 0;
  let skipped = 0;

  for (const c of competitors) {
    const comp = c as any;
    const update: Record<string, any> = {};
    let attempted = false;

    // AC3 — website missing: paid-tier fallback before giving up on it
    if (!comp.website_url) {
      const found = await enrichWebsite(comp.google_place_id, comp.name, comp.address);
      if (found) { update.website_url = found.url; update.website_url_source = found.source; attempted = true; }
    }

    // Google rating/review_count — independent of website_url, so a competitor that
    // already has its website filled (and so never hits enrichWebsite's Places call
    // above) still gets these backfilled once it has a place_id.
    if (comp.google_place_id && (comp.rating == null || comp.review_count == null)) {
      const details = await getPlaceDetails(comp.google_place_id);
      if (comp.rating == null && details.rating != null) { update.rating = details.rating; attempted = true; }
      if (comp.review_count == null && details.reviewCount != null) { update.review_count = details.reviewCount; attempted = true; }
    }

    const websiteForExtract = update.website_url || comp.website_url;
    const anySocialEmpty = !comp.instagram_url || !comp.facebook_url;

    // KAN-219 — site-extract stays the primary social source
    if (websiteForExtract && (anySocialEmpty || opts.force)) {
      attempted = true;
      const links = await extractSocialLinksFromWebsite(websiteForExtract);
      if (links.instagram_url && !comp.instagram_url) { update.instagram_url = links.instagram_url; update.instagram_url_source = 'site_extract'; }
      if (links.facebook_url  && !comp.facebook_url)  { update.facebook_url  = links.facebook_url;  update.facebook_url_source  = 'site_extract'; }
    }

    // AC4/AC6 — still-empty socials after site-extract: paid-tier fallback, never re-spend on a filled field
    for (const [field, domain, nonProfile] of SOCIAL_PLATFORMS) {
      if (comp[field] || update[field]) continue;
      const found = await enrichSocial(domain, nonProfile, comp.name, comp.address);
      if (found) { update[field] = found.url; update[`${field}_source`] = found.source; attempted = true; }
    }

    if (!attempted && Object.keys(update).length === 0) { skipped++; continue; }

    // Fill-if-empty (AC5) — stamp TTL whenever real enrichment work ran (found or soft-empty)
    update.social_pages_crawled_at = new Date().toISOString();
    await prisma.competitor.update({ where: { id: comp.id }, data: update }).catch(() => {});
    enriched++;
  }

  return { enriched, skipped };
}

/**
 * enrichCompetitorUrlsScheduled — KAN-221: dedicated scheduler catch-up.
 * Own TTL (~7d) + cap, independent of batchSnapshotCompetitors' 6h last_scanned skip.
 * Catches up rivals with a website_url but any social field empty OR crawled >7d ago;
 * `force` bypasses that filter and re-runs the capped batch regardless of freshness.
 */
export async function enrichCompetitorUrlsScheduled(req: Request, res: Response) {
  const { businessProfileId, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const staleCutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
    const candidates = await prisma.competitor.findMany({
      where: {
        linked_business: businessProfileId,
        // No website_url requirement — a competitor whose first enrichment attempt
        // found nothing shouldn't be permanently excluded from catch-up.
        ...(force ? {} : {
          OR: [
            { website_url: null },
            { instagram_url: null },
            { facebook_url: null },
            { rating: null },
            { review_count: null },
            { social_pages_crawled_at: null },
            { social_pages_crawled_at: { lt: staleCutoff } },
          ],
        }),
      },
      // Postgres sorts NULL last in ASC order by default — without `nulls: 'first'`,
      // never-crawled competitors get starved out of the top-N by already-crawled ones.
      orderBy: { social_pages_crawled_at: { sort: 'asc', nulls: 'first' } },
      take: CATCH_UP_CAP,
      select: { id: true },
    });

    const result = await enrichCompetitorUrls(candidates.map((c: any) => c.id), { force });
    await writeAutomationLog('enrichCompetitorUrlsScheduled', businessProfileId, startTime, result.enriched);
    return res.json(result);
  } catch (err: any) {
    console.error('[enrichCompetitorUrlsScheduled] error:', err.message);
    await writeAutomationLog('enrichCompetitorUrlsScheduled', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
