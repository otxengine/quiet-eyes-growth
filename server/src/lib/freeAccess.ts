/**
 * The account-less Free plan of the English report product. A visitor gives an email address
 * (briefing_leads, a raw-SQL table — index.ts), gets a signed link, and that link's token stands in
 * for a login on a short list of setup routes. The identity is the confirmed email address itself:
 * the business is stored with created_by = <email>, so every existing ownership check works
 * unchanged, and the account that later signs up with that verified address claims the business
 * (lib/ownership.ts).
 */
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { sendEmail } from './email';
import { esc } from './html';

export const FREE_TOKEN_HEADER = 'x-briefing-token';
export const FREE_SETUP_LINK_DAYS = 1;
/** The Free plan is three reports (the first one counts), then it ends. */
export const FREE_REPORTS = 3;
// The "change competitors" link in a report email: long enough to last until the next monthly report.
const FREE_MANAGE_LINK_DAYS = 35;
const siteUrl = () => (process.env.FRONTEND_URL || '').replace(/\/$/, '');
/** The wording the visitor agreed to, stored with the lead. Change the text here and on the form together. */
export const FREE_CONSENT_TEXT = 'I agree to receive the Cortexi newsletter. It comes with the free reports, and one unsubscribe link stops both.';

// Same secret as the report links (lib/reportDelivery.ts), with its own message prefix, so a
// report or unsubscribe token never works as a login and the other way round.
const secret = () => process.env.REPORT_UNSUBSCRIBE_SECRET || '';
const sign = (leadId: string, exp: string) =>
  crypto.createHmac('sha256', secret()).update(`free\n${leadId}\n${exp}`).digest('base64url');

/** `<leadId>.<expiry>.<signature>`; null when the signing secret is not configured. */
export function freeToken(leadId: string, days: number, now = Date.now()): string | null {
  if (!secret() || !leadId) return null;
  const exp = String(Math.floor(now / 1000) + Math.round(days * 86400));
  return `${leadId}.${exp}.${sign(leadId, exp)}`;
}

/** The lead id of an unexpired, correctly signed token; otherwise null. */
export function readFreeToken(token: string, now = Date.now()): string | null {
  const [leadId, exp, sig, extra] = String(token || '').split('.');
  if (!secret() || !leadId || !sig || extra !== undefined || !/^\d{1,12}$/.test(exp || '') || Number(exp) * 1000 < now) return null;
  const given = Buffer.from(sig);
  const expected = Buffer.from(sign(leadId, exp));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected) ? leadId : null;
}

/** Clerk user ids never contain "@"; an account-less identity is always an email address. */
export const isFreeIdentity = (userId?: string | null): boolean => !!userId && userId.includes('@');

// Everything a token may reach, by method and path under /api. Anything else ignores the token
// and falls through to the normal sign-in check. req.path is not decoded and these are
// case-sensitive, so an encoded or re-cased path simply does not match (fails closed).
const ALLOWED: [string, RegExp][] = [
  ['GET', /^\/briefing\/(me|settings)$/],
  ['POST', /^\/briefing\/(search-business|start|finish)$/],
  ['POST', /^\/functions\/runCompetitorIdentification$/],
  ['GET', /^\/entities\/Competitor$/],
  ['POST', /^\/entities\/Competitor$/],
  ['PATCH', /^\/entities\/Competitor\/[^/]+$/],
  ['POST', /^\/competitors\/[^/]+\/enrich-urls$/],
  ['POST', /^\/onboarding\/confirm-competitors$/],
];

// ponytail: in-memory, so the cap is per server instance. Move to the DB if free sign-ups get abused.
const writeLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => String((req as any).freeIdentity),
  message: { error: 'Too many changes today. Try again tomorrow.' },
});

// The generic competitor routes (routes/entities.ts) accept any column. A Free-link caller may only
// name a competitor and fix its links: approving one goes through onboarding/confirm-competitors,
// which holds the plan's cap, and each added row costs a paid page lookup.
const FREE_COMPETITOR_FIELDS = new Set(['linked_business', 'name', 'website_url', 'instagram_url', 'facebook_url', 'manual_url_fields']);
export const FREE_COMPETITOR_ROWS_MAX = 25; // suggestions plus hand-added, per business
export const freeCompetitorWriteOk = (userId: string | null | undefined, data: Record<string, unknown>): boolean =>
  !isFreeIdentity(userId) || Object.keys(data).every(k => FREE_COMPETITOR_FIELDS.has(k));

/**
 * Mounted on /api ahead of requireApiAuth. With a valid token on an allowed route it sets
 * req.freeIdentity, which getUserId (middleware/auth.ts) returns as the caller.
 */
