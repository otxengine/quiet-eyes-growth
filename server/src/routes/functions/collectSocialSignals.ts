import { Request, Response } from 'express';
import { writeAutomationLog } from '../../lib/automationLog';
import { prisma } from '../../db';
import { loadBusinessContext } from '../../lib/businessContext';

const APIFY_API_KEY = process.env.APIFY_API_KEY || '';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

async function runApifyActor(actorId: string, input: any, maxWaitMs = 90_000): Promise<any[]> {
  if (!APIFY_API_KEY) return [];
  try {
    // Start the actor run
    const startRes = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs?token=${APIFY_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!startRes.ok) {
      console.warn(`[Apify] ${actorId} start failed: ${startRes.status}`);
      return [];
    }
    const runData: any = await startRes.json();
    const runId = runData?.data?.id;
    if (!runId) return [];

    // Poll for completion (max maxWaitMs, 5s intervals)
    const maxPolls = Math.floor(maxWaitMs / 5000);
    for (let i = 0; i < maxPolls; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`);
      const statusData: any = await statusRes.json();
      const status = statusData?.data?.status;
      if (status === 'SUCCEEDED') {
        const datasetId = statusData?.data?.defaultDatasetId;
        const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}&limit=50`);
        const items: any = await itemsRes.json();
        return Array.isArray(items) ? items : [];
      }
      if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
        console.warn(`[Apify] ${actorId} run ${runId} ended with ${status}`);
        return [];
      }
    }
    console.warn(`[Apify] ${actorId} polling timed out after ${maxWaitMs}ms`);
    return [];
  } catch (e: any) {
    console.warn(`[Apify] ${actorId} exception:`, e.message);
    return [] as any[];
  }
}

async function tavilySearch(query: string): Promise<any[]> {
  if (!TAVILY_API_KEY) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, search_depth: 'basic', max_results: 5 }),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return data.results || [];
  } catch { return []; }
}

