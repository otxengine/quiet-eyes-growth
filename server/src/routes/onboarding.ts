/**
 * Onboarding routes
 *
 * POST /api/onboarding/parse-profile
 *   Parses a free-text business description into a structured sub-sector profile.
 *   Stores the result in BusinessProfile.sector_profile and returns it.
 *   Called immediately after the business profile is created in onboarding step 4.
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';
import { generateAgentMissions } from '../lib/missionPlanner';
import { createLogger } from '../infra/logger';
import { writeAutomationLog } from '../lib/automationLog';
import { fetchWebsiteSource } from '../lib/websiteFetch';
import { getPlaceDetails } from '../lib/googlePlaces';
import { autoConfigOsint } from './functions/stubs';
import { fetchSocialPageAbout } from '../lib/fetchSocialPageAbout';
import { getUserId } from '../middleware/auth';
import { getOrCreateOrgForProfile } from '../lib/orgHelpers';
import { syncBusinessToOTX } from '../lib/syncBusinessToOTX';

const logger = createLogger('Onboarding');
const router = Router();
const PAID_PLANS = new Set(['starter', 'growth', 'pro']);

// §5.0/§5.2 identity draft — 9 keys shared by generate-about + approve-about
const ABOUT_KEYS = ['business_name','sector_key','sub_sector_key','business_type','service_model','target_audience','relevant_topics','content_tone','business_description'];

router.post('/parse-profile', async (req: Request, res: Response) => {
  const { businessProfileId, description, category, city, goal, price_tier, customer_sources } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'businessProfileId required' });

  const startTime = new Date().toISOString();

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    const descText   = description || profile.description || '';
    const catText    = category   || profile.category     || '';
    const cityText   = city       || profile.city         || '';
    const goalText   = goal       || profile.business_goal || '';
    const priceText  = price_tier || profile.price_tier    || '';
    const srcText    = typeof customer_sources === 'string'
      ? customer_sources
      : JSON.stringify(customer_sources || []);

    // AC#2: detect and log sparse input before hitting the LLM
    const sparseFields = (
      [['description', descText], ['category', catText], ['city', cityText], ['goal', goalText], ['price_tier', priceText]] as [string, string][]
    ).filter(([, v]) => !v).map(([k]) => k);
    if (sparseFields.length > 0) {
      logger.warn(`parse-profile sparse input for ${businessProfileId}: missing fields [${sparseFields.join(', ')}]`);
    }

    // AC#2: fallback used when LLM throws or returns garbage
    const FALLBACK_PROFILE: Record<string, any> = {
      sector_key: 'other',
      sub_sector: catText || 'general',
      sector_label_he: catText || 'עסק כללי',
      business_type: 'B2C',
      service_model: ['walk_in'],
      target_audience_he: '',
      relevant_topics: [],
      irrelevant_topics: [],
      irrelevant_signal_types: [],
      competitor_type_he: '',
      content_themes_he: [],
      price_context_he: '',
      lead_urgency: 'medium',
      content_tone: 'friendly',
      seasonality_he: '',
      key_trust_signals_he: [],
      _fallback: true,
    };

    const prompt = `You are an expert business analyst specializing in Israeli small businesses.
Analyze the following business details and produce a PRECISE structured profile in JSON.

Business name: ${profile.name}
Category (user typed): ${catText}
City: ${cityText}
Description: "${descText}"
Business goal: ${goalText}
Price tier: ${priceText}
Customer sources: ${srcText}

Respond ONLY with valid JSON (no markdown, no explanation) matching this exact schema:
{
  "sector_key": "<one of: restaurant|beauty|fitness|legal|medical|real_estate|retail|auto|cleaning|education|tech_services|accounting|construction|events|design|marketing|photography|childcare|health|other>",
  "sub_sector": "<specific sub-category, e.g. 'ui_ux_design', 'family_law', 'hair_salon', 'pilates_studio'>",
  "sector_label_he": "<Hebrew label for the business type, e.g. 'עיצוב UI/UX', 'עורך דין משפחה', 'סטודיו פילאטיס'>",
  "business_type": "<B2B|B2C|B2B2C>",
  "service_model": ["<one or more of: project_based|subscription|appointment|walk_in|ecommerce>"],
  "target_audience_he": "<who the customers are, in Hebrew, 1-2 sentences>",
  "relevant_topics": ["<list of 5-8 topics/domains this business CARES about — e.g. 'product design', 'SaaS tools', 'yoga trends'>"],
  "irrelevant_topics": ["<list of 5-8 topics this business does NOT care about — e.g. 'sports scores', 'real estate prices', 'concerts'>"],
  "irrelevant_signal_types": ["<signal category strings to filter out — choose from: sports_match|local_event|concert|weather_event|restaurant_trend|real_estate_trend|fashion_trend>"],
  "competitor_type_he": "<Hebrew: who the competitors are, e.g. 'משרדי עיצוב, פרילנסרים'>",
  "content_themes_he": ["<3-5 Hebrew content themes that would resonate with their audience>"],
  "price_context_he": "<Hebrew: pricing context, e.g. 'B2B, פרויקטים 5,000-50,000 ₪' or 'תורים 150-300 ₪'>",
  "lead_urgency": "<low|medium|high — how urgently potential customers need this service>",
  "content_tone": "<professional|friendly|inspirational|technical|casual>",
  "seasonality_he": "<Hebrew: key seasonal peaks for this business>",
  "key_trust_signals_he": ["<2-3 Hebrew phrases: what builds trust in this specific sector>"]
}`;

    let sectorProfile: Record<string, any>;
    let usedFallback = false;
    let llmError: string | undefined;

    try {
      const parsed = await invokeLLM({
        prompt,
        model: 'haiku',
        maxTokens: 800,
        skipCache: true,
        response_json_schema: { type: 'object' },
      });
      sectorProfile = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
    } catch (llmErr: any) {
      logger.warn(`parse-profile LLM failed for ${businessProfileId}, using fallback: ${llmErr.message}`);
      sectorProfile = FALLBACK_PROFILE;
      usedFallback = true;
      llmError = llmErr.message;
    }

    const sectorProfileStr = JSON.stringify(sectorProfile);

    // Build update data — also update category to clean AI-inferred label
    const updateData: Record<string, any> = {
      category: sectorProfile.sector_label_he || sectorProfile.sub_sector || catText,
    };
    // KAN-204 AC4: approve-about owns sector_profile once an identity is approved —
    // a later parse-profile run must not silently overwrite it
    if (profile.about_status !== 'approved') updateData.sector_profile = sectorProfileStr;
    if (goal)            updateData.business_goal    = goal;
    if (price_tier)      updateData.price_tier       = price_tier;
    if (customer_sources) updateData.customer_sources = typeof customer_sources === 'string'
      ? customer_sources
      : JSON.stringify(customer_sources);

    await prisma.businessProfile.update({ where: { id: businessProfileId }, data: updateData });

    if (usedFallback) {
      logger.info(`Sector profile fallback persisted for ${businessProfileId}`);
      // AC#3: log fallback path — status 'success' because a profile WAS persisted
      await writeAutomationLog('parseProfile', businessProfileId, startTime, 0, 'success', `fallback profile used: ${llmError}`);
    } else {
      logger.info(`Sector profile parsed for ${businessProfileId}: ${sectorProfile.sub_sector}`);
      // AC#3: log happy path
      await writeAutomationLog('parseProfile', businessProfileId, startTime, 1);
    }

    return res.json({ ok: true, sector_profile: sectorProfile });
  } catch (err: any) {
    logger.warn(`parse-profile failed for ${businessProfileId}: ${err.message}`);
    // AC#3: log hard failure (e.g. DB unreachable)
    await writeAutomationLog('parseProfile', businessProfileId, startTime, 0, 'failed', err.message);
    return res.json({ ok: false, error: err.message });
  }
});

// ── POST /api/onboarding/generate-about ───────────────────────────────────────
// KAN-196 §5.0: Generates a 9-key identity draft (pending owner approval).
// Writes to about_draft / about_status only — never to canonical profile fields.
router.post('/generate-about', async (req: Request, res: Response) => {
  const { businessProfileId, seed_info, website_url, social_urls, google_place_id, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'businessProfileId required' });

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    // AC4: no usable source at all → return retry prompt instead of hallucinating
    const hasSeed    = !!seed_info;
    const hasWebsite = !!(website_url || profile.website_url || profile.channels_website);
    const hasSocial  = !!(social_urls || profile.instagram_url || profile.facebook_url || profile.tiktok_url);
    const hasPlace   = !!(google_place_id || profile.google_place_id);
    const hasDesc    = !!(profile.description || profile.category);
    if (!hasSeed && !hasWebsite && !hasSocial && !hasPlace && !hasDesc) {
      // KAN-208: empty-block rate — the only record that a user was blocked here
      await writeAutomationLog('about_blocked', businessProfileId, new Date().toISOString(), 0);
      return res.json({
        ok: false,
        needs_seed: true,
        prompt: 'כדי לייצר את הסקירה העסקית, אנא ספר לנו בכמה משפטים על העסק שלך — מה אתה מציע, למי, ואיפה.',
      });
    }

    // KAN-202 AC1/AC4: fetch real website content (prefers /about, /אודות, /services; degrades to null on failure)
    const websiteUrlToUse = website_url || profile.website_url || profile.channels_website;
    const websiteSource = hasWebsite && websiteUrlToUse ? await fetchWebsiteSource(websiteUrlToUse) : null;

    // KAN-202 AC2: pull the Places editorial summary when a place is linked; nothing invented when absent
    const placeIdToUse = google_place_id || profile.google_place_id;
    const placeDetails = hasPlace && placeIdToUse ? await getPlaceDetails(placeIdToUse) : null;
    const placeExcerpt = placeDetails?.editorialSummary || '';

    // KAN-203 AC1/AC4: fetch social bios via shared helper; TTL cache suppresses Apify re-burn unless force=true
    const socialResults = hasSocial ? await fetchSocialPageAbout(
      {
        facebookUrl:  profile.facebook_url  || undefined,
        instagramUrl: profile.instagram_url || undefined,
        tiktokUrl:    profile.tiktok_url    || undefined,
      },
      { forceRegenerate: !!force },
    ) : [];

    // Build source summary for the LLM (priority: website > Google > social > seed)
    const sources = [
      profile.description ? `Description: ${profile.description}` : null,
      profile.category    ? `Category: ${profile.category}` : null,
      profile.city        ? `City: ${profile.city}` : null,
      websiteSource ? `Website (${websiteSource.sourceUrl}): ${websiteSource.text}`
        : (hasWebsite ? `Website: ${websiteUrlToUse}` : null),
      placeExcerpt ? `Google Place editorial summary: ${placeExcerpt}`
        : (hasPlace ? `Google Place ID: ${placeIdToUse}` : null),
      ...socialResults.map(r => `${r.platform} bio (${r.profileUrl}): ${r.aboutText}`),
      seed_info           ? `Owner-provided context: ${seed_info}` : null,
    ].filter(Boolean).join('\n');

    const SECTOR_KEYS  = 'restaurant|beauty|fitness|legal|medical|real_estate|retail|auto|cleaning|education|tech_services|accounting|construction|events|design|marketing|photography|childcare|health|other';
    const BUSINESS_TYPES = 'B2B|B2C|B2B2C';
    const SERVICE_MODELS = 'project_based|subscription|appointment|walk_in|ecommerce';
    const TONES         = 'professional|friendly|inspirational|technical|casual';

    const prompt = `You are a business identity writer. Based ONLY on the sources below, produce a JSON identity draft.
Do NOT invent services, cities, or claims not supported by the sources.
If a field cannot be determined from the sources, use "" for strings and [] for arrays.

Business name: ${profile.name}
Sources:
${sources}

Respond ONLY with valid JSON matching this exact schema (no markdown):
{
  "business_name": "<string>",
  "sector_key": "<${SECTOR_KEYS}>",
  "sub_sector_key": "<specific sub-category slug, e.g. hair_salon>",
  "business_type": "<${BUSINESS_TYPES}>",
  "service_model": ["<one or more of: ${SERVICE_MODELS}>"],
  "target_audience": "<1-2 sentences describing the target customer>",
  "content_tone": "<${TONES}>",
  "business_description": "<2-5 sentence business description, written in Hebrew>",
  "relevant_topics": ["<5-8 topics this business cares about>"]
}`;

    // maxTokens raised + business_description ordered before relevant_topics: Hebrew output is
    // token-expensive, and if the model still truncates, the description is written before the
    // large trailing array instead of being the field most likely to get cut off.
    const raw = await invokeLLM({ prompt, model: 'haiku', maxTokens: 1500, skipCache: true, response_json_schema: { type: 'object' } });
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    // Providers occasionally return a bare array (e.g. just relevant_topics) instead of
    // the object schema — JSON.stringify would silently drop it down to that array.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('LLM returned a malformed identity draft (not a JSON object)');
    }
    const draft = parsed;

    // Validate all 9 keys present (AC1)
    for (const key of ABOUT_KEYS) {
      if (!(key in draft)) draft[key] = key === 'relevant_topics' ? [] : '';
    }

    // AC2: write only to draft fields — never touch canonical profile
    const sourcesUsed = [
      hasDesc                  ? 'profile_description' : null,
      hasWebsite               ? 'website' : null,
      socialResults.length > 0 ? 'social' : null,
      hasPlace                 ? 'google_place' : null,
      hasSeed                  ? 'seed_info' : null,
    ].filter(Boolean);

    // KAN-202/KAN-203 AC3: raw excerpt + provenance per source (only for sources actually fetched)
    const sourceExcerpts: Record<string, { url?: string; excerpt: string }> = {};
    if (websiteSource) sourceExcerpts.website = { url: websiteSource.sourceUrl, excerpt: websiteSource.text };
    if (placeExcerpt)  sourceExcerpts.google_place = { excerpt: placeExcerpt };
    for (const r of socialResults) sourceExcerpts[r.platform] = { url: r.profileUrl, excerpt: r.aboutText };

    await prisma.businessProfile.update({
      where: { id: businessProfileId },
      data: {
        about_draft: JSON.stringify(draft),
        about_status: 'pending',
        about_sources: JSON.stringify(sourcesUsed),
        about_source_excerpts: JSON.stringify(sourceExcerpts),
        about_generated_at: new Date().toISOString(),
      },
    });

    return res.json({ ok: true, draft, about_status: 'pending' });
  } catch (err: any) {
    logger.warn(`generate-about failed for ${businessProfileId}: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/onboarding/approve-about ──────────────────────────────────────────
// KAN-197 AC3: promotes the draft to the canonical, approved identity JSON.
// KAN-198 AC2/AC5: when the owner edited fields in the approval screen, the EDITED
// values are what get saved — not just whatever was last generated.
router.post('/approve-about', async (req: Request, res: Response) => {
  const { businessProfileId, draft } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'businessProfileId required' });

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });
    if (!profile.about_draft && !draft) return res.status(400).json({ error: 'No draft to approve' });

    let approved = profile.about_draft;
    if (draft) {
      for (const key of ABOUT_KEYS) {
        if (!(key in draft)) return res.status(400).json({ error: `draft missing required key: ${key}` });
      }
      approved = JSON.stringify(draft);
    }
    const approvedObj = JSON.parse(approved);

    // KAN-204 AC1: mirror the approved identity onto the canonical fields agents actually read,
    // merging into (not replacing) sector_profile so parse-profile-only keys survive
    let sectorProfile: Record<string, any> = {};
    try { sectorProfile = profile.sector_profile ? JSON.parse(profile.sector_profile) : {}; } catch { /* keep {} */ }
    sectorProfile = {
      ...sectorProfile,
      sector_key: approvedObj.sector_key,
      sub_sector: approvedObj.sub_sector_key,
      business_type: approvedObj.business_type,
      service_model: approvedObj.service_model,
      target_audience_he: approvedObj.target_audience,
      relevant_topics: approvedObj.relevant_topics,
      content_tone: approvedObj.content_tone,
    };

    await prisma.businessProfile.update({
      where: { id: businessProfileId },
      data: {
        about_approved: approved,
        about_status: 'approved',
        about_approved_at: new Date().toISOString(),
        description: approvedObj.business_description,
        name: approvedObj.business_name,
        category: sectorProfile.sector_label_he || approvedObj.sector_key,
        tone_preference: approvedObj.content_tone,
        target_market: approvedObj.target_audience,
        sector_profile: JSON.stringify(sectorProfile),
      },
    });

    // KAN-204 AC2: refresh OSINT config + agent missions so competitor/keyword agents use the new about
    const noopRes = { json: () => noopRes, status: () => noopRes } as unknown as Response;
    autoConfigOsint({ body: { businessProfileId } } as Request, noopRes)
      .catch((err: any) => logger.warn(`approve-about: autoConfigOsint refresh failed for ${businessProfileId}: ${err.message}`));
    generateAgentMissions(businessProfileId)
      .catch((err: any) => logger.warn(`approve-about: generateMissions refresh failed for ${businessProfileId}: ${err.message}`));
    syncBusinessToOTX(businessProfileId, approvedObj.business_name, approvedObj.sector_key, profile.city)
      .catch((err: any) => logger.warn(`approve-about: syncBusinessToOTX failed for ${businessProfileId}: ${err.message}`));

    return res.json({ ok: true, about_status: 'approved', approved: approvedObj });
  } catch (err: any) {
    logger.warn(`approve-about failed for ${businessProfileId}: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/onboarding/reject-about ───────────────────────────────────────────
// KAN-197 AC4: rejects the pending draft — the approved canonical JSON is never touched.
router.post('/reject-about', async (req: Request, res: Response) => {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'businessProfileId required' });

  try {
    await prisma.businessProfile.update({
      where: { id: businessProfileId },
      data: { about_status: 'rejected' },
    });

    return res.json({ ok: true, about_status: 'rejected' });
  } catch (err: any) {
    logger.warn(`reject-about failed for ${businessProfileId}: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/onboarding/select-plan ───────────────────────────────────────────
// Onboarding plan step. Free: just stamp subscription_plan on the profile — no
// org needed. Paid: ensure an org exists (none does yet for a brand-new profile)
// seeded with the chosen plan, so the frontend's subsequent stripe/checkout call
// has an orgId to work with instead of 404ing.
router.post('/select-plan', async (req: Request, res: Response) => {
  const { businessProfileId, planId } = req.body;
  if (!businessProfileId || !planId) {
    return res.status(400).json({ error: 'businessProfileId and planId required' });
  }

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    if (!PAID_PLANS.has(planId)) {
      await prisma.businessProfile.update({
        where: { id: businessProfileId },
        data: { subscription_plan: 'free_trial' },
      });
      return res.json({ ok: true, requiresCheckout: false });
    }

    const userId = getUserId(req) || profile.created_by || 'dev-user';
    const orgId = await getOrCreateOrgForProfile(profile, userId, planId);
    return res.json({ ok: true, requiresCheckout: true, orgId });
  } catch (err: any) {
    logger.warn(`select-plan failed for ${businessProfileId}: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/onboarding/confirm-competitors ───────────────────────────────────
// Bulk-applies the user's tracking selections after the discover-competitors
// step. Pure DB-status update, responds fast — the deep-research scans (posts,
// stories, ads, reviews) for approved competitors are triggered explicitly by
// the frontend afterward, in parallel, so it can hold the loading screen until
// they've all finished instead of navigating away while they're still running.
router.post('/confirm-competitors', async (req: Request, res: Response) => {
  const { businessProfileId, approvedIds = [], rejectedIds = [] } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'businessProfileId required' });

  try {
    if (approvedIds.length) {
      await prisma.competitor.updateMany({
        where: { id: { in: approvedIds }, linked_business: businessProfileId },
        data: { tracking_status: 'approved' },
      });
    }
    if (rejectedIds.length) {
      await prisma.competitor.updateMany({
        where: { id: { in: rejectedIds }, linked_business: businessProfileId },
        data: { tracking_status: 'rejected', is_dismissed: true },
      });
    }

    return res.json({ ok: true, approved: approvedIds.length, rejected: rejectedIds.length });
  } catch (err: any) {
    logger.warn(`confirm-competitors failed for ${businessProfileId}: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/onboarding/generate-missions ────────────────────────────────────
// Called after parse-profile. Sends full profile to Claude Sonnet + GPT-4o
// and generates per-agent mission plans stored in BusinessProfile.agent_missions.
router.post('/generate-missions', async (req: Request, res: Response) => {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'businessProfileId required' });

  try {
    const missions = await generateAgentMissions(businessProfileId);
    if (!missions) return res.json({ ok: false, error: 'LLM generation failed' });
    return res.json({ ok: true, missions });
  } catch (err: any) {
    logger.warn(`generate-missions failed for ${businessProfileId}: ${err.message}`);
    return res.json({ ok: false, error: err.message });
  }
});

export default router;
