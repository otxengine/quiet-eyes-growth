/**
 * Admin panel API (admin.html). Mounted at /api/admin behind requireAdmin (index.ts), so every
 * handler here runs for an allowlisted, two-factor admin. Every change writes admin_audit_log.
 * Replaces the .claude/*.sh prod scripts: reports-now (list, run, delete), grant-pro,
 * collect-reviews-now (run), report-costs (test-posts).
 */
import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { PLAN_LIMITS } from '../lib/planLimits';
import { JOB_KINDS } from '../lib/adminJobs';

const router = Router();
type Db = Pick<typeof prisma, '$executeRawUnsafe'>;

// Express 4 drops a rejected promise; send it to the error handler instead.
const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

const q = <T = any>(sql: string, ...params: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...params);

function audit(db: Db, req: Request, action: string, target: string, detail: unknown) {
  return db.$executeRawUnsafe(
    `INSERT INTO admin_audit_log (admin_user_id, action, target, detail) VALUES ($1, $2, $3, $4::jsonb)`,
    (req as any).adminUserId, action, target, JSON.stringify(detail ?? null),
  );
}

router.get('/me', (req, res) => { res.json({ userId: (req as any).adminUserId }); });

// ── Customers: every business, plus orgs that never finished onboarding ──────────────────────
router.get('/customers', h(async (_req, res) => {
  const [businesses, pendingOrgs] = await Promise.all([
    q(`SELECT bp.id, bp.name, bp.category, bp.city, bp.created_date AS created,
              coalesce(bp.owner_email, c.email) AS owner_email, bp.organization_id AS org_id,
              coalesce(bp.subscription_plan, 'free_trial') AS plan, o.subscription_status AS org_status,
              o.paddle_subscription_id IS NOT NULL AS paddle, coalesce(bp.is_active, true) AS is_active,
              (SELECT count(*)::int FROM competitors k WHERE k.linked_business = bp.id
                 AND k.tracking_status = 'approved' AND k.not_relevant IS NOT TRUE) AS competitors,
              (SELECT max(a.created_date) FROM automation_logs a WHERE a.linked_business = bp.id
                 AND a.automation_name = 'collectReviews' AND a.status = 'success'
                 AND coalesce(a.error_message, '') <> 'ran_recently') AS last_reviews_at,
              -- reports.created_date has no time zone (UTC by convention); json needs the offset or browsers read local time.
              (SELECT json_object_agg(x.report_type, x.created_date AT TIME ZONE 'UTC') FROM (
                 SELECT DISTINCT ON (report_type) report_type, created_date FROM reports r
                  WHERE r.linked_business = bp.id ORDER BY report_type, created_date DESC) x) AS last_reports
         FROM business_profiles bp
         LEFT JOIN organizations o ON o.id = bp.organization_id
         LEFT JOIN clerk_user_cache c ON c.user_id = bp.created_by
        ORDER BY bp.created_date DESC`),
    q(`SELECT o.id, o.name, o.created_at AS created, c.email AS owner_email, o.plan_id AS plan,
              o.subscription_status AS org_status, o.paddle_subscription_id IS NOT NULL AS paddle
         FROM organizations o
         LEFT JOIN clerk_user_cache c ON c.user_id = o.owner_user_id
        WHERE NOT EXISTS (SELECT 1 FROM business_profiles bp WHERE bp.organization_id = o.id)
        ORDER BY o.created_at DESC`),
  ]);
  res.json({ businesses, pendingOrgs });
}));

