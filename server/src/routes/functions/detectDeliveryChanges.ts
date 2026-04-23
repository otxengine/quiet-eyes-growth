import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
const SERP_API_KEY   = process.env.SERP_API_KEY   || '';

// 10bis city codes (partial list)
const TENBIS_CITY_IDS: Record<string, number> = {
  'תל אביב': 2,
  'ירושלים': 3,
  'חיפה': 4,
  'ראשון לציון': 7,
  'פתח תקווה': 9,
  'אשדוד': 10,
  'נתניה': 11,
  'באר שבע': 14,
  'בני ברק': 24,
  'הרצליה': 18,
  'רמת גן': 6,
  'גבעתיים': 5,
};

function getTenbisCity(city: string): number {
  for (const [key, val] of Object.entries(TENBIS_CITY_IDS)) {
    if (city.includes(key) || key.includes(city)) return val;
  }
  return 2; // default: Tel Aviv
}

interface DeliveryData {
  platform: string;
  name: string;
  rating?: number;
  delivery_time?: number | null;
  min_order?: number | null;
  url?: string;
  snippet?: string;
}

/**
 * Fetch competitor presence on 10bis via their semi-public API.
 */
async function scrapeTenbis(name: string, city: string): Promise<DeliveryData | null> {
  try {
    const cityId = getTenbisCity(city);
    const res = await fetch(
      `https://www.10bis.co.il/NextApi/GetRestaurants?cityId=${cityId}&cuisineId=0&deliveryMethod=Delivery`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const list: any[] = data?.Data?.restaurantsList || [];
    const match = list.find(r =>
      r.restaurantName?.toLowerCase().includes(name.toLowerCase().split(' ')[0]),
    );
    if (!match) return null;
    return {
      platform: '10bis',
      name: match.restaurantName,
      rating: match.reviewsScore,
      delivery_time: match.deliveryTimeInMinutes,
      min_order: match.minimumOrder,
      url: `https://www.10bis.co.il/restaurants/${match.restaurantId}`,
    };
  } catch { return null; }
}

/**
 * Search for competitor on Wolt via SerpAPI (if key available) or Tavily.
 */
async function scrapeWolt(name: string, city: string): Promise<DeliveryData | null> {
  // Method 1: SerpAPI Google search
  if (SERP_API_KEY) {
    try {
      const url = new URL('https://serpapi.com/search');
      url.searchParams.set('engine', 'google');
      url.searchParams.set('q', `${name} wolt ${city}`);
      url.searchParams.set('api_key', SERP_API_KEY);
      url.searchParams.set('num', '5');

      const res = await fetch(url.toString());
      if (res.ok) {
        const data: any = await res.json();
        const woltResult = data.organic_results?.find((r: any) =>
          r.link?.includes('wolt.com'),
        );
        if (woltResult) {
          return {
            platform: 'wolt',
            name,
            url: woltResult.link,
            snippet: woltResult.snippet,
          };
        }
      }
    } catch (_) {}
  }

  // Method 2: Tavily
  if (TAVILY_API_KEY) {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query: `"${name}" site:wolt.com ${city}`,
          search_depth: 'basic',
          max_results: 3,
        }),
      });
      if (res.ok) {
        const data: any = await res.json();
        const woltRes = (data.results || []).find((r: any) => r.url?.includes('wolt.com'));
        if (woltRes) {
          return {
            platform: 'wolt',
            name,
            url: woltRes.url,
            snippet: woltRes.content?.slice(0, 200),
          };
        }
      }
    } catch (_) {}
  }

  return null;
}

/**
 * detectDeliveryChanges — DeliveryPlatformAgent (background, no UI)
 *
 * Runs automatically via MasterOrchestrator. Uses 10bis public API + Wolt search.
 * Snapshots stored in competitor.notes as JSON. Delta → MarketSignal.
 *
 * Body: { businessProfileId }
 * Returns: { competitors_scanned, changes_detected }
 */
