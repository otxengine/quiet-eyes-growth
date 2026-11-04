/**
 * orgApi.js — API helpers for organization + agency endpoints.
 * Uses the same apiFetch pattern as client.js.
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

async function getToken() {
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

// ── Org endpoints ─────────────────────────────────────────────────────────────

export const orgApi = {
  getMyOrgs: () => apiFetch('/orgs/my'),
  createOrg: (body) => apiFetch('/orgs', { method: 'POST', body: JSON.stringify(body) }),
  getOrg: (id) => apiFetch(`/orgs/${id}`),
  updateOrg: (id, body) => apiFetch(`/orgs/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Members
  addMember: (orgId, body) => apiFetch(`/orgs/${orgId}/members`, { method: 'POST', body: JSON.stringify(body) }),
  updateMember: (orgId, userId, body) => apiFetch(`/orgs/${orgId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeMember: (orgId, userId) => apiFetch(`/orgs/${orgId}/members/${userId}`, { method: 'DELETE' }),

  // Branches
  getBranches: (orgId) => apiFetch(`/orgs/${orgId}/branches`),
  createBranch: (orgId, body) => apiFetch(`/orgs/${orgId}/branches`, { method: 'POST', body: JSON.stringify(body) }),
  deleteBranch: (orgId, branchId) => apiFetch(`/orgs/${orgId}/branches/${branchId}`, { method: 'DELETE' }),
};

// ── Agency endpoints ──────────────────────────────────────────────────────────

export const agencyApi = {
  getClients: () => apiFetch('/agency/clients'),
  addClient: (body) => apiFetch('/agency/clients', { method: 'POST', body: JSON.stringify(body) }),
  removeClient: (clientOrgId) => apiFetch(`/agency/clients/${clientOrgId}`, { method: 'DELETE' }),
  getAggregate: () => apiFetch('/agency/aggregate'),
};
