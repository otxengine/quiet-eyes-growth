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

// Wire up all event choreography handlers at startup
registerAllHandlers();

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
}));

// Capture raw body for Meta webhook signature verification.
// Must be registered BEFORE express.json() so we get the unmodified Buffer.
app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));

// Only mount Clerk middleware when a real secret key is configured
const clerkKey = process.env.CLERK_SECRET_KEY || '';
if (clerkKey && !clerkKey.includes('your_key_here')) {
  const { clerkMiddleware } = require('@clerk/express');
  app.use(clerkMiddleware());
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

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Debug endpoint — shows all data counts for a business profile
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
