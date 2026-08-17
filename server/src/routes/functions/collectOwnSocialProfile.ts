import { Request, Response } from 'express';
import { prisma } from '../../db';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { writeAutomationLog } from '../../lib/automationLog';
import { uploadImageFromUrl, isS3Configured } from '../../lib/s3';

// Instagram-only for now (per product decision) — profile picture, bio, follower/
// following/post counts, verified/business flags, category, external URL, and
// highlight count. Uses apify/instagram-profile-scraper (not apify~instagram-scraper,
// which is used elsewhere in this codebase for the post feed) — its documented
// output fields: profilePicUrl(HD), biography, externalUrl, followersCount,
// followsCount, postsCount, verified, isBusinessAccount, businessCategoryName,
// highlightReelCount. No cover-photo or actual highlight-item fields are documented
// for this actor — highlights stays count-only, contact_* fields aren't in its
// schema either but are extracted defensively in case a future actor version adds them.

const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h — profile metadata changes rarely
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
    category: item.businessCategoryName || null,
    contact_phone: item.publicPhoneNumber || item.businessPhoneNumber || null,
    contact_email: item.publicEmail || item.businessEmail || null,
    contact_address: item.publicAddress || item.businessAddress || null,
    highlight_count: numOrNull(item.highlightReelCount),
    highlights: null,
  };
}

async function scrapeAndSave(businessProfileId: string, url: string) {
  const fields = await scrapeInstagram(url);
  if (!fields) return { platform: 'instagram', url, saved: false };

  const profile_picture_url = fields.profile_picture_url && isS3Configured()
    ? (await uploadImageFromUrl(fields.profile_picture_url, 'business-profile') ?? fields.profile_picture_url)
    : fields.profile_picture_url;

  await prisma.businessSocialProfile.upsert({
    where: { linked_business_platform: { linked_business: businessProfileId, platform: 'instagram' } },
    create: { linked_business: businessProfileId, platform: 'instagram', ...fields, profile_picture_url },
    update: { ...fields, profile_picture_url, fetched_at: new Date() },
  });

  return { platform: 'instagram', url, saved: true };
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
    if (!profile.instagram_url) {
      await writeAutomationLog('collectOwnSocialProfile', businessProfileId, startTime, 0, 'success', 'no_instagram_url');
      return res.json({ saved: 0, skipped: true, reason: 'no_instagram_url' });
    }

    const result = await scrapeAndSave(businessProfileId, profile.instagram_url);

    setLastRun(businessProfileId, 'collectOwnSocialProfile');
    await writeAutomationLog('collectOwnSocialProfile', businessProfileId, startTime, result.saved ? 1 : 0, 'success');
    return res.json({ saved: result.saved ? 1 : 0, diagnostics: [result] });
  } catch (err: any) {
    await writeAutomationLog('collectOwnSocialProfile', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
