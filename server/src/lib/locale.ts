/** Language, formatting locale and timezone a business's reports are written in. Pure — no I/O. */
export interface BizLocale {
  lang: 'he' | 'en';
  /** BCP 47 tag for Intl formatting. */
  intl: string;
  /** IANA timezone its report periods are cut in. */
  tz: string;
}

export const IL_LOCALE: BizLocale = { lang: 'he', intl: 'he-IL', tz: 'Asia/Jerusalem' };

const isTimezone = (tz: string) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

/**
 * From the business_profiles.locale / .timezone columns. Anything that is not explicitly
 * English stays Hebrew / Israel time — every existing business.
 * ponytail: two languages; add a map when a third one is sold.
 */
export function localeOf(p?: { locale?: string | null; timezone?: string | null } | null): BizLocale {
  const en = /^en\b/i.test(p?.locale ?? '');
  const tz = p?.timezone && isTimezone(p.timezone) ? p.timezone : en ? 'America/New_York' : IL_LOCALE.tz;
  return en ? { lang: 'en', intl: 'en-US', tz } : { ...IL_LOCALE, tz };
}

/** System prompt for English JSON calls — llm.ts's default JSON system prompt asks for Hebrew. */
export const EN_JSON_SYSTEM = 'You are a JSON-only assistant. Respond with a single valid JSON object only. No preamble, no explanation, no markdown fences. ALL string values must be in English.';

/** Where and in which language the search APIs (Google, DataForSEO, SerpAPI) look for a business. */
export interface SearchGeo {
  /** Google interface language code: 'iw' | 'en'. */
  hl: string;
  /** Google region / country code: 'il' | 'us'. */
  gl: string;
  /** DataForSEO location_name. */
  country: string;
  /** DataForSEO language_name, and the language LLM prompts ask for. */
  language: string;
  googleDomain: string;
  /** Appended to a geocoding query so a bare city name resolves in the right country. */
  geocodeSuffix: string;
}

export const IL_GEO: SearchGeo = { hl: 'iw', gl: 'il', country: 'Israel', language: 'Hebrew', googleDomain: 'google.co.il', geocodeSuffix: ' ישראל' };
// ponytail: English means the US — the only English market sold. Add a country column when a second one is.
const US_GEO: SearchGeo = { hl: 'en', gl: 'us', country: 'United States', language: 'English', googleDomain: 'google.com', geocodeSuffix: '' };

export const searchGeo = (loc?: BizLocale | null): SearchGeo => (loc?.lang === 'en' ? US_GEO : IL_GEO);
