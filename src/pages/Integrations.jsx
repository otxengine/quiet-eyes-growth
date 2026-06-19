import React, { useState, useEffect, useRef } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { CheckCircle, ExternalLink, Loader2, X, AlertTriangle, Clock } from 'lucide-react';
import HubSpotConfig from '@/components/integrations/HubSpotConfig';
import MondayConfig from '@/components/integrations/MondayConfig';
import WebhookZapierConfig from '@/components/integrations/WebhookZapierConfig';
import SyncEventsConfig from '@/components/integrations/SyncEventsConfig';
import SyncStats from '@/components/integrations/SyncStats';

// ── Social platform definitions ───────────────────────────────────────────────

const SOCIAL_PLATFORMS = [
  {
    id: 'facebook_page',
    name: 'Facebook',
    icon: '📘',
    color: '#1877F2',
    bg: '#EBF3FF',
    description: 'פרסם פוסטים ועדכונים',
  },
  {
    id: 'instagram_business',
    name: 'Instagram',
    icon: '📷',
    color: '#E1306C',
    bg: '#FEF0F5',
    description: 'שתף תמונות וסטוריז',
  },
  {
    id: 'whatsapp_business',
    name: 'WhatsApp',
    icon: '💬',
    color: '#25D366',
    bg: '#F0FDF4',
    description: 'שלח הודעות אוטומטיות ללידים',
  },
  {
    id: 'google_business',
    name: 'Google Business',
    icon: '🔍',
    color: '#4285F4',
    bg: '#EBF3FF',
    description: 'הגב לביקורות ישירות מהמערכת',
  },
  {
    id: 'tiktok_business',
    name: 'TikTok',
    icon: '🎵',
    color: '#010101',
    bg: '#F0F0F0',
    description: 'פרסם סרטונים ותוכן',
  },
];

const ADS_PLATFORMS = [
  {
    id: 'google_ads',
    name: 'Google Ads',
    icon: '📢',
    color: '#4285F4',
    bg: '#EBF3FF',
    description: 'צור קמפיינים בגוגל — החיוב עובר ישירות לחשבון הגוגל שלך',
  },
  {
    id: 'meta_ads',
    name: 'Meta Ads',
    icon: '📘',
    color: '#1877F2',
    bg: '#EBF3FF',
    description: 'פרסם בפייסבוק, אינסטגרם ו-WhatsApp — החיוב עובר לחשבון Meta שלך',
  },
  {
    id: 'tiktok_ads',
    name: 'TikTok Ads',
    icon: '🎵',
    color: '#010101',
    bg: '#F0F0F0',
    description: 'פרסם קמפיינים בטיקטוק — החיוב עובר לחשבון TikTok Ads שלך',
  },
];

const CRM_PLATFORMS = [
  {
    id: 'hubspot',
    name: 'HubSpot',
    icon: '🟠',
    color: '#FF7A59',
    bg: '#FFF5F2',
    description: 'סנכרן לקוחות ולידים',
  },
  {
    id: 'monday',
    name: 'Monday',
    icon: '📋',
    color: '#FF3D57',
    bg: '#FFF2F4',
    description: 'נהל משימות ופרויקטים',
  },
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    icon: '🔵',
    color: '#2E86AB',
    bg: '#EEF6FB',
    description: 'CRM מכירות ולידים',
  },
];

// ── Convert SocialAccount[] → connections map ──────────────────────────────────
// Shape: { facebook_page: { connected: true, page_name: '...', account: {...} }, ... }

function accountsToConnections(accounts = []) {
  const map = {};
  for (const acct of accounts) {
    if (acct.platform) {
      map[acct.platform] = {
        connected:    !!acct.is_connected,
        page_name:    acct.account_name,
        page_id:      acct.page_id,
        connected_at: acct.last_sync,
        demo:         false,
        account:      acct,  // full account record for expiry check
      };
    }
  }
  return map;
}

