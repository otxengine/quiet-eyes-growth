/**
 * Stub handlers for functions that are called by the frontend but
 * require external service credentials or complex setup.
 * Returns reasonable responses so the UI doesn't break.
 */
import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';

export async function runCompetitorIdentification(req: Request, res: Response) {
  return res.json({ competitors_found: 0, new_competitors_created: 0, existing_competitors_updated: 0 });
}

export async function enrichLeads(req: Request, res: Response) {
  return res.json({ enriched: 0 });
}

export async function scanAllReviews(req: Request, res: Response) {
  // Alias to collectReviews — handled separately
  return res.json({ new_reviews: 0 });
}

export async function fetchSocialData(req: Request, res: Response) {
  return res.json({ new_signals: 0 });
}

export async function syncLeadToCrm(req: Request, res: Response) {
  return res.json({ success: false, message: 'CRM sync not configured' });
}

export async function crmWebhookSync(req: Request, res: Response) {
  return res.json({ success: false, message: 'CRM webhook not configured' });
}

export async function whatsappBotHandler(req: Request, res: Response) {
  return res.json({ success: false, message: 'WhatsApp bot not configured' });
}

export async function sendWhatsAppAlert(req: Request, res: Response) {
  // In production, wire this to Twilio/WhatsApp Business API
  const { data } = req.body;
  console.log('WhatsApp alert (stub):', data?.phone, data?.message?.substring(0, 50));
  return res.json({ success: true, sent: false, message: 'WhatsApp not configured — log only' });
}

