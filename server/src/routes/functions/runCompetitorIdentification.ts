import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM } from '../../lib/llm';
import { publishEvent } from '../../lib/eventBus';
import { buildCompetitorTerms, buildIdentityCompetitorTerms, buildAgentPromptContext, getSectorProfile } from '../../lib/businessProfile';
import { getAgentMission } from '../../lib/missionPlanner';
import { searchCompetitorsByKeyword, DataForSEOCandidate } from '../../lib/dataforseo';
import { enrichCompetitorUrls } from './enrichCompetitorUrls';
import { getPlaceDetails } from '../../lib/googlePlaces';

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

// ponytail: inline from src/lib/planConfig.js — update both if plan limits change
const PLAN_COMPETITOR_LIMITS: Record<string, number> = {
  free_trial: 3, free: 3, starter: 5, growth: 10, pro: Infinity, enterprise: Infinity,
};


function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

interface MapsCandidate {
  name: string;
  place_id: string;
  rating: number | null;
  review_count: number | null;
  address: string;
  lat: number | null;
  lng: number | null;
  url?: string;
  domain?: string;
  phone?: string;
  discovery_sources: string[];
}

const normName = (s: string) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const sameCity = (addr: string, city: string) => (addr || '').toLowerCase().includes((city || '').toLowerCase());

/** KAN-212 AC3 (§7.1): dedupe DataForSEO + Google Places candidates by place_id when both
 * have it, else fuzzy name + same city. Union rating/address (prefer non-null); prefer
 * DataForSEO lat/lng. */
function mergeMapsCandidates(googlePlaces: any[], dataforseo: DataForSEOCandidate[], city: string): MapsCandidate[] {
  const merged: MapsCandidate[] = googlePlaces.map(p => ({
    name: p.name || '', place_id: p.place_id || '',
    rating: p.rating ?? null, review_count: p.user_ratings_total ?? null,
    address: p.formatted_address || p.vicinity || '',
    lat: p.geometry?.location?.lat ?? null, lng: p.geometry?.location?.lng ?? null,
    discovery_sources: ['google_places'],
  }));

  for (const d of dataforseo) {
    const idx = merged.findIndex(g =>
      (d.place_id && g.place_id && d.place_id === g.place_id) ||
      (sameCity(d.address, city) && sameCity(g.address, city) &&
        normName(d.name) && (normName(d.name) === normName(g.name) || normName(g.name).includes(normName(d.name)) || normName(d.name).includes(normName(g.name))))
    );
    if (idx === -1) {
      merged.push({
        name: d.name, place_id: d.place_id, rating: d.rating, review_count: d.votes_count,
        address: d.address, lat: d.latitude ?? null, lng: d.longitude ?? null,
        url: d.url, domain: d.domain, phone: d.phone,
        discovery_sources: ['dataforseo_maps'],
      });
    } else {
      const g = merged[idx];
      merged[idx] = {
        name: g.name || d.name,
        place_id: g.place_id || d.place_id,
        rating: g.rating ?? d.rating,
        review_count: g.review_count ?? d.votes_count,
        address: g.address || d.address,
        lat: d.latitude ?? g.lat, // prefer DataForSEO lat/lng
        lng: d.longitude ?? g.lng,
        url: d.url ?? g.url,
        domain: d.domain ?? g.domain,
        phone: d.phone ?? g.phone,
        discovery_sources: [...new Set([...g.discovery_sources, 'dataforseo_maps'])],
      };
    }
  }
  return merged;
}

