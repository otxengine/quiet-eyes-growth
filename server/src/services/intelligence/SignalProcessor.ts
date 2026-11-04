/**
 * SignalProcessor — Signal Processing Layer
 *
 * Bridges raw ingested signals into scored ClassifiedSignal records that feed
 * the Intelligence Layer. This is the ONLY component that classifies signals.
 *
 * Pipeline position: context → [SignalProcessor] → opportunities → intelligence
 *
 * Responsibilities:
 *  1. Pull recent raw signals from Prisma (rawSignal + marketSignal tables)
 *  2. Score each signal across 5 dimensions: urgency, intent, sector_match,
 *     location_relevance, novelty
 *  3. Compute composite_score (weighted blend)
 *  4. Deduplicate by hash (skip re-classified)
 *  5. Inject results into context.signals.items
 *  6. Emit signal.classified events + log classification run
 *
 * Rules:
 *  - No DB writes for individual classified signals (logged via automationLog)
 *  - Does NOT decide actions — produces data only
 *  - Fails gracefully: returns empty if no signals
 */

import { nanoid }             from 'nanoid';
import type { EnrichedContext, ClassifiedSignal } from '../../models';
import { signalRepository }   from '../../repositories/SignalRepository';
import { bus }                from '../../events/EventBus';
import { createLogger }       from '../../infra/logger';

const logger = createLogger('SignalProcessor');

// ─── Scoring keyword banks ────────────────────────────────────────────────────

/** High-urgency indicator terms (Hebrew + English) */
const URGENCY_KEYWORDS: string[] = [
  // Hebrew
  'דחוף', 'מיידי', 'עכשיו', 'היום', 'בהקדם', 'חירום', 'משבר', 'סגירה',
  'מכירה', 'הנחה', 'מבצע', 'ביקוש', 'עלייה', 'גידול', 'חריג', 'חזק',
  'רב', 'גבוה', 'שיא', 'פריצה', 'פתיחה', 'השקה',
  // English
  'urgent', 'immediate', 'now', 'today', 'emergency', 'crisis', 'spike',
  'surge', 'record', 'launch', 'opening', 'critical', 'high', 'peak',
  'sale', 'promo', 'discount', 'demand', 'growth',
];

/** Commercial-intent signals */
const INTENT_KEYWORDS: string[] = [
  // Hebrew
  'רוצה לקנות', 'מחפש', 'ממליץ', 'שירות', 'מחיר', 'הצעת מחיר', 'הזמנה',
  'תיאום', 'פגישה', 'שאלה', 'עניין', 'ספק', 'ליד', 'לקוח', 'קנייה',
  'הורדה', 'הרשמה', 'ניסיון', 'דמו', 'נסה', 'צור קשר',
  // English
  'buy', 'order', 'book', 'contact', 'inquiry', 'quote', 'service',
  'hire', 'need', 'looking for', 'want', 'interested', 'recommend',
  'review', 'feedback', 'customer', 'lead', 'sign up', 'register',
];

/** Negative/risk indicator terms */
const RISK_KEYWORDS: string[] = [
  'חרם', 'תלונה', 'כישלון', 'נסגר', 'סגור', 'בעיה', 'פגם', 'גרוע',
  'נורא', 'איום', 'תחרות', 'תחרותי', 'מתחרה', 'הוריד', 'ירד', 'צנח',
  'crisis', 'complaint', 'closed', 'problem', 'failed', 'bad', 'terrible',
  'threat', 'competitor', 'dropped', 'declined', 'fell',
];

/** Sector keyword maps for sector_match scoring */
const SECTOR_KEYWORDS: Record<string, string[]> = {
  food: [
    'מסעדה', 'אוכל', 'שף', 'תפריט', 'אירוח', 'קייטרינג', 'ארוחה', 'בישול',
    'restaurant', 'food', 'chef', 'menu', 'catering', 'meal', 'dining', 'cafe',
  ],
  beauty: [
    'יופי', 'ספא', 'מספרה', 'טיפול', 'עיצוב', 'פדיקור', 'מניקור', 'עיסוי',
    'beauty', 'spa', 'salon', 'treatment', 'nail', 'massage', 'skin', 'hair',
  ],
  fitness: [
    'כושר', 'חדר כושר', 'ספורט', 'אימון', 'תרגיל', 'ריצה', 'יוגה', 'פילאטיס',
    'fitness', 'gym', 'sport', 'workout', 'exercise', 'run', 'yoga', 'training',
  ],
  retail: [
    'חנות', 'קמעונאות', 'מכירה', 'מוצר', 'קטלוג', 'מלאי', 'מחיר', 'הנחה',
    'shop', 'store', 'retail', 'product', 'sale', 'inventory', 'price', 'discount',
  ],
  services: [
    'שירות', 'ייעוץ', 'מומחה', 'פתרון', 'תמיכה', 'ניהול', 'פרויקט',
    'service', 'consulting', 'expert', 'solution', 'support', 'management',
  ],
};