router.get('/customers/:bpId', h(async (req, res) => {
  const id = String(req.params.bpId);
  const [business] = await q(
    `SELECT bp.id, bp.name, bp.category, bp.city, bp.created_date AS created, bp.created_by AS owner_user_id,
            coalesce(bp.owner_email, c.email) AS owner_email, bp.organization_id AS org_id,
            coalesce(bp.subscription_plan, 'free_trial') AS plan, coalesce(bp.is_active, true) AS is_active,
            bp.onboarding_completed, bp.google_place_id, bp.locale, bp.timezone
       FROM business_profiles bp LEFT JOIN clerk_user_cache c ON c.user_id = bp.created_by
      WHERE bp.id = $1`, id);
  if (!business) return res.status(404).json({ error: 'Business not found' });
  const orgId = business.org_id || '';

  const [[org], members, [counts], reports, logs, jobs, auditRows] = await Promise.all([
    q(`SELECT id, name, plan_id AS plan, subscription_status AS status, paddle_subscription_id,
              current_period_end, branch_count, created_at FROM organizations WHERE id = $1`, orgId),
    q(`SELECT coalesce(om.email, c.email) AS email, om.role, om.status
         FROM organization_members om LEFT JOIN clerk_user_cache c ON c.user_id = om.user_id
        WHERE om.org_id = $1 ORDER BY om.invited_at`, orgId),
    q(`SELECT (SELECT count(*)::int FROM reviews WHERE linked_business = $1 AND linked_competitor IS NULL) AS own_reviews,
              (SELECT count(*)::int FROM reviews WHERE linked_business = $1 AND linked_competitor IS NOT NULL) AS competitor_reviews,
              (SELECT count(*)::int FROM competitors WHERE linked_business = $1
                 AND tracking_status = 'approved' AND not_relevant IS NOT TRUE) AS competitors_approved,
              (SELECT count(*)::int FROM competitors WHERE linked_business = $1) AS competitors_total,
              (SELECT count(*)::int FROM competitor_posts WHERE linked_business = $1) AS competitor_posts`, id),
    q(`SELECT id, report_type, period_start, status, pdf_url IS NOT NULL AS pdf, cost_usd, created_date
         FROM reports WHERE linked_business = $1 ORDER BY created_date DESC LIMIT 15`, id),
    q(`SELECT automation_name, created_date, status, items_processed, error_message, cost_usd
         FROM automation_logs WHERE linked_business = $1 ORDER BY created_date DESC LIMIT 30`, id),
    q(`SELECT * FROM admin_jobs WHERE business_id = $1 ORDER BY created_at DESC LIMIT 20`, id),
    q(`SELECT * FROM admin_audit_log WHERE target IN ($1, $2) ORDER BY created_at DESC LIMIT 20`, id, orgId),
  ]);
  res.json({ business, org: org || null, members, counts, reports, logs, jobs, audit: auditRows });
}));

// ── Plan: set an org's plan without Paddle (what grant-pro.sh did). An org with a Paddle
// subscription is refused: Paddle's webhook owns its plan and would overwrite this anyway.
router.post('/orgs/:orgId/plan', h(async (req, res) => {
  const plan = req.body?.plan;
  if (typeof plan !== 'string' || !Object.keys(PLAN_LIMITS).includes(plan)) { // not `in`: 'constructor' is in every object
    return res.status(400).json({ error: `plan must be one of: ${Object.keys(PLAN_LIMITS).join(', ')}` });
  }
  const orgId = String(req.params.orgId);
  const status = plan === 'free_trial' ? 'none' : 'active';
  const out = await prisma.$transaction(async tx => {
    const [org] = await tx.$queryRawUnsafe<any[]>(
      `SELECT plan_id, paddle_subscription_id FROM organizations WHERE id = $1 FOR UPDATE`, orgId);
    if (!org) return { code: 404, error: 'Organization not found' };
    if (org.paddle_subscription_id) return { code: 409, error: 'This organization pays through Paddle; change its plan there' };
    await tx.$executeRawUnsafe(`UPDATE organizations SET plan_id = $1, subscription_status = $2 WHERE id = $3`, plan, status, orgId);
    const businesses = await tx.$executeRawUnsafe(`UPDATE business_profiles SET subscription_plan = $1 WHERE organization_id = $2`, plan, orgId);
    await audit(tx, req, 'plan.set', orgId, { from: org.plan_id, to: plan, businesses });
    return { code: 200, plan, businesses };
  });
  const { code, ...body } = out;
  res.status(code).json(body);
}));

// ── Run now: queued for the worker (lib/adminJobs.ts), which picks it up within a minute ──────
router.post('/customers/:bpId/jobs', h(async (req, res) => {
  const kind = req.body?.kind;
  if (typeof kind !== 'string' || !Object.keys(JOB_KINDS).includes(kind)) {
    return res.status(400).json({ error: `kind must be one of: ${Object.keys(JOB_KINDS).join(', ')}` });
  }
  const id = String(req.params.bpId);
  const [bp] = await q(`SELECT 1 FROM business_profiles WHERE id = $1`, id);
  if (!bp) return res.status(404).json({ error: 'Business not found' });
  const job = await prisma.$transaction(async tx => {
    const [row] = await tx.$queryRawUnsafe<any[]>(
      `INSERT INTO admin_jobs (requested_by, kind, business_id) VALUES ($1, $2, $3) RETURNING *`,
      (req as any).adminUserId, kind, id);
    await audit(tx, req, 'job.queue', id, { kind, job_id: row.id });
    return row;
  });
  res.status(201).json(job);
}));

