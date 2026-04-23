import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const TAVILY_API_KEY = Deno.env.get("TAVILY_API_KEY");
const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");

// Run an Apify actor and wait for results
async function runApifyActor(actorId, input) {
  const runRes = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs?token=${APIFY_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!runRes.ok) {
    const err = await runRes.text();
    console.error(`Apify run error for ${actorId}: ${err}`);
    return [];
  }
  const runData = await runRes.json();
  const datasetId = runData.data?.defaultDatasetId;
  if (!datasetId) return [];

  // Wait for run to finish (poll status)
  const runId = runData.data?.id;
  let attempts = 0;
  while (attempts < 30) {
    await new Promise(r => setTimeout(r, 5000));
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`);
    if (statusRes.ok) {
      const statusData = await statusRes.json();
      const status = statusData.data?.status;
      if (status === 'SUCCEEDED') break;
      if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
        console.error(`Apify run ${actorId} ended with status: ${status}`);
        return [];
      }
    }
    attempts++;
  }

  // Fetch results
  const dataRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}&limit=20`);
  if (!dataRes.ok) return [];
  return await dataRes.json();
}

// Tavily search helper
async function tavilySearch(query, maxResults = 5) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      search_depth: 'advanced',
      max_results: maxResults,
      include_answer: false,
      include_domains: ['facebook.com', 'instagram.com', 'tiktok.com', 'reddit.com', 'twitter.com', 'x.com'],
    }),
  });
  if (!res.ok) {
    console.error(`Tavily social search error: ${await res.text()}`);
    return [];
  }
  const data = await res.json();
  return data.results || [];
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const startTime = new Date().toISOString();

  if (!TAVILY_API_KEY && !APIFY_API_KEY) {
    return Response.json({ error: 'No API keys configured (TAVILY/APIFY)', new_signals: 0 }, { status: 500 });
  }

  // Resolve business profile
  let profile;
  if (body.businessProfileId) {
    const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({ id: body.businessProfileId });
    profile = profiles[0];
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
    return Response.json({ error: 'No business profile found', new_signals: 0 }, { status: 404 });
  }

  const { name, category, city, channels_facebook, channels_instagram, channels_tiktok, facebook_url, instagram_url, tiktok_url, custom_keywords, custom_urls, monitor_competitors_social, relevant_services } = profile;

  const [competitors] = await Promise.all([
    base44.asServiceRole.entities.Competitor.filter({ linked_business: profile.id }),
  ]);
  const competitorNames = competitors.slice(0, 5).map(c => c.name);

  let newSignals = 0;
  let duplicatesSkipped = 0;

  // === PHASE 1: Apify scraping for connected social accounts ===
  if (APIFY_API_KEY) {
    console.log('[collectSocialSignals] Phase 1: Apify scraping');

    // Facebook page scraping
    const fbPage = channels_facebook || facebook_url;
    if (fbPage) {
      try {
        console.log(`Scraping Facebook: ${fbPage}`);
        const fbUrl = fbPage.startsWith('http') ? fbPage : `https://www.facebook.com/${fbPage}`;
        const fbResults = await runApifyActor('apify/facebook-pages-scraper', {
          startUrls: [{ url: fbUrl }],
          resultsLimit: 15,
        });
        for (const post of fbResults) {
          const postUrl = post.url || post.postUrl || '';
          const postId = post.postId || post.id || postUrl;
          if (!postId) continue;

          const existing = await base44.asServiceRole.entities.RawSignal.filter({ url: postUrl || `fb_${postId}` });
          if (existing.length > 0) { duplicatesSkipped++; continue; }

          const content = (post.text || post.message || '').substring(0, 450);
          const engagement = `👍${post.likes || 0} 💬${post.comments || 0} 🔄${post.shares || 0}`;

          await base44.asServiceRole.entities.RawSignal.create({
            source: 'apify_facebook',
            content: content ? `${content} [${engagement}]` : `פוסט פייסבוק [${engagement}]`,
            url: postUrl || `fb_${postId}`,
            signal_type: 'social_mention',
            platform: 'facebook',
            sentiment: 'unknown',
            source_origin: 'apify',
            detected_at: post.time || new Date().toISOString(),
            linked_business: profile.id,
          });
          newSignals++;
        }
      } catch (err) {
        console.error('Apify Facebook error:', err.message);
      }
    }

    // Instagram scraping
    const igUser = channels_instagram || instagram_url;
    if (igUser) {
      try {
        const username = igUser.replace(/https?:\/\/(www\.)?instagram\.com\//, '').replace(/\//g, '').replace('@', '');
        console.log(`Scraping Instagram: ${username}`);
        const igResults = await runApifyActor('apify/instagram-scraper', {
          username: [username],
          resultsLimit: 15,
        });
        for (const post of igResults) {
          const postUrl = post.url || post.shortCode ? `https://instagram.com/p/${post.shortCode}` : '';
          const postId = post.id || post.shortCode || postUrl;
          if (!postId) continue;

          const existing = await base44.asServiceRole.entities.RawSignal.filter({ url: postUrl || `ig_${postId}` });
          if (existing.length > 0) { duplicatesSkipped++; continue; }

          const content = (post.caption || '').substring(0, 450);
          const engagement = `❤️${post.likesCount || 0} 💬${post.commentsCount || 0}`;

          await base44.asServiceRole.entities.RawSignal.create({
            source: 'apify_instagram',
            content: content ? `${content} [${engagement}]` : `פוסט אינסטגרם [${engagement}]`,
            url: postUrl || `ig_${postId}`,
            signal_type: 'social_mention',
            platform: 'instagram',
            sentiment: 'unknown',
            source_origin: 'apify',
            detected_at: post.timestamp || new Date().toISOString(),
            linked_business: profile.id,
          });
          newSignals++;
        }
      } catch (err) {
        console.error('Apify Instagram error:', err.message);
      }
    }

    // TikTok scraping
    const ttUser = channels_tiktok || tiktok_url;
    if (ttUser) {
      try {
        const username = ttUser.replace(/https?:\/\/(www\.)?tiktok\.com\/@?/, '').replace(/\//g, '').replace('@', '');
        console.log(`Scraping TikTok: ${username}`);
        const ttResults = await runApifyActor('clockworks~free-tiktok-scraper', {
          profiles: [username],
          resultsPerPage: 15,
          shouldDownloadVideos: false,
        });
        for (const video of ttResults) {
          const videoUrl = video.webVideoUrl || video.url || '';
          const videoId = video.id || videoUrl;
          if (!videoId) continue;

          const existing = await base44.asServiceRole.entities.RawSignal.filter({ url: videoUrl || `tt_${videoId}` });
          if (existing.length > 0) { duplicatesSkipped++; continue; }

          const content = (video.text || video.desc || '').substring(0, 450);
          const engagement = `❤️${video.diggCount || video.likes || 0} 💬${video.commentCount || video.comments || 0} 🔄${video.shareCount || video.shares || 0} 👀${video.playCount || video.views || 0}`;

          await base44.asServiceRole.entities.RawSignal.create({
            source: 'apify_tiktok',
            content: content ? `${content} [${engagement}]` : `סרטון טיקטוק [${engagement}]`,
            url: videoUrl || `tt_${videoId}`,
            signal_type: 'social_mention',
            platform: 'tiktok',
            sentiment: 'unknown',
            source_origin: 'apify',
            detected_at: video.createTime ? new Date(video.createTime * 1000).toISOString() : new Date().toISOString(),
            linked_business: profile.id,
          });
          newSignals++;
        }
      } catch (err) {
        console.error('Apify TikTok error:', err.message);
      }
    }

    // Competitor social monitoring
    if (monitor_competitors_social !== false) {
      for (const comp of competitors.slice(0, 3)) {
        try {
          // Search for competitor social presence via Tavily
          if (TAVILY_API_KEY) {
            const compResults = await tavilySearch(`"${comp.name}" ${category} ${city} site:facebook.com OR site:instagram.com`, 3);
            for (const result of compResults) {
              if (!result.url) continue;
              const existing = await base44.asServiceRole.entities.RawSignal.filter({ url: result.url });
              if (existing.length > 0) { duplicatesSkipped++; continue; }

              await base44.asServiceRole.entities.RawSignal.create({
                source: `competitor_social: ${comp.name}`,
                content: (result.content || result.title || '').substring(0, 500),
                url: result.url,
                signal_type: 'competitor_social',
                platform: result.url.includes('facebook') ? 'facebook' : result.url.includes('instagram') ? 'instagram' : 'website',
                sentiment: 'unknown',
                source_origin: 'tavily',
                detected_at: new Date().toISOString(),
                linked_business: profile.id,
              });
              newSignals++;
            }
          }
        } catch (err) {
          console.error(`Competitor social scan error (${comp.name}):`, err.message);
        }
      }
    }
  }

  // === PHASE 2: Tavily social-focused web search ===
  if (TAVILY_API_KEY) {
    console.log('[collectSocialSignals] Phase 2: Tavily social search');

    const socialQueries = [
      `"${name}" ביקורות חוות דעת רשתות חברתיות ${city}`,
      `${category} ${city} טרנדים רשתות חברתיות 2026`,
      `${category} ${city} קבוצות פייסבוק המלצות`,
      `#${category.replace(/\s/g, '')} ${city} אינסטגרם`,
      `${category} ישראל טיקטוק ויראלי 2026`,
    ];

    if (custom_keywords) {
      custom_keywords.split(',').map(k => k.trim()).filter(Boolean).slice(0, 2).forEach(kw => {
        socialQueries.push(`${kw} ${city} רשתות חברתיות`);
      });
    }

    for (const query of socialQueries) {
      try {
        const results = await tavilySearch(query, 3);
        for (const result of results) {
          if (!result.url || result.url.length < 10) continue;

          const existing = await base44.asServiceRole.entities.RawSignal.filter({ url: result.url });
          if (existing.length > 0) { duplicatesSkipped++; continue; }

          let platform = 'website';
          const urlLower = result.url.toLowerCase();
          if (urlLower.includes('facebook.com')) platform = 'facebook';
          else if (urlLower.includes('instagram.com')) platform = 'instagram';
          else if (urlLower.includes('tiktok.com')) platform = 'tiktok';
          else if (urlLower.includes('reddit.com') || urlLower.includes('forum')) platform = 'forum';

          await base44.asServiceRole.entities.RawSignal.create({
            source: `tavily_social: ${query}`,
            content: (result.content || result.title || '').substring(0, 500),
            url: result.url,
            signal_type: 'social_mention',
            platform,
            sentiment: 'unknown',
            source_origin: 'tavily',
            detected_at: new Date().toISOString(),
            linked_business: profile.id,
          });
          newSignals++;
        }
      } catch (err) {
        console.error(`Tavily social search error "${query}":`, err.message);
      }
    }
  }

  // Custom URLs scanning
  if (custom_urls && TAVILY_API_KEY) {
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
          const data = await extractRes.json();
          const text = data.results?.[0]?.raw_content || data.results?.[0]?.text || '';
          if (text.length > 30) {
            await base44.asServiceRole.entities.RawSignal.create({
              source: 'custom_url_tavily',
              content: text.substring(0, 500),
              url,
              signal_type: 'custom_source',
              platform: 'website',
              sentiment: 'unknown',
              source_origin: 'tavily',
              detected_at: new Date().toISOString(),
              linked_business: profile.id,
            });
            newSignals++;
          }
        }
      } catch (err) {
        console.error(`Custom URL error "${url}":`, err.message);
      }
    }
  }

  // === PHASE 3: Search for reviews and mentions about the business ===
  if (TAVILY_API_KEY) {
    console.log('[collectSocialSignals] Phase 3: Scanning for external mentions and reviews');

    const competitorsList = await base44.asServiceRole.entities.Competitor.filter({ linked_business: profile.id });
    const competitorNames = competitorsList.map((c: any) => c.name).filter(Boolean);

    const mentionQueries = [
      `"${name}" ביקורת חוות דעת ${city} site:facebook.com`,
      `"${name}" המלצות אינסטגרם ${category}`,
      `${category} ${city} ממליצים קבוצה פייסבוק`,
      `${category} ${city} מחפש מישהו יודע site:facebook.com`,
      `"${name}" site:facebook.com OR site:instagram.com`,
      ...competitorNames.slice(0, 2).map((c: string) =>
        `"${c}" שלילי מאכזב גרוע ${city} site:facebook.com OR site:instagram.com`
      ),
    ].filter(Boolean);

    for (const query of mentionQueries) {
      try {
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: TAVILY_API_KEY,
            query,
            search_depth: 'basic',
            max_results: 4,
            include_answer: false,
          }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        const results = data.results || [];

        for (const result of results) {
          if (!result.url || result.url.length < 10) continue;

          const existing = await base44.asServiceRole.entities.RawSignal.filter({ url: result.url });
          if (existing.length > 0) { duplicatesSkipped++; continue; }

          const content = (result.content || result.title || '').substring(0, 500);
          if (!content || content.length < 15) continue;

          const isAboutBusiness = content.includes(name) ||
            (result.url.includes('facebook.com') && content.length > 30);

          const urlLower = result.url.toLowerCase();
          let platform = 'website';
          if (urlLower.includes('facebook.com')) platform = 'facebook';
          else if (urlLower.includes('instagram.com')) platform = 'instagram';
          else if (urlLower.includes('tiktok.com')) platform = 'tiktok';
          else if (urlLower.includes('google.com/maps') || urlLower.includes('google.co.il')) platform = 'google_maps';
          else if (urlLower.includes('tapuz') || urlLower.includes('forum') || urlLower.includes('reddit')) platform = 'forum';

          const signalType = isAboutBusiness ? 'social_review' : 'social_mention';

          await base44.asServiceRole.entities.RawSignal.create({
            source: `social_scan: ${query.substring(0, 60)}`,
            content,
            url: result.url,
            signal_type: signalType,
            platform,
            sentiment: 'unknown',
            source_origin: 'tavily',
            detected_at: new Date().toISOString(),
            linked_business: profile.id,
          });
          newSignals++;
        }
      } catch (err: any) {
        console.error(`Phase 3 mention scan error "${query}":`, err.message);
      }
    }
    console.log(`[collectSocialSignals] Phase 3 complete: ${newSignals} total signals`);
  }

  console.log(`[collectSocialSignals] Complete: ${newSignals} new, ${duplicatesSkipped} dupes`);

  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'collectSocialSignals',
      start_time: startTime,
      end_time: new Date().toISOString(),
      status: 'success',
      items_processed: newSignals,
      linked_business: profile.id,
    });
  } catch (_) {}

  return Response.json({ new_signals: newSignals, duplicates_skipped: duplicatesSkipped });
});