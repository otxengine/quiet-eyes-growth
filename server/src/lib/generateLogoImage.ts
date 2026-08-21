// Standalone logo-image generation — deliberately NOT sharing code with
// generateImage.ts (post/campaign photography), even though both call the
// same two providers. generateImage.ts hard-codes a photography-style suffix
// ("professional marketing photography... no logos") on every prompt, the
// literal opposite of what a logo needs, and is already used by 3 live UI
// flows — safer to keep this fully separate than bolt a "logo mode" onto it.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const FAL_API_KEY = process.env.FAL_API_KEY || '';

const LOGO_STYLE_SUFFIX = 'flat vector logo design, minimalist icon or wordmark, clean lines, '
  + 'solid or simple background, no photography, no realistic textures, high contrast, '
  + 'legible at small sizes, suitable as a circular social media profile picture, no watermark';

export interface GeneratedLogo {
  url: string; // either a fal.ai-hosted URL or a data:image/... base64 string
  provider: 'flux1' | 'imagen_ultra';
}

async function generateWithFlux(englishBrief: string): Promise<string | null> {
  if (!FAL_API_KEY) return null;
  const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: `${englishBrief}, ${LOGO_STYLE_SUFFIX}`,
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

async function generateWithImagen(englishBrief: string): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-ultra-generate-001:predict?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: `${englishBrief}, ${LOGO_STYLE_SUFFIX}` }],
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

/** Tries Flux.1-schnell first (fast, cheap), falls back to Imagen Ultra. Never throws — returns null on total failure. */
export async function generateLogoImage(englishBrief: string): Promise<GeneratedLogo | null> {
  try {
    const url = await generateWithFlux(englishBrief);
    if (url) return { url, provider: 'flux1' };
  } catch (err: any) {
    console.warn('[generateLogoImage] Flux failed:', err.message);
  }

  try {
    const url = await generateWithImagen(englishBrief);
    if (url) return { url, provider: 'imagen_ultra' };
  } catch (err: any) {
    console.warn('[generateLogoImage] Imagen failed:', err.message);
  }

  return null;
}
