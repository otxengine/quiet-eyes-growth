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

function SocialPlatformCard({ platform, connection, account, bpId, onConnect, onDisconnect }) {
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
        bpId={bpId}
        expiry={expiry}
        onDisconnect={handleDisconnect}
        onConnected={onConnect}
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

function WhatsAppEmbeddedCard({ platform, connection, account, bpId, expiry, onDisconnect, onConnected, loading }) {
  const isConnected = connection?.connected;
  const [waBusy, setWaBusy] = useState(false);

  const launchEmbeddedSignup = () => {
    if (!window.FB) {
      toast.error('Meta SDK לא נטען — נסה לרענן את הדף');
      return;
    }

    // Meta sends waba_id / phone_number_id via window message event (not in authResponse)
    const sessionData = { waba_id: '', phone_number_id: '' };
    const onMessage = (event) => {
      if (event.origin !== 'https://www.facebook.com') return;
      try {
        const d = JSON.parse(event.data);
        if (d.type === 'WA_EMBEDDED_SIGNUP') {
          sessionData.waba_id        = d.data?.waba_id        || '';
          sessionData.phone_number_id = d.data?.phone_number_id || '';
        }
      } catch {}
    };
    window.addEventListener('message', onMessage);

    setWaBusy(true);
    window.FB.login(
      (response) => {
        window.removeEventListener('message', onMessage);
        const token = response.authResponse?.accessToken;
        if (token) {
          const SERVER_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/api\/?$/, '');
          const code = token;
          (async () => {
            try {
              const res = await fetch(`${SERVER_BASE}/api/meta/auth/whatsapp/embedded-signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  code,
                  waba_id:           sessionData.waba_id,
                  phone_number_id:   sessionData.phone_number_id,
                  businessProfileId: bpId || account?.linked_business || '',
                }),
              });
              const data = await res.json();
              if (data.success) {
                toast.success('WhatsApp Business חובר בהצלחה ✓');
                if (onConnected) onConnected();
              } else {
                const detail = data.detail?.error?.message || data.detail?.error_description || '';
                toast.error('שגיאה בחיבור WhatsApp: ' + (data.error || 'נסה שוב') + (detail ? ` — ${detail}` : ''));
              }
            } catch (e) {
              toast.error('שגיאת חיבור: ' + e.message);
            } finally {
              setWaBusy(false);
            }
          })();
        } else {
          toast.info('חיבור WhatsApp בוטל');
          setWaBusy(false);
        }
      },
      {
        config_id:                      import.meta.env.VITE_META_CONFIG_ID || '',
        response_type:                  'token',
        override_default_response_type: true,
        extras: { setup: {}, featureType: 'whatsapp_embedded_signup', sessionInfoVersion: '2' },
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
      if (result?.whatsapp_embedded_signup) {
        queryClient.invalidateQueries({ queryKey: ['socialAccounts', bp?.id] });
        return;
      }

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

  // Compute stats
  const allPlatforms = [...SOCIAL_PLATFORMS, ...ADS_PLATFORMS];
  const connectedCount = allPlatforms.filter(p => connections[p.id]?.connected).length;
  const notConnectedCount = allPlatforms.filter(p => !connections[p.id]?.connected).length;
  const needsActionCount = allPlatforms.filter(p => {
    const conn = connections[p.id];
    if (!conn?.connected) return false;
    const exp = conn.token_expires_at ? new Date(conn.token_expires_at) : null;
    return exp && exp.getTime() - Date.now() < 7 * 86400000;
  }).length;
  const totalPlatforms = allPlatforms.length;
  const connectedPct = totalPlatforms > 0 ? Math.round((connectedCount / totalPlatforms) * 100) : 0;

  const [intSearch, setIntSearch] = useState('');
  const [infoModalPlatform, setInfoModalPlatform] = useState(null);

  const allIntegrationCards = [
    ...SOCIAL_PLATFORMS,
    ...ADS_PLATFORMS,
    { id: 'hubspot', name: 'HubSpot CRM', icon: '🟠', color: '#FF7A59', bg: '#FFF4F1', description: 'ייבא לידים אוטומטית ל-HubSpot CRM שלך.' },
    { id: 'monday', name: 'Monday.com', icon: '📋', color: '#FF3750', bg: '#FFF0F2', description: 'סנכרן משימות ולידים עם Monday.com.' },
    { id: 'pipedrive', name: 'Pipedrive', icon: '🔵', color: '#036', bg: '#E8EEF8', description: 'חבר Pipedrive לניהול ה-Pipeline שלך.', soon: true },
    { id: 'zapier', name: 'Zapier / Webhook', icon: '⚡', color: '#FF4A00', bg: '#FFF3EE', description: 'חבר Cortexi לאלפי כלים דרך Zapier.' },
    { id: 'google_business', name: 'Google Business Profile', icon: 'G', color: '#4285F4', bg: '#EBF3FF', description: 'חבר את פרופיל העסק בגוגל לקבלת ביקורות, דירוגים, ופניות מלקוחות.' },
    { id: 'whatsapp_business', name: 'WhatsApp Business', icon: '💬', color: '#25D366', bg: '#F0FDF4', description: 'חבר את WhatsApp Business כדי לרכז הודעות לקוחות ופניות במערכת.' },
    { id: 'facebook_pages', name: 'Facebook Pages', icon: 'f', color: '#1877F2', bg: '#EBF3FF', description: 'חבר את דף הפייסבוק העסקי שלכם לניהול פניות, תגובות ולידים.' },
  ];

  const filteredIntegrations = allIntegrationCards.filter(p =>
    !intSearch || p.name.toLowerCase().includes(intSearch.toLowerCase()) || p.description.includes(intSearch)
  );

  // Donut SVG for progress circle
  const r = 28, circ = 2 * Math.PI * r;
  const dash = (connectedPct / 100) * circ;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div />
        <div className="text-right">
          <h1 className="text-[22px] font-bold text-foreground">תוספים (אינטגרציות)</h1>
          <p className="text-[12px] text-foreground-muted mt-0.5">חברו את ערוצי השיווק, הפרסום והתקשורת שלכם למערכת כדי לקבל תובנות יותר ולנהל את העסק ממקום אחד.</p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-blue-50 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-2xl font-bold text-blue-600">{connectedCount}</span>
          <span className="text-[11px] font-semibold text-blue-700">אינטגרציות פעילות</span>
          <span className="text-[10px] text-blue-500 mt-0.5">מחוברות</span>
          <button className="mt-2 text-[11px] font-semibold text-blue-600 bg-white border border-blue-200 rounded-full px-3 py-1 w-fit hover:bg-blue-100 transition-colors">הצג הכל</button>
        </div>
        <div className="bg-orange-50 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-2xl font-bold text-orange-500">{notConnectedCount}</span>
          <span className="text-[11px] font-semibold text-orange-700">אינטגרציות זמינות</span>
          <span className="text-[10px] text-orange-500 mt-0.5">לא מחוברות</span>
          <button className="mt-2 text-[11px] font-semibold text-orange-600 bg-white border border-orange-200 rounded-full px-3 py-1 w-fit hover:bg-orange-100 transition-colors">הצג הכל</button>
        </div>
        <div className="bg-red-50 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-2xl font-bold text-[#e8344d]">{needsActionCount}</span>
          <span className="text-[11px] font-semibold text-red-700">חיבור דורש עדכון</span>
          <span className="text-[10px] text-red-500 mt-0.5">דורשת פעולה</span>
          <button className="mt-2 text-[11px] font-semibold text-[#e8344d] bg-white border border-red-200 rounded-full px-3 py-1 w-fit hover:bg-red-50 transition-colors">הצג הכל</button>
        </div>
        <div className="bg-white rounded-xl p-4 flex items-center gap-4 border border-gray-100">
          <div className="flex-1 text-right">
            <p className="text-[13px] font-bold text-gray-800">סטטוס אינטגרציות</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{connectedCount} מתוך {totalPlatforms} אינטגרציות מחוברות</p>
          </div>
          <svg width="72" height="72" viewBox="0 0 72 72" className="flex-shrink-0">
            <circle cx="36" cy="36" r={r} fill="none" stroke="#f0f0f0" strokeWidth="9" />
            <circle cx="36" cy="36" r={r} fill="none" stroke="#10b981" strokeWidth="9"
              strokeDasharray={`${dash} ${circ - dash}`}
              style={{ transform: 'rotate(-90deg)', transformOrigin: '36px 36px' }}
            />
            <text x="36" y="41" textAnchor="middle" fontSize="13" fontWeight="700" fill="#111">{connectedPct}%</text>
          </svg>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-1.5">
          <span className="text-gray-400 text-[12px]">🔍</span>
          <input
            value={intSearch}
            onChange={e => setIntSearch(e.target.value)}
            placeholder="חיפוש"
            className="text-[12px] bg-transparent outline-none text-gray-600 w-28 text-right"
          />
        </div>
        <button className="text-[12px] font-medium text-gray-600 bg-white border border-gray-200 rounded-full px-3 py-1.5 hover:border-gray-300 transition-colors flex items-center gap-1">
          כל האינטגרציות <span className="text-[10px]">▾</span>
        </button>
        <button className="text-[12px] font-medium text-gray-600 bg-white border border-gray-200 rounded-full px-3 py-1.5 hover:border-gray-300 transition-colors flex items-center gap-1">
          כל הסטטוסים <span className="text-[10px]">▾</span>
        </button>
        {intSearch && (
          <button onClick={() => setIntSearch('')} className="text-[11px] text-gray-400 hover:text-gray-600 px-2 py-1.5">
            נקה פילטרים
          </button>
        )}
      </div>

      {/* Integration cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredIntegrations.map(platform => {
          const conn = connections[platform.id];
          const isConnected = !!conn?.connected;
          const isSoon = !!platform.soon;
          const iconIsEmoji = platform.icon && platform.icon.length > 1;
          return (
            <div
              key={platform.id}
              ref={el => { platformRefs.current[platform.id] = el; }}
              className={`bg-white rounded-xl border border-gray-100 p-4 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow ${
                highlightPlatform === platform.id ? 'ring-2 ring-blue-300' : ''
              } ${isSoon ? 'opacity-60' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold flex-shrink-0"
                  style={{ background: platform.bg, color: platform.color }}
                >
                  {iconIsEmoji ? platform.icon : <span style={{ fontSize: 16, fontWeight: 800 }}>{platform.icon}</span>}
                </div>
                <div className="flex-1 min-w-0 text-right">
                  <div className="flex items-center gap-2 justify-end">
                    <span className="text-[13px] font-bold text-gray-900 truncate">{platform.name}</span>
                    {isConnected && <span className="text-[9px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full font-semibold">מחובר</span>}
                    {isSoon && <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">בקרוב</span>}
                  </div>
                  <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-2">{platform.description}</p>
                </div>
              </div>
              <div className="flex justify-end">
                {isSoon ? (
                  <button disabled className="text-[11px] font-semibold px-3 py-1.5 rounded-full border border-gray-200 text-gray-400 cursor-not-allowed">
                    בקרוב
                  </button>
                ) : isConnected ? (
                  <button
                    onClick={() => disconnectSocial(platform.id)}
                    className="text-[11px] font-semibold px-3 py-1.5 rounded-full border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                  >
                    נתק
                  </button>
                ) : (
                  <button
                    onClick={() => platform.id === 'google_business' ? setInfoModalPlatform(platform.id) : connectSocial(platform.id)}
                    className="text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors"
                    style={{ borderColor: '#e8344d', color: '#e8344d', background: '#fce4ec' }}
                  >
                    מידע והתחברות
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Google Business Profile info modal */}
      {infoModalPlatform === 'google_business' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setInfoModalPlatform(null)}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-[560px] mx-4 overflow-hidden"
            dir="rtl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setInfoModalPlatform(null); connectSocial('google_business'); }}
                  className="px-5 py-2 rounded-full text-white text-[13px] font-semibold"
                  style={{ background: '#e8344d' }}
                >
                  להתחברות
                </button>
                <button onClick={() => setInfoModalPlatform(null)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div>
                  <h2 className="text-[16px] font-bold text-gray-900 text-right">Google Business Profile</h2>
                  <span className="text-[11px] text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">קיים מסלול חינמי</span>
                </div>
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-[18px] font-bold text-blue-600 flex-shrink-0">G</div>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
              <div>
                <h3 className="text-[14px] font-bold text-gray-900 mb-2">?למה Google Business Profile</h3>
                <p className="text-[13px] text-gray-600 leading-relaxed">
                  הפרופיל העסקי שלכם בגוגל הוא המקום הראשון שלקוחות פוגשים את העסק — עוד לפני שהם נכנסים לאתר שלכם. שם הם רואים את הדירוג, קוראים ביקורות, בודקים שעות פעילות ומחליטים אם להשריך אליכם או למתחרים. חיבור הפרופיל למערכת מאפשר לרכז את המידע הכי חשוב על העסק ולהבין יותר טוב איך נראים בזמן ובעיניי הלקוחות.
                </p>
              </div>
              <div>
                <h3 className="text-[14px] font-bold text-gray-900 mb-2">?למה לחבר את Google Business Profile למערכת</h3>
                <p className="text-[13px] text-gray-600 leading-relaxed">
                  לאחר החיבור הראשוני, המערכת תסנכרן לנו נתוני פרופיל הראשוני שלכם, כולל דירוגים, ביקורות ונתוני פעילות רלוונטיים. כן תוכל לקבל התראה בירידה חדשה, לזהות מגמות ולגלות הזדמנויות יותר ביתר מקצועיות בלי מעמד ידני. המערכת מאמפקרציה לייעל לפעולה, להמליץ תובנות מדויקות ולייעץ לכם לשמור על נוכחות חיובית בגוגל.
                </p>
              </div>

              {/* Bottom benefit cards */}
              <div className="grid grid-cols-3 gap-3 pt-1">
                {[
                  { icon: 'G', color: '#4285F4', bg: '#EBF3FF', text: 'חברו את הדף עסק שלכם ב-Google כדי לקבל ביקורות, דירוגים ופניות מלקוחות.' },
                  { icon: '💬', color: '#25D366', bg: '#F0FDF4', text: 'חברו את WhatsApp Business כדי לרכז הודעות לקוחות ופניות במערכת.' },
                  { icon: 'f', color: '#1877F2', bg: '#EBF3FF', text: 'חברו את הפייסבוק העסקי שלכם לניהול פניות, תגובות ולידים.' },
                ].map((b, i) => (
                  <div key={i} className="rounded-xl p-3 text-right" style={{ background: b.bg }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2 text-[14px] font-bold" style={{ background: '#fff', color: b.color }}>
                      {b.icon}
                    </div>
                    <p className="text-[10px] text-gray-600 leading-relaxed">{b.text}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex justify-start">
              <button
                onClick={() => { setInfoModalPlatform(null); connectSocial('google_business'); }}
                className="w-full py-3 rounded-xl text-white text-[14px] font-bold hover:opacity-90 transition-opacity"
                style={{ background: '#e8344d' }}
              >
                להתחברות
              </button>
            </div>
          </div>
        </div>
      )}

      <SyncStats bp={bp} socialAccounts={socialAccounts} />
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
