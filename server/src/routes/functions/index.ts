import { Router, Request, Response } from 'express';
import { requireBusinessAccess } from '../../middleware/businessAccess';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { generateMorningBriefing } from './generateMorningBriefing';
import { generateLeadFirstContact } from './generateLeadFirstContact';
import { generateBattlecard } from './generateBattlecard';
import { logOutcome } from './logOutcome';
import { calculateHealthScore } from './calculateHealthScore';
import { collectWebSignals } from './collectWebSignals';
import { synthesizeMarketInsights, runMarketIntelligence } from './synthesizeMarketInsights';
import { runIntelligenceEngines } from './runIntelligenceEngines';
import { collectReviews } from './collectReviews';
import { resolveGooglePlace } from './resolveGooglePlace';
import { collectCompetitorReviews } from './collectCompetitorReviews';
import { runCompetitorIdentification } from './runCompetitorIdentification';
import { collectSocialSignals } from './collectSocialSignals';
import { generateProactiveAlerts } from './generateProactiveAlerts';
import { runPredictions } from './runPredictions';
import { updateSectorKnowledge } from './updateSectorKnowledge';
import { updateLeadFreshness } from './updateLeadFreshness';
import { runMLLearning } from './learnFromClosedDeals';
import { enrichLeads } from './enrichLeads';
import {
  fetchSocialData,
  syncLeadToCrm,
  crmWebhookSync,
  whatsappBotHandler,
  sendWhatsAppAlert,
  scheduleWinBack,
  autoConfigOsint,
  learnFromWebsite,
  getSubscriptionStatus,
  createCheckoutSession,
  manageSubscription,
  identifyKnowledgeGaps,
} from './stubs';
import { runFullScan } from './runFullScan';
import { findSocialLeads } from './findSocialLeads';
import { detectTrends } from './detectTrends';
import { generateCompetitorStrategy } from './generateCompetitorStrategy';
import { detectCompetitorPricing } from './detectCompetitorPricing';
import { runMLLearningCycle } from './runMLLearningCycle';
import { analyzeSentiment } from './analyzeSentiment';
import { detectCompetitorChanges } from './detectCompetitorChanges';
import { getAudienceSegments } from './getAudienceSegments';
import { discussTargetAudience } from './discussTargetAudience';
import { analyzeCompetitorSocial } from './analyzeCompetitorSocial';
import { detectCompetitorAds } from './detectCompetitorAds';
import { detectEvents } from './detectEvents';
import { findLocalEvents } from './findLocalEvents';
import { detectDeliveryChanges } from './detectDeliveryChanges';
import { analyzeSocialComments } from './analyzeSocialComments';
import { generateImage } from './generateImage';
import { chatWithBusiness } from './chatWithBusiness';
import { buildInsightAudience } from './buildInsightAudience';
import { generateWeeklyReport } from './generateWeeklyReport';
import { generateMarketAnalysis } from './generateMarketAnalysis';
import { generateSmartPost } from './generateSmartPost';
import { detectEarlyTrends } from './detectEarlyTrends';
import { detectViralSignals } from './detectViralSignals';
import { cleanupAndLearn } from './cleanupAndLearn';
import { autoRespondToReviews } from './autoRespondToReviews';
import { reviewRequestAutomation } from './reviewRequestAutomation';
import { googleRankMonitor } from './googleRankMonitor';
import { smartLeadNurture } from './smartLeadNurture';
import { contentCalendarAgent } from './contentCalendarAgent';
import { competitorIntelAgent } from './competitorIntelAgent';
import { fetchSocialInsights } from './fetchSocialInsights';
import { schedulePostPublisher } from './schedulePostPublisher';
import { analyzeInstagramComments } from './analyzeInstagramComments';
import { publishPost } from './publishPost';
import { estimateCampaignMetrics } from './estimateCampaignMetrics';
import { analyzeImageForPost } from './analyzeImageForPost';
import { uploadBusinessMedia } from './uploadBusinessMedia';
import { describeBusinessMedia } from './describeBusinessMedia';
import { generateBulkPosts } from './generateBulkPosts';
import { revisePost } from './revisePost';
import { suggestPostTime } from './suggestPostTime';
import { pickRelevantMedia } from './pickRelevantMedia';
import { regenerateMediaDescriptions } from './regenerateMediaDescriptions';
import { scanServicesAndPrices } from './scanServicesAndPrices';
import { snapshotCompetitor } from './snapshotCompetitor';
import { diffCompetitorSnapshot } from './diffCompetitorSnapshot';
import { batchSnapshotCompetitors } from './batchSnapshotCompetitors';
import { discoverCompetitorUrls } from './discoverCompetitorUrls';
import { generateMonthlyStrategy } from './generateMonthlyStrategy';
import { marketMemoryEngine } from './marketMemoryEngine';
import { demandGapEngine } from './demandGapEngine';
import { competitorMoveTracker } from './competitorMoveTracker';
import { microMomentDetector } from './microMomentDetector';
import { lostLeadRecovery } from './lostLeadRecovery';
import { pricingIntelligence } from './pricingIntelligence';
import { revenueForecaster } from './revenueForecaster';
import { sentimentVelocityMonitor } from './sentimentVelocityMonitor';
import { updateInsightMemory } from './updateInsightMemory';
import { generateAdvisoryInsights } from './generateAdvisoryInsights';
import { cleanupInsights } from './cleanupInsights';
import { weeklyEmailDigest } from './weeklyEmailDigest';
import { processEventBus } from './processEventBus';
import { calculateROI } from './calculateROI';
import { sectorBenchmark } from './sectorBenchmark';
import { smartScheduler } from './smartScheduler';
import { getBusinessConstraints, updateBusinessConstraints } from './manageConstraints';
import { getEventBusStats, approveAction, rejectAction } from './getEventBusStats';
import {
  runViralCatalyst,
  runInfluenceIntegrity,
  runDeepContextVision,
  runRetentionSentinel,
  runNegotiationPricing,
  runCampaignAutopilot,
  runExpansionScout,
  runReputationWarRoom,
} from './layer7Agents';
import { instagramTrendAgent } from './instagramTrendAgent';
import { facebookGroupTrendAgent } from './facebookGroupTrendAgent';
import { googleTrendsScanAgent } from './googleTrendsScanAgent';
import { commandChat } from './commandChat';
import { submitSupportTicket } from './submitSupportTicket';
import { submitFeedback } from './submitFeedback';
import { systemHealthMonitor } from './systemHealthMonitor';
import { intentClassification } from './intentClassification';
import { otxSyncBridge } from './otxSyncBridge';
import { competitorDataBootstrap } from './competitorDataBootstrap';
import { compareGoogleMetrics } from './compareGoogleMetrics';
import { topicTimeline } from './topicTimeline';
import { getCompetitorReviewInsights } from './getCompetitorReviewInsights';
import { analyzeOwnReviewInsights } from './analyzeOwnReviewInsights';
import { analyzeCompetitorReviewInsightsPooled } from './analyzeCompetitorReviewInsightsPooled';
import { reputationAdvisorChat } from './reputationAdvisorChat';
import { collectCompetitorSocialPosts } from './collectCompetitorSocialPosts';
import { collectCompetitorSocialStories } from './collectCompetitorSocialStories';
import { collectOwnSocialPosts } from './collectOwnSocialPosts';
import { collectOwnSocialProfile } from './collectOwnSocialProfile';
import { collectOwnBusinessInfo } from './collectOwnBusinessInfo';
import { collectCompetitorSocialProfile } from './collectCompetitorSocialProfile';
import { collectOwnSocialProfileAndPosts } from './collectOwnSocialProfileAndPosts';
import { collectCompetitorSocialProfileAndPosts } from './collectCompetitorSocialProfileAndPosts';
import { detectOwnAds } from './detectOwnAds';
import { analyzeSocialPosts } from './analyzeSocialPosts';
import { backfillCompetitorPostAnalysis } from './backfillCompetitorPostAnalysis';
import { dedupeCompetitorPosts } from './dedupeCompetitorPosts';
import { analyzeTopCompetitorPosts } from './analyzeTopCompetitorPosts';
import { analyzeTopOwnPosts } from './analyzeTopOwnPosts';
import { analyzeContentTrends } from './analyzeContentTrends';
import { analyzeOffersLandscape } from './analyzeOffersLandscape';
import { analyzeBioProfiles } from './analyzeBioProfiles';
import { suggestBioFix } from './suggestBioFix';
import { analyzeLogoTrends } from './analyzeLogoTrends';
import { critiqueLogo } from './critiqueLogo';
import { calculateProfileScore } from './calculateProfileScore';
import { generateLogo } from './generateLogo';
import { reviewSuggestedLogo } from './reviewSuggestedLogo';
import { reviewSuggestedBio } from './reviewSuggestedBio';

