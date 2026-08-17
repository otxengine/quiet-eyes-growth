import { invokeLLM } from './llm';
import { isS3Url, downloadFromS3 } from './s3';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Anthropic's per-image limit
const MAX_VIDEO_BYTES = 12 * 1024 * 1024; // stay safely under Gemini's ~20MB inline-request ceiling after base64 overhead

export interface PostCreativeAnalysis {
  topic: string;
  has_offer: boolean;
  offer_details: string | null;
  // Offer breakdown — populated only when has_offer is true, otherwise all null.
  offer_mechanic: string | null;        // 'percent_discount'|'fixed_amount'|'bogo'|'free_shipping'|'bundle'|'gift_with_purchase'|'free_trial'|'giveaway'|'loyalty_perk'|'other'
  offer_value_framing: string | null;   // 'relative'|'absolute'|'both'
  offer_urgency: string | null;         // short phrase describing urgency/scarcity cue, or null if none
  offer_conditions: string | null;      // short phrase: minimum spend, code required, exclusions — or null if none
  offer_redemption: string | null;      // how to redeem: link in bio / code at checkout / DM / in-store
  offer_in_image: boolean;              // true if the offer is visible burned into the creative itself, not just the caption
  offer_audience_intent: string | null; // 'new_customer'|'retention'|'reactivation'|'list_building'|'general'
  visual_hooks: string[];
  text_hooks: string[];
  style: string;
  has_cta: boolean;
  cta: string | null;
  // Only populated when analyzePostCreative is called with a performanceContext
  // (i.e. for a detected outlier post) — otherwise all null.
  hook: string | null;
  content_pillar: string | null;
  audience_action_driver: string | null;
  // Only populated when analyzed via videoUrl (real video understanding) — null for image-only analysis.
  video_description: string | null;
  video_script: string | null;
}

async function fetchImageBase64(url: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    if (isS3Url(url)) {
      const file = await downloadFromS3(url);
      if (!file) { console.warn('[analyzePostCreative] S3 download failed:', url); return null; }
      if (file.body.length > MAX_IMAGE_BYTES) { console.warn('[analyzePostCreative] image too large (S3):', url, file.body.length); return null; }
      return { data: file.body.toString('base64'), mediaType: file.contentType || 'image/jpeg' };
    }

    const res = await fetch(url, {
      headers: { Referer: new URL(url).origin },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) { console.warn('[analyzePostCreative] image fetch non-OK:', res.status, url); return null; }
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) { console.warn('[analyzePostCreative] image too large:', url, buf.length); return null; }
    return { data: buf.toString('base64'), mediaType: contentType };
  } catch (err: any) {
    console.warn('[analyzePostCreative] image fetch threw:', url, err.message);
    return null;
  }
}

async function fetchVideoBase64(url: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    if (isS3Url(url)) {
      const file = await downloadFromS3(url);
      if (!file) { console.warn('[analyzePostCreative] S3 video download failed:', url); return null; }
      if (file.body.length > MAX_VIDEO_BYTES) { console.warn('[analyzePostCreative] video too large (S3):', url, file.body.length); return null; }
      return { data: file.body.toString('base64'), mediaType: file.contentType || 'video/mp4' };
    }

    const res = await fetch(url, {
      headers: { Referer: new URL(url).origin },
      signal: AbortSignal.timeout(20_000), // videos take longer to download than images
    });
    if (!res.ok) { console.warn('[analyzePostCreative] video fetch non-OK:', res.status, url); return null; }
    const contentType = res.headers.get('content-type') || 'video/mp4';
    if (!contentType.startsWith('video/')) {
      console.warn('[analyzePostCreative] video URL did not return video content-type, skipping:', contentType, url);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_VIDEO_BYTES) { console.warn('[analyzePostCreative] video too large:', url, buf.length); return null; }
    return { data: buf.toString('base64'), mediaType: contentType };
  } catch (err: any) {
    console.warn('[analyzePostCreative] video fetch threw:', url, err.message);
    return null;
  }
}

const str = (v: any): string | null => typeof v === 'string' && v ? v : null;

