/**
 * businessSnapshot.js
 *
 * Fetches a comprehensive snapshot of the business state from available entities.
 * Cached in sessionStorage for 15 minutes per businessId.
 * Used to give agents accurate context — prevents suggestions like
 * "register on Google Business" when the business is already registered.
 */

import { base44 } from '@/api/base44Client';

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function cacheKey(bpId) {
  return `biz_snapshot_${bpId}`;
}

function loadCache(bpId) {
  try {
    const raw = sessionStorage.getItem(cacheKey(bpId));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts < CACHE_TTL) return data;
    sessionStorage.removeItem(cacheKey(bpId));
  } catch {}
  return null;
}

function saveCache(bpId, data) {
  try {
    sessionStorage.setItem(cacheKey(bpId), JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

/**
 * Builds a structured snapshot from raw entity data.
 * This is the "what the business has / doesn't have" map.
 */
function buildSnapshot(bp, socialAccounts, competitors, healthScore, reviews, tasks, signals, outcomes) {
  // Connected social platforms
  const connectedPlatforms = (socialAccounts || [])
    .filter(a => a.status === 'active' || a.is_connected)
    .map(a => (a.platform || '').toLowerCase())
    .filter(Boolean);

  const ALL_PLATFORMS = ['facebook', 'instagram', 'google', 'tiktok', 'whatsapp', 'wolt', 'ten_bis', 'website'];
  const missingPlatforms = ALL_PLATFORMS.filter(p => !connectedPlatforms.includes(p));

  // Reviews
  const pendingReviews  = (reviews || []).filter(r => r.response_status === 'pending').length;
  const negativeReviews = (reviews || []).filter(r => (r.rating || 5) <= 2).length;
  const avgRating       = reviews?.length
    ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1)
    : null;

  // Tasks
  const openTasks        = (tasks || []).filter(t => t.status !== 'completed').length;
  const highPriorityTasks = (tasks || []).filter(t => t.priority === 'high' && t.status !== 'completed').length;

  // Health
  const health = healthScore?.[0] || null;

  // Signals — recent unread
  const unreadSignals = (signals || []).filter(s => !s.is_read).length;

  return {
    // Business basics
    name:        bp?.name        || '',
    category:    bp?.category    || '',
    city:        bp?.city        || '',
    has_website: !!(bp?.website || bp?.website_url),
    website:     bp?.website || bp?.website_url || null,
    description: bp?.description || '',
    phone:       bp?.phone       || null,

    // Platforms
    connected_platforms: connectedPlatforms,
    missing_platforms:   missingPlatforms,
    has_google_business: connectedPlatforms.includes('google'),
    has_facebook:        connectedPlatforms.includes('facebook'),
    has_instagram:       connectedPlatforms.includes('instagram'),
    has_whatsapp:        connectedPlatforms.includes('whatsapp'),
    has_wolt:            connectedPlatforms.includes('wolt'),
    has_ten_bis:         connectedPlatforms.includes('ten_bis'),

    // Competitors
    competitor_count: (competitors || []).length,
    competitor_names: (competitors || []).slice(0, 5).map(c => c.name).filter(Boolean),

    // Reviews
    pending_reviews:  pendingReviews,
    negative_reviews: negativeReviews,
    avg_rating:       avgRating,
    total_reviews:    reviews?.length || 0,

    // Tasks
    open_tasks:          openTasks,
    high_priority_tasks: highPriorityTasks,

    // Health
    health_score:  health?.score || null,
    health_status: health?.status || null,

    // Signals
    unread_signals: unreadSignals,

    // Recent completed actions — used to prevent repeat suggestions
    recent_outcomes: (outcomes || []).slice(0, 20).map(o => ({
      action_type:        o.action_type || '',
      description:        o.outcome_description || '',
      insight_id:         o.linked_action || null,
      ts:                 o.created_at || o.created_date || '',
    })),
  };
}

/**
 * Generates a concise human-readable context string for LLM prompts.
 * Focuses on what IS and IS NOT set up — prevents irrelevant suggestions.
 */
export function snapshotToPromptContext(snapshot) {
  if (!snapshot) return '';

  const lines = [];

  lines.push(`עסק: "${snapshot.name}" | קטגוריה: ${snapshot.category} | עיר: ${snapshot.city}`);

  if (snapshot.connected_platforms.length > 0) {
    lines.push(`פלטפורמות פעילות: ${snapshot.connected_platforms.join(', ')}`);
  }
  if (snapshot.missing_platforms.length > 0) {
    lines.push(`פלטפורמות לא מחוברות: ${snapshot.missing_platforms.join(', ')}`);
  }

  lines.push(`אתר: ${snapshot.has_website ? snapshot.website || 'כן' : 'אין'}`);

  if (snapshot.pending_reviews > 0) {
    lines.push(`ביקורות ממתינות לתגובה: ${snapshot.pending_reviews}`);
  }
  if (snapshot.avg_rating) {
    lines.push(`דירוג ממוצע: ${snapshot.avg_rating}/5 (${snapshot.total_reviews} ביקורות)`);
  }
  if (snapshot.competitor_count > 0) {
    lines.push(`מתחרים במעקב: ${snapshot.competitor_count} (${snapshot.competitor_names.join(', ')})`);
  }
  if (snapshot.open_tasks > 0) {
    lines.push(`משימות פתוחות: ${snapshot.open_tasks} (${snapshot.high_priority_tasks} בעדיפות גבוהה)`);
  }
  if (snapshot.health_score) {
    lines.push(`ציון בריאות עסקית: ${snapshot.health_score}/100`);
  }

  // Completed actions — critical: tells agents what NOT to suggest again
  if (snapshot.recent_outcomes?.length > 0) {
    const descs = snapshot.recent_outcomes
      .filter(o => o.description)
      .slice(0, 10)
      .map(o => o.description);
    if (descs.length > 0) {
      lines.push(`פעולות שכבר בוצעו (אל תציע שוב): ${descs.join(', ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Main fetch function. Returns snapshot object or null on failure.
 * Runs all queries in parallel to minimize latency.
 */
export async function fetchBusinessSnapshot(bpId) {
  if (!bpId) return null;

  // Check cache first
  const cached = loadCache(bpId);
  if (cached) return cached;

  try {
    const [bp, socialAccounts, competitors, healthScores, reviews, tasks, signals, outcomes] = await Promise.allSettled([
      base44.entities.BusinessProfile.get(bpId),
      base44.entities.SocialAccount.filter({ linked_business: bpId }),
      base44.entities.Competitor.filter({ linked_business: bpId }, null, 20),
      base44.entities.HealthScore.filter({ linked_business: bpId }, '-created_date', 1),
      base44.entities.Review.filter({ linked_business: bpId }, '-created_date', 50),
      base44.entities.Task.filter({ linked_business: bpId, status: 'pending' }, '-created_date', 30),
      base44.entities.MarketSignal.filter({ linked_business: bpId, is_read: false }, '-detected_at', 10),
      base44.entities.OutcomeLog.filter({ linked_business: bpId }, '-created_at', 20),
    ]);

    const snapshot = buildSnapshot(
      bp.status             === 'fulfilled' ? bp.value             : null,
      socialAccounts.status === 'fulfilled' ? socialAccounts.value : [],
      competitors.status    === 'fulfilled' ? competitors.value    : [],
      healthScores.status   === 'fulfilled' ? healthScores.value   : [],
      reviews.status        === 'fulfilled' ? reviews.value        : [],
      tasks.status          === 'fulfilled' ? tasks.value          : [],
      signals.status        === 'fulfilled' ? signals.value        : [],
      outcomes.status       === 'fulfilled' ? outcomes.value       : [],
    );

    saveCache(bpId, snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

/** Force-invalidate the cache for a business (e.g. after user connects a platform) */
export function invalidateSnapshot(bpId) {
  try { sessionStorage.removeItem(cacheKey(bpId)); } catch {}
}

/**
 * Log a completed action to OutcomeLog + invalidate snapshot cache.
 * Call this whenever the user executes a meaningful action from an insight.
 *
 * @param {string} bpId - businessProfileId
 * @param {string} actionType - short key e.g. 'createTask', 'registered_wolt', 'responded_review'
 * @param {string} description - human-readable e.g. "נרשם לוולט", "הגיב לביקורת שלילית"
 * @param {string|null} insightId - the insight ID this action came from (for tracing)
 */
export async function logCompletedAction(bpId, actionType, description, insightId = null) {
  if (!bpId) return;
  try {
    await base44.entities.OutcomeLog.create({
      action_type:         actionType,
      was_accepted:        true,
      outcome_description: description,
      linked_business:     bpId,
      linked_action:       insightId || undefined,
      impact_score:        1,
    });
  } catch {
    // Non-critical — log failure silently
  }
  // Always invalidate so next insight load re-fetches fresh state
  invalidateSnapshot(bpId);
}
