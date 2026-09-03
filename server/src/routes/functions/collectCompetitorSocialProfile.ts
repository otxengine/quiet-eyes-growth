import { Request, Response } from 'express';
import { prisma } from '../../db';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { writeAutomationLog } from '../../lib/automationLog';
import { uploadImageFromUrl, isS3Configured } from '../../lib/s3';
import { findDonorCandidates } from '../../lib/competitorDonor';
import { recordFollowerSnapshot } from '../../lib/followerSnapshot';

// Competitor twin of collectOwnSocialProfile.ts, per-platform and donor-cache-aware like
// collectCompetitorSocialPosts.ts and detectCompetitorAds.ts (the same real-world competitor
// is often tracked by multiple businesses, so a fresh scrape from one is cloned instead of
// re-scraping). Loops over Instagram + Facebook per competitor within one function/cron slot.

const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h between full runs
const PER_COMP_INTERVAL_MS = 24 * 60 * 60 * 1000; // skip individual competitor+platform if scraped within 24h
const INSTAGRAM_PROFILE_ACTOR = 'apify~instagram-profile-scraper';
const FACEBOOK_PROFILE_ACTOR = 'NZ2v1fqLfaN2UBYIx'; // apivault_labs/facebook-profile-scraper

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
  checkin_count: number | null;
  last_post_at: Date | null;
  raw_data: string | null;
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
    checkin_count: null,
    last_post_at: null,
    raw_data: JSON.stringify(item),
  };
}

// Field names confirmed from live output (apivault_labs/facebook-profile-scraper's README only
// describes categories in prose, no formal schema — verified instead against real saved raw_data).
// coverPhoto comes back as an object (or null) rather than a plain URL string, hence the helper.
function coverPhotoUrl(coverPhoto: any): string | null {
  if (!coverPhoto) return null;
  if (typeof coverPhoto === 'string') return coverPhoto;
  return coverPhoto.url || coverPhoto.source || coverPhoto.link || coverPhoto.src || null;
}

// The "bio" field is usually just Facebook's own auto-generated page summary
// ("{name}, {city}. {N} likes · {M} were here. {category}"), not real About text —
// it duplicates follower_count/category we already store elsewhere. The one piece
// of unique info in it is the check-in count, so pull that out; best-effort against
// the English-locale phrasing, degrades to null on other locales/formats.
function parseCheckinCount(bio: string | null | undefined): number | null {
  const match = bio?.match(/([\d,]+)\s*were here/i);
  return match ? numOrNull(Number(match[1].replace(/,/g, ''))) : null;
}

