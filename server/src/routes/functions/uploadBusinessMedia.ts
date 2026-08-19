import { Request, Response } from 'express';
import { prisma } from '../../db';
import { isS3Configured, uploadBufferToS3 } from '../../lib/s3';

/**
 * uploadBusinessMedia
 *
 * Saves a business's own media (image or video) into a persistent, reusable
 * library, with a required user-authored description so later post-generation
 * prompts know what the media shows.
 *
 * Body: { businessProfileId, fileBase64, mimeType, mediaType?, description }
 * Returns: { mediaAssetId, url, media_type }
 */
export async function uploadBusinessMedia(req: Request, res: Response) {
  const { businessProfileId, fileBase64, mimeType = 'image/jpeg', description } = req.body;
  const mediaType = req.body.mediaType || (mimeType.startsWith('video') ? 'video' : 'image');

  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (!fileBase64)        return res.status(400).json({ error: 'Missing fileBase64' });
  if (!description || !String(description).trim()) {
    return res.status(400).json({ error: 'Description is required' });
  }

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    const base64Data = fileBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    let url: string | null = null;
    let storedBase64: string | null = null;

    if (mediaType === 'video') {
      if (!isS3Configured()) {
        return res.status(400).json({ error: 'Video upload requires S3 storage, which is not configured' });
      }
      url = await uploadBufferToS3(buffer, mimeType, 'business-media');
      if (!url) return res.status(500).json({ error: 'Video upload to S3 failed' });
    } else if (isS3Configured()) {
      url = await uploadBufferToS3(buffer, mimeType, 'business-media');
      if (!url) storedBase64 = base64Data; // S3 upload failed — fall back to DB storage
    } else {
      storedBase64 = base64Data;
    }

    const asset = await prisma.mediaAsset.create({
      data: {
        linked_business: businessProfileId,
        media_type:       mediaType,
        url,
        image_base64:     storedBase64,
        mime_type:         mimeType,
        source:            'uploaded',
        description:       String(description).trim(),
      },
    });

    return res.json({ mediaAssetId: asset.id, url: asset.url, media_type: asset.media_type });
  } catch (err: any) {
    console.error('[uploadBusinessMedia]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
