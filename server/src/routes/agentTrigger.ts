import { Router, Request, Response } from 'express';
import { collectWebSignals } from './functions/collectWebSignals';
import { collectSocialSignals } from './functions/collectSocialSignals';
import { runMarketIntelligence } from './functions/runMarketIntelligence';
import { runCompetitorIdentification } from './functions/runCompetitorIdentification';
import { generateProactiveAlerts } from './functions/generateProactiveAlerts';
import { runPredictions } from './functions/runPredictions';
import { updateSectorKnowledge } from './functions/updateSectorKnowledge';
import { runLeadGeneration } from './functions/runLeadGeneration';
import { calculateHealthScore } from './functions/calculateHealthScore';
import { findSocialLeads } from './functions/findSocialLeads';
import { detectTrends } from './functions/detectTrends';
import { updateLeadFreshness } from './functions/updateLeadFreshness';
import { runMLLearning } from './functions/learnFromClosedDeals';
import { autoRespondToReviews } from './functions/autoRespondToReviews';
import { reviewRequestAutomation } from './functions/reviewRequestAutomation';
import { googleRankMonitor } from './functions/googleRankMonitor';
import { smartLeadNurture } from './functions/smartLeadNurture';
import { contentCalendarAgent } from './functions/contentCalendarAgent';
import { competitorIntelAgent } from './functions/competitorIntelAgent';
import { fetchSocialInsights } from './functions/fetchSocialInsights';
import { schedulePostPublisher } from './functions/schedulePostPublisher';
import { analyzeInstagramComments } from './functions/analyzeInstagramComments';
import { detectEvents } from './functions/detectEvents';
import { detectDeliveryChanges } from './functions/detectDeliveryChanges';
import { contentPerformanceAgent } from './functions/contentPerformanceAgent';
import { reviewRequestTimingAgent } from './functions/reviewRequestTimingAgent';
import {
  runViralCatalyst,
  runInfluenceIntegrity,
  runDeepContextVision,
  runRetentionSentinel,
  runNegotiationPricing,
  runCampaignAutopilot,
  runExpansionScout,
  runReputationWarRoom,
} from './functions/layer7Agents';
import { collectOTXCompetitorChanges } from './functions/collectOTXCompetitorChanges';
import { runOTXSyncBridge } from './functions/runOTXSyncBridge';
import { runSectorTrendRadar } from './functions/runSectorTrendRadar';

// Rate limit: 10 minutes per business+agent pair (in-memory)
const lastRun: Map<string, number> = new Map();
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

// Map agent function names (and display names) → handler
const AGENT_HANDLERS: Record<string, (req: Request, res: Response) => any> = {
  // By functionName (used in Agents.jsx agentConfigs)
  collectWebSignals,
  collectSocialSignals,
  runMarketIntelligence,
  runCompetitorIdentification,
  generateProactiveAlerts,
  runPredictions,
  updateSectorKnowledge,
  runLeadGeneration,
  calculateHealthScore,
  findSocialLeads,
  detectTrends,
  // Cleaner — lead freshness decay + archiving
  applyDataFreshness: updateLeadFreshness,
  // Brain — win/loss learning from closed deals
  runMLLearning,
  // By nameEn alias
  Eyeni:      collectWebSignals,
  Social:     collectSocialSignals,
  Analyzer:   runMarketIntelligence,
  Tracker:    runCompetitorIdentification,
  Supervisor: generateProactiveAlerts,
  Predictor:  runPredictions,
  Memory:     updateSectorKnowledge,
  Filter:     runLeadGeneration,
  Hunter:     findSocialLeads,
  Trends:     detectTrends,
  Cleaner:    updateLeadFreshness,
  Brain:      runMLLearning,
  // New growth agents
  autoRespondToReviews,
  reviewRequestAutomation,
  googleRankMonitor,
  smartLeadNurture,
  contentCalendarAgent,
  competitorIntelAgent,
  // Social OAuth agents (run when platforms are connected)
  fetchSocialInsights,
  schedulePostPublisher,
  analyzeInstagramComments,
  SocialInsights:   fetchSocialInsights,
  PostPublisher:    schedulePostPublisher,
  IgComments:       analyzeInstagramComments,
  // By nameHe alias
  Respond:   autoRespondToReviews,
  Reviews:   reviewRequestAutomation,
  RankMon:   googleRankMonitor,
  Nurture:   smartLeadNurture,
  Calendar:  contentCalendarAgent,
  CompIntel: competitorIntelAgent,
  // Event + delivery intelligence agents
  detectEvents,
  detectDeliveryChanges,
  DeliveryIntel: detectDeliveryChanges,
  Events: detectEvents,
  // New performance + timing agents
  contentPerformanceAgent,
  reviewRequestTimingAgent,
  ContentPerf:     contentPerformanceAgent,
  ReviewTiming:    reviewRequestTimingAgent,
  // Layer 7 OTX agents — by functionName
  runViralCatalyst,
  runInfluenceIntegrity,
  runDeepContextVision,
  runRetentionSentinel,
  runNegotiationPricing,
  runCampaignAutopilot,
  runExpansionScout,
  runReputationWarRoom,
  // Layer 7 — by nameEn alias
  Viral:       runViralCatalyst,
  Integrity:   runInfluenceIntegrity,
  Vision:      runDeepContextVision,
  Retention:   runRetentionSentinel,
  Pricing:     runNegotiationPricing,
  Autopilot:   runCampaignAutopilot,
  Expansion:   runExpansionScout,
  Reputation:  runReputationWarRoom,
};

