/**
 * Background scheduler — runs agent pipelines for all active business profiles.
 *
 * Schedule (all times UTC):
 *  - Every hour:   full intelligence pipeline (signals, trends, competitors)
 *  - Every 6h:     lead generation + freshness decay
 *  - Every 24h:    ML learning cycle + weekly report prep
 *  - Every 15min:  health-check ping logged (keeps process alive)
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
import { competitorMoveTracker } from './routes/functions/competitorMoveTracker';
import { tiktokSectorTrendAgent } from './routes/functions/tiktokSectorTrendAgent';
import { tiktokAudienceAgent } from './routes/functions/tiktokAudienceAgent';
import { tiktokPostTracker } from './routes/functions/tiktokPostTracker';
import { findLocalEvents } from './routes/functions/findLocalEvents';
import { refreshExpiringTikTokTokens } from './lib/tiktokTokenRefresh';

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
      batch.map(id => {
        const fakeReq = { body: { businessProfileId: id } } as any;
        const fakeRes = {
          json: (data: any) => logger.info(`${label} result`, { id, data }),
          status: () => ({ json: (e: any) => logger.error(`${label} error`, { id, e }) }),
        } as any;
        return agentFn(fakeReq, fakeRes)
          .catch((err: any) => logger.error(`${label}: failed`, { id, error: err.message }));
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

export function startScheduler() {
  logger.info('Starting background scheduler');

  // ── Every 12 hours at 06:00 + 18:00 UTC (09:00 + 21:00 Israel time) ─────────
  // Full pipeline + all agents — 2 runs/day reduces API costs ~60% vs previous 4h cadence
  cron.schedule('0 6,18 * * *', () => {
    runForAll('TwiceDailyPipeline', 'full', []);
    runAgentForAll('GoogleRankMonitor', googleRankMonitor);
    runAgentForAll('SmartLeadNurture', smartLeadNurture);
    runAgentForAll('DeliveryPlatformIntel', detectDeliveryChanges);
    // ── Competitor intelligence pipeline (ordered: snapshot → changes → social → intel → moves) ──
    runAgentForAll('BatchSnapshotCompetitors', batchSnapshotCompetitors); // takes fresh snapshots
    runAgentForAll('DetectCompetitorChanges',  detectCompetitorChanges);  // prices/promos/posts → MarketSignals
    runAgentForAll('AnalyzeCompetitorSocial',  analyzeCompetitorSocial);  // social enrichment → new fields
    runAgentForAll('CompetitorIntel',          competitorIntelAgent);     // OSINT × events → ProactiveAlerts
    runAgentForAll('CompetitorMoveTracker',    competitorMoveTracker);    // DB-level moves → ProactiveAlerts
    // ── Social agents ────────────────────────────────────────────────────────
    runAgentForAll('FetchSocialInsights', fetchSocialInsights);
    runAgentForAll('SchedulePostPublisher', schedulePostPublisher);
    runAgentForAll('AnalyzeInstagramComments', analyzeInstagramComments);
    // ── TikTok (internal cooldown guards prevent double-running) ─────────────
    runAgentForAll('TikTokSectorTrendAgent', tiktokSectorTrendAgent); // 8h guard
    runAgentForAll('TikTokAudienceAgent', tiktokAudienceAgent);       // 24h guard
    runAgentForAll('TikTokPostTracker', tiktokPostTracker);           // 12h guard
  });

  // ── Twice a week (Mon + Thu, 07:00 UTC = 10:00 Israel): events online sync ──
  // findLocalEvents: Tavily + LLM — expensive; twice a week is sufficient for
  // concerts/festivals/TV listings that typically update Mon & Thu.
  // detectEvents: calendar-based; re-runs to catch new sports matchups revealed weekly.
  cron.schedule('0 7 * * 1,4', () => {
    runAgentForAll('FindLocalEvents', findLocalEvents);
    runAgentForAll('DetectEvents', detectEvents);
  });

  // ── Every 24 hours at 03:00 UTC: ML learning + reviews ───────────────────────
  cron.schedule('0 3 * * *', () => {
    runForAll('DailyLearning', 'decision_only');
    runAgentForAll('AutoRespondToReviews', autoRespondToReviews);
    runAgentForAll('ReviewRequestAutomation', reviewRequestAutomation);
  });

  // ── Every Sunday at 20:00 UTC: weekly content calendar ──────────────────────
  cron.schedule('0 20 * * 0', () => {
    runAgentForAll('ContentCalendarAgent', contentCalendarAgent);
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
