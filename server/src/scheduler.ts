/**
 * Background scheduler — runs agent pipelines for all active business profiles.
 *
 * Schedule (all times UTC):
 *  - 02:00 daily:  multi-platform trend intelligence (Instagram/Facebook/Google trends)
 *  - 03:00 daily:  cleanup + ML learning + HealthScore + SectorKnowledge + forecasting
 *  - 04:00 daily:  competitor snapshot diff
 *  - 05:30 daily:  data ingestion (reviews, web signals, lead gen, social leads)
 *  - 07:00 daily:  full intelligence pipeline + competitors + social + insight generators
 *  - Mon+Thu 07:00: local events + calendar events sync
 *  - Sunday 20:00: content calendar + sector benchmark + weekly email digest
 *  - Every 30min:  execute queued semi_auto actions
 *  - Every 15min:  keep-alive heartbeat
 */

import cron from 'node-cron';
import { prisma } from './db';
import { runPipeline, OrchestratorOptions } from './orchestration/MasterOrchestrator';
import { createLogger } from './infra/logger';
import type { PipelineStage } from './models';
import { autoRespondToReviews } from './routes/functions/autoRespondToReviews';
import { processScheduledAutoActions } from './services/execution/executeOrQueue';
import { reviewRequestAutomation } from './routes/functions/reviewRequestAutomation';
import { googleRankMonitor } from './routes/functions/googleRankMonitor';
import { smartLeadNurture } from './routes/functions/smartLeadNurture';
import { contentCalendarAgent } from './routes/functions/contentCalendarAgent';
import { detectEvents } from './routes/functions/detectEvents';
import { competitorIntelAgent } from './routes/functions/competitorIntelAgent';
import { detectDeliveryChanges } from './routes/functions/detectDeliveryChanges';
import { fetchSocialInsights } from './routes/functions/fetchSocialInsights';
import { schedulePostPublisher } from './routes/functions/schedulePostPublisher';
import { analyzeInstagramComments } from './routes/functions/analyzeInstagramComments';
import { diffCompetitorSnapshot } from './routes/functions/diffCompetitorSnapshot';
import { batchSnapshotCompetitors } from './routes/functions/batchSnapshotCompetitors';
import { detectCompetitorChanges } from './routes/functions/detectCompetitorChanges';
import { analyzeCompetitorSocial } from './routes/functions/analyzeCompetitorSocial';
import { detectCompetitorAds } from './routes/functions/detectCompetitorAds';
import { competitorMoveTracker } from './routes/functions/competitorMoveTracker';
import { tiktokSectorTrendAgent } from './routes/functions/tiktokSectorTrendAgent';
import { tiktokAudienceAgent } from './routes/functions/tiktokAudienceAgent';
import { tiktokPostTracker } from './routes/functions/tiktokPostTracker';
import { findLocalEvents } from './routes/functions/findLocalEvents';
import { refreshExpiringTikTokTokens } from './lib/tiktokTokenRefresh';
import { instagramTrendAgent } from './routes/functions/instagramTrendAgent';
import { facebookGroupTrendAgent } from './routes/functions/facebookGroupTrendAgent';
import { googleTrendsScanAgent } from './routes/functions/googleTrendsScanAgent';
import { visualTrendAnalyzer } from './routes/functions/visualTrendAnalyzer';
import { cleanupInsights } from './routes/functions/cleanupInsights';
import { cleanupAndLearn } from './routes/functions/cleanupAndLearn';
import { weeklyEmailDigest } from './routes/functions/weeklyEmailDigest';
import { writeHeartbeat } from './lib/agentMonitor';
import { generateMorningBriefing } from './routes/functions/generateMorningBriefing';
import { generateProactiveAlerts } from './routes/functions/generateProactiveAlerts';
import { generateAdvisoryInsights } from './routes/functions/generateAdvisoryInsights';
import { calculateHealthScore } from './routes/functions/calculateHealthScore';
import { updateSectorKnowledge } from './routes/functions/updateSectorKnowledge';
import { runMLLearningCycle } from './routes/functions/runMLLearningCycle';
import { runMLLearning as learnFromClosedDeals } from './routes/functions/learnFromClosedDeals';
import { updateLeadFreshness } from './routes/functions/updateLeadFreshness';
import { collectReviews } from './routes/functions/collectReviews';
import { collectWebSignals } from './routes/functions/collectWebSignals';
import { runLeadGeneration } from './routes/functions/runLeadGeneration';
import { findSocialLeads } from './routes/functions/findSocialLeads';
import { sentimentVelocityMonitor } from './routes/functions/sentimentVelocityMonitor';
import { pricingIntelligence } from './routes/functions/pricingIntelligence';
import { lostLeadRecovery } from './routes/functions/lostLeadRecovery';
import { revenueForecaster } from './routes/functions/revenueForecaster';
import { marketMemoryEngine } from './routes/functions/marketMemoryEngine';
import { demandGapEngine } from './routes/functions/demandGapEngine';
import { microMomentDetector } from './routes/functions/microMomentDetector';
import { sectorBenchmark } from './routes/functions/sectorBenchmark';
import { intentClassification } from './routes/functions/intentClassification';

