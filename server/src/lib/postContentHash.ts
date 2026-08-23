import { createHash } from 'crypto';

// Dedup fallback for competitor_posts when external_post_id/post_url are missing
// or drift between Apify scrapes. Caption-less posts return null — hashing an
// empty caption would make unrelated media-only posts collide.
// Shared by collectCompetitorSocialPosts.ts (live dedup) and dedupeCompetitorPosts.ts
// (one-off cleanup) — must stay byte-identical between the two or their hashes won't match.
export function postContentHash(platform: string, caption: string | null, postedAt: string | null): string | null {
  const text = (caption || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return null;
  const dateKey = postedAt ? postedAt.slice(0, 10) : 'no-date';
  return createHash('sha256').update(`${platform}|${text}|${dateKey}`).digest('hex');
}
