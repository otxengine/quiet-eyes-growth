import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../../db';
import crypto from 'crypto';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

/**
 * analyzeImageForPost
 *
 * Scans an uploaded image using Claude Vision (Haiku) and returns:
 * - AI description of the image
 * - Suggested post text tailored to the image + business
 * - Audience hint
 * - Saves the image as a MediaAsset for reuse
 *
 * Body: { businessProfileId, imageBase64, mimeType, platform? }
 * Returns: { mediaAssetId, description, suggested_post, audience_hint, tone }
 */
export async function analyzeImageForPost(req: Request, res: Response) {
  const { businessProfileId, imageBase64, mimeType = 'image/jpeg', platform = 'instagram' } = req.body;

  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (!imageBase64)       return res.status(400).json({ error: 'Missing imageBase64' });

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    // Strip data URL prefix if present
    const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');

    // Claude Vision — Haiku is cheapest model with vision support
    const msg = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 350,
      system:     'Return ONLY valid JSON. No markdown, no explanation.',
      messages: [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: mimeType as any, data: base64Data },
          },
          {
            type: 'text',
            text: `Business: "${profile.name}" (${profile.category}, ${profile.city}). Platform: ${platform}.
Analyze this image and return JSON:
{"description":"what is shown (max 12 words)","suggested_post":"Hebrew social post 2-3 sentences + CTA","audience_hint":"who this appeals to (5 words)","tone":"casual|professional|festive"}`,
          },
        ],
      }],
    });

    const raw = (msg.content[0] as any).text || '{}';
    let analysis: any = {};
    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      analysis = JSON.parse(clean);
    } catch {
      analysis = { description: 'תמונה שהועלתה', suggested_post: '', audience_hint: '', tone: 'casual' };
    }

    // Save to MediaAsset (optional — table may not exist yet)
    let savedMediaId: string | null = null;
    try {
      const id = crypto.randomUUID();
      await (prisma as any).mediaAsset.create({
        data: {
          id,
          linked_business: businessProfileId,
          image_base64:    base64Data,
          mime_type:       mimeType,
          source:          'uploaded',
          description:     analysis.description || '',
        },
      });
      savedMediaId = id;
    } catch (saveErr: any) {
      console.warn('[analyzeImageForPost] MediaAsset save skipped:', saveErr.message);
    }

    return res.json({
      mediaAssetId:   savedMediaId,
      description:    analysis.description    || '',
      suggested_post: analysis.suggested_post || '',
      audience_hint:  analysis.audience_hint  || '',
      tone:           analysis.tone           || 'casual',
    });
  } catch (err: any) {
    console.error('[analyzeImageForPost]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
