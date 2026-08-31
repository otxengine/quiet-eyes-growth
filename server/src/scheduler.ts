/**
 * Background scheduler — runs agent pipelines for all active business profiles.
 *
 * Schedule (all times UTC):
 *  - 02:00 daily:    multi-platform trend intelligence (Instagram/Facebook/Google trends,
 *                    each self-throttles to a 20h cadence)
 *  - 03:00 daily:    cleanup + review automation + ML learning + HealthScore +
 *                    SectorKnowledge (+10min delayed) + forecasting
 *  - 04:00 daily:    competitor snapshot diff + URL discovery/enrichment (7-day cadence)
 *  - 05:30 daily:    data ingestion — reviews, web signals, lead gen, social leads,
 *                    competitor social posts/profile/stories, own social posts/profile
 *                    (+5min delayed lead intent classification)
 *  - 07:00 daily:    full intelligence pipeline + competitor pipeline stages + own ad
 *                    detection + social + insight generators (+15min delayed)
 *                    (includes local events + calendar events — each self-throttles to a 3-day cadence)
 *  - Sunday 20:00:   content calendar + sector benchmark + weekly email digest (+10min delayed)
 *  - Every 6h:       OTX competitor snapshot diff (OTX_COMPETITOR_SNAPSHOT_DISABLED kill switch)
 *  - Every 10min:    OTX sync bridge (OTX_SYNC_BRIDGE_DISABLED kill switch)
 *  - Every 30min:    execute queued semi_auto actions
 *  - Every 15min:    DataForSEO review-task reconciliation (DATAFORSEO_RECONCILE_DISABLED
 *                    kill switch) + a separate keep-alive heartbeat log
 *  - Hourly:         collector failure-rate alert check
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
import { discoverCompetitorUrls } from './routes/functions/discoverCompetitorUrls';
import { enrichCompetitorUrlsScheduled } from './routes/functions/enrichCompetitorUrls';
import { detectCompetitorChanges } from './routes/functions/detectCompetitorChanges';
import { analyzeCompetitorSocial } from './routes/functions/analyzeCompetitorSocial';
import { detectCompetitorAds } from './routes/functions/detectCompetitorAds';
import { scheduledAnalyzeSocialPosts } from './routes/functions/analyzeSocialPosts';
import { competitorMoveTracker } from './routes/functions/competitorMoveTracker';
import { findLocalEvents } from './routes/functions/findLocalEvents';
import { instagramTrendAgent } from './routes/functions/instagramTrendAgent';
import { facebookGroupTrendAgent } from './routes/functions/facebookGroupTrendAgent';
import { googleTrendsScanAgent } from './routes/functions/googleTrendsScanAgent';
import { cleanupInsights } from './routes/functions/cleanupInsights';
import { cleanupAndLearn } from './routes/functions/cleanupAndLearn';
import { weeklyEmailDigest } from './routes/functions/weeklyEmailDigest';
import { writeHeartbeat } from './lib/agentMonitor';
import { writeAutomationLog } from './lib/automationLog';
import { checkAndAlertFailureRate } from './lib/collectorMetrics';
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
import { collectOTXCompetitorChanges } from './routes/functions/collectOTXCompetitorChanges';
import { runOTXSyncBridge } from './routes/functions/runOTXSyncBridge';
import { collectCompetitorSocialPosts } from './routes/functions/collectCompetitorSocialPosts';
import { collectOwnSocialPosts } from './routes/functions/collectOwnSocialPosts';
import { collectOwnSocialProfile } from './routes/functions/collectOwnSocialProfile';
import { detectOwnAds } from './routes/functions/detectOwnAds';
import { collectCompetitorSocialProfile } from './routes/functions/collectCompetitorSocialProfile';
import { collectCompetitorSocialStories } from './routes/functions/collectCompetitorSocialStories';
import { reconcileDataForSeoReviewTasks } from './routes/functions/reconcileDataForSeoReviewTasks';

const logger = createLogger('Scheduler');

// How many businesses to process concurrently.
// ponytail: paired with connection_limit in db.ts — raise/lower together, not independently.
// Watch Render logs for pool_timeout / Prisma P2024 after changing; back off to 2 if seen.
const CONCURRENCY = 4;

async function getActiveProfiles(): Promise<string[]> {
  try {
    const profiles = await prisma.businessProfile.findMany({
      where: { onboarding_completed: true },
      select: { id: true, name: true },
    });
    return profiles.map((p: { id: string }) => p.id);
  } catch (err: any) {
    logger.error('Failed to fetch active profiles', { error: err.message });
    return [];
  }
}

/** Runs a single growth agent function for all active profiles */
export async function runAgentForAll(label: string, agentFn: Function, extraBody: Record<string, any> = {}) {
  const ids = await getActiveProfiles();
  if (ids.length === 0) return;
  logger.info(`${label}: running for ${ids.length} profile(s)`);
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (id) => {
        const fakeReq = { body: { businessProfileId: id, ...extraBody } } as any;
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
    const startTime = new Date().toISOString();
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
      await writeAutomationLog('intentClassification', businessProfileId, startTime, newLeads.length);
    } catch (err: any) {
      logger.error('enrichNewLeadsWithIntent failed', { businessProfileId, error: err.message });
      await writeAutomationLog('intentClassification', businessProfileId, startTime, 0, 'failed', err.message);
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
    runAgentForAll('FindSocialLeads', findSocialLeads);
    runAgentForAll('CollectCompetitorSocialPosts', collectCompetitorSocialPosts);
    runAgentForAll('CollectCompetitorSocialProfile', collectCompetitorSocialProfile);
    runAgentForAll('CollectCompetitorSocialStories', collectCompetitorSocialStories);
    runAgentForAll('CollectOwnSocialPosts', collectOwnSocialPosts);
    runAgentForAll('CollectOwnSocialProfile', collectOwnSocialProfile);
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
    // Dual change pipeline: DetectCompetitorChanges (Express/Tavily) + collectOTXCompetitorChanges (OTX/6h cron)
    // both write to market_signals[category='competitor_move']. runOTXSyncBridge (every 10min) bridges the OTX leg.
    // DetectCompetitorChanges no longer uses last_scanned as its guard (race with BatchSnapshotCompetitors);
    // it relies on the 48h MarketSignal dedup instead.
    runAgentForAll('BatchSnapshotCompetitors', batchSnapshotCompetitors); // takes fresh snapshots + writes last_scanned
    runAgentForAll('DetectCompetitorChanges',  detectCompetitorChanges);  // prices/promos/posts → MarketSignals (48h dedup)
    runAgentForAll('AnalyzeCompetitorSocial',   analyzeCompetitorSocial);   // social enrichment + promo/ads/product detection → new fields + alerts
    runAgentForAll('DetectCompetitorAds',       detectCompetitorAds);       // Meta/Google paid ad campaigns → ProactiveAlerts
    runAgentForAll('DetectOwnAds',              detectOwnAds);              // own Meta/Google ad campaigns → self-audit MarketSignal (48h guard)
    runAgentForAll('AnalyzeSocialPosts', scheduledAnalyzeSocialPosts); // deep content-strategy analysis, grounded in per-post vision analysis (48h/competitor guard)
    runAgentForAll('CompetitorIntel',           competitorIntelAgent);      // OSINT × events → ProactiveAlerts
    runAgentForAll('CompetitorMoveTracker',     competitorMoveTracker);     // DB-level moves → ProactiveAlerts
    // ── Social agents ────────────────────────────────────────────────────────
    runAgentForAll('FetchSocialInsights', fetchSocialInsights);
    runAgentForAll('SchedulePostPublisher', schedulePostPublisher);
    runAgentForAll('AnalyzeInstagramComments', analyzeInstagramComments);
    // ── Events (checked daily, self-throttle to 3 days via agentCache) ───────
    runAgentForAll('FindLocalEvents', findLocalEvents); // Tavily + LLM — 3-day guard
    runAgentForAll('DetectEvents', detectEvents);        // calendar-based — 3-day guard
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

  // ── Every 24 hours at 02:00 UTC: Multi-platform trend intelligence ─────────────
  // Each agent has its own 20h checkpoint guard so double-runs are safely skipped.
  cron.schedule('0 2 * * *', () => {
    (async () => {
      await runAgentForAll('InstagramTrendAgent', instagramTrendAgent);    // 20h guard
      await runAgentForAll('FacebookGroupTrends', facebookGroupTrendAgent); // 20h guard
      await runAgentForAll('GoogleTrendsScan',    googleTrendsScanAgent);   // 20h guard
    })().catch(err => logger.error('02:00 trend pack failed', { error: err.message }));
  });

  // ── Every Sunday at 20:00 UTC: weekly content calendar + email digest ────────
  cron.schedule('0 20 * * 0', () => {
    runAgentForAll('ContentCalendarAgent', contentCalendarAgent);
    runAgentForAll('SectorBenchmark', sectorBenchmark); // cross-business benchmarking (weekly cadence)
    // WeeklyEmailDigest runs 10 min after contentCalendar so digest can include latest posts
    setTimeout(() => runAgentForAll('WeeklyEmailDigest', weeklyEmailDigest), 10 * 60 * 1000);
  });

  // ── Every day at 04:00 UTC: competitor snapshot diff + URL discovery (KAN-160) ──
  // discoverCompetitorUrls runs on its own social_pages_crawled_at guard (7d),
  // independent of snapshot last_scanned — satisfies KAN-160 AC4.
  // enrichCompetitorUrlsScheduled (KAN-221) is a second, independent catch-up on the
  // same guard field — free site-extract fallback for rivals discoverCompetitorUrls
  // (paid SERP APIs) hasn't filled yet.
  cron.schedule('0 4 * * *', () => {
    runAgentForAll('DiffCompetitorSnapshot', diffCompetitorSnapshot);
    runAgentForAll('DiscoverCompetitorUrls', discoverCompetitorUrls);
    runAgentForAll('EnrichCompetitorUrls', enrichCompetitorUrlsScheduled);
  });

  // ── Every 6 hours: OTX competitor snapshot diff (KAN-45) ─────────────────────
  // Kill switch: set OTX_COMPETITOR_SNAPSHOT_DISABLED=true in Render env to disable without redeploy.
  if (process.env.OTX_COMPETITOR_SNAPSHOT_DISABLED !== 'true') {
    cron.schedule('0 */6 * * *', () => {
      collectOTXCompetitorChanges()
        .catch(err => logger.error('collectOTXCompetitorChanges failed', { error: err.message }));
    });
  }

  // ── Every 10 min: OTX sync bridge — OTX tables → QE Prisma entities (KAN-46) ─
  // Kill switch: set OTX_SYNC_BRIDGE_DISABLED=true in Render env to disable without redeploy.
  if (process.env.OTX_SYNC_BRIDGE_DISABLED !== 'true') {
    cron.schedule('*/10 * * * *', () => {
      runOTXSyncBridge()
        .catch(err => logger.error('runOTXSyncBridge failed', { error: err.message }));
    });
  }

  // ── Every 30 min: semi_auto actions ───────────────────────────
  cron.schedule('*/30 * * * *', () => {
    processScheduledAutoActions()
      .catch(err => logger.error('processScheduledAutoActions failed', { error: err.message }));
  });

  // ── Every 15 min: DataForSEO review task reconciliation (missed postbacks) ───
  // Kill switch: set DATAFORSEO_RECONCILE_DISABLED=true in Render env to disable.
  if (process.env.DATAFORSEO_RECONCILE_DISABLED !== 'true') {
    cron.schedule('*/15 * * * *', () => {
      reconcileDataForSeoReviewTasks()
        .catch(err => logger.error('reconcileDataForSeoReviewTasks failed', { error: err.message }));
    });
  }

  // ── Every 15 min: keep-alive log ─────────────────────────────────────────────
  cron.schedule('*/15 * * * *', () => {
    logger.info('Scheduler heartbeat');
  });

  // ── Every hour: collector failure-rate alert check (KAN-26) ──────────────────
  cron.schedule('0 * * * *', async () => {
    logger.info('Hourly: collector failure rate check');
    await checkAndAlertFailureRate().catch(e => logger.warn(`collectorMetrics alert check failed: ${e.message}`));
  });

  logger.info('Scheduler started — pipelines will run hourly');
}