// ─── Score computation ────────────────────────────────────────────────────────

/** Count matching keywords in text (case-insensitive) */
function keywordHitRate(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  const hits = keywords.filter(k => lower.includes(k.toLowerCase())).length;
  return Math.min(1, hits / 3); // saturates at 3 hits
}

/** Compute urgency_score from text + signal recency */
function computeUrgencyScore(text: string, createdAt: Date): number {
  const keywordScore = keywordHitRate(text, URGENCY_KEYWORDS);

  // Recency bonus: signals < 6h old get max bonus
  const ageMs  = Date.now() - createdAt.getTime();
  const ageH   = ageMs / 3_600_000;
  const recencyBonus = ageH < 6  ? 0.30
                     : ageH < 24 ? 0.15
                     : ageH < 48 ? 0.05
                     : 0;

  return Math.min(1, keywordScore * 0.70 + recencyBonus);
}

/** Compute intent_score from text */
function computeIntentScore(text: string): number {
  return keywordHitRate(text, INTENT_KEYWORDS);
}

/** Compute sector_match from text vs business category */
function computeSectorMatch(text: string, category: string | null): number {
  const cat = (category || '').toLowerCase();

  // Map Prisma category to our keyword set
  const sectorKey = cat.includes('מסעדה') || cat.includes('food') || cat.includes('restaurant') ? 'food'
    : cat.includes('יופי') || cat.includes('beauty') || cat.includes('salon') || cat.includes('spa') ? 'beauty'
    : cat.includes('כושר') || cat.includes('fitness') || cat.includes('gym') ? 'fitness'
    : cat.includes('חנות') || cat.includes('retail') || cat.includes('shop') ? 'retail'
    : 'services';

  const keywords = SECTOR_KEYWORDS[sectorKey] ?? SECTOR_KEYWORDS.services;
  const sectorScore = keywordHitRate(text, keywords);

  // General business terms add a floor
  return Math.max(0.10, sectorScore);
}

/** Compute location_relevance from text vs business city */
function computeLocationRelevance(text: string, city: string | null): number {
  if (!city) return 0.30; // unknown location → neutral score

  const lower = text.toLowerCase();
  const cityLower = city.toLowerCase();

  // Exact city match
  if (lower.includes(cityLower)) return 1.0;

  // Major metro aliases
  const METRO_ALIASES: Record<string, string[]> = {
    'תל אביב': ['תל אביב', 'תל-אביב', 'tel aviv', 'tlv', 'גוש דן', 'רמת גן', 'גבעתיים', 'פתח תקווה', 'חולון'],
    'ירושלים': ['ירושלים', 'jerusalem', 'jlm'],
    'חיפה':    ['חיפה', 'haifa', 'קריות', 'קרית'],
    'באר שבע': ['באר שבע', 'beer sheva', 'negev'],
  };

  const aliases = METRO_ALIASES[city] ?? [cityLower];
  const inMetro = aliases.some(a => lower.includes(a));
  if (inMetro) return 0.85;

  // Generic Israel reference
  if (lower.includes('ישראל') || lower.includes('israel')) return 0.50;

  return 0.20; // no geo match
}

/**
 * Compute novelty_score: 0 = already seen, 1 = completely new.
 * Uses known hashes from existing classified signals to penalize repeats.
 */
function computeNoveltyScore(
  hash: string,
  knownHashes: Set<string>,
): number {
  // If we've seen this exact hash recently → low novelty
  if (knownHashes.has(hash)) return 0.05;

  // All new signals start with full novelty
  return 1.0;
}

/** Weighted composite score */
function computeComposite(signal: Omit<ClassifiedSignal, 'id' | 'signal_id' | 'business_id' | 'classified_at' | 'composite_score'>): number {
  return (
    signal.urgency_score       * 0.30 +
    signal.intent_score        * 0.25 +
    signal.sector_match        * 0.20 +
    signal.novelty_score       * 0.15 +
    signal.location_relevance  * 0.10
  );
}

// ─── Signal normalisation helper ─────────────────────────────────────────────

function extractText(signal: any): string {
  return [
    signal.summary,
    signal.content,
    signal.title,
    signal.source_url,
    signal.keywords?.join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 2000);
}

// ─── Main service ─────────────────────────────────────────────────────────────

export interface SignalProcessorResult {
  classified:       ClassifiedSignal[];
  total_raw:        number;
  high_urgency:     number;
  skipped_known:    number;
  duration_ms:      number;
}

/**
 * processSignals — classifies raw signals for a business.
 *
 * Called by MasterOrchestrator in the `classify` pipeline stage.
 * Mutates context.signals to inject ClassifiedSignal items.
 *
 * @returns SignalProcessorResult with classified signals + stats
 */