export async function scheduleWinBack(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 3600000).toISOString();
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600000).toISOString();

    const leads = await prisma.lead.findMany({ where: { linked_business: businessProfileId } });
    const candidates = leads.filter(l => {
      const completedAt = l.closed_at || l.created_at || '';
      return (l.lifecycle_stage === 'closed_won' || l.status === 'completed') &&
        completedAt >= ninetyDaysAgo && completedAt < sixtyDaysAgo;
    });

    return res.json({ win_back_candidates: candidates.length, sent: 0, message: 'WhatsApp not configured — candidates identified only' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function autoConfigOsint(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    // ── Step 1: LLM → keywords + competitors (no URL guessing) ──────────────
    const llmPrompt = `Return a JSON object. No extra keys, no nesting.

Business: ${profile.name} | Category: ${profile.category} | City: ${profile.city}
Services: ${profile.relevant_services || profile.category}

Return exactly:
{"keywords":["kw1","kw2",...],"competitors":[{"name":"...","category":"...","address":"..."}]}

Rules:
- keywords: exactly 10 Hebrew search terms customers use to find this type of business in ${profile.city} (short phrases only)
- competitors: exactly 3 realistic competitor business names in ${profile.city} or nearby cities`;

    let keywords: string[] = [];
    let competitors: Array<{ name: string; category?: string; address?: string; notes?: string }> = [];

    try {
      const llmResult = await invokeLLM({
        model: 'sonnet',
        maxTokens: 600,
        skipCache: true,
        prompt: llmPrompt,
        response_json_schema: { type: 'object' },
      }) as { keywords?: string[]; competitors?: Array<{ name: string; category?: string; address?: string }> } | null;

      const unwrapped = (llmResult as any)?.osint_configuration || (llmResult as any)?.configuration || llmResult;
      if (!unwrapped) {
        console.warn('[autoConfigOsint] LLM returned null/invalid JSON — safe defaults: empty keywords, curated URLs will still persist');
      } else {
        keywords = Array.isArray(unwrapped.keywords) ? unwrapped.keywords : [];
        competitors = Array.isArray(unwrapped.competitors) ? unwrapped.competitors : [];
      }
    } catch (llmErr: any) {
      console.warn('[autoConfigOsint] LLM call failed — safe defaults: empty keywords, curated URLs will still persist. Reason:', llmErr.message);
    }

    // ── Step 2: Tavily → discover real URLs for this business sector ─────────
    const discoveredUrls: string[] = [];
    if (!isTavilyRateLimited()) {
      const tCategory = profile.category || '';
      const tCity = profile.city || '';
      const searchQueries = [
        `${tCategory} ${tCity} ביקורות המלצות פורום`,
        `${tCategory} ישראל אתר מידע השוואה`,
      ];
      for (const q of searchQueries) {
        if (isTavilyRateLimited()) break;
        const results = await tavilySearch(q, 4);
        for (const r of results) {
          if (r.url && !discoveredUrls.includes(r.url)) {
            discoveredUrls.push(r.url);
          }
        }
      }
    }

    // ── Curated URL lists per category ──────────────────────────────────────
    // Social platforms relevant to any Israeli business
    const SOCIAL_PLATFORMS = [
      'https://www.instagram.com',
      'https://www.facebook.com',
      'https://www.tiktok.com',
    ];

    const CURATED_URLS: Record<string, string[]> = {
      מסעדה: [
        'https://www.rest.co.il', 'https://www.onono.co.il', 'https://www.timeout.co.il',
        'https://www.wolt.com/he/isr', 'https://www.10bis.co.il', 'https://www.easy.co.il',
        ...SOCIAL_PLATFORMS,
      ],
      קפה: [
        'https://www.rest.co.il', 'https://www.onono.co.il', 'https://www.timeout.co.il',
        'https://www.wolt.com/he/isr', 'https://www.10bis.co.il', 'https://www.easy.co.il',
        ...SOCIAL_PLATFORMS,
      ],
      מאפייה: [
        'https://www.rest.co.il', 'https://www.wolt.com/he/isr', 'https://www.10bis.co.il',
        'https://www.timeout.co.il', 'https://www.easy.co.il', ...SOCIAL_PLATFORMS,
      ],
      כושר: [
        'https://www.zap.co.il', 'https://www.easy.co.il', 'https://www.sportlight.co.il',
        ...SOCIAL_PLATFORMS,
      ],
      יופי: [
        'https://www.zap.co.il', 'https://www.easy.co.il', 'https://www.ynet.co.il/lifestyle',
        'https://www.mako.co.il/lifestyle', ...SOCIAL_PLATFORMS,
      ],
      ספא: [
        'https://www.zap.co.il', 'https://www.easy.co.il', 'https://www.timeout.co.il',
        'https://www.mako.co.il/lifestyle', ...SOCIAL_PLATFORMS,
      ],
      חנות: [
        'https://www.zap.co.il', 'https://www.easy.co.il', 'https://www.price.co.il',
        ...SOCIAL_PLATFORMS,
      ],
      שירותים: [
        'https://www.zap.co.il', 'https://www.easy.co.il', 'https://www.komo.co.il',
        ...SOCIAL_PLATFORMS,
      ],
    };

    const curatedBase = CURATED_URLS[profile.category] || [
      'https://www.zap.co.il', 'https://www.easy.co.il', 'https://www.komo.co.il',
      ...SOCIAL_PLATFORMS,
    ];

    // Add business's own social/web URLs from profile
    const ownUrls: string[] = [
      profile.website_url, profile.facebook_url, profile.instagram_url, profile.tiktok_url,
    ].filter((u): u is string => !!u && u.startsWith('http'));

    const allUrls = [...new Set([...ownUrls, ...discoveredUrls.slice(0, 4), ...curatedBase])].slice(0, 12);
    const urls = allUrls;

    // Update business profile with keywords and URLs
    await prisma.businessProfile.update({
      where: { id: businessProfileId },
      data: {
        custom_keywords: keywords.join(', '),
        custom_urls: urls.join('\n'),
      },
    });

    // Create competitor entities (skip if name already exists for this business)
    const existingComps = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      select: { name: true },
    });
    const existingNames = new Set(existingComps.map((c: { name: string }) => c.name.toLowerCase()));

    const newComps = competitors.filter(
      (c) => c.name && !existingNames.has(c.name.toLowerCase()),
    );

    if (newComps.length > 0) {
      await prisma.competitor.createMany({
        data: newComps.map((c) => ({
          linked_business: businessProfileId,
          created_by: profile.created_by ?? undefined,
          name: c.name,
          category: c.category ?? profile.category,
          address: c.address ?? undefined,
          notes: c.notes ?? undefined,
        })),
      });
    }

    return res.json({
      success: true,
      keywords_count: keywords.length,
      urls_count: urls.length,
      competitors_created: newComps.length,
    });
  } catch (err: any) {
    console.error('[autoConfigOsint] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export async function learnFromWebsite(req: Request, res: Response) {
  const { businessProfileId, websiteUrl } = req.body;
  if (!websiteUrl || !businessProfileId) return res.json({ success: false });

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    // Fetch website text (best-effort, no external dependency)
    let websiteText = '';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(websiteUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuietEyes/1.0)' },
      });
      clearTimeout(timeout);
      const html = await resp.text();
      // Strip HTML tags, keep text
      websiteText = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 3000);
    } catch (fetchErr: any) {
      console.error('[learnFromWebsite] fetch failed:', fetchErr?.message ?? 'timeout');
      websiteText = `Business: ${profile.name}, Category: ${profile.category}, City: ${profile.city}`;
    }

    const result = await invokeLLM({
      prompt: `You are analyzing an Israeli business website. Extract business intelligence.
Website text (first 3000 chars):
${websiteText}

Business: ${profile.name} (${profile.category}, ${profile.city})

Return JSON:
{
  "description": "2-3 sentence business description in Hebrew",
  "services": ["service1","service2","service3"],
  "keywords": ["keyword1","keyword2","keyword3","keyword4","keyword5"],
  "target_market": "description of target customers in Hebrew",
  "tone": "professional/casual/luxury/budget"
}`,
      response_json_schema: { type: 'object' },
    }) as { description?: string; services?: string[]; keywords?: string[]; target_market?: string; tone?: string } | null;

    if (!result) return res.json({ success: false, message: 'Could not parse website' });

    const updateData: Record<string, any> = {};
    if (result.description && !profile.description) updateData.description = result.description;
    if (result.target_market && !profile.target_market) updateData.target_market = result.target_market;
    if (result.services?.length) updateData.relevant_services = result.services.join(', ');
    if (result.keywords?.length) {
      const existing = profile.custom_keywords?.split(',').map(k => k.trim()).filter(Boolean) || [];
      const merged = [...new Set([...existing, ...result.keywords])].slice(0, 20);
      updateData.custom_keywords = merged.join(', ');
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.businessProfile.update({ where: { id: businessProfileId }, data: updateData });
    }

    return res.json({
      success: true,
      services_found: result.services?.length || 0,
      keywords_added: result.keywords?.length || 0,
      description_set: !!updateData.description,
    });
  } catch (err: any) {
    console.error('[learnFromWebsite]', err.message);
    return res.json({ success: false, error: err.message });
  }
}

