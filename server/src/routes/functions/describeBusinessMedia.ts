import { Request, Response } from 'express';
import { describeImage } from '../../lib/describeImage';

/**
 * describeBusinessMedia
 *
 * Generates a short Hebrew description of an uploaded business image via
 * vision-capable LLM (Claude → Gemini Flash fallback), used to pre-fill the
 * media library's description field so the business owner can review/edit
 * rather than write it from scratch.
 *
 * Body: { imageBase64, mimeType }
 * Returns: { description }
 */
export async function describeBusinessMedia(req: Request, res: Response) {
  const { imageBase64, mimeType = 'image/jpeg' } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

  try {
    const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');
    const description = await describeImage(base64Data, mimeType);
    return res.json({ description });
  } catch (err: any) {
    console.error('[describeBusinessMedia]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
