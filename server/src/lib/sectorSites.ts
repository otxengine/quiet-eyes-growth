/**
 * sectorSites.ts — Verified active Israeli sector-specific sites
 *
 * Maps business category keywords to authoritative, currently-active Israeli
 * and global sites relevant to that sector. Used by OSINT agents to target
 * real, fresh data sources instead of generic web searches.
 *
 * Criteria for inclusion:
 * - Site must be currently active (verified 2025)
 * - Site must contain fresh user-generated or editorial content
 * - Site must be relevant to Israeli consumers / businesses
 */

export const SECTOR_SITES: Record<string, string[]> = {
  // ─── Food & Beverage ─────────────────────────────────────────────────────────
  'מסעדה':         ['2eat.co.il', 'rest.co.il', 'timeout.co.il', 'wolt.com', 'tenbis.co.il', 'mishloha.co.il'],
  'בית קפה':       ['2eat.co.il', 'timeout.co.il', 'wolt.com', 'tenbis.co.il'],
  'מאפייה':        ['2eat.co.il', 'wolt.com', 'tenbis.co.il', 'timeout.co.il'],
  'פיצרייה':       ['wolt.com', 'mishloha.co.il', 'tenbis.co.il', '2eat.co.il'],
  'שווארמה':       ['wolt.com', 'mishloha.co.il', '2eat.co.il'],
  'פלאפל':         ['wolt.com', '2eat.co.il', 'tenbis.co.il'],
  'קייטרינג':      ['timeout.co.il', 'eventbrite.com', 'ynet.co.il'],
  // ─── Beauty & Personal Care ──────────────────────────────────────────────────
  'מספרה':         ['fresha.com', 'treatwell.co.il', 'simpo.co.il', 'booksy.com'],
  'מכון יופי':     ['fresha.com', 'treatwell.co.il', 'simpo.co.il', 'booksy.com'],
  'ספא':           ['fresha.com', 'treatwell.co.il', 'simpo.co.il'],
  'קוסמטיקה':      ['fresha.com', 'treatwell.co.il', 'super-pharm.co.il'],
  // ─── Fitness & Sport ─────────────────────────────────────────────────────────
  'מכון כושר':     ['sporteam.co.il', 'sportmarket.co.il', 'gym.co.il'],
  'סטודיו ליוגה':  ['sporteam.co.il', 'timeout.co.il', 'eventbrite.com'],
  'חנות ספורט':    ['sport-depot.co.il', 'sportmarket.co.il', 'zap.co.il'],
  // ─── Retail ──────────────────────────────────────────────────────────────────
  'חנות בגדים':       ['zap.co.il', 'walla.co.il'],
  'חנות אלקטרוניקה':  ['zap.co.il', 'ksp.co.il', 'ivory.co.il', 'bug.co.il'],
  'חנות רהיטים':      ['zap.co.il', 'home-center.co.il', 'kika.co.il', 'houzz.com'],
  'חנות פרחים':       ['flowers.co.il', 'florence.co.il', 'interflora.co.il'],
  'חנות חיות':        ['pet-center.co.il', 'zoo.co.il', 'zap.co.il'],
  'חנות תכשיטים':     ['zap.co.il', 'goldfinger.co.il'],
  'בית מרקחת':        ['super-pharm.co.il', 'be.co.il'],
  'אופטיקה':          ['zap.co.il'],
  // ─── Grocery ─────────────────────────────────────────────────────────────────
  'מינימרקט':     ['rami-levy.co.il', 'shufersal.co.il', 'victory.co.il'],
  'סופרמרקט':     ['rami-levy.co.il', 'shufersal.co.il', 'mega.co.il'],
  // ─── Medical & Health ────────────────────────────────────────────────────────
  'רופא שיניים':   ['doctorly.co.il', 'maccabi.co.il', 'clalit.co.il'],
  'רופא משפחה':    ['doctorly.co.il', 'maccabi.co.il', 'clalit.co.il'],
  'פסיכולוג':      ['betipul.co.il', 'doctorly.co.il'],
  'וטרינר':        ['vet.co.il', 'pet-center.co.il'],
  // ─── Professional Services ───────────────────────────────────────────────────
  'עורך דין':      ['din.co.il', 'lawguide.co.il', 'finder.co.il'],
  'רואה חשבון':    ['accountant.co.il', 'finder.co.il'],
  'סוכנות ביטוח':  ['dbi.co.il', 'zap.co.il'],
  // ─── Real Estate ─────────────────────────────────────────────────────────────
  'סוכנות נדלן':   ['yad2.co.il', 'madlan.co.il', 'homely.co.il', 'winwin.co.il'],
  'משרד תיווך':    ['yad2.co.il', 'madlan.co.il'],
  // ─── Construction & Home ─────────────────────────────────────────────────────
  'קבלן שיפוצים':  ['zap.co.il', 'koter.co.il', 'xnet.co.il'],
  'חשמלאי':        ['zap.co.il', 'koter.co.il'],
  'שרברב':         ['zap.co.il', 'koter.co.il'],
  'מוסך':          ['zap.co.il', 'automaster.co.il', 'cartrade.co.il'],
  'אדריכל':        ['houzz.com', 'archdaily.com'],
  'מעצב פנים':     ['houzz.com', 'pinterest.com'],
  // ─── Events ──────────────────────────────────────────────────────────────────
  'אולם אירועים':  ['timeout.co.il', 'eventbrite.com', 'leaan.co.il'],
  // ─── Tech / Digital ──────────────────────────────────────────────────────────
  'פיתוח תוכנה':   ['geektime.co.il', 'calcalist.co.il', 'linkedin.com'],
  'שיווק דיגיטלי': ['geektime.co.il', 'calcalist.co.il'],
  // ─── Default: Israeli news + business portals ─────────────────────────────────
  '_default': ['ynet.co.il', 'mako.co.il', 'calcalist.co.il', 'themarker.co.il', 'walla.co.il', 'tapuz.co.il'],
};

