import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../../db';
import Anthropic from '@anthropic-ai/sdk';

const OPENAI_API_KEY      = process.env.OPENAI_API_KEY      || '';
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || '';
const PEXELS_API_KEY      = process.env.PEXELS_API_KEY      || '';

// Google Imagen (Vertex AI)
const GCP_PROJECT_ID  = process.env.GOOGLE_CLOUD_PROJECT_ID         || '';
const GCP_LOCATION    = process.env.GOOGLE_CLOUD_LOCATION            || 'us-central1';
const GCP_CREDS_JSON  = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '';

// ── Google Service Account JWT + Imagen ──────────────────────────────────────

function base64url(str: string): string {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getGoogleAccessToken(credsJson: string): Promise<string> {
  const creds = JSON.parse(credsJson);
  const now   = Math.floor(Date.now() / 1000);

  const header  = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss:   creds.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }));

  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(creds.private_key, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });

  const tokenData: any = await tokenRes.json();
  if (!tokenData.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

async function generateWithImagen(englishPrompt: string): Promise<string | null> {
  if (!GCP_PROJECT_ID || !GCP_CREDS_JSON) return null;

  const token = await getGoogleAccessToken(GCP_CREDS_JSON);

  const endpoint = `https://${GCP_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/publishers/google/models/imagen-3.0-generate-001:predict`;

  const imagenRes = await fetch(endpoint, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{
        prompt: `${englishPrompt}, professional marketing photography, vibrant colors, modern commercial style, well-lit, no text overlay, no logos, suitable for Instagram post`,
      }],
      parameters: {
        sampleCount:       1,
        aspectRatio:       '1:1',
        safetyFilterLevel: 'block_few',
        personGeneration:  'allow_adult',
      },
    }),
  });

  if (!imagenRes.ok) {
    const errText = await imagenRes.text();
    throw new Error(`Imagen ${imagenRes.status}: ${errText.slice(0, 200)}`);
  }

  const data: any = await imagenRes.json();
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('Imagen returned no image');

  // Return as data URL — no external storage required
  return `data:image/png;base64,${b64}`;
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
  // Try full API translation first — best quality for free-form Hebrew descriptions
  // Step 1: GPT-4o-mini
  const gpt = await gptTranslate(text);
  if (gpt) return gpt;
  // Step 2: Google Translate
  const google = await googleTranslate(text);
  if (google) return google;
  // Step 3: Claude Haiku
  const claude = await claudeTranslate(text);
  if (claude) return claude;
  // Step 4: local dictionary + strip (last resort)
  return translateCustomPrompt(text);
}

// ── Sector → curated Unsplash photo IDs (stable, no API key needed) ─────────
const SECTOR_PHOTO_IDS: Record<string, string[]> = {
  restaurant: ['1517248135467-4c7edcad34c4', '1414235077428-338989a2e8c0', '1555396273-367ea4eb4db5'],
  cafe:       ['1501339847302-ac426a4a7cbb', '1495474472287-4d71bcdd2085', '1442512595331-3f6a1e6e4cd7'],
  fitness:    ['1534438327276-14e5300c3a48', '1571019614242-c5c5dee9f50b', '1506629082955-511b1aa562c8'],
  gym:        ['1534438327276-14e5300c3a48', '1581009137042-c6e32dc793f4', '1517836357463-d25dfeac3438'],
  beauty:     ['1560066984-138dadb4c035', '1522335789203-aabd1fc54bc9', '1487412947147-5cebf100ffc2'],
  salon:      ['1560066984-138dadb4c035', '1522335789203-aabd1fc54bc9', '1604654894610-df63bc536371'],
  health:     ['1576091160399-112ba8d25d1d', '1505751172876-fa1923c5c528', '1526256262350-7da7584cf5eb'],
  tech:       ['1518770660439-4636190af475', '1581091226825-a6a2a5aee158', '1563986768494-4dee2763ff3f'],
  retail:     ['1441986300917-64674bd600d8', '1607082349566-187531fc9759', '1472851294608-ac1d6e0ce4d6'],
  food:       ['1498837167922-ddd27525d352', '1504674900247-0877df9cc836', '1490645935967-10de6ba17061'],
  bakery:     ['1509440159596-0249088772ff', '1555507036-ab1f4038808a', '1476224203421-9ac39bcb3327'],
  law:        ['1589829545856-d10d557cf95f', '1436450412740-5e3b1b77f1cb', '1453728013993-6d66e9c9123a'],
  education:  ['1503676260728-1c00da094a0b', '1456513080510-7bf3a84b82f8', '1523050854058-8df90110c9f1'],
  realestate: ['1560518883-ce09059eeffa', '1512917774080-9991f1c4c750', '1558618666-fcd25c85cd64'],
  local:      ['1556742049-0cfed4f6a45d', '1441986300917-64674bd600d8', '1542744094-24638eff58bb'],
};

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

