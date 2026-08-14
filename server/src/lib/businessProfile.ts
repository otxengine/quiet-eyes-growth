/**
 * businessProfile.ts — Sector-aware utilities for all agents.
 *
 * Parses sector_profile JSON stored on BusinessProfile and exposes:
 *   getSectorProfile()       — parsed JSON or null
 *   buildSearchQueries()     — OSINT web search queries tailored to the exact sub-sector
 *   buildLeadQueries()       — intent-based lead search queries
 *   buildCompetitorTerms()   — competitor search terms for the sub-sector
 *   isSignalRelevant()       — filter out signals on irrelevant topics
 *   buildAgentPromptContext()— rich text block for any LLM prompt
 */

export interface SectorProfile {
  sector_key:          string;
  sub_sector:          string;
  sector_label_he:     string;
  business_type:       string;   // B2B | B2C | B2B2C
  service_model:       string;   // project_based | subscription | appointment | walk_in | ecommerce
  target_audience_he:  string;
  relevant_topics:     string[];
  irrelevant_topics:   string[];
  irrelevant_signal_types: string[];
  competitor_type_he:  string;
  content_themes_he:   string[];
  price_context_he:    string;
  lead_urgency:        string;   // low | medium | high
  content_tone:        string;
  seasonality_he:      string;
  key_trust_signals_he: string[];
}

/** Parse sector_profile from BusinessProfile. Returns null if missing or invalid. */
export function getSectorProfile(profile: { sector_profile?: string | null }): SectorProfile | null {
  if (!profile.sector_profile) return null;
  try { return JSON.parse(profile.sector_profile) as SectorProfile; }
  catch { return null; }
}

// ── City name translations (EN) ────────────────────────────────────────────────
const CITY_EN: Record<string, string> = {
  'תל אביב': 'Tel Aviv', 'ירושלים': 'Jerusalem', 'חיפה': 'Haifa',
  'באר שבע': 'Beer Sheva', 'בני ברק': 'Bnei Brak', 'ראשון לציון': 'Rishon LeZion',
  'נתניה': 'Netanya', 'אשדוד': 'Ashdod', 'רמת גן': 'Ramat Gan',
  'פתח תקווה': 'Petah Tikva', 'הרצליה': 'Herzliya', 'רעננה': "Ra'anana",
  'כפר סבא': 'Kfar Saba', 'חולון': 'Holon', 'בת ים': 'Bat Yam',
  'אשקלון': 'Ashkelon', 'מודיעין': "Modi'in", 'רחובות': 'Rehovot',
};
export function cityToEn(city: string): string {
  return CITY_EN[city] || city;
}

/**
 * Build tailored Tavily OSINT search queries for this specific business.
 * Uses sector_profile.relevant_topics when available; falls back to category-based queries.
 */
