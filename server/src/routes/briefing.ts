/**
 * The English report-only product ("briefing"): sign-up and account settings.
 *   GET  /api/briefing/me                                        the signed-in user's report-only business, or null
 *   POST /api/briefing/search-business { query }                 Google Places candidates for the user's own business
 *   POST /api/briefing/start { placeId, timezone }               creates the business (plan brief_free, English, US search)
 *   POST /api/briefing/finish { businessProfileId }              ends onboarding and starts the first collection
 *   GET  /api/briefing/settings?businessProfileId=               recipients, timezone, plan
 *   PUT  /api/briefing/settings { businessProfileId, recipients?, timezone? }
 * Competitor discovery / selection and billing reuse the existing endpoints
 * (functions/runCompetitorIdentification, onboarding/confirm-competitors, onboarding/select-plan, billing).
 */
import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { FREE_CONSENT_TEXT, sendFreeLink, isFreeIdentity } from '../lib/freeAccess';
import { getUserId } from '../middleware/auth';
import { requireOwnsBusinessFields } from '../middleware/businessAccess';
import { strictLimiter, freeRequestLimiter } from '../middleware/rateLimits';
import { getUserEmail } from '../lib/ownership';
import { sendEmail } from '../lib/email';
import { esc } from '../lib/html';
import { localeOf } from '../lib/locale';
import { isBriefingPlan, planLimits } from '../lib/planLimits';
import { customerRecipients, parseRecipients } from '../lib/reportDelivery';
import { extractSocialLinksFromWebsite } from '../lib/extractSocialLinksFromWebsite';
import { collectCompetitorSocialProfileAndPosts } from './functions/collectCompetitorSocialProfileAndPosts';
import { collectCompetitorSocialStories } from './functions/collectCompetitorSocialStories';
import { detectCompetitorAds } from './functions/detectCompetitorAds';
import { collectReviews } from './functions/collectReviews';

const router = Router();
const PLACES = 'https://places.googleapis.com/v1/places';
const MAX_RECIPIENTS = 5;
// ponytail: a fixed ceiling on new account-less Free addresses per day. Raise it when real demand gets near it.
const FREE_LEADS_PER_DAY = 300;
// The business's own pages, for the "you vs. your competitors" section. Empty clears the link.
const OWN_PAGES: Record<string, { field: 'instagram_url' | 'facebook_url'; host: RegExp }> = {
  instagramUrl: { field: 'instagram_url', host: /(^|\.)instagram\.com$/i },
  facebookUrl: { field: 'facebook_url', host: /(^|\.)facebook\.com$/i },
};
const placesKey = () => process.env.GOOGLE_PLACES_API_KEY || '';

// The product is not sold in Israel (the Hebrew app is). CloudFront adds the header when the
// distribution forwards it; without it nothing is refused here and the CDN redirect is the gate.
// Off unless BRIEFING_BLOCK_ISRAEL=true: the English site is tested from Israel for now. Turn it on
// together with the CDN's country routing (GEO_ROUTING_ON in infra/lib/qe-stack.ts).
const fromIsrael = (req: Request) => process.env.BRIEFING_BLOCK_ISRAEL === 'true'
  && String(req.headers['cloudfront-viewer-country'] || '').toUpperCase() === 'IL';
const NOT_AVAILABLE = { error: 'This product is not available in Israel', not_available: true };

function placesHeaders(fieldMask: string) {
  return { 'Content-Type': 'application/json', 'X-Goog-Api-Key': placesKey(), 'X-Goog-FieldMask': fieldMask };
}

/** "Austin, TX" from a Places addressComponents list; falls back to whatever parts exist. */
export function cityOf(components: any[] = []): string {
  const part = (type: string, short = false) => {
    const c = components.find(x => (x.types || []).includes(type));
    return c ? (short ? c.shortText : c.longText) || '' : '';
  };
  const city = part('locality') || part('postal_town') || part('sublocality') || part('administrative_area_level_2');
  return [city, part('administrative_area_level_1', true)].filter(Boolean).join(', ');
}
const countryOf = (components: any[] = []) =>
  String(components.find(x => (x.types || []).includes('country'))?.shortText || '').toUpperCase();

