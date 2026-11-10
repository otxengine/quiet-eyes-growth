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
import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { getUserId } from '../middleware/auth';
import { requireOwnsBusinessFields } from '../middleware/businessAccess';
import { strictLimiter } from '../middleware/rateLimits';
import { getUserEmail } from '../lib/ownership';
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
// The business's own pages, for the "you vs. your competitors" section. Empty clears the link.
const OWN_PAGES: Record<string, { field: 'instagram_url' | 'facebook_url'; host: RegExp }> = {
  instagramUrl: { field: 'instagram_url', host: /(^|\.)instagram\.com$/i },
  facebookUrl: { field: 'facebook_url', host: /(^|\.)facebook\.com$/i },
};
const placesKey = () => process.env.GOOGLE_PLACES_API_KEY || '';

// The product is not sold in Israel (the Hebrew app is). CloudFront adds the header when the
// distribution forwards it; without it nothing is refused here and the CDN redirect is the gate.
const fromIsrael = (req: Request) => String(req.headers['cloudfront-viewer-country'] || '').toUpperCase() === 'IL';
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
  return (await prisma.businessProfile.findMany({ where: { created_by: userId }, orderBy: { created_date: 'asc' } }))
    .find(b => isBriefingPlan(b.subscription_plan)) ?? null;
}

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
    return res.json({ businessProfileId: profile.id, resumed: false, onboardingCompleted: false });
  } catch (e: any) {
    console.error('[briefing] start failed:', e.message);
    return res.status(500).json({ error: 'Could not set up your business. Try again.' });
  }
});

/** Runs a functions/* handler outside a request, as the scheduler does. Never throws. */
async function run(label: string, handler: Function, body: Record<string, unknown>) {
  const res: any = { json: () => res, status: () => res, send: () => res };
  try { await handler({ body } as any, res); } catch (e: any) { console.warn(`[briefing] ${label} failed:`, e.message); }
}

router.post('/finish', requireOwnsBusinessFields, async (req: Request, res: Response) => {
  const businessProfileId = req.body?.businessProfileId;
  if (typeof businessProfileId !== 'string' || !businessProfileId) return res.status(400).json({ error: 'businessProfileId required' });
  const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId }, select: { subscription_plan: true } });
  if (!profile || !isBriefingPlan(profile.subscription_plan)) return res.status(404).json({ error: 'Not found' });

  await prisma.businessProfile.update({ where: { id: businessProfileId }, data: { onboarding_completed: true } });
  res.json({ ok: true });

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
    prisma.$queryRaw<{ timezone: string | null }[]>`SELECT timezone FROM business_profiles WHERE id = ${businessProfileId}`,
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
