import { Request, Response } from 'express';
import { prisma } from '../../db';
import { buildLogoDesignBrief } from '../../lib/buildLogoDesignBrief';
import { generateLogoImage, GeneratedLogo, LogoStyle } from '../../lib/generateLogoImage';
import { uploadBufferToS3, uploadImageFromUrl } from '../../lib/s3';
import { fetchImageBase64 } from '../../lib/fetchImageBase64';
import { verifyLogoSpelling } from '../../lib/verifyLogoSpelling';

const MAX_WORDMARK_ATTEMPTS = 3;

async function toBase64(url: string): Promise<{ data: string; mediaType: string } | null> {
  if (url.startsWith('data:')) {
    const [, mediaType, data] = url.match(/^data:(.+?);base64,(.+)$/) || [];
    return data ? { data, mediaType: mediaType || 'image/png' } : null;
  }
  return fetchImageBase64(url);
}

/**
 * generateLogo — generates an AI candidate replacement logo for one own
 * platform, grounded in the competitor visual pattern + this platform's own
 * logo critique (critiqueLogo must have already run and flagged
 * logo_needs_redesign, same "run the prior step first" gate as suggestBioFix).
 *
 * Body: { businessProfileId, platform, feedback?, style? } — feedback is the
 * owner's requested change to a previous draft (from the "request change"
 * action in the review popup); style is 'creative' (icon, default) or
 * 'wordmark' (business name as the design — text rendering is unreliable,
 * especially non-Latin script, so this leans on the review popup as the
 * quality gate rather than guaranteeing legible output).
 */
export async function generateLogo(req: Request, res: Response) {
  const { businessProfileId, platform, feedback, style } = req.body;
  const logoStyle: LogoStyle = style === 'wordmark' ? 'wordmark' : 'creative';
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
      changeFeedback: typeof feedback === 'string' && feedback.trim() ? feedback.trim() : undefined,
      style: logoStyle,
    });

    let generated: GeneratedLogo | null = null;
    if (logoStyle === 'wordmark') {
      // The business name IS the design here — a misspelled wordmark is worse
      // than none, so each attempt is vision-verified against the real name
      // before it's accepted; wrong spellings are discarded and retried.
      for (let attempt = 1; attempt <= MAX_WORDMARK_ATTEMPTS; attempt++) {
        const candidate = await generateLogoImage(brief, logoStyle);
        if (!candidate) continue;
        const img = await toBase64(candidate.url);
        if (img && await verifyLogoSpelling(img.data, img.mediaType, profile.name)) {
          generated = candidate;
          break;
        }
        console.warn(`[generateLogo] wordmark attempt ${attempt}/${MAX_WORDMARK_ATTEMPTS} failed spelling verification`);
      }
      if (!generated) {
        return res.status(502).json({ error: 'לא הצלחנו ליצור לוגו עם איות נכון של שם העסק — נסו שוב או בחרו בסגנון היצירתי' });
      }
    } else {
      generated = await generateLogoImage(brief, logoStyle);
      if (!generated) return res.status(502).json({ error: 'Logo generation failed on all providers' });
    }

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
      data: { suggested_logo_url: permanentUrl, suggested_logo_at: now, suggested_logo_accepted: false },
    });

    return res.json({ platform, suggested_logo_url: permanentUrl });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
