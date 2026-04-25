import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';

/**
 * detectDeliveryChanges — Universal Marketplace Intelligence Agent
 *
 * Works across ALL business sectors by mapping category → relevant platforms.
 *
 * Sector → platform examples:
 *   Restaurant/food  → Wolt, 10bis, Google Maps, TripAdvisor
 *   Beauty/salon     → Treatwell, Fresha, Booksy, Google Maps
 *   Contractor       → Bark, Zapta/GetNinjas, Google Maps
 *   Hotel/tourism    → Booking.com, Airbnb, TripAdvisor
 *   Retail           → Zap, Google Shopping, Google Maps
 *   Health/clinic    → Doctour, Booksy, Google Maps
 *   Auto             → Yad2, Auto1, Google Maps
 *   Legal/finance    → Google Maps (universal review fallback)
 *
 * For each relevant platform:
 *  1. Search via Tavily (structured platform queries)
 *  2. For food: also use 10bis public API (structured data)
 *  3. Collect review snippets
 *  4. LLM comparative analysis → actionable insight
 *  5. ProactiveAlert + MarketSignal + Competitor update
 */

const SERP_API_KEY = process.env.SERP_API_KEY || '';

// ── Sector → Platform registry ─────────────────────────────────────────────────
interface PlatformDef {
  name: string;
  // Builds the Tavily query to find this business on this platform
  query: (bizName: string, city: string) => string;
  // Builds a review-specific search
  reviewQuery?: (bizName: string, city: string) => string;
  // Whether this platform has a real API (handled separately)
  hasApi?: boolean;
}

const PLATFORM_REGISTRY: Record<string, PlatformDef> = {
  wolt:        { name: 'Wolt',          query: (n, c) => `"${n}" site:wolt.com OR "wolt" "${n}" ${c}`,                      reviewQuery: (n, c) => `"${n}" wolt ביקורות דירוג` },
  tenbis:      { name: '10bis',         query: (n, c) => `"${n}" 10bis ${c}`,                                               hasApi: true },
  google_maps: { name: 'Google Maps',   query: (n, c) => `"${n}" ${c} google maps דירוג`,                                   reviewQuery: (n, c) => `"${n}" ${c} ביקורות google` },
  tripadvisor: { name: 'TripAdvisor',   query: (n, c) => `"${n}" site:tripadvisor.com OR "${n}" tripadvisor ${c}`,          reviewQuery: (n, c) => `"${n}" tripadvisor ביקורות` },
  treatwell:   { name: 'Treatwell',     query: (n, c) => `"${n}" site:treatwell.com OR "${n}" treatwell ${c}`,              reviewQuery: (n, c) => `"${n}" treatwell ביקורות` },
  fresha:      { name: 'Fresha',        query: (n, c) => `"${n}" site:fresha.com OR "${n}" fresha ${c}`,                    reviewQuery: (n, c) => `"${n}" fresha ביקורות` },
  booksy:      { name: 'Booksy',        query: (n, c) => `"${n}" site:booksy.com OR "${n}" booksy ${c}`,                    reviewQuery: (n, c) => `"${n}" booksy ביקורות` },
  bark:        { name: 'Bark',          query: (n, c) => `"${n}" site:bark.com OR "${n}" bark.com ${c}`,                    reviewQuery: (n, c) => `"${n}" bark ביקורות` },
  zapta:       { name: 'Zapta',         query: (n, c) => `"${n}" zapta OR getninja ${c} שירות`,                            reviewQuery: (n, c) => `"${n}" zapta ביקורות` },
  booking:     { name: 'Booking.com',   query: (n, c) => `"${n}" site:booking.com OR "${n}" booking.com`,                  reviewQuery: (n, c) => `"${n}" booking.com ביקורות` },
  airbnb:      { name: 'Airbnb',        query: (n, c) => `"${n}" site:airbnb.com OR "${n}" airbnb ${c}`,                   reviewQuery: (n, c) => `"${n}" airbnb ביקורות` },
  zap:         { name: 'Zap',           query: (n, c) => `"${n}" site:zap.co.il OR "${n}" zap.co.il`,                      reviewQuery: (n, c) => `"${n}" zap ביקורות` },
  yad2:        { name: 'Yad2',          query: (n, c) => `"${n}" site:yad2.co.il OR "${n}" yad2 ${c}`,                     reviewQuery: (n, c) => `"${n}" yad2 ביקורות` },
  doctour:     { name: 'Doctour',       query: (n, c) => `"${n}" doctour OR "קליניקה" "${n}" ${c}`,                        reviewQuery: (n, c) => `"${n}" רופא דירוג ביקורות` },
  classpass:   { name: 'ClassPass',     query: (n, c) => `"${n}" classpass OR arbox ${c}`,                                  reviewQuery: (n, c) => `"${n}" classpass arbox ביקורות` },
};

