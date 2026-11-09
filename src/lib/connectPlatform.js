// Shared OAuth connect flow — server-side state, popup + postMessage.
// Used by the standalone Integrations page and the onboarding connect step.
import { getAuthHeaders } from '@/api/client';

const _apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3007/api';
const SERVER_BASE = _apiUrl.replace(/\/api\/?$/, '');

export async function initiateOAuth(platformId, businessId) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${SERVER_BASE}/api/oauth/initiate/${platformId}?businessId=${businessId}`, { headers });
  return res.json(); // { url, state } or { whatsapp_embedded_signup } or { error, demo }
}

// Opens the OAuth popup and resolves once the popup posts back success/error
// (server's /api/oauth/callback/:platform page does window.opener.postMessage
// then window.close() — it never navigates the opener tab).
export function connectPlatform(platformId, businessId) {
  return new Promise((resolve) => {
    (async () => {
      let result;
      try {
        result = await initiateOAuth(platformId, businessId);
      } catch (err) {
        resolve({ error: err.message });
        return;
      }

      if (result?.whatsapp_embedded_signup) return resolve({ whatsapp_embedded_signup: true });
      if (result?.demo || result?.error) return resolve({ error: result.error || 'not_configured' });
      if (!result?.url) return resolve({ error: 'no_url' });

      const popup = window.open(result.url, 'oauth', 'width=620,height=720,scrollbars=yes,resizable=yes');
      if (!popup) return resolve({ error: 'popup_blocked' });

      const handler = (event) => {
        if (event.data?.type === 'oauth_success') {
          window.removeEventListener('message', handler);
          resolve({ success: true });
        } else if (event.data?.type === 'oauth_error') {
          window.removeEventListener('message', handler);
          resolve({ error: event.data.error });
        }
      };
      window.addEventListener('message', handler);

      // Give up after 5 minutes if the popup never posts back (closed manually, etc).
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve({ timeout: true });
      }, 5 * 60 * 1000);
    })();
  });
}
