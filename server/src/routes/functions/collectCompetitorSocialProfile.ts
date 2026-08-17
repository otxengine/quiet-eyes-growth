import { Request, Response } from 'express';
import { prisma } from '../../db';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { writeAutomationLog } from '../../lib/automationLog';
import { uploadImageFromUrl, isS3Configured } from '../../lib/s3';
import { findDonorCandidates } from '../../lib/competitorDonor';

// Competitor twin of collectOwnSocialProfile.ts — same actor (apify/instagram-profile-scraper)
// and field extraction, but per-competitor and donor-cache-aware like collectCompetitorSocialPosts.ts
// and detectCompetitorAds.ts (the same real-world competitor is often tracked by multiple
// businesses, so a fresh scrape from one is cloned instead of re-scraping). Instagram-only,
// matching the own-business version.

const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h between full runs
const PER_COMP_INTERVAL_MS = 24 * 60 * 60 * 1000; // skip individual competitor if scraped within 24h
const INSTAGRAM_PROFILE_ACTOR = 'apify~instagram-profile-scraper';

function usernameFromUrl(url: string): string {
  return url.replace(/\/+$/, '').split('/').pop() || url;
}

function numOrNull(v: any): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function boolOrNull(v: any): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

// The actor sometimes returns the literal string "None" instead of omitting
// businessCategoryName when a business account hasn't set a category.
function strOrNull(v: any): string | null {
  return v && v !== 'None' ? v : null;
}

type ProfileFields = {
  profile_picture_url: string | null;
  cover_photo_url: string | null;
  bio: string | null;
  external_url: string | null;
  follower_count: number | null;
  following_count: number | null;
  post_count: number | null;
  is_verified: boolean | null;
  is_business_account: boolean | null;
  category: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_address: string | null;
  highlight_count: number | null;
  highlights: string | null;
};

async function scrapeInstagram(url: string): Promise<ProfileFields | null> {
  const [item] = await runApifyActor(INSTAGRAM_PROFILE_ACTOR, { usernames: [usernameFromUrl(url)] });
  if (!item || item.error) return null;
  return {
    profile_picture_url: item.profilePicUrlHD || item.profilePicUrl || null,
    cover_photo_url: null,
    bio: item.biography || null,
    external_url: item.externalUrl || null,
    follower_count: numOrNull(item.followersCount),
    following_count: numOrNull(item.followsCount),
    post_count: numOrNull(item.postsCount),
    is_verified: boolOrNull(item.verified),
    is_business_account: boolOrNull(item.isBusinessAccount),
    category: strOrNull(item.businessCategoryName),
    contact_phone: item.publicPhoneNumber || item.businessPhoneNumber || null,
    contact_email: item.publicEmail || item.businessEmail || null,
    contact_address: item.publicAddress || item.businessAddress || null,
    highlight_count: numOrNull(item.highlightReelCount),
    highlights: null,
  };
}

// Cross-business cache: another business may already have a fresh profile scrape of this
// exact real-world competitor. Runs regardless of `force` — a fresh donor is just as valid
// as a fresh scrape of our own (same rationale as collectCompetitorSocialPosts.ts/detectCompetitorAds.ts).
async function findFreshDonorProfile(comp: any, businessProfileId: string) {
  if (!comp.google_place_id && !comp.instagram_url) return null;
  const candidates = await findDonorCandidates(comp.id, businessProfileId, {
    googlePlaceId: comp.google_place_id ?? null,
    platform: 'instagram',
    urlValue: comp.instagram_url ?? null,
  });
  if (candidates.length === 0) return null;

  const donorIds = candidates.map(d => d.id);
  const freshThreshold = new Date(Date.now() - PER_COMP_INTERVAL_MS);
  const [freshest] = await prisma.competitorSocialProfile.findMany({
    where: { competitor_id: { in: donorIds }, platform: 'instagram', fetched_at: { gte: freshThreshold } },
    orderBy: { fetched_at: 'desc' },
    take: 1,
  });
  return freshest ?? null;
}

async function scrapeAndSave(comp: any, businessProfileId: string) {
  const donor = await findFreshDonorProfile(comp, businessProfileId);
  if (donor) {
    const { id, competitor_id, linked_business, fetched_at, ...fields } = donor;
    await prisma.competitorSocialProfile.upsert({
      where: { competitor_id_platform: { competitor_id: comp.id, platform: 'instagram' } },
      create: { competitor_id: comp.id, linked_business: businessProfileId, platform: 'instagram', ...fields },
      update: { ...fields, fetched_at: new Date() },
    });
    return { competitor: comp.name, saved: true, source: 'donor' };
  }

  const fields = await scrapeInstagram(comp.instagram_url);
  if (!fields) return { competitor: comp.name, saved: false, source: 'scrape' };

  const profile_picture_url = fields.profile_picture_url && isS3Configured()
    ? (await uploadImageFromUrl(fields.profile_picture_url, 'competitor-profile') ?? fields.profile_picture_url)
    : fields.profile_picture_url;

  await prisma.competitorSocialProfile.upsert({
    where: { competitor_id_platform: { competitor_id: comp.id, platform: 'instagram' } },
    create: { competitor_id: comp.id, linked_business: businessProfileId, platform: 'instagram', ...fields, profile_picture_url },
    update: { ...fields, profile_picture_url, fetched_at: new Date() },
  });

  return { competitor: comp.name, saved: true, source: 'scrape' };
}

export async function collectCompetitorSocialProfile(req: Request, res: Response) {
  const { businessProfileId, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  if (!force && shouldSkipAgent(businessProfileId, 'collectCompetitorSocialProfile', MIN_INTERVAL_MS)) {
    return res.json({ saved: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    if (!hasApifyKey()) {
      await writeAutomationLog('collectCompetitorSocialProfile', businessProfileId, startTime, 0, 'success', 'no_apify_key');
      return res.json({ saved: 0, skipped: true, reason: 'no_apify_key' });
    }

    const allCompetitors = await prisma.competitor.findMany({ where: { linked_business: businessProfileId } });
    const competitors = allCompetitors.filter((c: any) => !c.not_relevant && c.tracking_status === 'approved' && c.instagram_url);

    const results: any[] = [];
    for (const comp of competitors) {
      const existing = await prisma.competitorSocialProfile.findUnique({
        where: { competitor_id_platform: { competitor_id: comp.id, platform: 'instagram' } },
      });
      if (!force && existing && Date.now() - existing.fetched_at.getTime() < PER_COMP_INTERVAL_MS) {
        results.push({ competitor: comp.name, saved: false, reason: 'fresh' });
        continue;
      }
      try {
        results.push(await scrapeAndSave(comp, businessProfileId));
      } catch (e: any) {
        console.warn(`[collectCompetitorSocialProfile] ${comp.name}:`, e.message);
        results.push({ competitor: comp.name, saved: false, error: e.message });
      }
    }

    const saved = results.filter(r => r.saved).length;
    setLastRun(businessProfileId, 'collectCompetitorSocialProfile');
    await writeAutomationLog('collectCompetitorSocialProfile', businessProfileId, startTime, saved, 'success');
    return res.json({ saved, diagnostics: results });
  } catch (err: any) {
    await writeAutomationLog('collectCompetitorSocialProfile', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
