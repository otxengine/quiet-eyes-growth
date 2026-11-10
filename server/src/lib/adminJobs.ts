/**
 * "Run now" jobs from the admin panel (routes/admin.ts → admin_jobs table). The worker drains the
 * queue every minute (scheduler.ts), because report PDFs render only there (Chromium, ROLE=worker).
 * Each job is what the matching .claude/*.sh script ran in a one-off ECS task.
 */
import { prisma } from '../db';
import { collectReviews } from '../routes/functions/collectReviews';
import { runCollectCompetitorReviews } from '../routes/functions/collectCompetitorReviews';
import { collectCompetitorSocialPosts } from '../routes/functions/collectCompetitorSocialPosts';
import { generateReport } from '../routes/functions/generateReport';

type Handler = (req: any, res: any) => Promise<unknown>;

/** Runs an Express-style function handler; throws its error when it answers 4xx/5xx. */
export function callHandler(fn: Handler, body: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    let code = 200;
    const res = {
      status(c: number) { code = c; return res; },
      json(out: any) {
        if (code >= 400) reject(new Error(out?.error || out?.reason || `HTTP ${code}`));
        else resolve(out);
        return res;
      },
    };
    fn({ body, query: {}, params: {}, headers: {} }, res).catch(reject);
  });
}

const report = (type: string) => async (bp: string) => {
  const out = await callHandler(generateReport, { businessProfileId: bp, type, force: true });
  const r = out.report; // the full report data is in the reports table; keep the job row small
  return r ? { status: r.status, period_start: r.period_start, pdf: !!r.pdf_url, cached: !!out.cached } : out;
};

export const JOB_KINDS: Record<string, (businessId: string) => Promise<unknown>> = {
  // Own reviews (12h guard bypassed), then competitors awaited here instead of the fire-and-forget trigger.
  reviews: async bp => ({
    own: await callHandler(collectReviews, { businessProfileId: bp, force: true, skipCompetitorTrigger: true }),
    competitors: await runCollectCompetitorReviews(bp),
  }),
  competitor_posts: bp => callHandler(collectCompetitorSocialPosts, { businessProfileId: bp, force: true }),
  report_daily: report('daily'),
  report_weekly: report('weekly'),
  report_monthly: report('monthly'),
};

const MAX_RESULT_CHARS = 8000;
const toJson = (v: unknown) => {
  const s = JSON.stringify(v ?? null);
  return s.length > MAX_RESULT_CHARS ? JSON.stringify({ truncated: s.slice(0, MAX_RESULT_CHARS) }) : s;
};

let draining = false;

/** Runs queued jobs one by one until none are left. A tick that finds a drain in progress returns. */
// ponytail: one job at a time per worker; FOR UPDATE SKIP LOCKED keeps it correct if a second worker task is added.
export async function runAdminJobs(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    // A deploy or crash mid-job leaves it 'running' forever; nothing runs longer than this.
    await prisma.$executeRawUnsafe(
      `UPDATE admin_jobs SET status = 'failed', finished_at = NOW(), result = '{"error":"interrupted (worker restarted)"}'
       WHERE status = 'running' AND started_at < NOW() - interval '2 hours'`,
    );
    for (;;) {
      const [job] = await prisma.$queryRawUnsafe<{ id: string; kind: string; business_id: string }[]>(
        `UPDATE admin_jobs SET status = 'running', started_at = NOW()
         WHERE id = (SELECT id FROM admin_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING id, kind, business_id`,
      );
      if (!job) return;
      let status = 'done';
      let result: unknown;
      try {
        const run = JOB_KINDS[job.kind];
        if (!run) throw new Error(`unknown job kind: ${job.kind}`);
        result = await run(job.business_id);
      } catch (e: any) {
        status = 'failed';
        result = { error: e?.message || String(e) };
      }
      await prisma.$executeRawUnsafe(
        `UPDATE admin_jobs SET status = $1, finished_at = NOW(), result = $2::jsonb WHERE id = $3`,
        status, toJson(result), job.id,
      );
    }
  } finally {
    draining = false;
  }
}
