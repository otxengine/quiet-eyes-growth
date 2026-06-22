import dotenv from 'dotenv';
dotenv.config({ override: true }); // override empty system env vars with .env file values

// ── Startup environment guard (production only) ────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const required = ['CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'DATABASE_URL'];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`FATAL: required env var ${key} is not set — refusing to start`);
      process.exit(1);
    }
  }
}

import { registerAllHandlers } from './events/EventChoreographer';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import entityRouter from './routes/entities';
import functionRouter from './routes/functions/index';
import agentTriggerRouter from './routes/agentTrigger';
import orchestratorStatusRouter from './routes/orchestratorStatus';
import feedbackRouter from './routes/feedback';
import learningRouter from './routes/learning';
import migrateRouter from './routes/migrate';
import metaAuthRouter from './routes/meta/auth';
import metaWebhookRouter from './routes/meta/webhook';
import conversationsRouter from './routes/conversations';
import orchestratorRouter from './routes/orchestrator';
import approvalsRouter from './routes/approvals';
import explainabilityRouter from './routes/explainability';
import kpiRouter from './routes/kpi';
import oauthRouter from './routes/oauth';
import roiRouter from './routes/roi';
import adminUsersRouter from './routes/adminUsers';
import onboardingRouter from './routes/onboarding';
import socialRouter from './routes/social';
import campaignsRouter from './routes/campaigns';
import organizationsRouter from './routes/organizations';
import agencyRouter from './routes/agency';
import stripeRouter from './routes/stripe';
import emailApprovalRouter from './routes/emailApproval';

// Wire up all event choreography handlers at startup
registerAllHandlers();

import { startScheduler } from './scheduler';
import { refreshExpiringGoogleTokens } from './lib/googleTokenRefresh';

const app = express();
const PORT = process.env.PORT || 3002;

// ── Security headers ───────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP handled by frontend

// ── Rate limiting ──────────────────────────────────────────────────────────
// General API: 300 requests per 15 minutes per IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  skip: (req) => req.headers['x-admin-key'] === (process.env.ADMIN_SECRET || '__unset__'),
});

// Strict limiter for expensive LLM/scan endpoints: 20 per 15 min
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded for scan/AI endpoints' },
  skip: (req) => req.headers['x-admin-key'] === (process.env.ADMIN_SECRET || '__unset__'),
});

app.use('/api', generalLimiter);
app.use('/api/functions/run-full-scan', strictLimiter);
app.use('/api/functions/generate-post', strictLimiter);
app.use('/api/functions/generate-image', strictLimiter);
app.use('/api/functions/generate-advisory-insights', strictLimiter);
app.use('/api/orchestrator', strictLimiter);

const ALLOWED_ORIGINS = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .concat([
    'http://localhost:5173', 'http://localhost:5174',
    'http://localhost:5175',
    'https://cortexi.ai',
    'https://www.cortexi.ai',
  ]);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'x-dev-user'],
}));

// Dedicated admin key verification — placed before Clerk and body parser
app.get('/api/admin-verify', (req: any, res: any) => {
  const key = req.headers['x-admin-key'];
  const secret = process.env.ADMIN_SECRET || '';
  if (!secret) return res.status(503).json({ error: 'ADMIN_SECRET not configured on server' });
  if (key !== secret) return res.status(401).json({ error: 'bad_key' });
  return res.json({ ok: true });
});

// Stripe webhook — needs raw body before express.json() parses it
app.use('/api/stripe/webhooks', stripeRouter);

// Capture raw body for Meta webhook signature verification.
// Must be registered BEFORE express.json() so we get the unmodified Buffer.
app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
  limit: '20mb',
}));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Only mount Clerk middleware when a real secret key is configured
const clerkKey = process.env.CLERK_SECRET_KEY || '';
const clerkPubKey = process.env.CLERK_PUBLISHABLE_KEY || '';
const clerkEnabled = clerkKey && !clerkKey.includes('your_key_here') &&
                     clerkPubKey && !clerkPubKey.includes('your_key_here');
if (clerkEnabled) {
  const { clerkMiddleware } = require('@clerk/express');
  // Skip Clerk middleware for admin key requests — prevents session cookie interference
  app.use((req: any, res: any, next: any) => {
    if (req.headers['x-admin-key']) return next();
    clerkMiddleware({ publishableKey: clerkPubKey })(req, res, next);
  });
  console.log('Clerk auth enabled');
} else {
  console.log('Clerk not configured — running in dev mode (all requests as dev-user)');
}

app.use('/api/entities', entityRouter);
app.use('/api/functions', functionRouter);
app.use('/api/agents/trigger', agentTriggerRouter);
app.use('/api/agents/status', orchestratorStatusRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/learning', learningRouter);
app.use('/api/migrate', migrateRouter);
app.use('/api/meta/auth', metaAuthRouter);
app.use('/api/webhooks/meta', metaWebhookRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/orchestrator', orchestratorRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/explain', explainabilityRouter);
app.use('/api/kpi', kpiRouter);
app.use('/api/oauth', oauthRouter);
app.use('/api', roiRouter);
app.use('/api/admin', adminUsersRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/api/social', socialRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/orgs', organizationsRouter);
app.use('/api/agency', agencyRouter);
app.use('/api/stripe', stripeRouter);
app.use('/api/actions', emailApprovalRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));


