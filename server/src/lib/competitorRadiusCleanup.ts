import { prisma } from '../db';

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!GOOGLE_API_KEY) return null;
  try {
    const input = encodeURIComponent(`${address} ישראל`);
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${input}&language=iw&region=il&key=${GOOGLE_API_KEY}`);
    const data: any = await res.json();
    const loc = data.results?.[0]?.geometry?.location;
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  } catch { return null; }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Delete competitors for a business that are beyond the current search radius.
 * Called automatically whenever search_radius_km or additional_cities changes.
 * Runs async — does not block the HTTP response.
 */
export async function cleanupCompetitorsByRadius(businessProfileId: string): Promise<void> {
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return;

    const { city } = profile;
    const radiusKm: number = (profile as any).search_radius_km || 15;
    const userExtraCities: string[] = ((profile as any).additional_cities || '')
      .split(',').map((c: string) => c.trim()).filter(Boolean);

    const cityCoords = await geocodeAddress(city);
    if (!cityCoords) {
      console.log(`competitorRadiusCleanup: could not geocode "${city}", skipping`);
      return;
    }

    const competitors = await prisma.competitor.findMany({ where: { linked_business: businessProfileId } });
    const idsToDelete: string[] = [];

    for (const comp of competitors) {
      const addr = (comp.address || '').toLowerCase();

      // Always keep competitors explicitly in the primary city or user's extra cities
      const keepAreas = [city, ...userExtraCities];
      if (keepAreas.some(a => addr.includes(a.toLowerCase()))) continue;

      const coords = await geocodeAddress(comp.address || comp.name);
      if (!coords) continue; // can't verify — keep

      const dist = haversineKm(cityCoords.lat, cityCoords.lng, coords.lat, coords.lng);
      if (dist > radiusKm + 3) {
        console.log(`competitorRadiusCleanup: removing "${comp.name}" — ${Math.round(dist)}km > ${radiusKm}km`);
        idsToDelete.push(comp.id);
      }
    }

    if (idsToDelete.length > 0) {
      await prisma.competitor.deleteMany({ where: { id: { in: idsToDelete } } });
      console.log(`competitorRadiusCleanup: removed ${idsToDelete.length} competitor(s) for business ${businessProfileId}`);
    }
  } catch (e: any) {
    console.warn('competitorRadiusCleanup error:', e.message);
  }
}
