import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM } from '../../lib/llm';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';
const CURRENT_YEAR = new Date().getFullYear();

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function tavilySearch(query: string, maxResults = 5): Promise<any[]> {
  if (!TAVILY_API_KEY) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, search_depth: 'advanced', max_results: maxResults }),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return data.results || [];
  } catch { return []; }
}

/** Geocode a city name to lat/lng using Google Geocoding API */
async function geocodeCity(city: string): Promise<{ lat: number; lng: number } | null> {
  if (!GOOGLE_API_KEY) return null;
  try {
    const input = encodeURIComponent(`${city} ישראל`);
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${input}&language=iw&region=il&key=${GOOGLE_API_KEY}`);
    const data: any = await res.json();
    const loc = data.results?.[0]?.geometry?.location;
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  } catch { return null; }
}

/** Search Google Places within radius meters of a location */
async function googleNearbySearch(query: string, lat: number, lng: number, radiusM: number): Promise<any[]> {
  if (!GOOGLE_API_KEY) return [];
  try {
    const params = new URLSearchParams({
      location: `${lat},${lng}`,
      radius: String(Math.min(radiusM, 50000)), // Google max 50km
      keyword: query,
      language: 'iw',
      region: 'il',
      key: GOOGLE_API_KEY,
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`);
    const data: any = await res.json();
    return data.results?.slice(0, 15) || [];
  } catch { return []; }
}

