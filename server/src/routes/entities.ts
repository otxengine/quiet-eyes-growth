import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { getUserId } from '../middleware/auth';

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

    const userId = getUserId(req);
    const where = buildWhere(filter);

    // BUG 3: Enforce tenant isolation — BusinessProfile must always be scoped to the
    // authenticated user. If the request doesn't already pass created_by, inject it.
    // This prevents seed/test data from leaking into other tenants' sessions.
    if (req.params.entity === 'BusinessProfile' && userId) {
      where.created_by = userId;
    }

    const records = await model.findMany({
      where,
      orderBy: buildOrderBy(sort),
      take: Math.min(limit, 1000),
    });

    res.json(records);
  } catch (err: any) {
    console.error(`GET /entities/${req.params.entity}:`, err.message);
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/entities/:entity/:id — update
router.patch('/:entity/:id', async (req: Request, res: Response) => {
  const model = getModel(String(req.params.entity));
  if (!model) return res.status(404).json({ error: `Unknown entity: ${req.params.entity}` });

  try {
    const record = await model.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(record);
  } catch (err: any) {
    console.error(`PATCH /entities/${req.params.entity}/${req.params.id}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/entities/:entity/:id
router.delete('/:entity/:id', async (req: Request, res: Response) => {
  const model = getModel(String(req.params.entity));
  if (!model) return res.status(404).json({ error: `Unknown entity: ${req.params.entity}` });

  try {
    await model.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
