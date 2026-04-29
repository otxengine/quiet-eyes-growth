/**
 * Admin-only API client.
 * Sends x-admin-key header on every request — no Clerk dependency.
 * Same interface as base44 (entities, functions, integrations).
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

function getAdminKey() {
  return sessionStorage.getItem('__admin_key') || '';
}

async function adminFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-admin-key': getAdminKey(),
    ...(options.headers || {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!res.ok) {
    if (isJson) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw Object.assign(new Error(err.error || res.statusText), { status: res.status });
    }
    throw Object.assign(new Error(res.statusText || 'Server error'), { status: res.status });
  }
  if (!isJson) {
    throw Object.assign(new Error('השרת מתעורר, נסה שוב בעוד 30 שניות'), { status: 503 });
  }
  return res.json();
}

function makeEntityClient(entityName) {
  return {
    async filter(query = {}, sort = null, limit = null) {
      const params = new URLSearchParams();
      if (query && Object.keys(query).length) params.set('filter', JSON.stringify(query));
      if (sort) params.set('sort', sort);
      if (limit) params.set('limit', String(limit));
      const qs = params.toString() ? `?${params.toString()}` : '';
      return adminFetch(`/entities/${entityName}${qs}`);
    },
    async create(data) {
      return adminFetch(`/entities/${entityName}`, { method: 'POST', body: JSON.stringify(data) });
    },
    async update(id, data) {
      return adminFetch(`/entities/${entityName}/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
    },
    async delete(id) {
      return adminFetch(`/entities/${entityName}/${id}`, { method: 'DELETE' });
    },
  };
}

const ENTITIES = [
  'BusinessProfile', 'Lead', 'Review', 'Competitor', 'MarketSignal',
  'RawSignal', 'Task', 'AutomationLog', 'WeeklyReport', 'HealthScore',
  'OutcomeLog', 'SectorKnowledge', 'Action', 'Prediction', 'ProactiveAlert',
  'PendingAlert', 'ReviewRequest', 'CustomerSurvey', 'BusinessLocation',
  'MetricsSnapshot', 'SocialAccount', 'SocialSignal', 'AutoAction', 'Campaign',
  'MediaAsset', 'OrganicPost',
];

const entities = {};
for (const name of ENTITIES) {
  entities[name] = makeEntityClient(name);
}

const functions = {
  async invoke(name, data = {}) {
    const result = await adminFetch(`/functions/${name}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return { data: result };
  },
};

const integrations = {
  Core: {
    async InvokeLLM({ prompt, model }) {
      return adminFetch('/functions/invokeLLM', {
        method: 'POST',
        body: JSON.stringify({ prompt, model }),
      });
    },
  },
};

export const adminClient = { entities, functions, integrations };

export async function verifyAdminKey(key) {
  try {
    const res = await fetch(`${API_BASE}/admin-verify`, {
      headers: { 'x-admin-key': key, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn('[admin-verify]', res.status, body);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[admin-verify] network error:', e);
    return false;
  }
}
