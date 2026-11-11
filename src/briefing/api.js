/**
 * API helpers for the English report-only product (/en/start, /en/briefing).
 * Same auth as the rest of the app (Clerk session token, or the dev user header without Clerk).
 */
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

async function authHeaders() {
  let token = null;
  if (window.__clerk?.session) {
    try { token = await window.__clerk.session.getToken(); } catch { /* fall through */ }
  }
  token = token || window.__clerk_session_token || localStorage.getItem('clerk_session_token');
  return token ? { Authorization: `Bearer ${token}` } : { 'x-dev-user': localStorage.getItem('dev_user_id') || 'dev-user' };
}

export async function api(path, { method = 'GET', body, timeoutMs = 30000 } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Network failure or timeout: the browser's own message ("Failed to fetch") says nothing useful.
    throw Object.assign(new Error(e.name === 'TimeoutError'
      ? 'This is taking longer than expected. Try again in a minute.'
      : 'We could not reach Cortexi. Check your connection and try again.'), { status: 0, data: {} });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { status: res.status, data });
  return data;
}

const q = (o) => new URLSearchParams(o).toString();

export const briefingApi = {
  me: () => api('/briefing/me'),
  searchBusiness: (query) => api('/briefing/search-business', { method: 'POST', body: { query } }),
  start: (placeId, timezone) => api('/briefing/start', { method: 'POST', body: { placeId, timezone } }),
  finish: (businessProfileId) => api('/briefing/finish', { method: 'POST', body: { businessProfileId } }),
  settings: (businessProfileId) => api(`/briefing/settings?${q({ businessProfileId })}`),
  saveSettings: (businessProfileId, patch) => api('/briefing/settings', { method: 'PUT', body: { businessProfileId, ...patch } }),

  // Discovery can take a couple of minutes (maps search + AI selection + page lookup).
  discover: (businessProfileId) =>
    api('/functions/runCompetitorIdentification', { method: 'POST', body: { businessProfileId }, timeoutMs: 180000 }),
  competitors: (businessProfileId) =>
    api(`/entities/Competitor?${q({ filter: JSON.stringify({ linked_business: businessProfileId }), limit: 100 })}`),
  confirmCompetitors: (businessProfileId, approvedIds, rejectedIds) =>
    api('/onboarding/confirm-competitors', { method: 'POST', body: { businessProfileId, approvedIds, rejectedIds } }),
  addCompetitor(businessProfileId, name, urls) {
    const fields = Object.keys(urls).filter((k) => urls[k]);
    return api('/entities/Competitor', {
      method: 'POST',
      body: { linked_business: businessProfileId, name, ...Object.fromEntries(fields.map((k) => [k, urls[k]])), manual_url_fields: fields },
    });
  },
  // Looks up the Google listing, website, Instagram and Facebook of a competitor. It can outlast the
  // request (the CDN closes it at 2 minutes) and still finish server-side.
  lookUpPages: (id) => api(`/competitors/${id}/enrich-urls`, { method: 'POST', body: {}, timeoutMs: 115000 }),
  updateCompetitor: (id, patch) => api(`/entities/Competitor/${id}`, { method: 'PATCH', body: patch }),

  reports: (businessProfileId) => api(`/reports?${q({ businessProfileId, limit: 60 })}`),
  async openReportPdf(id) {
    const res = await fetch(`${API_BASE}/reports/${id}/pdf`, { headers: await authHeaders() });
    if (!res.ok) throw new Error('The PDF is not available yet.');
    window.open(URL.createObjectURL(await res.blob()), '_blank', 'noopener');
  },

  selectPlan: (businessProfileId, planId) => api('/onboarding/select-plan', { method: 'POST', body: { businessProfileId, planId } }),
};
