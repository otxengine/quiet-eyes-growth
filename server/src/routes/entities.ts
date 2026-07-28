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
  CompetitorPost: 'competitorPost',
  CompetitorAdHistory: 'competitorAdHistory',
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

// Review.created_date is the DB insert time (scrape/import time), not the actual
// review date — that's created_at. Always sort reviews by created_at, newest first,
// with legacy null values (pre-dating the column) pushed to the end.
const REVIEW_ORDER_BY = { created_at: { sort: 'desc' as const, nulls: 'last' as const } };

// Entities that don't have created_date need their own default sort field.
const ENTITY_DEFAULT_ORDER: Record<string, any> = {
  CompetitorPost: { first_seen_at: 'desc' },
  CompetitorAdHistory: { first_seen_at: 'desc' },
};

// Prisma's Linux query-engine binary (Render) has stricter OID matching:
// columns added via startup SQL as TIMESTAMPTZ (OID 1184) cause P2023 when
// Prisma expects TIMESTAMP(3) (OID 1114) for DateTime fields, and JSONB (OID 3802)
// causes P2023 for String fields. Bypass by using $queryRawUnsafe — returns plain
// JS objects with no OID validation.
const RAW_SQL_TABLES: Record<string, string> = {
  CompetitorPost: 'competitor_posts',
  CompetitorAdHistory: 'competitor_ad_history',
};

async function rawEntityQuery(
  table: string,
  where: Record<string, any>,
  sort: string | undefined,
  limit: number,
): Promise<any[]> {
  const params: any[] = [];
  const conditions: string[] = [];

  for (const [col, val] of Object.entries(where)) {
    if (!SAFE_COLUMN.test(col)) continue;
    const inArr = val && typeof val === 'object' && Array.isArray((val as any).in)
      ? (val as any).in as any[]
      : null;
    if (inArr !== null) {
      if (inArr.length === 0) return [];
      const ph = inArr.map((_: any, i: number) => `$${params.length + i + 1}`).join(', ');
      params.push(...inArr);
      conditions.push(`"${col}" IN (${ph})`);
    } else if (val !== null && val !== undefined && typeof val !== 'object') {
      params.push(val);
      conditions.push(`"${col}" = $${params.length}`);
    }
  }

  let orderByClause = `"first_seen_at" DESC NULLS LAST`;
  if (sort) {
    const desc = sort.startsWith('-');
    const f = desc ? sort.slice(1) : sort;
    if (SAFE_COLUMN.test(f)) orderByClause = `"${f}" ${desc ? 'DESC' : 'ASC'} NULLS LAST`;
  }

  const whereStr = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(limit, 1000));
  const sql = `SELECT * FROM "${table}" ${whereStr} ORDER BY ${orderByClause} LIMIT $${params.length}`;
  return (prisma as any).$queryRawUnsafe(sql, ...params);
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
      const adminWhere = buildWhere(filter);
      const rawTable = RAW_SQL_TABLES[String(req.params.entity)];
      const records = rawTable
        ? await rawEntityQuery(rawTable, adminWhere, sort, limit)
        : await model.findMany({
            where: adminWhere,
            orderBy: req.params.entity === 'Review' ? REVIEW_ORDER_BY : (sort ? buildOrderBy(sort) : (ENTITY_DEFAULT_ORDER[String(req.params.entity)] ?? buildOrderBy(sort))),
            take: Math.min(limit, 1000),
          });
      return res.json(records);
    }

    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const where = buildWhere(filter);

    // Review rows scraped from competitors (KAN-121) share linked_business with the
    // owner's own reviews, tagged via linked_competitor. Default callers to their own
    // reviews only — pass linked_competitor explicitly to fetch a competitor's rows.
    if (req.params.entity === 'Review' && !('linked_competitor' in filter)) {
      where.linked_competitor = null;
    }

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

    const rawTable = RAW_SQL_TABLES[String(req.params.entity)];
    if (rawTable) {
      const records = await rawEntityQuery(rawTable, where, sort, limit);
      return res.json(records);
    }

    const orderBy = req.params.entity === 'Review' ? REVIEW_ORDER_BY : (sort ? buildOrderBy(sort) : (ENTITY_DEFAULT_ORDER[String(req.params.entity)] ?? buildOrderBy(sort)));

    const records = await model.findMany({
      where,
      orderBy,
      take: Math.min(limit, 1000),
    });

    res.json(records);
  } catch (err: any) {
    console.error(`GET /entities/${req.params.entity}:`, err.message);
    const isDev = process.env.NODE_ENV !== 'production';
    // Include code + hint in production for diagnosing Prisma/PG errors — no sensitive data exposed
    res.status(500).json({
      error: isDev ? err.message : 'Internal server error',
      code: err.code ?? err.meta?.code ?? null,
      hint: (err.message ?? '').split('\n').find((l: string) => l.trim())?.substring(0, 200) ?? null,
    });
  }
});

// ponytail: inline from src/lib/planConfig.js — update both if plan limits change
const PLAN_COMPETITOR_LIMITS: Record<string, number> = {
  free_trial: 3, free: 3, starter: 5, growth: 10, pro: Infinity, enterprise: Infinity,
};

// POST /api/entities/:entity — create
router.post('/:entity', async (req: Request, res: Response) => {
  const model = getModel(String(req.params.entity));
  if (!model) return res.status(404).json({ error: `Unknown entity: ${req.params.entity}` });

  try {
    const userId = getUserId(req);
    const data = { ...req.body };
    if (userId && !data.created_by) data.created_by = userId;

    // competitors_max plan guard for manual add
    if (req.params.entity === 'Competitor' && data.linked_business) {
      const biz = await prisma.businessProfile.findUnique({
        where: { id: data.linked_business }, select: { plan_id: true },
      });
      const planId = biz?.plan_id || 'free_trial';
      const maxCompetitors = PLAN_COMPETITOR_LIMITS[planId] ?? 3;
      if (maxCompetitors !== Infinity) {
        const activeCount = await (prisma as any).competitor.count({
          where: { linked_business: data.linked_business, not_relevant: { not: true } },
        });
        if (activeCount >= maxCompetitors) {
          return res.status(403).json({
            error: `הגעת למגבלת ${maxCompetitors} מתחרים בתוכנית ${planId}. שדרג את התוכנית להוספת מתחרים נוספים.`,
            plan_limit: true, competitors_max: maxCompetitors, competitors_current: activeCount,
          });
        }
      }
    }

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