/** The user's report-only business (one per user). */
async function briefingBusinessOf(userId: string) {
  const mine = async () => (await prisma.businessProfile.findMany({ where: { created_by: userId }, orderBy: { created_date: 'asc' } }))
    .find(b => isBriefingPlan(b.subscription_plan)) ?? null;
  const found = await mine();
  if (found || isFreeIdentity(userId)) return found;
  // Upgrade from the account-less Free plan (lib/freeAccess.ts): that business is stored under the
  // address that set it up. The account whose primary email is that address takes it over, with its
  // competitors and reports. getUserEmail returns the address only once Clerk has verified it, so
  // signing up with someone else's address claims nothing.
  const email = await getUserEmail(userId);
  if (!email) return null;
  const { count } = await prisma.businessProfile.updateMany({
    where: { created_by: { in: [email, email.toLowerCase()] }, subscription_plan: { startsWith: 'brief_' } },
    data: { created_by: userId },
  });
  return count ? mine() : null;
}

// Account-less Free plan, step 1: store the address with its marketing consent and email the setup
// link (lib/freeAccess.ts). Public. The answer is the same whatever we know about the address.
router.post('/free/request', freeRequestLimiter, async (req: Request, res: Response) => {
  if (fromIsrael(req)) return res.status(403).json(NOT_AVAILABLE);
  const email = parseRecipients(typeof req.body?.email === 'string' ? req.body.email.slice(0, 200) : '')[0];
  if (!email || /[<>"']/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (req.body?.consent !== true) return res.status(400).json({ error: 'Agree to receive the newsletter to get the free reports', needsConsent: true });
  try {
    // Abuse valve: every new address can spend real money on lookups and scans.
    const today = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM briefing_leads WHERE created_date > now() - interval '1 day'`;
    if ((today[0]?.n ?? 0) >= FREE_LEADS_PER_DAY) return res.status(429).json({ error: 'Free sign-ups are full for today. Try again tomorrow.' });

    const country = String(req.headers['cloudfront-viewer-country'] || '').toUpperCase().slice(0, 2) || null;
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO briefing_leads (id, email, consent_at, consent_text, country)
      VALUES (${randomUUID()}, ${email}, now(), ${FREE_CONSENT_TEXT}, ${country})
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
      RETURNING id`;
    const leadId = rows[0].id;
    // One atomic claim per email sent: never to an unsubscribed address, at most one every two
    // minutes and five a day per address (email bombing someone else's inbox).
    const send = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE briefing_leads
         SET last_link_sent_at = now(), link_day = current_date,
             link_count = CASE WHEN link_day = current_date THEN link_count + 1 ELSE 1 END
       WHERE id = ${leadId} AND unsubscribed_at IS NULL
         AND (last_link_sent_at IS NULL OR last_link_sent_at < now() - interval '2 minutes')
         AND (link_day IS DISTINCT FROM current_date OR link_count < 5)
      RETURNING id`;
    // Not awaited: the answer takes the same time whether or not an email goes out.
    if (send.length) {
      void sendFreeLink(leadId, email)
        .then(ok => { if (!ok) console.error('[briefing] free link email was not sent'); })
        .catch((e: any) => console.error('[briefing] free link email failed:', e.message));
    }
    return res.json({ ok: true });
  } catch (e: any) {
    console.error('[briefing] free request failed:', e.message);
    return res.status(500).json({ error: 'Could not send the link. Try again.' });
  }
});

router.get('/me', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const b = await briefingBusinessOf(userId);
  return res.json({ business: b ? { businessProfileId: b.id, name: b.name, onboardingCompleted: !!b.onboarding_completed } : null });
});

router.post('/search-business', strictLimiter, async (req: Request, res: Response) => {
  if (fromIsrael(req)) return res.status(403).json(NOT_AVAILABLE);
  const query = typeof req.body?.query === 'string' ? req.body.query.trim().slice(0, 120) : '';
  if (query.length < 3) return res.status(400).json({ error: 'Type your business name and city' });
  if (!placesKey()) return res.status(503).json({ error: 'Business search is not configured' });
  try {
    const r = await fetch(`${PLACES}:searchText`, {
      method: 'POST',
      headers: placesHeaders('places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.primaryTypeDisplayName'),
      body: JSON.stringify({ textQuery: query, languageCode: 'en', regionCode: 'us', maxResultCount: 5 }),
    });
    const data: any = await r.json();
    return res.json({
      results: (data.places || []).map((p: any) => ({
        placeId: p.id,
        name: p.displayName?.text || '',
        address: p.formattedAddress || '',
        category: p.primaryTypeDisplayName?.text || '',
        rating: p.rating ?? null,
        reviewCount: p.userRatingCount ?? null,
      })),
    });
  } catch (e: any) {
    console.error('[briefing] search-business failed:', e.message);
    return res.status(502).json({ error: 'Business search failed. Try again.' });
  }
});

router.post('/start', strictLimiter, async (req: Request, res: Response) => {
  if (fromIsrael(req)) return res.status(403).json(NOT_AVAILABLE);
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const placeId = typeof req.body?.placeId === 'string' ? req.body.placeId : '';
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(placeId)) return res.status(400).json({ error: 'placeId required' });
  if (!placesKey()) return res.status(503).json({ error: 'Business search is not configured' });

  const leadId: string | undefined = (req as any).freeLeadId;
  let claimed = false;
  try {
    // One report-only business per user: a second "start" resumes the first.
    const existing = await briefingBusinessOf(userId);
    if (existing) return res.json({ businessProfileId: existing.id, resumed: true, onboardingCompleted: !!existing.onboarding_completed });

    // Read the place ourselves — nothing about the business is taken from the browser but its id.
    const r = await fetch(`${PLACES}/${placeId}`, {
      headers: placesHeaders('id,displayName,formattedAddress,addressComponents,primaryTypeDisplayName,websiteUri'),
    });
    const place: any = await r.json();
    if (!r.ok || !place?.id || !place.displayName?.text) return res.status(404).json({ error: 'Business not found on Google' });
    if (countryOf(place.addressComponents) === 'IL') return res.status(403).json(NOT_AVAILABLE);

    const { tz } = localeOf({ locale: 'en-US', timezone: typeof req.body?.timezone === 'string' ? req.body.timezone : null });
    // The business's own Instagram / Facebook, read off its website — best effort, they can fix it later.
    const own = place.websiteUri
      ? await Promise.race([
        extractSocialLinksFromWebsite(place.websiteUri).catch(() => null),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 8000)),
      ])
      : null;
    // Account-less Free plan: one business per address, ever. The slot is claimed atomically, so
    // two requests cannot both create one. If it is taken and no business was found above, an
    // account has since claimed the business.
    // ponytail: a crash between the claim and the create leaves the slot 'pending'; clear it by hand.
    if (leadId) {
      const claim = await prisma.$queryRaw<{ id: string }[]>`
        UPDATE briefing_leads SET business_profile_id = 'pending' WHERE id = ${leadId} AND business_profile_id IS NULL RETURNING id`;
      if (!claim.length) return res.status(409).json({ error: 'This address already has a Cortexi account. Sign in to manage your reports.', has_account: true });
      claimed = true;
    }
    const profile = await prisma.businessProfile.create({
      data: {
        instagram_url: own?.instagram_url || null,
        facebook_url: own?.facebook_url || null,
        name: place.displayName.text,
        category: place.primaryTypeDisplayName?.text || 'Local business',
        city: cityOf(place.addressComponents) || place.formattedAddress || '',
        full_address: place.formattedAddress || null,
        website_url: place.websiteUri || null,
        google_place_id: place.id,
        google_place_id_verified: true,
        created_by: userId,
        subscription_plan: 'brief_free',
        onboarding_completed: false,
      },
    });
    // locale / timezone / report_recipients are raw-SQL columns (index.ts). The report goes to the
    // account's verified email unless they change it in the delivery step.
    const email = await getUserEmail(userId);
    await prisma.$executeRaw`UPDATE business_profiles SET locale = 'en-US', timezone = ${tz}, report_recipients = ${email} WHERE id = ${profile.id}`;
    if (leadId) await prisma.$executeRaw`UPDATE briefing_leads SET business_profile_id = ${profile.id} WHERE id = ${leadId}`;
    return res.json({ businessProfileId: profile.id, resumed: false, onboardingCompleted: false });
  } catch (e: any) {
    console.error('[briefing] start failed:', e.message);
    if (claimed) await prisma.$executeRaw`UPDATE briefing_leads SET business_profile_id = NULL WHERE id = ${leadId} AND business_profile_id = 'pending'`.catch(() => null);
    return res.status(500).json({ error: 'Could not set up your business. Try again.' });
  }
});

/** Runs a functions/* handler outside a request, as the scheduler does. Never throws. */
async function run(label: string, handler: Function, body: Record<string, unknown>) {
  const res: any = { json: () => res, status: () => res, send: () => res };
  try { await handler({ body } as any, res); } catch (e: any) { console.warn(`[briefing] ${label} failed:`, e.message); }
}

// An email to the team for each finished sign-up (Free link or account).
// ponytail: goes to the support inbox; set SIGNUP_NOTIFY_EMAIL (comma-separated) to send it elsewhere.
async function notifySignup(userId: string | null, p: { name: string; category: string | null; city: string | null; full_address: string | null }) {
  const to = (process.env.SIGNUP_NOTIFY_EMAIL || process.env.SUPPORT_NOTIFY_EMAIL || 'contact@otxengine.io').split(',').map(s => s.trim()).filter(Boolean);
  const rows: [string, unknown][] = [
    ['Email', userId ? await getUserEmail(userId) : ''],
    ['Sign-up', isFreeIdentity(userId) ? 'Free, email only' : 'Account'],
    ['Business', p.name], ['Category', p.category], ['Address', p.full_address || p.city],
  ];
  const html = `<table style="font-family:Arial,sans-serif;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#52514e">${k}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  await sendEmail({ to, subject: `New Cortexi sign-up: ${p.name}`, html });
}

router.post('/finish', requireOwnsBusinessFields, async (req: Request, res: Response) => {
  const businessProfileId = req.body?.businessProfileId;
  if (typeof businessProfileId !== 'string' || !businessProfileId) return res.status(400).json({ error: 'businessProfileId required' });
  const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId }, select: { subscription_plan: true, onboarding_completed: true, name: true, category: true, city: true, full_address: true } });
  if (!profile || !isBriefingPlan(profile.subscription_plan)) return res.status(404).json({ error: 'Not found' });
  // A second "finish" must not start the paid first collection again.
  if (profile.onboarding_completed) return res.json({ ok: true });

  await prisma.businessProfile.update({ where: { id: businessProfileId }, data: { onboarding_completed: true } });
  res.json({ ok: true });
  void notifySignup(getUserId(req), profile).catch(e => console.warn('[briefing] sign-up notice failed:', e.message));

  // First collection, in the background. The first report (last 30 days) is built by the worker's
  // FirstBriefingReport job once the posts have landed — the worker is the one that can render the PDF.
  const body = { businessProfileId, force: true };
  void Promise.allSettled([
    run('posts', collectCompetitorSocialProfileAndPosts, body),
    run('stories', collectCompetitorSocialStories, body), // skipped inside for plans without stories
    run('ads', detectCompetitorAds, { ...body, allCompetitors: true }),
    run('reviews', collectReviews, body),
  ]);
});

router.get('/settings', requireOwnsBusinessFields, async (req: Request, res: Response) => {
  const businessProfileId = req.query.businessProfileId;
  if (typeof businessProfileId !== 'string' || !businessProfileId) return res.status(400).json({ error: 'businessProfileId required' });
  const [profile, rows] = await Promise.all([
    prisma.businessProfile.findUnique({ where: { id: businessProfileId }, select: { name: true, city: true, subscription_plan: true, instagram_url: true, facebook_url: true } }),
    prisma.$queryRaw<{ timezone: string | null; organization_id: string | null; free_ended_at: Date | null }[]>`SELECT timezone, organization_id, free_ended_at FROM business_profiles WHERE id = ${businessProfileId}`,
  ]);
  if (!profile) return res.status(404).json({ error: 'Not found' });
  const limits = planLimits(profile.subscription_plan);
  return res.json({
    name: profile.name,
    city: profile.city,
    plan: profile.subscription_plan,
    competitorsMax: limits.competitors_max,
    reports: limits.reports,
    youVsThem: limits.own_in_report !== false,
    orgId: rows[0]?.organization_id ?? null, // its own billing org, once a paid plan was chosen
    freeEnded: !!rows[0]?.free_ended_at, // the three free reports are used up, or the address unsubscribed
    instagramUrl: profile.instagram_url || '',
    facebookUrl: profile.facebook_url || '',
    recipients: await customerRecipients(businessProfileId),
    timezone: localeOf({ locale: 'en-US', timezone: rows[0]?.timezone }).tz,
  });
});

router.put('/settings', requireOwnsBusinessFields, async (req: Request, res: Response) => {
  const { businessProfileId, recipients, timezone } = req.body ?? {};
  if (typeof businessProfileId !== 'string' || !businessProfileId) return res.status(400).json({ error: 'businessProfileId required' });

  if (recipients !== undefined) {
    if (!Array.isArray(recipients) || recipients.some(r => typeof r !== 'string')) return res.status(400).json({ error: 'recipients must be a list of email addresses' });
    const clean = parseRecipients(recipients.join(','));
    if (clean.length !== new Set(recipients.map((r: string) => r.trim().toLowerCase()).filter(Boolean)).size) {
      return res.status(400).json({ error: 'One of the email addresses is not valid' });
    }
    if (clean.length > MAX_RECIPIENTS) return res.status(400).json({ error: `Up to ${MAX_RECIPIENTS} recipients` });
    await prisma.$executeRaw`UPDATE business_profiles SET report_recipients = ${clean.join(',') || null} WHERE id = ${businessProfileId}`;
  }
  for (const [key, { field, host }] of Object.entries(OWN_PAGES)) {
    const value = req.body?.[key];
    if (value === undefined) continue;
    let url: string | null = null;
    if (typeof value === 'string' && value.trim()) {
      try {
        const u = new URL(value.trim());
        if (u.protocol !== 'https:' || !host.test(u.hostname)) throw new Error('host');
        url = u.toString();
      } catch { return res.status(400).json({ error: `That is not a valid ${field === 'instagram_url' ? 'Instagram' : 'Facebook'} link` }); }
    }
    await prisma.businessProfile.update({ where: { id: businessProfileId }, data: { [field]: url } });
  }
  if (timezone !== undefined) {
    const { tz } = localeOf({ locale: 'en-US', timezone: typeof timezone === 'string' ? timezone : null });
    if (tz !== timezone) return res.status(400).json({ error: 'Unknown timezone' });
    await prisma.$executeRaw`UPDATE business_profiles SET timezone = ${tz} WHERE id = ${businessProfileId}`;
  }
  return res.json({ ok: true });
});

export default router;
