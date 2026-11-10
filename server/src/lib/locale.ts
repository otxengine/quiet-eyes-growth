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
