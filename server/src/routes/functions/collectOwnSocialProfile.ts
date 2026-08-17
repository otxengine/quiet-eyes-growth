import { Request, Response } from 'express';
import { prisma } from '../../db';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { writeAutomationLog } from '../../lib/automationLog';
import { uploadImageFromUrl, isS3Configured } from '../../lib/s3';

// Profile-level twin of collectOwnSocialPosts.ts — same Apify actors as
// fetchSocialPageAbout.ts (proven working for onboarding's bio scrape), but
// called directly here (not via that helper) because fetchSocialPageAbout
// discards the whole scrape when bio text is empty, which would also throw
// away avatar/follower/contact data we want even when there's no bio set.
// Extraction is best-effort/defensive: these actors' schemas aren't pinned
// down anywhere in this repo, so unknown/missing fields just come back null
// rather than throwing.

const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h — profile metadata changes rarely

// ponytail: temporary debug capture so a live run's diagnostics can show the
// actor's actual top-level field names — delete once extraction is confirmed
// against real Apify output (field names aren't documented anywhere in this repo).
const lastRawByPlatform: Record<string, any> = {};

const FACEBOOK_ACTOR  = 'apify~facebook-pages-scraper';
const INSTAGRAM_ACTOR = 'apify~instagram-scraper';
const TIKTOK_ACTOR    = 'clockworks~tiktok-profile-scraper';

function usernameFromUrl(url: string): string {
  return url.replace(/\/+$/, '').split('/').pop() || url;
}

function numOrNull(v: any): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function boolOrNull(v: any): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

// Best-effort — these actors' highlight support (if any) isn't documented in
// this repo; if the raw item doesn't carry a recognizable highlights array,
// this returns null and only highlight_count survives (from a separate field).
function extractHighlights(raw: any): string | null {
  const arr = raw?.highlights || raw?.highlightItems;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const items = arr
    .map((h: any) => ({
      title: h?.title || h?.name || null,
      cover_url: h?.coverUrl || h?.cover || h?.thumbnail || h?.imageUrl || null,
    }))
    .filter((h: { title: string | null; cover_url: string | null }) => h.title || h.cover_url);
  return items.length ? JSON.stringify(items) : null;
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
  const [item] = await runApifyActor(INSTAGRAM_ACTOR, { usernames: [usernameFromUrl(url)] });
  if (!item) return null;
  lastRawByPlatform.instagram = item;
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
    category: item.businessCategoryName || null,
    contact_phone: item.publicPhoneNumber || item.businessPhoneNumber || null,
    contact_email: item.publicEmail || item.businessEmail || null,
    contact_address: item.publicAddress || item.businessAddress || null,
    highlight_count: numOrNull(item.highlightReelCount),
    highlights: extractHighlights(item),
  };
}

async function scrapeFacebook(url: string): Promise<ProfileFields | null> {
  const [item] = await runApifyActor(FACEBOOK_ACTOR, { startUrls: [{ url }] });
  if (!item) return null;
  lastRawByPlatform.facebook = item;
  return {
    profile_picture_url: item.profilePictureUrl || item.profilePhoto || item.profile_picture || null,
    cover_photo_url: item.coverPhotoUrl || item.coverPhoto || item.cover || null,
    bio: item.about || item.info?.[0] || null,
    external_url: item.website || null,
    follower_count: numOrNull(item.followers ?? item.likes),
    following_count: null,
    post_count: null,
    is_verified: boolOrNull(item.verified),
    is_business_account: null,
    category: Array.isArray(item.categories) ? (item.categories[0] || null) : (item.category || null),
    contact_phone: item.phone || null,
    contact_email: item.email || null,
    contact_address: item.address || null,
    highlight_count: null,
    highlights: null,
  };
}

async function scrapeTikTok(url: string): Promise<ProfileFields | null> {
  const [item] = await runApifyActor(TIKTOK_ACTOR, { profiles: [usernameFromUrl(url)] });
  const meta = item?.authorMeta;
  if (!meta) return null;
  lastRawByPlatform.tiktok = item;
  return {
    profile_picture_url: meta.avatarLarger || meta.avatarMedium || meta.avatar || null,
    cover_photo_url: null,
    bio: meta.signature || null,
    external_url: null,
    follower_count: numOrNull(meta.fans),
    following_count: numOrNull(meta.following),
    post_count: numOrNull(meta.video),
    is_verified: boolOrNull(meta.verified),
    is_business_account: null,
    category: null,
    contact_phone: null,
    contact_email: null,
    contact_address: null,
    highlight_count: null,
    highlights: null,
  };
}

const SCRAPERS: Record<string, (url: string) => Promise<ProfileFields | null>> = {
  instagram: scrapeInstagram,
  facebook: scrapeFacebook,
  tiktok: scrapeTikTok,
};

async function scrapeAndSave(businessProfileId: string, platform: string, url: string) {
  const fields = await SCRAPERS[platform](url);
  if (!fields) return { platform, url, saved: false };

  const s3 = isS3Configured();
  const profile_picture_url = fields.profile_picture_url && s3
    ? (await uploadImageFromUrl(fields.profile_picture_url, 'business-profile') ?? fields.profile_picture_url)
    : fields.profile_picture_url;
  const cover_photo_url = fields.cover_photo_url && s3
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

    const urls: Record<string, string | null> = {
      instagram: profile.instagram_url,
      facebook: profile.facebook_url,
      tiktok: profile.tiktok_url,
    };
    const tasks = Object.entries(urls).filter(([, url]) => !!url) as [string, string][];

    const results = await Promise.allSettled(
      tasks.map(([platform, url]) => scrapeAndSave(businessProfileId, platform, url)),
    );
    const diagnostics = results.map((r, i) =>
      r.status === 'fulfilled' ? r.value : { platform: tasks[i][0], url: tasks[i][1], error: (r as any).reason?.message },
    );
    const saved = results.filter(r => r.status === 'fulfilled' && (r as any).value.saved).length;

    setLastRun(businessProfileId, 'collectOwnSocialProfile');
    await writeAutomationLog('collectOwnSocialProfile', businessProfileId, startTime, saved, 'success');
    const debug_raw_keys = Object.fromEntries(
      Object.entries(lastRawByPlatform).map(([platform, item]) => [platform, Object.keys(item || {})]),
    );
    return res.json({ saved, diagnostics, debug_raw_keys });
  } catch (err: any) {
    await writeAutomationLog('collectOwnSocialProfile', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
