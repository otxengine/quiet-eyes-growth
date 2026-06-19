import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { getUserId, isAdminKeyRequest } from '../middleware/auth';
import { cleanupCompetitorsByRadius } from '../lib/competitorRadiusCleanup';

// ── Clerk email lookup cache ───────────────────────────────────────────────────
// Maps userId → email, TTL 10 minutes. Avoids repeated Clerk API calls.
const _emailCache = new Map<string, { email: string; expires: number }>();

async function getUserEmail(userId: string): Promise<string | null> {
  const cached = _emailCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.email;

  try {
    const secretKey = process.env.CLERK_SECRET_KEY || '';
    if (!secretKey || secretKey.includes('your_key_here')) return null;
    const { createClerkClient } = require('@clerk/express');
    const cc = createClerkClient({ secretKey });
    const user = await cc.users.getUser(userId);
    const email = user?.emailAddresses?.[0]?.emailAddress || null;
    if (email) _emailCache.set(userId, { email, expires: Date.now() + 10 * 60_000 });
    return email;
  } catch {
    return null;
  }
}

// Column name allowlist for raw SQL fallback — prevents SQL injection via key names
const SAFE_COLUMN = /^[a-z_][a-z0-9_]*$/i;

/** Returns all businessProfileIds owned by (or accessible to) a given userId */
async function getUserBusinessIds(userId: string): Promise<string[]> {
  const byId = await prisma.businessProfile.findMany({
    where: { created_by: userId },
    select: { id: true },
  });
  if (byId.length > 0) return byId.map(p => p.id);
  // Fallback: admin-created profiles store email as created_by
  const email = await getUserEmail(userId);
  if (!email) return [];
  const byEmail = await prisma.businessProfile.findMany({
    where: { created_by: email },
    select: { id: true },
  });
  return byEmail.map(p => p.id);
}

/** Returns true if the record with `id` on `model` belongs to `userId` */
async function verifyRecordOwnership(model: any, id: string, userId: string): Promise<boolean> {
  try {
    // Step 1: check created_by match (works for all models)
    const base = await model.findFirst({
      where: { id },
      select: { id: true, created_by: true },
    });
    if (!base) return false;
    if (base.created_by === userId) return true;
    // Step 2: also accept email fallback (admin-created profiles store email in created_by)
    const email = await getUserEmail(userId);
    if (email && base.created_by === email) return true;

    // Step 3: check linked_business — not all models have this field
    let linkedBusiness: string | null = null;
    try {
      const ext = await model.findFirst({
        where: { id },
        select: { linked_business: true },
      });
      linkedBusiness = ext?.linked_business ?? null;
    } catch { /* model has no linked_business field */ }

    if (linkedBusiness) {
      const bizIds = await getUserBusinessIds(userId);
      return bizIds.includes(linkedBusiness);
    }
    return false;
  } catch {
    return false;
  }
}

const router = Router();

// Map entity names (as used by frontend) to Prisma model delegate keys
const ENTITY_MAP: Record<string, string> = {
  BusinessProfile: 'businessProfile',
  Lead: 'lead',
  Review: 'review',
  Competitor: 'competitor',
  MarketSignal: 'marketSignal',
  RawSignal: 'rawSignal',
  Task: 'task',
  AutomationLog: 'automationLog',
  WeeklyReport: 'weeklyReport',
  HealthScore: 'healthScore',
  OutcomeLog: 'outcomeLog',
  SectorKnowledge: 'sectorKnowledge',
  Action: 'action',
  Prediction: 'prediction',
  ProactiveAlert: 'proactiveAlert',
  PendingAlert: 'pendingAlert',
  ReviewRequest: 'reviewRequest',
  CustomerSurvey: 'customerSurvey',
  BusinessLocation: 'businessLocation',
  MetricsSnapshot: 'metricsSnapshot',
  SocialAccount: 'socialAccount',
  SocialSignal: 'socialSignal',
  AutoAction: 'autoAction',
  Campaign: 'campaign',
  MediaAsset: 'mediaAsset',
  OrganicPost: 'organicPost',
  SupportTicket: 'supportTicket',
};