function dateOrNull(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function scrapeFacebook(url: string): Promise<ProfileFields | null> {
  const [item] = await runApifyActor(FACEBOOK_PROFILE_ACTOR, { profileUrls: [url] });
  if (!item || item.error) return null;
  return {
    profile_picture_url: item.avatarUrl || null,
    cover_photo_url: coverPhotoUrl(item.coverPhoto),
    bio: item.bio || null,
    external_url: item.primaryWebsite || item.websites?.[0] || null,
    follower_count: numOrNull(item.followerCount),
    following_count: null,
    post_count: null,
    is_verified: boolOrNull(item.verified),
    is_business_account: null,
    category: strOrNull(item.category),
    contact_phone: item.primaryPhone || item.phones?.[0] || null,
    contact_email: item.primaryEmail || item.emails?.[0] || null,
    contact_address: item.address || null,
    highlight_count: null,
    highlights: null,
    checkin_count: parseCheckinCount(item.bio),
    last_post_at: dateOrNull(item.engagement?.lastPostDate),
    raw_data: JSON.stringify(item),
  };
}

const PLATFORM_CONFIGS: Record<'instagram' | 'facebook', {
  urlField: 'instagram_url' | 'facebook_url';
  scrape: (url: string) => Promise<ProfileFields | null>;
}> = {
  instagram: { urlField: 'instagram_url', scrape: scrapeInstagram },
  facebook: { urlField: 'facebook_url', scrape: scrapeFacebook },
};

// Cross-business cache: another business may already have a fresh profile scrape of this
// exact real-world competitor. Runs regardless of `force` — a fresh donor is just as valid
// as a fresh scrape of our own (same rationale as collectCompetitorSocialPosts.ts/detectCompetitorAds.ts).
async function findFreshDonorProfile(comp: any, businessProfileId: string, platform: 'instagram' | 'facebook', urlValue: string) {
  if (!comp.google_place_id && !urlValue) return null;
  const candidates = await findDonorCandidates(comp.id, businessProfileId, {
    googlePlaceId: comp.google_place_id ?? null,
    platform,
    urlValue,
  });
  if (candidates.length === 0) return null;

  const donorIds = candidates.map(d => d.id);
  const freshThreshold = new Date(Date.now() - PER_COMP_INTERVAL_MS);
  const [freshest] = await prisma.competitorSocialProfile.findMany({
    where: { competitor_id: { in: donorIds }, platform, fetched_at: { gte: freshThreshold } },
    orderBy: { fetched_at: 'desc' },
    take: 1,
  });
  return freshest ?? null;
}

async function scrapeAndSave(comp: any, businessProfileId: string, platform: 'instagram' | 'facebook') {
  const { urlField, scrape } = PLATFORM_CONFIGS[platform];
  const urlValue = comp[urlField];

  const donor = await findFreshDonorProfile(comp, businessProfileId, platform, urlValue);
  if (donor) {
    const { id, competitor_id, linked_business, fetched_at, ...fields } = donor;
    await prisma.competitorSocialProfile.upsert({
      where: { competitor_id_platform: { competitor_id: comp.id, platform } },
      create: { competitor_id: comp.id, linked_business: businessProfileId, platform, ...fields },
      update: { ...fields, fetched_at: new Date() },
    });
    await recordFollowerSnapshot({ linked_business: businessProfileId, competitor_id: comp.id, platform, follower_count: fields.follower_count });
    return { competitor: comp.name, platform, saved: true, source: 'donor' };
  }

  const fields = await scrape(urlValue);
  if (!fields) return { competitor: comp.name, platform, saved: false, source: 'scrape' };

  const profile_picture_url = fields.profile_picture_url && isS3Configured()
    ? (await uploadImageFromUrl(fields.profile_picture_url, 'competitor-profile') ?? fields.profile_picture_url)
    : fields.profile_picture_url;
  const cover_photo_url = fields.cover_photo_url && isS3Configured()
    ? (await uploadImageFromUrl(fields.cover_photo_url, 'competitor-profile') ?? fields.cover_photo_url)
    : fields.cover_photo_url;

  await prisma.competitorSocialProfile.upsert({
    where: { competitor_id_platform: { competitor_id: comp.id, platform } },
    create: { competitor_id: comp.id, linked_business: businessProfileId, platform, ...fields, profile_picture_url, cover_photo_url },
    update: { ...fields, profile_picture_url, cover_photo_url, fetched_at: new Date() },
  });
  await recordFollowerSnapshot({ linked_business: businessProfileId, competitor_id: comp.id, platform, follower_count: fields.follower_count });

  return { competitor: comp.name, platform, saved: true, source: 'scrape' };
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
    const eligibleCompetitors = allCompetitors.filter((c: any) => !c.not_relevant && c.tracking_status === 'approved');

    const results: any[] = [];
    for (const platform of Object.keys(PLATFORM_CONFIGS) as (keyof typeof PLATFORM_CONFIGS)[]) {
      const { urlField } = PLATFORM_CONFIGS[platform];
      const competitors = eligibleCompetitors.filter((c: any) => c[urlField]);

      for (const comp of competitors) {
        const existing = await prisma.competitorSocialProfile.findUnique({
          where: { competitor_id_platform: { competitor_id: comp.id, platform } },
        });
        if (!force && existing && Date.now() - existing.fetched_at.getTime() < PER_COMP_INTERVAL_MS) {
          results.push({ competitor: comp.name, platform, saved: false, reason: 'fresh' });
          continue;
        }
        try {
          results.push(await scrapeAndSave(comp, businessProfileId, platform));
        } catch (e: any) {
          console.warn(`[collectCompetitorSocialProfile] ${comp.name} (${platform}):`, e.message);
          results.push({ competitor: comp.name, platform, saved: false, error: e.message });
        }
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
