import { Request, Response } from 'express';
import { prisma } from '../../db';
import Anthropic from '@anthropic-ai/sdk';
import { invokeLLM } from '../../lib/llm';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''; // used for translation fallback only

// Google Imagen 3 — simple API key (no Vertex / service account needed)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Flux.1 via fal.ai
const FAL_API_KEY = process.env.FAL_API_KEY || '';

// ── Tier 0: Google Imagen 3 via Gemini API ────────────────────────────────────

async function generateWithGeminiImagen(englishPrompt: string): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${GEMINI_API_KEY}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{
          prompt: `${englishPrompt}, professional marketing photography, vibrant colors, modern commercial style, well-lit, no text overlay, no logos, suitable for social media post`,
        }],
        parameters: {
          sampleCount:       1,
          aspectRatio:       '1:1',
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

// ── Tier 1: Flux.1 schnell via fal.ai ────────────────────────────────────────

async function generateWithFlux(englishPrompt: string): Promise<string | null> {
  if (!FAL_API_KEY) return null;

  const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method:  'POST',
    headers: {
      'Authorization': `Key ${FAL_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      prompt: `${englishPrompt}, professional marketing photography, vibrant colors, modern commercial style, well-lit, no text overlay, no logos, suitable for social media`,
      image_size:           'square_hd',
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

// ── Claude-powered Hebrew → English translation (fallback) ───────────────────
const _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

async function claudeTranslate(hebrewText: string): Promise<string | null> {
  try {
    const msg = await _anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 60,
      messages:   [{ role: 'user', content: `Translate to English for image search (3-6 descriptive words only, no punctuation): "${hebrewText}"` }],
    });
    const text = (msg.content[0] as any).text?.trim();
    return text && text.length > 2 ? text : null;
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
  // Step 1: Claude Haiku — primary (Anthropic is our main provider)
  const claude = await claudeTranslate(text);
  if (claude) return claude;
  // Step 2: GPT-4o-mini — fallback
  const gpt = await gptTranslate(text);
  if (gpt) return gpt;
  // Step 3: Google Translate — fallback when both AI providers unavailable
  const google = await googleTranslate(text);
  if (google) return google;
  // Step 4: local dictionary + strip (last resort, no API needed)
  return translateCustomPrompt(text);
}


// ── Insight-to-visual keyword mapping ────────────────────────────────────────
const INSIGHT_TO_VISUAL: Array<{ keywords: string[]; visual: string }> = [
  { keywords: ['happy hour', 'שעת שמחה', 'קוקטייל', 'cocktail', 'בר', 'bar'], visual: 'cocktails bar colorful drinks happy hour' },
  { keywords: ['תפריט', 'menu', 'מנה', 'dish', 'אוכל חדש', 'new dish'], visual: 'restaurant menu gourmet food presentation' },
  { keywords: ['מבצע', 'sale', 'הנחה', 'discount', 'מחיר', 'price'], visual: 'sale promotion discount shopping deal' },
  { keywords: ['קפה', 'coffee', 'בוקר', 'morning', 'לאטה', 'latte'], visual: 'coffee latte art morning cafe cozy' },
  { keywords: ['ספורט', 'sport', 'כושר', 'fitness', 'אימון', 'workout'], visual: 'fitness workout gym exercise energy' },
  { keywords: ['יום הולדת', 'birthday', 'חגיגה', 'celebration', 'אירוע'], visual: 'birthday celebration party festive' },
  { keywords: ['קייטרינג', 'catering', 'אירוח', 'event food'], visual: 'catering event food table spread' },
  { keywords: ['קיץ', 'summer', 'חוף', 'beach', 'שמש', 'sun'], visual: 'summer beach bright sunshine vibrant' },
  { keywords: ['חורף', 'winter', 'חם', 'warm', 'עונה', 'season'], visual: 'cozy winter warm comfort indoor' },
  { keywords: ['בריאות', 'health', 'טרי', 'fresh', 'ירקות', 'vegetables', 'סלט', 'salad'], visual: 'healthy food fresh vegetables salad wellness' },
  { keywords: ['פיצה', 'pizza'], visual: 'pizza fresh baked melted cheese' },
  { keywords: ['בשר', 'meat', 'גריל', 'grill', 'סטייק', 'steak'], visual: 'grilled meat steak barbecue sizzle' },
  { keywords: ['עוגה', 'cake', 'מאפה', 'pastry', 'קינוח', 'dessert'], visual: 'cake pastry dessert bakery sweet' },
  { keywords: ['יופי', 'beauty', 'מניקור', 'manicure', 'שיער', 'hair', 'ספא', 'spa'], visual: 'beauty spa treatment self care luxury' },
  { keywords: ['חדר כושר', 'gym', 'שרירים', 'muscle', 'משקולות', 'weights'], visual: 'gym weights fitness equipment modern' },
  { keywords: ['נדל"ן', 'real estate', 'דירה', 'apartment', 'בית', 'house'], visual: 'modern apartment interior real estate bright' },
  { keywords: ['פתיחה', 'opening', 'חדש', 'new', 'חנות חדשה'], visual: 'grand opening new store ribbon cutting celebration' },
  { keywords: ['משלוח', 'delivery', 'שליח', 'courier'], visual: 'food delivery courier box packaging' },
  { keywords: ['לקוח', 'customer', 'שירות', 'service', 'חוויה', 'experience'], visual: 'customer service smiling staff welcoming' },
  { keywords: ['מוזיקה', 'music', 'הופעה', 'performance', 'אומן', 'artist'], visual: 'live music performance stage concert' },
];

// ── Hebrew → English translation dictionary ───────────────────────────────────
// Used for DALL-E prompts and Pexels/Unsplash search queries.
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
 * Translate Hebrew custom prompt to English for DALL-E / Pexels.
 * Replaces known Hebrew phrases with English equivalents.
 * Strips remaining Hebrew characters, leaving only English.
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

/** Use LLM to extract 5 English visual keywords directly from the post text */
async function extractKeywordsFromPost(postText: string, businessName: string, sector: string): Promise<string> {
  if (postText.trim().length < 20) return '';
  try {
    const result = await invokeLLM({
      model: 'haiku',
      maxTokens: 80,
      prompt: `Extract 5 English visual keywords for a stock photo search that matches this marketing post.
Business: "${businessName}" (${sector})
Post text: "${postText.slice(0, 300)}"
Rules: English only, descriptive nouns/adjectives, suitable for photo search (e.g. "fresh sushi salmon roll restaurant").
Return ONLY the keywords as a single line, space-separated. No JSON, no explanation.`,
      response_json_schema: undefined,
    });
    // invokeLLM returns parsed JSON by default — if we get a string-like result, use it
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    const cleaned = text.replace(/["{}\[\]]/g, '').replace(/\n/g, ' ').trim();
    if (cleaned.length > 5) return cleaned.slice(0, 120);
  } catch { /* fall through */ }
  return '';
}

function extractVisualKeywordsSync(insightText: string, postText: string, sector: string): string {
  const combined = `${insightText} ${postText}`.toLowerCase();

  for (const entry of INSIGHT_TO_VISUAL) {
    if (entry.keywords.some(kw => combined.includes(kw.toLowerCase()))) {
      return entry.visual;
    }
  }

  // Fall back to sector-based keywords
  const sectorKeywords: Record<string, string> = {
    restaurant: 'restaurant dining table food elegant',
    cafe:       'coffee shop cafe cozy interior',
    fitness:    'fitness gym workout equipment modern',
    beauty:     'beauty salon spa treatment luxury',
    health:     'medical clinic wellness clean bright',
    tech:       'modern office technology startup',
    retail:     'retail store shopping products display',
    food:       'fresh food ingredients colorful',
    bakery:     'fresh baked goods pastry artisan',
    law:        'law office professional corporate',
    education:  'education learning books classroom',
    realestate: 'modern home interior real estate',
    local:      'local business storefront welcoming',
  };
  return sectorKeywords[sector] || sectorKeywords.local;
}

function buildDynamicImagePrompt(insightText: string, postText: string, sector: string, city: string): string {
  const visualKeywords = extractVisualKeywordsSync(insightText, postText, sector);

  // Strip non-ASCII to avoid DALL-E content policy issues
  const cleanInsight = insightText
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 100);

  return [
    `Professional marketing photograph: ${visualKeywords}.`,
    cleanInsight ? `Context: ${cleanInsight}.` : '',
    'Style: vibrant colors, modern commercial photography, well-lit, sharp focus.',
    'Requirements: no text overlays, no logos, no faces, suitable for social media.',
  ].filter(Boolean).join(' ');
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
 * generateImage — server-side image generation with dynamic prompts + 3-tier fallback.
 *
 * Tier 0: Google Imagen 3 via Gemini API (GEMINI_API_KEY)
 * Tier 1: Flux.1 schnell via fal.ai (FAL_API_KEY)
 *
 * Body: { businessProfileId, insight_text?, post_text?, custom_prompt?, force_regenerate? }
 * Returns: { url, provider, is_stock, alt_photos? }
 *
 * When custom_prompt is provided it overrides the auto-generated prompt for DALL-E
 * and is used as the Pexels/Unsplash search query too.
 */
export async function generateImage(req: Request, res: Response) {
  const {
    businessProfileId,
    insight_text     = '',
    post_text        = '',
    custom_prompt    = '',   // free-text user description — highest priority
    force_regenerate = false,
    // legacy support
    summary          = '',
  } = req.body;

  const insightText = insight_text || summary;

  let category = '';
  let city     = '';
  if (businessProfileId) {
    try {
      const bp = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
      category = bp?.category || '';
      city     = bp?.city     || '';
    } catch (_) {}
  }

  const sector = categoryToSector(category);

  const hasCustom = custom_prompt.trim().length > 0;
  const hasPost   = post_text.trim().length >= 20;

  // Priority: custom_prompt > post_text (LLM keywords) > hardcoded insight mapping
  const translatedCustom = hasCustom ? await translateForSearch(custom_prompt.trim()) : '';
  let visualKeywords: string;
  if (hasCustom) {
    visualKeywords = translatedCustom;
  } else if (hasPost) {
    // Extract keywords from the actual post content so the image matches what was written
    const postKeywords = await extractKeywordsFromPost(post_text, category, sector);
    visualKeywords = postKeywords || extractVisualKeywordsSync(insightText, post_text, sector);
  } else {
    visualKeywords = extractVisualKeywordsSync(insightText, post_text, sector);
  }

  console.log('[generateImage] keywords:', visualKeywords.slice(0, 80), '| force:', force_regenerate);

  const aiPrompt = hasCustom
    ? translatedCustom
    : buildDynamicImagePrompt(insightText, post_text, sector, city).replace(/[^\x00-\x7F]/g, '');

  const variationSuffix = force_regenerate ? ` variation ${Math.floor(Math.random() * 9000) + 1000}` : '';
  const finalPrompt = aiPrompt + variationSuffix;

  // ── Tier 0: Google Imagen 3 (Gemini API — simple key, no service account) ──
  if (GEMINI_API_KEY) {
    try {
      console.log('[generateImage] trying Gemini Imagen 3...');
      const url = await generateWithGeminiImagen(finalPrompt);
      if (url) {
        console.log('[generateImage] Gemini Imagen 3 success');
        return res.json({ url, provider: 'imagen3', is_stock: false });
      }
    } catch (err: any) {
      console.warn('[generateImage] Gemini Imagen failed:', err.message);
    }
  }

  // ── Tier 1: Flux.1 schnell (fal.ai) ──────────────────────────────────────
  if (FAL_API_KEY) {
    try {
      console.log('[generateImage] trying Flux.1 schnell...');
      const url = await generateWithFlux(finalPrompt);
      if (url) {
        console.log('[generateImage] Flux.1 success');
        return res.json({ url, provider: 'flux1', is_stock: false });
      }
    } catch (err: any) {
      console.warn('[generateImage] Flux failed:', err.message);
    }
  }

  return res.status(503).json({ error: 'Image generation unavailable — configure GEMINI_API_KEY or FAL_API_KEY' });
}