/** Fallback text search when no coordinates available */
async function googlePlacesSearch(query: string, city: string): Promise<any[]> {
  if (!GOOGLE_API_KEY) return [];
  try {
    const input = encodeURIComponent(`${query} ${city} ישראל`);
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${input}&language=iw&region=il&key=${GOOGLE_API_KEY}`);
    const data: any = await res.json();
    return data.results?.slice(0, 10) || [];
  } catch { return []; }
}

export async function runCompetitorIdentification(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city } = profile;
    const radiusKm: number = (profile as any).search_radius_km || 15;
    const userExtraCities: string[] = ((profile as any).additional_cities || '')
      .split(',').map((c: string) => c.trim()).filter(Boolean);

    // ── Step 1: Understand the business type + get nearby cities ──────────────
    const contextResult = await invokeLLM({
      model: 'haiku',
      maxTokens: 400,
      prompt: `עסק ישראלי: "${name}", קטגוריה: ${category}, עיר: ${city}

1. מה הסוג המדויק של העסק? (למשל: "בר סושי יפני", "פיצרייה", "ספר לגברים")
2. מה מילות החיפוש הכי טובות למצוא מתחרים ישירים באותו תחום? (3 ביטויים בעברית)
3. אילו ערים נמצאות ברדיוס של ${radiusKm} ק"מ מ-${city} בישראל? (עד 5 ערים)

החזר JSON: {
  "business_type": "...",
  "search_terms": ["...", "...", "..."],
  "nearby_cities": ["...", "..."]
}`,
      response_json_schema: { type: 'object' },
    });

    const businessType: string = contextResult?.business_type || category;
    const searchTerms: string[] = contextResult?.search_terms || [name, category];
    const nearbyCities: string[] = contextResult?.nearby_cities || [];

    // Combine: city + LLM-suggested nearby cities + user's additional cities, deduplicated
    const allAreas = [...new Set([city, ...nearbyCities, ...userExtraCities])];

    console.log(`runCompetitorIdentification: type="${businessType}", areas=${JSON.stringify(allAreas)}, terms=${JSON.stringify(searchTerms)}`);

    // ── Step 2: Google Places — radius-based search for precision ─────────────
    // Geocode the primary city to get coordinates, then use nearbysearch with
    // the exact radius so we don't pull in businesses 60km away.
    const cityCoords = await geocodeCity(city);
    const radiusM = radiusKm * 1000;

    const googleSearchPromises = cityCoords
      ? searchTerms.map(term => googleNearbySearch(term, cityCoords.lat, cityCoords.lng, radiusM))
      : [googlePlacesSearch(searchTerms[0] || businessType, city)];

    // Also search user-requested additional cities by text (they're explicit requests)
    const extraCitySearchPromises = userExtraCities.flatMap(area =>
      searchTerms.map(term => tavilySearch(`${term} ${area} ישראל ${CURRENT_YEAR}`, 5))
    );

    // Tavily for the primary area (use city name for natural-language queries)
    const tavilyQueries: string[] = [];
    for (const term of searchTerms) {
      tavilyQueries.push(`${term} ${city} ישראל ${CURRENT_YEAR}`);
    }
    tavilyQueries.push(`site:rest.co.il ${searchTerms[0] || businessType} ${city}`);

    const [googleResultSets, tavilyResultSets, extraResults] = await Promise.all([
      Promise.all(googleSearchPromises),
      Promise.all(tavilyQueries.map(q => tavilySearch(q, 5))),
      Promise.all(extraCitySearchPromises),
    ]);

    const googleResults = googleResultSets.flat();
    const tavilyResults = [...tavilyResultSets.flat(), ...extraResults];

    console.log(`runCompetitorIdentification: ${googleResults.length} Google, ${tavilyResults.length} Tavily results`);

    // ── Step 3: LLM identifies DIRECT competitors only ───────────────────────
    const existingCompetitors = await prisma.competitor.findMany({ where: { linked_business: businessProfileId } });
    const existingNames = new Set(existingCompetitors.map(c => c.name.toLowerCase()));

    const googleBlock = googleResults.length > 0
      ? `Google Places:\n${googleResults.map((p: any) =>
          `- ${p.name}: ${p.rating || '?'}★ (${p.user_ratings_total || 0} ביקורות) — ${p.formatted_address || city}`
        ).join('\n')}`
      : '';

    const tavilyBlock = tavilyResults.length > 0
      ? `תוצאות חיפוש:\n${tavilyResults.map((r: any) =>
          `- ${r.title}: ${(r.content || '').substring(0, 150)}`
        ).join('\n')}`
      : '';

    const contextBlock = [googleBlock, tavilyBlock].filter(Boolean).join('\n\n');
    const areasDesc = allAreas.join(', ');

    const llmPrompt = contextBlock
      ? `אתה מנתח תחרותי. זהה מתחרים ישירים לעסק "${name}" (${businessType}).

כללים:
1. מתחרה ישיר = אותו סוג עסק בדיוק. לסושי בר — רק מסעדות סושי/יפניות, לא פיצריות.
2. גיאוגרפיה: כלול רק עסקים שנמצאים עד ${radiusKm} ק"מ מ-${city} (ערים מאושרות: ${areasDesc}). אל תכלול ערים רחוקות יותר.
3. אל תכלול את "${name}" עצמו.
4. אם הנתונים חלקיים, השלם מהידע שלך — אך שמור על הגבלת הרדיוס.

${contextBlock}

עבור כל מתחרה:
- name, rating, review_count, address (חובה לכלול עיר), strengths, weaknesses, price_range, source_urls

החזר JSON: {"competitors": [...]}`
      : `אתה מנתח תחרותי. רשום עד 6 מתחרים ישירים ל-"${name}" (${businessType}).
גיאוגרפיה: רק ערים עד ${radiusKm} ק"מ מ-${city} (${areasDesc}).
מתחרה ישיר = אותו סוג עסק בדיוק. השתמש בשמות אמיתיים.

עבור כל מתחרה: name, rating, review_count, address (כולל עיר), strengths, weaknesses, price_range, source_urls.
החזר JSON: {"competitors": [...]}`;

    const result = await invokeLLM({
      model: 'sonnet',
      prompt: llmPrompt,
      response_json_schema: { type: 'object' },
      maxTokens: 2000,
    });

    console.log(`runCompetitorIdentification LLM: ${JSON.stringify(result).substring(0, 600)}`);
    let competitors: any[] = result?.competitors || [];

    // Hard distance filter on incoming results
    if (cityCoords && competitors.length > 0) {
      const checked = await Promise.all(
        competitors.slice(0, 10).map(async (c) => {
          const addr = c.address || '';
          const coords = await geocodeCity(addr || c.name);
          if (!coords) return c; // can't verify — keep it
          const dist = haversineKm(cityCoords.lat, cityCoords.lng, coords.lat, coords.lng);
          // Allow: within radius, OR in user's explicit extra cities
          const inExtraCity = userExtraCities.some(ec => addr.toLowerCase().includes(ec.toLowerCase()));
          if (dist <= radiusKm + 3 || inExtraCity) return c;
          console.log(`runCompetitorIdentification: dropping new "${c.name}" — ${Math.round(dist)}km away`);
          return null;
        })
      );
      competitors = checked.filter(Boolean) as any[];
    }
    let created = 0;
    let updated = 0;

    for (const c of competitors) {
      if (!c.name || c.name.toLowerCase() === name.toLowerCase()) continue;
      const nameKey = c.name.toLowerCase();
      const sourceUrls = (c.source_urls || []).filter((u: string) => u?.startsWith('http')).join(' | ');

      if (existingNames.has(nameKey)) {
        const existing = existingCompetitors.find(e => e.name.toLowerCase() === nameKey);
        if (existing) {
          await prisma.competitor.update({
            where: { id: existing.id },
            data: {
              rating: c.rating || existing.rating,
              review_count: c.review_count || existing.review_count,
              strengths: c.strengths || existing.strengths,
              weaknesses: c.weaknesses || existing.weaknesses,
              price_range: c.price_range || existing.price_range,
              source_urls: sourceUrls || existing.source_urls,
              last_scanned: new Date().toISOString(),
              data_freshness: 'fresh',
            },
          });
          updated++;
        }
      } else {
        await prisma.competitor.create({
          data: {
            name: c.name,
            category: businessType,
            rating: c.rating || null,
            review_count: c.review_count || null,
            address: c.address || city,
            strengths: c.strengths || '',
            weaknesses: c.weaknesses || '',
            price_range: c.price_range || '',
            source_urls: sourceUrls,
            last_scanned: new Date().toISOString(),
            data_freshness: 'fresh',
            verification_status: 'מאומתת',
            linked_business: businessProfileId,
          },
        });
        existingNames.add(nameKey);
        created++;
      }
    }

    // ── Cleanup: remove existing competitors now outside the radius ───────────
    // Uses actual Geocoding distance (not city-name matching) so radius changes
    // take effect immediately on rescan.
    const allCompetitors = await prisma.competitor.findMany({ where: { linked_business: businessProfileId } });
    const idsToDelete: string[] = [];

    for (const comp of allCompetitors) {
      const addr = (comp.address || '').toLowerCase();

      // Always keep competitors in the primary city or user's explicit extra cities
      const keepAreas = [city, ...userExtraCities];
      if (keepAreas.some(a => addr.includes(a.toLowerCase()))) continue;

      if (cityCoords) {
        // Geocode the competitor and measure actual distance
        const coords = await geocodeCity(comp.address || comp.name);
        if (!coords) continue; // can't verify — keep it
        const dist = haversineKm(cityCoords.lat, cityCoords.lng, coords.lat, coords.lng);
        if (dist > radiusKm + 3) {
          console.log(`Cleanup: removing "${comp.name}" — ${Math.round(dist)}km > ${radiusKm}km radius`);
          idsToDelete.push(comp.id);
        }
      } else {
        // No geocoding available — fall back to city name matching
        if (!allAreas.some(area => addr.includes(area.toLowerCase()))) {
          idsToDelete.push(comp.id);
        }
      }
    }

    if (idsToDelete.length > 0) {
      await prisma.competitor.deleteMany({ where: { id: { in: idsToDelete } } });
      console.log(`Cleanup: removed ${idsToDelete.length} out-of-scope competitors`);
    }

    await writeAutomationLog('runCompetitorIdentification', businessProfileId, startTime, created + updated);
    console.log(`runCompetitorIdentification done: ${created} created, ${updated} updated, areas: ${areasDesc}`);
    return res.json({
      competitors_found: competitors.length,
      new_competitors_created: created,
      existing_competitors_updated: updated,
      out_of_scope_removed: toDelete.length,
      business_type: businessType,
      areas_scanned: allAreas,
    });
  } catch (err: any) {
    console.error('runCompetitorIdentification error:', err.message);
    await writeAutomationLog('runCompetitorIdentification', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