export async function freeAccess(req: Request, res: Response, next: NextFunction) {
  const token = req.headers[FREE_TOKEN_HEADER];
  if (typeof token !== 'string' || !token) return next();
  if (!ALLOWED.some(([method, path]) => method === req.method && path.test(req.path))) return next();
  const expired = () => res.status(401).json({ error: 'This link has expired. Ask for a new one.', link_expired: true });
  const leadId = readFreeToken(token);
  if (!leadId) return expired();
  try {
    const rows = await prisma.$queryRaw<{ email: string; unsubscribed_at: Date | null }[]>`
      SELECT email, unsubscribed_at FROM briefing_leads WHERE id = ${leadId}`;
    const lead = rows[0];
    if (!lead || lead.unsubscribed_at) return expired();
    (req as any).freeIdentity = lead.email;
    (req as any).freeLeadId = leadId;
    if (req.method === 'GET') return next();

    // The address counts as confirmed once its holder submits something, not when the link is
    // merely opened (mail scanners open links).
    await prisma.$executeRaw`UPDATE briefing_leads SET confirmed_at = now() WHERE id = ${leadId} AND confirmed_at IS NULL`;
    // Competitor discovery is the expensive step (two LLM calls and several paid lookups): at most
    // twice per address, ever — the second is for a first run that failed. Claimed in the database,
    // so it holds across server instances.
    if (/runCompetitorIdentification$/.test(req.path)) {
      const run = await prisma.$queryRaw<{ id: string }[]>`
        UPDATE briefing_leads SET discovery_runs = discovery_runs + 1 WHERE id = ${leadId} AND discovery_runs < 2 RETURNING id`;
      if (!run.length) return res.status(409).json({ error: 'Competitors were already suggested', already_discovered: true });
    }
    return writeLimiter(req, res, next);
  } catch (e: any) {
    console.error('[freeAccess] check failed:', e.message);
    return res.status(503).json({ error: 'Try again in a moment.' });
  }
}

export interface FreeReportInfo {
  number: number; // which of its free reports this one is, 1-based
  total: number;
  last: boolean;
  manageUrl: string | null; // "change competitors"; none on the last report
  upgradeUrl: string;
}

/**
 * What the report email of an account-less Free business adds: which of its three reports this is,
 * and its links. Null for every other business, including one that has moved to a paid plan.
 * Call it after the report is stored: the count includes it.
 * ponytail: only reports that were sent ('ready') count, so a business whose competitors post nothing
 * keeps being scanned monthly. Add an age limit if that shows up in the costs.
 */
export async function freeReportInfo(businessProfileId: string): Promise<FreeReportInfo | null> {
  const lead = await prisma.$queryRaw<{ id: string; unclaimed: boolean }[]>`
    SELECT l.id, (b.created_by = l.email) AS unclaimed FROM briefing_leads l JOIN business_profiles b ON b.id = l.business_profile_id
     WHERE b.id = ${businessProfileId} AND b.subscription_plan = 'brief_free'`;
  if (!lead[0]) return null;
  const number = await prisma.report.count({ where: { linked_business: businessProfileId, status: 'ready' } });
  const last = number >= FREE_REPORTS;
  const shown = { number: Math.min(number, FREE_REPORTS), total: FREE_REPORTS, last };
  // An account has taken the business over but is still on Free: its links go to the account.
  if (!lead[0].unclaimed) {
    return { ...shown, manageUrl: last ? null : `${siteUrl()}/en/briefing?tab=competitors`, upgradeUrl: `${siteUrl()}/en/briefing?tab=plan` };
  }
  // The upgrade link carries the token only so the sign-up form can start with this address
  // (src/App.jsx); the business follows the account by its verified email, not by the link.
  const token = freeToken(lead[0].id, FREE_MANAGE_LINK_DAYS);
  return {
    ...shown,
    manageUrl: !last && token && siteUrl() ? `${siteUrl()}/en/start?t=${token}` : null,
    upgradeUrl: `${siteUrl()}/sign-up?briefing=1${token ? `&t=${token}` : ''}`,
  };
}

/** Ends a Free business's reports: the scheduler skips it from now on (scheduler.ts getActiveProfiles). */
export const endFreeReports = (businessProfileId: string) =>
  prisma.$executeRaw`UPDATE business_profiles SET free_ended_at = COALESCE(free_ended_at, now()) WHERE id = ${businessProfileId}`;

/** The confirmation email with the setup link. False when it could not be built or sent. */
export async function sendFreeLink(leadId: string, email: string): Promise<boolean> {
  const base = siteUrl();
  const token = freeToken(leadId, FREE_SETUP_LINK_DAYS);
  if (!base || !token) return false;
  const url = `${base}/en/start?t=${token}`;
  const postal = process.env.COMPANY_POSTAL_ADDRESS;
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:0;background:#f4f4f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background:#ffffff;border-radius:8px;font-family:Arial,sans-serif;color:#0b0b0b;font-size:14px;text-align:left">
<tr><td style="padding:24px 28px;border-bottom:2px solid #0b0b0b">
<div style="font-size:13px;color:#52514e">Cortexi</div>
<div style="font-size:24px;font-weight:700;margin-top:2px">Confirm your email</div>
<div style="font-size:14px;color:#52514e">One step left before your first report</div></td></tr>
<tr><td style="padding:20px 28px">
<div style="background:#eef4fc;border-left:4px solid #2a78d6;padding:12px 14px;border-radius:4px;font-size:16px;font-weight:600;line-height:1.5">Tell us about your business and pick the competitors to watch. It takes about two minutes.</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 0"><tr><td style="background:#0b0b0b;border-radius:6px">
<a href="${esc(url)}" style="display:inline-block;padding:11px 20px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">Set up my report</a></td></tr></table>
<p style="font-size:13px;color:#52514e;line-height:1.6;margin:16px 0 0">You get three free monthly reports and the Cortexi newsletter. The link works for 24 hours.</p></td></tr>
<tr><td style="padding:14px 28px;border-top:1px solid #e1e0d9;font-size:11px;color:#898781;line-height:1.6">You are receiving this because this address was entered at cortexi.ai. If that was not you, ignore this email and nothing more will be sent.${postal ? `<br>${esc(postal)}` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  return sendEmail({ to: email, subject: 'Confirm your email to set up your Cortexi report', html });
}
