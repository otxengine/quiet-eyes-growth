import { Request, Response } from 'express';
import { prisma } from '../../db';
import { describeImage } from '../../lib/describeImage';
import { downloadFromS3 } from '../../lib/s3';

// Matches the LLM-refusal phrasing that got saved as a "description" when the
// text-only OpenAI fallback in llm.ts silently hallucinated instead of seeing
// the image (fixed there — this only cleans up the rows poisoned before the
// fix). Heuristic, not exhaustive — a real description could theoretically
// contain these words, but in practice this pattern is refusal-specific.
const POISONED_PATTERN = /לא (יכול|יכולה|יכולים) לראות|זקוק(ה)? לתיאור|אנא תאר|תאר(י)? (לי|את התמונה)/;

/**
 * regenerateMediaDescriptions
 *
 * Re-runs vision description on media assets whose description looks like
 * an LLM refusal, so bulk-generate's and pickRelevantMedia's image matching
 * has real signal to work with instead of garbage. Never touches a
 * description that doesn't match the refusal pattern — real, user-reviewed
 * descriptions are left alone.
 *
 * Body: { businessProfileId }
 * Returns: { total, updated, failed }
 */
export async function regenerateMediaDescriptions(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const assets = await prisma.mediaAsset.findMany({
      where: { linked_business: businessProfileId, media_type: 'image' },
      select: { id: true, description: true, url: true, image_base64: true, mime_type: true },
    });

    const poisoned = assets.filter(a => a.description && POISONED_PATTERN.test(a.description));
    let updated = 0, failed = 0;

    for (const asset of poisoned) {
      try {
        let base64 = asset.image_base64;
        let mimeType = asset.mime_type || 'image/jpeg';
        if (!base64 && asset.url) {
          const obj = await downloadFromS3(asset.url);
          if (!obj) throw new Error('download failed');
          base64 = obj.body.toString('base64');
          mimeType = obj.contentType || mimeType;
        }
        if (!base64) throw new Error('no image bytes');

        const description = await describeImage(base64, mimeType);
        if (!description || POISONED_PATTERN.test(description)) throw new Error('still no real description');

        await prisma.mediaAsset.update({ where: { id: asset.id }, data: { description } });
        updated++;
      } catch (err: any) {
        console.warn('[regenerateMediaDescriptions] failed for asset', asset.id, err.message);
        failed++;
      }
    }

    return res.json({ total: poisoned.length, updated, failed });
  } catch (err: any) {
    console.error('[regenerateMediaDescriptions]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
