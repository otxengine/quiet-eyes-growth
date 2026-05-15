import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const TAVILY_API_KEY = Deno.env.get("TAVILY_API_KEY");

// ── Tavily helper ──────────────────────────────────────────────────────────────
async function tavilySearch(query, options: any = {}) {
  const body: any = {
    api_key: TAVILY_API_KEY,
    query,
    search_depth: options.depth || 'advanced',
    max_results: options.maxResults || 5,
    include_answer: true,
    include_raw_content: false,
  };
  if (options.includeDomains?.length) body.include_domains = options.includeDomains;
  if (options.excludeDomains?.length) body.exclude_domains = options.excludeDomains;

  console.log(`[Tavily] Searching: "${query}"`);
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status === 433) {
      console.warn(`[Tavily] Rate limited (${res.status})`);
      return { results: [], answer: '', rateLimited: true };
    }
    if (!res.ok) {
      console.error(`Tavily API error (${res.status}): ${await res.text()}`);
      return { results: [], answer: '' };
    }
    const data = await res.json();
    console.log(`[Tavily] Got ${data.results?.length || 0} results`);
    return data;
  } catch (err) {
    console.error(`Tavily fetch error: ${err.message}`);
    return { results: [], answer: '' };
  }
}

// ── Sector-specific verified active Israeli sites ──────────────────────────────
// Each key is a category keyword; values are authoritative active sites for that sector.
// Sites selected for: Israeli relevance, freshness of content, real user activity.
const SECTOR_SITES: Record<string, string[]> = {
  // Food & Beverage
  'מסעדה':         ['2eat.co.il', 'rest.co.il', 'timeout.co.il', 'wolt.com', 'tenbis.co.il', 'mishloha.co.il'],
  'בית קפה':       ['2eat.co.il', 'timeout.co.il', 'wolt.com', 'tenbis.co.il'],
  'מאפייה':        ['2eat.co.il', 'wolt.com', 'tenbis.co.il', 'timeout.co.il'],
  'פיצרייה':       ['wolt.com', 'mishloha.co.il', 'tenbis.co.il', '2eat.co.il'],
  'שווארמה':       ['wolt.com', 'mishloha.co.il', '2eat.co.il', 'tenbis.co.il'],
  'פלאפל':         ['wolt.com', '2eat.co.il', 'tenbis.co.il'],
  'קייטרינג':      ['timeout.co.il', 'eventbrite.com', 'ynet.co.il'],
  // Beauty & Personal Care
  'מספרה':         ['fresha.com', 'treatwell.co.il', 'simpo.co.il', 'booksy.com'],
  'מכון יופי':     ['fresha.com', 'treatwell.co.il', 'simpo.co.il', 'booksy.com'],
  'ספא':           ['fresha.com', 'treatwell.co.il', 'simpo.co.il'],
  'קוסמטיקה':      ['fresha.com', 'treatwell.co.il', 'super-pharm.co.il'],
  // Fitness & Sport
  'מכון כושר':     ['sporteam.co.il', 'sportmarket.co.il', 'gym.co.il'],
  'סטודיו ליוגה':  ['sporteam.co.il', 'timeout.co.il', 'eventbrite.com'],
  'סטודיו לפילאטיס':['sporteam.co.il', 'timeout.co.il'],
  // Retail
  'חנות בגדים':       ['zap.co.il', 'stylight.co.il', 'walla.co.il'],
  'חנות אלקטרוניקה':  ['zap.co.il', 'ksp.co.il', 'ivory.co.il', 'bug.co.il'],
  'חנות רהיטים':      ['zap.co.il', 'home-center.co.il', 'kika.co.il', 'houzz.com'],
  'חנות פרחים':       ['flowers.co.il', 'florence.co.il', 'interflora.co.il'],
  'חנות ספורט':       ['sport-depot.co.il', 'sportmarket.co.il', 'zap.co.il'],
  'חנות חיות':        ['pet-center.co.il', 'zoo.co.il', 'zap.co.il'],
  'חנות תכשיטים':     ['zap.co.il', 'goldfinger.co.il'],
  'חנות צעצועים':     ['zap.co.il', 'smile.co.il'],
  'בית מרקחת':        ['super-pharm.co.il', 'be.co.il'],
  'אופטיקה':          ['zap.co.il', 'optic-center.co.il'],
  // Grocery & Food market
  'מינימרקט':     ['rami-levy.co.il', 'shufersal.co.il', 'victory.co.il'],
  'סופרמרקט':     ['rami-levy.co.il', 'shufersal.co.il', 'mega.co.il'],
  'חנות בשר':     ['wolt.com', '2eat.co.il'],
  // Medical & Health
  'רופא שיניים':   ['doctorly.co.il', 'maccabi.co.il', 'clalit.co.il'],
  'רופא משפחה':    ['doctorly.co.il', 'maccabi.co.il', 'clalit.co.il'],
  'פסיכולוג':      ['betipul.co.il', 'doctorly.co.il'],
  'וטרינר':        ['vet.co.il', 'pet-center.co.il'],
  // Professional Services
  'עורך דין':      ['din.co.il', 'lawguide.co.il', 'finder.co.il'],
  'רואה חשבון':    ['accountant.co.il', 'finder.co.il'],
  'יועץ מס':       ['accountant.co.il', 'finder.co.il'],
  'סוכנות ביטוח':  ['dbi.co.il', 'zap.co.il'],
  // Real Estate
  'סוכנות נדלן':   ['yad2.co.il', 'madlan.co.il', 'homely.co.il', 'winwin.co.il'],
  'משרד תיווך':    ['yad2.co.il', 'madlan.co.il'],
  // Construction & Home
  'קבלן שיפוצים':  ['zap.co.il', 'koter.co.il', 'xnet.co.il'],
  'חשמלאי':        ['zap.co.il', 'koter.co.il'],
  'שרברב':         ['zap.co.il', 'koter.co.il'],
  'מוסך':          ['zap.co.il', 'automaster.co.il', 'cartrade.co.il'],
  'אדריכל':        ['houzz.com', 'archdaily.com'],
  'מעצב פנים':     ['houzz.com', 'pinterest.com', 'houzz.co.il'],
  'דפוס':          ['zap.co.il'],
  // Education
  'גן ילדים':          ['tapuz.co.il', 'campiday.co.il'],
  'מכון לימודים':      ['mako.co.il', 'ynet.co.il'],
  'בית ספר לנהיגה':    ['zap.co.il'],
  // Events
  'אולם אירועים':      ['timeout.co.il', 'eventbrite.com', 'leaan.co.il'],
  'צלם אירועים':       ['tapuz.co.il', 'timeout.co.il'],
  // Tech
  'פיתוח תוכנה':       ['geektime.co.il', 'calcalist.co.il', 'linkedin.com'],
  'שיווק דיגיטלי':     ['geektime.co.il', 'calcalist.co.il'],
  // Default: Israeli news/business portals for any sector
  '_default': ['ynet.co.il', 'mako.co.il', 'calcalist.co.il', 'themarker.co.il', 'walla.co.il', 'tapuz.co.il'],
};