// ── Category keyword → relevant platforms ─────────────────────────────────────
// Ordered by priority (first = most relevant)
const SECTOR_MAP: Array<{ keywords: string[]; platforms: string[] }> = [
  {
    keywords: ['מסעדה', 'אוכל', 'מזון', 'קייטרינג', 'פיצה', 'סושי', 'בורגר', 'מאפייה', 'קפה', 'בית קפה', 'restaurant', 'food', 'cafe', 'bakery', 'catering'],
    platforms: ['wolt', 'tenbis', 'tripadvisor', 'google_maps'],
  },
  {
    keywords: ['בר', 'פאב', 'מועדון', 'bar', 'pub', 'club', 'nightclub'],
    platforms: ['wolt', 'tripadvisor', 'google_maps'],
  },
  {
    keywords: ['יופי', 'קוסמטיקה', 'מספרה', 'ספא', 'נייל', 'שיער', 'beauty', 'salon', 'spa', 'nail', 'hair', 'barbershop', 'barber'],
    platforms: ['treatwell', 'fresha', 'booksy', 'google_maps'],
  },
  {
    keywords: ['שיפוץ', 'בנייה', 'קבלן', 'אינסטלטור', 'חשמלאי', 'נגר', 'צביעה', 'renovation', 'contractor', 'plumber', 'electrician', 'carpenter'],
    platforms: ['bark', 'zapta', 'google_maps'],
  },
  {
    keywords: ['מלון', 'צימר', 'אכסניה', 'נופש', 'hotel', 'hostel', 'resort', 'vacation', 'airbnb'],
    platforms: ['booking', 'airbnb', 'tripadvisor', 'google_maps'],
  },
  {
    keywords: ['תיירות', 'טיולים', 'אטרקציה', 'tourism', 'tour', 'attraction', 'experience'],
    platforms: ['tripadvisor', 'booking', 'google_maps'],
  },
  {
    keywords: ['קמעונאות', 'חנות', 'חנות', 'ביגוד', 'אופנה', 'מתנות', 'retail', 'shop', 'store', 'fashion', 'clothing', 'gifts'],
    platforms: ['zap', 'google_maps'],
  },
  {
    keywords: ['אוטו', 'רכב', 'מוסך', 'car', 'auto', 'garage', 'vehicle'],
    platforms: ['yad2', 'google_maps'],
  },
  {
    keywords: ['רפואה', 'קליניקה', 'רופא', 'דנטיסט', 'פיזיו', 'medical', 'clinic', 'doctor', 'dentist', 'physio', 'health'],
    platforms: ['doctour', 'booksy', 'google_maps'],
  },
  {
    keywords: ['כושר', 'חדר כושר', 'יוגה', 'פילאטיס', 'fitness', 'gym', 'yoga', 'pilates'],
    platforms: ['classpass', 'google_maps'],
  },
];

// Default platforms for any unrecognized sector
const DEFAULT_PLATFORMS = ['google_maps'];

function detectSectorPlatforms(category: string): string[] {
  const lower = category.toLowerCase();
  for (const sector of SECTOR_MAP) {
    if (sector.keywords.some(kw => lower.includes(kw))) {
      return sector.platforms;
    }
  }
  return DEFAULT_PLATFORMS;
}

// ── 10bis public API ─────────────────────────────────────────────────────────
const TENBIS_CITY_IDS: Record<string, number> = {
  'תל אביב': 2, 'ירושלים': 3, 'חיפה': 4,
  'ראשון לציון': 7, 'פתח תקווה': 9, 'אשדוד': 10,
  'נתניה': 11, 'באר שבע': 14, 'בני ברק': 24,
  'הרצליה': 18, 'רמת גן': 6, 'גבעתיים': 5,
  'רעננה': 20, 'כפר סבא': 22, 'חולון': 8,
  'בת ים': 13, 'רחובות': 15, 'מודיעין': 25,
};

function getTenbisCity(city: string): number {
  for (const [key, val] of Object.entries(TENBIS_CITY_IDS)) {
    if (city.includes(key) || key.includes(city)) return val;
  }
  return 2;
}

interface PlatformResult {
  platform: string;
  found: boolean;
  rating?: number | null;
  delivery_time?: number | null;
  min_order?: number | null;
  url?: string | null;
  snippet?: string | null;
}

