// Google Places API helper — shared across functions
// Requires GOOGLE_PLACES_API_KEY environment variable

const API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') || '';
const BASE_URL = 'https://maps.googleapis.com/maps/api';

export interface PlaceDetails {
  placeId: string;
  name: string;
  rating?: number;
  reviewCount?: number;
  address?: string;
  phone?: string;
  website?: string;
  reviews?: Array<{
    author_name: string;
    rating: number;
    text: string;
    time: number;
    relative_time_description: string;
  }>;
}

export interface NearbyPlace {
  placeId: string;
  name: string;
  rating?: number;
  reviewCount?: number;
  address?: string;
  types?: string[];
}

/** Find the Google Place ID for a business by name and city */
export async function findPlaceId(businessName: string, city: string): Promise<string | null> {
  if (!API_KEY) return null;
  try {
    const input = encodeURIComponent(`${businessName} ${city}`);
    const url = `${BASE_URL}/place/findplacefromtext/json?input=${input}&inputtype=textquery&fields=place_id,name&key=${API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === 'OK' && data.candidates?.length > 0) {
      return data.candidates[0].place_id;
    }
    return null;
  } catch (err) {
    console.error('findPlaceId error:', err.message);
    return null;
  }
}

/** Get full place details including reviews */
export async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  if (!API_KEY || !placeId) return null;
  try {
    const fields = 'place_id,name,rating,user_ratings_total,formatted_address,formatted_phone_number,website,reviews';
    const url = `${BASE_URL}/place/details/json?place_id=${placeId}&fields=${fields}&language=iw&key=${API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === 'OK' && data.result) {
      const r = data.result;
      return {
        placeId,
        name: r.name,
        rating: r.rating,
        reviewCount: r.user_ratings_total,
        address: r.formatted_address,
        phone: r.formatted_phone_number,
        website: r.website,
        reviews: r.reviews || [],
      };
    }
    return null;
  } catch (err) {
    console.error('getPlaceDetails error:', err.message);
    return null;
  }
}

/** Search for nearby businesses (competitors) by category and city */
export async function searchNearbyCompetitors(
  category: string,
  city: string,
  excludeName: string,
  maxResults = 10
): Promise<NearbyPlace[]> {
  if (!API_KEY) return [];
  try {
    // First geocode the city to get lat/lng
    const geocodeUrl = `${BASE_URL}/geocode/json?address=${encodeURIComponent(city + ' ישראל')}&key=${API_KEY}`;
    const geoRes = await fetch(geocodeUrl);
    const geoData = await geoRes.json();
    if (geoData.status !== 'OK' || !geoData.results?.[0]) return [];
    const { lat, lng } = geoData.results[0].geometry.location;

    // Search nearby
    const keyword = encodeURIComponent(category);
    const nearbyUrl = `${BASE_URL}/place/nearbysearch/json?location=${lat},${lng}&radius=3000&keyword=${keyword}&language=iw&key=${API_KEY}`;
    const nearbyRes = await fetch(nearbyUrl);
    const nearbyData = await nearbyRes.json();
    if (nearbyData.status !== 'OK') return [];

    return (nearbyData.results || [])
      .filter((p: any) => p.name && !p.name.includes(excludeName) && !excludeName.includes(p.name))
      .slice(0, maxResults)
      .map((p: any) => ({
        placeId: p.place_id,
        name: p.name,
        rating: p.rating,
        reviewCount: p.user_ratings_total,
        address: p.vicinity,
        types: p.types,
      }));
  } catch (err) {
    console.error('searchNearbyCompetitors error:', err.message);
    return [];
  }
}
