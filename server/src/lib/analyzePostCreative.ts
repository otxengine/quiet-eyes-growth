import { invokeLLM } from './llm';
import { isS3Url, downloadFromS3 } from './s3';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Anthropic's per-image limit

export interface PostCreativeAnalysis {
  topic: string;
  has_offer: boolean;
  offer_details: string | null;
  visual_hooks: string[];
  text_hooks: string[];
  style: string;
  cta: string;
}

async function fetchImageBase64(url: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    if (isS3Url(url)) {
      const file = await downloadFromS3(url);
      if (!file || file.body.length > MAX_IMAGE_BYTES) return null;
      return { data: file.body.toString('base64'), mediaType: file.contentType || 'image/jpeg' };
    }

    const res = await fetch(url, {
      headers: { Referer: new URL(url).origin },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return null;
    return { data: buf.toString('base64'), mediaType: contentType };
  } catch {
    return null;
  }
}

/** Normalize/guard raw LLM output into the expected shape. Never throws. */
export function normalizePostCreativeAnalysis(raw: any): PostCreativeAnalysis | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    topic:         typeof raw.topic === 'string' ? raw.topic : '',
    has_offer:     !!raw.has_offer,
    offer_details: typeof raw.offer_details === 'string' && raw.offer_details ? raw.offer_details : null,
    visual_hooks:  Array.isArray(raw.visual_hooks) ? raw.visual_hooks.filter((h: any) => typeof h === 'string') : [],
    text_hooks:    Array.isArray(raw.text_hooks) ? raw.text_hooks.filter((h: any) => typeof h === 'string') : [],
    style:         typeof raw.style === 'string' ? raw.style : '',
    cta:           typeof raw.cta === 'string' ? raw.cta : '',
  };
}

/**
 * Analyzes a single competitor post/ad creative (image + caption) via vision LLM.
 * Returns null on any failure (missing image, fetch error, LLM error, bad JSON) —
 * callers chain this without risking their own upsert flow.
 */
export async function analyzePostCreative(input: {
  caption: string | null;
  cta?: string | null;
  platform: string;
  mediaUrl: string | null;
  profile?: { name: string; category: string; city: string };
}): Promise<PostCreativeAnalysis | null> {
  if (!input.mediaUrl) return null;

  try {
    const image = await fetchImageBase64(input.mediaUrl);
    if (!image) return null;

    const analysis = await invokeLLM({
      model: 'sonnet',
      maxTokens: 700,
      skipCache: true,
      imageBase64: image.data,
      imageMediaType: image.mediaType,
      response_json_schema: { type: 'object' },
      prompt: `You are a marketing analyst reviewing a competitor's ${input.platform} post creative.
${input.profile ? `My business: "${input.profile.name}" | Sector: ${input.profile.category} | City: ${input.profile.city}\n` : ''}
Caption: ${(input.caption || '(no caption)').slice(0, 800)}
${input.cta ? `Known CTA: ${input.cta}\n` : ''}
Look at the attached image and the caption together. Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "topic": "what the post is about — 1 short phrase",
  "has_offer": false,
  "offer_details": "the specific discount/offer if has_offer is true (e.g. '20% הנחה על כל התפריט'), otherwise null",
  "visual_hooks": ["visual elements that grab attention — colors, faces, product shots, text overlays"],
  "text_hooks": ["specific words/phrases in the caption or image text designed to grab attention"],
  "style": "overall creative style — e.g. 'מינימליסטי', 'צבעוני ואנרגטי', 'מקצועי'",
  "cta": "the call to action — what the viewer is asked to do"
}`,
    });

    return normalizePostCreativeAnalysis(analysis);
  } catch (err: any) {
    console.warn('[analyzePostCreative] failed:', err.message);
    return null;
  }
}
