/**
 * Admin User Management
 *
 * One-off admin operations. Mounted behind requireAdmin (index.ts); the panel itself is routes/admin.ts.
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { createLogger } from '../infra/logger';
import { bulkBootstrapAllBusinesses, bootstrapBusinessIntelligence } from '../lib/bootstrapIntelligence';
import { searchCompetitorsByKeyword } from '../lib/dataforseo';
import { getCollectorMetrics, checkAndAlertFailureRate, getTrendMetrics } from '../lib/collectorMetrics';
import { getUserEmail } from '../lib/ownership';

const logger = createLogger('AdminUsers');
const router = Router();

// ── POST /api/admin/bulk-bootstrap ────────────────────────────────────────────
// Retroactively populates sector_profile + agent_missions for all existing accounts
router.post('/bulk-bootstrap', async (req: Request, res: Response) => {
  const { businessId } = req.body;

  // Single-business mode
  if (businessId) {
    try {
      const did = await bootstrapBusinessIntelligence(businessId);
      return res.json({ ok: true, upgraded: did ? 1 : 0, message: did ? 'Bootstrapped' : 'Already up to date' });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // Bulk mode — responds immediately, runs in background
  res.json({ ok: true, message: 'Bulk bootstrap started in background — check server logs for progress' });
  bulkBootstrapAllBusinesses().catch(e => logger.warn(`bulk-bootstrap error: ${e.message}`));
});

// ── POST /api/admin/backfill-owner-email ───────────────────────────────────────
// One-off: resolves owner_email (via Clerk) for currently-active profiles that
// don't have it yet, so the reactivation-on-Clerk-delete flow (see
// routes/webhooks/clerk.ts, routes/reactivation.ts) has an email to match on
// even for accounts created before this feature shipped.
router.post('/backfill-owner-email', async (req: Request, res: Response) => {
  const rows = await prisma.$queryRawUnsafe<{ id: string; created_by: string | null }[]>(
    `SELECT id, created_by FROM business_profiles
     WHERE (is_active IS NULL OR is_active = true) AND owner_email IS NULL`,
  );

  let updated = 0;
  const skipped: string[] = [];
  for (const row of rows) {
    if (!row.created_by) { skipped.push(row.id); continue; }
    const email = await getUserEmail(row.created_by);
    if (!email) { skipped.push(row.id); continue; }
    await prisma.$executeRawUnsafe(
      `UPDATE business_profiles SET owner_email = $1 WHERE id = $2`, email, row.id,
    );
    updated++;
  }

  return res.json({ ok: true, checked: rows.length, updated, skipped });
});

// GET /api/admin/collector-metrics — observability for KAN-26
router.get('/collector-metrics', async (req: Request, res: Response) => {
  const windowHours = parseInt(req.query.windowHours as string || '24', 10);
  const metrics = await getCollectorMetrics(windowHours).catch(e => ({ error: e.message }));
  res.json(metrics);
});

// GET /api/admin/trend-metrics — KAN-88 trend observability (yield, early rate, viral hit)
router.get('/trend-metrics', async (req: Request, res: Response) => {
  const windowHours = parseInt(req.query.windowHours as string || '720', 10);
  const metrics = await getTrendMetrics(windowHours).catch(e => ({ error: e.message }));
  res.json(metrics);
});

// POST /api/admin/collector-metrics/check — manually trigger alert check
router.post('/collector-metrics/check', async (req: Request, res: Response) => {
  await checkAndAlertFailureRate().catch(e => logger.warn(`alert check failed: ${e.message}`));
  res.json({ ok: true });
});

// GET /api/admin/review-pipeline-status?competitorId=...|businessProfileId=...
// Tracks the async DataForSEO fetch + LLM topic-extraction pipeline for a
// competitor's (or own-business's) reviews — the gap between "task submitted"
// and "reviews visible with topics" that isn't observable from the entities API.
router.get('/review-pipeline-status', async (req: Request, res: Response) => {
  const { competitorId, businessProfileId } = req.query as { competitorId?: string; businessProfileId?: string };
  if (!competitorId && !businessProfileId) {
    return res.status(400).json({ error: 'competitorId or businessProfileId required' });
  }

  const taskWhere = competitorId
    ? { task_type: 'competitor', linked_competitor: competitorId }
    : { task_type: 'own', business_profile_id: businessProfileId };
  const reviewWhere = competitorId
    ? { linked_competitor: competitorId }
    : { linked_business: businessProfileId, linked_competitor: null };

  const [tasks, reviews] = await Promise.all([
    prisma.dataForSeoReviewTask.findMany({ where: taskWhere, orderBy: { requested_at: 'desc' }, take: 10 }),
    prisma.review.findMany({ where: reviewWhere, select: { topics: true } }),
  ]);

  const reviews_total = reviews.length;
  const reviews_analyzed = reviews.filter(r => r.topics != null).length;

  res.json({
    dataforseo_tasks: tasks.map(t => ({
      task_id: t.task_id, status: t.status, requested_at: t.requested_at,
      completed_at: t.completed_at, error_message: t.error_message,
      cost_usd: t.cost_usd, new_reviews_count: t.new_reviews_count,
    })),
    reviews_total,
    reviews_analyzed,
    reviews_pending_llm: reviews_total - reviews_analyzed,
  });
});

// ponytail: temp test endpoint — remove after KAN-210 is verified
router.get('/test-dataforseo', async (req: Request, res: Response) => {
  const results = await searchCompetitorsByKeyword('סושי', 32.0853, 34.7818, 14, 5);
  res.json({ count: results.candidates.length, sample: results.candidates.slice(0, 2), costUsd: results.costUsd });
});

export default router;
