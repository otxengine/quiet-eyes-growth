/**
 * Drop-in replacement for @base44/sdk createClient().
 * Implements the same interface:
 *   base44.entities.X.filter / create / update / delete
 *   base44.functions.invoke(name, data)
 *   base44.auth.me / logout / redirectToLogin
 *   base44.integrations.Core.InvokeLLM({ prompt })
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// Timeout for social/competitor scan functions (Apify scrape + per-item AI analysis
// across multiple competitors) — a first-ever backfill has been observed taking up
// to ~10 minutes; the previous 120-180s timeouts were sized for the old, silently
// under-scraping behavior and self-abort client-side well before the (now-correct,
// slower) scan actually finishes.
export const LONG_SCAN_TIMEOUT_MS = 900000; // 15 min

// Keep backend alive on Render free plan (ping every 10 minutes)
if (import.meta.env.VITE_API_URL) {
  setInterval(() => {
    fetch(`${API_BASE}/health`, { method: 'GET' }).catch(() => {});
  }, 10 * 60 * 1000);
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function getToken() {
  // Try to get a fresh token from the Clerk session object if available
  if (window.__clerk?.session) {
    try {
      const token = await window.__clerk.session.getToken();
      if (token) return token;
    } catch { /* fall through */ }
  }
  return window.__clerk_session_token || localStorage.getItem('clerk_session_token') || null;
}

function getDevUserId() {
  return localStorage.getItem('dev_user_id') || 'dev-user';
}

async function apiFetch(path, options = {}, timeoutMs = 30000) {
  const token = await getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : { 'x-dev-user': getDevUserId() }),
    ...(options.headers || {}),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw Object.assign(new Error('הבקשה לקחה יותר מדי זמן — נסה שוב'), { status: 408 });
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!res.ok) {
    if (isJson) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw Object.assign(new Error(err.error || res.statusText), { status: res.status, data: err });
    }
    // Non-JSON error (e.g. HTML from Render while service is waking up)
    if (res.status === 503 || res.status === 502 || !isJson) {
      throw Object.assign(new Error('השרת מתעורר, נסה שוב בעוד 30 שניות'), { status: res.status });
    }
    throw Object.assign(new Error(res.statusText || 'Server error'), { status: res.status });
  }

  if (!isJson) {
    // Render "Starting..." HTML page returned as 200 — service is waking up
    throw Object.assign(new Error('השרת מתעורר, נסה שוב בעוד 30 שניות'), { status: 503 });
  }

  return res.json();
}

// ── entity proxy ─────────────────────────────────────────────────────────────

/**
 * Converts a PascalCase entity name to the snake_case used by the server.
 * e.g. BusinessProfile → BusinessProfile (server accepts PascalCase as-is)
 */
function makeEntityClient(entityName) {
  return {
    /** filter(queryObj, sortStr, limit) */
    async filter(query = {}, sort = null, limit = null) {
      const params = new URLSearchParams();
      if (query && Object.keys(query).length) {
        params.set('filter', JSON.stringify(query));
      }
      if (sort) params.set('sort', sort);
      if (limit) params.set('limit', String(limit));
      const qs = params.toString() ? `?${params.toString()}` : '';
      return apiFetch(`/entities/${entityName}${qs}`);
    },

    async create(data) {
      return apiFetch(`/entities/${entityName}`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    async update(id, data) {
      return apiFetch(`/entities/${entityName}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
    },

    async delete(id) {
      return apiFetch(`/entities/${entityName}/${id}`, { method: 'DELETE' });
    },

    /** get(id) — fetch a single record by ID (via filter) */
    async get(id) {
      const results = await apiFetch(`/entities/${entityName}?filter=${encodeURIComponent(JSON.stringify({ id }))}`);
      return Array.isArray(results) ? (results[0] || null) : results;
    },
  };
}

// ── auth ──────────────────────────────────────────────────────────────────────

const auth = {
  async me() {
    return apiFetch('/entities/me');
  },
  logout(redirectUrl) {
    if (window.__clerk) {
      window.__clerk.signOut().then(() => {
        if (redirectUrl) window.location.href = redirectUrl;
      });
    } else {
      localStorage.removeItem('clerk_session_token');
      if (redirectUrl) window.location.href = redirectUrl;
    }
  },
  redirectToLogin(returnUrl) {
    if (window.__clerk) {
      window.__clerk.redirectToSignIn({ afterSignInUrl: returnUrl || window.location.href });
    } else {
      window.location.href = `/sign-in?redirect_url=${encodeURIComponent(returnUrl || window.location.href)}`;
    }
  },
};

// ── functions ─────────────────────────────────────────────────────────────────

const functions = {
  async invoke(name, data = {}, timeoutMs = 90000) {
    const result = await apiFetch(`/functions/${name}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, timeoutMs);
    // Wrap in { data } to match Base44 SDK response shape
    return { data: result };
  },
};

// ── integrations ──────────────────────────────────────────────────────────────

const integrations = {
  Core: {
    async InvokeLLM({ prompt, response_json_schema, model, maxTokens }) {
      return apiFetch('/functions/invokeLLM', {
        method: 'POST',
        body: JSON.stringify({ prompt, response_json_schema, model, maxTokens }),
      }, 60000); // LLM calls can take up to 60s
    },
  },
};

// ── feedback ──────────────────────────────────────────────────────────────────

const feedback = {
  async submit({ businessProfileId, agentName, outputType, score, comment, tags, aiOutputId }) {
    return apiFetch('/feedback', {
      method: 'POST',
      body: JSON.stringify({
        businessProfileId,
        agentName: agentName || 'MarketIntelligence',
        outputType: outputType || 'market_signal',
        rating: score > 0 ? 'positive' : 'negative',
        score,
        comment: comment || null,
        tags: tags || null,
        aiOutputId: aiOutputId || null,
      }),
    });
  },
};

// ── entity map (all 23 entities) ──────────────────────────────────────────────

const ENTITIES = [
  'BusinessProfile', 'Lead', 'Review', 'Competitor', 'MarketSignal',
  'RawSignal', 'Task', 'AutomationLog', 'WeeklyReport', 'HealthScore',
  'OutcomeLog', 'SectorKnowledge', 'Action', 'Prediction', 'ProactiveAlert',
  'PendingAlert', 'ReviewRequest', 'CustomerSurvey', 'BusinessLocation',
  'MetricsSnapshot', 'SocialAccount', 'SocialSignal', 'AutoAction', 'Campaign',
  'AudienceSegment',
  'MediaAsset', 'OrganicPost', 'CompetitorPost', 'CompetitorAdHistory', 'CompetitorStory',
  'CompetitorSocialProfile', 'BusinessSocialProfile', 'ProfileScore',
];

// ── raw API access ────────────────────────────────────────────────────────────

const raw = {
  async get(path) { return apiFetch(path); },
  async put(path, data) { return apiFetch(path, { method: 'PUT', body: JSON.stringify(data || {}) }); },
  async post(path, data, timeoutMs) { return apiFetch(path, { method: 'POST', body: JSON.stringify(data || {}) }, timeoutMs); },
};

// ── createClient ──────────────────────────────────────────────────────────────

export function createClient() {
  const entities = {};
  for (const name of ENTITIES) {
    entities[name] = makeEntityClient(name);
  }
  return { entities, functions, auth, integrations, feedback, raw };
}
