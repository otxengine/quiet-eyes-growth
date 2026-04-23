/**
 * Drop-in replacement for @base44/sdk createClient().
 * Implements the same interface:
 *   base44.entities.X.filter / create / update / delete
 *   base44.functions.invoke(name, data)
 *   base44.auth.me / logout / redirectToLogin
 *   base44.integrations.Core.InvokeLLM({ prompt })
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

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

async function apiFetch(path, options = {}) {
  const token = await getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : { 'x-dev-user': getDevUserId() }),
    ...(options.headers || {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
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
  async invoke(name, data = {}) {
    const result = await apiFetch(`/functions/${name}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    // Wrap in { data } to match Base44 SDK response shape
    return { data: result };
  },
};

// ── integrations ──────────────────────────────────────────────────────────────

const integrations = {
  Core: {
    async InvokeLLM({ prompt, response_json_schema, model }) {
      return apiFetch('/functions/invokeLLM', {
        method: 'POST',
        body: JSON.stringify({ prompt, response_json_schema, model }),
      });
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

// ── entity map (all 22 entities) ──────────────────────────────────────────────

const ENTITIES = [
  'BusinessProfile', 'Lead', 'Review', 'Competitor', 'MarketSignal',
  'RawSignal', 'Task', 'AutomationLog', 'WeeklyReport', 'HealthScore',
  'OutcomeLog', 'SectorKnowledge', 'Action', 'Prediction', 'ProactiveAlert',
  'PendingAlert', 'ReviewRequest', 'CustomerSurvey', 'BusinessLocation',
  'MetricsSnapshot', 'SocialAccount', 'SocialSignal',
];

// ── createClient ──────────────────────────────────────────────────────────────

export function createClient() {
  const entities = {};
  for (const name of ENTITIES) {
    entities[name] = makeEntityClient(name);
  }
  return { entities, functions, auth, integrations, feedback };
}
