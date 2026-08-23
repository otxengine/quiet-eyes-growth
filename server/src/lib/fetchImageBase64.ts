import { isS3Url, downloadFromS3 } from './s3';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Anthropic's per-image limit

/** Fetches an image (S3-backed or direct URL) as base64, capped at Anthropic's per-image limit. Never throws. */
export async function fetchImageBase64(url: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    if (isS3Url(url)) {
      const file = await downloadFromS3(url);
      if (!file) { console.warn('[fetchImageBase64] S3 download failed:', url); return null; }
      if (file.body.length > MAX_IMAGE_BYTES) { console.warn('[fetchImageBase64] image too large (S3):', url, file.body.length); return null; }
      return { data: file.body.toString('base64'), mediaType: file.contentType || 'image/jpeg' };
    }

    const res = await fetch(url, {
      headers: { Referer: new URL(url).origin },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) { console.warn('[fetchImageBase64] image fetch non-OK:', res.status, url); return null; }
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) { console.warn('[fetchImageBase64] image too large:', url, buf.length); return null; }
    return { data: buf.toString('base64'), mediaType: contentType };
  } catch (err: any) {
    console.warn('[fetchImageBase64] image fetch threw:', url, err.message);
    return null;
  }
}