// Israeli business/news press for trend & market queries
const BUSINESS_PRESS = ['calcalist.co.il', 'themarker.co.il', 'globes.co.il', 'ynet.co.il', 'mako.co.il', 'geektime.co.il', 'walla.co.il'];

// Israeli forums & communities — real local conversation
const ISRAELI_FORUMS = ['tapuz.co.il', 'forums.co.il', 'reddit.com'];

function getSectorSites(category: string): string[] {
  if (!category) return SECTOR_SITES['_default'];
  if (SECTOR_SITES[category]) return SECTOR_SITES[category];
  // Partial keyword match
  for (const [key, sites] of Object.entries(SECTOR_SITES)) {
    if (key === '_default') continue;
    if (category.includes(key) || key.includes(category.split(' ')[0])) return sites;
  }
  return SECTOR_SITES['_default'];
}

// Freshness scoring: 1.0 = very fresh, 0.0 = stale
// Used to skip content older than 6 months with no recent date signals
function scoreFreshness(content: string, url: string, publishedDate?: string): number {
  if (publishedDate) {
    const ageMs = Date.now() - new Date(publishedDate).getTime();
    if (ageMs < 30 * 86400000)  return 1.0;   // < 30 days: very fresh
    if (ageMs < 90 * 86400000)  return 0.75;  // 30-90 days: fresh
    if (ageMs < 180 * 86400000) return 0.45;  // 3-6 months: aging
    return 0.1;                                // > 6 months: stale
  }
  const text = `${url} ${content}`.toLowerCase();
  if (/202[5-6]/.test(url))               return 0.9;
  if (/202[5-6]/.test(content.slice(0, 400))) return 0.8;
  if (/2024/.test(text))                  return 0.6;
  // Stale: has old years with no recent ones
  if (/201[0-9]|2020|2021|2022/.test(text) && !/202[3-6]/.test(text)) return 0.1;
  return 0.5; // unknown age
}