export function buildSearchQueries(
  profile: {
    name: string;
    category: string;
    city: string;
    description?: string | null;
    sector_profile?: string | null;
    custom_keywords?: string | null;
  },
  cityEn?: string
): string[] {
  const city = cityEn || cityToEn(profile.city);
  const sp = getSectorProfile(profile);
  const queries: string[] = [];

  // 1. Business reputation / reviews (always)
  queries.push(`"${profile.name}" reviews ${city} Israel`);
  queries.push(`"${profile.name}" ביקורות`);

  if (sp) {
    // 2. Relevant topic searches — specific to exact sub-sector
    for (const topic of sp.relevant_topics.slice(0, 4)) {
      queries.push(`${topic} ${city} Israel`);
      queries.push(`${topic} trends Israel 2025`);
    }

    // 3. Sub-sector specific market searches
    queries.push(`${sp.sub_sector.replace(/_/g, ' ')} ${city} Israel`);

    // 4. Business type context
    if (sp.business_type === 'B2B') {
      queries.push(`${sp.sector_label_he} לעסקים ישראל`);
    } else {
      queries.push(`${sp.sector_label_he} ${profile.city} מומלץ`);
    }

    // 5. Content theme searches — what's trending in their world
    for (const theme of sp.content_themes_he.slice(0, 2)) {
      queries.push(`${theme} ישראל 2025`);
    }
  } else {
    // Fallback to category-based searches
    queries.push(`${profile.category} ${city} best recommendations 2025`);
    queries.push(`${profile.category} ${city} Israel`);
    if (profile.description) {
      const shortDesc = profile.description.split(' ').slice(0, 6).join(' ');
      queries.push(`${shortDesc} ${city}`);
    }
  }

  // ── Sector-specific high-value intelligence queries ─────────────────────────
  const catL = (profile.category || '').toLowerCase();

  // Construction / Real-estate / Renovation: permits, tenders, new projects
  if (['קבלן', 'שיפוץ', 'בנייה', 'נדל', 'יזמות', 'contractor', 'renovation', 'construction'].some(k => catL.includes(k))) {
    const yr = new Date().getFullYear();
    queries.push(`iplan.gov.il OR govmap.gov.il היתר בנייה ${profile.city} ${yr}`);
    queries.push(`מכרז שיפוץ OR בנייה ${profile.city} עיריה ${yr}`);
    queries.push(`nadlan.co.il OR yad2.co.il פרויקט חדש ${profile.city}`);
    queries.push(`construction permit tender ${city} Israel ${yr}`);
  }

  // Mortgage / Finance: interest rate changes, bank offers
  if (['משכנתא', 'מימון', 'פיננסי', 'mortgage', 'finance'].some(k => catL.includes(k))) {
    queries.push(`בנק ישראל ריבית פריים שינוי ${new Date().getFullYear()}`);
    queries.push(`mortgage interest rate Israel ${new Date().getFullYear()} change`);
    queries.push(`השוואת משכנתאות בנקים ישראל מסלולים`);
  }

  // Hotel / Boutique: competitor pricing, local events driving demand
  if (['מלון', 'צימר', 'hotel', 'boutique', 'נופש'].some(k => catL.includes(k))) {
    const mo = new Date().toLocaleString('en-US', { month: 'long' });
    queries.push(`booking.com ${city} hotel prices ${mo}`);
    queries.push(`פסטיבל OR כנס OR אירוע ${profile.city} ${new Date().getFullYear()} תיירות`);
  }

  // Clinics / MedSpa: competitor promotions
  if (['קליניקה', 'אסתטיקה', 'clinic', 'medical', 'aesthetic', 'botox', 'פלסטיקה'].some(k => catL.includes(k))) {
    queries.push(`מבצע ${profile.category} ${profile.city} 2025 site:facebook.com`);
    queries.push(`${profile.category} ${profile.city} מחיר השוואה`);
  }

  // Remove duplicates
  return [...new Set(queries)];
}

/**
 * Build lead-intent search queries tailored to the business's sub-sector.
 * Used by runLeadGeneration to find people actively looking for this service.
 */
export function buildLeadQueries(
  profile: {
    name: string;
    category: string;
    city: string;
    description?: string | null;
    sector_profile?: string | null;
    relevant_services?: string | null;
  },
  cityEn?: string
): string[] {
  const city = cityEn || cityToEn(profile.city);
  const sp = getSectorProfile(profile);
  const queries: string[] = [];

  if (sp) {
    // B2B: LinkedIn + professional forums
    if (sp.business_type === 'B2B') {
      queries.push(`"looking for" "${sp.sub_sector.replace(/_/g, ' ')}" Israel`);
      queries.push(`"need" "${sp.sector_label_he}" site:linkedin.com`);
      queries.push(`מחפש ${sp.sector_label_he} לעסק`);
      for (const topic of sp.relevant_topics.slice(0, 2)) {
        queries.push(`"hire" OR "looking for" ${topic} freelancer Israel`);
      }
    } else {
      // B2C: local forums, Facebook groups, Google Maps queries
      queries.push(`מחפש ${sp.sector_label_he} ${profile.city}`);
      queries.push(`מישהו ממליץ על ${sp.sector_label_he} ${profile.city} site:facebook.com`);
      queries.push(`${sp.sector_label_he} ${profile.city} המלצה forum`);
      queries.push(`מחפש ${sp.sector_label_he} ${profile.city} site:yad2.co.il`);
    }

    // Urgency-adjusted: high urgency = add urgent search terms
    if (sp.lead_urgency === 'high') {
      queries.push(`דחוף ${sp.sector_label_he} ${profile.city}`);
    }
  } else {
    // Generic fallback
    queries.push(`מחפש ${profile.category} ${profile.city}`);
    queries.push(`המלצה על ${profile.category} ${profile.city} site:facebook.com`);
    queries.push(`"looking for" "${profile.category}" ${city} Israel`);
  }

  if (profile.relevant_services) {
    const services = profile.relevant_services.split(',').map(s => s.trim()).filter(Boolean);
    for (const svc of services.slice(0, 2)) {
      queries.push(`מחפש ${svc} ${profile.city}`);
    }
  }

  return [...new Set(queries)];
}

