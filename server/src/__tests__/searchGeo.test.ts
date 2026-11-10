// The search helpers send the business's region and language: Israel / Hebrew by default, US / English
// for an English business.
import { localeOf, searchGeo, IL_GEO } from '../lib/locale';

const US = searchGeo(localeOf({ locale: 'en-US' }));
const OLD_ENV = process.env;
const lastBody = () => JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);

beforeEach(() => {
  jest.resetModules();
  process.env = { ...OLD_ENV, DATAFORSEO_LOGIN: 'user', DATAFORSEO_PASSWORD: 'pass', GOOGLE_PLACES_API_KEY: 'k' };
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as any;
});
afterAll(() => { process.env = OLD_ENV; });

test('searchGeo: Hebrew or no locale is Israel, English is the US', () => {
  expect(searchGeo(null)).toBe(IL_GEO);
  expect(searchGeo(localeOf({ locale: 'he-IL' }))).toBe(IL_GEO);
  expect(US).toMatchObject({ hl: 'en', gl: 'us', country: 'United States', language: 'English', googleDomain: 'google.com', geocodeSuffix: '' });
});

test('DataForSEO maps + organic search: Israel by default, US when asked', async () => {
  const { searchCompetitorsByKeyword, searchOrganic } = require('../lib/dataforseo');
  await searchCompetitorsByKeyword('pizza', 30.27, -97.74, undefined, undefined, US);
  expect(lastBody()[0]).toMatchObject({ keyword: 'pizza', language_code: 'en' });
  (global.fetch as jest.Mock).mockClear();
  await searchOrganic('"Rival Pizza" website', US);
  expect(lastBody()[0]).toEqual({ keyword: '"Rival Pizza" website', language_code: 'en', location_name: 'United States' });
  (global.fetch as jest.Mock).mockClear();
  await searchOrganic('"קפה" אתר');
  expect(lastBody()[0]).toEqual({ keyword: '"קפה" אתר', language_code: 'iw', location_name: 'Israel' });
});

test('DataForSEO reviews task carries the location and language it is given', async () => {
  const { submitGoogleReviewsTask } = require('../lib/dataforseo');
  await submitGoogleReviewsTask({ placeId: 'p1', locationName: US.country, languageName: US.language });
  expect(lastBody()[0]).toMatchObject({ location_name: 'United States', language_name: 'English' });
});

test('findPlaceId: language and region follow the business', async () => {
  const { findPlaceId } = require('../lib/googlePlaces');
  await findPlaceId('Rival Pizza', 'Austin, TX', US);
  expect(lastBody()).toEqual({ textQuery: 'Rival Pizza Austin, TX', languageCode: 'en', regionCode: 'us' });
  (global.fetch as jest.Mock).mockClear();
  await findPlaceId('קפה', 'תל אביב');
  expect(lastBody()).toEqual({ textQuery: 'קפה תל אביב', languageCode: 'iw', regionCode: 'il' });
});