export async function processSignals(
  ctx:     EnrichedContext,
  traceId: string,
): Promise<SignalProcessorResult> {
  const t0 = Date.now();
  logger.info('SignalProcessor started', { businessId: ctx.business_id });

  // ── 1. Pull raw signals (last 48h) ─────────────────────────────────────────
  const rawSignals = await signalRepository.getRecentRaw(ctx.business_id, 48, 100);
  const marketSignals = await signalRepository.getRecentMarket(ctx.business_id, 48, 50);

  // Merge both signal sources into a unified list
  const allRaw: Array<{ id: string; text: string; hash: string; createdAt: Date }> = [
    ...rawSignals.map(s => ({
      id:        s.id,
      text:      extractText(s),
      hash:      (s as any).content_hash ?? s.id, // use hash field if available
      createdAt: new Date(s.created_date),
    })),
    ...marketSignals.map(s => ({
      id:        s.id,
      text:      extractText(s),
      hash:      (s as any).content_hash ?? s.id,
      createdAt: new Date(s.created_date),
    })),
  ];

  if (allRaw.length === 0) {
    logger.info('No raw signals to process', { businessId: ctx.business_id });
    await signalRepository.logClassificationRun(ctx.business_id, 0, 0, traceId);
    return { classified: [], total_raw: 0, high_urgency: 0, skipped_known: 0, duration_ms: Date.now() - t0 };
  }

  // ── 2. Build known-hash set from existing classified signals ───────────────
  const knownHashes = new Set<string>(
    (ctx.signals.items ?? []).map((cs: ClassifiedSignal) => cs.signal_id),
  );

  const { name: bizName, category: bizCategory, city: bizCity } = ctx.profile;

  // ── 3. Score each signal ───────────────────────────────────────────────────
  const classified: ClassifiedSignal[] = [];
  let skippedKnown = 0;

  for (const raw of allRaw) {
    if (!raw.text || raw.text.length < 5) continue; // skip empty

    const novelty = computeNoveltyScore(raw.hash, knownHashes);
    if (novelty < 0.10) {
      skippedKnown++;
      continue; // skip already-seen signals
    }

    const urgency          = computeUrgencyScore(raw.text, raw.createdAt);
    const intent           = computeIntentScore(raw.text);
    const sectorMatch      = computeSectorMatch(raw.text, bizCategory);
    const locationRelevance = computeLocationRelevance(raw.text, bizCity);

    const partial = { urgency_score: urgency, intent_score: intent, sector_match: sectorMatch, location_relevance: locationRelevance, novelty_score: novelty };
    const composite = computeComposite(partial as any);

    // Confidence = geometric mean of top 3 scores (signals we're most sure about)
    const scores = [urgency, intent, sectorMatch, locationRelevance, novelty].sort((a, b) => b - a);
    const confidence = Math.cbrt(scores[0] * scores[1] * scores[2]);

    const cs: ClassifiedSignal = {
      id:                 `cs_${nanoid(8)}`,
      signal_id:          raw.id,
      business_id:        ctx.business_id,
      intent_score:       Math.round(intent          * 1000) / 1000,
      sector_match:       Math.round(sectorMatch      * 1000) / 1000,
      location_relevance: Math.round(locationRelevance * 1000) / 1000,
      urgency_score:      Math.round(urgency           * 1000) / 1000,
      novelty_score:      Math.round(novelty           * 1000) / 1000,
      confidence:         Math.round(confidence        * 1000) / 1000,
      composite_score:    Math.round(composite         * 1000) / 1000,
      classified_at:      new Date().toISOString(),
    };

    classified.push(cs);
    knownHashes.add(raw.hash); // prevent duplicates within this run
  }

  const highUrgency = classified.filter(cs => cs.urgency_score >= 0.60).length;

  // ── 4. Inject into context ─────────────────────────────────────────────────
  ctx.signals = {
    total:       classified.length,
    high_urgency: highUrgency,
    items:        classified,
  };

  // ── 5. Emit events ─────────────────────────────────────────────────────────
  for (const cs of classified) {
    if (cs.composite_score >= 0.40) {
      // Only emit events for signals that clear the quality threshold
      await bus.emit(bus.makeEvent('signal.classified', ctx.business_id, {
        signal_id:          cs.signal_id,
        business_id:        ctx.business_id,
        composite_score:    cs.composite_score,
        urgency_score:      cs.urgency_score,
        novelty_score:      cs.novelty_score,
        classified_at:      cs.classified_at,
      }, traceId));
    }
  }

  // ── 6. Log run ─────────────────────────────────────────────────────────────
  await signalRepository.logClassificationRun(
    ctx.business_id,
    classified.length,
    highUrgency,
    traceId,
  );

  const duration_ms = Date.now() - t0;

  logger.info('SignalProcessor complete', {
    businessId:    ctx.business_id,
    totalRaw:      allRaw.length,
    classified:    classified.length,
    highUrgency,
    skippedKnown,
    duration_ms,
  });

  return {
    classified,
    total_raw:     allRaw.length,
    high_urgency:  highUrgency,
    skipped_known: skippedKnown,
    duration_ms,
  };
}