// ── Token expiry helper ────────────────────────────────────────────────────────

function tokenExpiryStatus(account) {
  if (!account?.expires_at) return null;
  const diff = new Date(account.expires_at) - Date.now();
  const days  = Math.floor(diff / 86400000);
  if (diff < 0)        return { level: 'expired', label: 'פג תוקף', color: 'text-red-500' };
  if (days < 3)        return { level: 'critical', label: `פג עוד ${days} ימים`, color: 'text-red-400' };
  if (days < 7)        return { level: 'warning',  label: `פג עוד ${days} ימים`, color: 'text-amber-400' };
  if (days < 30)       return { level: 'ok',       label: `תקף ${days} יום`,      color: 'text-emerald-500' };
  return null; // long-lived — don't show
}

// ── Social Platform Card ───────────────────────────────────────────────────────

function SocialPlatformCard({ platform, connection, account, onConnect, onDisconnect }) {
  const [loading, setLoading] = useState(false);
  const isConnected = connection?.connected;
  const expiry      = isConnected ? tokenExpiryStatus(account) : null;

  const handleConnect = async () => { setLoading(true); await onConnect(); setLoading(false); };
  const handleDisconnect = async () => { setLoading(true); await onDisconnect(); setLoading(false); };

  // WhatsApp uses Embedded Signup — show different UI
  if (platform.id === 'whatsapp_business') {
    return (
      <WhatsAppEmbeddedCard
        platform={platform}
        connection={connection}
        account={account}
        expiry={expiry}
        onDisconnect={handleDisconnect}
        loading={loading}
      />
    );
  }

  return (
    <div
      className="card-base p-4 flex items-center gap-4"
      style={{ borderLeft: `3px solid ${isConnected ? '#10b981' : platform.color}` }}
    >
      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
           style={{ background: platform.bg }}>
        {platform.icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-foreground">{platform.name}</span>
          {isConnected && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
              <CheckCircle className="w-3 h-3" /> מחובר
            </span>
          )}
          {expiry && (
            <span className={`flex items-center gap-1 text-[10px] font-medium ${expiry.color}`}>
              {expiry.level === 'expired'
                ? <AlertTriangle className="w-3 h-3" />
                : <Clock className="w-3 h-3" />}
              {expiry.label}
            </span>
          )}
        </div>
        <p className="text-[11px] text-foreground-muted">{platform.description}</p>
        {isConnected && connection.page_name && (
          <p className="text-[10px] text-foreground-muted opacity-70 mt-0.5">
            עמוד: {connection.page_name}
          </p>
        )}
        {expiry?.level === 'expired' && (
          <p className="text-[10px] text-red-500 mt-0.5 font-medium">
            יש לחבר מחדש כדי להמשיך לפרסם אוטומטית
          </p>
        )}
      </div>

      <div className="flex-shrink-0">
        {isConnected ? (
          <div className="flex flex-col gap-1.5 items-end">
            <button onClick={handleDisconnect} disabled={loading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 transition-all disabled:opacity-50">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
              נתק
            </button>
            {(expiry?.level === 'expired' || expiry?.level === 'critical') && (
              <button onClick={handleConnect} disabled={loading}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] text-white transition-all disabled:opacity-50"
                style={{ background: platform.color }}>
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                חדש טוקן
              </button>
            )}
          </div>
        ) : (
          <button onClick={handleConnect} disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] text-white transition-all disabled:opacity-50"
            style={{ background: platform.color }}>
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
            חבר
          </button>
        )}
      </div>
    </div>
  );
}

// ── WhatsApp Embedded Signup Card ──────────────────────────────────────────────

