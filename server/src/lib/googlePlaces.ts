/**
 * Shared Google Places API (New) client.
 * Uses places:searchText and places/{id} — not the legacy /maps/api/place endpoints.
 */

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

export interface PlaceDetails {
  reviews: any[];
  editorialSummary: string;
  types: string[];
  priceLevel: number | null;
  servesWine: boolean;
  servesBeer: boolean;
  servesVegetarianFood: boolean;
  websiteUri: string;
}

export const EMPTY_PLACE: PlaceDetails = {
  reviews: [], editorialSummary: '', types: [], priceLevel: null,
  servesWine: false, servesBeer: false, servesVegetarianFood: false, websiteUri: '',
};

export async function findPlaceId(name: string, city: string): Promise<string | null> {
  if (!GOOGLE_API_KEY) { console.warn('[googlePlaces] No GOOGLE_PLACES_API_KEY'); return null; }
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-Goog-Api-Key':   GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName',
      },
      body: JSON.stringify({ textQuery: `${name} ${city}`, languageCode: 'iw' }),
    });
    const data: any = await res.json();
    const placeId = data.places?.[0]?.id || null;
    console.log(`[googlePlaces] findPlaceId placeId=${placeId} count=${data.places?.length ?? 0}`);
    return placeId;
  } catch (e: any) { console.warn('[googlePlaces] findPlaceId error:', e.message); return null; }
}

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  if (!GOOGLE_API_KEY) return EMPTY_PLACE;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        'Content-Type':     'application/json',
        'X-Goog-Api-Key':   GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,reviews,editorialSummary,types,priceLevel,servesWine,servesBeer,servesVegetarianFood,websiteUri',
      },
    });
    const data: any = await res.json();
    console.log(`[googlePlaces] getPlaceDetails reviews=${data.reviews?.length ?? 0} types=${(data.types || []).join(',')}`);
    return {
      reviews:              data.reviews              || [],
      editorialSummary:     data.editorialSummary?.text || '',
      types:                data.types                || [],
      priceLevel:           data.priceLevel           ?? null,
      servesWine:           data.servesWine           || false,
      servesBeer:           data.servesBeer           || false,
      servesVegetarianFood: data.servesVegetarianFood || false,
      websiteUri:           data.websiteUri           || '',
    };
  } catch (e: any) { console.warn('[googlePlaces] getPlaceDetails error:', e.message); return EMPTY_PLACE; }
}
