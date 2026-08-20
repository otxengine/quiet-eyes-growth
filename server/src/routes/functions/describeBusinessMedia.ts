import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

/**
 * describeBusinessMedia
 *
 * Generates a short Hebrew description of an uploaded business image via
 * Claude Vision, used to pre-fill the media library's description field
 * so the business owner can review/edit rather than write it from scratch.
 *
 * Body: { imageBase64, mimeType }
 * Returns: { description }
 */
export async function describeBusinessMedia(req: Request, res: Response) {
  const { imageBase64, mimeType = 'image/jpeg' } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

  try {
    const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');

    const msg = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 100,
      system:     'Return ONLY the description text. No markdown, no explanation, no surrounding quotes.',
      messages: [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: mimeType as any, data: base64Data },
          },
          {
            type: 'text',
            text: 'תאר בקצרה (עד 20 מילים) בעברית מה רואים בתמונה הזו, לשימוש כהקשר ליצירת פוסטים לרשתות חברתיות עבור העסק.',
          },
        ],
      }],
    });

    const description = ((msg.content[0] as any).text || '').trim();
    return res.json({ description });
  } catch (err: any) {
    console.error('[describeBusinessMedia]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
