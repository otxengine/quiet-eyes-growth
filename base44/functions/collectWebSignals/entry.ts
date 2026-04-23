import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const TAVILY_API_KEY = Deno.env.get("TAVILY_API_KEY");

async function tavilySearch(query, options = {}) {
  const body = {
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
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Tavily API error (${res.status}): ${err}`);
    return { results: [], answer: '' };
  }
  const data = await res.json();
  console.log(`[Tavily] Got ${data.results?.length || 0} results for: "${query}"`);
  return data;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const startTime = new Date().toISOString();

  if (!TAVILY_API_KEY) {
    console.error('TAVILY_API_KEY not set');
    return Response.json({ error: 'TAVILY_API_KEY not configured', new_signals_saved: 0 }, { status: 500 });
  }

  // Resolve business profile
  let profile;
  if (body.businessProfileId) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all.find(p => p.id === body.businessProfileId);
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

  const { name, category, city, full_address, relevant_services, custom_keywords, custom_urls } = profile;
  const locationContext = full_address || city;

  // Fetch context
  const [competitors, sectorKnowledge] = await Promise.all([
    base44.asServiceRole.entities.Competitor.filter({ linked_business: profile.id }),
    base44.asServiceRole.entities.SectorKnowledge.filter({}),
  ]);
  const competitorNames = competitors.slice(0, 5).map(c => c.name);
  const sectorInfo = sectorKnowledge.find(s => s.sector === category && s.region === city) || sectorKnowledge.find(s => s.sector === category) || null;

  // Generate search queries with AI
  const queryGenPrompt = `אתה מומחה OSINT עסקי. צור רשימת שאילתות חיפוש מדויקות עבור:
עסק: "${name}" | קטגוריה: ${category} | עיר: ${city}
שירותים: ${relevant_services || 'לא צוין'}
מילות מפתח מותאמות: ${custom_keywords || 'אין'}
מתחרים ידועים: ${competitorNames.join(', ') || 'אין'}
מידע סקטוריאלי: ${sectorInfo?.trending_services || 'אין'}

צור בדיוק 10 שאילתות חיפוש שונות ומגוונות. כלול: ביקורות, פורומים, חדשות ענפיות, מהלכי מתחרים, טרנדים, הזדמנויות. כל שאילתה ספציפית וממוקדת.`;

  let dynamicQueries = [];
  try {
    const aiQueries = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: queryGenPrompt,
      model: 'gemini_3_flash',
      add_context_from_internet: false,
      response_json_schema: {
        type: "object",
        properties: { queries: { type: "array", items: { type: "string" } } }
      }
    });
    dynamicQueries = (aiQueries?.queries || []).slice(0, 10);
  } catch (err) {
    console.error('AI query generation failed:', err.message);
  }

  // Fallback
  if (dynamicQueries.length < 5) {
    const fallback = [
      `"${name}" ביקורות חוות דעת ${city}`,
      `${category} ${city} ביקורות 2026`,
      `${category} ${city} מתחרים חדשים`,
      `${category} ${city} טרנדים 2026`,
      `${category} הזדמנויות עסקיות ${city}`,
    ];
    if (custom_keywords) {
      custom_keywords.split(',').map(k => k.trim()).filter(Boolean).slice(0, 2).forEach(kw => {
        fallback.push(`${kw} ${city} ${category}`);
      });
    }
    competitorNames.slice(0, 2).forEach(c => fallback.push(`"${c}" ${category} ${city}`));
    dynamicQueries = [...dynamicQueries, ...fallback].slice(0, 10);
  }

  console.log(`[collectWebSignals] Tavily search with ${dynamicQueries.length} queries`);

  let totalResultsFound = 0;
  let newSignalsSaved = 0;
  let duplicatesSkipped = 0;

  // Run all Tavily searches
  for (const query of dynamicQueries) {
    try {
      const tavilyResult = await tavilySearch(query, { maxResults: 5, depth: 'advanced' });
      const results = tavilyResult.results || [];
      totalResultsFound += results.length;

      for (const result of results) {
        if (!result.url || result.url.length < 10) continue;
        if (result.url.includes('google.com/search') || result.url.includes('bing.com/search')) continue;

        // Check for duplicates
        const existing = await base44.asServiceRole.entities.RawSignal.filter({ url: result.url });
        if (existing.length > 0) { duplicatesSkipped++; continue; }

        // Use content from Tavily
        const content = result.content || result.title || '';
        if (!content || content.length < 20) continue;

        // Detect platform
        let platform = 'website';
        const urlLower = result.url.toLowerCase();
        if (urlLower.includes('facebook.com') || urlLower.includes('fb.com')) platform = 'facebook';
        else if (urlLower.includes('instagram.com')) platform = 'instagram';
        else if (urlLower.includes('tiktok.com')) platform = 'tiktok';
        else if (urlLower.includes('google.com/maps') || urlLower.includes('google.co.il')) platform = 'google';
        else if (urlLower.includes('reddit.com') || urlLower.includes('forum')) platform = 'forum';

        // Determine signal type
        let signalType = 'web_search';
        if (platform === 'facebook' || platform === 'instagram' || platform === 'tiktok') signalType = 'social_mention';

        const finalContent = (content || result.title || '').substring(0, 500);

        await base44.asServiceRole.entities.RawSignal.create({
          source: `tavily: ${query}`,
          content: finalContent,
          url: result.url,
          signal_type: signalType,
          platform,
          sentiment: "unknown",
          source_origin: 'tavily',
          detected_at: new Date().toISOString(),
          linked_business: profile.id,
        });
        newSignalsSaved++;
      }

      // Save Tavily's AI answer as a signal if relevant
      if (tavilyResult.answer && tavilyResult.answer.length > 50) {
        await base44.asServiceRole.entities.RawSignal.create({
          source: `tavily_answer: ${query}`,
          content: tavilyResult.answer.substring(0, 500),
          url: '',
          signal_type: 'web_search',
          platform: 'tavily_ai',
          sentiment: 'unknown',
          source_origin: 'tavily',
          detected_at: new Date().toISOString(),
          linked_business: profile.id,
        });
        newSignalsSaved++;
      }
    } catch (err) {
      console.error(`Tavily error on query "${query}":`, err.message);
    }
  }

  // Custom URLs scanning via Tavily extract
  if (custom_urls) {
    const urls = custom_urls.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));
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
          const extractData = await extractRes.json();
          const pageContent = extractData.results?.[0]?.raw_content || extractData.results?.[0]?.text || '';
          if (pageContent.length > 30) {
            await base44.asServiceRole.entities.RawSignal.create({
              source: 'custom_url_tavily',
              content: pageContent.substring(0, 500),
              url,
              signal_type: 'custom_source',
              platform: 'website',
              sentiment: 'unknown',
              source_origin: 'tavily',
              detected_at: new Date().toISOString(),
              linked_business: profile.id,
            });
            newSignalsSaved++;
          }
        }
      } catch (err) {
        console.error(`Custom URL extract error "${url}":`, err.message);
      }
    }
  }

  console.log(`[collectWebSignals] Tavily complete: ${newSignalsSaved} new, ${duplicatesSkipped} dupes, ${totalResultsFound} total results`);

  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'collectWebSignals',
      start_time: startTime,
      end_time: new Date().toISOString(),
      status: 'success',
      items_processed: newSignalsSaved,
      linked_business: profile.id,
    });
  } catch (_) {}

  return Response.json({ total_searches: dynamicQueries.length, total_results_found: totalResultsFound, new_signals_saved: newSignalsSaved, duplicates_skipped: duplicatesSkipped });
});