/** Normalize/guard raw base-analysis LLM output into the expected shape. Never throws. */
export function normalizePostCreativeAnalysis(raw: any): PostCreativeAnalysis | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    topic:         typeof raw.topic === 'string' ? raw.topic : '',
    has_offer:     !!raw.has_offer,
    offer_details: str(raw.offer_details),
    offer_mechanic: null, offer_value_framing: null, offer_urgency: null,
    offer_conditions: null, offer_redemption: null, offer_in_image: false, offer_audience_intent: null,
    visual_hooks:  Array.isArray(raw.visual_hooks) ? raw.visual_hooks.filter((h: any) => typeof h === 'string') : [],
    text_hooks:    Array.isArray(raw.text_hooks) ? raw.text_hooks.filter((h: any) => typeof h === 'string') : [],
    style:         typeof raw.style === 'string' ? raw.style : '',
    has_cta:       !!raw.has_cta,
    cta:           str(raw.cta),
    hook:                    str(raw.hook),
    content_pillar:          str(raw.content_pillar),
    audience_action_driver:  str(raw.audience_action_driver),
    video_description:       str(raw.video_description),
    video_script:            str(raw.video_script),
  };
}

// Coerces LLM drift like "relative (percent off)" down to the clean enum word.
function normalizeValueFraming(v: string | null): string | null {
  if (!v) return null;
  const lower = v.toLowerCase();
  if (lower.startsWith('relative')) return 'relative';
  if (lower.startsWith('absolute')) return 'absolute';
  if (lower.startsWith('both')) return 'both';
  return v;
}

/** Normalize/guard raw offer-breakdown LLM output. Never throws. */
function normalizeOfferBreakdown(raw: any) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    offer_mechanic:        str(raw.offer_mechanic),
    offer_value_framing:   normalizeValueFraming(str(raw.offer_value_framing)),
    offer_urgency:         str(raw.offer_urgency),
    offer_conditions:      str(raw.offer_conditions),
    offer_redemption:      str(raw.offer_redemption),
    offer_in_image:        !!raw.offer_in_image,
    offer_audience_intent: str(raw.offer_audience_intent),
  };
}

/**
 * Second-pass vision analysis, run ONLY for creatives already confirmed to
 * have has_offer=true — reuses the already-fetched image, no re-fetch.
 */