async function fetch10bisData(name: string, city: string): Promise<PlatformResult> {
  try {
    const cityId = getTenbisCity(city);
    const res = await fetch(
      `https://www.10bis.co.il/NextApi/GetRestaurants?cityId=${cityId}&cuisineId=0&deliveryMethod=Delivery`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return { platform: '10bis', found: false };
    const data: any = await res.json();
    const list: any[] = data?.Data?.restaurantsList || [];
    const firstWord = name.toLowerCase().split(' ')[0];
    const match = list.find((r: any) =>
      r.restaurantName?.toLowerCase().includes(firstWord)
    );
    if (!match) return { platform: '10bis', found: false };
    return {
      platform: '10bis', found: true,
      rating: match.reviewsScore ?? null,
      delivery_time: match.deliveryTimeInMinutes ?? null,
      min_order: match.minimumOrder ?? null,
      url: `https://www.10bis.co.il/restaurants/${match.restaurantId}`,
    };
  } catch {
    return { platform: '10bis', found: false };
  }
}

// ── Generic Tavily platform search ───────────────────────────────────────────
async function searchPlatform(
  platformKey: string,
  bizName: string,
  city: string,
): Promise<PlatformResult> {
  const def = PLATFORM_REGISTRY[platformKey];
  if (!def || isTavilyRateLimited()) return { platform: platformKey, found: false };

  try {
    const results = await tavilySearch(def.query(bizName, city), 2);
    const hit = results[0];
    if (!hit) return { platform: def.name, found: false };
    return {
      platform: def.name,
      found: true,
      url: hit.url,
      snippet: (hit.content || hit.title || '').slice(0, 200),
    };
  } catch {
    return { platform: def.name, found: false };
  }
}

// ── Fetch review text for a name across any platforms ────────────────────────
async function fetchReviewText(name: string, city: string, platformKeys: string[]): Promise<string> {
  if (isTavilyRateLimited()) return '';
  try {
    // One universal review query covers all sectors
    const q = `"${name}" ${city} ביקורות לקוחות דירוג חוות דעת`;
    const results = await tavilySearch(q, 3);
    return results
      .map((r: any) => `${r.title || ''}: ${(r.content || '').slice(0, 200)}`)
      .filter((t: string) => t.length > 20)
      .join('\n');
  } catch { return ''; }
}

// ── Build human-readable platform summary ────────────────────────────────────
function buildProfileSummary(
  name: string,
  platformResults: PlatformResult[],
  reviews: string,
): string {
  const lines: string[] = [`שם: ${name}`];
  for (const r of platformResults) {
    if (r.found) {
      const details = [
        r.rating != null ? `דירוג ${r.rating}` : '',
        r.delivery_time != null ? `${r.delivery_time} דק׳ משלוח` : '',
        r.min_order != null ? `₪${r.min_order} מינימום` : '',
        r.snippet ? r.snippet.slice(0, 80) : '',
      ].filter(Boolean).join(' | ');
      lines.push(`${r.platform}: ✓ ${details}`);
    } else {
      lines.push(`${r.platform}: ✗ לא נמצא`);
    }
  }
  if (reviews) lines.push(`ביקורות: ${reviews.slice(0, 250)}`);
  return lines.join('\n');
}

// ── Main agent ────────────────────────────────────────────────────────────────
export async function detectDeliveryChanges(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  let insightsCreated = 0;

  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name: bizName, city, category } = profile;

    // ── Step 1: Detect which platforms matter for this business sector ────────
    const platformKeys = detectSectorPlatforms(category || '');
    console.log(`[DeliveryIntel] ${bizName} (${category}) → platforms: ${platformKeys.join(', ')}`);

    // ── Step 2: Scan the business itself ─────────────────────────────────────
    const ownPlatformResults: PlatformResult[] = await Promise.all(
      platformKeys.map(key =>
        key === 'tenbis' ? fetch10bisData(bizName, city) : searchPlatform(key, bizName, city)
      )
    );
    const ownReviews = await fetchReviewText(bizName, city, platformKeys);
    const ownSummary = buildProfileSummary(bizName, ownPlatformResults, ownReviews);

    // ── Step 3: Scan competitors ──────────────────────────────────────────────
    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      take: 3,
    });

    const competitorSummaries: string[] = [];
    const scannedCompetitors: Array<{ id: string; name: string; results: PlatformResult[] }> = [];

    for (const comp of competitors) {
      try {
        const compResults: PlatformResult[] = await Promise.all(
          platformKeys.map(key =>
            key === 'tenbis' ? fetch10bisData(comp.name, city) : searchPlatform(key, comp.name, city)
          )
        );
        const compReviews = await fetchReviewText(comp.name, city, platformKeys);
        competitorSummaries.push(
          `--- מתחרה: ${comp.name} ---\n${buildProfileSummary(comp.name, compResults, compReviews)}`
        );
        scannedCompetitors.push({ id: comp.id, name: comp.name, results: compResults });
      } catch (_) {}
    }

    // ── Step 4: LLM gap analysis ──────────────────────────────────────────────
    const platformNames = platformKeys
      .map(k => PLATFORM_REGISTRY[k]?.name || k)
      .join(', ');

    try {
      const analysis: any = await invokeLLM({
        prompt: `אתה אנליסט עסקי בכיר. נתח את הנוכחות הדיגיטלית של העסק ומתחריו בפלטפורמות הרלוונטיות לסקטור שלהם.

סקטור עסקי: ${category}
פלטפורמות נסרקות: ${platformNames}

=== העסק שלי ===
${ownSummary}

=== מתחרים ===
${competitorSummaries.join('\n\n') || 'אין מתחרים לנתח'}

משימה — זהה:
1. האם העסק נעדר מפלטפורמה שמתחרה נוכח בה?
2. מה הפער הגדול ביותר בדירוגים/זמנים/תנאים?
3. אילו תלונות חוזרות מופיעות בביקורות של מתחרים שהעסק יכול לפרסם כיתרון?
4. מה ההמלצה הספציפית ביותר שמתאימה לסקטור ${category}?

החזר JSON בדיוק:
{
  "platforms_found_own": ["רשימת הפלטפורמות שהעסק נמצא בהן"],
  "missing_platform": "שם הפלטפורמה החשובה ביותר שהעסק לא נמצא בה, או null",
  "top_gap": "הפער המספרי הגדול ביותר — 1 משפט ספציפי עם מספרים אם יש",
  "competitor_weakness": "חולשה חוזרת של המתחרים שהעסק יכול לנצל — 1 משפט",
  "action": "פעולה ספציפית אחת לשיפור הנוכחות הדיגיטלית — עד 10 מילים",
  "prefilled_text": "טקסט מוכן לפרסום/שיווק שמדגיש את היתרון — 2-3 שורות בעברית",
  "impact": "high|medium"
}`,
        response_json_schema: { type: 'object' },
        model: 'haiku',
      });

      if (analysis?.action) {
        const alertTitle = `🔍 נוכחות דיגיטלית (${platformNames}): ${(analysis.top_gap || analysis.missing_platform || 'תובנה חדשה').slice(0, 55)}`;
        const existing = await prisma.proactiveAlert.findFirst({
          where: { linked_business: businessProfileId, title: alertTitle, is_dismissed: false },
        });

        if (!existing) {
          const actionMeta = JSON.stringify({
            action_label: analysis.action.split(' ').slice(0, 5).join(' '),
            action_type: analysis.missing_platform ? 'task' : 'social_post',
            prefilled_text: analysis.prefilled_text || '',
            urgency_hours: analysis.impact === 'high' ? 48 : 96,
            impact_reason: [
              analysis.top_gap,
              analysis.competitor_weakness,
              analysis.missing_platform && `חסר ב-${analysis.missing_platform}`,
            ].filter(Boolean).join(' | '),
          });

          const descLines = [
            analysis.top_gap && `פער: ${analysis.top_gap}`,
            analysis.competitor_weakness && `חולשת מתחרים: ${analysis.competitor_weakness}`,
            analysis.missing_platform && `לא נמצא ב-${analysis.missing_platform} — המתחרים כן`,
          ].filter(Boolean).join('\n');

          await prisma.proactiveAlert.create({
            data: {
              alert_type: 'competitor_intel',
              title: alertTitle,
              description: descLines,
              suggested_action: analysis.action,
              priority: analysis.impact === 'high' ? 'high' : 'medium',
              source_agent: actionMeta,
              is_dismissed: false,
              is_acted_on: false,
              created_at: new Date().toISOString(),
              linked_business: businessProfileId,
            },
          }).catch(() => {});

          await prisma.marketSignal.create({
            data: {
              summary: `נוכחות דיגיטלית — ${analysis.top_gap || analysis.missing_platform || 'ניתוח פלטפורמות'}`,
              category: 'competitor_move',
              impact_level: analysis.impact === 'high' ? 'high' : 'medium',
              recommended_action: analysis.action,
              confidence: 72,
              source_signals: `marketplace_scan:${platformKeys.join(',')}`,
              source_description: JSON.stringify({
                action_label: analysis.action.split(' ').slice(0, 5).join(' '),
                action_type: analysis.missing_platform ? 'task' : 'social_post',
                prefilled_text: analysis.prefilled_text || '',
                time_minutes: 20,
                urgency_hours: analysis.impact === 'high' ? 48 : 96,
              }),
              is_read: false,
              detected_at: new Date().toISOString(),
              linked_business: businessProfileId,
            },
          }).catch(() => {});

          insightsCreated++;
        }
      }
    } catch (_) {}

    // ── Step 5: Per-competitor delta + store enriched data ───────────────────
    for (const scanned of scannedCompetitors) {
      try {
        const dbComp = competitors.find(c => c.id === scanned.id);
        if (!dbComp) continue;

        // Build new snapshot
        const newSnapshot: Record<string, any> = {
          scanned_at: new Date().toISOString().slice(0, 10),
          platforms: {},
        };
        for (const r of scanned.results) {
          newSnapshot.platforms[r.platform] = {
            found: r.found,
            rating: r.rating ?? null,
            delivery_time: r.delivery_time ?? null,
          };
        }

        // Detect rating drops from previous snapshot
        const notesStr = dbComp.notes || '';
        const snapMatch = notesStr.match(/marketplace_snapshot:\s*(\{.*?\}(?:\n|}$))/s);
        let prevSnapshot: any = {};
        try { if (snapMatch) prevSnapshot = JSON.parse(snapMatch[1]); } catch (_) {}

        // Check per-platform rating changes
        for (const r of scanned.results) {
          if (!r.found || r.rating == null) continue;
          const prev = prevSnapshot?.platforms?.[r.platform];
          if (!prev?.rating) continue;
          const delta = r.rating - prev.rating;
          if (Math.abs(delta) >= 0.4) {
            const isDropped = delta < 0;
            await prisma.marketSignal.create({
              data: {
                summary: `${scanned.name}: דירוג ב-${r.platform} ${isDropped ? 'ירד' : 'עלה'} ל-${r.rating.toFixed(1)}`,
                category: 'competitor_move',
                impact_level: isDropped ? 'high' : 'medium',
                recommended_action: isDropped
                  ? `${scanned.name} נחלש ב-${r.platform} — הזדמנות לפרסם עדיפות`
                  : `${scanned.name} משתפר ב-${r.platform} — עקוב`,
                confidence: 85,
                source_signals: 'marketplace_delta',
                is_read: false,
                detected_at: new Date().toISOString(),
                linked_business: businessProfileId,
              },
            }).catch(() => {});
            insightsCreated++;
          }
        }

        // Store enriched data in Competitor fields
        const tenbisResult = scanned.results.find(r => r.platform === '10bis' && r.found);
        const woltResult   = scanned.results.find(r => r.platform === 'Wolt' && r.found);
        const otherSnippet = scanned.results.find(r => r.found && r.snippet)?.snippet;

        const cleanNotes = notesStr.replace(/marketplace_snapshot:\s*\{.*?\}/s, '').trim();

        await prisma.competitor.update({
          where: { id: scanned.id },
          data: {
            last_scanned: new Date().toISOString(),
            notes: `${cleanNotes}\nmarketplace_snapshot: ${JSON.stringify(newSnapshot)}`.trim().slice(0, 2000),
            price_points: tenbisResult
              ? `10bis: מינימום ₪${tenbisResult.min_order ?? '?'} | ${tenbisResult.delivery_time ?? '?'} דק׳`
              : undefined,
            menu_highlights: (woltResult?.snippet || otherSnippet || '').slice(0, 200) || undefined,
            current_promotions: scanned.results
              .filter(r => r.found)
              .map(r => r.platform)
              .join(', ') || undefined,
          },
        }).catch(() => {});
      } catch (_) {}
    }

    await writeAutomationLog('detectDeliveryChanges', businessProfileId, startTime, insightsCreated);
    console.log(`[DeliveryIntel] done — sector: ${category} | platforms: ${platformKeys.join(',')} | insights: ${insightsCreated}`);
    return res.json({
      sector: category,
      platforms_scanned: platformKeys.map(k => PLATFORM_REGISTRY[k]?.name || k),
      competitors_scanned: scannedCompetitors.length,
      insights_created: insightsCreated,
    });
  } catch (err: any) {
    console.error('[DeliveryIntel] error:', err.message);
    await writeAutomationLog('detectDeliveryChanges', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
