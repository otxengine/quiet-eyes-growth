import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { collectWebSignals } from './collectWebSignals';
import { collectSocialSignals } from './collectSocialSignals';
import { collectReviews } from './collectReviews';
import { synthesizeMarketInsights } from './synthesizeMarketInsights';
import { runIntelligenceEngines } from './runIntelligenceEngines';
import { runCompetitorIdentification } from './runCompetitorIdentification';
import { runLeadGeneration } from './runLeadGeneration';
import { findSocialLeads } from './findSocialLeads';
import { findLocalEvents } from './findLocalEvents';
import { detectTrends } from './detectTrends';
import { detectEarlyTrends } from './detectEarlyTrends';
import { detectViralSignals } from './detectViralSignals';
import { tiktokSectorTrendAgent } from './tiktokSectorTrendAgent';
import { calculateHealthScore } from './calculateHealthScore';
import { generateMorningBriefing } from './generateMorningBriefing';
import { runPredictions } from './runPredictions';
import { generateProactiveAlerts } from './generateProactiveAlerts';
import { generateAdvisoryInsights } from './generateAdvisoryInsights';
import { cleanupInsights } from './cleanupInsights';
import { updateLeadFreshness as applyDataFreshness } from './updateLeadFreshness';
import { runMLLearning } from './learnFromClosedDeals';
import { runMLLearningCycle } from './runMLLearningCycle';
import { cleanupAndLearn } from './cleanupAndLearn';
import { analyzeInstagramComments } from './analyzeInstagramComments';
import { analyzeSocialComments } from './analyzeSocialComments';
import { analyzeTikTokContent } from './analyzeTikTokContent';
import { updateSectorKnowledge } from './updateSectorKnowledge';
import { marketMemoryEngine } from './marketMemoryEngine';
import { microMomentDetector } from './microMomentDetector';
import { sentimentVelocityMonitor } from './sentimentVelocityMonitor';
import { bootstrapBusinessIntelligence } from '../../lib/bootstrapIntelligence';
import { evaluateCollectionStatus } from '../../lib/collectionStatus';
import { contentPerformanceAgent } from './contentPerformanceAgent';
import { reviewRequestTimingAgent } from './reviewRequestTimingAgent';
import { learnFromWebsite } from './stubs';

// ponytail: inline from src/lib/planConfig.js — update both if plan limits change
const PLAN_SCAN_LIMITS: Record<string, number> = {
  free_trial: 1,
  free:       1,   // schema default maps to free_trial
  starter:    4,
  growth:     30,
  pro:        Infinity,
  enterprise: Infinity,
};

async function callHandler(fn: Function, businessProfileId: string): Promise<any> {
  return Promise.race([
    new Promise((resolve) => {
      const fakeReq = { body: { businessProfileId } } as Request;
      let done = false;
      const fakeRes: any = {
        json: (data: any) => { if (!done) { done = true; resolve(data); } return fakeRes; },
        status: (_: number) => fakeRes,
      };
      // .then() defers fn() to a microtask so synchronous throws are caught by .catch()
      Promise.resolve().then(() => fn(fakeReq, fakeRes)).catch((e: any) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (!done) { console.error(`[runFullScan] collector error (${businessProfileId}):`, msg); done = true; resolve({ error: msg }); }
      });
    }),
    new Promise(resolve => { const t = setTimeout(() => resolve({ error: 'timeout' }), 120_000); if (t?.unref) t.unref(); }),
  ]);
}