const logger = createLogger('Scheduler');

// How many businesses to process concurrently (avoid hammering external APIs)
const CONCURRENCY = 2;

async function getActiveProfiles(): Promise<string[]> {
  try {
    const profiles = await prisma.businessProfile.findMany({
      where: { onboarding_completed: true },
      select: { id: true, name: true },
    });
    return profiles.map(p => p.id);
  } catch (err: any) {
    logger.error('Failed to fetch active profiles', { error: err.message });
    return [];
  }
}

/** Runs a single growth agent function for all active profiles */
async function runAgentForAll(label: string, agentFn: Function) {
  const ids = await getActiveProfiles();
  if (ids.length === 0) return;
  logger.info(`${label}: running for ${ids.length} profile(s)`);
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (id) => {
        const fakeReq = { body: { businessProfileId: id } } as any;
        const fakeRes = {
          json: (data: any) => logger.info(`${label} result`, { id, data }),
          status: () => ({ json: (e: any) => logger.error(`${label} error`, { id, e }) }),
        } as any;
        try {
          await agentFn(fakeReq, fakeRes);
          await writeHeartbeat(label, id, 'ok');
        } catch (err: any) {
          // Retry once after 3s before marking as failed
          try {
            await new Promise(r => setTimeout(r, 3000));
            await agentFn(fakeReq, fakeRes);
            await writeHeartbeat(label, id, 'ok');
          } catch (retryErr: any) {
            logger.error(`${label}: failed after retry`, { id, error: retryErr.message });
            await writeHeartbeat(label, id, 'failed', retryErr.message);
          }
        }
      }),
    );
  }
}

async function runForAll(
  label: string,
  mode: OrchestratorOptions['mode'] = 'full',
  skipStages: PipelineStage[] = [],
) {
  const ids = await getActiveProfiles();
  if (ids.length === 0) {
    logger.info(`${label}: no active profiles, skipping`);
    return;
  }

  logger.info(`${label}: running pipeline for ${ids.length} profile(s)`, { mode, skipStages });

  // Process in batches of CONCURRENCY
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(id =>
        runPipeline(id, { mode, triggeredBy: 'schedule', skipStages, forceRun: false })
          .then(() => logger.info(`${label}: done`, { id }))
          .catch(err => logger.error(`${label}: failed`, { id, error: err.message })),
      ),
    );
  }
}

/** Enriches newly discovered leads with Haiku intent classification (per-lead API) */
async function enrichNewLeadsWithIntent() {
  const ids = await getActiveProfiles();
  for (const businessProfileId of ids) {
    try {
      // Only fetch leads without intent_strength created in the last 48h
      const newLeads = await prisma.lead.findMany({
        where: {
          linked_business: businessProfileId,
          intent_strength: null,
          created_at: { gte: new Date(Date.now() - 48 * 3600000).toISOString() },
        },
        select: { id: true },
        take: 20,
      });
      for (const lead of newLeads) {
        const fakeReq = { body: { leadId: lead.id, businessProfileId } } as any;
        const fakeRes = {
          json: () => {},
          status: () => ({ json: () => {} }),
        } as any;
        try {
          await intentClassification(fakeReq, fakeRes);
        } catch (err: any) {
          logger.warn('intentClassification failed for lead', { leadId: lead.id, error: err.message });
        }
      }
    } catch (err: any) {
      logger.error('enrichNewLeadsWithIntent failed', { businessProfileId, error: err.message });
    }
  }
}

