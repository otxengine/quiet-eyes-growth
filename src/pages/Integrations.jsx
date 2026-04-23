import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { CheckCircle, ExternalLink, Loader2, X } from 'lucide-react';
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
    description: 'פרסם פוסטים ישירות מהמערכת',
    scope: 'pages_manage_posts,pages_read_engagement',
  },
  {
    id: 'instagram_business',
    name: 'Instagram',
    icon: '📷',
    color: '#E1306C',
    bg: '#FEF0F5',
    description: 'שתף תמונות וסטוריז',
    scope: 'instagram_basic,instagram_content_publish',
  },
  {
    id: 'tiktok_business',
    name: 'TikTok',
    icon: '🎵',
    color: '#010101',
    bg: '#F0F0F0',
    description: 'פרסם סרטונים ותוכן',
    scope: 'video.upload,video.publish',
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
// Shape: { facebook_page: { connected: true, page_name: '...', ... }, ... }

function accountsToConnections(accounts = []) {
  const map = {};
  for (const acct of accounts) {
    if (acct.platform) {
      map[acct.platform] = {
        connected: !!acct.is_connected,
        page_name: acct.account_name,
        page_id:   acct.page_id,
        connected_at: acct.last_sync,
        demo: false,
      };
    }
  }
  return map;
}

// ── Social Platform Card ───────────────────────────────────────────────────────

function SocialPlatformCard({ platform, connection, onConnect, onDisconnect }) {
  const [loading, setLoading] = useState(false);
  const isConnected = connection?.connected;

  const handleConnect = async () => {
    setLoading(true);
    await onConnect();
    setLoading(false);
  };

  const handleDisconnect = async () => {
    setLoading(true);
    await onDisconnect();
    setLoading(false);
  };

  return (
    <div
      className="card-base p-4 flex items-center gap-4"
      style={{ borderLeft: `3px solid ${isConnected ? '#10b981' : platform.color}` }}
    >
      {/* Icon */}
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
        style={{ background: platform.bg }}
      >
        {platform.icon}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-foreground">{platform.name}</span>
          {isConnected && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
              <CheckCircle className="w-3 h-3" /> מחובר
            </span>
          )}
        </div>
        <p className="text-[11px] text-foreground-muted">{platform.description}</p>
        {isConnected && connection.page_name && (
          <p className="text-[10px] text-foreground-muted opacity-70 mt-0.5">
            עמוד: {connection.page_name}
          </p>
        )}
      </div>

      {/* Action */}
      <div className="flex-shrink-0">
        {isConnected ? (
          <button
            onClick={handleDisconnect}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 transition-all disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
            נתק
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] text-white transition-all disabled:opacity-50"
            style={{ background: platform.color }}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
            חבר
          </button>
        )}
      </div>
    </div>
  );
}

// ── OAuth connect flow — server-side state + PKCE ─────────────────────────────

const SERVER_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3002';

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
        <p className="text-[12px] text-foreground-muted mt-0.5">חבר את OTX לרשתות החברתיות ול-CRM שלך</p>
      </div>

      <SyncStats bp={bp} />

      {/* Social Networks */}
      <div className="space-y-3">
        <h2 className="text-[13px] font-semibold text-foreground">רשתות חברתיות</h2>
        <p className="text-[11px] text-foreground-muted">לאחר החיבור, תוכל לפרסם פוסטים ישירות מ-ActionPopup</p>
        <div className="space-y-2">
          {SOCIAL_PLATFORMS.map(platform => (
            <SocialPlatformCard
              key={platform.id}
              platform={platform}
              connection={connections[platform.id]}
              onConnect={() => connectSocial(platform.id)}
              onDisconnect={() => disconnectSocial(platform.id)}
            />
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
            <pre className="text-[10px] bg-secondary rounded-lg p-3 overflow-x-auto text-foreground-muted leading-relaxed" dir="ltr">{`<!-- OTX Tracking -->
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
                const snippet = `<!-- OTX Tracking -->\n<script>\n(function(w,d,s,b){\n  w._otx=w._otx||[];\n  w._otx.push(['init','${bp?.id || 'YOUR_BUSINESS_ID'}']);\n  var e=d.createElement(s);\n  e.async=true;\n  e.src='${SERVER_BASE}/track.js';\n  d.head.appendChild(e);\n})(window,document,'script','${SERVER_BASE}');\n</script>`;
                navigator.clipboard.writeText(snippet).then(() => toast.success('הועתק ללוח ✓'));
              }}
              className="absolute top-2 left-2 text-[10px] px-2 py-1 rounded bg-foreground text-background hover:opacity-90 transition-all"
            >
              העתק
            </button>
          </div>
          <p className="text-[10px] text-foreground-muted mt-2 opacity-70">
            הסניפט אוסף מבקרים ייחודיים, מקורות תנועה ואינטגרציות עם OTX בצורה אנונימית ומאובטחת.
          </p>
        </div>
      </div>
    </div>
  );
}
