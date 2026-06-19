/**
 * stripeApi.js — API helpers for Stripe billing endpoints.
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

export const stripeApi = {
  /** Get subscription status for the active org */
  getStatus: (orgId) => apiFetch(`/stripe/status${orgId ? `?orgId=${orgId}` : ''}`),

  /** Create a Checkout Session and redirect to Stripe */
  checkout: (planId, orgId, returnUrl) =>
    apiFetch('/stripe/checkout', {
      method: 'POST',
      body: JSON.stringify({ planId, orgId, returnUrl }),
    }),

  /** Open Stripe Billing Portal */
  portal: (orgId, returnUrl) =>
    apiFetch('/stripe/portal', {
      method: 'POST',
      body: JSON.stringify({ orgId, returnUrl }),
    }),

  /** Sync branch count to subscription quantity */
  updateQuantity: (orgId) =>
    apiFetch('/stripe/update-quantity', {
      method: 'POST',
      body: JSON.stringify({ orgId }),
    }),
};