const router = Router();

async function invokeLLMHandler(req: Request, res: Response) {
  const { prompt, response_json_schema, model, maxTokens } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  try {
    const result = await invokeLLM({ prompt, response_json_schema, model, maxTokens });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

const FUNCTION_MAP: Record<string, any> = {
  invokeLLM: invokeLLMHandler,
  // Real implementations
  generateMorningBriefing,
  generateLeadFirstContact,
  generateBattlecard,
  logOutcome,
  calculateHealthScore,
  collectWebSignals,
  synthesizeMarketInsights,
  'synthesize-market-insights': synthesizeMarketInsights,
  runIntelligenceEngines,
  runMarketIntelligence,
  'run-market-intelligence': runMarketIntelligence,
  collectReviews,
  resolveGooglePlace,
  collectCompetitorReviews,
  runCompetitorIdentification,
  scanCompetitors: runCompetitorIdentification,
  collectSocialSignals,
  generateProactiveAlerts,
  runPredictions,
  updateSectorKnowledge,
  updateLeadFreshness,
  runMLLearning,
  // scanAllReviews → real collectReviews
  scanAllReviews: collectReviews,
  // New agents
  findSocialLeads,
  detectTrends,
  generateCompetitorStrategy,
  detectCompetitorPricing,
  runMLLearningCycle,
  analyzeSentiment,
  detectCompetitorChanges,
  getAudienceSegments,
  discussTargetAudience,
  analyzeCompetitorSocial,
  detectCompetitorAds,
  detectEvents,
  findLocalEvents,
  detectDeliveryChanges,
  analyzeSocialComments,
  generateImage,
  chatWithBusiness,
  commandChat,
  submitSupportTicket,
  buildInsightAudience,
  generateWeeklyReport,
  generateMarketAnalysis,
  generateSmartPost,
  detectEarlyTrends,
  detectViralSignals,
  cleanupAndLearn,
  // New growth agents
  autoRespondToReviews,
  reviewRequestAutomation,
  googleRankMonitor,
  smartLeadNurture,
  contentCalendarAgent,
  competitorIntelAgent,
  // Social OAuth agents
  fetchSocialInsights,
  schedulePostPublisher,
  analyzeInstagramComments,
  publishPost,
  estimateCampaignMetrics,
  analyzeImageForPost,
  uploadBusinessMedia,
  describeBusinessMedia,
  generateBulkPosts,
  revisePost,
  suggestPostTime,
  pickRelevantMedia,
  regenerateMediaDescriptions,
  scanServicesAndPrices,
  snapshotCompetitor,
  diffCompetitorSnapshot,
  batchSnapshotCompetitors,
  discoverCompetitorUrls,
  generateMonthlyStrategy,
  marketMemoryEngine,
  demandGapEngine,
  competitorMoveTracker,
  microMomentDetector,
  lostLeadRecovery,
  pricingIntelligence,
  revenueForecaster,
  sentimentVelocityMonitor,
  updateInsightMemory,
  generateAdvisoryInsights,
  cleanupInsights,
  // OTX Patent architecture
  processEventBus,
  getBusinessConstraints,
  updateBusinessConstraints,
  getEventBusStats,
  approveAction,
  rejectAction,
  // Analytics & intelligence
  calculateROI,
  sectorBenchmark,
  smartScheduler,
  // ── Trend intelligence agents (multi-platform, US+IL, visual) ────────────
  instagramTrendAgent,
  facebookGroupTrendAgent,
  googleTrendsScanAgent,
  // Layer 7 advanced agents
  runViralCatalyst,
  runInfluenceIntegrity,
  runDeepContextVision,
  runRetentionSentinel,
  runNegotiationPricing,
  runCampaignAutopilot,
  runExpansionScout,
  runReputationWarRoom,
  // New agents (Phase: audit & feedback loop)
  submitFeedback,
  systemHealthMonitor,
  intentClassification,
  otxSyncBridge,
  competitorDataBootstrap,
  compareGoogleMetrics,
  topicTimeline,
  getCompetitorReviewInsights,
  analyzeOwnReviewInsights,
  analyzeCompetitorReviewInsightsPooled,
  reputationAdvisorChat,
  collectCompetitorSocialPosts,
  collectCompetitorSocialStories,
  collectOwnSocialPosts,
  collectOwnSocialProfile,
  collectOwnBusinessInfo,
  collectCompetitorSocialProfile,
  collectOwnSocialProfileAndPosts,
  collectCompetitorSocialProfileAndPosts,
  detectOwnAds,
  analyzeSocialPosts,
  backfillCompetitorPostAnalysis,
  dedupeCompetitorPosts,
  analyzeTopCompetitorPosts,
  analyzeTopOwnPosts,
  analyzeContentTrends,
  analyzeOffersLandscape,
  analyzeBioProfiles,
  suggestBioFix,
  analyzeLogoTrends,
  critiqueLogo,
  calculateProfileScore,
  generateLogo,
  reviewSuggestedLogo,
  reviewSuggestedBio,
  // Stubs (require extra credentials or not yet implemented)
  enrichLeads,
  fetchSocialData,
  syncLeadToCrm,
  crmWebhookSync,
  whatsappBotHandler,
  sendWhatsAppAlert,
  scheduleWinBack,
  autoConfigOsint,
  learnFromWebsite,
  runFullScan,
  'run-full-scan': runFullScan,
  getSubscriptionStatus,
  createCheckoutSession,
  manageSubscription,
  identifyKnowledgeGaps,
  weeklyEmailDigest,
};

// Scans that can outlast CloudFront's 120s origin timeout (automation_logs p95 up to
// ~6,000s). A browser call gets 202 { started_at } right away and the handler keeps
// running here; the screen polls automation_logs for the run's row
// (src/api/client.js waitForAutomationLog). The scheduler calls these handlers
// directly, not through this router, so it still awaits them to completion.
const BACKGROUND_FUNCTIONS = new Set([
  'collectCompetitorReviews',
  'collectCompetitorSocialPosts',
  'collectCompetitorSocialProfile',
  'collectCompetitorSocialProfileAndPosts',
  'collectCompetitorSocialStories',
  'detectCompetitorAds',
  'collectReviews',
]);

function runInBackground(name: string, handler: Function, req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  const startedAt = new Date().toISOString();
  res.status(202).json({ started: true, started_at: startedAt });

  let status = 200;
  let body: any;
  const bgRes: any = {
    status: (code: number) => { status = code; return bgRes; },
    json: (data: any) => { body = data; return bgRes; },
  };
  // Handlers log their own runs and their caught 500s — log what they don't: throws and 4xx exits.
  Promise.resolve()
    .then(() => handler(req, bgRes))
    .then(() => {
      if (status >= 400 && status < 500) {
        return writeAutomationLog(name, businessProfileId, startedAt, 0, 'failed', body?.error || `HTTP ${status}`);
      }
    })
    .catch((err: any) => {
      console.error(`[functions] background ${name} failed:`, err?.message || err);
      return writeAutomationLog(name, businessProfileId, startedAt, 0, 'failed', err?.message || String(err));
    });
}

// POST /api/functions/:name
router.post('/:name', requireBusinessAccess, (req: Request<{ name: string }>, res: Response) => {
  const handler = FUNCTION_MAP[req.params.name];
  if (!handler) {
    return res.status(404).json({ error: `Unknown function: ${req.params.name}` });
  }
  if (BACKGROUND_FUNCTIONS.has(req.params.name)) return runInBackground(req.params.name, handler, req, res);
  return handler(req, res);
});

export default router;
