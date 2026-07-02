/**
 * Admin User Management
 *
 * DELETE /api/admin/users/:businessId  — fully delete user (Clerk + all DB data)
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { isAdminKeyRequest } from '../middleware/auth';
import { createLogger } from '../infra/logger';
import { bulkBootstrapAllBusinesses, bootstrapBusinessIntelligence } from '../lib/bootstrapIntelligence';
import { getCollectorMetrics, checkAndAlertFailureRate } from '../lib/collectorMetrics';

const logger = createLogger('AdminUsers');
const router = Router();

// ── POST /api/admin/bulk-bootstrap ────────────────────────────────────────────
// Retroactively populates sector_profile + agent_missions for all existing accounts
router.post('/bulk-bootstrap', async (req: Request, res: Response) => {
  if (!isAdminKeyRequest(req)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

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

// ── DELETE /api/admin/users/:businessId ───────────────────────────────────────
router.delete('/users/:businessId', async (req: Request, res: Response) => {
  if (!isAdminKeyRequest(req)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const businessId = req.params.businessId as string;
  if (!businessId) return res.status(400).json({ error: 'businessId required' });

  const results: string[] = [];
  const errors:  string[] = [];

  // 1. Fetch the BusinessProfile to get the owner email / Clerk userId
  const bp = await prisma.businessProfile.findUnique({ where: { id: businessId } }).catch(() => null);
  if (!bp) return res.status(404).json({ error: 'Business not found' });

  const ownerEmail = (bp as any).created_by as string | null;
  logger.info(`Deleting user ${ownerEmail} (bp: ${businessId})`);

  // 2. Delete Clerk user (look up by email)
  const clerkKey = process.env.CLERK_SECRET_KEY || '';
  if (clerkKey && !clerkKey.includes('your_key_here') && ownerEmail) {
    try {
      const { createClerkClient } = require('@clerk/backend');
      const clerk = createClerkClient({ secretKey: clerkKey });

      // Find Clerk user by email
      const userList = await clerk.users.getUserList({ emailAddress: [ownerEmail] });
      const clerkUsers = userList?.data ?? userList ?? [];

      if (clerkUsers.length > 0) {
        const clerkUserId = clerkUsers[0].id;
        await clerk.users.deleteUser(clerkUserId);
        results.push(`Clerk user deleted: ${clerkUserId}`);
        logger.info(`Clerk user ${clerkUserId} deleted`);
      } else {
        results.push(`Clerk user not found for email: ${ownerEmail} (already deleted or never existed)`);
      }
    } catch (e: any) {
      const msg = e.message || String(e);
      errors.push(`Clerk delete failed: ${msg}`);
      logger.warn(`Clerk delete failed for ${ownerEmail}: ${msg}`);
      // Don't abort — still delete DB data
    }
  } else {
    results.push('Clerk deletion skipped (dev mode or no key)');
  }

  // 3. Delete all DB data related to this business
  const tables: Array<[string, string]> = [
    ['automation_logs',        'linked_business'],
    ['market_signals',         'linked_business'],
    ['leads',                  'linked_business'],
    ['competitors',            'linked_business'],
    ['reviews',                'linked_business'],
    ['proactive_alerts',       'linked_business'],
    ['pending_alerts',         'linked_business'],
    ['actions',                'linked_business'],
    ['predictions',            'linked_business'],
    ['tasks',                  'linked_business'],
    ['weekly_reports',         'linked_business'],
    ['health_scores',          'linked_business'],
    ['outcome_logs',           'linked_business'],
    ['sector_knowledge',       'linked_business'],
    ['social_accounts',        'linked_business'],
    ['social_signals',         'linked_business'],
    ['auto_actions',           'linked_business'],
    ['campaigns',              'linked_business'],
    ['media_assets',           'linked_business'],
    ['organic_posts',          'linked_business'],
    ['review_requests',        'linked_business'],
    ['customer_surveys',       'linked_business'],
    ['business_locations',     'linked_business'],
    ['metrics_snapshots',      'linked_business'],
    ['raw_signals',            'linked_business'],
    ['ai_outputs',             'linked_business'],
    ['feedback_events',        'linked_business'],
    ['business_memory',        'linked_business'],
    ['agent_learning_profiles','linked_business'],
    ['learning_signals',       'linked_business'],
    // OTX tables
    ['otx_decisions',          'business_id'],
    ['otx_fused_insights',     'business_id'],
    ['otx_recommendations',    'business_id'],
    ['otx_execution_tasks',    'business_id'],
    ['otx_sent_actions',       'business_id'],
    ['otx_outcome_events',     'business_id'],
    ['otx_policy_weights',     'business_id'],
    ['otx_pipeline_runs',      'business_id'],
    ['otx_opportunities',      'business_id'],
    ['otx_threats',            'business_id'],
    ['otx_weight_update_log',  'business_id'],
    ['otx_trust_snapshots',    'business_id'],
    ['otx_churn_risk_logs',    'business_id'],
    ['v3_approval_requests',   'business_id'],
    ['market_insights',        'business_id'],
    ['meta_configurations',    'business_id'],
    ['rating_history',         'business_id'],
    ['composite_signals',      'business_id'],
    ['business_constraints',   'business_id'],
    ['system_events',          'business_id'],
  ];

  for (const [table, col] of tables) {
    try {
      const r = await prisma.$executeRawUnsafe(
        `DELETE FROM ${table} WHERE ${col} = $1`, businessId
      );
      results.push(`${table}: deleted ${r} rows`);
    } catch (e: any) {
      // Table might not exist or col name wrong — not fatal
      errors.push(`${table}: ${e.message?.substring(0, 80)}`);
    }
  }

  // 4. Finally delete the BusinessProfile itself
  try {
    await prisma.businessProfile.delete({ where: { id: businessId } });
    results.push('BusinessProfile: deleted');
  } catch (e: any) {
    errors.push(`BusinessProfile delete: ${e.message?.substring(0, 80)}`);
  }

  logger.info(`User deletion complete. Results: ${results.length}, Errors: ${errors.length}`);

  return res.json({
    ok:      errors.filter(e => e.includes('BusinessProfile')).length === 0,
    email:   ownerEmail,
    results,
    errors,
  });
});

// GET /api/admin/collector-metrics — observability for KAN-26
router.get('/collector-metrics', async (req: Request, res: Response) => {
  if (!isAdminKeyRequest(req)) return res.status(403).json({ error: 'Admin access required' });
  const windowHours = parseInt(req.query.windowHours as string || '24', 10);
  const metrics = await getCollectorMetrics(windowHours).catch(e => ({ error: e.message }));
  res.json(metrics);
});

// POST /api/admin/collector-metrics/check — manually trigger alert check
router.post('/collector-metrics/check', async (req: Request, res: Response) => {
  if (!isAdminKeyRequest(req)) return res.status(403).json({ error: 'Admin access required' });
  await checkAndAlertFailureRate().catch(e => logger.warn(`alert check failed: ${e.message}`));
  res.json({ ok: true });
});

export default router;
