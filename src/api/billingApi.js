/**
 * billingApi.js — API helpers for the Paddle billing endpoints (/api/billing).
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

export const billingApi = {
  /** Subscription status, card and recent charges for the active org */
  getStatus: (orgId) => apiFetch(`/billing/status${orgId ? `?orgId=${orgId}` : ''}`),

  /**
   * Start or change a subscription.
   * Returns { transactionId } for a new subscription (open it with openPaddleCheckout),
   * { changed: true } when an existing subscription switched plan in place,
   * or { devBypass: true } in local dev without Paddle configured.
   */
  checkout: (planId, orgId) =>
    apiFetch('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ planId, orgId }),
    }),

  /** Paddle customer portal link: { url, updatePaymentUrl } */
  portal: (orgId) =>
    apiFetch('/billing/portal', {
      method: 'POST',
      body: JSON.stringify({ orgId }),
    }),

  /** Short-lived invoice PDF link: { url } */
  invoicePdf: (txnId, orgId) =>
    apiFetch(`/billing/invoices/${encodeURIComponent(txnId)}/pdf${orgId ? `?orgId=${orgId}` : ''}`),

  /** Sync branch count to subscription quantity */
  updateQuantity: (orgId) =>
    apiFetch('/billing/update-quantity', {
      method: 'POST',
      body: JSON.stringify({ orgId }),
    }),
};
