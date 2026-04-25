import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';

/**
 * detectDeliveryChanges — Delivery Platform Intelligence Agent
 *
 * Scans Wolt + 10bis for BOTH the business itself AND its competitors.
 * Extracts: rating, delivery time, min order, review sentiment, menu highlights.
 * LLM runs a competitive gap analysis and generates actionable insights.
 *
 * Data flow:
 *  1. 10bis public API  → structured data (rating, delivery_time, min_order)
 *  2. Wolt via Tavily   → URL + snippet
 *  3. Tavily review search → raw review text for LLM extraction
 *  4. LLM: compare own profile vs each competitor → identify top gap
 *  5. ProactiveAlert + MarketSignal with prefilled action
 *  6. Competitor model updated: menu_highlights, price_points, current_promotions
 */

const SERP_API_KEY = process.env.SERP_API_KEY || '';

// ── 10bis city ID map ─────────────────────────────────────────────────────────
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
  return 2; // default: Tel Aviv
}

// ── Typed result from a delivery platform ────────────────────────────────────
interface DeliveryProfile {
  platform: 'wolt' | '10bis' | 'none';
  rating?: number | null;
  delivery_time?: number | null;
  min_order?: number | null;
  url?: string | null;
  snippet?: string | null;
  found: boolean;
}

// ── 10bis public API ─────────────────────────────────────────────────────────
async function fetch10bis(name: string, city: string): Promise<DeliveryProfile> {
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
      r.restaurantName?.toLowerCase().includes(firstWord) ||
      firstWord.includes(r.restaurantName?.toLowerCase().split(' ')[0] || '___')
    );
    if (!match) return { platform: '10bis', found: false };
    return {
      platform: '10bis',
      found: true,
      rating: match.reviewsScore ?? null,
      delivery_time: match.deliveryTimeInMinutes ?? null,
      min_order: match.minimumOrder ?? null,
      url: `https://www.10bis.co.il/restaurants/${match.restaurantId}`,
    };
  } catch {
    return { platform: '10bis', found: false };
  }
}

// ── Wolt via SerpAPI or Tavily ────────────────────────────────────────────────
async function fetchWolt(name: string, city: string): Promise<DeliveryProfile> {
  // Try SerpAPI first (returns structured data with Wolt URLs)
  if (SERP_API_KEY) {
    try {
      const url = new URL('https://serpapi.com/search');
      url.searchParams.set('engine', 'google');
      url.searchParams.set('q', `"${name}" wolt ${city}`);
      url.searchParams.set('api_key', SERP_API_KEY);
      url.searchParams.set('num', '5');
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data: any = await res.json();
        const woltResult = (data.organic_results || []).find((r: any) =>
          r.link?.includes('wolt.com')
        );
        if (woltResult) {
          return { platform: 'wolt', found: true, url: woltResult.link, snippet: woltResult.snippet };
        }
      }
    } catch (_) {}
  }

  // Fallback: Tavily
  if (!isTavilyRateLimited()) {
    const results = await tavilySearch(`"${name}" site:wolt.com ${city}`, 3);
    const woltRes = results.find((r: any) => r.url?.includes('wolt.com'));
    if (woltRes) {
      return { platform: 'wolt', found: true, url: woltRes.url, snippet: woltRes.content?.slice(0, 200) };
    }
  }

  return { platform: 'wolt', found: false };
}