/**
 * Build competitor search terms for runCompetitorIdentification.
 * Returns Hebrew search terms for Google Maps / SerpAPI.
 */
export function buildCompetitorTerms(
  profile: {
    category: string;
    city: string;
    description?: string | null;
    sector_profile?: string | null;
  }
): string[] {
  const sp = getSectorProfile(profile);
  if (!sp) {
    return [profile.category, `${profile.category} ${profile.city}`];
  }

  const terms: string[] = [];

  // Primary: exact sub-sector label
  terms.push(sp.sector_label_he);

  // From competitor_type (e.g. "משרדי עיצוב, פרילנסרים")
  for (const t of sp.competitor_type_he.split(',').map(s => s.trim()).filter(Boolean)) {
    terms.push(t);
  }

  // From relevant_topics (first 3)
  for (const topic of sp.relevant_topics.slice(0, 3)) {
    terms.push(topic);
  }

  return [...new Set(terms)].slice(0, 6);
}

/**
 * Check whether a signal (raw text/category) is relevant for this business.
 * Used to filter out irrelevant signals before they reach the LLM.
 */
export function isSignalRelevant(
  signal: { content?: string | null; category?: string | null },
  profile: { sector_profile?: string | null }
): boolean {
  const sp = getSectorProfile(profile);
  if (!sp) return true; // no profile → keep everything

  const text = ((signal.content || '') + ' ' + (signal.category || '')).toLowerCase();

  // Check irrelevant signal types
  if (signal.category && sp.irrelevant_signal_types.includes(signal.category)) return false;

  // Check irrelevant topics
  for (const topic of sp.irrelevant_topics) {
    if (text.includes(topic.toLowerCase())) return false;
  }

  return true;
}

/**
 * Filter an array of signals, keeping only those relevant to this business's sector.
 * Drop-in wrapper around isSignalRelevant() — use everywhere signals are processed.
 */
export function filterSignals<T extends { content?: string | null; category?: string | null }>(
  signals: T[],
  profile: { sector_profile?: string | null },
): T[] {
  return signals.filter(s => isSignalRelevant(s, profile));
}

/**
 * Build a rich context block for any LLM prompt.
 * Drop-in replacement / complement to getBusinessSectorContext().
 * Includes: sub-sector, B2B/B2C type, target audience, pricing context, relevant topics,
 * irrelevant topics (EXPLICIT EXCLUSION INSTRUCTION), competitor type, content tone.
 */
export function buildAgentPromptContext(
  profile: {
    name: string;
    category: string;
    city: string;
    description?: string | null;
    sector_profile?: string | null;
    business_goal?: string | null;
    price_tier?: string | null;
  }
): string {
  const sp = getSectorProfile(profile);
  if (!sp) {
    return `עסק: ${profile.name} | קטגוריה: ${profile.category} | עיר: ${profile.city}${profile.description ? `\nתיאור: ${profile.description}` : ''}`;
  }

  const lines: string[] = [
    `=== פרופיל עסק מדויק ===`,
    `שם: ${profile.name}`,
    `סוג עסק: ${sp.sector_label_he} (${sp.sub_sector})`,
    `מודל: ${sp.business_type} | ${sp.service_model}`,
    `עיר: ${profile.city}`,
    `קהל יעד: ${sp.target_audience_he}`,
    `הקשר מחיר: ${sp.price_context_he}`,
    ``,
    `נושאים רלוונטיים (חפש ונתח בהתאם לאלו בלבד):`,
    ...sp.relevant_topics.map(t => `  • ${t}`),
    ``,
    `⚠️ נושאים שאינם רלוונטיים לעסק זה (אל תכלול תובנות / לידים / אירועים מהתחומים האלו):`,
    ...sp.irrelevant_topics.map(t => `  ✗ ${t}`),
    ``,
    `סוג מתחרים: ${sp.competitor_type_he}`,
    `טון תקשורת: ${sp.content_tone}`,
  ];

  if (profile.business_goal) {
    const goalMap: Record<string, string> = {
      new_customers: 'גיוס לקוחות חדשים',
      retain: 'שימור לקוחות קיימים',
      more_per_customer: 'הגדלת ערך לקוח',
      reviews: 'שיפור דירוגים',
    };
    lines.push(`מטרה עסקית עכשיו: ${goalMap[profile.business_goal] || profile.business_goal}`);
  }

  lines.push(`=== סוף פרופיל ===`);
  return lines.join('\n');
}
