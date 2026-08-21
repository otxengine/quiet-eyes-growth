import { Request, Response } from 'express';
import { prisma } from '../../db';
import { buildLogoDesignBrief } from '../../lib/buildLogoDesignBrief';
import { generateLogoImage } from '../../lib/generateLogoImage';
import { uploadBufferToS3, uploadImageFromUrl } from '../../lib/s3';

/**
 * generateLogo — generates an AI candidate replacement logo for one own
 * platform, grounded in the competitor visual pattern + this platform's own
 * logo critique (critiqueLogo must have already run and flagged
 * logo_needs_redesign, same "run the prior step first" gate as suggestBioFix).
 *
 * Body: { businessProfileId, platform }
 */
export async function generateLogo(req: Request, res: Response) {
  const { businessProfileId, platform } = req.body;
  if (!businessProfileId || !platform) {
    return res.status(400).json({ error: 'Missing businessProfileId or platform' });
  }

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    const social = await prisma.businessSocialProfile.findFirst({
      where: { linked_business: businessProfileId, platform },
    });
    if (!social?.logo_critique) {
      return res.status(400).json({ error: 'Run the logo critique first (logo_critique is empty)' });
    }

    const brief = await buildLogoDesignBrief({
      businessName: profile.name,
      category: profile.category,
      city: profile.city || '',
      competitorLogoInsight: profile.content_trends_logo_insight || '',
      ownLogoCritique: social.logo_critique,
    });

    const generated = await generateLogoImage(brief);
    if (!generated) return res.status(502).json({ error: 'Logo generation failed on all providers' });

    let permanentUrl: string | null;
    if (generated.url.startsWith('data:')) {
      const [, meta, b64] = generated.url.match(/^data:(.+?);base64,(.+)$/) || [];
      if (!b64) return res.status(502).json({ error: 'Malformed generated image data' });
      permanentUrl = await uploadBufferToS3(Buffer.from(b64, 'base64'), meta || 'image/png', 'logos');
    } else {
      permanentUrl = await uploadImageFromUrl(generated.url, 'logos');
    }
    if (!permanentUrl) return res.status(502).json({ error: 'Failed to store generated logo' });

    const now = new Date().toISOString();
    await prisma.mediaAsset.create({
      data: {
        linked_business: businessProfileId,
        media_type: 'image',
        url: permanentUrl,
        mime_type: 'image/png',
        source: 'ai_generated',
        used_in: 'logo',
        description: `AI-generated candidate logo (${platform}) — ${brief.slice(0, 200)}`,
      },
    });

    await prisma.businessSocialProfile.update({
      where: { id: social.id },
      data: { suggested_logo_url: permanentUrl, suggested_logo_at: now },
    });

    return res.json({ platform, suggested_logo_url: permanentUrl });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
