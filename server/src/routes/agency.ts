/**
 * agency.ts — Agency client management routes.
 *
 * Routes:
 *   GET  /api/agency/clients          → list all client orgs for current user's agency
 *   POST /api/agency/clients          → add a new client org (creates org if needed)
 *   DELETE /api/agency/clients/:id    → remove client relationship
 *   GET  /api/agency/aggregate        → aggregate health metrics across all client branches
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { getUserId } from '../middleware/auth';

const router = Router();

// ── Helper: find the agency org for this user ─────────────────────────────────

async function getUserAgencyOrg(userId: string): Promise<{ id: string; name: string } | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT o.id, o.name FROM organizations o
       JOIN organization_members om ON om.org_id = o.id
       WHERE om.user_id = $1 AND om.status = 'active'
         AND o.is_agency = true
         AND (om.role = 'owner' OR om.role = 'admin')
       LIMIT 1`,
      userId,
    );
    return rows?.[0] || null;
  } catch { return null; }
}

// ── GET /api/agency/clients ───────────────────────────────────────────────────

router.get('/clients', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const agency = await getUserAgencyOrg(userId);
  if (!agency) return res.status(404).json({ error: 'No agency org found' });

  try {
    const clients = await prisma.$queryRawUnsafe<any[]>(
      `SELECT ac.id as relationship_id, ac.status, ac.added_at,
              o.id as org_id, o.name as org_name, o.branch_count, o.plan_id, o.subscription_status
       FROM agency_clients ac
       JOIN organizations o ON o.id = ac.client_org_id
       WHERE ac.agency_org_id = $1 AND ac.status = 'active'
       ORDER BY ac.added_at DESC`,
      agency.id,
    );

    // Enrich with branches
    const withBranches = await Promise.all(
      clients.map(async (c) => {
        const branches = await prisma.$queryRawUnsafe<any[]>(
          `SELECT id, name, city, category, onboarding_completed, branch_display_name, branch_role
           FROM business_profiles
           WHERE organization_id = $1 AND (is_active IS NULL OR is_active = true)
           ORDER BY COALESCE(branch_sort_order, 0) ASC`,
          c.org_id,
        );
        return { ...c, branches };
      }),
    );

    return res.json({ agency, clients: withBranches });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agency/clients ──────────────────────────────────────────────────
// Adds an existing org as a client, or creates a new client org.

router.post('/clients', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const agency = await getUserAgencyOrg(userId);
  if (!agency) return res.status(404).json({ error: 'No agency org found' });

  const { client_org_id, client_name } = req.body;
  if (!client_org_id && !client_name) {
    return res.status(400).json({ error: 'client_org_id or client_name required' });
  }

  try {
    let orgId = client_org_id;

    if (!orgId) {
      // Create a new org for this client
      const newOrg = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO organizations (id, name, owner_user_id, is_agency, plan_id, branch_count, subscription_status, created_at)
         VALUES (gen_random_uuid()::text, $1, $2, false, 'starter', 0, 'active', NOW())
         RETURNING id`,
        client_name, userId,
      );
      orgId = newOrg[0].id;
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO agency_clients (id, agency_org_id, client_org_id, status, added_at)
       VALUES (gen_random_uuid()::text, $1, $2, 'active', NOW())
       ON CONFLICT (agency_org_id, client_org_id) DO UPDATE SET status = 'active'`,
      agency.id, orgId,
    );

    return res.json({ ok: true, client_org_id: orgId });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/agency/clients/:clientOrgId ───────────────────────────────────

router.delete('/clients/:clientOrgId', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const agency = await getUserAgencyOrg(userId);
  if (!agency) return res.status(404).json({ error: 'No agency org found' });

  await prisma.$executeRawUnsafe(
    `UPDATE agency_clients SET status = 'removed'
     WHERE agency_org_id = $1 AND client_org_id = $2`,
    agency.id, req.params.clientOrgId,
  );
  return res.json({ ok: true });
});

// ── GET /api/agency/aggregate ─────────────────────────────────────────────────
// Returns aggregate health + alert counts across all client business profiles.

router.get('/aggregate', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const agency = await getUserAgencyOrg(userId);
  if (!agency) return res.status(404).json({ error: 'No agency org found' });

  try {
    // Get all client business profile IDs
    const profiles = await prisma.$queryRawUnsafe<any[]>(
      `SELECT bp.id, bp.name, bp.city, bp.category, o.name as org_name, o.id as org_id
       FROM business_profiles bp
       JOIN organizations o ON o.id = bp.organization_id
       JOIN agency_clients ac ON ac.client_org_id = o.id
       WHERE ac.agency_org_id = $1 AND ac.status = 'active'
         AND (bp.is_active IS NULL OR bp.is_active = true)
         AND bp.onboarding_completed = true`,
      agency.id,
    );

    if (!profiles.length) return res.json({ agency, profiles: [], totals: {} });

    const ids = profiles.map(p => p.id);

    // Parallel aggregate queries
    const [signals, alerts, leads, reviews] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(
        `SELECT linked_business, COUNT(*) as cnt FROM market_signals
         WHERE linked_business = ANY($1::text[]) AND is_read = false
         GROUP BY linked_business`,
        ids,
      ),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT linked_business, COUNT(*) as cnt FROM proactive_alerts
         WHERE linked_business = ANY($1::text[]) AND is_dismissed = false AND is_acted_on = false
         GROUP BY linked_business`,
        ids,
      ),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT linked_business, COUNT(*) as cnt FROM leads
         WHERE linked_business = ANY($1::text[]) AND status = 'hot'
         GROUP BY linked_business`,
        ids,
      ),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT linked_business, COUNT(*) as cnt FROM reviews
         WHERE linked_business = ANY($1::text[]) AND response_status = 'pending'
         GROUP BY linked_business`,
        ids,
      ),
    ]);

    // Index by business id
    const index = (rows: any[]) => Object.fromEntries(rows.map(r => [r.linked_business, Number(r.cnt)]));
    const sigMap = index(signals);
    const alertMap = index(alerts);
    const leadMap = index(leads);
    const reviewMap = index(reviews);

    const enriched = profiles.map(p => ({
      ...p,
      unread_signals: sigMap[p.id] || 0,
      active_alerts: alertMap[p.id] || 0,
      hot_leads: leadMap[p.id] || 0,
      pending_reviews: reviewMap[p.id] || 0,
    }));

    const totals = {
      profile_count: profiles.length,
      unread_signals: enriched.reduce((s, p) => s + p.unread_signals, 0),
      active_alerts: enriched.reduce((s, p) => s + p.active_alerts, 0),
      hot_leads: enriched.reduce((s, p) => s + p.hot_leads, 0),
      pending_reviews: enriched.reduce((s, p) => s + p.pending_reviews, 0),
    };

    return res.json({ agency, profiles: enriched, totals });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
