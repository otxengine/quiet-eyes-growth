/**
 * bootstrapIntelligence — retroactive onboarding intelligence for existing accounts
 *
 * Populates sector_profile and agent_missions for businesses that registered
 * before these fields were introduced, so every account benefits from the
 * full agent-intelligence pipeline.
 */
import { prisma } from '../db';
import { invokeLLM } from './llm';
import { generateAgentMissions } from './missionPlanner';
import { createLogger } from '../infra/logger';

const logger = createLogger('BootstrapIntelligence');

/**
 * Bootstrap missing intelligence for a single business.
 * - Parses sector_profile if absent
 * - Generates agent_missions if absent
 * Returns true if any work was done.
 */
export async function bootstrapBusinessIntelligence(businessProfileId: string): Promise<boolean> {
  const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
  if (!profile) return false;

  let didWork = false;

  // ── Step 1: Parse sector profile ─────────────────────────────────────────
  if (!profile.sector_profile) {
    try {
      const catText   = profile.category    || '';
      const cityText  = profile.city        || '';
      const descText  = (profile as any).description   || '';
      const goalText  = (profile as any).business_goal || '';
      const priceText = (profile as any).price_tier    || '';

      const prompt = `You are an expert business analyst specializing in Israeli small businesses.
Analyze the following business details and produce a PRECISE structured profile in JSON.

Business name: ${profile.name}
Category (user typed): ${catText}
City: ${cityText}
Description: "${descText}"
Business goal: ${goalText}
Price tier: ${priceText}

Respond ONLY with valid JSON (no markdown, no explanation) matching this exact schema:
{
  "sector_key": "<one of: restaurant|beauty|fitness|legal|medical|real_estate|retail|auto|cleaning|education|tech_services|accounting|construction|events|design|marketing|photography|childcare|health|other>",
  "sub_sector": "<specific sub-category, e.g. 'ui_ux_design', 'family_law', 'hair_salon', 'pilates_studio'>",
  "sector_label_he": "<Hebrew label for the business type>",
  "business_type": "<B2B|B2C|B2B2C>",
  "service_model": "<project_based|subscription|appointment|walk_in|ecommerce>",
  "target_audience_he": "<who the customers are, in Hebrew, 1-2 sentences>",
  "relevant_topics": ["<5-8 topics this business cares about>"],
  "irrelevant_topics": ["<5-8 topics this business does NOT care about>"],
  "irrelevant_signal_types": ["<signal category strings to filter out>"],
  "competitor_type_he": "<Hebrew: who the competitors are>",
  "content_themes_he": ["<3-5 Hebrew content themes>"],
  "price_context_he": "<Hebrew: pricing context>",
  "lead_urgency": "<low|medium|high>",
  "content_tone": "<professional|friendly|inspirational|technical|casual>",
  "seasonality_he": "<Hebrew: key seasonal peaks>",
  "key_trust_signals_he": ["<2-3 Hebrew phrases: what builds trust>"]
}`;

      const parsed = await invokeLLM({
        prompt,
        model: 'haiku',
        maxTokens: 800,
        skipCache: true,
        response_json_schema: { type: 'object' },
      });

      const sectorProfile = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
      await prisma.businessProfile.update({
        where: { id: businessProfileId },
        data: {
          sector_profile: JSON.stringify(sectorProfile),
          category: sectorProfile.sector_label_he || sectorProfile.sub_sector || catText || profile.category,
        },
      });
      logger.info(`[bootstrap] sector_profile parsed for ${profile.name} (${businessProfileId}): ${sectorProfile.sub_sector}`);
      didWork = true;
    } catch (err: any) {
      logger.warn(`[bootstrap] sector_profile parse failed for ${businessProfileId}: ${err.message}`);
    }
  }

  // ── Step 2: Generate agent missions ──────────────────────────────────────
  if (!(profile as any).agent_missions) {
    try {
      await generateAgentMissions(businessProfileId);
      logger.info(`[bootstrap] agent_missions generated for ${profile.name} (${businessProfileId})`);
      didWork = true;
    } catch (err: any) {
      logger.warn(`[bootstrap] agent_missions generation failed for ${businessProfileId}: ${err.message}`);
    }
  }

  return didWork;
}

/**
 * Bulk-bootstrap all business profiles that are missing sector_profile or agent_missions.
 * Runs sequentially (not in parallel) to avoid hammering the LLM API.
 */
export async function bulkBootstrapAllBusinesses(): Promise<{ processed: number; upgraded: number; errors: number }> {
  const businesses = await prisma.businessProfile.findMany({
    where: {
      OR: [
        { sector_profile: null },
        { agent_missions: null },
      ],
    },
    select: { id: true, name: true },
  });

  let upgraded = 0;
  let errors = 0;

  for (const biz of businesses) {
    try {
      const did = await bootstrapBusinessIntelligence(biz.id);
      if (did) upgraded++;
    } catch (err: any) {
      logger.warn(`[bulk-bootstrap] failed for ${biz.name} (${biz.id}): ${err.message}`);
      errors++;
    }
  }

  logger.info(`[bulk-bootstrap] done — ${businesses.length} checked, ${upgraded} upgraded, ${errors} errors`);
  return { processed: businesses.length, upgraded, errors };
}