const router = Router();

// POST /api/agents/trigger/otx-sync-bridge
// Global OTX sync — no businessProfileId needed, fans out to all QE profiles.
router.post('/otx-sync-bridge', async (_req: Request, res: Response) => {
  const key = 'global:runOTXSyncBridge';
  const now = Date.now();
  if ((now - (lastRun.get(key) ?? 0)) < COOLDOWN_MS) {
    return res.status(429).json({ error: 'Rate limited — wait 10 minutes between manual triggers' });
  }
  lastRun.set(key, now);
  runOTXSyncBridge().catch(err =>
    console.error('[agentTrigger] runOTXSyncBridge failed:', err.message)
  );
  return res.json({ ok: true, message: 'OTXSyncBridge started — check /api/agents/status for heartbeat' });
});

// POST /api/agents/trigger/otx-sector-trend-radar
// Global OTX agent — reads signals_raw, writes sector_trends + agent_data_bus.
router.post('/otx-sector-trend-radar', async (_req: Request, res: Response) => {
  const key = 'global:runSectorTrendRadar';
  const now = Date.now();
  if ((now - (lastRun.get(key) ?? 0)) < COOLDOWN_MS) {
    return res.status(429).json({ error: 'Rate limited — wait 10 minutes between manual triggers' });
  }
  lastRun.set(key, now);
  runSectorTrendRadar().catch(err =>
    console.error('[agentTrigger] runSectorTrendRadar failed:', err.message)
  );
  return res.json({ ok: true, message: 'SectorTrendRadar started — check /api/agents/status for heartbeat' });
});

// POST /api/agents/trigger/otx-competitor-snapshot
// Global OTX agent — no businessProfileId needed, runs across all businesses.
router.post('/otx-competitor-snapshot', async (_req: Request, res: Response) => {
  const key = 'global:collectOTXCompetitorChanges';
  const now = Date.now();
  if ((now - (lastRun.get(key) ?? 0)) < COOLDOWN_MS) {
    return res.status(429).json({ error: 'Rate limited — wait 10 minutes between manual triggers' });
  }
  lastRun.set(key, now);
  // Fire-and-forget; respond immediately so the HTTP request doesn't time out
  collectOTXCompetitorChanges().catch(err =>
    console.error('[agentTrigger] collectOTXCompetitorChanges failed:', err.message)
  );
  return res.json({ ok: true, message: 'CompetitorSnapshot started — check /api/agents/status for heartbeat' });
});

// POST /api/agents/trigger
// Body: { agentName: string, businessProfileId: string }
router.post('/', async (req: Request, res: Response) => {
  const { agentName, businessProfileId } = req.body as {
    agentName?: string;
    businessProfileId?: string;
  };

  if (!agentName || !businessProfileId) {
    return res.status(400).json({ error: 'חסר agentName או businessProfileId' });
  }

  // Rate-limit check
  const key = `${businessProfileId}:${agentName}`;
  const now = Date.now();
  const lastRunAt = lastRun.get(key) ?? 0;
  const elapsed = now - lastRunAt;

  if (elapsed < COOLDOWN_MS) {
    const remainingMin = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
    return res.status(429).json({
      error: `המתן עוד ${remainingMin} דקות`,
      cooldown_remaining_ms: COOLDOWN_MS - elapsed,
    });
  }

  const handler = AGENT_HANDLERS[agentName];
  if (!handler) {
    return res.status(404).json({ error: `סוכן לא נמצא: ${agentName}` });
  }

  // Stamp time BEFORE running to prevent double-triggers
  lastRun.set(key, now);

  // Inject businessProfileId and delegate to the existing handler
  req.body.businessProfileId = businessProfileId;
  return handler(req, res);
});

export default router;