// ── Fetch review text via Tavily ──────────────────────────────────────────────
async function fetchReviews(name: string, city: string): Promise<string> {
  if (isTavilyRateLimited()) return '';
  try {
    const results = await tavilySearch(
      `"${name}" ${city} ביקורות wolt 10bis חוות דעת לקוח`,
      3,
    );
    return results
      .map((r: any) => `${r.title || ''}: ${(r.content || '').slice(0, 250)}`)
      .filter((t: string) => t.length > 20)
      .join('\n');
  } catch { return ''; }
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

    // ── Step 1: Scan the business itself ─────────────────────────────────────
    const [own10bis, ownWolt] = await Promise.all([
      fetch10bis(bizName, city),
      fetchWolt(bizName, city),
    ]);
    const ownReviews = await fetchReviews(bizName, city);

    const ownProfile = {
      name: bizName,
      tenbis: own10bis,
      wolt: ownWolt,
      reviews: ownReviews,
    };

    // ── Step 2: Scan competitors ──────────────────────────────────────────────
    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      take: 4, // max 4 to conserve API credits
    });

    const competitorProfiles: Array<{
      id: string;
      name: string;
      tenbis: DeliveryProfile;
      wolt: DeliveryProfile;
      reviews: string;
    }> = [];

    for (const comp of competitors) {
      try {
        const [t, w] = await Promise.all([
          fetch10bis(comp.name, city),
          fetchWolt(comp.name, city),
        ]);
        const reviews = await fetchReviews(comp.name, city);
        competitorProfiles.push({ id: comp.id, name: comp.name, tenbis: t, wolt: w, reviews });
      } catch (_) {}
    }

    // ── Step 3: Build analysis context for LLM ───────────────────────────────
    const buildProfileSummary = (p: typeof ownProfile | typeof competitorProfiles[0]) => {
      const lines: string[] = [`שם: ${p.name}`];
      if (p.tenbis.found) {
        lines.push(`10bis: ✓ דירוג ${p.tenbis.rating ?? '?'}/10 | ${p.tenbis.delivery_time ?? '?'} דק׳ | מינ׳ ₪${p.tenbis.min_order ?? '?'}`);
      } else {
        lines.push(`10bis: ✗ לא נמצא`);
      }
      if (p.wolt.found) {
        lines.push(`Wolt: ✓${p.wolt.snippet ? ' — ' + p.wolt.snippet.slice(0, 80) : ''}`);
      } else {
        lines.push(`Wolt: ✗ לא נמצא`);
      }
      if (p.reviews) lines.push(`ביקורות: ${p.reviews.slice(0, 300)}`);
      return lines.join('\n');
    };

    const ownSummary = buildProfileSummary(ownProfile);
    const competitorSummaries = competitorProfiles
      .map((c, i) => `--- מתחרה ${i + 1} ---\n${buildProfileSummary(c)}`)
      .join('\n\n');

    // ── Step 4: LLM comparative gap analysis ──────────────────────────────────
    if (competitorProfiles.length > 0 || own10bis.found || ownWolt.found) {
      try {
        const analysis: any = await invokeLLM({
          prompt: `אתה אנליסט עסקי מומחה. נתח את הנוכחות של העסק ומתחריו באפליקציות המשלוח ומצא תובנות אסטרטגיות.

=== העסק שלי ===
${ownSummary}

=== מתחרים ===
${competitorSummaries || 'אין מתחרים לנתח'}

משימה:
1. זהה את הפערים המשמעותיים ביותר בין העסק למתחרים (דירוג, זמן משלוח, מינימום הזמנה, נוכחות פלטפורמות)
2. חלץ תלונות חוזרות בביקורות של מתחרים שהעסק יכול לנצל
3. זהה אם העסק חסר בפלטפורמה שמתחרה נוכח בה

החזר JSON בדיוק:
{
  "own_delivery_summary": "סיכום קצר של מצב העסק באפליקציות — 1 משפט",
  "top_gap": "הפער הגדול ביותר שמזיק לעסק — 1 משפט ספציפי עם מספרים",
  "competitor_weakness": "חולשה חוזרת של המתחרים בביקורות שהעסק יכול לנצל — 1 משפט",
  "missing_platform": "שם הפלטפורמה שהעסק לא נמצא בה אבל המתחרים כן, או null",
  "action": "פעולה אחת ספציפית שהעסק צריך לעשות עכשיו — עד 10 מילים",
  "prefilled_text": "טקסט מוכן לפרסום — 2-3 שורות בעברית שמדגישים יתרון ספציפי על המתחרים",
  "impact": "high|medium"
}`,
          response_json_schema: { type: 'object' },
          model: 'haiku',
        });

        if (analysis?.action) {
          const alertTitle = `📦 אפליקציות משלוח: ${analysis.top_gap?.slice(0, 60) || 'תובנה חדשה'}`;
          const existing = await prisma.proactiveAlert.findFirst({
            where: { linked_business: businessProfileId, title: alertTitle, is_dismissed: false },
          });

          if (!existing) {
            const actionMeta = JSON.stringify({
              action_label: analysis.action.split(' ').slice(0, 5).join(' '),
              action_type: 'social_post',
              prefilled_text: analysis.prefilled_text || '',
              urgency_hours: analysis.impact === 'high' ? 24 : 72,
              impact_reason: analysis.top_gap || analysis.competitor_weakness || 'פער תחרותי באפליקציות משלוח',
            });

            const descParts = [
              analysis.own_delivery_summary,
              analysis.top_gap && `פער: ${analysis.top_gap}`,
              analysis.competitor_weakness && `חולשת מתחרים: ${analysis.competitor_weakness}`,
              analysis.missing_platform && `חסר בפלטפורמה: ${analysis.missing_platform}`,
            ].filter(Boolean).join('\n');

            await prisma.proactiveAlert.create({
              data: {
                alert_type: 'competitor_intel',
                title: alertTitle,
                description: descParts,
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
                summary: `אפליקציות משלוח: ${analysis.top_gap || 'ניתוח תחרותי'}`,
                category: 'competitor_move',
                impact_level: analysis.impact === 'high' ? 'high' : 'medium',
                recommended_action: analysis.action,
                confidence: 75,
                source_signals: 'delivery_platform_scan',
                source_description: JSON.stringify({
                  action_label: analysis.action.split(' ').slice(0, 5).join(' '),
                  action_type: 'social_post',
                  prefilled_text: analysis.prefilled_text || '',
                  time_minutes: 15,
                  urgency_hours: analysis.impact === 'high' ? 24 : 72,
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
    }

    // ── Step 5: Per-competitor snapshot delta + store enriched data ───────────
    for (const comp of competitorProfiles) {
      try {
        const dbComp = competitors.find(c => c.id === comp.id);
        if (!dbComp) continue;

        // Build new snapshot
        const newSnapshot = {
          on_10bis: comp.tenbis.found,
          on_wolt: comp.wolt.found,
          tenbis_rating: comp.tenbis.rating ?? null,
          tenbis_delivery_time: comp.tenbis.delivery_time ?? null,
          tenbis_min_order: comp.tenbis.min_order ?? null,
          wolt_url: comp.wolt.url ?? null,
          scanned_at: new Date().toISOString().slice(0, 10),
        };

        // Parse previous snapshot from notes
        const notesStr = dbComp.notes || '';
        const snapshotMatch = notesStr.match(/delivery_snapshot:\s*(\{.*?\})/s);
        let prevSnapshot: any = {};
        try { if (snapshotMatch) prevSnapshot = JSON.parse(snapshotMatch[1]); } catch (_) {}

        // Detect significant changes
        const joinedPlatform = (comp.tenbis.found && !prevSnapshot.on_10bis) ||
                               (comp.wolt.found && !prevSnapshot.on_wolt);
        const ratingDrop = prevSnapshot.tenbis_rating != null && comp.tenbis.rating != null &&
                           (prevSnapshot.tenbis_rating - comp.tenbis.rating) >= 0.5;
        const ratingRise = prevSnapshot.tenbis_rating != null && comp.tenbis.rating != null &&
                           (comp.tenbis.rating - prevSnapshot.tenbis_rating) >= 0.5;

        if (joinedPlatform || ratingDrop || ratingRise) {
          let summary = `${comp.name}: `;
          if (joinedPlatform) summary += `הצטרף ל${comp.tenbis.found && !prevSnapshot.on_10bis ? '10bis' : 'Wolt'}. `;
          if (ratingDrop) summary += `דירוג 10bis ירד ל-${comp.tenbis.rating?.toFixed(1)} — הזדמנות לתפוס לקוחות מאוכזבים.`;
          if (ratingRise) summary += `דירוג 10bis עלה ל-${comp.tenbis.rating?.toFixed(1)} — עולה בתחרות.`;

          await prisma.marketSignal.create({
            data: {
              summary,
              category: 'competitor_move',
              impact_level: ratingDrop || joinedPlatform ? 'high' : 'medium',
              recommended_action: ratingDrop
                ? `${comp.name} נחלש — הוסף מבצע לתפוס לקוחות שעוזבים`
                : `עקוב אחרי ${comp.name} בפלטפורמות חדשות`,
              confidence: 82,
              source_signals: 'delivery_platform_delta',
              is_read: false,
              detected_at: new Date().toISOString(),
              linked_business: businessProfileId,
            },
          }).catch(() => {});
          insightsCreated++;
        }

        // Update competitor with enriched delivery data
        const cleanNotes = notesStr.replace(/delivery_snapshot:\s*\{.*?\}/s, '').trim();
        const pricePoints = comp.tenbis.found
          ? `10bis: מינימום ₪${comp.tenbis.min_order || '?'} | ${comp.tenbis.delivery_time || '?'} דק׳ משלוח`
          : (dbComp.price_points || '');
        const menuHighlights = comp.wolt.snippet
          ? comp.wolt.snippet.slice(0, 200)
          : (dbComp.menu_highlights || '');

        await prisma.competitor.update({
          where: { id: comp.id },
          data: {
            last_scanned: new Date().toISOString(),
            notes: `${cleanNotes}\ndelivery_snapshot: ${JSON.stringify(newSnapshot)}`.trim().slice(0, 2000),
            price_points: pricePoints || undefined,
            menu_highlights: menuHighlights || undefined,
          },
        }).catch(() => {});
      } catch (_) {}
    }

    await writeAutomationLog('detectDeliveryChanges', businessProfileId, startTime, insightsCreated);
    console.log(`detectDeliveryChanges done: ${insightsCreated} insights, ${competitorProfiles.length} competitors scanned`);
    return res.json({
      own_on_10bis: own10bis.found,
      own_on_wolt: ownWolt.found,
      competitors_scanned: competitorProfiles.length,
      insights_created: insightsCreated,
    });
  } catch (err: any) {
    console.error('[detectDeliveryChanges] error:', err.message);
    await writeAutomationLog('detectDeliveryChanges', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
