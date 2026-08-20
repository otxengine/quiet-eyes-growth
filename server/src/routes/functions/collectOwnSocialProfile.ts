import { Request, Response } from 'express';
import { prisma } from '../../db';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { writeAutomationLog } from '../../lib/automationLog';
import { uploadImageFromUrl, isS3Configured } from '../../lib/s3';

// Twin of collectCompetitorSocialProfile.ts — same per-platform loop (Instagram +
// Facebook), same two actors, same field-mapping guesses for Facebook (no documented
// output schema — raw_data is the safety net). Own-business version has no donor cache
// (there's only one of "our own" business, nothing to clone from).

const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h — profile metadata changes rarely
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

// Field names confirmed from live output (see collectCompetitorSocialProfile.ts, same actor).
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

// OAuth-connected businesses get facebook_page_id/facebook_page_token but never
// facebook_url (that field is only set if the user separately types a link into
// onboarding/Settings). Facebook accepts a numeric Page ID in place of a vanity
// slug, so we can still scrape via the existing Apify actor without one.
function resolveFacebookUrl(profile: any): string | null {
  return profile.facebook_url || (profile.facebook_page_id ? `https://www.facebook.com/${profile.facebook_page_id}` : null);
}

async function scrapeAndSave(businessProfileId: string, url: string, platform: 'instagram' | 'facebook') {
  const fields = await PLATFORM_CONFIGS[platform].scrape(url);
  if (!fields) return { platform, url, saved: false };

  const profile_picture_url = fields.profile_picture_url && isS3Configured()
    ? (await uploadImageFromUrl(fields.profile_picture_url, 'business-profile') ?? fields.profile_picture_url)
    : fields.profile_picture_url;
  const cover_photo_url = fields.cover_photo_url && isS3Configured()
    ? (await uploadImageFromUrl(fields.cover_photo_url, 'business-profile') ?? fields.cover_photo_url)
    : fields.cover_photo_url;

  await prisma.businessSocialProfile.upsert({
    where: { linked_business_platform: { linked_business: businessProfileId, platform } },
    create: { linked_business: businessProfileId, platform, ...fields, profile_picture_url, cover_photo_url },
    update: { ...fields, profile_picture_url, cover_photo_url, fetched_at: new Date() },
  });

  return { platform, url, saved: true };
}

export async function collectOwnSocialProfile(req: Request, res: Response) {
  const { businessProfileId, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  if (!force && shouldSkipAgent(businessProfileId, 'collectOwnSocialProfile', MIN_INTERVAL_MS)) {
    return res.json({ saved: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    if (!hasApifyKey()) {
      await writeAutomationLog('collectOwnSocialProfile', businessProfileId, startTime, 0, 'success', 'no_apify_key');
      return res.json({ saved: 0, skipped: true, reason: 'no_apify_key' });
    }

    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    const urlByPlatform: Record<'instagram' | 'facebook', string | null> = {
      instagram: profile.instagram_url,
      facebook: resolveFacebookUrl(profile),
    };

    const platforms = (Object.keys(PLATFORM_CONFIGS) as (keyof typeof PLATFORM_CONFIGS)[])
      .filter(platform => urlByPlatform[platform]);

    if (platforms.length === 0) {
      await writeAutomationLog('collectOwnSocialProfile', businessProfileId, startTime, 0, 'success', 'no_social_url');
      return res.json({ saved: 0, skipped: true, reason: 'no_social_url' });
    }

    const results: any[] = [];
    for (const platform of platforms) {
      const url = urlByPlatform[platform] as string;
      const existing = await prisma.businessSocialProfile.findUnique({
        where: { linked_business_platform: { linked_business: businessProfileId, platform } },
      });
      if (!force && existing && Date.now() - existing.fetched_at.getTime() < MIN_INTERVAL_MS) {
        results.push({ platform, url, saved: false, reason: 'fresh' });
        continue;
      }
      try {
        results.push(await scrapeAndSave(businessProfileId, url, platform));
      } catch (e: any) {
        console.warn(`[collectOwnSocialProfile] ${platform}:`, e.message);
        results.push({ platform, url, saved: false, error: e.message });
      }
    }

    const saved = results.filter(r => r.saved).length;
    setLastRun(businessProfileId, 'collectOwnSocialProfile');
    await writeAutomationLog('collectOwnSocialProfile', businessProfileId, startTime, saved, 'success');
    return res.json({ saved, diagnostics: results });
  } catch (err: any) {
    await writeAutomationLog('collectOwnSocialProfile', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
