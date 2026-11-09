import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { invokeLLM, startCostTracking, popCost } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { reportPeriod, REPORT_TYPES, ReportType } from '../../lib/reportPeriod';
import { buildReportData, isEmptyReport } from '../../lib/reportData';
import { sendReportEmail } from '../../lib/reportEmail';
import { renderReportPdf, reportPdfFilename, storeReportPdf } from '../../lib/reportPdf';

// ponytail: inline like generateBattlecard.ts — all paid plans get all three reports.
const REPORT_PLANS = new Set(['starter', 'growth', 'pro', 'enterprise']);
// Generous ceilings: Hebrew is token-heavy, and the first real weekly report (10
// competitors, 2026-11-08) was cut off at 2000 — it lost reviews_summary and actions.
const MAX_TOKENS: Record<ReportType, number> = { daily: 2500, weekly: 4000, monthly: 6000 };
// A stored row is returned as-is for this long, force or not — each regeneration is a
// Sonnet call plus the full SQL build, and `force` is reachable by any business owner.
const REGEN_COOLDOWN_MS = 10 * 60 * 1000;
const LABEL: Record<ReportType, string> = { daily: 'יומי', weekly: 'שבועי', monthly: 'חודשי' };

const ilDate = (d: Date) => new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem' }).format(d);

function buildPrompt(type: ReportType, start: Date, end: Date, data: unknown): string {
  // ids/urls/media are for the UI and email, not the narrative — drop them, and keep post/ad
  // text at the 200 chars the prompt always had (the stored report keeps up to 600 for display).
  const DROP = new Set(['id', 'url', 'link', 'media_url', 'video_url']);
  const json = JSON.stringify(data, (k, v) =>
    DROP.has(k) ? undefined : (k === 'caption' || k === 'body') && typeof v === 'string' ? v.slice(0, 200) : v);
  return `You are a competitive-intelligence analyst for a small Israeli business. Write its ${type} competitor report (דוח ${LABEL[type]}) for ${ilDate(start)}–${ilDate(new Date(end.getTime() - 1))} from the data below.

Rules:
- Use ONLY facts present in the data. Cite competitor names and numbers. Never invent posts, ads, offers or reviews.
- In per_competitor, include only competitors with activity in this period.
- "limits" lists data we don't collect — never present those as "no activity".
- ads.new = ads launched in this period; ads.active_count = ads still running at its end (ads.active = running ones launched earlier). Never call a running ad new.
- If the data for a section is empty, say so in one short phrase instead of guessing.
- Review sentiment comes from the rating: avg_rating ≤ 2 is negative, ≥ 4 is positive. Never call a low-rated review positive.

DATA (JSON):
${json}

Return ONLY valid JSON, with the keys in this order (per_competitor last). ALL string values must be in Hebrew:
{
  "headline": "one sentence — the most important thing competitors did in this period",
  "highlights": ["3-5 specific bullets with competitor names and numbers"],${type !== 'daily' ? `
  "reviews_summary": "2-3 sentences comparing our reviews with competitors' (volume, rating, main themes)",` : ''}${type === 'monthly' ? `
  "own_summary": "2-3 sentences on our own activity this month and how it compares with competitors",` : ''}
  "recommended_actions": ["2-3 concrete actions for us, each under 15 words"],
  "per_competitor": [{ "name": "competitor name", "summary": "1-2 sentences: what they posted, advertised or offered" }]
}`;
}

/**
 * A summary counts only if every section this report type asks for is there — a reply
 * cut off by maxTokens still parses (llm.ts repairs truncated JSON) but drops the tail.
 */
export function isCompleteSummary(type: ReportType, s: any): boolean {
  return !!s && typeof s === 'object' && !!s.headline && Array.isArray(s.highlights)
    && Array.isArray(s.recommended_actions) && s.recommended_actions.length > 0
    && (type === 'daily' || !!s.reviews_summary)
    && (type !== 'monthly' || !!s.own_summary);
}

/**
 * POST /api/functions/generateReport { businessProfileId, type: 'daily'|'weekly'|'monthly', force? }
 * Builds the report for the last completed Israel-time period and stores it in `reports`
 * (one row per business+type+period). Re-runs return the stored row unless force=true or
 * the stored one is 'partial' — never within REGEN_COOLDOWN_MS of the last build.
 * The data comes from SQL; the LLM only narrates it, so an LLM failure still saves the
 * data with status 'partial' (and never overwrites an existing 'ready' narrative).
 * `scheduled` is set by the cron (scheduler.ts) so unpaid plans skip quietly instead of 403.
 */