// Detect platform from URL for accurate signal typing
function detectPlatform(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('facebook.com') || u.includes('fb.com'))        return 'facebook';
  if (u.includes('instagram.com'))                                return 'instagram';
  if (u.includes('tiktok.com'))                                   return 'tiktok';
  if (u.includes('google.com/maps') || u.includes('google.co.il'))return 'google_maps';
  if (u.includes('tapuz.co.il') || u.includes('reddit.com') || u.includes('forum')) return 'forum';
  if (u.includes('2eat.co.il') || u.includes('rest.co.il'))       return 'food_review';
  if (u.includes('zap.co.il') || u.includes('ksp.co.il'))         return 'price_comparison';
  if (u.includes('yad2.co.il') || u.includes('madlan.co.il'))     return 'classifieds';
  if (u.includes('fresha.com') || u.includes('treatwell.co.il') || u.includes('booksy.com')) return 'booking_platform';
  if (u.includes('wolt.com') || u.includes('tenbis.co.il'))       return 'delivery_platform';
  if (u.includes('calcalist.co.il') || u.includes('themarker.co.il') || u.includes('globes.co.il')) return 'business_press';
  return 'website';
}

// ── Main handler ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const startTime = new Date().toISOString();

  if (!TAVILY_API_KEY) {
    console.error('TAVILY_API_KEY not set');
    return Response.json({ error: 'TAVILY_API_KEY not configured', new_signals_saved: 0 }, { status: 500 });
  }

  // ── Resolve business profile ────────────────────────────────────────────────
  let profile: any;
  if (body.businessProfileId) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all.find((p: any) => p.id === body.businessProfileId);
  }
  if (!profile) {
    try {
      const user = await base44.auth.me();
      if (user) {
        const profiles = await base44.entities.BusinessProfile.filter({ created_by: user.email });
        profile = profiles[0];
      }
    } catch (_) {}
  }
  if (!profile) {
    const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = allProfiles[0];
  }
  if (!profile) {
    return Response.json({ error: 'No business profile found', new_signals_saved: 0 }, { status: 404 });
  }

  const { name, category, city, relevant_services, custom_keywords, custom_urls } = profile;
  const sectorSites = getSectorSites(category);

  const [competitors, sectorKnowledge] = await Promise.all([
    base44.asServiceRole.entities.Competitor.filter({ linked_business: profile.id }),
    base44.asServiceRole.entities.SectorKnowledge.filter({}),
  ]);
  const competitorNames = competitors.slice(0, 5).map((c: any) => c.name);
  const sectorInfo = sectorKnowledge.find((s: any) => s.sector === category && s.region === city)
    || sectorKnowledge.find((s: any) => s.sector === category) || null;

  let rateLimited = false;
  let newSignalsSaved = 0;
  let duplicatesSkipped = 0;
  let totalResultsFound = 0;

  // ── Shared save helper ──────────────────────────────────────────────────────
  async function saveResult(result: any, sourceLabel: string, signalTypeOverride?: string): Promise<boolean> {
    if (!result.url || result.url.length < 10) return false;
    if (result.url.includes('google.com/search') || result.url.includes('bing.com/search')) return false;

    const existing = await base44.asServiceRole.entities.RawSignal.filter({ url: result.url });
    if (existing.length > 0) { duplicatesSkipped++; return false; }

    const content = (result.content || result.title || '').substring(0, 500);
    if (!content || content.length < 20) return false;

    // Freshness gate: skip clearly stale content (< 0.15)
    const freshScore = scoreFreshness(content, result.url, result.published_date);
    if (freshScore < 0.15) {
      console.log(`[collectWebSignals] Skipping stale content (${freshScore}): ${result.url.slice(0, 60)}`);
      duplicatesSkipped++;
      return false;
    }

    const platform = detectPlatform(result.url);
    const signalType = signalTypeOverride || (
      ['facebook', 'instagram', 'tiktok'].includes(platform) ? 'social_mention' : 'web_search'
    );

    await base44.asServiceRole.entities.RawSignal.create({
      source: sourceLabel,
      content,
      url: result.url,
      signal_type: signalType,
      platform,
      sentiment: 'unknown',
      source_origin: 'tavily',
      freshness_score: freshScore,
      detected_at: result.published_date || new Date().toISOString(),
      linked_business: profile.id,
    });
    newSignalsSaved++;
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PHASE 0 — Sector-specific verified sites (include_domains)
  // Searches ONLY authoritative Israeli sites for this business sector.
  // These sites have real, active user reviews and current pricing data.
  // ══════════════════════════════════════════════════════════════════════════════
  console.log(`[Phase 0] Sector sites: ${sectorSites.slice(0, 4).join(', ')}...`);

  const phase0Queries = [
    { q: `${name} ביקורות חוות דעת`, domains: sectorSites },
    { q: `${category} ${city} ביקורות 2025 2026`, domains: sectorSites },
    { q: `${category} ${city} מחיר שירות`, domains: sectorSites },
    { q: `${category} ישראל מגמה חדש 2026`, domains: [...sectorSites, ...BUSINESS_PRESS] },
  ];
  if (competitorNames.length > 0) {
    phase0Queries.push({ q: `"${competitorNames[0]}" ביקורות ${city}`, domains: sectorSites });
  }
  if (competitorNames.length > 1) {
    phase0Queries.push({ q: `"${competitorNames[1]}" ביקורות ${city}`, domains: sectorSites });
  }

  for (const { q, domains } of phase0Queries) {
    if (rateLimited) break;
    const res = await tavilySearch(q, { maxResults: 5, depth: 'advanced', includeDomains: domains });
    if ((res as any).rateLimited) { rateLimited = true; break; }
    totalResultsFound += (res.results || []).length;
    for (const r of res.results || []) await saveResult(r, `sector_site: ${q}`, 'sector_review');
    // Tavily AI answer
    if (res.answer && res.answer.length > 50) {
      const ansKey = `tavily_ans_p0_${q.slice(0, 40)}`;
      const existing = await base44.asServiceRole.entities.RawSignal.filter({ url: ansKey });
      if (existing.length === 0) {
        await base44.asServiceRole.entities.RawSignal.create({
          source: `sector_answer: ${q}`,
          content: res.answer.substring(0, 500),
          url: ansKey,
          signal_type: 'sector_review',
          platform: 'tavily_ai',
          sentiment: 'unknown',
          source_origin: 'tavily',
          freshness_score: 0.9,
          detected_at: new Date().toISOString(),
          linked_business: profile.id,
        });
        newSignalsSaved++;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PHASE 1 — AI-generated dynamic queries (broad web intelligence)
  // AI generates queries tailored to this specific business context.
  // ══════════════════════════════════════════════════════════════════════════════
  let dynamicQueries: string[] = [];
  try {
    const aiRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `אתה מומחה OSINT עסקי. צור שאילתות חיפוש מדויקות עבור:
עסק: "${name}" | קטגוריה: ${category} | עיר: ${city}
שירותים: ${relevant_services || 'לא צוין'}
מילות מפתח: ${custom_keywords || 'אין'}
מתחרים: ${competitorNames.join(', ') || 'אין'}
ידע ענפי: ${sectorInfo?.trending_services || 'אין'}

צור 8 שאילתות חיפוש מגוונות — כלול:
1. פורומים ישראליים (site:tapuz.co.il) עם שמות אמיתיים
2. חדשות ענפיות (site:calcalist.co.il OR site:ynet.co.il)
3. ביקורות ספציפיות על העסק ועל מתחרים
4. מגמות שוק עם שנה 2025 או 2026
5. שאלות שלקוחות שואלים בגוגל (כיצד, מה עדיף, כמה עולה)
כל שאילתה ממוקדת וכוללת את השנה (2025/2026).`,
      model: 'gemini_3_flash',
      add_context_from_internet: false,
      response_json_schema: {
        type: "object",
        properties: { queries: { type: "array", items: { type: "string" } } }
      }
    });
    dynamicQueries = (aiRes?.queries || []).slice(0, 8);
  } catch (err: any) {
    console.error('AI query generation failed:', err.message);
  }

  // Fallback queries if AI fails
  if (dynamicQueries.length < 4) {
    const fallback = [
      `"${name}" ביקורות חוות דעת ${city} 2025 site:tapuz.co.il OR site:ynet.co.il`,
      `${category} ${city} ביקורות 2026`,
      `${category} ${city} מתחרים חדשים 2025 2026`,
      `${category} ${city} טרנדים מגמות 2026`,
      `${category} הזדמנויות ישראל 2026 site:calcalist.co.il OR site:themarker.co.il`,
      `כמה עולה ${category} ${city} 2025 2026`,
    ];
    if (custom_keywords) {
      custom_keywords.split(',').map((k: string) => k.trim()).filter(Boolean).slice(0, 2)
        .forEach((kw: string) => fallback.push(`${kw} ${city} ${category} 2025 2026`));
    }
    competitorNames.slice(0, 2).forEach((c: string) =>
      fallback.push(`"${c}" ${category} ${city} ביקורות`)
    );
    dynamicQueries = [...dynamicQueries, ...fallback].slice(0, 8);
  }

  console.log(`[Phase 1] ${dynamicQueries.length} AI queries`);
  for (const query of dynamicQueries) {
    if (rateLimited) break;
    const res = await tavilySearch(query, { maxResults: 5, depth: 'advanced' });
    if ((res as any).rateLimited) { rateLimited = true; break; }
    totalResultsFound += (res.results || []).length;

    for (const r of res.results || []) await saveResult(r, `ai_query: ${query}`);

    if (res.answer && res.answer.length > 50) {
      const ansKey = `tavily_ans_p1_${query.slice(0, 40)}`;
      const existing = await base44.asServiceRole.entities.RawSignal.filter({ url: ansKey });
      if (existing.length === 0) {
        await base44.asServiceRole.entities.RawSignal.create({
          source: `tavily_answer: ${query}`,
          content: res.answer.substring(0, 500),
          url: ansKey,
          signal_type: 'web_search',
          platform: 'tavily_ai',
          sentiment: 'unknown',
          source_origin: 'tavily',
          freshness_score: 0.9,
          detected_at: new Date().toISOString(),
          linked_business: profile.id,
        });
        newSignalsSaved++;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PHASE 2 — Google Trends + Israeli business press
  // Fetches real trend data from Google Trends (via search) and Israeli
  // business publications (calcalist, themarker, globes).
  // ══════════════════════════════════════════════════════════════════════════════
  if (!rateLimited) {
    console.log(`[Phase 2] Google Trends + business press`);

    const phase2Queries = [
      // Google Trends-targeted queries
      { q: `${category} ישראל מגמה עולה 2025 2026 נתונים גידול`, domains: BUSINESS_PRESS },
      { q: `${category} israel google trends rising 2025 2026 statistics`, domains: null },
      { q: `${category} ישראל ביקוש עלייה נתוני שוק 2026`, domains: BUSINESS_PRESS },
      // Business press for sector news
      { q: `ענף ${category} ישראל 2025 2026 שוק צמיחה`, domains: BUSINESS_PRESS },
      { q: `${category} ${city} שינוי מחיר מגמה 2025 2026`, domains: [...sectorSites, ...BUSINESS_PRESS] },
      // What customers search for
      { q: `מה לקוחות מחפשים ${category} ישראל 2026`, domains: null },
    ];
    if (custom_keywords) {
      custom_keywords.split(',').map((k: string) => k.trim()).filter(Boolean).slice(0, 2)
        .forEach((kw: string) => phase2Queries.push({ q: `"${kw}" ישראל טרנד 2025 2026`, domains: BUSINESS_PRESS }));
    }

    for (const { q, domains } of phase2Queries) {
      if (rateLimited) break;
      const res = await tavilySearch(q, {
        maxResults: 4,
        depth: 'advanced',
        ...(domains ? { includeDomains: domains } : {}),
      });
      if ((res as any).rateLimited) { rateLimited = true; break; }
      totalResultsFound += (res.results || []).length;
      for (const r of res.results || []) await saveResult(r, `trend_press: ${q}`, 'trend_signal');
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PHASE 3 — Israeli forums + Facebook groups (community intelligence)
  // Searches tapuz.co.il and Facebook group conversations for authentic
  // local customer opinions and competitor mentions.
  // ══════════════════════════════════════════════════════════════════════════════
  if (!rateLimited) {
    console.log(`[Phase 3] Israeli forums + community`);

    const phase3Queries = [
      { q: `${category} ${city} המלצות 2025 site:tapuz.co.il`, domains: ISRAELI_FORUMS },
      { q: `${name} ביקורת חוות דעת site:tapuz.co.il OR site:facebook.com`, domains: null },
      { q: `${category} ${city} מחפש ממליץ site:facebook.com`, domains: ['facebook.com'] },
      { q: `${category} ${city} קבוצה המלצות לקוחות 2025`, domains: ['facebook.com', 'tapuz.co.il'] },
    ];
    if (competitorNames.length > 0) {
      phase3Queries.push({
        q: `"${competitorNames[0]}" חוות דעת ${city} site:tapuz.co.il OR site:facebook.com`,
        domains: null,
      });
    }

    for (const { q, domains } of phase3Queries) {
      if (rateLimited) break;
      const res = await tavilySearch(q, {
        maxResults: 4,
        depth: 'basic',
        ...(domains ? { includeDomains: domains } : {}),
      });
      if ((res as any).rateLimited) { rateLimited = true; break; }
      totalResultsFound += (res.results || []).length;
      for (const r of res.results || []) await saveResult(r, `community: ${q}`, 'social_mention');
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PHASE 4 — Custom URLs (Tavily extract)
  // ══════════════════════════════════════════════════════════════════════════════
  if (!rateLimited && custom_urls) {
    const urls = (custom_urls as string).split('\n').map((u: string) => u.trim()).filter((u: string) => u.startsWith('http'));
    for (const url of urls.slice(0, 5)) {
      try {
        const existing = await base44.asServiceRole.entities.RawSignal.filter({ url });
        if (existing.length > 0) { duplicatesSkipped++; continue; }

        const extractRes = await fetch('https://api.tavily.com/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: TAVILY_API_KEY, urls: [url] }),
        });
        if (extractRes.ok) {
          const data = await extractRes.json();
          const text = (data.results?.[0]?.raw_content || data.results?.[0]?.text || '').substring(0, 500);
          if (text.length > 30) {
            const freshScore = scoreFreshness(text, url);
            await base44.asServiceRole.entities.RawSignal.create({
              source: 'custom_url_extract',
              content: text,
              url,
              signal_type: 'custom_source',
              platform: 'website',
              sentiment: 'unknown',
              source_origin: 'tavily',
              freshness_score: freshScore,
              detected_at: new Date().toISOString(),
              linked_business: profile.id,
            });
            newSignalsSaved++;
          }
        }
      } catch (err: any) {
        console.error(`Phase 4 custom URL error "${url}":`, err.message);
      }
    }
  }

  console.log(`[collectWebSignals] Done: ${newSignalsSaved} saved, ${duplicatesSkipped} skipped, ${totalResultsFound} found`);

  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'collectWebSignals',
      start_time: startTime,
      end_time: new Date().toISOString(),
      status: rateLimited ? 'rate_limited' : 'success',
      items_processed: newSignalsSaved,
      linked_business: profile.id,
    });
  } catch (_) {}

  return Response.json({
    phases_run: rateLimited ? 'partial' : 4,
    total_results_found: totalResultsFound,
    new_signals_saved: newSignalsSaved,
    duplicates_skipped: duplicatesSkipped,
    rate_limited: rateLimited,
    sector_sites_used: sectorSites,
  });
});
