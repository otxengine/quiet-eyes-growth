import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
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