export async function generateReport(req: Request, res: Response) {
  const { businessProfileId, type, force, scheduled } = req.body ?? {};
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (!REPORT_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${REPORT_TYPES.join(', ')}` });
  }

  const startTime = new Date().toISOString();
  try {
    const bp = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!bp) return res.status(404).json({ error: 'Business profile not found' });
    if (!REPORT_PLANS.has(bp.subscription_plan || 'free')) {
      if (scheduled) return res.json({ skipped: true, reason: 'plan' });
      return res.status(403).json({ error: 'Reports require a paid plan', plan_limit: true });
    }

    const { start, end } = reportPeriod(type);
    const key = { linked_business: businessProfileId, report_type: type, period_start: start };
    const existing = await prisma.report.findUnique({ where: { linked_business_report_type_period_start: key } });
    if (existing) {
      const fresh = Date.now() - existing.created_date.getTime() < REGEN_COOLDOWN_MS;
      if (fresh || (!force && existing.status !== 'partial')) return res.json({ report: existing, cached: true });
    }

    // Round-trip through JSON so Dates become strings — what we store is exactly what we return.
    const data = JSON.parse(JSON.stringify(await buildReportData(businessProfileId, type, start, end)));

    let summary: Record<string, unknown> | null = null;
    let status = 'empty';
    let cost: number | null = null;
    if (!isEmptyReport(data)) {
      // Unique per run — concurrent agents for the same business share the bare bpId key.
      const trackId = `${businessProfileId}:report:${type}:${start.toISOString()}`;
      startCostTracking(trackId);
      const prompt = buildPrompt(type, start, end, data);
      // ponytail: one retry covers a transient OpenRouter error; a persistent one leaves 'partial',
      // which the next non-forced call (after the cooldown) regenerates.
      for (let attempt = 1; attempt <= 2 && !summary; attempt++) {
        try {
          const result = await invokeLLM({
            prompt,
            model: 'sonnet',
            maxTokens: MAX_TOKENS[type],
            response_json_schema: { type: 'object' },
            skipCache: true,
            profile: bp as any,
            costTrackingId: trackId,
          });
          summary = isCompleteSummary(type, result) ? result : null;
          if (!summary) console.warn(`[generateReport] attempt ${attempt}: summary incomplete, keys=${result && Object.keys(result)}`);
        } catch (llmErr: any) {
          console.warn(`[generateReport] LLM attempt ${attempt} failed:`, llmErr.message);
        }
      }
      cost = popCost(trackId);
      status = summary ? 'ready' : 'partial';
    }

    // A forced rebuild whose LLM failed must not wipe a good stored narrative.
    if (status === 'partial' && existing?.status === 'ready') {
      await writeAutomationLog('generateReport', businessProfileId, startTime, 0, 'success',
        `${type}: regenerate llm_failed, kept stored report`, cost ?? undefined);
      return res.json({ report: existing, cached: true, regenerate_failed: true });
    }

    const fields = {
      period_end: end,
      status,
      data,
      summary: summary ? (summary as Prisma.InputJsonValue) : Prisma.DbNull,
      cost_usd: cost,
    };
    const report = await prisma.report.upsert({
      where: { linked_business_report_type_period_start: key },
      create: { ...key, ...fields },
      update: { ...fields, created_date: new Date() },
    });

    await writeAutomationLog('generateReport', businessProfileId, startTime, 1, 'success',
      status === 'partial' ? `${type}: llm_failed` : undefined, cost ?? undefined);

    // Every complete report goes to the internal distribution list as a short email with the PDF
    // attached. 'empty' has nothing to read and 'partial' is regenerated later, so only 'ready'
    // sends. Nothing here may fail the report: no PDF still sends the email, no email still saves it.
    let stored = report;
    if (status === 'ready') {
      let pdf: Buffer | null = null;
      try {
        pdf = await renderReportPdf(report, bp.name);
        const pdfUrl = await storeReportPdf(businessProfileId, report, pdf);
        if (pdfUrl) stored = await prisma.report.update({ where: { id: report.id }, data: { pdf_url: pdfUrl } });
      } catch (e: any) {
        console.error(`[generateReport] ${type} PDF failed (${pdf ? 'upload' : 'render'}):`, e.message);
      }
      await sendReportEmail(report, bp.name, pdf && { filename: reportPdfFilename(report), content: pdf }).catch((e: any) =>
        console.warn('[generateReport] report email failed:', e.message));
    }
    return res.json({ report: stored });
  } catch (err: any) {
    console.error('[generateReport] error:', err.message);
    await writeAutomationLog('generateReport', businessProfileId, startTime, 0, 'failed', `${type}: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}