export async function runCompetitorIdentification(req: Request, res: Response) {
  const { businessProfileId, force } = req.body;
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

    if (!GOOGLE_API_KEY) console.warn('runCompetitorIdentification: GOOGLE_PLACES_API_KEY missing — Google Places + geocoding skipped');

    const sp = getSectorProfile(profile);
    const profileCtx = buildAgentPromptContext(profile);
    const competitorMission = getAgentMission<{ search_terms_he?: string[]; competitor_profile_he?: string }>(profile, 'runCompetitorIdentification');
    // KAN-211 AC1/AC3: approved identity terms are most precise; fall back to mission terms,
    // then sector-profile terms.
    const identityTerms = buildIdentityCompetitorTerms(profile);
    const prebuiltTerms = identityTerms.length
      ? identityTerms
      : competitorMission?.search_terms_he?.length
        ? competitorMission.search_terms_he
        : buildCompetitorTerms(profile);

    // ── Step 1: Understand the business type + get nearby cities ──────────────
    // If we have an AI sector profile, provide it so the LLM generates precise competitor terms
    const contextResult = await invokeLLM({
      model: 'haiku',
      maxTokens: 300,
      prompt: `${profileCtx}

1. What is the exact type of business? (e.g. "UI/UX design studio for SaaS", "Japanese sushi bar", "men's barber")
2. What are the best 3-4 Hebrew search terms to find DIRECT competitors in the same specific field? Be precise — a pilates studio's competitors are other pilates studios, not generic gyms.
3. Which cities are within a radius of ${radiusKm} km from ${city} in Israel? (up to 5 cities)

Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "business_type": "...",
  "search_terms": ["...", "...", "..."],
  "nearby_cities": ["...", "..."]
}`,
      response_json_schema: { type: 'object' },
    });

    const businessType: string = contextResult?.business_type || sp?.sector_label_he || category;
    // KAN-211 AC5: the Haiku call above always runs (also gives us business_type + nearby_cities),
    // but its invented search_terms are only used to fill in when identity/sector already gave <2.
    // ponytail: one shared call rather than a second dedicated refine call — same LLM round-trip
    // already yields business_type/nearby_cities we need regardless.
    const searchTerms: string[] = [
      ...(prebuiltTerms.length < 2 ? (contextResult?.search_terms || []) : []),
      ...prebuiltTerms,
    ].filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 6);
    const nearbyCities: string[] = contextResult?.nearby_cities || [];

    // Combine: city + LLM-suggested nearby cities + user's additional cities, deduplicated
    const allAreas = [...new Set([city, ...nearbyCities, ...userExtraCities])];

    console.log(`runCompetitorIdentification: type="${businessType}", areas=${JSON.stringify(allAreas)}, terms=${JSON.stringify(searchTerms)}`);

    // KAN-211 AC4: no terms at all → soft-fail, don't burn paid Maps/SerpAPI/Tavily calls.
    if (searchTerms.length === 0) {
      console.warn(`runCompetitorIdentification: no search terms available for ${businessProfileId} — skipping paid search calls`);
      await writeAutomationLog('runCompetitorIdentification', businessProfileId, startTime, 0, 'success', 'no search terms available — skipped');
      return res.json({
        competitors_found: 0, new_competitors_created: 0, existing_competitors_updated: 0,
        out_of_scope_removed: 0, business_type: businessType, areas_scanned: allAreas, skipped: 'no_search_terms',
      });
    }

    // ── Step 2: Google Places — radius-based search for precision ─────────────
    // Geocode the primary city to get coordinates, then use nearbysearch with
    // the exact radius so we don't pull in businesses 60km away.
    const cityCoords = await geocodeCity(city);
    const radiusM = radiusKm * 1000;

    const googleSearchPromises = cityCoords
      ? searchTerms.map(term => googleNearbySearch(term, cityCoords.lat, cityCoords.lng, radiusM))
      : [googlePlacesSearch(searchTerms[0] || businessType, city)];

    // KAN-212 AC1: DataForSEO Maps runs in parallel with Places (below, same Promise.all).
    // Requires coords (no text-search mode) — skipped when ungeocodable, same as AC2 soft-fail.
    const dataForSeoPromises = cityCoords
      ? searchTerms.map(term => searchCompetitorsByKeyword(term, cityCoords.lat, cityCoords.lng))
      : [];

    const [googleResultSets, dataForSeoResultSets] = await Promise.all([
      Promise.all(googleSearchPromises),
      Promise.all(dataForSeoPromises),
    ]);

    const googleResults     = googleResultSets.flat();
    const dataForSeoResults = dataForSeoResultSets.flatMap(r => r.candidates);
    // KAN-216 AC4: sum per-call DataForSEO cost for this identify run
    const dataForSeoCostUsd = dataForSeoResultSets.reduce((sum, r) => sum + r.costUsd, 0);

    // KAN-212 AC3/AC4: merge + dedupe the two Maps sources, tag provenance
    const mapsCandidates = mergeMapsCandidates(googleResults, dataForSeoResults, city);
    console.log(`runCompetitorIdentification: discovery_sources=${JSON.stringify(mapsCandidates.map(c => ({ name: c.name, discovery_sources: c.discovery_sources })))}`);

    console.log(`runCompetitorIdentification: ${googleResults.length} Google, ${dataForSeoResults.length} DataForSEO, ${mapsCandidates.length} merged Maps candidates`);

    // ── Step 3: LLM identifies DIRECT competitors only ───────────────────────
    const existingCompetitors = await (prisma as any).competitor.findMany({ where: { linked_business: businessProfileId } });
    const existingNames = new Set(existingCompetitors.map((c: any) => c.name.toLowerCase()));
    // Names the user explicitly marked as not-relevant — never re-add these
    const notRelevantNames = new Set(
      existingCompetitors.filter((c: any) => c.not_relevant).map((c: any) => c.name.toLowerCase())
    );

    const googleBlock = mapsCandidates.length > 0
      ? `Google/DataForSEO Maps:\n${mapsCandidates.map(c =>
          `- ${c.name}: ${c.rating ?? '?'}★ (${c.review_count || 0} ביקורות) — ${c.address || city}`
        ).join('\n')}`
      : '';

    const contextBlock = googleBlock;
    const areasDesc = allAreas.join(', ');

    const notRelevantBlock = notRelevantNames.size > 0
      ? `\nDo NOT include these businesses (user explicitly marked as irrelevant): ${[...notRelevantNames].join(', ')}.`
      : '';

    // ponytail: AC7 — no candidates from Maps = empty merge; soft-fail rather than invite invention
    if (!contextBlock) {
      console.warn('runCompetitorIdentification: no discovery candidates — soft-fail (AC7)');
      await writeAutomationLog('runCompetitorIdentification', businessProfileId, startTime, 0, 'success', 'no discovery candidates — soft-fail', dataForSeoCostUsd);
      return res.json({
        competitors_found: 0, new_competitors_created: 0, existing_competitors_updated: 0,
        out_of_scope_removed: 0, business_type: businessType, areas_scanned: allAreas, skipped: 'no_candidates',
      });
    }

    const llmPrompt = `You are a competitive analyst. Identify direct competitors for the business "${name}" (${businessType}).

Rules:
1. A direct competitor = the exact same type of business. For a sushi bar — only sushi/Japanese restaurants, not pizzerias.
2. Geography: include only businesses located within ${radiusKm} km of ${city} (approved cities: ${areasDesc}). Do not include more distant cities.
3. Do not include "${name}" itself.
4. Only select from the candidates listed below — do NOT invent businesses not in the list.${notRelevantBlock}

${contextBlock}

For each competitor:
- name, rating, review_count, address (must include city), strengths, weaknesses, price_range, source_urls

Return ONLY valid JSON. ALL string values must be in Hebrew: {"competitors": [...]}`;

    const result = await invokeLLM({
      model: 'sonnet',
      prompt: llmPrompt,
      response_json_schema: { type: 'object' },
      maxTokens: 2000,
    });

    console.log(`runCompetitorIdentification LLM: ${JSON.stringify(result).substring(0, 600)}`);
    let competitors: any[] = result?.competitors || [];

    // Never re-add businesses the user explicitly marked as not-relevant
    if (notRelevantNames.size > 0) {
      competitors = competitors.filter(c => !notRelevantNames.has((c.name || '').toLowerCase()));
    }

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
    // ── competitors_max plan guard — cap new creates, always allow updates ──
    const planId: string = (profile as any).plan_id || 'free_trial';
    const maxCompetitors = PLAN_COMPETITOR_LIMITS[planId] ?? 3;
    if (maxCompetitors !== Infinity) {
      const activeCount = existingCompetitors.filter((c: any) => !c.not_relevant).length;
      const headroom = Math.max(0, maxCompetitors - activeCount);
      const updates = competitors.filter(c => existingNames.has((c.name || '').toLowerCase()));
      const creates = competitors.filter(c => !existingNames.has((c.name || '').toLowerCase()));
      competitors = [...updates, ...creates.slice(0, headroom)];
      if (creates.length > headroom) {
        console.log(`runCompetitorIdentification: plan ${planId} cap ${maxCompetitors} — dropping ${creates.length - headroom} new competitors`);
      }
    }

    let created = 0;
    let updated = 0;
    const touchedIds: string[] = []; // KAN-219 AC0 — created/updated ids to enrich inline below

    // AC8b (extended): classify a Maps candidate's url/domain into website vs. social —
    // restaurants especially often have only a Facebook/Instagram page, no real site.
    interface DerivedUrls { website: string | null; instagram: string | null; facebook: string | null; tiktok: string | null; }
    const classifyUrl = (url: string | undefined, out: DerivedUrls) => {
      if (!url) return;
      if (/instagram\.com/i.test(url)) { out.instagram ||= url; return; }
      if (/facebook\.com/i.test(url)) { out.facebook ||= url; return; }
      if (/tiktok\.com/i.test(url)) { out.tiktok ||= url; return; }
      if (/google\.com\/maps/i.test(url)) return; // never usable as website or social
      if (/^https?:\/\//i.test(url)) out.website ||= url;
    };
    const deriveUrls = async (m: MapsCandidate): Promise<DerivedUrls> => {
      const out: DerivedUrls = { website: null, instagram: null, facebook: null, tiktok: null };
      classifyUrl(m.url, out);
      if (m.domain) classifyUrl(`https://${m.domain}`, out);
      // Fallback: DataForSEO had no usable website — try Google's own Place Details data.
      if (!out.website && m.place_id) {
        const details = await getPlaceDetails(m.place_id);
        classifyUrl(details.websiteUri, out);
      }
      return out;
    };
    const candidateByName = new Map(mapsCandidates.map(m => [normName(m.name), m]));
    // Exact normalized-name match first; else fuzzy containment + same-city, mirroring
    // mergeMapsCandidates' own tolerance — an LLM-paraphrased name shouldn't lose all
    // provenance data (place_id/url) that the Maps candidate actually has.
    const findMapMatch = (llmName: string, llmAddress: string): MapsCandidate | undefined => {
      const key = normName(llmName);
      if (!key) return undefined;
      const exact = candidateByName.get(key);
      if (exact) return exact;
      return mapsCandidates.find(m => {
        const mKey = normName(m.name);
        return !!mKey && (mKey.includes(key) || key.includes(mKey)) &&
          sameCity(llmAddress || '', city) === sameCity(m.address || '', city);
      });
    };

    // LLM may return rating as "4.5★" or "4.5" — Prisma expects Float
    const parseRating = (r: any): number | null => {
      if (r == null) return null;
      const n = parseFloat(String(r).replace(/[^0-9.]/g, ''));
      return isNaN(n) ? null : n;
    };

    for (const c of competitors) {
      if (!c.name || c.name.toLowerCase() === name.toLowerCase()) continue;
      const nameKey = c.name.toLowerCase();
      const sourceUrls = (c.source_urls || []).filter((u: string) => u?.startsWith('http')).join(' | ');
      // LLM may return arrays for these fields — Prisma expects strings
      const strengths = Array.isArray(c.strengths) ? c.strengths.join(', ') : (c.strengths || '');
      const weaknesses = Array.isArray(c.weaknesses) ? c.weaknesses.join(', ') : (c.weaknesses || '');

      const mapMatch = findMapMatch(c.name, c.address);
      const urls: DerivedUrls = mapMatch
        ? await deriveUrls(mapMatch)
        : { website: null, instagram: null, facebook: null, tiktok: null };

      if (existingNames.has(nameKey)) {
        const existing = existingCompetitors.find(e => e.name.toLowerCase() === nameKey);
        if (existing) {
          await prisma.competitor.update({
            where: { id: existing.id },
            data: {
              rating: parseRating(c.rating) ?? existing.rating,
              review_count: c.review_count || existing.review_count,
              strengths: strengths || existing.strengths,
              weaknesses: weaknesses || existing.weaknesses,
              price_range: c.price_range || existing.price_range,
              source_urls: sourceUrls || existing.source_urls,
              last_scanned: new Date().toISOString(),
              data_freshness: 'fresh',
              // AC8b: fill only if currently empty — never overwrite owner/Tavily/user data
              ...(urls.website && !(existing as any).website_url ? { website_url: urls.website } : {}),
              ...(urls.instagram && !(existing as any).instagram_url ? { instagram_url: urls.instagram } : {}),
              ...(urls.facebook && !(existing as any).facebook_url ? { facebook_url: urls.facebook } : {}),
              ...(urls.tiktok && !(existing as any).tiktok_url ? { tiktok_url: urls.tiktok } : {}),
              // KAN-216 AC3: re-tag provenance on every scan that still sees this row
              ...(mapMatch ? { discovery_sources: JSON.stringify(mapMatch.discovery_sources) } : {}),
            },
          });
          updated++;
          touchedIds.push(existing.id);
        }
      } else {
        const createdRow = await prisma.competitor.create({
          data: {
            name: c.name,
            category: businessType,
            rating: parseRating(c.rating),
            review_count: c.review_count || null,
            address: c.address || city,
            strengths: strengths,
            weaknesses: weaknesses,
            price_range: c.price_range || '',
            source_urls: sourceUrls,
            last_scanned: new Date().toISOString(),
            data_freshness: 'fresh',
            verification_status: 'מאומתת',
            linked_business: businessProfileId,
            website_url: urls.website || undefined,
            instagram_url: urls.instagram || undefined,
            facebook_url: urls.facebook || undefined,
            tiktok_url: urls.tiktok || undefined,
            google_place_id: mapMatch?.place_id || undefined,
            // KAN-216 AC3: which API(s) surfaced this row
            discovery_sources: mapMatch ? JSON.stringify(mapMatch.discovery_sources) : undefined,
          },
        });
        existingNames.add(nameKey);
        created++;
        if (createdRow?.id) touchedIds.push(createdRow.id);
      }
    }

    // KAN-219 AC0 — enrich the same batch inline, in this run, not on the next scheduler tick.
    if (touchedIds.length) {
      try {
        const enrichResult = await enrichCompetitorUrls(touchedIds, { force });
        console.log(`runCompetitorIdentification: enrichCompetitorUrls → ${enrichResult.enriched} enriched, ${enrichResult.skipped} skipped`);
      } catch (e: any) {
        console.warn('runCompetitorIdentification: enrichCompetitorUrls failed:', e.message);
        // KAN-224 AC5 — this used to fail silently to console only; now it surfaces in monitoring.
        await writeAutomationLog('enrichCompetitorUrls', businessProfileId, startTime, 0, 'failed', e.message);
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

    await writeAutomationLog('runCompetitorIdentification', businessProfileId, startTime, created + updated, 'success', undefined, dataForSeoCostUsd);
    console.log(`runCompetitorIdentification done: ${created} created, ${updated} updated, areas: ${areasDesc}`);
    // Publish to event bus (OTX-001)
    if (created > 0 || updated > 0) {
      publishEvent({
        businessId: businessProfileId,
        eventType:  'competitor_change',
        source:     'runCompetitorIdentification',
        payload:    { new_competitors: created, updated_competitors: updated },
        contextAttrs: { impact: created > 0 ? 'high' : 'medium' },
      }).catch(() => {});
    }
    return res.json({
      competitors_found: competitors.length,
      new_competitors_created: created,
      existing_competitors_updated: updated,
      out_of_scope_removed: idsToDelete.length,
      business_type: businessType,
      areas_scanned: allAreas,
    });
  } catch (err: any) {
    console.error('runCompetitorIdentification error:', err.message);
    await writeAutomationLog('runCompetitorIdentification', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
