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
import { runPipeline } from './orchestration/MasterOrchestrator';
import { createLogger } from './infra/logger';

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

async function runForAll(
  label: string,
  mode: 'full' | 'partial' | 'signal_only' | 'decision_only' = 'full',
  skipStages: import('../models').PipelineStage[] = [],
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

  // ── Every hour: full intelligence pipeline ──────────────────────────────────
  cron.schedule('0 * * * *', () => {
    runForAll('HourlyPipeline', 'full', []);
  });

  // ── Every 6 hours: signal_only (leads + freshness) ──────────────────────────
  cron.schedule('0 */6 * * *', () => {
    runForAll('LeadGenCycle', 'signal_only');
  });

  // ── Every 24 hours at 03:00 UTC: decision_only (ML learning) ────────────────
  cron.schedule('0 3 * * *', () => {
    runForAll('DailyLearning', 'decision_only');
  });

  // ── Every 15 min: keep-alive log ─────────────────────────────────────────────
  cron.schedule('*/15 * * * *', () => {
    logger.info('Scheduler heartbeat');
  });

  logger.info('Scheduler started — pipelines will run hourly');
}