function WhatsAppEmbeddedCard({ platform, connection, account, expiry, onDisconnect, loading }) {
  const isConnected = connection?.connected;
  const [waBusy, setWaBusy]   = useState(false);

  const launchEmbeddedSignup = () => {
    // Meta Embedded Signup SDK — must be loaded separately via <script> in index.html
    if (!window.FB) {
      toast.error('Meta SDK לא נטען — נסה לרענן את הדף');
      return;
    }
    setWaBusy(true);
    window.FB.login(
      async (response) => {
        if (response.authResponse?.code) {
          // Post the code to our backend
          const SERVER_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3007/api').replace(/\/api\/?$/, '');
          try {
            const res = await fetch(`${SERVER_BASE}/api/meta/auth/whatsapp/embedded-signup`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code:             response.authResponse.code,
                waba_id:          response.authResponse.extra?.waba_id      || '',
                phone_number_id:  response.authResponse.extra?.phone_number_id || '',
                businessProfileId: account?.linked_business || '',
              }),
            });
            const data = await res.json();
            if (data.success) {
              toast.success('WhatsApp Business חובר בהצלחה ✓');
            } else {
              toast.error('שגיאה בחיבור WhatsApp: ' + (data.error || 'נסה שוב'));
            }
          } catch (e) {
            toast.error('שגיאת חיבור: ' + e.message);
          }
        } else {
          toast.info('חיבור WhatsApp בוטל');
        }
        setWaBusy(false);
      },
      {
        config_id: import.meta.env.VITE_META_CONFIG_ID || '',
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: 'whatsapp_embedded_signup' },
      },
    );
  };

  return (
    <div className="card-base p-4 flex items-center gap-4"
         style={{ borderLeft: `3px solid ${isConnected ? '#10b981' : platform.color}` }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
           style={{ background: platform.bg }}>
        {platform.icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-foreground">{platform.name}</span>
          {isConnected && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
              <CheckCircle className="w-3 h-3" /> מחובר
            </span>
          )}
          {expiry && (
            <span className={`flex items-center gap-1 text-[10px] font-medium ${expiry.color}`}>
              <Clock className="w-3 h-3" /> {expiry.label}
            </span>
          )}
        </div>
        <p className="text-[11px] text-foreground-muted">{platform.description}</p>
        {isConnected && connection.page_name && (
          <p className="text-[10px] text-foreground-muted opacity-70 mt-0.5">
            מספר: {connection.page_name}
          </p>
        )}
        {!isConnected && (
          <p className="text-[10px] text-blue-500 mt-0.5">
            דורש WhatsApp Business API — תהליך מהיר של 2 דקות
          </p>
        )}
      </div>

      <div className="flex-shrink-0 flex flex-col gap-1.5 items-end">
        {!isConnected ? (
          <button onClick={launchEmbeddedSignup} disabled={waBusy}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] text-white transition-all disabled:opacity-50"
            style={{ background: platform.color }}>
            {waBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
            חבר WhatsApp
          </button>
        ) : (
          <button onClick={onDisconnect} disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 transition-all disabled:opacity-50">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
            נתק
          </button>
        )}
      </div>
    </div>
  );
}

// ── OAuth connect flow — server-side state + PKCE ─────────────────────────────

// Derive server base from the same API URL used everywhere else in the app
const _apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3007/api';
const SERVER_BASE = _apiUrl.replace(/\/api\/?$/, '');