export async function runFullScan(req: Request, res: Response) {
  // Called with {} from OnboardingInsights — find profile via created_by
  let { businessProfileId } = req.body;

  if (!businessProfileId) {
    // Try to find via created_by (dev-user in dev mode)
    const profiles = await prisma.businessProfile.findMany({ orderBy: { created_date: 'desc' }, take: 1 });
    businessProfileId = profiles[0]?.id;
  }
  if (!businessProfileId) return res.json({ success: false, message: 'No business profile found' });

  // Run sequentially: signals → reviews → intelligence → competitors → leads → health
  const steps = [
    'collectWebSignals', 'collectReviews', 'synthesizeMarketInsights', 'runIntelligenceEngines',
    'runCompetitorIdentification', 'runLeadGeneration', 'calculateHealthScore',
  ];
  const results: Record<string, any> = {};
  for (const step of steps) {
    try {
      const fakeReq = { body: { businessProfileId } } as Request;
      const fakeRes = {
        json: (data: any) => { results[step] = data; return fakeRes; },
        status: () => fakeRes,
      } as any;
      // dynamic import to avoid circular deps
      const mod = await import(`./${step}`);
      const fn = mod[step] || mod.default;
      if (fn) await fn(fakeReq, fakeRes);
    } catch (e: any) {
      results[step] = { error: e.message };
    }
  }
  return res.json({ success: true, results });
}

export async function getSubscriptionStatus(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.json({ plan_id: 'free', subscription_status: 'none' });
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const p = profiles[0];
    return res.json({ plan_id: p?.plan_id || 'free', subscription_status: p?.subscription_status || 'none' });
  } catch { return res.json({ plan_id: 'free', subscription_status: 'none' }); }
}

export async function createCheckoutSession(req: Request, res: Response) {
  // Legacy endpoint — forward to new Stripe checkout (307 preserves POST + body)
  return res.redirect(307, '/api/stripe/checkout');
}

export async function manageSubscription(req: Request, res: Response) {
  // Legacy endpoint — forward to new Stripe portal
  return res.redirect(307, '/api/stripe/portal');
}

export async function collectSocialSignals(req: Request, res: Response) {
  return res.json({ new_signals: 0, message: 'Social scraping requires Apify credentials' });
}

export async function updateSectorKnowledge(req: Request, res: Response) {
  return res.json({ updated: 0, message: 'Sector knowledge updated' });
}

export async function identifyKnowledgeGaps(req: Request, res: Response) {
  return res.json({ gaps_found: 0 });
}

export async function runPredictions(req: Request, res: Response) {
  return res.json({ predictions_created: 0, message: 'Predictions require sufficient historical data' });
}

export async function generateProactiveAlerts(req: Request, res: Response) {
  return res.json({ alerts_created: 0 });
}

export async function applyDataFreshness(req: Request, res: Response) {
  return res.json({ archived_leads: 0, retention_candidates: 0, historical_reviews: 0, raw_signals_cleaned: 0, win_back_alerts: 0 });
}

export async function runMLLearning(req: Request, res: Response) {
  return res.json({ wins: 0, losses: 0, conversion_rate: 0, competitor_threat_score: 0, rescored_leads: 0, ml_summary: null });
}