export async function detectDeliveryChanges(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  let changesDetected = 0;

  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { city } = profile;

    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      take: 8,
    });

    if (competitors.length === 0) {
      await writeAutomationLog('detectDeliveryChanges', businessProfileId, startTime, 0);
      return res.json({ competitors_scanned: 0, changes_detected: 0 });
    }

    for (const comp of competitors) {
      try {
        // Fetch from multiple platforms
        const [tenbisData, woltData] = await Promise.all([
          scrapeTenbis(comp.name, city),
          scrapeWolt(comp.name, city),
        ]);

        const newSnapshot = {
          on_10bis: !!tenbisData,
          on_wolt:  !!woltData,
          tenbis_rating: tenbisData?.rating ?? null,
          tenbis_min_order: tenbisData?.min_order ?? null,
          wolt_url: woltData?.url ?? null,
          scanned_at: new Date().toISOString().slice(0, 10),
        };

        // Extract previous snapshot from notes
        const notesStr = comp.notes || '';
        const snapshotMatch = notesStr.match(/delivery_snapshot:\s*(\{[^}]+\})/);
        let prevSnapshot: any = {};
        try {
          if (snapshotMatch) prevSnapshot = JSON.parse(snapshotMatch[1]);
        } catch (_) {}

        // Detect meaningful delta
        const newPlatform10bis = newSnapshot.on_10bis && !prevSnapshot.on_10bis;
        const newPlatformWolt  = newSnapshot.on_wolt  && !prevSnapshot.on_wolt;
        const ratingChanged    = prevSnapshot.tenbis_rating != null &&
          Math.abs((newSnapshot.tenbis_rating ?? 0) - prevSnapshot.tenbis_rating) >= 0.3;

        if (newPlatform10bis || newPlatformWolt || ratingChanged) {
          changesDetected++;

          let summary = `שינוי פלטפורמת משלוח — ${comp.name}: `;
          if (newPlatform10bis) summary += 'הצטרף ל-10bis. ';
          if (newPlatformWolt)  summary += 'הצטרף ל-Wolt. ';
          if (ratingChanged)    summary += `דירוג 10bis עודכן ל-${newSnapshot.tenbis_rating?.toFixed(1)}.`;

          const platforms = [
            newSnapshot.on_10bis ? '10bis' : '',
            newSnapshot.on_wolt  ? 'Wolt'  : '',
          ].filter(Boolean).join(', ');

          await prisma.marketSignal.create({
            data: {
              summary,
              category: 'competitor_move',
              impact_level: (newPlatform10bis || newPlatformWolt) ? 'high' : 'medium',
              recommended_action:
                `${comp.name} פעיל בפלטפורמות: ${platforms || 'לא נמצא'}.\n` +
                (tenbisData ? `10bis: ₪${tenbisData.min_order || '?'} מינימום, ${tenbisData.delivery_time || '?'} דקות.\n` : '') +
                `שקול הצטרפות לאותן פלטפורמות או השוואת מחירים.`,
              confidence: 78,
              source_urls: tenbisData?.url || woltData?.url || '',
              is_read: false,
              detected_at: new Date().toISOString(),
              linked_business: businessProfileId,
            },
          }).catch(() => {});
        }

        // Save new snapshot into competitor.notes
        const cleanNotes = notesStr.replace(/delivery_snapshot:\s*\{[^}]+\}/g, '').trim();
        await prisma.competitor.update({
          where: { id: comp.id },
          data: {
            notes: `${cleanNotes}\ndelivery_snapshot: ${JSON.stringify(newSnapshot)}`.trim(),
          },
        }).catch(() => {});
      } catch (_) { /* skip competitor */ }
    }

    await writeAutomationLog('detectDeliveryChanges', businessProfileId, startTime, changesDetected);
    return res.json({ competitors_scanned: competitors.length, changes_detected: changesDetected });
  } catch (err: any) {
    console.error('[detectDeliveryChanges] error:', err.message);
    await writeAutomationLog('detectDeliveryChanges', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
