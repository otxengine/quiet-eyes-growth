import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { callGemini } from '../../lib/gemini';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''; // used for translation fallback only

// Google Imagen Ultra — simple API key (no Vertex / service account needed)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Flux.1 via fal.ai
const FAL_API_KEY = process.env.FAL_API_KEY || '';

// ── Tier 1 (fallback): Google Imagen Ultra via Gemini API ───────────────────

// Platform → aspect ratio mappings
const PLATFORM_ASPECT: Record<string, string> = {
  instagram_post:     '1:1',
  instagram_portrait: '3:4',   // 4:5 not supported by Imagen; 3:4 is closest
  instagram_story:    '9:16',
  tiktok:             '9:16',
  facebook:           '4:3',
  facebook_landscape: '16:9',
};

// Platform → Flux image_size or custom dims
const PLATFORM_FLUX_SIZE: Record<string, string | { width: number; height: number }> = {
  instagram_post:     'square_hd',            // 1024×1024
  instagram_portrait: { width: 864, height: 1080 }, // ~4:5
  instagram_story:    'portrait_16_9',        // 576×1024
  tiktok:             'portrait_16_9',
  facebook:           'landscape_4_3',        // 1024×768
  facebook_landscape: 'landscape_16_9',       // 1024×576
};

async function generateWithGeminiImagen(englishPrompt: string, platform = 'instagram_post'): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;

  const aspectRatio = PLATFORM_ASPECT[platform] || '1:1';

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-ultra-generate-001:predict?key=${GEMINI_API_KEY}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{
          prompt: `${englishPrompt}, professional marketing photography, vibrant colors, modern commercial style, well-lit, no text overlay, no logos, suitable for social media post`,
        }],
        parameters: {
          sampleCount:       1,
          aspectRatio,
          safetyFilterLevel: 'block_few',
          personGeneration:  'allow_adult',
        },
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini Imagen ${res.status}: ${err.slice(0, 200)}`);
  }

  const data: any = await res.json();
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('Gemini Imagen returned no image data');

  return `data:image/png;base64,${b64}`;
}

// ── Tier 0 (primary): Flux.1 schnell via fal.ai ──────────────────────────────

async function generateWithFlux(englishPrompt: string, platform = 'instagram_post'): Promise<string | null> {
  if (!FAL_API_KEY) return null;

  const sizeVal = PLATFORM_FLUX_SIZE[platform] || 'square_hd';
  const sizeParam = typeof sizeVal === 'string'
    ? { image_size: sizeVal }
    : { image_size: { width: (sizeVal as any).width, height: (sizeVal as any).height } };

  const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method:  'POST',
    headers: {
      'Authorization': `Key ${FAL_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      prompt: `${englishPrompt}, professional marketing photography, vibrant colors, modern commercial style, well-lit, no text overlay, no logos, suitable for social media`,
      ...sizeParam,
      num_images:           1,
      output_format:        'jpeg',
      num_inference_steps:  4,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Flux ${res.status}: ${err.slice(0, 200)}`);
  }

  const data: any = await res.json();
  const url = data.images?.[0]?.url;
  if (!url) throw new Error('Flux returned no image URL');

  return url;
}

// ── Gemini-powered Hebrew → English translation (primary) ────────────────────

async function geminiTranslate(hebrewText: string): Promise<string | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  try {
    const text = await callGemini(
      `Translate to English for image search (3-6 descriptive words only, no punctuation): "${hebrewText}"`,
      'gemini-flash',
      60,
    );
    const trimmed = text?.trim();
    return trimmed && trimmed.length > 2 ? trimmed : null;
  } catch {
    return null;
  }
}

async function gptTranslate(hebrewText: string): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model:      'gpt-4o-mini',
        max_tokens: 30,
        messages: [{
          role:    'user',
          content: `Translate to English for image search (3-6 descriptive words only, no punctuation): "${hebrewText}"`,
        }],
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    return text && text.length > 2 ? text : null;
  } catch {
    return null;
  }
}

const GOOGLE_TRANSLATE_KEY = process.env.GOOGLE_TRANSLATE_API_KEY || '';

async function googleTranslate(text: string): Promise<string | null> {
  if (!GOOGLE_TRANSLATE_KEY) return null;
  try {
    const res = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${GOOGLE_TRANSLATE_KEY}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ q: text, target: 'en', source: 'iw' }),
      },
    );
    const data: any = await res.json();
    const translated = data.data?.translations?.[0]?.translatedText;
    return translated && translated.length > 2 ? translated : null;
  } catch {
    return null;
  }
}

async function translateForSearch(text: string): Promise<string> {
  if (!text) return text;
  // If no Hebrew, nothing to translate
  if (!/[\u0590-\u05FF]/.test(text)) return text;
  // Step 1: Gemini Flash — primary (fast + cheap)
  const gemini = await geminiTranslate(text);
  if (gemini) return gemini;
  // Step 2: GPT-4o-mini — fallback
  const gpt = await gptTranslate(text);
  if (gpt) return gpt;
  // Step 3: Google Translate — fallback when both AI providers unavailable
  const google = await googleTranslate(text);
  if (google) return google;
  // Step 4: local dictionary + strip (last resort, no API needed)
  return translateCustomPrompt(text);
}


// ── Sector fallback scene descriptions (used when LLM prompt build fails) ────
const SECTOR_FALLBACK: Record<string, string> = {
  restaurant:  'Elegant restaurant table with beautifully plated gourmet dish, warm candlelight, shallow depth of field, editorial food photography',
  cafe:        'Cozy cafe interior, latte art in ceramic cup on wooden table, morning sunlight through window, warm lifestyle photography',
  fitness:     'Modern gym with professional equipment, athlete in motion, dramatic lighting, motivational sports photography',
  beauty:      'Luxury beauty salon, skincare products arranged on marble surface, soft diffused light, premium lifestyle photography',
  health:      'Clean bright medical clinic, professional healthcare environment, welcoming atmosphere, trust-inspiring photography',
  bakery:      'Freshly baked artisan bread and pastries on rustic wooden board, golden hour light, food styling photography',
  retail:      'Modern boutique interior, stylish product display with accent lighting, inviting commercial photography',
  realestate:  'Bright modern apartment living room, minimalist furniture, large windows, architectural lifestyle photography',
  tech:        'Sleek modern office with technology, collaborative workspace, professional corporate photography',
  law:         'Professional law office, polished wooden desk, books, confident atmosphere, corporate photography',
  education:   'Bright classroom or study space, books and learning materials, inspiring educational photography',
  food:        'Fresh colorful ingredients arranged on clean surface, vibrant food photography, natural lighting',
  local:       'Welcoming business storefront with warm interior, professional commercial photography',
};

// ── Hebrew → English translation dictionary (last-resort, no API needed) ─────
// Longer phrases first so they match before their sub-words.
const HEB_TO_ENG: Array<[string, string]> = [
  // Business types
  ['מכון פילאטיס',    'pilates studio reformer equipment'],
  ['חדר כושר',        'gym fitness center weights equipment'],
  ['מספרה לגברים',    'mens barber shop haircut'],
  ['מספרה לנשים',     'womens hair salon styling'],
  ['בית קפה',         'coffee shop cafe cozy interior'],
  ['מסעדה יוקרתית',   'luxury restaurant fine dining elegant'],
  ['מסעדה משפחתית',   'family restaurant cozy home-style'],
  ['מסעדה אסייתית',   'asian restaurant food noodles'],
  ['מסעדה איטלקית',   'italian restaurant pasta pizza'],
  ['מסעדת שף',        'chef restaurant gourmet plating'],
  ['מסעדה',           'restaurant dining food table'],
  ['קליניקה',         'clinic medical professional clean'],
  ['מרפאת שיניים',    'dental clinic professional'],
  ['מרפאה',          'medical clinic health professional'],
  ['ספא ויופי',       'spa beauty treatment luxury'],
  ['חנות פרחים',      'flower shop bouquet colorful'],
  ['מאפייה',          'bakery fresh bread pastry artisan'],
  ['קונדיטוריה',      'patisserie cake dessert elegant'],
  ['בר קוקטיילים',    'cocktail bar drinks evening neon'],
  ['גן ילדים',        'kindergarten children colorful toys'],
  ['סטודיו צילום',    'photography studio professional lighting'],
  ['חנות בגדים',      'clothing store fashion boutique'],
  ['חנות תכשיטים',    'jewelry store display elegant'],
  ['חנות ספרים',      'bookstore cozy reading library'],
  ['סטודיו יוגה',     'yoga studio mat serene light'],
  ['עיצוב פנים',      'interior design modern living room'],
  ['נדלן',            'real estate modern home architecture'],
  ['עורך דין',        'law office professional corporate'],
  // Activities / concepts
  ['פילאטיס',         'pilates exercise reformer studio'],
  ['יוגה',            'yoga meditation wellness mat'],
  ['אימון כושר',      'fitness workout training gym'],
  ['שחייה',           'swimming pool water sport'],
  ['ריצה',            'running outdoor sport morning'],
  ['אופניים',         'cycling bicycle outdoor sport'],
  ['בוקסינג',         'boxing gloves gym training'],
  ['זומבה',           'dance fitness energy colorful'],
  ['מניקור ופדיקור',  'manicure pedicure nail salon beauty'],
  ['עיצוב שיער',      'hair styling salon professional'],
  ['טיפול פנים',      'facial skin care beauty treatment'],
  ['עיסוי',           'massage therapy relaxation spa'],
  // Food
  ['סטייק',           'steak grilled meat sizzle restaurant'],
  ['פיצה',            'pizza fresh baked cheese restaurant'],
  ['סושי',            'sushi japanese food fresh presentation'],
  ['המבורגר',         'burger gourmet bun fresh restaurant'],
  ['ארוחת בוקר',      'breakfast food morning coffee table'],
  ['ארוחת ערב',       'dinner elegant restaurant evening'],
  ['קינוח',           'dessert sweet cake plating elegant'],
  ['גלידה',           'ice cream colorful sweet summer'],
  ['שייק',            'smoothie colorful healthy fresh'],
  ['קפה',             'coffee latte art warm cafe'],
  ['עוגה',            'cake birthday celebration sweet'],
  ['מאפים',           'pastry fresh baked goods artisan'],
  ['סלט',             'salad fresh healthy vegetables colorful'],
  ['פלאפל',           'falafel street food israel'],
  ['שוורמה',          'shawarma street food middle eastern'],
  // Occasions
  ['יום הולדת',       'birthday celebration party festive'],
  ['חתונה',           'wedding elegant floral celebration'],
  ['בר מצווה',        'bar mitzvah celebration jewish'],
  ['חגים',            'holiday celebration festive warm'],
  ['ראש השנה',        'jewish new year holiday festive'],
  // General
  ['תמונה מקצועית',   'professional photography studio lighting'],
  ['עם אנשים',        'people smiling happy team'],
  ['ללא אנשים',       'product photography clean minimal'],
  ['בחוץ',            'outdoor natural light lifestyle'],
  ['בפנים',           'indoor interior modern cozy'],
  ['לילה',            'night evening atmospheric lighting'],
  ['בוקר',            'morning fresh light breakfast'],
  ['ערב',             'evening warm light atmospheric'],
  ['קיץ',             'summer bright colorful sunny'],
  ['חורף',            'winter cozy warm indoor'],
  ['מבצע',            'sale promotion deal colorful marketing'],
  ['חדש',             'new launch product fresh modern'],
  ['יוקרה',           'luxury premium elegant high-end'],
  ['טבעי',            'natural organic fresh green'],
];

/**
 * Last-resort translation: replace known Hebrew phrases, strip remaining Hebrew.
 */
function translateCustomPrompt(hebrewText: string): string {
  let result = hebrewText;

  // Replace known Hebrew phrases (longest first — already ordered in HEB_TO_ENG)
  for (const [heb, eng] of HEB_TO_ENG) {
    if (result.includes(heb)) {
      result = result.replace(heb, eng);
    }
  }

  // Strip remaining Hebrew Unicode characters (keeps English, numbers, punctuation)
  result = result.replace(/[\u0590-\u05FF\uFB1D-\uFB4F]/g, ' ');
  result = result.replace(/\s{2,}/g, ' ').trim();

  // If nothing usable left (fully Hebrew with no match), return a generic fallback
  if (result.length < 3) {
    result = 'professional marketing business photo vibrant commercial style';
  }

  return result;
}

/**
 * Build a rich AI image generation prompt using Claude Haiku.
 * Translates Hebrew post text → detailed English photographic scene description.
 * Falls back to sector scene if LLM unavailable.
 */
async function buildAIImagePrompt(
  insightText: string,
  postText:    string,
  sector:      string,
  businessName: string,
  city:        string,
): Promise<string> {
  const sourceText = [
    postText    ? `Marketing post (may be Hebrew): "${postText.slice(0, 500)}"` : '',
    insightText ? `Campaign context: "${insightText.slice(0, 150)}"` : '',
    `Business type: ${businessName} — ${sector} in ${city}`,
  ].filter(Boolean).join('\n');

  if (sourceText.length < 20) {
    return SECTOR_FALLBACK[sector] || SECTOR_FALLBACK.local;
  }

  try {
    const result = await invokeLLM({
      model:    'haiku',
      maxTokens: 150,
      prompt: `You are an expert commercial photographer writing an AI image generation prompt.
Based on the marketing context below, write ONE detailed photographic scene description in English.

${sourceText}

Rules:
- Describe a specific visual scene: subject, setting, lighting, angle, mood, style
- Match the business type and post topic precisely
- English only, 25-50 words
- NO text, NO logos, NO watermarks in the described scene
- Photographic style: professional commercial or editorial photography
- Do NOT mention the business name or city
- Return ONLY the prompt, no explanation`,
      response_json_schema: undefined,
    });

    const text = (typeof result === 'string' ? result : JSON.stringify(result))
      .replace(/^["']|["']$/g, '')
      .replace(/\n/g, ' ')
      .trim();

    if (text.length > 20) return text.slice(0, 500);
  } catch { /* fall through to sector fallback */ }

  return SECTOR_FALLBACK[sector] || SECTOR_FALLBACK.local;
}



function categoryToSector(category = ''): string {
  const c = category.toLowerCase();
  if (c.includes('מסעד') || c.includes('restaurant')) return 'restaurant';
  if (c.includes('קפה') || c.includes('cafe') || c.includes('coffee')) return 'cafe';
  if (c.includes('כושר') || c.includes('fitness') || c.includes('gym')) return 'fitness';
  if (c.includes('יופי') || c.includes('beauty') || c.includes('salon')) return 'beauty';
  if (c.includes('בריאות') || c.includes('health') || c.includes('רפואה')) return 'health';
  if (c.includes('טכנולוגיה') || c.includes('tech') || c.includes('software')) return 'tech';
  if (c.includes('חנות') || c.includes('retail') || c.includes('shop')) return 'retail';
  if (c.includes('אפייה') || c.includes('מאפה') || c.includes('bakery')) return 'bakery';
  if (c.includes('עורך דין') || c.includes('משפט') || c.includes('law')) return 'law';
  if (c.includes('נדל') || c.includes('real estate')) return 'realestate';
  if (c.includes('חינוך') || c.includes('education') || c.includes('לימוד')) return 'education';
  if (c.includes('אוכל') || c.includes('food')) return 'food';
  return 'local';
}

/**
 * generateImage — AI image generation.
 *
 * Tier 0: Flux.1 schnell via fal.ai (FAL_API_KEY) — primary
 * Tier 1: Google Imagen 3 via Gemini API (GEMINI_API_KEY) — fallback
 *
 * Prompt strategy:
 *   custom_prompt → translated to English directly
 *   post_text / insight_text → Claude Haiku writes a detailed photographic scene prompt
 *   neither → sector fallback scene description
 *
 * Body: { businessProfileId, insight_text?, post_text?, custom_prompt?, force_regenerate?, platform? }
 * platform: 'instagram_post' (default) | 'instagram_portrait' | 'instagram_story' | 'tiktok' | 'facebook' | 'facebook_landscape'
 * Returns: { url, provider, is_stock, platform, prompt_used? }
 */
export async function generateImage(req: Request, res: Response) {
  const {
    businessProfileId,
    insight_text     = '',
    post_text        = '',
    custom_prompt    = '',
    force_regenerate = false,
    platform         = 'instagram_post',
    summary          = '', // legacy
  } = req.body;

  const insightText = insight_text || summary;

  let category     = '';
  let city         = '';
  let businessName = '';
  if (businessProfileId) {
    try {
      const bp = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
      category     = bp?.category || '';
      city         = bp?.city     || '';
      businessName = bp?.name     || '';
    } catch (_) {}
  }

  const sector = categoryToSector(category);

  // Build the prompt: custom → LLM scene description → sector fallback
  let basePrompt: string;
  if (custom_prompt.trim()) {
    basePrompt = await translateForSearch(custom_prompt.trim());
  } else {
    basePrompt = await buildAIImagePrompt(insightText, post_text, sector, businessName, city);
  }

  const variationSuffix = force_regenerate ? `, unique composition ${Math.floor(Math.random() * 9000) + 1000}` : '';
  const finalPrompt = basePrompt + variationSuffix;

  console.log('[generateImage] prompt:', finalPrompt.slice(0, 120), '| platform:', platform, '| force:', force_regenerate);

  // ── Tier 0: Flux.1 schnell via fal.ai (primary — fast, reliable) ──────────
  if (FAL_API_KEY) {
    try {
      console.log('[generateImage] trying Flux.1 schnell...');
      const url = await generateWithFlux(finalPrompt, platform);
      if (url) {
        console.log('[generateImage] Flux.1 success, platform:', platform);
        return res.json({ url, provider: 'flux1', is_stock: false, platform });
      }
    } catch (err: any) {
      console.warn('[generateImage] Flux failed:', err.message);
    }
  }

  // ── Tier 1: Google Imagen 3 (requires paid Google Cloud + Imagen API) ─────
  if (GEMINI_API_KEY) {
    try {
      console.log('[generateImage] trying Gemini Imagen 3...');
      const url = await generateWithGeminiImagen(finalPrompt, platform);
      if (url) {
        console.log('[generateImage] Gemini Imagen 3 success, platform:', platform);
        return res.json({ url, provider: 'imagen3', is_stock: false, platform });
      }
    } catch (err: any) {
      console.warn('[generateImage] Gemini Imagen failed:', err.message);
    }
  }

  return res.status(503).json({ error: 'Image generation unavailable — configure GEMINI_API_KEY or FAL_API_KEY' });
}
