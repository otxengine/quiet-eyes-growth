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
import { createLogger } from '../infra/logger';

const logger = createLogger('Onboarding');
const router = Router();

router.post('/parse-profile', async (req: Request, res: Response) => {
  const { businessProfileId, description, category, city, goal, price_tier, customer_sources } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'businessProfileId required' });

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
  "service_model": "<project_based|subscription|appointment|walk_in|ecommerce>",
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

    const parsed = await invokeLLM({
      prompt,
      model: 'haiku',
      maxTokens: 800,
      skipCache: true,
      response_json_schema: { type: 'object' },
    });

    const sectorProfile = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
    const sectorProfileStr = JSON.stringify(sectorProfile);

    // Build update data — also update category to clean AI-inferred label
    const updateData: Record<string, any> = {
      sector_profile: sectorProfileStr,
      category: sectorProfile.sector_label_he || sectorProfile.sub_sector || catText,
    };
    if (goal)            updateData.business_goal    = goal;
    if (price_tier)      updateData.price_tier       = price_tier;
    if (customer_sources) updateData.customer_sources = typeof customer_sources === 'string'
      ? customer_sources
      : JSON.stringify(customer_sources);

    await prisma.businessProfile.update({ where: { id: businessProfileId }, data: updateData });

    logger.info(`Sector profile parsed for ${businessProfileId}: ${sectorProfile.sub_sector}`);
    return res.json({ ok: true, sector_profile: sectorProfile });
  } catch (err: any) {
    logger.warn(`parse-profile failed for ${businessProfileId}: ${err.message}`);
    // Non-fatal — onboarding can continue without the AI profile
    return res.json({ ok: false, error: err.message });
  }
});

export default router;