function getModel(entity: string): any {
  const key = ENTITY_MAP[entity];
  if (!key) return null;
  return (prisma as any)[key];
}

function buildWhere(filter: Record<string, any>, userId?: string | null): Record<string, any> {
  const where: Record<string, any> = {};

  for (const [k, v] of Object.entries(filter)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      // Handle nested operators like { gte: '...' }
      where[k] = v;
    } else {
      where[k] = v;
    }
  }

  return where;
}

function buildOrderBy(sort?: string): Record<string, 'asc' | 'desc'> | undefined {
  if (!sort) return { created_date: 'desc' };
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  // Map common Base44 sort fields
  const fieldMap: Record<string, string> = {
    created_date: 'created_date',
    detected_at: 'detected_at',
    score: 'score',
    name: 'name',
  };
  const mapped = fieldMap[field] || field;
  return { [mapped]: desc ? 'desc' : 'asc' };
}

// GET /api/entities/me — current user info
router.get('/me', (req: Request, res: Response) => {
  if (isAdminKeyRequest(req)) {
    return res.json({ id: 'admin', email: 'admin' });
  }
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    // email must match created_by so AppLayout's BusinessProfile.filter({ created_by: user.email }) works
    res.json({ id: userId, email: userId });
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// GET /api/entities/:entity — filter/list
router.get('/:entity', async (req: Request, res: Response) => {
  const model = getModel(String(req.params.entity));
  if (!model) return res.status(404).json({ error: `Unknown entity: ${req.params.entity}` });

  try {
    const filter = req.query.filter ? JSON.parse(req.query.filter as string) : {};
    const sort = req.query.sort as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 200;

    // Admin key bypasses all tenant isolation
    if (isAdminKeyRequest(req)) {
      const records = await model.findMany({
        where: buildWhere(filter),
        orderBy: buildOrderBy(sort),
        take: Math.min(limit, 1000),
      });
      return res.json(records);
    }

    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const where = buildWhere(filter);

    if (req.params.entity === 'BusinessProfile') {
      // BusinessProfile: scope to records owned by this user
      where.created_by = userId;
    } else {
      // All other entities: verify the requested linked_business belongs to this user
      const requestedBizId = filter.linked_business as string | undefined;
      const ownedBizIds = await getUserBusinessIds(userId);

      if (requestedBizId) {
        if (!ownedBizIds.includes(requestedBizId)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      } else if (ownedBizIds.length > 0) {
        // No filter provided — restrict to user's own businesses
        where.linked_business = { in: ownedBizIds };
      } else {
        // User has no businesses yet — return empty
        return res.json([]);
      }
    }

    const records = await model.findMany({
      where,
      orderBy: buildOrderBy(sort),
      take: Math.min(limit, 1000),
    });

    res.json(records);
  } catch (err: any) {
    console.error(`GET /entities/${req.params.entity}:`, err.message);
    const isDev = process.env.NODE_ENV !== 'production';
    res.status(500).json({ error: isDev ? err.message : 'Internal server error' });
  }
});

// POST /api/entities/:entity — create
router.post('/:entity', async (req: Request, res: Response) => {
  const model = getModel(String(req.params.entity));
  if (!model) return res.status(404).json({ error: `Unknown entity: ${req.params.entity}` });

  try {
    const userId = getUserId(req);
    const data = { ...req.body };
    if (userId && !data.created_by) data.created_by = userId;

    const record = await model.create({ data });
    res.status(201).json(record);
  } catch (err: any) {
    console.error(`POST /entities/${req.params.entity}:`, err.message);
    const isDev = process.env.NODE_ENV !== 'production';
    res.status(500).json({ error: isDev ? err.message : 'Internal server error' });
  }
});

// PATCH /api/entities/:entity/:id — update
router.patch('/:entity/:id', async (req: Request, res: Response) => {
  const entity = String(req.params.entity);
  const model = getModel(entity);
  if (!model) return res.status(404).json({ error: `Unknown entity: ${entity}` });

  try {
    const data = { ...req.body };
    let record: any;

    // For non-admin requests: verify ownership before touching the DB.
    // Doing this upfront (instead of using created_by in the WHERE clause) avoids
    // the P2025 → retry dance for agent-created records that have no created_by.
    if (!isAdminKeyRequest(req)) {
      const userId = getUserId(req);
      if (userId) {
        const owned = await verifyRecordOwnership(model, String(req.params.id), userId);
        if (!owned) return res.status(403).json({ error: 'Forbidden' });
      }
    }

    try {
      record = await model.update({ where: { id: req.params.id }, data });
    } catch (prismaErr: any) {
      if (prismaErr.code === 'P2025') {
        return res.status(404).json({ error: 'Record not found' });
      // Prisma rejects fields added via raw ALTER TABLE that aren't in schema.prisma yet.
      // Fall back to raw SQL SET for those fields so settings always save.
      } else if (prismaErr.message?.includes('Unknown field') || prismaErr.message?.includes('Unknown argument')) {
        const tableMap: Record<string, string> = {
          BusinessProfile: 'business_profiles',
        };
        const table = tableMap[entity];
        if (!table) throw prismaErr;

        // Validate column names — prevent SQL injection via key names
        const safeEntries = Object.entries(data).filter(([k]) => SAFE_COLUMN.test(k));
        if (safeEntries.length === 0) throw new Error('No valid fields to update');

        const setClauses = safeEntries
          .map(([k], i) => `"${k}" = $${i + 2}`)
          .join(', ');
        const values = [req.params.id, ...safeEntries.map(([, v]) => v)];
        await prisma.$executeRawUnsafe(
          `UPDATE "${table}" SET ${setClauses} WHERE id = $1`,
          ...values
        );
        const base = await model.findUnique({ where: { id: req.params.id } });
        record = { ...base, ...data };
      } else {
        throw prismaErr;
      }
    }

    res.json(record);

    // Auto-cleanup competitors when radius/cities settings change — fire and forget
    if (entity === 'BusinessProfile' &&
        ('search_radius_km' in req.body || 'additional_cities' in req.body)) {
      cleanupCompetitorsByRadius(String(req.params.id)).catch(() => {});
    }
  } catch (err: any) {
    console.error(`PATCH /entities/${entity}/${req.params.id}:`, err.message);
    const isDev = process.env.NODE_ENV !== 'production';
    res.status(500).json({ error: isDev ? err.message : 'Internal server error' });
  }
});

// DELETE /api/entities/:entity/:id
router.delete('/:entity/:id', async (req: Request, res: Response) => {
  const model = getModel(String(req.params.entity));
  if (!model) return res.status(404).json({ error: `Unknown entity: ${req.params.entity}` });

  try {
    // Verify ownership upfront — same pattern as PATCH
    if (!isAdminKeyRequest(req)) {
      const userId = getUserId(req);
      if (userId) {
        const owned = await verifyRecordOwnership(model, String(req.params.id), userId);
        if (!owned) return res.status(403).json({ error: 'Forbidden' });
      }
    }
    try {
      await model.delete({ where: { id: req.params.id } });
    } catch (prismaErr: any) {
      if (prismaErr.code === 'P2025') {
        return res.status(404).json({ error: 'Record not found' });
      }
      throw prismaErr;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error(`DELETE /entities/${req.params.entity}/${req.params.id}:`, err.message);
    const isDev = process.env.NODE_ENV !== 'production';
    res.status(500).json({ error: isDev ? err.message : 'Internal server error' });
  }
});

export default router;