/** Israeli business/news press for market trend queries */
export const BUSINESS_PRESS = [
  'calcalist.co.il', 'themarker.co.il', 'globes.co.il',
  'ynet.co.il', 'mako.co.il', 'geektime.co.il', 'walla.co.il',
];

/** Israeli forums and community platforms */
export const ISRAELI_FORUMS = ['tapuz.co.il', 'reddit.com'];

/** Return verified sector sites for a given category. Falls back to default. */
export function getSectorSites(category: string): string[] {
  if (!category) return SECTOR_SITES['_default'];
  if (SECTOR_SITES[category]) return SECTOR_SITES[category];
  // Partial keyword match — handles compound categories like "מכון כושר ויוגה"
  for (const [key, sites] of Object.entries(SECTOR_SITES)) {
    if (key === '_default') continue;
    if (category.includes(key) || key.includes(category.split(' ')[0])) return sites;
  }
  return SECTOR_SITES['_default'];
}

/**
 * Freshness score: 1.0 = very fresh, 0.0 = stale.
 * Used to filter out outdated search results before saving as signals.
 */
export function scoreFreshness(content: string, url: string, publishedDate?: string | null): number {
  if (publishedDate) {
    const ageMs = Date.now() - new Date(publishedDate).getTime();
    if (ageMs < 30 * 86400000)  return 1.0;
    if (ageMs < 90 * 86400000)  return 0.75;
    if (ageMs < 180 * 86400000) return 0.45;
    return 0.1;
  }
  const text = `${url} ${content}`.toLowerCase();
  if (/202[5-6]/.test(url))               return 0.9;
  if (/202[5-6]/.test(content.slice(0, 400))) return 0.8;
  if (/2024/.test(text))                  return 0.6;
  if (/201[0-9]|2020|2021|2022/.test(text) && !/202[3-6]/.test(text)) return 0.1;
  return 0.5;
}

/**
 * Returns true if the content/URL passes the freshness gate (score >= threshold).
 * Default threshold 0.15 — rejects content with only pre-2023 date signals.
 */
export function isFresh(content: string, url: string, publishedDate?: string | null, threshold = 0.15): boolean {
  return scoreFreshness(content, url, publishedDate) >= threshold;
}
