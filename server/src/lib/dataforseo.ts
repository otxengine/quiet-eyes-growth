const LOGIN    = process.env.DATAFORSEO_LOGIN    || '';
const PASSWORD = process.env.DATAFORSEO_PASSWORD || '';

const BASE_URL = 'https://api.dataforseo.com/v3/serp/google/maps/live/advanced';

export interface DataForSEOCandidate {
  name:                  string;
  place_id:              string;
  address:               string;
  address_info:          any;
  latitude:              number;
  longitude:             number;
  rating:                number | null;
  votes_count:           number | null;
  category:              string;
  additional_categories: string[];
  phone?:                string;
  price_level?:          string;
  url?:                  string;
  domain?:               string;
}

export interface DataForSEOSearchResult {
  candidates: DataForSEOCandidate[];
  costUsd:    number;
}

export async function searchCompetitorsByKeyword(
  keyword: string,
  lat: number,
  lng: number,
  zoom  = 14,
  depth = 20,
): Promise<DataForSEOSearchResult> {
  if (!LOGIN || !PASSWORD) {
    console.warn('[dataforseo] Missing DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD — skipping');
    return { candidates: [], costUsd: 0 };
  }

  const auth = Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');

  let res: Response;
  try {
    res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        keyword,
        location_coordinate: `${lat},${lng},${zoom}`,
        language_code:       'iw',
        search_this_area:    true,
        depth,
      }]),
    });
  } catch (e: any) {
    console.warn('[dataforseo] Network error:', e.message);
    return { candidates: [], costUsd: 0 };
  }

  if (!res.ok) {
    console.warn(`[dataforseo] HTTP ${res.status} for keyword="${keyword}"`);
    return { candidates: [], costUsd: 0 };
  }

  let body: any;
  try { body = await res.json(); } catch {
    console.warn('[dataforseo] Failed to parse response JSON');
    return { candidates: [], costUsd: 0 };
  }

  const items: any[] =
    body?.tasks?.[0]?.result?.[0]?.items ?? [];
  // KAN-216 AC4: DataForSEO returns per-task cost (USD) alongside results.
  const costUsd = Number(body?.tasks?.[0]?.cost ?? body?.cost) || 0;

  const candidates = items
    .filter((item: any) => item.type === 'maps_search')
    .map((item: any): DataForSEOCandidate => ({
      name:                  item.title         ?? '',
      place_id:              item.place_id       ?? '',
      address:               item.address        ?? '',
      address_info:          item.address_info   ?? {},
      latitude:              item.latitude       ?? 0,
      longitude:             item.longitude      ?? 0,
      rating:                item.rating?.value      ?? null,
      votes_count:           item.rating?.votes_count ?? null,
      category:              item.category       ?? '',
      additional_categories: item.additional_categories ?? [],
      ...(item.phone       ? { phone:       item.phone       } : {}),
      ...(item.price_level ? { price_level: item.price_level } : {}),
      ...(item.url         ? { url:         item.url         } : {}),
      ...(item.domain      ? { domain:      item.domain      } : {}),
    }));

  return { candidates, costUsd };
}