// External cron trigger — POST /api/cron/run?secret=XXX
// Called by cron-job.org every 14 minutes to keep Render alive + run pipelines
app.post('/api/cron/run', async (_req, res) => {
  const secret = _req.query.secret as string;
  // Always require CRON_SECRET — unprotected cron endpoint burns API budget
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const { prisma: db } = await import('./db');
    const profiles = await db.businessProfile.findMany({
      where: { onboarding_completed: true },
      select: { id: true },
    });
    res.json({ triggered: profiles.length, ids: profiles.map(p => p.id) });
    // Run pipelines after responding so the HTTP call doesn't time out
    const { runPipeline } = await import('./orchestration/MasterOrchestrator');
    for (const p of profiles) {
      runPipeline(p.id, { mode: 'full', triggeredBy: 'schedule', skipStages: [], forceRun: false })
        .catch(() => {});
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Global JSON error handler — must be last, catches Clerk + any other middleware errors
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('Unhandled error:', err.message);
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(err.status || 500).json({
    error: isDev ? (err.message || 'Internal server error') : 'Internal server error',
  });
});

// ── Monitoring endpoint (admin only) ──────────────────────────────────────────
app.get('/api/monitoring/status', async (req: any, res: any) => {
  const { isAdminKeyRequest } = await import('./middleware/auth');
  if (!isAdminKeyRequest(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { getAgentStatusSummary } = await import('./lib/agentMonitor');
    const summary = await getAgentStatusSummary();
    return res.json(summary);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Debug endpoint — shows all data counts for a business profile
// Lead-finding diagnostic — shows exactly what Tavily returns and what the LLM says
// Requires admin key — exposes env key status and raw business data
app.get('/api/debug/leads/:bpId', async (req: any, res: any) => {
  const { isAdminKeyRequest } = await import('./middleware/auth');
  if (!isAdminKeyRequest(req)) return res.status(403).json({ error: 'Forbidden' });
  const bpId = req.params.bpId;
  const { prisma: db } = await import('./db');
  const { invokeLLM } = await import('./lib/llm');

  const TAVILY_KEY = process.env.TAVILY_API_KEY || '';
  const report: any = {
    env: {
      tavily_key_set: !!TAVILY_KEY,
      anthropic_key_set: !!process.env.ANTHROPIC_API_KEY,
      openai_key_set: !!process.env.OPENAI_API_KEY,
    },
    profile: null,
    tavily_results: [],
    llm_sample: null,
    error: null,
  };

  try {
    const profiles = await db.businessProfile.findMany({ where: { id: bpId } });
    const profile = profiles[0];
    if (!profile) return res.json({ error: 'profile not found', ...report });
    report.profile = { name: profile.name, category: profile.category, city: profile.city };

    if (!TAVILY_KEY) {
      report.error = 'TAVILY_API_KEY is not set — lead finding is completely disabled';
      return res.json(report);
    }

    // Run 1 search query and show raw results
    const query = `${profile.category} ${profile.city} מחפש המלצה`;
    report.query_tested = query;

    const tavilyRes = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_KEY, query, search_depth: 'basic', max_results: 5 }),
    });

    if (!tavilyRes.ok) {
      const errBody = await tavilyRes.text();
      report.error = `Tavily returned ${tavilyRes.status}: ${errBody}`;
      return res.json(report);
    }

    const tavilyData: any = await tavilyRes.json();
    const results = tavilyData.results || [];
    report.tavily_results_count = results.length;
    report.tavily_results = results.map((r: any) => ({
      title: r.title,
      url: r.url,
      content_preview: (r.content || '').substring(0, 200),
    }));

    // Test LLM on first result
    if (results.length > 0) {
      const first = results[0];
      const text = first.content || first.title || '';
      try {
        const llmResult = await invokeLLM({
          prompt: `Extract lead information from this text. Only extract what is EXPLICITLY stated — do NOT invent or assume.

TEXT: "${text.substring(0, 600)}"
URL: ${first.url || ''}

Return JSON: {"service_needed":"","urgency":"","budget_mentioned":"","person_name":"","platform":"facebook|instagram|forum|web","is_lead":true}
Set is_lead=false if no clear intent to purchase/hire a service.`,
          response_json_schema: { type: 'object' },
        });
        report.llm_sample = llmResult;
      } catch (e: any) {
        report.llm_error = e.message;
      }
    }
  } catch (e: any) {
    report.error = e.message;
  }

  return res.json(report);
});

app.get('/api/debug/:bpId', async (req: any, res: any) => {
  const { isAdminKeyRequest } = await import('./middleware/auth');
  if (!isAdminKeyRequest(req)) return res.status(403).json({ error: 'Forbidden' });
  const { prisma } = await import('./db');
  const bpId = req.params.bpId;
  const [profile, rawSignals, marketSignals, leads, reviews, competitors, automationLogs] = await Promise.all([
    prisma.businessProfile.findMany({ where: { id: bpId } }),
    prisma.rawSignal.count({ where: { linked_business: bpId } }),
    prisma.marketSignal.count({ where: { linked_business: bpId } }),
    prisma.lead.count({ where: { linked_business: bpId } }),
    prisma.review.count({ where: { linked_business: bpId } }),
    prisma.competitor.count({ where: { linked_business: bpId } }),
    prisma.automationLog.findMany({ where: { linked_business: bpId }, orderBy: { created_date: 'desc' }, take: 10 }),
  ]);
  res.json({
    profile: profile[0] ? { id: profile[0].id, name: profile[0].name, onboarding_completed: profile[0].onboarding_completed } : null,
    counts: { rawSignals, marketSignals, leads, reviews, competitors },
    recentLogs: automationLogs.map(l => ({ name: l.automation_name, status: l.status, items: l.items_processed, at: l.start_time })),
  });
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  const { prisma: db } = await import('./db');

  // Each statement is isolated — one failure does NOT prevent the rest
  async function sql(query: string) {
    try { await db.$executeRawUnsafe(query); } catch (e: any) { console.warn('startup SQL skipped:', e.message.split('\n')[0]); }
  }

  await sql(`CREATE TABLE IF NOT EXISTS agent_heartbeat (
    id              SERIAL PRIMARY KEY,
    agent_name      TEXT NOT NULL,
    last_ping_utc   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_ingestion_utc TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'ok',
    error_message   TEXT
  )`);
  await sql(`CREATE TABLE IF NOT EXISTS agent_data_bus (
    id           SERIAL PRIMARY KEY,
    event_type   TEXT NOT NULL,
    source_agent TEXT NOT NULL,
    payload      JSONB,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await sql(`CREATE TABLE IF NOT EXISTS otx_decisions (
    id                       TEXT PRIMARY KEY,
    business_id              TEXT NOT NULL,
    decision_type            TEXT NOT NULL,
    title                    TEXT NOT NULL,
    reasoning                TEXT,
    confidence_score         NUMERIC(5,3),
    business_fit_score       NUMERIC(5,3),
    timing_fit_score         NUMERIC(5,3),
    historical_success_score NUMERIC(5,3),
    roi_score                NUMERIC(5,3),
    status                   TEXT NOT NULL DEFAULT 'pending',
    insight_id               TEXT,
    trace_id                 TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_otx_decisions_biz ON otx_decisions(business_id, created_at DESC)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_agent_heartbeat_name ON agent_heartbeat(agent_name, last_ping_utc DESC)`);
  // Unique constraint on agent_name — enables ON CONFLICT upsert in writeHeartbeat
  await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_heartbeat_agent_name_unique ON agent_heartbeat(agent_name)`);
  await sql(`CREATE TABLE IF NOT EXISTS otx_competitor_snapshots (
    id            TEXT PRIMARY KEY DEFAULT md5(random()::text),
    competitor_id TEXT NOT NULL,
    business_id   TEXT NOT NULL,
    snapshot_json JSONB NOT NULL,
    taken_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_comp_snapshots ON otx_competitor_snapshots(competitor_id, taken_at DESC)`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS subscription_plan TEXT`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS search_radius_km INT DEFAULT 15`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS additional_cities TEXT`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS branches TEXT`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS lead_intent_signals TEXT`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS lead_quality_notes TEXT`);
  await sql(`ALTER TABLE market_signals ADD COLUMN IF NOT EXISTS dismiss_reason TEXT`);
  await sql(`ALTER TABLE proactive_alerts ADD COLUMN IF NOT EXISTS dismiss_reason TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS not_relevant BOOLEAN DEFAULT false`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS not_relevant_reason TEXT`);
  // ── Competitor enrichment: social presence + pricing + page discovery ───────
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS website_url TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS instagram_url TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS facebook_url TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS tiktok_url TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS google_business_url TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS social_pages_crawled_at TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS strongest_channel TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS social_post_frequency TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS last_post_date TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS social_followers_est TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS engagement_level TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS content_themes TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS sentiment_from_reviews TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS price_snapshot TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS last_promo_detected TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS last_promo_detected_at TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS last_product_detected TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS last_product_detected_at TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS sponsored_ads_detected BOOLEAN DEFAULT false`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS sponsored_ads_updated_at TEXT`);
  // ── is_dismissed: persistent dismiss for competitors + actions ───────────
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS is_dismissed BOOLEAN DEFAULT false`);
  await sql(`ALTER TABLE actions ADD COLUMN IF NOT EXISTS is_dismissed BOOLEAN DEFAULT false`);
  // ── Competitor paid ads tracking + deep Claude analysis ─────────────────
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS active_ad_platforms TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS active_ad_count INT DEFAULT 0`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS active_ads_summary TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS ad_target_audience TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS ad_strategy_summary TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS ad_spend_signal TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS ad_gaps TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS ad_intel_updated_at TEXT`);
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS active_ads_summary TEXT`);
  // Normalize historical NULL → false so {is_dismissed:false} queries work correctly
  await sql(`UPDATE proactive_alerts SET is_dismissed = false WHERE is_dismissed IS NULL`);
  await sql(`UPDATE market_signals SET is_dismissed = false WHERE is_dismissed IS NULL`);
  await sql(`UPDATE competitors SET is_dismissed = false WHERE is_dismissed IS NULL`);
  await sql(`UPDATE actions SET is_dismissed = false WHERE is_dismissed IS NULL`);
  await sql(`CREATE TABLE IF NOT EXISTS media_assets (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    created_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    linked_business TEXT,
    image_base64    TEXT,
    mime_type       TEXT DEFAULT 'image/jpeg',
    source          TEXT DEFAULT 'uploaded',
    description     TEXT,
    used_in         TEXT
  )`);
  await sql(`CREATE TABLE IF NOT EXISTS organic_posts (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    created_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    linked_business TEXT,
    signal_id       TEXT,
    signal_summary  TEXT,
    platform        TEXT,
    post_type       TEXT NOT NULL DEFAULT 'post',
    content         TEXT,
    media_asset_id  TEXT,
    image_url       TEXT,
    status          TEXT NOT NULL DEFAULT 'draft',
    published_at    TIMESTAMPTZ,
    engagement_likes    INT DEFAULT 0,
    engagement_comments INT DEFAULT 0,
    reach               INT DEFAULT 0
  )`);
  await sql(`CREATE TABLE IF NOT EXISTS campaigns (
    id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    created_date     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    linked_business  TEXT,
    signal_id        TEXT,
    signal_summary   TEXT,
    title            TEXT NOT NULL DEFAULT '',
    platform         TEXT,
    objective        TEXT,
    post_content     TEXT,
    image_url        TEXT,
    audience_json    TEXT,
    daily_budget_ils NUMERIC,
    campaign_days    INT,
    total_budget_ils NUMERIC,
    est_reach_low    INT,
    est_reach_high   INT,
    est_leads_low    INT,
    est_leads_high   INT,
    status           TEXT NOT NULL DEFAULT 'draft',
    published_at     TIMESTAMPTZ,
    actual_reach     INT,
    actual_clicks    INT,
    actual_leads     INT,
    actual_spend_ils NUMERIC
  )`);
  // Note: ALTER TABLE for otx_recommendations/pipeline_runs/policy_weights/outcome_events/execution_tasks
  // are intentionally placed AFTER their CREATE TABLE statements below (lines ~767+).

  // ── OTX v3 tables (missing from original startup block) ──────────────────
  await sql(`CREATE TABLE IF NOT EXISTS meta_configurations (
    id                      TEXT    PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id             TEXT    NOT NULL UNIQUE,
    sector                  TEXT    NOT NULL DEFAULT '',
    auto_detected_kpis      JSONB   NOT NULL DEFAULT '{}',
    signal_keywords         TEXT[]  NOT NULL DEFAULT '{}',
    trend_thresholds        JSONB   NOT NULL DEFAULT '{}',
    competitor_search_terms TEXT[]  DEFAULT '{}',
    local_radius_meters     INT     DEFAULT 500,
    configured_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    configuration_version   INT     DEFAULT 1
  )`);
  await sql(`CREATE TABLE IF NOT EXISTS otx_opportunities (
    id                    TEXT        PRIMARY KEY,
    business_id           TEXT        NOT NULL,
    type                  TEXT        NOT NULL,
    source_signal_ids     JSONB       NOT NULL DEFAULT '[]',
    source_event_ids      JSONB       NOT NULL DEFAULT '[]',
    source_forecast_ids   JSONB       NOT NULL DEFAULT '[]',
    opportunity_score     NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    urgency               TEXT        NOT NULL DEFAULT 'medium',
    confidence            NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    expected_window_start TIMESTAMPTZ,
    expected_window_end   TIMESTAMPTZ,
    explanation           TEXT        NOT NULL DEFAULT '',
    dedup_key             TEXT        NOT NULL,
    status                TEXT        NOT NULL DEFAULT 'active',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(business_id, dedup_key)
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_otx_opps_biz_status ON otx_opportunities(business_id, status, created_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS otx_threats (
    id           TEXT        PRIMARY KEY,
    business_id  TEXT        NOT NULL,
    type         TEXT        NOT NULL,
    risk_score   NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    urgency      TEXT        NOT NULL DEFAULT 'medium',
    confidence   NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    explanation  TEXT        NOT NULL DEFAULT '',
    signal_ids   JSONB       NOT NULL DEFAULT '[]',
    dedup_key    TEXT        NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'active',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(business_id, dedup_key)
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_otx_threats_biz_status ON otx_threats(business_id, status, created_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS otx_weight_update_log (
    id           TEXT        PRIMARY KEY,
    business_id  TEXT        NOT NULL,
    agent_name   TEXT        NOT NULL,
    action_type  TEXT        NOT NULL,
    old_weight   NUMERIC(5,4) NOT NULL,
    new_weight   NUMERIC(5,4) NOT NULL,
    trigger_type TEXT        NOT NULL,
    trigger_id   TEXT,
    delta        NUMERIC(6,4) NOT NULL,
    reason       TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(id)
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_otx_wlog_biz_agent ON otx_weight_update_log(business_id, agent_name, created_at DESC)`);

  // ── Reputation: daily rating snapshots for trend graph ───────────────────
  await sql(`CREATE TABLE IF NOT EXISTS rating_history (
    id           SERIAL PRIMARY KEY,
    business_id  TEXT NOT NULL,
    snapped_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    avg_rating   NUMERIC(3,2) NOT NULL,
    review_count INT NOT NULL DEFAULT 0,
    new_reviews  INT NOT NULL DEFAULT 0,
    source       TEXT NOT NULL DEFAULT 'collectReviews'
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_rating_history_biz ON rating_history(business_id, snapped_at DESC)`);
  // ── Reputation: missing columns ───────────────────────────────────────────
  await sql(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS auto_response_sent BOOLEAN DEFAULT false`);
  await sql(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS auto_response_sent_at TIMESTAMPTZ`);

  // ── Backfill missing columns ──────────────────────────────────────────────
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS action_type TEXT`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS urgency TEXT`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS rationale TEXT`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS final_score NUMERIC(5,3)`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS execution_mode TEXT DEFAULT 'suggest'`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS fused_insight_id TEXT`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS approval_required BOOLEAN DEFAULT false`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS policy_version INT DEFAULT 1`);
  // ── OTX-003/004: AutoAction new columns ──────────────────────────────────
  await sql(`ALTER TABLE auto_actions ADD COLUMN IF NOT EXISTS confidence_score   DOUBLE PRECISION`);
  await sql(`ALTER TABLE auto_actions ADD COLUMN IF NOT EXISTS predicted_impact   TEXT`);
  await sql(`ALTER TABLE auto_actions ADD COLUMN IF NOT EXISTS execution_decision TEXT`);
  await sql(`ALTER TABLE auto_actions ADD COLUMN IF NOT EXISTS decision_reason    TEXT`);
  await sql(`ALTER TABLE auto_actions ADD COLUMN IF NOT EXISTS constraint_notes   TEXT`);
  await sql(`ALTER TABLE auto_actions ADD COLUMN IF NOT EXISTS outcome_score      DOUBLE PRECISION`);

  // ── OTX-001: SystemEvent — centralized event data bus ────────────────────
  await sql(`CREATE TABLE IF NOT EXISTS system_events (
    id              TEXT        NOT NULL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    business_id     TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,
    source          TEXT        NOT NULL,
    payload         TEXT,
    context_attrs   TEXT,
    routing_status  TEXT        NOT NULL DEFAULT 'pending',
    dispatched_to   TEXT,
    processed_at    TEXT,
    composite_id    TEXT
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_system_events_biz_status ON system_events (business_id, routing_status)`);

  // ── OTX-001: RoutingRule — dynamic rule table ────────────────────────────
  await sql(`CREATE TABLE IF NOT EXISTS routing_rules (
    id            TEXT        NOT NULL PRIMARY KEY,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type    TEXT        NOT NULL,
    conditions    TEXT,
    target_agents TEXT        NOT NULL,
    priority      INT         NOT NULL DEFAULT 0,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    description   TEXT
  )`);

  // ── OTX-001: Seed default routing rules ──────────────────────────────────
  await sql(`INSERT INTO routing_rules (id, event_type, target_agents, priority, is_active, description) VALUES
    ('rule-new-review',     'new_review',       '["autoRespondToReviews","generateProactiveAlerts"]', 10, TRUE, 'New review → response + alert'),
    ('rule-hot-lead',       'hot_lead',         '["sendLeadNotification","generateProactiveAlerts"]',  10, TRUE, 'Hot lead → notify'),
    ('rule-competitor',     'competitor_change', '["runCompetitorIdentification","generateProactiveAlerts"]', 8, TRUE, 'Competitor change → re-analyse'),
    ('rule-market-signal',  'market_signal',    '["runMarketIntelligence","generateProactiveAlerts"]',  7, TRUE, 'Market signal → intelligence'),
    ('rule-local-event',    'local_event',      '["findLocalEvents","generateProactiveAlerts"]',        6, TRUE, 'Local event → opportunities'),
    ('rule-retention-risk', 'retention_risk',   '["generateProactiveAlerts","reviewRequestAutomation"]', 9, TRUE, 'Retention risk → alert + review request')
    ON CONFLICT (id) DO NOTHING`);

  // ── OTX-002: CompositeSignal — fused signal representation ───────────────
  await sql(`CREATE TABLE IF NOT EXISTS composite_signals (
    id                TEXT        NOT NULL PRIMARY KEY,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    business_id       TEXT        NOT NULL,
    signal_ids        TEXT        NOT NULL,
    fusion_type       TEXT        NOT NULL,
    composite_score   DOUBLE PRECISION,
    context           TEXT,
    candidate_actions TEXT,
    selected_action   TEXT,
    status            TEXT        NOT NULL DEFAULT 'pending',
    scored_at         TEXT,
    weight_snapshot   TEXT
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_composite_signals_biz_status ON composite_signals (business_id, status)`);

  // ── OTX-004: BusinessConstraints — per-business constraint rules ─────────
  await sql(`CREATE TABLE IF NOT EXISTS business_constraints (
    id                       TEXT        NOT NULL PRIMARY KEY,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    business_id              TEXT        NOT NULL UNIQUE,
    brand_tone               TEXT,
    prohibited_keywords      TEXT,
    max_discount_pct         DOUBLE PRECISION,
    allow_competitor_mention BOOLEAN     DEFAULT FALSE,
    posting_hours_start      INT         DEFAULT 8,
    posting_hours_end        INT         DEFAULT 22,
    approved_channels        TEXT,
    budget_cap_daily_ils     DOUBLE PRECISION,
    content_policy           TEXT,
    min_confidence_auto      DOUBLE PRECISION DEFAULT 85,
    min_confidence_suggest   DOUBLE PRECISION DEFAULT 60,
    updated_at               TEXT
  )`);

  // ── OAuth state persistence (survives restarts + multi-instance) ──────────
  await sql(`CREATE TABLE IF NOT EXISTS oauth_state_store (
    id             TEXT        NOT NULL PRIMARY KEY,
    business_id    TEXT        NOT NULL,
    platform       TEXT        NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,
    code_verifier  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await sql(`ALTER TABLE oauth_state_store ADD COLUMN IF NOT EXISTS code_verifier TEXT`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_oauth_state_expires ON oauth_state_store(expires_at)`);
  await sql(`DELETE FROM oauth_state_store WHERE expires_at < NOW()`);

  // ── social_accounts: refresh token + expiry ───────────────────────────────
  await sql(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS refresh_token TEXT`);
  await sql(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS expires_at    TEXT`);

  // ── business_profiles: TikTok + Email fields ──────────────────────────────
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS tiktok_access_token TEXT`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS tiktok_open_id      TEXT`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS notification_email  TEXT`);

  // ── Multi-branch / Multi-user / Agency tables ─────────────────────────────
  await sql(`CREATE TABLE IF NOT EXISTS organizations (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name                TEXT NOT NULL,
    owner_user_id       TEXT NOT NULL,
    is_agency           BOOLEAN NOT NULL DEFAULT false,
    plan_id             TEXT NOT NULL DEFAULT 'starter',
    branch_count        INT NOT NULL DEFAULT 1,
    subscription_status TEXT NOT NULL DEFAULT 'active',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_orgs_owner ON organizations(owner_user_id)`);
  await sql(`CREATE TABLE IF NOT EXISTS organization_members (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    email       TEXT,
    role        TEXT NOT NULL DEFAULT 'manager',
    branch_ids  TEXT,
    invited_by  TEXT,
    invited_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status      TEXT NOT NULL DEFAULT 'active',
    UNIQUE(org_id, user_id)
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id, status)`);
  // invite token columns (added later — safe to run on existing tables)
  await sql(`ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS invite_token      TEXT`);
  await sql(`ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS token_expires_at  TIMESTAMPTZ`);
  await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_invite_token ON organization_members(invite_token) WHERE invite_token IS NOT NULL`);
  await sql(`CREATE TABLE IF NOT EXISTS agency_clients (
    id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    agency_org_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    client_org_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    status         TEXT NOT NULL DEFAULT 'active',
    added_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(agency_org_id, client_org_id)
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_agency_clients_agency ON agency_clients(agency_org_id, status)`);
  // ── business_profiles: branch columns ────────────────────────────────────
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS organization_id      TEXT`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS branch_display_name  TEXT`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS branch_role          TEXT DEFAULT 'standalone'`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS branch_sort_order    INT  DEFAULT 0`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS is_active            BOOLEAN DEFAULT true`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_bp_org ON business_profiles(organization_id) WHERE organization_id IS NOT NULL`);

  // ── Stripe billing columns on organizations ───────────────────────────────
  await sql(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT`);
  await sql(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`);
  await sql(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_price_id        TEXT`);
  await sql(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS current_period_end     TIMESTAMPTZ`);
  await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_stripe_sub ON organizations(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL`);
  await sql(`CREATE TABLE IF NOT EXISTS stripe_invoices (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    org_id            TEXT NOT NULL,
    stripe_invoice_id TEXT NOT NULL UNIQUE,
    amount_paid       INT  NOT NULL DEFAULT 0,
    currency          TEXT NOT NULL DEFAULT 'ils',
    status            TEXT NOT NULL DEFAULT 'paid',
    invoice_url       TEXT,
    period_start      TIMESTAMPTZ,
    period_end        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_stripe_invoices_org ON stripe_invoices(org_id, created_at DESC)`);

  // ── OTX Engine v2 / v3 tables (idempotent — also in /api/migrate) ─────────
  await sql(`CREATE TABLE IF NOT EXISTS otx_fused_insights (
    id              TEXT        PRIMARY KEY,
    business_id     TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    urgency         TEXT        NOT NULL,
    confidence      NUMERIC(4,3) NOT NULL,
    summary         TEXT        NOT NULL,
    key_signals     JSONB       NOT NULL DEFAULT '[]',
    recommended_actions JSONB   NOT NULL DEFAULT '[]',
    predicted_impact TEXT,
    trace_id        TEXT
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_otx_fused_insights_biz ON otx_fused_insights(business_id, created_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS otx_recommendations (
    id              TEXT        PRIMARY KEY,
    decision_id     TEXT        NOT NULL,
    business_id     TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    title           TEXT        NOT NULL,
    body            TEXT        NOT NULL,
    cta             TEXT,
    channel         TEXT        NOT NULL,
    urgency         TEXT        NOT NULL,
    action_steps    JSONB       NOT NULL DEFAULT '[]',
    estimated_impact TEXT,
    draft_content   TEXT,
    status          TEXT        NOT NULL DEFAULT 'pending'
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_otx_recs_biz ON otx_recommendations(business_id, created_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS otx_execution_tasks (
    id              TEXT        PRIMARY KEY,
    decision_id     TEXT        NOT NULL,
    business_id     TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    task_type       TEXT        NOT NULL,
    channel         TEXT        NOT NULL,
    payload         JSONB       NOT NULL DEFAULT '{}',
    status          TEXT        NOT NULL DEFAULT 'pending',
    attempts        INT         NOT NULL DEFAULT 0,
    max_attempts    INT         NOT NULL DEFAULT 3,
    error_message   TEXT
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_otx_tasks_biz ON otx_execution_tasks(business_id, created_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS otx_sent_actions (
    id              TEXT        PRIMARY KEY,
    task_id         TEXT        NOT NULL,
    business_id     TEXT        NOT NULL,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    channel         TEXT        NOT NULL,
    result          TEXT,
    success         BOOLEAN     NOT NULL DEFAULT true
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_otx_sent_biz ON otx_sent_actions(business_id, sent_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS otx_outcome_events (
    id              TEXT        PRIMARY KEY,
    decision_id     TEXT        NOT NULL,
    business_id     TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    agent_name      TEXT        NOT NULL,
    result          TEXT        NOT NULL,
    revenue_impact  NUMERIC(12,2),
    notes           TEXT
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_otx_outcomes_biz ON otx_outcome_events(business_id, created_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS otx_policy_weights (
    id              TEXT        PRIMARY KEY DEFAULT md5(random()::text),
    business_id     TEXT        NOT NULL,
    agent_name      TEXT        NOT NULL,
    action_type     TEXT        NOT NULL,
    weight          NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    success_rate    NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    sample_size     INT         NOT NULL DEFAULT 0,
    last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    policy_version  INT         NOT NULL DEFAULT 1,
    UNIQUE(business_id, agent_name, action_type)
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_otx_weights_biz ON otx_policy_weights(business_id, agent_name)`);
  await sql(`CREATE TABLE IF NOT EXISTS otx_pipeline_runs (
    run_id          TEXT        PRIMARY KEY,
    business_id     TEXT        NOT NULL,
    trace_id        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    mode            TEXT        NOT NULL DEFAULT 'full',
    triggered_by    TEXT        NOT NULL DEFAULT 'manual',
    status          TEXT        NOT NULL DEFAULT 'completed',
    signals_processed  INT      NOT NULL DEFAULT 0,
    insights_created   INT      NOT NULL DEFAULT 0,
    decisions_created  INT      NOT NULL DEFAULT 0,
    actions_dispatched INT      NOT NULL DEFAULT 0,
    duration_ms     INT         NOT NULL DEFAULT 0
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_otx_runs_biz ON otx_pipeline_runs(business_id, created_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS v3_approval_requests (
    id                  TEXT        PRIMARY KEY,
    business_id         TEXT        NOT NULL,
    tenant_id           TEXT,
    decision_id         TEXT        NOT NULL,
    recommendation_id   TEXT,
    execution_task_id   TEXT,
    approval_type       TEXT        NOT NULL,
    requested_by        TEXT        NOT NULL,
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ,
    status              TEXT        NOT NULL DEFAULT 'pending',
    resolved_by         TEXT,
    resolved_at         TIMESTAMPTZ,
    notes               TEXT
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_approval_biz ON v3_approval_requests(business_id, status)`);
  await sql(`CREATE TABLE IF NOT EXISTS market_insights (
    id              TEXT        PRIMARY KEY,
    business_id     TEXT        NOT NULL,
    insight_type    TEXT        NOT NULL,
    title           TEXT        NOT NULL,
    description     TEXT        NOT NULL,
    urgency         TEXT        NOT NULL DEFAULT 'medium',
    confidence      NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    data_payload    JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_market_insights_biz ON market_insights(business_id, created_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS otx_trust_snapshots (
    id              TEXT        PRIMARY KEY,
    business_id     TEXT        NOT NULL,
    trust_score     NUMERIC(5,2) NOT NULL,
    gap_type        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_trust_snapshots_biz ON otx_trust_snapshots(business_id, created_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS otx_churn_risk_logs (
    id              TEXT        PRIMARY KEY,
    business_id     TEXT        NOT NULL,
    risk_level      TEXT        NOT NULL,
    risk_score      NUMERIC(4,3) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_churn_risk_biz ON otx_churn_risk_logs(business_id, created_at DESC)`);

  // ── Demand / Trend intelligence tables ───────────────────────────────────
  await sql(`CREATE TABLE IF NOT EXISTS hyper_local_events (
    id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    business_id          TEXT        NOT NULL,
    event_name           TEXT        NOT NULL,
    event_type           TEXT        NOT NULL,
    venue_name           TEXT,
    distance_meters      INT         NOT NULL DEFAULT 0,
    event_datetime       TIMESTAMPTZ NOT NULL,
    expected_attendance  INT,
    digital_signal_match TEXT,
    action_window_start  TIMESTAMPTZ,
    action_window_end    TIMESTAMPTZ,
    source_url           TEXT        NOT NULL DEFAULT '',
    detected_at_utc      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confidence_score     NUMERIC(3,2) NOT NULL DEFAULT 0.75
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_hyperlocal_biz_date ON hyper_local_events(business_id, event_datetime)`);
  await sql(`CREATE TABLE IF NOT EXISTS demand_forecasts (
    id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    business_id           TEXT        NOT NULL,
    forecast_date         DATE        NOT NULL,
    hour_of_day           INT,
    demand_index          NUMERIC(5,2),
    demand_delta_pct      NUMERIC(5,2),
    contributing_factors  JSONB,
    weather_condition     TEXT,
    local_event_id        TEXT,
    confidence_score      NUMERIC(3,2) NOT NULL DEFAULT 0.75,
    computed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_url            TEXT        NOT NULL DEFAULT 'internal://demand-forecaster'
  )`);
  await sql(`CREATE TABLE IF NOT EXISTS resource_arbitrage_actions (
    id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    business_id          TEXT        NOT NULL,
    trigger_type         TEXT        NOT NULL,
    trigger_description  TEXT        NOT NULL,
    recommended_action   TEXT        NOT NULL,
    action_type          TEXT        NOT NULL,
    target_segment       TEXT,
    expected_uplift_pct  NUMERIC(5,2),
    valid_from           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed             BOOLEAN     DEFAULT FALSE,
    source_url           TEXT        NOT NULL DEFAULT '',
    detected_at_utc      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confidence_score     NUMERIC(3,2) NOT NULL DEFAULT 0.75
  )`);
  await sql(`CREATE TABLE IF NOT EXISTS cross_sector_signals (
    id                      TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    source_sector           TEXT        NOT NULL,
    target_sector           TEXT        NOT NULL,
    trend_description       TEXT        NOT NULL,
    correlation_score       NUMERIC(3,2),
    lag_days                INT,
    opportunity_description TEXT,
    source_url              TEXT        NOT NULL DEFAULT '',
    detected_at_utc         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confidence_score        NUMERIC(3,2) NOT NULL DEFAULT 0.75
  )`);
  await sql(`CREATE TABLE IF NOT EXISTS synthetic_personas (
    id                        TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    business_id               TEXT        NOT NULL,
    persona_name              TEXT        NOT NULL,
    demographic_profile       JSONB       NOT NULL DEFAULT '{}',
    behavioral_traits         JSONB       NOT NULL DEFAULT '{}',
    simulated_conversion_rate NUMERIC(4,3),
    simulated_response        JSONB,
    embedding_vector          TEXT,
    computed_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_url                TEXT        NOT NULL DEFAULT 'internal://persona-simulator'
  )`);
  await sql(`CREATE TABLE IF NOT EXISTS business_events (
    id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    business_id   TEXT        NOT NULL,
    event_type    TEXT        NOT NULL,
    event_data    JSONB       NOT NULL DEFAULT '{}',
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source        TEXT        DEFAULT 'system'
  )`);
  await sql(`CREATE TABLE IF NOT EXISTS trend_scan_checkpoint (
    checkpoint_key    TEXT        PRIMARY KEY,
    last_scan_at      TIMESTAMPTZ,
    scanned_item_ids  TEXT        DEFAULT '[]',
    scanned_urls      TEXT        DEFAULT '[]',
    scan_meta         TEXT        DEFAULT '{}',
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
  )`);
  await sql(`CREATE TABLE IF NOT EXISTS platform_trend (
    id                       TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    platform                 TEXT        NOT NULL,
    region                   TEXT        NOT NULL DEFAULT 'IL',
    trend_type               TEXT        NOT NULL,
    trend_name               TEXT        NOT NULL,
    applicable_sectors       TEXT        DEFAULT '[]',
    growth_rate              REAL,
    volume_estimate          REAL,
    stage                    TEXT,
    evidence_urls            TEXT        DEFAULT '[]',
    visual_analysis          TEXT,
    is_us_leading_indicator  BOOLEAN     DEFAULT false,
    us_detected_at           TIMESTAMPTZ,
    first_detected_at        TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at             TIMESTAMPTZ DEFAULT NOW(),
    confidence               REAL        DEFAULT 70,
    linked_business          TEXT,
    source_agent             TEXT,
    created_at               TIMESTAMPTZ DEFAULT NOW()
  )`);
  await sql(`CREATE TABLE IF NOT EXISTS visual_trend_item (
    id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    platform_trend_id   TEXT,
    url                 TEXT        NOT NULL UNIQUE,
    thumbnail_url       TEXT,
    media_type          TEXT,
    platform            TEXT        NOT NULL,
    region              TEXT        DEFAULT 'IL',
    detected_products   TEXT        DEFAULT '[]',
    detected_services   TEXT        DEFAULT '[]',
    detected_keywords   TEXT        DEFAULT '[]',
    aesthetic_tags      TEXT        DEFAULT '[]',
    engagement_metrics  TEXT,
    visual_analysis     TEXT,
    analyzed_at         TIMESTAMPTZ DEFAULT NOW(),
    linked_business     TEXT
  )`);

  // ── Backfill ALTER TABLE for all missing columns ──────────────────────────
  await sql(`ALTER TABLE market_signals ADD COLUMN IF NOT EXISTS is_us_leading_indicator BOOLEAN DEFAULT false`);
  await sql(`ALTER TABLE market_signals ADD COLUMN IF NOT EXISTS region TEXT DEFAULT 'IL'`);
  await sql(`ALTER TABLE market_signals ADD COLUMN IF NOT EXISTS agent_name TEXT`);
  await sql(`ALTER TABLE market_signals ADD COLUMN IF NOT EXISTS source_type TEXT`);
  await sql(`ALTER TABLE market_signals ADD COLUMN IF NOT EXISTS tags TEXT`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS business_goal TEXT`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS price_tier TEXT`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS customer_sources TEXT`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS sector_profile TEXT`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS agent_missions TEXT`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS owner_name TEXT`);
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS phone TEXT`);
  await sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS discovered_at TEXT`);
  await sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS freshness_score DOUBLE PRECISION DEFAULT 100`);
  await sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_contact_at TEXT`);
  await sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_followup_date TEXT`);
  await sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_count DOUBLE PRECISION DEFAULT 0`);
  await sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS referral_source TEXT`);
  await sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_reasoning TEXT`);
  await sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS suggested_first_message TEXT`);
  await sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS deal_value DOUBLE PRECISION`);
  await sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS platform_sourced BOOLEAN DEFAULT false`);
  await sql(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS topics TEXT`);
  await sql(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS topic_sentiment TEXT`);
  await sql(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS google_review_id TEXT`);
  await sql(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false`);
  await sql(`ALTER TABLE health_scores ADD COLUMN IF NOT EXISTS seo_score DOUBLE PRECISION`);
  await sql(`ALTER TABLE health_scores ADD COLUMN IF NOT EXISTS google_rank_estimate TEXT`);
  await sql(`ALTER TABLE health_scores ADD COLUMN IF NOT EXISTS reviews_needed_for_top3 DOUBLE PRECISION`);
  await sql(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'sent'`);
  await sql(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS review_link TEXT`);
  await sql(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS sent_via TEXT`);
  await sql(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS converted_review_id TEXT`);
  await sql(`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS lead_id TEXT`);
  await sql(`ALTER TABLE sector_knowledge ADD COLUMN IF NOT EXISTS winner_lead_dna TEXT`);
  await sql(`ALTER TABLE business_memory ADD COLUMN IF NOT EXISTS channel_preferences TEXT`);
  await sql(`ALTER TABLE business_memory ADD COLUMN IF NOT EXISTS timing_preferences TEXT`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS title TEXT`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS reasoning TEXT`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS priority INT DEFAULT 5`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS score NUMERIC(8,3)`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS score_breakdown JSONB DEFAULT '{}'`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,3)`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS expected_roi NUMERIC(8,3)`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'`);
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS context_snapshot TEXT`);
  await sql(`ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS insight_id TEXT`);
  await sql(`ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS opportunity_ids JSONB DEFAULT '[]'`);
  await sql(`ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS signal_ids JSONB DEFAULT '[]'`);
  await sql(`ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS trace_id TEXT`);
  await sql(`ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS summary TEXT`);
  await sql(`ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS why_now TEXT`);
  await sql(`ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS recommended_steps JSONB DEFAULT '[]'`);
  await sql(`ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS recommended_timing TEXT`);
  await sql(`ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS user_visible_payload JSONB DEFAULT '{}'`);
  await sql(`ALTER TABLE otx_execution_tasks ADD COLUMN IF NOT EXISTS recommendation_id TEXT`);
  await sql(`ALTER TABLE otx_execution_tasks ADD COLUMN IF NOT EXISTS approval_required BOOLEAN DEFAULT false`);
  await sql(`ALTER TABLE otx_execution_tasks ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ`);
  await sql(`ALTER TABLE otx_execution_tasks ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ`);
  await sql(`ALTER TABLE otx_execution_tasks ADD COLUMN IF NOT EXISTS result_payload JSONB DEFAULT '{}'`);
  await sql(`ALTER TABLE otx_outcome_events ADD COLUMN IF NOT EXISTS execution_task_id TEXT`);
  await sql(`ALTER TABLE otx_outcome_events ADD COLUMN IF NOT EXISTS outcome_type TEXT DEFAULT 'execution'`);
  await sql(`ALTER TABLE otx_outcome_events ADD COLUMN IF NOT EXISTS outcome_score NUMERIC(4,3)`);
  await sql(`ALTER TABLE otx_outcome_events ADD COLUMN IF NOT EXISTS conversion_flag BOOLEAN DEFAULT false`);
  await sql(`ALTER TABLE otx_pipeline_runs ADD COLUMN IF NOT EXISTS opportunities_found INT DEFAULT 0`);
  await sql(`ALTER TABLE otx_pipeline_runs ADD COLUMN IF NOT EXISTS threats_found INT DEFAULT 0`);

  // ── Layer 7 OTX tables (businesses + agent-specific storage) ─────────────
  await sql(`CREATE TABLE IF NOT EXISTS businesses (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT        NOT NULL,
    sector     TEXT        NOT NULL DEFAULT 'local',
    geo_city   TEXT        NOT NULL DEFAULT 'תל אביב',
    price_tier TEXT        NOT NULL DEFAULT 'mid',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(name)
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_businesses_name ON businesses(name)`);
  await sql(`CREATE TABLE IF NOT EXISTS viral_patterns (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    pattern_type     TEXT        NOT NULL DEFAULT 'format',
    pattern_value    TEXT        NOT NULL,
    platform         TEXT        NOT NULL DEFAULT 'instagram',
    virality_score   NUMERIC(3,2) NOT NULL DEFAULT 0.7,
    peak_hour        INT         NOT NULL DEFAULT 19,
    script_template  TEXT,
    source_url       TEXT        NOT NULL,
    confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.7,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_viral_patterns_biz ON viral_patterns(business_id, created_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS influence_integrity_scores (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    organic_pct      NUMERIC(5,2) NOT NULL DEFAULT 80,
    bot_pct          NUMERIC(5,2) NOT NULL DEFAULT 10,
    coordinated_pct  NUMERIC(5,2) NOT NULL DEFAULT 10,
    verdict          TEXT        NOT NULL DEFAULT 'organic',
    recommendation   TEXT        NOT NULL DEFAULT '',
    source_url       TEXT        NOT NULL,
    confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.7,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_influence_biz ON influence_integrity_scores(business_id, created_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS visual_osint_signals (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id           UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    media_url             TEXT        NOT NULL,
    platform              TEXT        NOT NULL DEFAULT 'google',
    business_insight      TEXT        NOT NULL DEFAULT '',
    unmet_demand_detected BOOLEAN     NOT NULL DEFAULT false,
    sentiment_visual      TEXT        NOT NULL DEFAULT 'neutral',
    source_url            TEXT        NOT NULL,
    confidence_score      NUMERIC(3,2) NOT NULL DEFAULT 0.65,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_visual_osint_biz ON visual_osint_signals(business_id, created_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS retention_alerts (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id           UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_identifier   TEXT        NOT NULL,
    risk_level            TEXT        NOT NULL DEFAULT 'low',
    churn_probability     NUMERIC(4,3) NOT NULL DEFAULT 0.1,
    last_interaction_days INT         NOT NULL DEFAULT 0,
    recommended_offer     TEXT        NOT NULL DEFAULT '',
    source_url            TEXT        NOT NULL,
    confidence_score      NUMERIC(3,2) NOT NULL DEFAULT 0.75,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_retention_biz ON retention_alerts(business_id, created_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS pricing_recommendations (
    id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id                UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    lead_context               TEXT        NOT NULL DEFAULT '',
    market_supply              TEXT        NOT NULL DEFAULT 'balanced',
    competitor_avg_price       NUMERIC(10,2),
    recommended_price_modifier NUMERIC(5,2) NOT NULL DEFAULT 0,
    recommended_tactic         TEXT        NOT NULL DEFAULT 'standard',
    tactic_reason              TEXT        NOT NULL DEFAULT '',
    confidence_pct             INT         NOT NULL DEFAULT 70,
    valid_until                TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_url                 TEXT        NOT NULL,
    confidence_score           NUMERIC(3,2) NOT NULL DEFAULT 0.7,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_pricing_biz ON pricing_recommendations(business_id, created_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS campaign_drafts (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    trigger_event    TEXT        NOT NULL DEFAULT '',
    platform         TEXT        NOT NULL DEFAULT 'instagram',
    headline         TEXT        NOT NULL DEFAULT '',
    body_text        TEXT        NOT NULL DEFAULT '',
    cta_text         TEXT        NOT NULL DEFAULT '',
    estimated_reach  INT         NOT NULL DEFAULT 300,
    recommended_time TIMESTAMPTZ,
    duration_hours   INT         NOT NULL DEFAULT 24,
    auto_publish     BOOLEAN     NOT NULL DEFAULT false,
    status           TEXT        NOT NULL DEFAULT 'draft',
    source_url       TEXT        NOT NULL,
    confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.78,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_campaign_drafts_biz ON campaign_drafts(business_id, created_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS expansion_opportunities (
    id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id               UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    opportunity_title         TEXT        NOT NULL DEFAULT '',
    unmet_demand_description  TEXT        NOT NULL DEFAULT '',
    demand_signal_count       INT         NOT NULL DEFAULT 0,
    geo                       TEXT,
    estimated_monthly_revenue NUMERIC(12,2),
    estimated_investment      NUMERIC(12,2),
    roi_months                INT,
    source_url                TEXT        NOT NULL,
    confidence_score          NUMERIC(3,2) NOT NULL DEFAULT 0.7,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_expansion_biz ON expansion_opportunities(business_id, created_at DESC)`);
  await sql(`CREATE TABLE IF NOT EXISTS reputation_incidents (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id          UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    severity             TEXT        NOT NULL DEFAULT 'low',
    incident_type        TEXT        NOT NULL DEFAULT 'routine_scan',
    description          TEXT        NOT NULL DEFAULT '',
    recommended_response TEXT        NOT NULL DEFAULT '',
    response_deadline    TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved             BOOLEAN     NOT NULL DEFAULT false,
    source_url           TEXT        NOT NULL,
    confidence_score     NUMERIC(3,2) NOT NULL DEFAULT 0.82,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_reputation_biz ON reputation_incidents(business_id, created_at DESC)`);

  // ── Performance indexes on high-traffic columns ───────────────────────────
  // These are the most-queried fields across all entity list calls. Adding
  // indexes here dramatically reduces full-table scan time at scale.
  await sql(`CREATE INDEX IF NOT EXISTS idx_leads_biz_status   ON leads(linked_business, status, created_date DESC)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_leads_biz_score    ON leads(linked_business, score DESC NULLS LAST)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_reviews_biz_status ON reviews(linked_business, response_status, created_date DESC)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_reviews_biz_rating ON reviews(linked_business, rating)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_mkt_signals_biz    ON market_signals(linked_business, created_date DESC)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_raw_signals_biz    ON raw_signals(linked_business, created_date DESC)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_actions_biz_date   ON actions(linked_business, created_date DESC)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_auto_actions_biz   ON auto_actions(linked_business, status, created_date DESC)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_alerts_biz_active  ON proactive_alerts(linked_business, is_dismissed, is_acted_on, created_at DESC)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_predictions_biz    ON predictions(linked_business, created_date DESC)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_health_biz         ON health_scores(linked_business, created_date DESC)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_automation_biz_name ON automation_logs(linked_business, automation_name, created_date DESC)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_competitors_biz    ON competitors(linked_business, not_relevant, created_date DESC)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_organic_posts_biz  ON organic_posts(linked_business, status, created_date DESC)`);

  console.log('Startup SQL complete');

  // ── Post-startup table existence check ───────────────────────────────────
  // Verifies all critical tables exist and logs any missing ones.
  const REQUIRED_TABLES = [
    'business_profiles', 'leads', 'reviews', 'competitors',
    'market_signals', 'raw_signals', 'health_scores', 'auto_actions',
    'sector_knowledge', 'business_memory', 'agent_learning_profiles',
    'meta_configurations', 'otx_decisions', 'otx_outcome_events',
    'otx_pipeline_runs', 'otx_recommendations',
  ];
  const missingTables: string[] = [];
  for (const table of REQUIRED_TABLES) {
    try {
      const res: any[] = await db.$queryRawUnsafe(
        `SELECT to_regclass('public.${table}')::text AS exists`
      );
      if (!res[0]?.exists) missingTables.push(table);
    } catch {
      missingTables.push(table);
    }
  }
  if (missingTables.length > 0) {
    console.error('[STARTUP] Missing tables detected:', missingTables.join(', '));
    console.error('[STARTUP] Run POST /api/migrate to create missing tables.');
  } else {
    console.log('[STARTUP] All required tables verified present.');
  }

  if (!process.env.NODE_ENV) {
    console.warn('[WARN] NODE_ENV is not set. Set NODE_ENV=production on Render to enable security hardening and error sanitization.');
  }

  // ── Google token refresh scheduler — runs every 30 minutes ───────────────
  setInterval(() => {
    refreshExpiringGoogleTokens().catch(() => {});
  }, 30 * 60 * 1000);
  // Run once at startup too
  refreshExpiringGoogleTokens().catch(() => {});

  startScheduler();
});
