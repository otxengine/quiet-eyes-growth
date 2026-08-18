import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

const client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET   = process.env.AWS_S3_BUCKET!;
const CDN_BASE = process.env.AWS_CDN_URL || `https://${BUCKET}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`;

export function isS3Configured(): boolean {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_S3_BUCKET);
}

/** Returns true if the given URL points to our S3 bucket or CloudFront CDN. */
export function isS3Url(url: string): boolean {
  if (!BUCKET) return false;
  try {
    const host = new URL(url).hostname;
    const region = process.env.AWS_REGION || 'us-east-1';
    if (host === `${BUCKET}.s3.${region}.amazonaws.com`) return true;
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

/**
 * Downloads an image from a CDN URL and uploads it to S3.
 * Returns the permanent S3 (or CloudFront) URL, or null on failure.
 */
export async function uploadImageFromUrl(sourceUrl: string, folder = 'competitor-posts'): Promise<string | null> {
  if (!isS3Configured()) return null;
  try {
    const res = await fetch(sourceUrl, {
      headers: { Referer: new URL(sourceUrl).origin },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png')       ? 'png'
      : contentType.includes('webp')      ? 'webp'
      : contentType.includes('gif')       ? 'gif'
      : contentType.includes('mp4')       ? 'mp4'
      : contentType.includes('webm')      ? 'webm'
      : contentType.includes('quicktime') ? 'mov'
      : 'jpg';
    const key = `${folder}/${randomUUID()}.${ext}`;

    await client.send(new PutObjectCommand({
      Bucket:       BUCKET,
      Key:          key,
      Body:         Buffer.from(await res.arrayBuffer()),
      ContentType:  contentType,
      CacheControl: 'public, max-age=31536000',
    }));

    return `${CDN_BASE}/${key}`;
  } catch {
    return null;
  }
}