async function analyzeOfferBreakdown(input: {
  caption: string | null; cta: string | null; offerDetails: string | null; platform: string;
  imageBase64: string; imageMediaType: string; model: string; isVideo: boolean;
}) {
  try {
    const raw = await invokeLLM({
      model: input.model,
      maxTokens: 500,
      skipCache: true,
      imageBase64: input.imageBase64,
      imageMediaType: input.imageMediaType,
      response_json_schema: { type: 'object' },
      prompt: `You are a marketing analyst breaking down a competitor's promotional offer on ${input.platform}.
Caption: ${(input.caption || '(no caption)').slice(0, 800)}
${input.cta ? `CTA: ${input.cta}\n` : ''}Offer: ${input.offerDetails || '(see image)'}

Look at the attached ${input.isVideo ? 'video' : 'image'} and caption together. Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "offer_mechanic": "one of: percent_discount, fixed_amount, bogo, free_shipping, bundle, gift_with_purchase, free_trial, giveaway, loyalty_perk, other",
  "offer_value_framing": "one of exactly: relative, absolute, both — relative means percent off (e.g. 20%), absolute means a fixed amount off (e.g. 50 currency units off) — return ONLY the single word, not the explanation",
  "offer_urgency": "short phrase describing an urgency/scarcity cue if present (e.g. 'היום בלבד', 'מלאי מוגבל'), otherwise null",
  "offer_conditions": "short phrase for minimum spend / code required / exclusions if present, otherwise null",
  "offer_redemption": "short phrase for how to redeem — e.g. 'קישור בביו', 'קוד בקופה', 'הודעה פרטית', 'בחנות בלבד'",
  "offer_in_image": true,
  "offer_audience_intent": "one of: new_customer, retention, reactivation, list_building, general"
}`,
    });
    return normalizeOfferBreakdown(raw);
  } catch (err: any) {
    console.warn('[analyzeOfferBreakdown] failed:', err.message);
    return null;
  }
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
  // Raw video file — when present and fetchable, real video understanding (via
  // Gemini, the only provider in this app's chain that can digest video) is
  // used instead of the mediaUrl thumbnail. Falls back to the thumbnail on any
  // video-fetch failure — video is additive, never a hard requirement.
  videoUrl?: string | null;
  profile?: { name: string; category: string; city: string };
  // Present only when this post is a detected engagement outlier — grounds the
  // "hook"/"content_pillar"/"audience_action_driver" fields in the schema below.
  performanceContext?: { engagementMultiple: number };
}): Promise<PostCreativeAnalysis | null> {
  if (!input.mediaUrl && !input.videoUrl) return null;

  try {
    let media = input.videoUrl ? await fetchVideoBase64(input.videoUrl) : null;
    const isVideo = !!media;
    if (!media && input.mediaUrl) media = await fetchImageBase64(input.mediaUrl);
    if (!media) return null;

    const model = isVideo ? 'gemini-flash' : 'sonnet';

    const outlierFields = input.performanceContext ? `,
  "hook": "1-2 sentences: based on the caption/${isVideo ? 'video' : 'image'} AND that this post got ${input.performanceContext.engagementMultiple.toFixed(1)}x this account's average engagement on ${input.platform}, why did it likely stand out and drive people to stop scrolling and engage",
  "content_pillar": "a short recurring content theme/category label for this post, e.g. 'מבצעים', 'מאחורי הקלעים', 'לקוחות מרוצים', 'מוצר חדש', 'טיפים/חינוך', 'הומור/בידור'",
  "audience_action_driver": "what specifically the caption asked the audience to do to engage — e.g. 'ביקש לתייג חבר/ה', 'ביקש תגובות/דעות', 'ביקש לשתף', 'ביקש לייק/שמירה' — or null if there was no explicit ask"` : '';

    const videoFields = isVideo ? `,
  "video_description": "1-3 sentences: what actually happens in the video — actions, scenes, pacing, what's shown",
  "video_script": "the spoken narration or on-screen text/dialogue, transcribed/summarized — or null if there's no speech/narration"` : '';

    const analysis = await invokeLLM({
      model,
      maxTokens: 700,
      skipCache: true,
      imageBase64: media.data,
      imageMediaType: media.mediaType,
      response_json_schema: { type: 'object' },
      prompt: `You are a marketing analyst reviewing a competitor's ${input.platform} post creative.
${input.profile ? `My business: "${input.profile.name}" | Sector: ${input.profile.category} | City: ${input.profile.city}\n` : ''}
Caption: ${(input.caption || '(no caption)').slice(0, 800)}
${input.cta ? `Known CTA: ${input.cta}\n` : ''}
Look at the attached ${isVideo ? 'video' : 'image'} and the caption together. Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "topic": "what the post is about — 1 short phrase",
  "has_offer": false,
  "offer_details": "the specific discount/offer if has_offer is true (e.g. '20% הנחה על כל התפריט'), otherwise null",
  "visual_hooks": ["visual elements that grab attention — colors, faces, product shots, text overlays"],
  "text_hooks": ["specific words/phrases in the caption or ${isVideo ? 'video' : 'image'} text designed to grab attention"],
  "style": "overall creative style — e.g. 'מינימליסטי', 'צבעוני ואנרגטי', 'מקצועי'",
  "has_cta": false,
  "cta": "the call to action, ONLY if has_cta is true and it's a clear explicit instruction (e.g. 'הזמינו עכשיו', 'לפרטים בלינק בביו') — not just a vague sign-off. Otherwise null."${videoFields}${outlierFields}
}`,
    });

    const normalized = normalizePostCreativeAnalysis(analysis);
    if (!normalized) return null;

    if (normalized.has_offer) {
      const breakdown = await analyzeOfferBreakdown({
        caption: input.caption, cta: normalized.cta, offerDetails: normalized.offer_details,
        platform: input.platform, imageBase64: media.data, imageMediaType: media.mediaType,
        model, isVideo,
      });
      if (breakdown) Object.assign(normalized, breakdown);
    }

    return normalized;
  } catch (err: any) {
    console.warn('[analyzePostCreative] failed:', err.message);
    return null;
  }
}
