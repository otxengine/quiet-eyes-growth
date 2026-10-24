import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { requireBusinessAccess } from '../../middleware/businessAccess';
import { getUserId, isAdminKeyRequest } from '../../middleware/auth';
import { getUserBusinessIds, getUserWritableBusinessIds } from '../../lib/ownership';
import { prisma } from '../../db';
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

// Models a signed-in user may pick: the frontend only uses these. Unknown keys would otherwise be
// sent to OpenRouter as raw model ids, so any (costly) model could be requested.
const USER_LLM_MODELS = new Set(['haiku', 'sonnet']);
const USER_LLM_MAX_TOKENS = 1500; // largest frontend request is 1200
const USER_LLM_MAX_PROMPT_CHARS = 100_000; // input tokens are the real cost lever

async function invokeLLMHandler(req: Request, res: Response) {
  const { prompt, response_json_schema } = req.body;
  let { model, maxTokens } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  if (!isAdminKeyRequest(req)) {
    if (model !== undefined && !USER_LLM_MODELS.has(model)) return res.status(400).json({ error: 'Unsupported model' });
    if (typeof prompt !== 'string' || prompt.length > USER_LLM_MAX_PROMPT_CHARS
        || JSON.stringify(response_json_schema ?? '').length > 20_000) {
      return res.status(413).json({ error: 'Prompt too large' });
    }
    // Omitted → the model's own default in lib/llm; given → a whole number in [1, cap].
    if (maxTokens !== undefined) maxTokens = Math.min(Math.max(Math.floor(Number(maxTokens)) || 1, 1), USER_LLM_MAX_TOKENS);
  }
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

// Body fields that point at another tenant's rows, by the model that holds them.
// requireBusinessAccess covers businessProfileId; this covers the other ids handlers read
// (inventory of every FUNCTION_MAP handler's req.body fields, 2026-10-24).
const RECORD_FIELDS: Record<string, string> = {
  competitorId: 'competitor',          // battlecard, strategy, review insights, social analysis
  focusedCompetitorId: 'competitor',   // reputationAdvisorChat
  competitorIds: 'competitor',         // compareGoogleMetrics, topicTimeline, reputationAdvisorChat
  leadId: 'lead',                      // generateLeadFirstContact, intentClassification
  actionId: 'autoAction',              // approveAction, rejectAction
  postId: 'organicPost',               // revisePost
};
// updateInsightMemory's entityId lives in a different table per entityType.
const ENTITY_TYPE_MODELS: Record<string, string> = { signal: 'marketSignal', alert: 'proactiveAlert', competitor: 'competitor' };
// Business ids under other names (logOutcome, submitSupportTicket). getEventBusStats and
// manageConstraints also fall back to ?businessProfileId=, which requireBusinessAccess doesn't see.
const OTHER_BUSINESS_FIELDS = ['linked_business', 'businessId'];
// These run for every business when businessProfileId is missing, so callers must name one.
const ALL_BUSINESSES_WITHOUT_ID = new Set(['runFullScan', 'run-full-scan', 'updateSectorKnowledge']);
// Platform-wide reports with no business scope (systemHealthMonitor returns every tenant's latest
// automation errors and global counts). No tenant UI calls them.
const ADMIN_ONLY_FUNCTIONS = new Set(['systemHealthMonitor']);
// Functions that only read (checked 2026-10-24: no DB writes, no LLM or other paid calls). An org
// viewer may call these; every other function changes data or spends credits, so its business and
// record ids must be ones the caller can write. Fail closed: add a function here only after checking it.
const READ_ONLY_FUNCTIONS = new Set([
  'getEventBusStats', 'getBusinessConstraints', 'getSubscriptionStatus',
  'compareGoogleMetrics', 'topicTimeline', 'sectorBenchmark',
]);

async function requireFunctionAccess(req: Request<{ name: string }>, res: Response, next: NextFunction) {
  if (isAdminKeyRequest(req)) return next();
  if (ADMIN_ONLY_FUNCTIONS.has(req.params.name)) return res.status(403).json({ error: 'Forbidden' });
  const body = req.body ?? {};
  if (ALL_BUSINESSES_WITHOUT_ID.has(req.params.name) && !body.businessProfileId) {
    return res.status(400).json({ error: 'businessProfileId required' });
  }

  const readOnly = READ_ONLY_FUNCTIONS.has(req.params.name);
  const idsByModel = new Map<string, string[]>();
  // requireBusinessAccess has checked businessProfileId for reading; a write needs more.
  const businessIds: unknown[] = [
    ...OTHER_BUSINESS_FIELDS.map(f => body[f]), req.query?.businessProfileId, readOnly ? null : body.businessProfileId,
  ].filter(v => v != null && v !== '');
  const add = (model: string, v: unknown) => {
    for (const id of Array.isArray(v) ? v : [v]) idsByModel.set(model, [...(idsByModel.get(model) ?? []), id]);
  };
  for (const [field, model] of Object.entries(RECORD_FIELDS)) if (body[field] != null) add(model, body[field]);
  if (body.entityId != null && typeof body.entityType === 'string'
      && Object.prototype.hasOwnProperty.call(ENTITY_TYPE_MODELS, body.entityType)) {
    add(ENTITY_TYPE_MODELS[body.entityType], body.entityId);
  }
  if (!idsByModel.size && !businessIds.length) return next();

  const all = [...businessIds, ...[...idsByModel.values()].flat()];
  if (all.some(v => typeof v !== 'string')) return res.status(400).json({ error: 'Invalid id' });
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const owned = await (readOnly ? getUserBusinessIds : getUserWritableBusinessIds)(userId);
    if (businessIds.some(id => !owned.includes(id as string))) return res.status(403).json({ error: 'Forbidden' });
    for (const [model, list] of idsByModel) {
      const ids = [...new Set(list as string[])];
      // Fail closed: every id must be found inside the caller's businesses (missing and
      // foreign look the same). OR-of-equals, not `id: { in }`: that array bind silently
      // returned zero rows on Supabase's pooler (see b44f78e), which would make this a no-op.
      const ownedRows: number = owned.length ? await (prisma as any)[model].count({
        where: { AND: [{ OR: ids.map(id => ({ id })) }, { OR: owned.map(b => ({ linked_business: b })) }] },
      }) : 0;
      if (ownedRows !== ids.length) return res.status(404).json({ error: 'Not found' });
    }
  } catch (err) {
    return next(err);
  }
  next();
}

// invokeLLM is a general LLM proxy: cap each user's calls (paid per token).
const invokeLLMLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => isAdminKeyRequest(req),
  keyGenerator: req => getUserId(req) ?? 'anonymous', // the /api gate guarantees a user here
  message: { error: 'Too many AI requests, please try again later' },
});
// Matched on the decoded :name. A path route ('/invokeLLM') was skipped by an encoded
// path such as '/invoke%4CLM', which still dispatches to invokeLLM.
const limitInvokeLLM = (req: Request<{ name: string }>, res: Response, next: NextFunction) =>
  (req.params.name === 'invokeLLM' ? invokeLLMLimiter(req, res, next) : next());

// POST /api/functions/:name
router.post('/:name', requireBusinessAccess, requireFunctionAccess, limitInvokeLLM, (req: Request<{ name: string }>, res: Response) => {
  const handler = FUNCTION_MAP[req.params.name];
  if (!handler) {
    return res.status(404).json({ error: `Unknown function: ${req.params.name}` });
  }
  if (BACKGROUND_FUNCTIONS.has(req.params.name)) return runInBackground(req.params.name, handler, req, res);
  return handler(req, res);
});

export default router;
