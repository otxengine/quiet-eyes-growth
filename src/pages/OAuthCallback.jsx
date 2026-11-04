import { useEffect, useRef, useState } from 'react';
import { getAuthHeaders } from '@/api/client';

const SERVER_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3007/api').replace(/\/api\/?$/, '');

async function post(path, body) {
  const res = await fetch(`${SERVER_BASE}/api/oauth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ error: `HTTP ${res.status}` }));
}

// Tell the Integrations page how it went. A same-origin channel, since the providers' pages can
// cut window.opener; then close the popup (a browser may refuse, so the page also says so).
function report(message) {
  const channel = new BroadcastChannel('oauth');
  channel.postMessage(message);
  channel.close();
  setTimeout(() => window.close(), 1200);
}

/**
 * The OAuth popup lands here (via /api/oauth/callback) with platform, code and state in the
 * fragment. This page runs as the signed-in user in the same browser, so it can finish the
 * flow with an authenticated POST; the server accepts the state only from the user who started it.
 */
export default function OAuthCallback() {
  // Read once, then drop the code from the address bar and history
  const [params] = useState(() => {
    const p = new URLSearchParams(window.location.hash.slice(1));
    window.history.replaceState(null, '', window.location.pathname);
    return p;
  });
  const [view, setView] = useState(/** @type {any} */ ({ status: 'loading' })); // loading | picker | done | error
  const started = useRef(false);

  const settle = (result) => {
    if (result?.needs_page_selection) {
      setView({ status: 'picker', ...result });
    } else if (result?.ok) {
      setView({ status: 'done', pageName: result.page_name });
      report({ type: 'oauth_success', platform: result.platform });
    } else {
      const error = result?.error || 'נסה שוב';
      setView({ status: 'error', error });
      report({ type: 'oauth_error', error });
    }
  };

  useEffect(() => {
    if (started.current) return; // the code is single use
    started.current = true;
    if (params.get('error')) return settle({ error: params.get('error') });
    post('complete', { platform: params.get('platform'), code: params.get('code'), state: params.get('state') })
      .then(settle, (e) => settle({ error: e.message }));
  }, []);

  const pick = (idx) => {
    setView({ status: 'loading' });
    post('confirm-page', { session: view.session, idx }).then(settle, (e) => settle({ error: e.message }));
  };

  const isGoogle = view.platform === 'google_business';
  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary/50 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-md p-8 max-w-md w-full text-center">
        {view.status === 'loading' && (
          <>
            <h1 className="text-lg font-bold text-foreground mb-4">מסיים את החיבור...</h1>
            <div className="w-8 h-8 border-4 border-purple-100 border-t-purple-600 rounded-full animate-spin mx-auto" />
          </>
        )}
        {view.status === 'picker' && (
          <>
            <h1 className="text-[15px] font-bold text-foreground mb-1">
              {isGoogle ? 'בחר את העסק שברצונך לחבר' : 'בחר את הדף שברצונך לחבר'}
            </h1>
            <p className="text-[12px] text-foreground-muted mb-4">
              {isGoogle ? 'בחשבון Google הזה יש כמה עסקים — בחר את הסניף הנכון' : 'נמצאו מספר דפים — בחר את הדף הנכון לעסק זה'}
            </p>
            <div className="space-y-2 text-right">
              {view.pages.map((p, i) => (
                <button key={i} onClick={() => pick(i)}
                  className="w-full p-3 rounded-xl border border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-all">
                  <div className="text-[13px] font-semibold text-foreground">{p.name}</div>
                  {p.detail && <div className="text-[10px] text-gray-400">{p.detail}</div>}
                </button>
              ))}
            </div>
          </>
        )}
        {view.status === 'done' && (
          <>
            <h1 className="text-lg font-bold text-emerald-600 mb-2">✓ {view.pageName || 'החיבור'} חובר בהצלחה!</h1>
            <p className="text-foreground-muted text-sm">אפשר לסגור את החלון.</p>
          </>
        )}
        {view.status === 'error' && (
          <>
            <h1 className="text-lg font-bold text-red-500 mb-2">שגיאה בחיבור</h1>
            <p className="text-red-500 text-sm mb-2">{view.error}</p>
            <p className="text-foreground-muted text-sm">סגור את החלון ונסה שוב.</p>
          </>
        )}
      </div>
    </div>
  );
}
