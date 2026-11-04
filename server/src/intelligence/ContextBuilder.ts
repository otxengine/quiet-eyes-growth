/**
 * ContextBuilder — assembles EnrichedContext from all data sources.
 *
 * Reads:  profile, signals, leads, competitors, health, reviews,
 *         sector knowledge, predictions, recent decisions, recent outcomes,
 *         business memory, meta_configuration
 *
 * Does NOT run opportunity/threat detection — that happens in OpportunityDetector
 * and ThreatDetector which run as a pipeline step AFTER context is built.
 * active_opportunities and active_threats are injected by MasterOrchestrator.
 */

import { prisma } from '../db';
import { createLogger } from '../infra/logger';
import { loadBusinessContext } from '../lib/businessContext';
import type {
  EnrichedContext, MetaConfiguration, BusinessMemorySnapshot,
} from '../models';

export type { EnrichedContext };

const logger = createLogger('ContextBuilder');

// ─── MetaConfiguration loader ─────────────────────────────────────────────────

async function loadMetaConfig(businessId: string, category: string): Promise<MetaConfiguration | null> {
  try {
    const row = await prisma.$queryRawUnsafe<Array<{
      auto_execute_enabled: boolean;
      signal_keywords:      string[];
      local_radius_meters:  number;
    }>>(
      `SELECT auto_execute_enabled, signal_keywords, local_radius_meters
       FROM meta_configurations WHERE business_id = $1 LIMIT 1`,
      businessId,
    );
    if (!row[0]) return null;
    return {
      business_id:               businessId,
      sector:                    category,
      auto_execute_enabled:      row[0].auto_execute_enabled ?? false,
      min_confidence_threshold:  0.30,
      min_score_threshold:       30,
      approval_required_channels: ['instagram', 'facebook', 'whatsapp', 'email'],
      signal_keywords:           row[0].signal_keywords ?? [],
      local_radius_meters:       row[0].local_radius_meters ?? 500,
    };
  } catch {
    return null;
  }
}

// ─── Recent decisions loader ───────────────────────────────────────────────────

async function loadRecentDecisions(businessId: string): Promise<EnrichedContext['recent_decisions']> {
  try {
    return await prisma.$queryRawUnsafe<EnrichedContext['recent_decisions']>(
      `SELECT id, action_type, status, final_score AS score, created_at
       FROM otx_decisions
       WHERE business_id = $1
         AND created_at > NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC
       LIMIT 20`,
      businessId,
    );
  } catch {
    return [];
  }
}

// ─── Recent outcomes loader ───────────────────────────────────────────────────