function extractVisualKeywords(insightText: string, postText: string, sector: string): string {
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
  const visualKeywords = extractVisualKeywords(insightText, postText, sector);

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

// ── Simple deterministic hash ─────────────────────────────────────────────────
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getDynamicFallback(insightText: string, sector: string): string {
  const seed = simpleHash(`${insightText}${sector}${Date.now()}`);
  return `https://picsum.photos/seed/${seed}/1024/576`;
}

function unsplashCdnUrl(photoId: string): string {
  return `https://images.unsplash.com/photo-${photoId}?w=1024&h=576&fit=crop&auto=format`;
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
 * Tier 1: DALL-E 3 via OpenAI (if OPENAI_API_KEY configured)
 * Tier 2: Pexels (if PEXELS_API_KEY configured) — random from 15 results on force_regenerate
 *       : Unsplash search (if UNSPLASH_ACCESS_KEY configured)
 * Tier 3: picsum.photos with insight-seeded URL (always works)
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

  // Translate: dictionary first, then Claude fallback (async)
  // Auto-mode: extract visual keywords from insight text (sync, no LLM needed)
  const translatedCustom = hasCustom ? await translateForSearch(custom_prompt.trim()) : '';
  const visualKeywords   = hasCustom
    ? translatedCustom
    : extractVisualKeywords(insightText, post_text, sector);

  console.log('[generateImage] custom_prompt:', custom_prompt || '(none)');
  console.log('[generateImage] translatedCustom:', translatedCustom || '(none)');
  console.log('[generateImage] visualKeywords:', visualKeywords.slice(0, 80));
  console.log('[generateImage] force_regenerate:', force_regenerate);

  let dalleAttempted = false;

  // ── Tier 0: Google Imagen 3 (Vertex AI) ──────────────────────────────────
  if (GCP_PROJECT_ID && GCP_CREDS_JSON) {
    try {
      const imagenPrompt = hasCustom
        ? translatedCustom
        : buildDynamicImagePrompt(insightText, post_text, sector, city).replace(/[^\x00-\x7F]/g, '');

      console.log('[generateImage] Imagen prompt:', imagenPrompt.slice(0, 120));
      const url = await generateWithImagen(imagenPrompt);
      if (url) {
        console.log('[generateImage] Imagen success');
        return res.json({ url, provider: 'imagen3', is_stock: false, dalle_attempted: false });
      }
    } catch (err: any) {
      console.warn('[generateImage] Imagen failed:', err.message);
    }
  }

  // ── Tier 1: DALL-E 3 ──────────────────────────────────────────────────────
  if (OPENAI_API_KEY) {
    dalleAttempted = true;
    try {
      const variationSeed = force_regenerate ? ` [style variation ${Math.floor(Math.random() * 1000)}]` : '';
      const prompt = hasCustom
        ? `${translatedCustom}, professional marketing photography, vibrant colors, modern commercial style, well-lit, no text overlay, no logos, suitable for Instagram post${variationSeed}`
        : buildDynamicImagePrompt(insightText, post_text, sector, city) + variationSeed;

      console.log('[generateImage] DALL-E prompt:', prompt.slice(0, 120));

      const dalleRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt,
          n: 1,
          size: '1024x1024',
          quality: 'standard',
          response_format: 'url',
        }),
      });

      if (dalleRes.ok) {
        const data: any = await dalleRes.json();
        const url = data.data?.[0]?.url;
        if (url) {
          return res.json({ url, provider: 'dalle3', is_stock: false, dalle_attempted: true });
        }
      } else {
        const errBody: any = await dalleRes.json().catch(() => ({}));
        console.warn('[generateImage] DALL-E error:', dalleRes.status, errBody.error?.message);
      }
    } catch (err: any) {
      console.warn('[generateImage] DALL-E exception:', err.message);
    }
  }

  // ── Tier 2a: Pexels ───────────────────────────────────────────────────────
  if (PEXELS_API_KEY) {
    try {
      const query = encodeURIComponent(visualKeywords.slice(0, 80));
      const pexelsRes = await fetch(
        `https://api.pexels.com/v1/search?query=${query}&per_page=15&orientation=landscape`,
        { headers: { 'Authorization': PEXELS_API_KEY } },
      );

      if (pexelsRes.ok) {
        const data: any = await pexelsRes.json();
        const photos: any[] = data.photos || [];
        if (photos.length > 0) {
          // Pick random photo on force_regenerate, first photo otherwise
          const idx = force_regenerate ? Math.floor(Math.random() * photos.length) : 0;
          const chosen = photos[idx];
          const altPhotos = photos
            .filter((_, i) => i !== idx)
            .slice(0, 5)
            .map(p => p.src?.medium || p.src?.original);

          return res.json({
            url: chosen.src?.large2x || chosen.src?.large || chosen.src?.original,
            provider: 'pexels',
            is_stock: true,
            dalle_attempted: dalleAttempted,
            credit: chosen.photographer,
            alt_photos: altPhotos,
          });
        }
      }
    } catch (err: any) {
      console.warn('[generateImage] Pexels exception:', err.message);
    }
  }

  // ── Tier 2b: Unsplash search API ─────────────────────────────────────────
  if (UNSPLASH_ACCESS_KEY) {
    try {
      const query = encodeURIComponent(
        visualKeywords.split(' ').slice(0, 4).join(' '),
      );
      const unsplashRes = await fetch(
        `https://api.unsplash.com/search/photos?query=${query}&per_page=15&orientation=landscape`,
        { headers: { 'Authorization': `Client-ID ${UNSPLASH_ACCESS_KEY}` } },
      );

      if (unsplashRes.ok) {
        const data: any = await unsplashRes.json();
        const results: any[] = data.results || [];
        if (results.length > 0) {
          const idx = force_regenerate ? Math.floor(Math.random() * results.length) : 0;
          const chosen = results[idx];
          const altPhotos = results
            .filter((_, i) => i !== idx)
            .slice(0, 5)
            .map(p => p.urls?.thumb);

          return res.json({
            url: chosen.urls?.regular,
            provider: 'unsplash',
            is_stock: true,
            dalle_attempted: dalleAttempted,
            credit: chosen.user?.name,
            alt_photos: altPhotos,
          });
        }
      }
    } catch (err: any) {
      console.warn('[generateImage] Unsplash exception:', err.message);
    }
  }

  // ── Tier 2c: loremflickr — keyword-aware, no API key required ──────────────
  // Uses the actual visual keywords (translated custom prompt or insight keywords)
  // so the image is always topically relevant.
  // Format: https://loremflickr.com/1024/576/keyword1,keyword2?random=N
  {
    // Take first 3 meaningful words from visualKeywords as search tags
    const tags = visualKeywords
      .replace(/[^a-zA-Z ,]/g, '')   // keep only ASCII + spaces + commas
      .split(/[\s,]+/)
      .filter(w => w.length > 3)
      .slice(0, 3)
      .join(',');

    const searchTags = tags || sector;

    // random param ensures a different image on force_regenerate
    const randomParam = force_regenerate ? `?random=${Date.now()}` : `?random=${simpleHash(visualKeywords)}`;

    // Build 5 alt photo URLs with different random seeds for quick swap
    const altPhotos = Array.from({ length: 5 }, (_, i) =>
      `https://loremflickr.com/400/300/${searchTags}?random=${simpleHash(visualKeywords) + i + 1}`
    );

    return res.json({
      url: `https://loremflickr.com/1024/576/${searchTags}${randomParam}`,
      provider: 'stock',
      is_stock: true,
      dalle_attempted: dalleAttempted,
      alt_photos: altPhotos,
    });
  }
}