export async function runFullScan(req: Request, res: Response) {
  let { businessProfileId } = req.body;

  if (!businessProfileId) {
    const profiles = await prisma.businessProfile.findMany({ orderBy: { created_date: 'desc' }, take: 1 });
    businessProfileId = profiles[0]?.id;
  }
  if (!businessProfileId) return res.json({ success: false, message: 'No business profile found' });

  const startTime = new Date().toISOString();
  const results: Record<string, any> = {};

  const profileRows = await prisma.businessProfile.findMany({ where: { id: businessProfileId }, take: 1 });
  const profile = profileRows[0];

  // Load agent_weights to skip consistently low-accuracy agents for this business
  let agentWeights: Record<string, number> = {};
  try {
    const bizMem = await prisma.businessMemory.findFirst({ where: { linked_business: businessProfileId } });
    if (bizMem?.agent_weights) {
      agentWeights = JSON.parse(bizMem.agent_weights);
    }
  } catch {}

  // Auto-bootstrap missing intelligence for accounts that predate the new onboarding flow
  if (profile && (!profile.sector_profile || !(profile as any).agent_missions)) {
    bootstrapBusinessIntelligence(businessProfileId).catch(e =>
      console.warn('[runFullScan] bootstrap warning:', e.message)
    );
  }

  // Cooldown: prevent burning API budget with multiple full scans within 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    const recentScan = await prisma.automationLog.findFirst({
      where: {
        automation_name: 'runFullScan',
        linked_business: businessProfileId,
        created_date: { gt: oneDayAgo },
      },
      orderBy: { created_date: 'desc' },
    });
    if (recentScan) {
      const nextScanAt = new Date(recentScan.created_date.getTime() + 24 * 60 * 60 * 1000);
      return res.json({
        success: false,
        cooldown: true,
        message: `סריקה מלאה כבר בוצעה לאחרונה. הסריקה הבאה אפשרית ב-${nextScanAt.toLocaleTimeString('he-IL')} (cooldown: 24 שעות).`,
        last_scan: recentScan.created_date,
        next_scan_at: nextScanAt.toISOString(),
      });
    }
  } catch (_) {
    // automationLog query failure → continue scan (don't block on cooldown check)
  }

  // Plan scan-limit enforcement (KAN-20 AC2)
  const plan      = profile?.plan_id ?? 'free_trial';
  const scanLimit = PLAN_SCAN_LIMITS[plan] ?? PLAN_SCAN_LIMITS.free_trial;
  if (isFinite(scanLimit)) {
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const scansThisMonth = await prisma.automationLog.count({
        where: { automation_name: 'runFullScan', linked_business: businessProfileId, created_date: { gte: startOfMonth } },
      });
      if (scansThisMonth >= scanLimit) {
        return res.json({ success: false, plan_limit: true, plan, scans_used: scansThisMonth, scans_allowed: scanLimit });
      }
    } catch (_) {
      // DB failure → allow scan (don't block on limit check)
    }
  }

  // tiktokSectorTrendAgent uses Apify (real TikTok data) — skip if ran within 12h
  let tiktokSectorHandler: Function = tiktokSectorTrendAgent;
  try {
    const last12h = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const recentTT = await prisma.automationLog.findFirst({
      where: { automation_name: 'tiktokSectorTrendAgent', linked_business: businessProfileId, created_date: { gt: last12h } },
      orderBy: { created_date: 'desc' },
    });
    if (recentTT) {
      tiktokSectorHandler = (_req: Request, res: Response) =>
        res.json({ skipped: true, reason: 'tiktokSectorTrendAgent ran within 12h' });
    }
  } catch (_) {}

  // detectEarlyTrends is expensive (12 Tavily + 5 SerpAPI) — skip if ran within 48h
  let earlyTrendsHandler: Function = detectEarlyTrends;
  try {
    const last48h = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const recentET = await prisma.automationLog.findFirst({
      where: { automation_name: 'detectEarlyTrends', linked_business: businessProfileId, created_date: { gt: last48h } },
      orderBy: { created_date: 'desc' },
    });
    if (recentET) {
      earlyTrendsHandler = (_req: Request, res: Response) =>
        res.json({ skipped: true, reason: 'detectEarlyTrends ran within 48h — trends do not change hourly' });
    }
  } catch (_) {}

  // KAN-9 prep: scrape brand voice/context before collectors — fire-and-forget, does not block response
  if (profile?.website_url) {
    new Promise<void>((resolve) => {
      const fakeReq = { body: { businessProfileId, websiteUrl: profile.website_url } } as Request;
      const fakeRes: any = { json: () => { resolve(); return fakeRes; }, status: () => fakeRes };
      Promise.resolve().then(() => learnFromWebsite(fakeReq, fakeRes)).catch((e: any) => {
        console.warn('[runFullScan] learnFromWebsite prep error:', e.message);
        resolve();
      });
    });
  } else {
    console.log('[runFullScan] learnFromWebsite skipped — no website_url on profile');
  }

  // Full pipeline — ordered from data collection → analysis → learning → cleanup
  const pipeline: Array<[string, Function]> = [
    // ── Cleanup first — make room before any generator adds new insights ──────
    ['cleanupInsights',             cleanupInsights],
    // ── Data Collection ──────────────────────────────────────────
    ['collectWebSignals',           collectWebSignals],
    ['collectSocialSignals',        collectSocialSignals],
    ['analyzeInstagramComments',    analyzeInstagramComments],
    ['analyzeSocialComments',       analyzeSocialComments],
    ['analyzeTikTokContent',        analyzeTikTokContent],
    ['collectReviews',              collectReviews],
    // ── Analysis ────────────────────────────────────────────────
    ['synthesizeMarketInsights',    synthesizeMarketInsights],
    ['runIntelligenceEngines',      runIntelligenceEngines],
    ['runCompetitorIdentification', runCompetitorIdentification],
    ['runLeadGeneration',           runLeadGeneration],
    ['findSocialLeads',             findSocialLeads],
    ['findLocalEvents',             findLocalEvents],
    // ── Trend Intelligence ───────────────────────────────────────
    ['tiktokSectorTrendAgent',      tiktokSectorHandler],
    ['detectTrends',                detectTrends],
    ['detectEarlyTrends',           earlyTrendsHandler],
    ['detectViralSignals',          detectViralSignals],
    // ── Market Memory + Moment Detection ────────────────────────
    ['marketMemoryEngine',          marketMemoryEngine],    // learns seasonal patterns → BusinessMemory
    ['microMomentDetector',         microMomentDetector],   // finds upcoming purchase moments
    ['sentimentVelocityMonitor',    sentimentVelocityMonitor], // detects rapid sentiment drops
    // ── Predictive + Alerts ──────────────────────────────────────
    ['runPredictions',              runPredictions],
    ['applyDataFreshness',          applyDataFreshness],
    ['generateProactiveAlerts',     generateProactiveAlerts],
    ['generateAdvisoryInsights',    generateAdvisoryInsights],
    // ── Learning + Optimization ──────────────────────────────────
    ['runMLLearning',               runMLLearning],
    ['runMLLearningCycle',          runMLLearningCycle],
    ['calculateHealthScore',        calculateHealthScore],
    // ── Cleanup (last — runs after learning) ────────────────────
    ['cleanupAndLearn',             cleanupAndLearn],
    // ── Sector learning — aggregates cross-business patterns ─────
    ['updateSectorKnowledge',       updateSectorKnowledge],
    // ── Content & review performance agents ─────────────────────
    ['contentPerformanceAgent',     contentPerformanceAgent],
    ['reviewRequestTimingAgent',    reviewRequestTimingAgent],
    // ── Briefing (always last) ───────────────────────────────────
    ['generateMorningBriefing',     generateMorningBriefing],
  ];

  // Run the first 3 critical agents synchronously (fast, needed for UI refresh)
  const immediate: Array<[string, Function]> = pipeline.slice(0, 3);
  // Skip agents with weight < 0.3 — they've been consistently wrong for this business
  const deferred: Array<[string, Function]> = pipeline.slice(3).filter(([name]) => {
    const weight = agentWeights[name];
    if (weight !== undefined && weight < 0.3) {
      console.log(`[runFullScan] skipping ${name} — agent_weight=${weight.toFixed(2)} < 0.3`);
      return false;
    }
    return true;
  });

  for (const [name, fn] of immediate) {
    try {
      results[name] = await callHandler(fn, businessProfileId);
    } catch (e: any) {
      results[name] = { error: e.message };
    }
  }

  // Respond to the client immediately — do NOT make the HTTP call wait for all 20 agents
  res.json({ success: true, profile_name: profile?.name, results });

  // Run remaining agents in background (fire-and-forget)
  (async () => {
    // Write cooldown record first so 24h gate holds even if pipeline crashes mid-run
    await writeAutomationLog('runFullScan', businessProfileId, startTime, pipeline.length);
    for (const [name, fn] of deferred) {
      try {
        results[name] = await callHandler(fn, businessProfileId);
      } catch (e: any) {
        results[name] = { error: e.message };
      }
    }
    // KAN-34: evaluate §2.1 success definition after all collectors complete
    const rawSignals =
      (results['collectWebSignals']?.new_signals  ?? 0) +
      (results['collectSocialSignals']?.new_signals ?? 0);
    const collStatus = evaluateCollectionStatus({
      rawSignals,
      reviews:  results['collectReviews']?.new_reviews ?? 0,
      gmbPath:  results['collectReviews']?.gmb_path    ?? 'not_connected',
    });
    await writeAutomationLog(
      'runFullScan:collectionStatus', businessProfileId, startTime,
      rawSignals + (results['collectReviews']?.new_reviews ?? 0),
      'success',
      `collection_status:${collStatus}`,
    );
    console.log(`[runFullScan] background pipeline complete for ${profile?.name} — ${collStatus}`);
  })().catch(e => console.error('[runFullScan] background error:', e.message));
}