async function loadRecentOutcomes(businessId: string): Promise<EnrichedContext['recent_outcomes']> {
  try {
    return await prisma.$queryRawUnsafe<EnrichedContext['recent_outcomes']>(
      `SELECT id, decision_id, outcome_type, outcome_score, conversion_flag, created_at
       FROM otx_outcome_events
       WHERE business_id = $1
         AND created_at > NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC
       LIMIT 20`,
      businessId,
    );
  } catch {
    return [];
  }
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export async function buildEnrichedContext(businessProfileId: string): Promise<EnrichedContext> {
  logger.info('Building enriched context', { businessProfileId });

  const sevenDaysAgo   = new Date(Date.now() - 7  * 86_400_000);
  const fortyEightHAgo = new Date(Date.now() - 48 * 3_600_000);

  const [
    profile,
    signals,
    allLeads,
    competitors,
    latestHealth,
    recentReviews,
    negReviews7d,
    pendingReviews,
    sectorKnowledge,
    predictions,
    recentActions,
  ] = await Promise.all([
    prisma.businessProfile.findUnique({ where: { id: businessProfileId } }),
    prisma.marketSignal.findMany({
      where: { linked_business: businessProfileId, created_date: { gte: fortyEightHAgo } },
      orderBy: { created_date: 'desc' },
      take: 30,
    }),
    prisma.lead.findMany({
      where: { linked_business: businessProfileId, status: { notIn: ['archived', 'disqualified'] } },
      select: { status: true, score: true },
    }),
    prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      take: 10,
      select: { name: true, rating: true, trend_direction: true },
    }),
    prisma.healthScore.findFirst({
      where: { linked_business: businessProfileId },
      orderBy: { created_date: 'desc' },
    }),
    prisma.review.findMany({
      where: { linked_business: businessProfileId },
      select: { rating: true, created_date: true },
      take: 100,
    }),
    prisma.review.count({
      where: {
        linked_business: businessProfileId,
        created_date: { gte: sevenDaysAgo },
        OR: [{ sentiment: 'negative' }, { rating: { lte: 2 } }],
      },
    }),
    prisma.review.count({
      where: { linked_business: businessProfileId, response_status: 'pending' },
    }),
    prisma.sectorKnowledge.findFirst({
      where: {
        sector: (await prisma.businessProfile.findUnique({
          where: { id: businessProfileId }, select: { category: true },
        }))?.category || '',
      },
    }),
    prisma.prediction.findMany({
      where: { linked_business: businessProfileId, status: 'active' },
      take: 5,
      select: { title: true, confidence: true, timeframe: true, impact_level: true },
    }),
    prisma.action.findMany({
      where: { linked_business: businessProfileId, created_date: { gte: sevenDaysAgo } },
      select: { title: true, type: true, status: true },
      orderBy: { created_date: 'desc' },
      take: 10,
    }),
  ]);

  if (!profile) throw new Error(`Business profile not found: ${businessProfileId}`);

  // Parallel secondary loads
  const [mem, metaConfig, recentDecisions, recentOutcomes] = await Promise.all([
    loadBusinessContext(businessProfileId),
    loadMetaConfig(businessProfileId, profile.category),
    loadRecentDecisions(businessProfileId),
    loadRecentOutcomes(businessProfileId),
  ]);

  // Aggregate leads
  const hot      = allLeads.filter(l => l.status === 'hot').length;
  const warm     = allLeads.filter(l => l.status === 'warm').length;
  const newL     = allLeads.filter(l => l.status === 'new').length;
  const scores   = allLeads.map(l => l.score ?? 0).filter(s => s > 0);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  // Reviews avg
  const ratings   = recentReviews.map(r => r.rating ?? 0).filter(r => r > 0);
  const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  // Recent decisions summary (legacy string format)
  const recentDecisionsSummary = recentActions.map(a => `${a.title} (${a.type}) — ${a.status}`);

  // Sector knowledge
  const sk = sectorKnowledge ? {
    avg_rating:        sectorKnowledge.avg_rating,
    trending_services: sectorKnowledge.trending_services,
    winner_lead_dna:   sectorKnowledge.winner_lead_dna
      ? JSON.parse(sectorKnowledge.winner_lead_dna as string) : null,
  } : null;

  const recentSignalsList = signals.map(s => ({
    id:           s.id,
    summary:      s.summary,
    category:     s.category,
    impact_level: s.impact_level,
    detected_at:  s.detected_at,
  }));

  // Build memory snapshot
  const memorySnapshot: BusinessMemorySnapshot | null = mem ? {
    business_id:                 businessProfileId,
    preferred_tone:              mem.preferredTone,
    preferred_channels:          mem.preferredChannels,
    rejected_patterns:           mem.rejectedPatterns,
    accepted_patterns:           mem.acceptedPatterns,
    agent_weights:               mem.agentWeights,
    lead_preferences:            {},
    content_style:               {},
    feedback_summary:            {},
    channel_preferences:         {},
    timing_preferences:          {},
    tone_preferences:            mem.preferredTone ? [mem.preferredTone] : [],
    sector_specific_preferences: {},
    last_updated_at:             new Date().toISOString(),
  } : null;

  const ctx: EnrichedContext = {
    context_id:         `ctx-${Date.now()}-${businessProfileId.slice(0, 8)}`,
    business_id:        businessProfileId,
    built_at:           new Date().toISOString(),
    // Populated by MarketIntelligenceService in MasterOrchestrator stage
    market_insights:    [],
    trust_state:        null,
    churn_risk_state:   null,
    profile: {
      name:        profile.name,
      category:    profile.category,
      city:        profile.city,
      plan_id:     profile.plan_id ?? null,
      description: profile.description ?? null,
      owner_name:  (profile as any).owner_name ?? null,
      phone:       (profile as any).phone ?? null,
    },
    meta_configuration: metaConfig,
    recent_signals:     recentSignalsList,
    signals: {
      total:        recentSignalsList.length,
      high_urgency: recentSignalsList.filter(s => s.impact_level === 'high').length,
    },
    // Populated by OpportunityDetector / ThreatDetector after context is built
    active_opportunities: [],
    active_threats:       [],
    trends:               [],
    forecasts:            [],
    leads: { total: allLeads.length, hot, warm, new: newL, avg_score: Math.round(avgScore) },
    competitors: competitors.map(c => ({
      name:            c.name,
      rating:          c.rating ?? null,
      trend_direction: c.trend_direction ?? null,
    })),
    health_score:  latestHealth?.overall_score ?? null,
    health_details: {
      reputation:  latestHealth?.reputation_score  ?? null,
      leads:       latestHealth?.leads_score        ?? null,
      competition: latestHealth?.competition_score  ?? null,
      market:      latestHealth?.market_score       ?? null,
      engagement:  latestHealth?.engagement_score   ?? null,
      seo:         latestHealth?.seo_score          ?? null,
    },
    reviews: {
      total:            recentReviews.length,
      avg_rating:       avgRating !== null ? Math.round(avgRating * 10) / 10 : null,
      negative_last7d:  negReviews7d,
      pending_response: pendingReviews,
    },
    sector_knowledge: sk,
    active_predictions: predictions.map(p => ({
      title:      p.title,
      confidence: p.confidence,
      timeframe:  p.timeframe,
      impact:     p.impact_level,
    })),
    memory:                   memorySnapshot,
    recent_decisions:         recentDecisions,
    recent_outcomes:          recentOutcomes,
    recent_decisions_summary: recentDecisionsSummary,
  };

  logger.info('Context built', {
    businessProfileId,
    signals:      ctx.recent_signals.length,
    leads:        ctx.leads.total,
    competitors:  ctx.competitors.length,
    hasMemory:    !!ctx.memory,
    hasMeta:      !!ctx.meta_configuration,
  });

  return ctx;
}
