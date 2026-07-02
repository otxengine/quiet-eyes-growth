import { Request, Response } from 'express';
import { writeAutomationLog } from '../../lib/automationLog';
import { prisma } from '../../db';
import { loadBusinessContext } from '../../lib/businessContext';
import { invokeLLM, startCostTracking, popCost } from '../../lib/llm';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { tryDecryptToken } from '../../lib/crypto';
import { parseKeywords, buildUrlQueries } from '../../lib/dataSources';
import { getSectorProfile, cityToEn } from '../../lib/businessProfile';
import { normSignalType, normRawOrigin } from '../../lib/signalGuard';

// Dummy res that swallows output — used when firing sub-agents inline
const GRAPH_BASE = 'https://graph.facebook.com/v19.0';
const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours — Apify calls are expensive

export async function collectSocialSignals(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (shouldSkipAgent(businessProfileId, 'collectSocialSignals', MIN_INTERVAL_MS)) {
    await writeAutomationLog('collectSocialSignals', businessProfileId, new Date().toISOString(), 0, 'success', 'ran_recently');
    return res.json({ new_signals: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  startCostTracking(businessProfileId);
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city } = profile;
    const facebook_url: string | null  = (profile as any).facebook_url  || null;
    const instagram_url: string | null = (profile as any).instagram_url || null;
    console.log(`[collectSocialSignals] settings → facebook_url=${facebook_url || 'none'} instagram_url=${instagram_url || 'none'} apify=${hasApifyKey()}`);
    const existingSignals = await prisma.rawSignal.findMany({ where: { linked_business: businessProfileId } });
    const existingUrls = new Set(existingSignals.map(s => s.url).filter(Boolean));

    let newSignals = 0;
    let apifyError: string | undefined;

    // ── Facebook via Apify ──────────────────────────────────────────────────────
    if (hasApifyKey() && facebook_url) {
      const posts = await runApifyActor('apify~facebook-posts-scraper', {
        startUrls: [{ url: facebook_url }],
        maxPosts: 10,
        maxPostComments: 0,
      }, 90_000, 50, (msg) => { apifyError = msg; });

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
            signal_type: normSignalType('social_mention', 'collectSocialSignals:facebook'),
            platform: 'facebook',
            source_origin: normRawOrigin('apify', 'collectSocialSignals:facebook'),
            detected_at: new Date().toISOString(),
            linked_business: businessProfileId,
          },
        });
        existingUrls.add(url);
        newSignals++;
      }
    }

    // ── Instagram via Apify ─────────────────────────────────────────────────────
    if (hasApifyKey() && instagram_url) {
      const posts = await runApifyActor('apify~instagram-scraper', {
        directUrls: [instagram_url],
        resultsType: 'posts',
        resultsLimit: 10,
      }, 90_000, 50, (msg) => { apifyError = msg; });

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
            signal_type: normSignalType('social_mention', 'collectSocialSignals:instagram'),
            platform: 'instagram',
            source_origin: normRawOrigin('apify', 'collectSocialSignals:instagram'),
            detected_at: new Date().toISOString(),
            linked_business: businessProfileId,
          },
        });
        existingUrls.add(url);
        newSignals++;
      }
    }

    // ── Instagram Graph API — sector hashtag search ──────────────────────────
    // Uses the connected IG Business account to search trending posts by hashtag
    const igAccount = await prisma.socialAccount.findFirst({
      where: { linked_business: businessProfileId, platform: 'instagram_business', is_connected: true },
    });
    if (igAccount?.access_token && igAccount?.page_id) {
      const igUserId = igAccount.page_id;
      const token    = tryDecryptToken(igAccount.access_token);
      // Use AI sector profile for precise hashtags when available
      const sp = getSectorProfile(profile);
      const hashtagBase = sp
        ? [
            sp.sub_sector.replace(/_/g, ''),
            sp.sector_label_he.replace(/\s+/g, ''),
            ...sp.relevant_topics.slice(0, 2).map(t => t.replace(/\s+/g, '')),
          ]
        : [
            category.replace(/\s+/g, ''),
            `${category.replace(/\s+/g, '')}${city.replace(/\s+/g, '')}`,
          ];
      const sectorHashtags = [...hashtagBase, name.replace(/\s+/g, '')].filter(Boolean).slice(0, 4);

      for (const hashtag of sectorHashtags) {
        try {
          const hashtagRes = await fetch(
            `${GRAPH_BASE}/ig_hashtag_search?user_id=${igUserId}&q=${encodeURIComponent(hashtag)}&access_token=${token}`,
          );
          const hashtagData: any = await hashtagRes.json();
          const hashtagId = hashtagData?.data?.[0]?.id;
          if (!hashtagId) continue;

          const topMediaRes = await fetch(
            `${GRAPH_BASE}/${hashtagId}/top_media?user_id=${igUserId}&fields=id,caption,like_count,comments_count,permalink&access_token=${token}&limit=6`,
          );
          const topMediaData: any = await topMediaRes.json();
          const posts: any[] = topMediaData?.data || [];

          for (const post of posts) {
            const url = post.permalink || '';
            if (!url || existingUrls.has(url)) continue;
            const content = (post.caption || '').substring(0, 500);
            if (!content) continue;
            await prisma.rawSignal.create({
              data: {
                source: `instagram_hashtag_graph: #${hashtag}`,
                content,
                url,
                signal_type: normSignalType('social_mention', 'collectSocialSignals:ig_graph'),
                platform: 'instagram',
                source_origin: normRawOrigin('instagram_graph_api', 'collectSocialSignals:ig_graph'),
                detected_at: new Date().toISOString(),
                linked_business: businessProfileId,
              },
            });
            existingUrls.add(url);
            newSignals++;
          }
        } catch (e: any) {
          console.warn(`[IG hashtag] #${hashtag}:`, e.message);
        }
      }
    }

    // ── Influencer scanner — Tavily + LLM ────────────────────────────────────
    if (!isTavilyRateLimited()) {
      const sp = getSectorProfile(profile);
      const cityStr = cityToEn(city);
      // Use sub-sector label for precise influencer search (e.g. "ui ux design" not just "design")
      const catStr = sp
        ? sp.sub_sector.replace(/_/g, ' ')
        : category;

      const influencerResults = await tavilySearch(
        `influencers ${catStr} Israel instagram tiktok micro-influencer`,
        6,
      );

      if (influencerResults.length > 0) {
        const influencerCtx = influencerResults
          .map(r => `${r.title || ''}: ${(r.content || '').slice(0, 150)}`)
          .join('\n');

        const influencerAnalysis = await invokeLLM({
          costTrackingId: businessProfileId,
          maxTokens: 600,
          prompt: `You are an Israeli digital marketing expert. Identify influencers relevant to the sector.
Sector: ${category}, Region: ${cityStr}

Data from the web:
${influencerCtx}

Identify up to 3 influencers active in this sector in Israel.
Return ONLY valid JSON. ALL string values must be in Hebrew:
{"influencers":[{"name":"name","platform":"instagram|tiktok|youtube","followers_estimate":"50K","relevance":"why relevant to the sector","collaboration_idea":"concrete collaboration idea"}]}`,
          response_json_schema: { type: 'object' },
        });

        const influencers: any[] = influencerAnalysis?.influencers || [];
        if (influencers.length > 0) {
          const names = influencers.map((i: any) => `${i.name} (${i.platform}, ${i.followers_estimate})`).join(', ');
          await prisma.marketSignal.create({
            data: {
              linked_business: businessProfileId,
              summary: `אושיות רשת בסקטור: ${names}`,
              category: 'social',
              impact_level: 'medium',
              confidence: 0.65,
              recommended_action: influencers[0]?.collaboration_idea || 'שקול שיתוף פעולה עם micro-influencers בסקטור',
              detected_at: new Date().toISOString(),
              source_description: 'Influencer Scanner AI',
              is_read: false,
            },
          });
        }
      }
    }

    // ── custom_keywords → social mentions on each configured platform ────────
    if (!isTavilyRateLimited()) {
      const keywords = parseKeywords(profile);
      const urlQueries = buildUrlQueries(profile, name); // e.g. '"name" instagram'
      for (const q of [...urlQueries, ...keywords.slice(0, 8).map(kw => `"${kw}" site:facebook.com OR site:instagram.com OR site:tiktok.com`)]) {
        if (isTavilyRateLimited()) break;
        const results = await tavilySearch(q, 4);
        for (const r of results) {
          if (!r.url || existingUrls.has(r.url)) continue;
          const isSocial = ['facebook.com', 'instagram.com', 'tiktok.com'].some(d => r.url.includes(d));
          if (!isSocial) continue;
          await prisma.rawSignal.create({
            data: {
              source: `tavily_kw_social: ${q.slice(0, 80)}`,
              content: (r.content || r.title || '').substring(0, 500),
              url: r.url,
              signal_type: 'social_mention',
              platform: r.url.includes('facebook') ? 'facebook' : r.url.includes('instagram') ? 'instagram' : 'tiktok',
              source_origin: 'tavily',
              detected_at: new Date().toISOString(),
              linked_business: businessProfileId,
            },
          });
          existingUrls.add(r.url);
          newSignals++;
        }
      }
    }

    // Tavily social fallback — search mentions on social platforms
    const socialQueries = [
      `"${name}" site:facebook.com OR site:instagram.com`,
      `"${name}" ${category} ${city} אזכורים`,
    ];

    if (!isTavilyRateLimited()) for (const query of socialQueries) {
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

    if (!isTavilyRateLimited()) for (const query of phase3Queries) {
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
        const signal_type = normSignalType(mentionsBusiness ? 'social_review' : 'social_mention', 'collectSocialSignals:phase3');
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
          confidence: 0.8,
          is_read: false,
          linked_business: businessProfileId,
          detected_at: new Date().toISOString(),
        },
      }).catch((e: any) => console.warn('[collectSocialSignals] MarketSignal create failed:', e.message));
      negativeSignalsFound++;
    }

    setLastRun(businessProfileId, 'collectSocialSignals');
    await writeAutomationLog('collectSocialSignals', businessProfileId, startTime, newSignals, apifyError ? 'failed' : 'success', apifyError, popCost(businessProfileId));
    console.log(`collectSocialSignals done: ${newSignals} new signals, ${negativeSignalsFound} negative → MarketSignal`);

    return res.json({ new_signals: newSignals, phase3_signals: phase3Signals, negative_alerts: negativeSignalsFound });
  } catch (err: any) {
    console.error('collectSocialSignals error:', err.message);
    await writeAutomationLog('collectSocialSignals', businessProfileId, startTime, 0, 'failed', err.message, popCost(businessProfileId));
    return res.status(500).json({ error: err.message });
  }
}