// ── Delete a business: every row keyed to it or to its competitors, in one transaction.
// Leaves the Clerk login, the organization and S3 files (same as reports-now.sh delete).
// Undo = RDS point-in-time restore. Tables are found from the schema, so new ones are covered.
const DISCOVER_SQL = `
  SELECT c.table_name AS tbl, c.column_name AS col,
         CASE WHEN c.column_name IN ('competitor_id', 'linked_competitor') THEN 'comp' ELSE 'biz' END AS kind
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
   WHERE c.table_schema = current_schema()
     AND c.column_name IN ('linked_business', 'business_id', 'business_profile_id', 'competitor_id', 'linked_competitor')
     AND c.data_type IN ('text', 'character varying')
     AND c.table_name NOT IN ('business_profiles', 'admin_audit_log')`;

router.get('/customers/:bpId/delete-preview', h(async (req, res) => {
  const id = String(req.params.bpId);
  const [bp] = await q(`SELECT id, name FROM business_profiles WHERE id = $1`, id);
  if (!bp) return res.status(404).json({ error: 'Business not found' });
  const comp = (await q<{ id: string }>(`SELECT id FROM competitors WHERE linked_business = $1`, id)).map(r => r.id);
  const tables = await q<{ tbl: string; col: string; kind: string }>(DISCOVER_SQL);
  const counts = await Promise.all(tables.map(async t => {
    // Identifiers come from information_schema, not the request.
    const [{ n }] = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${t.tbl}" WHERE "${t.col}" = ${t.kind === 'comp' ? 'ANY($1)' : '$1'}`,
      t.kind === 'comp' ? comp : id);
    return { table: t.tbl, column: t.col, rows: n };
  }));
  res.json({ business: bp, tables: counts.filter(c => c.rows > 0).sort((a, b) => b.rows - a.rows) });
}));

// The loop is reports-now.sh's: a table blocked by a foreign key is retried after the others,
// until a pass makes no progress (then everything rolls back).
const DELETE_SQL = `DO $$
DECLARE
  bp text := current_setting('qe.bp');
  comp text[];
  r record; n bigint; total bigint := 0;
  todo text[] := '{}'; left_over text[]; item text; p text[];
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO comp FROM competitors WHERE linked_business = bp;
  FOR r IN ${DISCOVER_SQL} ORDER BY 1, 2 LOOP
    todo := todo || (r.tbl || '|' || r.col || '|' || r.kind);
  END LOOP;
  LOOP
    left_over := '{}';
    FOREACH item IN ARRAY todo LOOP
      p := string_to_array(item, '|');
      BEGIN
        IF p[3] = 'biz' THEN EXECUTE format('DELETE FROM %I WHERE %I = $1', p[1], p[2]) USING bp;
        ELSE EXECUTE format('DELETE FROM %I WHERE %I = ANY($1)', p[1], p[2]) USING comp; END IF;
        GET DIAGNOSTICS n = ROW_COUNT;
        total := total + n;
      EXCEPTION WHEN foreign_key_violation THEN left_over := left_over || item;
      END;
    END LOOP;
    EXIT WHEN cardinality(left_over) = 0;
    IF cardinality(left_over) = cardinality(todo) THEN
      RAISE EXCEPTION 'could not clear % — rolled back, nothing deleted', array_to_string(left_over, ', ');
    END IF;
    todo := left_over;
  END LOOP;
  DELETE FROM business_profiles WHERE id = bp;
  PERFORM set_config('qe.deleted', total::text, true);
END $$`;

router.post('/customers/:bpId/delete', h(async (req, res) => {
  const id = String(req.params.bpId);
  const [bp] = await q(`SELECT id, name, organization_id FROM business_profiles WHERE id = $1`, id);
  if (!bp) return res.status(404).json({ error: 'Business not found' });
  if (req.body?.confirmName !== bp.name) return res.status(400).json({ error: 'confirmName must match the business name exactly' });
  const rows = await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe(`SELECT set_config('qe.bp', $1, true)`, id);
    await tx.$executeRawUnsafe(DELETE_SQL);
    const [{ n }] = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT current_setting('qe.deleted')::int AS n`);
    await audit(tx, req, 'business.delete', id, { name: bp.name, org_id: bp.organization_id, rows: n });
    return n;
  }, { timeout: 120_000 });
  res.json({ ok: true, rows });
}));

router.get('/audit', h(async (_req, res) => {
  res.json(await q(`SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT 200`));
}));

export default router;