export function startScheduler() {
  logger.info('Starting background scheduler');

  // ── Every 24 hours at 05:30 UTC: data ingestion (runs BEFORE main pipeline) ──
  // Fresh data must be in DB before the 07:00 pipeline classifies & fuses it.
  cron.schedule('30 5 * * *', () => {
    runAgentForAll('CollectReviews', collectReviews);
    runAgentForAll('CollectWebSignals', collectWebSignals);
    runAgentForAll('RunLeadGeneration', runLeadGeneration);
    runAgentForAll('FindSocialLeads', findSocialLeads);
    // Enrich newly created leads with Haiku intent classification (5min after lead gen)
    setTimeout(() => enrichNewLeadsWithIntent()
      .catch(err => logger.error('enrichNewLeadsWithIntent error', { error: err.message })),
    5 * 60 * 1000);
  });

  // ── Every 24 hours at 07:00 UTC (10:00 Israel time) ─────────────────────────
  // Full pipeline + all agents — once/day to minimize token costs
  cron.schedule('0 7 * * *', () => {
    runForAll('TwiceDailyPipeline', 'full', []);
    runAgentForAll('GoogleRankMonitor', googleRankMonitor);
    runAgentForAll('SmartLeadNurture', smartLeadNurture);
    runAgentForAll('DeliveryPlatformIntel', detectDeliveryChanges);
    // ── Competitor intelligence pipeline (ordered: snapshot → changes → social → intel → moves) ──
    runAgentForAll('BatchSnapshotCompetitors', batchSnapshotCompetitors); // takes fresh snapshots
    runAgentForAll('DetectCompetitorChanges',  detectCompetitorChanges);  // prices/promos/posts → MarketSignals
    runAgentForAll('AnalyzeCompetitorSocial',   analyzeCompetitorSocial);   // social enrichment + promo/ads/product detection → new fields + alerts
    runAgentForAll('DetectCompetitorAds',       detectCompetitorAds);       // Meta/TikTok/Google paid ad campaigns → ProactiveAlerts
    runAgentForAll('CompetitorIntel',           competitorIntelAgent);      // OSINT × events → ProactiveAlerts
    runAgentForAll('CompetitorMoveTracker',     competitorMoveTracker);     // DB-level moves → ProactiveAlerts
    // ── Social agents ────────────────────────────────────────────────────────
    runAgentForAll('FetchSocialInsights', fetchSocialInsights);
    runAgentForAll('SchedulePostPublisher', schedulePostPublisher);
    runAgentForAll('AnalyzeInstagramComments', analyzeInstagramComments);
    // ── TikTok (internal cooldown guards prevent double-running) ─────────────
    runAgentForAll('TikTokSectorTrendAgent', tiktokSectorTrendAgent); // 8h guard
    runAgentForAll('TikTokAudienceAgent', tiktokAudienceAgent);       // 24h guard
    runAgentForAll('TikTokPostTracker', tiktokPostTracker);           // 12h guard
    // ── Insight generators (run after pipeline so they have fresh signals) ───
    // 15min delay: ensure MasterOrchestrator has finished fusing insights first
    setTimeout(() => {
      runAgentForAll('GenerateMorningBriefing', generateMorningBriefing);
      runAgentForAll('GenerateProactiveAlerts', generateProactiveAlerts);
      runAgentForAll('GenerateAdvisoryInsights', generateAdvisoryInsights);
      runAgentForAll('SentimentVelocityMonitor', sentimentVelocityMonitor);
      runAgentForAll('PricingIntelligence', pricingIntelligence);
      runAgentForAll('LostLeadRecovery', lostLeadRecovery);
      runAgentForAll('DemandGapEngine', demandGapEngine);
      runAgentForAll('MicroMomentDetector', microMomentDetector);
    }, 15 * 60 * 1000); // 15 min
  });

  // ── Twice a week (Mon + Thu, 07:00 UTC = 10:00 Israel): events online sync ──
  // findLocalEvents: Tavily + LLM — expensive; twice a week is sufficient for
  // concerts/festivals/TV listings that typically update Mon & Thu.
  // detectEvents: calendar-based; re-runs to catch new sports matchups revealed weekly.
  cron.schedule('0 7 * * 1,4', () => {
    runAgentForAll('FindLocalEvents', findLocalEvents);
    runAgentForAll('DetectEvents', detectEvents);
  });

  // ── Every 24 hours at 03:00 UTC: cleanup + learning + forecasting ────────────
  // Order: cleanup first → then learning agents consume clean data
  cron.schedule('0 3 * * *', () => {
    runAgentForAll('CleanupInsights', cleanupInsights);
    runAgentForAll('CleanupAndLearn', cleanupAndLearn);
    runForAll('DailyLearning', 'decision_only');
    runAgentForAll('AutoRespondToReviews', autoRespondToReviews);
    runAgentForAll('ReviewRequestAutomation', reviewRequestAutomation);
    // ── Learning & memory agents ──────────────────────────────────────────────
    runAgentForAll('RunMLLearningCycle', runMLLearningCycle);    // FeedbackEvent → BusinessMemory + AgentLearningProfile
    runAgentForAll('LearnFromClosedDeals', learnFromClosedDeals); // closed deals → SectorKnowledge
    runAgentForAll('UpdateLeadFreshness', updateLeadFreshness);   // decay stale lead scores
    // ── Analytics & scoring ───────────────────────────────────────────────────
    runAgentForAll('CalculateHealthScore', calculateHealthScore); // computes HealthScore for UI card
    runAgentForAll('RevenueForecaster', revenueForecaster);
    runAgentForAll('MarketMemoryEngine', marketMemoryEngine);
    // ── Cross-business sector learning (after deals + ML cycle) ──────────────
    // 10min delay: ensure learnFromClosedDeals has written to SectorKnowledge first
    setTimeout(() => {
      runAgentForAll('UpdateSectorKnowledge', updateSectorKnowledge);
    }, 10 * 60 * 1000); // 10 min
  });

  // ── Every 24 hours at 02:00 UTC: Multi-platform trend intelligence ────────────
  // Order matters: Instagram/Facebook/Google first → then visualTrendAnalyzer
  // processes the thumbnails they queued. Each agent has 20h checkpoint guard
  // so double-runs (e.g. if server restarts) are safely skipped.
  cron.schedule('0 2 * * *', () => {
    runAgentForAll('InstagramTrendAgent',    instagramTrendAgent);    // 20h guard
    runAgentForAll('FacebookGroupTrends',    facebookGroupTrendAgent); // 20h guard
    runAgentForAll('GoogleTrendsScan',       googleTrendsScanAgent);   // 20h guard
    // visualTrendAnalyzer runs after others so it has thumbnails to process
    setTimeout(() => runAgentForAll('VisualTrendAnalyzer', visualTrendAnalyzer), 10 * 60 * 1000);
  });

  // ── Every Sunday at 20:00 UTC: weekly content calendar + email digest ────────
  cron.schedule('0 20 * * 0', () => {
    runAgentForAll('ContentCalendarAgent', contentCalendarAgent);
    runAgentForAll('SectorBenchmark', sectorBenchmark); // cross-business benchmarking (weekly cadence)
    // WeeklyEmailDigest runs 10 min after contentCalendar so digest can include latest posts
    setTimeout(() => runAgentForAll('WeeklyEmailDigest', weeklyEmailDigest), 10 * 60 * 1000);
  });

  // ── Every day at 04:00 UTC: competitor snapshot diff (was weekly, now daily) ──
  cron.schedule('0 4 * * *', () => {
    runAgentForAll('DiffCompetitorSnapshot', diffCompetitorSnapshot);
  });

  // ── Every 30 min: execute semi_auto queued actions + refresh expiring tokens ─
  cron.schedule('*/30 * * * *', () => {
    processScheduledAutoActions()
      .catch(err => logger.error('processScheduledAutoActions failed', { error: err.message }));
    refreshExpiringTikTokTokens()
      .catch(err => logger.error('refreshExpiringTikTokTokens failed', { error: err.message }));
  });

  // ── Every 15 min: keep-alive log ─────────────────────────────────────────────
  cron.schedule('*/15 * * * *', () => {
    logger.info('Scheduler heartbeat');
  });

  logger.info('Scheduler started — pipelines will run hourly');
}