export async function collectSocialSignals(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city, facebook_url, instagram_url } = profile;
    const existingSignals = await prisma.rawSignal.findMany({ where: { linked_business: businessProfileId } });
    const existingUrls = new Set(existingSignals.map(s => s.url).filter(Boolean));

    let newSignals = 0;

    // ── Facebook via Apify ──────────────────────────────────────────────────────
    if (APIFY_API_KEY && facebook_url) {
      const posts = await runApifyActor('apify~facebook-posts-scraper', {
        startUrls: [{ url: facebook_url }],
        maxPosts: 10,
        maxPostComments: 0,
      });

      for (const post of posts) {
        const url = post.url || post.postUrl || facebook_url;
        if (existingUrls.has(url)) continue;
        const content = (post.text || post.message || post.story || '').substring(0, 500);
        if (!content) continue;

        await prisma.rawSignal.create({
          data: {
            source: `facebook: ${name}`,
            content,
            url,
            signal_type: 'social_post',
            platform: 'facebook',
            source_origin: 'apify',
            detected_at: new Date().toISOString(),
            linked_business: businessProfileId,
          },
        });
        existingUrls.add(url);
        newSignals++;
      }
    }

    // ── Instagram via Apify ─────────────────────────────────────────────────────
    if (APIFY_API_KEY && instagram_url) {
      const posts = await runApifyActor('apify~instagram-scraper', {
        directUrls: [instagram_url],
        resultsType: 'posts',
        resultsLimit: 10,
      });

      for (const post of posts) {
        const url = post.url || (post.shortCode ? `https://www.instagram.com/p/${post.shortCode}/` : null);
        if (!url || existingUrls.has(url)) continue;
        const content = (post.caption || post.alt || '').substring(0, 500);
        if (!content) continue;

        await prisma.rawSignal.create({
          data: {
            source: `instagram: ${name}`,
            content,
            url,
            signal_type: 'social_post',
            platform: 'instagram',
            source_origin: 'apify',
            detected_at: new Date().toISOString(),
            linked_business: businessProfileId,
          },
        });
        existingUrls.add(url);
        newSignals++;
      }
    }

    // ── Instagram hashtag search (sector + city, no account needed) ──────────
    if (APIFY_API_KEY) {
      const hebrewCity: Record<string, string> = {
        'תל אביב': 'telaviv', 'ירושלים': 'jerusalem', 'חיפה': 'haifa',
        'בני ברק': 'bneibrak', 'ראשון לציון': 'rishonlezion', 'נתניה': 'netanya',
        'זכרון יעקב': 'zikhronyaakov',
      };
      const cityTag = hebrewCity[city] || city.replace(/\s+/g, '').toLowerCase();
      const sectorTag = category === 'מסעדה' ? 'מסעדה' : category === 'fitness' ? 'כושר' : category;
      const hashtags = [`#${sectorTag}${cityTag}`, `#${cityTag}אוכל`, `#${name.replace(/\s/g,'')}`];

      const igPosts = await runApifyActor('apify~instagram-hashtag-scraper', {
        hashtags: hashtags.slice(0, 2),
        resultsLimit: 15,
      });

      for (const post of igPosts) {
        const url = post.url || (post.shortCode ? `https://www.instagram.com/p/${post.shortCode}/` : null);
        if (!url || existingUrls.has(url)) continue;
        const content = (post.caption || post.alt || '').substring(0, 500);
        if (!content) continue;
        await prisma.rawSignal.create({
          data: {
            source: `instagram_hashtag: ${hashtags[0]}`,
            content,
            url,
            signal_type: 'social_mention',
            platform: 'instagram',
            source_origin: 'apify',
            detected_at: new Date().toISOString(),
            linked_business: businessProfileId,
          },
        });
        existingUrls.add(url);
        newSignals++;
      }
    }

    // Tavily social fallback — search mentions on social platforms
    const socialQueries = [
      `"${name}" site:facebook.com OR site:instagram.com`,
      `"${name}" ${category} ${city} אזכורים`,
    ];

    for (const query of socialQueries) {
      const results = await tavilySearch(query);
      for (const r of results) {
        if (!r.url || existingUrls.has(r.url)) continue;
        const isSocial = ['facebook.com', 'instagram.com', 'tiktok.com', 'twitter.com'].some(d => r.url.includes(d));
        if (!isSocial) continue;

        await prisma.rawSignal.create({
          data: {
            source: `tavily_social: ${query}`,
            content: (r.content || r.title || '').substring(0, 500),
            url: r.url,
            signal_type: 'social_mention',
            platform: r.url.includes('facebook') ? 'facebook' : r.url.includes('instagram') ? 'instagram' : 'social',
            source_origin: 'tavily',
            detected_at: new Date().toISOString(),
            linked_business: businessProfileId,
          },
        });
        existingUrls.add(r.url);
        newSignals++;
      }
    }

    // Phase 3: Competitor mention scanning + intent queries
    let phase3Signals = 0;
    const competitors = await prisma.competitor.findMany({ where: { linked_business: businessProfileId }, take: 5 });
    const competitorNames = competitors.map((c: any) => c.name).filter(Boolean);

    const phase3Queries: string[] = [
      `"${name}" ביקורת חוות דעת ${city}`,
      `${category} ${city} "מחפש" OR "ממליצים"`,
      `${category} ${city} "מי מכיר" OR "מישהו מכיר"`,
      `"${name}" site:facebook.com OR site:instagram.com OR site:maps.google.com`,
      `${category} ${city} המלצה קבוצה`,
      `${category} ${city} פנייה שירות`,
    ];
    for (const compName of competitorNames.slice(0, 2)) {
      phase3Queries.push(`"${compName}" בעיה תקלה מאוכזב`);
    }

    for (const query of phase3Queries) {
      const results = await tavilySearch(query);
      for (const r of results) {
        if (!r.url || existingUrls.has(r.url)) continue;
        const content = (r.content || r.title || '').substring(0, 500);
        const urlLower = r.url.toLowerCase();
        const platform = urlLower.includes('facebook') ? 'facebook'
          : urlLower.includes('instagram') ? 'instagram'
          : urlLower.includes('google') ? 'google_maps'
          : 'web';
        const mentionsBusiness = content.toLowerCase().includes(name.toLowerCase());
        const signal_type = mentionsBusiness ? 'social_review' : 'social_mention';
        await prisma.rawSignal.create({
          data: {
            source: `tavily_p3: ${query}`,
            content,
            url: r.url,
            signal_type,
            platform,
            source_origin: 'tavily',
            detected_at: new Date().toISOString(),
            linked_business: businessProfileId,
          },
        });
        existingUrls.add(r.url);
        newSignals++;
        phase3Signals++;
      }
    }
    console.log(`Phase 3: ${phase3Signals} new signals`);

    // Load business context for personalized response templates
    const bizCtx = await loadBusinessContext(businessProfileId);
    const bTone = bizCtx?.preferredTone || 'professional';

    // ── Post-process: surface negative social mentions as actionable MarketSignals ──
    const NEGATIVE_KEYWORDS = [
      'גרוע', 'איום', 'נורא', 'מאכזב', 'disappointed', 'terrible', 'worst', 'awful',
      'שירות גרוע', 'לא שווה', 'לא מומלץ', 'זמן המתנה', 'קר', 'מלוכלך', 'בעיה', 'תקלה',
    ];

    const recentSignals = await prisma.rawSignal.findMany({
      where: {
        linked_business: businessProfileId,
        signal_type: { in: ['social_review', 'social_mention'] },
        detected_at: { gte: new Date(Date.now() - 48 * 3600000).toISOString() },
      },
      take: 20,
    });

    let negativeSignalsFound = 0;
    for (const sig of recentSignals) {
      const content = (sig.content || '').toLowerCase();
      const isNegative = NEGATIVE_KEYWORDS.some(kw => content.includes(kw.toLowerCase()));
      if (!isNegative) continue;

      // Check we haven't already created a signal from this URL
      const exists = await prisma.marketSignal.count({
        where: { linked_business: businessProfileId, source_signals: { contains: sig.url || '' } },
      }).catch(() => 1);
      if (exists > 0 || !sig.url) continue;

      const snippet = (sig.content || '').slice(0, 100);
      const platformLabel = sig.platform === 'facebook' ? 'פייסבוק' : sig.platform === 'instagram' ? 'אינסטגרם' : 'רשת חברתית';
      const dmChannel = sig.platform === 'facebook' ? 'פייסבוק מסנג\'ר' : 'DM';

      // Personalize response template based on learned business tone
      const responseTemplate = bTone === 'casual'
        ? `היי! מצטערים לשמוע 🙏 ניצור קשר אישית לפתרון. ${name}`
        : bTone === 'warm'
        ? `שלום, מצטערים מאוד על החוויה. חשוב לנו מאוד לפתור את הבעיה — נשמח אם תפנה אלינו ישירות ב${dmChannel}. ${name}`
        : `שלום, תודה שפנית אלינו. אנחנו מצטערים לשמוע על חוויתך ונשמח ליצור קשר ולפתור את הבעיה. נא פנה אלינו ב${dmChannel} או בטלפון. צוות ${name}`;

      await prisma.marketSignal.create({
        data: {
          summary: `ביקורת שלילית ב${platformLabel}: "${snippet}..."`,
          category: 'mention',
          impact_level: 'high',
          recommended_action: 'הגב לביקורת',
          source_description: JSON.stringify({
            action_label:  `הגב ב${platformLabel}`,
            action_type:   'respond',
            prefilled_text: responseTemplate,
            time_minutes:   5,
            urgency_hours:  4,
            impact_reason:  'ביקורת שלילית ללא תגובה פוגעת בדירוג ובאמון לקוחות פוטנציאליים',
          }),
          source_signals: sig.url || '',
          confidence: 80,
          is_read: false,
          linked_business: businessProfileId,
          detected_at: new Date().toISOString(),
        },
      }).catch(() => {});
      negativeSignalsFound++;
    }

    await writeAutomationLog('collectSocialSignals', businessProfileId, startTime, newSignals);
    console.log(`collectSocialSignals done: ${newSignals} new signals, ${negativeSignalsFound} negative → MarketSignal`);
    return res.json({ new_signals: newSignals, phase3_signals: phase3Signals, negative_alerts: negativeSignalsFound });
  } catch (err: any) {
    console.error('collectSocialSignals error:', err.message);
    await writeAutomationLog('collectSocialSignals', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
