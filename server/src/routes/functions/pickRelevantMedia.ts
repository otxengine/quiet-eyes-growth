import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';

/**
 * pickRelevantMedia
 *
 * Picks the media-library asset that best matches a post's text, for when
 * the business owner saves a post without choosing an image themselves
 * (no library pick, no AI-generated image, no upload). Same guardrail as
 * the bulk-generate matching: only return an id on a genuine match — no
 * image is better than an irrelevant one.
 *
 * Body: { businessProfileId, content }
 * Returns: { media_asset_id, image_url } — both null if nothing matches
 */
export async function pickRelevantMedia(req: Request, res: Response) {
  const { businessProfileId, content } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (!content?.trim()) return res.json({ media_asset_id: null, image_url: null });

  try {
    const assets = await prisma.mediaAsset.findMany({
      where: { linked_business: businessProfileId, media_type: 'image', description: { not: null } },
      select: { id: true, description: true },
      take: 40,
    });
    if (!assets.length) return res.json({ media_asset_id: null, image_url: null });

    const result = await invokeLLM({
      model: 'haiku',
      maxTokens: 100,
      skipCache: true,
      prompt: `להלן טקסט פוסט לרשתות חברתיות וספריית תמונות זמינה של העסק. בחר תמונה רק אם היא באמת מתאימה לתוכן הפוסט — עדיף להחזיר null מאשר תמונה לא רלוונטית.

טקסט הפוסט:
"""
${content.trim().slice(0, 500)}
"""

ספריית תמונות (id בסוגריים מרובעים):
${assets.map(a => `[${a.id}] ${a.description}`).join('\n')}

Return ONLY valid JSON: { "media_asset_id": "id מדויק מהרשימה, או null" }`,
      response_json_schema: { type: 'object' },
    });

    const pickedId = result?.media_asset_id;
    const valid = pickedId && assets.some(a => a.id === pickedId);
    if (!valid) return res.json({ media_asset_id: null, image_url: null });

    const serverBase = process.env.SERVER_BASE_URL || 'http://localhost:3007';
    return res.json({ media_asset_id: pickedId, image_url: `${serverBase}/api/social/media/${pickedId}` });
  } catch (err: any) {
    console.error('[pickRelevantMedia]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
