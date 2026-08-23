// Standalone logo-image generation — deliberately NOT sharing code with
// generateImage.ts (post/campaign photography), even though both call the
// same two providers. generateImage.ts hard-codes a photography-style suffix
// ("professional marketing photography... no logos") on every prompt, the
// literal opposite of what a logo needs, and is already used by 3 live UI
// flows — safer to keep this fully separate than bolt a "logo mode" onto it.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const FAL_API_KEY = process.env.FAL_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

export type LogoStyle = 'creative' | 'wordmark';

const STYLE_SUFFIX: Record<LogoStyle, string> = {
  creative: 'flat vector logo design, minimalist icon, clean lines, '
    + 'solid or simple background, no photography, no realistic textures, high contrast, '
    + 'legible at small sizes, suitable as a circular social media profile picture, no watermark, no text',
  // Text rendering (especially non-Latin script) is hit-or-miss for these models —
  // the accept/reject/request-change review popup is the safety net for bad attempts,
  // not a guarantee this comes out clean every time.
  wordmark: 'flat typographic wordmark logo, the business name rendered as bold clean lettering '
    + 'is the entire design, elegant simple font, no extraneous icon or imagery, '
    + 'solid or simple background, high contrast, legible at small sizes, '
    + 'suitable as a circular social media profile picture, no watermark',
};

export interface GeneratedLogo {
  url: string; // either a fal.ai-hosted URL or a data:image/... base64 string
  provider: 'flux1' | 'imagen_ultra' | 'gpt_image';
}

/**
 * gpt-image-1 renders in-image text (including non-Latin script) noticeably
 * better than Flux/Imagen — used as the first attempt for wordmark logos
 * specifically, where the business name IS the design. Not tried for
 * 'creative' icons (no text to render, and Flux is cheaper/faster for that).
 */
async function generateWithGptImage(englishBrief: string, style: LogoStyle): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: `${englishBrief}, ${STYLE_SUFFIX[style]}`,
      size: '1024x1024',
      n: 1,
    }),
  });
  if (!res.ok) throw new Error(`gpt-image-1 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('gpt-image-1 returned no image data');
  return `data:image/png;base64,${b64}`;
}

async function generateWithFlux(englishBrief: string, style: LogoStyle): Promise<string | null> {
  if (!FAL_API_KEY) return null;
  const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: `${englishBrief}, ${STYLE_SUFFIX[style]}`,
      image_size: 'square_hd',
      num_images: 1,
      output_format: 'png',
      num_inference_steps: 4,
    }),
  });
  if (!res.ok) throw new Error(`Flux ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  const url = data.images?.[0]?.url;
  if (!url) throw new Error('Flux returned no image URL');
  return url;
}

async function generateWithImagen(englishBrief: string, style: LogoStyle): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-ultra-generate-001:predict?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: `${englishBrief}, ${STYLE_SUFFIX[style]}` }],
        parameters: { sampleCount: 1, aspectRatio: '1:1', safetyFilterLevel: 'block_few' },
      }),
    },
  );
  if (!res.ok) throw new Error(`Imagen ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('Imagen returned no image data');
  return `data:image/png;base64,${b64}`;
}

/**
 * Wordmark logos try gpt-image-1 first (best odds on rendering the business
 * name as legible text), then fall back to the cheaper Flux/Imagen tier.
 * Creative icons skip straight to Flux/Imagen — no text to render, so the
 * extra cost buys nothing. Never throws — returns null on total failure.
 */
export async function generateLogoImage(englishBrief: string, style: LogoStyle = 'creative'): Promise<GeneratedLogo | null> {
  if (style === 'wordmark') {
    try {
      const url = await generateWithGptImage(englishBrief, style);
      if (url) return { url, provider: 'gpt_image' };
    } catch (err: any) {
      console.warn('[generateLogoImage] gpt-image-1 failed:', err.message);
    }
  }

  try {
    const url = await generateWithFlux(englishBrief, style);
    if (url) return { url, provider: 'flux1' };
  } catch (err: any) {
    console.warn('[generateLogoImage] Flux failed:', err.message);
  }

  try {
    const url = await generateWithImagen(englishBrief, style);
    if (url) return { url, provider: 'imagen_ultra' };
  } catch (err: any) {
    console.warn('[generateLogoImage] Imagen failed:', err.message);
  }

  return null;
}
