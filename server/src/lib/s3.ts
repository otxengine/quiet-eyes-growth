import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { safeFetch } from './safeFetch';

// The bucket's region, not the compute's: on ECS, AWS_REGION is the task's own region.
const REGION = process.env.AWS_S3_REGION || process.env.AWS_REGION || 'us-east-1';

// No explicit credentials: the SDK's default chain reads AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY
// where they are set (Render) and the ECS task role on AWS.
const client = new S3Client({ region: REGION });

const BUCKET   = process.env.AWS_S3_BUCKET!;
const CDN_BASE = process.env.AWS_CDN_URL || `https://${BUCKET}.s3.${REGION}.amazonaws.com`;

export function isS3Configured(): boolean {
  return !!process.env.AWS_S3_BUCKET;
}

// Media types a browser renders without running script. Anything else (SVG, HTML, text) would
// run as a page on the API origin when served back, so uploads refuse it and serving downgrades it.
export const SAFE_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif',
  'video/mp4', 'video/webm', 'video/quicktime',
]);

/** The bare, lower-cased type if it is in SAFE_MEDIA_TYPES, else null. */
export function safeMediaType(type: unknown): string | null {
  const t = String(type ?? '').split(';')[0].trim().toLowerCase();
  return SAFE_MEDIA_TYPES.has(t) ? t : null;
}

/** Returns true if the given URL points to our S3 bucket or CloudFront CDN. */
export function isS3Url(url: string): boolean {
  if (!BUCKET) return false;
  try {
    const host = new URL(url).hostname;
    if (host === `${BUCKET}.s3.${REGION}.amazonaws.com`) return true;
    if (host === `${BUCKET}.s3.amazonaws.com`) return true;
    const cdnHost = process.env.AWS_CDN_URL ? new URL(process.env.AWS_CDN_URL).hostname : null;
    if (cdnHost && host === cdnHost) return true;
  } catch { /* ignore */ }
  return false;
}

/**
 * Extracts the S3 key from a bucket or CDN URL and streams the object.
 * Returns { body, contentType } or null on failure.
 */
export async function downloadFromS3(url: string): Promise<{ body: Buffer; contentType: string } | null> {
  if (!isS3Configured()) return null;
  try {
    const parsed = new URL(url);
    const cdnBase = process.env.AWS_CDN_URL;
    // Key is the path without leading slash
    const key = cdnBase && url.startsWith(cdnBase)
      ? url.slice(cdnBase.length).replace(/^\//, '')
      : parsed.pathname.replace(/^\//, '');

    const result = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const bytes = await (result.Body as any).transformToByteArray();
    return { body: Buffer.from(bytes), contentType: result.ContentType || 'image/jpeg' };
  } catch {
    return null;
  }
}

function extForContentType(contentType: string): string {
  return contentType.includes('png')       ? 'png'
    : contentType.includes('webp')      ? 'webp'
    : contentType.includes('gif')       ? 'gif'
    : contentType.includes('mp4')       ? 'mp4'
    : contentType.includes('webm')      ? 'webm'
    : contentType.includes('quicktime') ? 'mov'
    : 'jpg';
}

/**
 * Uploads a raw buffer to S3. Returns the permanent S3 (or CloudFront) URL, or null on failure.
 */
export async function uploadBufferToS3(buffer: Buffer, contentType: string, folder = 'business-media'): Promise<string | null> {
  if (!isS3Configured()) return null;
  try {
    const key = `${folder}/${randomUUID()}.${extForContentType(contentType)}`;

    await client.send(new PutObjectCommand({
      Bucket:       BUCKET,
      Key:          key,
      Body:         buffer,
      ContentType:  contentType,
      CacheControl: 'public, max-age=31536000',
    }));

    return `${CDN_BASE}/${key}`;
  } catch {
    return null;
  }
}

/**
 * Downloads an image from a CDN URL and uploads it to S3.
 * Returns the permanent S3 (or CloudFront) URL, or null on failure.
 */
export async function uploadImageFromUrl(sourceUrl: string, folder = 'competitor-posts'): Promise<string | null> {
  if (!isS3Configured()) return null;
  try {
    const res = await safeFetch(sourceUrl, {
      headers: { Referer: new URL(sourceUrl).origin },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    // Some scraped "image"/"video" URLs (e.g. Facebook's lookaside.fbsbx.com crawler stubs)
    // 200 into an HTML redirect page instead of raw media bytes when fetched without crawler
    // headers — reject those instead of silently re-hosting HTML into S3 as if it were media.
    // Not narrowed to image/* — this helper also re-hosts video ads (video/mp4 etc.) and a
    // generic application/octet-stream fallback, so only text/* is unambiguously not media.
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    if (contentType.startsWith('text/')) return null;
    return uploadBufferToS3(Buffer.from(await res.arrayBuffer()), contentType, folder);
  } catch {
    return null;
  }
}
