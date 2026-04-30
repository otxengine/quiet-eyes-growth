import dotenv from 'dotenv';
dotenv.config({ override: true }); // override empty system env vars with .env file values
import { registerAllHandlers } from './events/EventChoreographer';
import express from 'express';
import cors from 'cors';
import entityRouter from './routes/entities';
import functionRouter from './routes/functions/index';
import agentTriggerRouter from './routes/agentTrigger';
import orchestratorStatusRouter from './routes/orchestratorStatus';
import feedbackRouter from './routes/feedback';
import learningRouter from './routes/learning';
import migrateRouter from './routes/migrate';
import metaAuthRouter from './routes/meta/auth';
import metaWebhookRouter from './routes/meta/webhook';
import orchestratorRouter from './routes/orchestrator';
import approvalsRouter from './routes/approvals';
import explainabilityRouter from './routes/explainability';
import kpiRouter from './routes/kpi';
import oauthRouter from './routes/oauth';
import roiRouter from './routes/roi';

// Wire up all event choreography handlers at startup
registerAllHandlers();

import { startScheduler } from './scheduler';

const app = express();
const PORT = process.env.PORT || 3002;

const ALLOWED_ORIGINS = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .concat(['http://localhost:5174', 'http://localhost:5175']);

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

// Capture raw body for Meta webhook signature verification.
// Must be registered BEFORE express.json() so we get the unmodified Buffer.
app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));

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
app.use('/api/orchestrator', orchestratorRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/explain', explainabilityRouter);
app.use('/api/kpi', kpiRouter);
app.use('/api/oauth', oauthRouter);
app.use('/api', roiRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// External cron trigger — POST /api/cron/run?secret=XXX
// Called by cron-job.org every 14 minutes to keep Render alive + run pipelines
app.post('/api/cron/run', async (_req, res) => {
  const secret = _req.query.secret as string;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
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
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Debug endpoint — shows all data counts for a business profile
// Lead-finding diagnostic — shows exactly what Tavily returns and what the LLM says
app.get('/api/debug/leads/:bpId', async (req, res) => {
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

app.get('/api/debug/:bpId', async (req, res) => {
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
  // Create raw SQL tables that are referenced by agents but not in Prisma schema
  try {
    const { prisma: db } = await import('./db');
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS agent_heartbeat (
        id              SERIAL PRIMARY KEY,
        agent_name      TEXT NOT NULL,
        last_ping_utc   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_ingestion_utc TIMESTAMPTZ,
        status          TEXT NOT NULL DEFAULT 'ok',
        error_message   TEXT
      )
    `);
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS agent_data_bus (
        id           SERIAL PRIMARY KEY,
        event_type   TEXT NOT NULL,
        source_agent TEXT NOT NULL,
        payload      JSONB,
        status       TEXT NOT NULL DEFAULT 'pending',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS otx_decisions (
        id                     TEXT PRIMARY KEY,
        business_id            TEXT NOT NULL,
        decision_type          TEXT NOT NULL,
        title                  TEXT NOT NULL,
        reasoning              TEXT,
        confidence_score       NUMERIC(5,3),
        business_fit_score     NUMERIC(5,3),
        timing_fit_score       NUMERIC(5,3),
        historical_success_score NUMERIC(5,3),
        roi_score              NUMERIC(5,3),
        status                 TEXT NOT NULL DEFAULT 'pending',
        insight_id             TEXT,
        trace_id               TEXT,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_otx_decisions_biz ON otx_decisions(business_id, created_at DESC)`);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_agent_heartbeat_name ON agent_heartbeat(agent_name, last_ping_utc DESC)`);
    await db.$executeRawUnsafe(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS subscription_plan TEXT`);
    console.log('Startup tables ready (agent_heartbeat, agent_data_bus, otx_decisions)');
  } catch (e: any) {
    console.warn('Startup table creation skipped:', e.message);
  }
  startScheduler();
});
