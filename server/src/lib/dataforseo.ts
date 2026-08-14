const LOGIN    = process.env.DATAFORSEO_LOGIN    || '';
const PASSWORD = process.env.DATAFORSEO_PASSWORD || '';

export function hasDataForSeoCreds(): boolean { return !!LOGIN && !!PASSWORD; }

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

const ORGANIC_URL = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';

/** KAN-220: organic Google SERP — used as the primary source for URL fallback discovery. */
export async function searchOrganic(keyword: string): Promise<{ urls: string[]; costUsd: number }> {
  if (!LOGIN || !PASSWORD) return { urls: [], costUsd: 0 };

  const auth = Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');
  let res: Response;
  try {
    res = await fetch(ORGANIC_URL, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ keyword, language_code: 'iw', location_name: 'Israel' }]),
    });
  } catch (e: any) {
    console.warn('[dataforseo] organic network error:', e.message);
    return { urls: [], costUsd: 0 };
  }
  if (!res.ok) return { urls: [], costUsd: 0 };

  let body: any;
  try { body = await res.json(); } catch { return { urls: [], costUsd: 0 }; }

  const items: any[] = body?.tasks?.[0]?.result?.[0]?.items ?? [];
  const costUsd = Number(body?.tasks?.[0]?.cost ?? body?.cost) || 0;
  const urls = items.filter((i: any) => i.type === 'organic' && i.url).map((i: any) => i.url);
  return { urls, costUsd };
}

// ── Business Data API: Google Reviews (task-based — no live/sync variant exists) ──

const REVIEWS_TASK_POST_URL = 'https://api.dataforseo.com/v3/business_data/google/reviews/task_post';
const REVIEWS_TASK_GET_URL  = 'https://api.dataforseo.com/v3/business_data/google/reviews/task_get/advanced';

export interface SubmitGoogleReviewsTaskParams {
  placeId?:       string;
  cid?:           string;
  keyword?:       string;
  locationName?:  string;
  languageName?:  string;
  depth?:         number;  // reviews to parse — default 100, DataForSEO max 4490
  sortBy?:        'newest' | 'highest_rating' | 'lowest_rating' | 'relevant';
  postbackUrl:    string;
  tag:            string;
}

/**
 * Submits an async task to fetch Google Reviews for a business.
 * Results arrive later via postback_url — this only returns the task id.
 */
export async function submitGoogleReviewsTask(
  params: SubmitGoogleReviewsTaskParams,
): Promise<{ taskId: string | null; costUsd: number }> {
  if (!LOGIN || !PASSWORD) {
    console.warn('[dataforseo] Missing DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD — skipping reviews task_post');
    return { taskId: null, costUsd: 0 };
  }
  const { placeId, cid, keyword, locationName, languageName, depth, sortBy, postbackUrl, tag } = params;
  const auth = Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');

  let res: Response;
  try {
    res = await fetch(REVIEWS_TASK_POST_URL, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        ...(placeId  ? { place_id: placeId } : {}),
        ...(cid      ? { cid } : {}),
        ...(keyword  ? { keyword } : {}),
        location_name: locationName ?? 'Israel',
        language_name: languageName ?? 'Hebrew',
        depth:          depth ?? 100,
        sort_by:        sortBy ?? 'newest',
        postback_url:   postbackUrl,
        postback_data:  'advanced', // full result body posted to postback_url — no task_get round trip needed
        tag,
      }]),
    });
  } catch (e: any) {
    console.warn('[dataforseo] reviews task_post network error:', e.message);
    return { taskId: null, costUsd: 0 };
  }

  if (!res.ok) {
    console.warn(`[dataforseo] reviews task_post HTTP ${res.status}`);
    return { taskId: null, costUsd: 0 };
  }

  let body: any;
  try { body = await res.json(); } catch {
    console.warn('[dataforseo] reviews task_post: failed to parse response JSON');
    return { taskId: null, costUsd: 0 };
  }

  const task = body?.tasks?.[0];
  const costUsd = Number(task?.cost) || 0;
  if (!task || task.status_code !== 20100) {
    console.warn(`[dataforseo] reviews task_post status_code=${task?.status_code} message=${task?.status_message}`);
    return { taskId: null, costUsd };
  }

  return { taskId: task.id ?? null, costUsd };
}

/**
 * Fallback reconciliation fetch — pulls a task's result directly instead of waiting
 * on the postback. Used only by the reconciliation sweep, not the primary flow.
 */
export async function getGoogleReviewsTaskResult(
  taskId: string,
): Promise<{ items: any[]; costUsd: number; statusCode: number | null }> {
  if (!LOGIN || !PASSWORD || !taskId) return { items: [], costUsd: 0, statusCode: null };
  const auth = Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');

  let res: Response;
  try {
    res = await fetch(`${REVIEWS_TASK_GET_URL}/${taskId}`, {
      headers: { 'Authorization': `Basic ${auth}` },
    });
  } catch (e: any) {
    console.warn('[dataforseo] reviews task_get network error:', e.message);
    return { items: [], costUsd: 0, statusCode: null };
  }
  if (!res.ok) return { items: [], costUsd: 0, statusCode: res.status };

  let body: any;
  try { body = await res.json(); } catch {
    return { items: [], costUsd: 0, statusCode: null };
  }

  const task = body?.tasks?.[0];
  // DataForSEO can chunk a large `depth` request across multiple result[] entries —
  // concatenate all of them rather than only reading result[0] (KAN follow-up: only-10-reviews bug).
  const items: any[] = (task?.result ?? []).flatMap((r: any) => r?.items ?? []);
  const costUsd = Number(task?.cost) || 0;
  return { items, costUsd, statusCode: task?.status_code ?? null };
}