async function initiateOAuth(platformId, businessId) {
  const res = await fetch(`${SERVER_BASE}/api/oauth/initiate/${platformId}?businessId=${businessId}`);
  const data = await res.json();
  return data; // { url, state } or { error, demo }
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Integrations() {
  const { businessProfile } = useOutletContext();
  const bp = businessProfile;
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const highlightPlatform = searchParams.get('platform');
  const platformRefs = useRef({});

  // Auto-scroll to highlighted platform card when arriving from a link
  useEffect(() => {
    if (!highlightPlatform) return;
    const t = setTimeout(() => {
      platformRefs.current[highlightPlatform]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
    return () => clearTimeout(t);
  }, [highlightPlatform]);

  // Fetch SocialAccount records for this business
  const { data: socialAccounts = [] } = useQuery({
    queryKey: ['socialAccounts', bp?.id],
    queryFn:  () => base44.entities.SocialAccount.filter({ linked_business: bp.id }),
    enabled:  !!bp?.id,
  });

  const connections = accountsToConnections(socialAccounts);

  const saveField = async (partial) => {
    if (!bp?.id) return;
    await base44.entities.BusinessProfile.update(bp.id, partial);
    toast.success('נשמר ✓');
  };

  const connectSocial = async (platformId) => {
    try {
      const result = await initiateOAuth(platformId, bp?.id);

      // WhatsApp uses Embedded Signup — handled by the card itself
      if (result?.whatsapp_embedded_signup) return;

      if (result?.demo || result?.error) {
        // Server not configured — create a demo SocialAccount record
        toast.info(`חיבור ${platformId} — Demo Mode (הגדר OAuth credentials לחיבור אמיתי)`);
        await base44.entities.SocialAccount.create({
          linked_business: bp.id,
          platform: platformId,
          account_name: 'עמוד הדגמה',
          is_connected: true,
          last_sync: new Date().toISOString(),
        }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ['socialAccounts', bp?.id] });
        return;
      }

      if (!result?.url) {
        toast.error('שגיאה בפתיחת חלון חיבור');
        return;
      }

      // Open OAuth popup
      const popup = window.open(result.url, 'oauth', 'width=620,height=720,scrollbars=yes,resizable=yes');
      if (!popup) {
        toast.error('לא ניתן לפתוח חלון חיבור — אפשר חלונות קופצים בדפדפן');
        return;
      }

      // Listen for success/error message from popup
      const handler = async (event) => {
        if (event.data?.type === 'oauth_success') {
          window.removeEventListener('message', handler);
          toast.success('החיבור הצליח ✓');
          queryClient.invalidateQueries({ queryKey: ['socialAccounts', bp?.id] });
        } else if (event.data?.type === 'oauth_error') {
          window.removeEventListener('message', handler);
          toast.error(`שגיאה בחיבור: ${event.data.error}`);
        }
      };
      window.addEventListener('message', handler);

      // Clean up listener after 5 minutes
      setTimeout(() => window.removeEventListener('message', handler), 5 * 60 * 1000);
    } catch (err) {
      toast.error('שגיאה בתהליך החיבור');
      console.error('[connectSocial]', err);
    }
  };

  const disconnectSocial = async (platformId) => {
    try {
      await fetch(`${SERVER_BASE}/api/oauth/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: bp?.id, platform: platformId }),
      });
    } catch (_) {}
    queryClient.invalidateQueries({ queryKey: ['socialAccounts', bp?.id] });
    toast.success('החיבור נותק ✓');
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-[16px] font-bold text-foreground tracking-tight">אינטגרציות</h1>
        <p className="text-[12px] text-foreground-muted mt-0.5">חבר את Cortexi לרשתות החברתיות ול-CRM שלך</p>
      </div>

      <SyncStats bp={bp} socialAccounts={socialAccounts} />

      {/* Social Networks */}
      <div className="space-y-3">
        <h2 className="text-[13px] font-semibold text-foreground">רשתות חברתיות וגוגל</h2>
        <p className="text-[11px] text-foreground-muted">לחץ "חבר" — יפתח חלון אישור קצר, וזהו. לאחר מכן Cortexi פועל אוטומטית.</p>
        <div className="space-y-2">
          {SOCIAL_PLATFORMS.map(platform => (
            <div
              key={platform.id}
              ref={el => { platformRefs.current[platform.id] = el; }}
              className={highlightPlatform === platform.id ? 'ring-2 ring-primary/40 rounded-xl transition-all' : ''}
            >
              <SocialPlatformCard
                platform={platform}
                connection={connections[platform.id]}
                account={connections[platform.id]?.account}
                onConnect={() => connectSocial(platform.id)}
                onDisconnect={() => disconnectSocial(platform.id)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Paid Ads */}
      <div className="space-y-3">
        <h2 className="text-[13px] font-semibold text-foreground">פרסום בתשלום</h2>
        <p className="text-[11px] text-foreground-muted">חבר חשבון פרסום — הקמפיינים ייוצרו דרך Cortexi והחיוב עובר ישירות לחשבון שלך בפלטפורמה.</p>
        <div className="space-y-2">
          {ADS_PLATFORMS.map(platform => (
            <div key={platform.id}>
              <SocialPlatformCard
                platform={platform}
                connection={connections[platform.id]}
                account={connections[platform.id]?.account}
                onConnect={() => connectSocial(platform.id)}
                onDisconnect={() => disconnectSocial(platform.id)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* CRM */}
      <div className="space-y-3">
        <h2 className="text-[13px] font-semibold text-foreground">CRM ולידים</h2>
        <HubSpotConfig bp={bp} saveField={saveField} />
        <MondayConfig bp={bp} saveField={saveField} />
        <div className="card-base p-4 flex items-center gap-4 opacity-60">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl bg-blue-50 flex-shrink-0">🔵</div>
          <div className="flex-1">
            <span className="text-[13px] font-semibold text-foreground">Pipedrive</span>
            <p className="text-[11px] text-foreground-muted">בקרוב</p>
          </div>
        </div>
      </div>

      {/* Webhook */}
      <div className="space-y-3">
        <h2 className="text-[13px] font-semibold text-foreground">Webhook & Zapier</h2>
        <WebhookZapierConfig bp={bp} saveField={saveField} />
      </div>

      <SyncEventsConfig bp={bp} saveField={saveField} />

      {/* Website Tracking Snippet */}
      <div className="space-y-3">
        <h2 className="text-[13px] font-semibold text-foreground">מעקב אתר</h2>
        <div className="card-base p-4">
          <p className="text-[12px] text-foreground mb-2">
            הוסף את הקוד הבא לפני תג <code className="bg-secondary px-1 rounded text-[11px]">&lt;/head&gt;</code> באתר שלך כדי לעקוב אחרי מבקרים ואינטגרציות:
          </p>
          <div className="relative">
            <pre className="text-[10px] bg-secondary rounded-lg p-3 overflow-x-auto text-foreground-muted leading-relaxed" dir="ltr">{`<!-- Cortexi Tracking -->
<script>
(function(w,d,s,b){
  w._otx=w._otx||[];
  w._otx.push(['init','${bp?.id || 'YOUR_BUSINESS_ID'}']);
  var e=d.createElement(s);
  e.async=true;
  e.src='${SERVER_BASE}/track.js';
  d.head.appendChild(e);
})(window,document,'script','${SERVER_BASE}');
</script>`}</pre>
            <button
              onClick={() => {
                const snippet = `<!-- Cortexi Tracking -->\n<script>\n(function(w,d,s,b){\n  w._otx=w._otx||[];\n  w._otx.push(['init','${bp?.id || 'YOUR_BUSINESS_ID'}']);\n  var e=d.createElement(s);\n  e.async=true;\n  e.src='${SERVER_BASE}/track.js';\n  d.head.appendChild(e);\n})(window,document,'script','${SERVER_BASE}');\n</script>`;
                navigator.clipboard.writeText(snippet).then(() => toast.success('הועתק ללוח ✓'));
              }}
              className="absolute top-2 left-2 text-[10px] px-2 py-1 rounded bg-foreground text-background hover:opacity-90 transition-all"
            >
              העתק
            </button>
          </div>
          <p className="text-[10px] text-foreground-muted mt-2 opacity-70">
            הסניפט אוסף מבקרים ייחודיים, מקורות תנועה ואינטגרציות עם Cortexi בצורה אנונימית ומאובטחת.
          </p>
        </div>
      </div>
    </div>
  );
}
