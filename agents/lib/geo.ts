// Shared geo utilities — city coordinates + haversine distance

export interface Coords { lat: number; lon: number; }

export const CITY_COORDS: Record<string, Coords> = {
  tel_aviv:    { lat: 32.0853, lon: 34.7818 },
  bnei_brak:   { lat: 32.0846, lon: 34.8338 },
  jerusalem:   { lat: 31.7683, lon: 35.2137 },
  haifa:       { lat: 32.7940, lon: 34.9896 },
  beer_sheva:  { lat: 31.2518, lon: 34.7913 },
  ramat_gan:   { lat: 32.0700, lon: 34.8240 },
  petah_tikva: { lat: 32.0870, lon: 34.8878 },
  herzliya:    { lat: 32.1663, lon: 34.8439 },
  raanana:     { lat: 32.1839, lon: 34.8719 },
  bat_yam:     { lat: 32.0241, lon: 34.7503 },
  givatayim:   { lat: 32.0683, lon: 34.8125 },
  krayot:      { lat: 32.8350, lon: 35.0800 },
  nahariya:    { lat: 33.0088, lon: 35.0981 },
  acre:        { lat: 32.9225, lon: 35.0681 },
  ashdod:      { lat: 31.7949, lon: 34.6503 },
  ashkelon:    { lat: 31.6688, lon: 34.5742 },
  eilat:       { lat: 29.5577, lon: 34.9519 },
  beit_shemesh:{ lat: 31.7438, lon: 34.9878 },
  netanya:     { lat: 32.3329, lon: 34.8599 },
  holon:        { lat: 32.0104, lon: 34.7800 },
  rishon_lezion:{ lat: 31.9730, lon: 34.8067 },
  zichron_yaakov:{ lat: 32.5695, lon: 34.9567 },
  modiin:       { lat: 31.8969, lon: 35.0106 },
  rehovot:      { lat: 31.8928, lon: 34.8113 },
  lod:          { lat: 31.9516, lon: 34.8956 },
  ramla:        { lat: 31.9296, lon: 34.8721 },
  kfar_saba:    { lat: 32.1769, lon: 34.9079 },
  hod_hasharon: { lat: 32.1523, lon: 34.8915 },
  yavne:        { lat: 31.8790, lon: 34.7430 },
  nes_ziona:    { lat: 31.9294, lon: 34.8007 },
  tel_aviv_yafo:{ lat: 32.0853, lon: 34.7818 },
  yafo:         { lat: 32.0505, lon: 34.7508 },
};

/** Normalise city string to the key format used in CITY_COORDS. */
export function normCity(city: string): string {
  return city.toLowerCase().replace(/ /g, "_");
}

/** Return coordinates for a city, defaulting to Tel Aviv if unknown. */
export function getCityCoords(geoCity: string): Coords {
  return CITY_COORDS[normCity(geoCity)] ?? { lat: 32.0853, lon: 34.7818 };
}

/** Haversine great-circle distance in metres. */
export function distanceMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1), Δλ = toRad(lon2 - lon1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
