/**
 * Eventbrite API client — fetches real structured event data for a city/query.
 *
 * Uses the Eventbrite v3 REST API (token auth).
 * Returns structured EventbriteEvent objects ready for the findLocalEvents agent.
 *
 * Docs: https://www.eventbrite.com/platform/api#/reference/event/search/
 */

const EVENTBRITE_TOKEN = process.env.EVENTBRITE_API_KEY || '';

export interface EventbriteEvent {
  id: string;
  name: string;
  description: string;
  start_utc: string;       // ISO date string
  end_utc: string;
  url: string;
  venue_name: string | null;
  venue_address: string | null;
  category: string | null;
  is_free: boolean;
  capacity: number | null;
}

export function hasEventbriteKey(): boolean { return !!EVENTBRITE_TOKEN; }

/**
 * Search Eventbrite for events near a city within the next N days.
 * @param city       City name in Hebrew or English — used as location.address
 * @param keywords   Search query, e.g. "מסעדה" or "music festival"
 * @param daysAhead  How many days forward to search (default 60)
 * @param maxResults Maximum events to return (default 20)
 */
export async function searchEventbriteEvents(
  city: string,
  keywords: string,
  daysAhead = 60,
  maxResults = 20,
): Promise<EventbriteEvent[]> {
  if (!EVENTBRITE_TOKEN) return [];

  const startDate = new Date();
  const endDate   = new Date(Date.now() + daysAhead * 86_400_000);

  const toISO = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const params = new URLSearchParams({
    'q':                         keywords,
    'location.address':          `${city}, Israel`,
    'location.within':           '30km',
    'start_date.range_start':    toISO(startDate),
    'start_date.range_end':      toISO(endDate),
    'sort_by':                   'date',
    'expand':                    'venue,category',
    'page_size':                 String(Math.min(maxResults, 50)),
  });

  try {
    const res = await fetch(
      `https://www.eventbriteapi.com/v3/events/search/?${params}`,
      {
        headers: { Authorization: `Bearer ${EVENTBRITE_TOKEN}` },
        signal: AbortSignal.timeout(12_000),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[Eventbrite] HTTP ${res.status}: ${body.slice(0, 200)}`);
      return [];
    }

    const data: any = await res.json();
    const events: any[] = data.events || [];

    return events.slice(0, maxResults).map((ev: any): EventbriteEvent => ({
      id:            ev.id || '',
      name:          ev.name?.text || ev.name?.html?.replace(/<[^>]+>/g, '') || '',
      description:   (ev.description?.text || ev.description?.html?.replace(/<[^>]+>/g, '') || '').slice(0, 300),
      start_utc:     ev.start?.utc || '',
      end_utc:       ev.end?.utc   || '',
      url:           ev.url        || '',
      venue_name:    ev.venue?.name                                || null,
      venue_address: ev.venue?.address?.localized_address_display || null,
      category:      ev.category?.name                            || null,
      is_free:       ev.is_free    ?? false,
      capacity:      ev.capacity   ?? null,
    }));

  } catch (e: any) {
    console.warn('[Eventbrite] fetch error:', e.message);
    return [];
  }
}
