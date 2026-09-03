import React, { useState, useEffect } from 'react';
import { useOutletContext, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Plus, Loader2, ChevronDown, Search, MoreVertical, Radio, Sparkles, Send, ExternalLink, X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import StatCards from '@/components/shared/StatCards';
import UrgentActionsSection from '@/components/shared/UrgentActionsSection';
import AudienceInsights from '@/components/audience/AudienceInsights';
import AudienceSegments from '@/components/audience/AudienceSegments';
const PLATFORM_CONFIG = {
  meta:      { label: 'Facebook',   icon: '📘', color: '#1877f2', bg: '#e7f3ff' },
  instagram: { label: 'Instagram',  icon: '📸', color: '#e1306c', bg: '#fde8f0' },
  google:    { label: 'Google Ads', icon: '🔍', color: '#4285f4', bg: '#e8f0fe' },
  facebook:  { label: 'Facebook',   icon: '📘', color: '#1877f2', bg: '#e7f3ff' },
  whatsapp:  { label: 'WhatsApp Ads', icon: '💬', color: '#25d366', bg: '#f0fdf4' },
};

const STATUS_CONFIG = {
  draft:          { label: 'טיוטה',        cls: 'bg-gray-100 text-gray-500',   tab: 'drafts' },
  pending_launch: { label: 'ממתין לפרסום', cls: 'bg-amber-50 text-amber-700',  tab: 'paused' },
  published:      { label: 'פורסם',        cls: 'bg-blue-50 text-blue-700',    tab: 'active' },
  active:         { label: 'פעיל',         cls: 'bg-green-50 text-green-700',  tab: 'active' },
  completed:      { label: 'הסתיים',       cls: 'bg-purple-50 text-purple-700', tab: 'completed' },
  paused:         { label: 'בהשהיה',       cls: 'bg-orange-50 text-orange-700', tab: 'paused' },
};

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

function fmtNum(n) {
  if (n == null || n === 0) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000)    return `${(n / 1000).toFixed(0)}K`;
  return String(Math.round(n));
}

// ── Paid Campaign Card ────────────────────────────────────────────────────────

const _apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:3007/api').replace(/\/$/, '');

function PublishGoogleAdsButton({ campaign, bpId, onPublished }) {
  const [loading, setLoading] = useState(false);

  const handlePublish = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${_apiBase}/campaigns/publish-google-ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: campaign.id, businessId: bpId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('הקמפיין פורסם בגוגל ✓ — מצב: מושהה (Paused)');
        onPublished?.();
      } else {
        toast.error('שגיאה: ' + (data.error || 'נסה שוב'));
      }
    } catch (e) {
      toast.error('שגיאת חיבור: ' + e.message);
    }
    setLoading(false);
  };

  return (
    <button
      onClick={handlePublish}
      disabled={loading}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white bg-blue-500 hover:bg-blue-600 transition-all disabled:opacity-50"
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
      פרסם בגוגל
    </button>
  );
}

function PublishMetaAdsButton({ campaign, bpId, onPublished }) {
  const [loading, setLoading] = useState(false);

  const handlePublish = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${_apiBase}/campaigns/publish-meta-ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: campaign.id, businessId: bpId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('הקמפיין פורסם ב-Meta ✓ — מצב: מושהה (Paused)');
        onPublished?.();
      } else {
        toast.error('שגיאה: ' + (data.error || 'נסה שוב'));
      }
    } catch (e) {
      toast.error('שגיאת חיבור: ' + e.message);
    }
    setLoading(false);
  };

  const platformLabel = campaign.platform === 'instagram'
    ? 'אינסטגרם'
    : campaign.platform === 'whatsapp'
    ? 'WhatsApp'
    : 'פייסבוק';

  return (
    <button
      onClick={handlePublish}
      disabled={loading}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 transition-all disabled:opacity-50"
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
      פרסם ב{platformLabel}
    </button>
  );
}

function CampaignCard({ campaign, onDelete, bpId, onPublished }) {
  const navigate = useNavigate();
  const plat   = PLATFORM_CONFIG[campaign.platform] || { label: campaign.platform, icon: '📣', color: '#555', bg: '#f5f5f5' };
  const status = STATUS_CONFIG[campaign.status] || STATUS_CONFIG.draft;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-sm transition-all">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: plat.bg, color: plat.color }}>
          {plat.icon} {plat.label}
        </span>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full mr-auto ${status.cls}`}>{status.label}</span>
      </div>
      <div className="px-4 py-3">
        <h3 className="text-[13px] font-semibold text-foreground mb-1 truncate">{campaign.title}</h3>
        {campaign.post_content && (
          <p className="text-[11px] text-foreground-muted line-clamp-2 mb-3">{campaign.post_content}</p>
        )}
        <div className="flex items-center gap-4 py-2 border-t border-border/50 text-[10px] text-foreground-muted">
          {campaign.daily_budget_ils != null && <span>₪{campaign.daily_budget_ils}/יום</span>}
          {campaign.est_reach_low != null && <span>{fmtNum(campaign.est_reach_low)}–{fmtNum(campaign.est_reach_high)} הגעה</span>}
          <span className="mr-auto">{fmtDate(campaign.published_at || campaign.created_date)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 px-4 py-2 border-t border-border bg-secondary/30">
        <button onClick={() => navigate(`/marketing/create?campaignId=${campaign.id}`)} className="text-[11px] text-foreground-muted hover:text-foreground transition-colors">✏️ ערוך</button>
        {campaign.status === 'pending_launch' && campaign.platform === 'google' && (
          <div className="flex items-center gap-2">
            <PublishGoogleAdsButton campaign={campaign} bpId={bpId} onPublished={onPublished} />
            <a
              href="https://ads.google.com/aw/campaigns"
              target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-800 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              פתח Ads Manager
            </a>
          </div>
        )}
        {campaign.status === 'pending_launch' && ['facebook', 'instagram', 'whatsapp'].includes(campaign.platform) && (
          <div className="flex items-center gap-2">
            <PublishMetaAdsButton campaign={campaign} bpId={bpId} onPublished={onPublished} />
            <a
              href="https://adsmanager.facebook.com/adsmanager/manage/campaigns"
              target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-800 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              פתח Ads Manager
            </a>
          </div>
        )}
        {campaign.status === 'active' && ['facebook', 'instagram', 'whatsapp'].includes(campaign.platform) && (
          <div className="flex items-center gap-2">
            {campaign.external_campaign_id && (
              <a
                href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${campaign.external_campaign_id}`}
                target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                פתח ב-Meta
              </a>
            )}
            <a
              href="https://adsmanager.facebook.com/adsmanager/manage/campaigns"
              target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-800 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              פתח Ads Manager
            </a>
          </div>
        )}
        {campaign.status === 'active' && campaign.platform === 'google' && (
          <div className="flex items-center gap-2">
            {campaign.external_campaign_id && (
              <a
                href={`https://ads.google.com/aw/campaigns?campaignId=${campaign.external_campaign_id}`}
                target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                פתח בגוגל
              </a>
            )}
            <a
              href="https://ads.google.com/aw/campaigns"
              target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-800 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              פתח Ads Manager
            </a>
          </div>
        )}
        <button onClick={() => onDelete(campaign.id)} className="text-[11px] text-foreground-muted hover:text-red-500 mr-auto transition-colors">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── WhatsApp Blast Drawer ─────────────────────────────────────────────────────

function WhatsAppBlastDrawer({ businessProfile, signalContext, audienceData, onClose }) {
  const [msg,     setMsg]     = useState('');
  const [loading, setLoading] = useState(false);
  const [copied,  setCopied]  = useState(false);

  useEffect(() => {
    generateMessage();
  }, []); // eslint-disable-line

  async function generateMessage() {
    setLoading(true);
    const fallback = `שלום! 😊\nיש לנו חדשות מיוחדות ב-${businessProfile?.name || 'העסק שלנו'}!\nמוזמנ/ת לבקר — מחכים לך! 🙌`;
    try {
      const pa = audienceData?.primary_audience;
      const audienceHint = pa
        ? `קהל: גיל ${pa.age_range}, ${pa.gender_skew}. כאבים: ${(pa.pain_points || []).slice(0, 2).join(', ')}.`
        : '';
      const result = await base44.integrations.Core.InvokeLLM({
        model: 'sonnet',
        maxTokens: 300,
        prompt: `אתה כותב הודעות WhatsApp שיווקיות לעסקים ישראלים. ההודעה חייבת להיות ברמה גבוהה — אנושית, ממוקדת, ומניעה לפעולה.

עסק: "${businessProfile?.name || ''}" | תחום: ${businessProfile?.category || ''} | עיר: ${businessProfile?.city || ''}
${signalContext?.summary ? `הקשר / הזדמנות: "${signalContext.summary}"` : ''}
${audienceHint ? `${audienceHint}` : ''}

כתוב הודעת WhatsApp בלסט (הפצה המונית ללקוחות):
- שורה 1: פתיחה חמה / קריאה לתשומת לב עם אמוג'י
- שורה 2-3: הצעת ערך ספציפית — מה מקבלים / למה עכשיו
- שורה 4: CTA ברור וישיר (להזמין / לכתוב / לבקר)
- סה"כ: 3-4 שורות קצרות, עברית ידידותית, בגוף ראשון מטעם העסק
כתוב רק את ההודעה הסופית — ללא כותרות, ללא הסברים.`,
      });
      setMsg((typeof result === 'string' && result.trim()) ? result.trim() : fallback);
    } catch {
      setMsg(fallback);
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-t-2xl w-full max-w-lg shadow-2xl" dir="rtl" style={{ maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-2xl">💬</span>
            <div>
              <p className="text-[14px] font-bold text-gray-800">WhatsApp Blast</p>
              <p className="text-[11px] text-gray-400">שלח הודעה שיווקית ללקוחות</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {signalContext?.summary && (
            <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-2.5">
              <p className="text-[11px] font-semibold text-green-700 mb-0.5">הקשר:</p>
              <p className="text-[12px] text-green-900">{signalContext.summary}</p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[12px] font-semibold text-gray-700">הודעה:</p>
              <button onClick={generateMessage} disabled={loading}
                className="flex items-center gap-1.5 px-2.5 py-1 border border-gray-200 text-gray-500 rounded-lg text-[11px] hover:bg-gray-50 disabled:opacity-50">
                <Sparkles className="w-3 h-3" />
                {loading ? 'יוצר...' : 'צור מחדש'}
              </button>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-10 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400 ml-2" />
                <span className="text-[12px] text-gray-400">יוצר הודעה...</span>
              </div>
            ) : (
              <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={5} dir="rtl"
                className="w-full px-3 py-2.5 text-[13px] border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-green-200"
                placeholder="הודעת WhatsApp..." />
            )}
            <p className="text-[10px] text-gray-400 mt-1">{msg.length} / 4096 תווים</p>
          </div>

          <div className="space-y-2.5">
            <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`}
              target="_blank" rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#25D366] text-white rounded-xl text-[14px] font-bold hover:bg-[#1fb855] transition-all">
              💬 פתח WhatsApp ושלח
            </a>
            <button onClick={async () => {
              await navigator.clipboard.writeText(msg).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-[13px] hover:bg-gray-50 transition-all">
              {copied ? '✓ הועתק' : '📋 העתק הודעה'}
            </button>
          </div>

          <p className="text-[11px] text-gray-400 text-center">
            WhatsApp Blast עובד דרך הפתחת WhatsApp Web — העתק את ההודעה ושלח ישירות.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── CampaignRow — table row with platform icon + toggle ───────────────────────

function ToggleSwitch({ active, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-10 h-5.5 rounded-full transition-colors flex-shrink-0 ${active ? 'bg-green-500' : 'bg-gray-300'}`}
      style={{ height: '22px', width: '40px' }}
    >
      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${active ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function CampaignRow({ campaign, onDelete, bpId, onToggle }) {
  const navigate = useNavigate();
  const plat = PLATFORM_CONFIG[campaign.platform] || { label: campaign.platform, icon: '📣', color: '#555' };
  const isActive = ['active', 'published'].includes(campaign.status);
  const leads = campaign.conversions || campaign.clicks || 0;
  const convRate = campaign.clicks > 0 && campaign.conversions
    ? ((campaign.conversions / campaign.clicks) * 100).toFixed(1) + '%'
    : '—';

  return (
    <div
      dir="rtl"
      onClick={() => navigate(`/marketing/create?campaignId=${campaign.id}`)}
      className="flex items-center gap-3 px-4 py-3 border-b border-border/40 last:border-0 hover:bg-gray-50/60 transition-colors cursor-pointer"
    >
      <span className="flex-1 text-[12px] font-medium text-foreground truncate min-w-0">
        {campaign.title}
      </span>
      <span className="text-[20px] w-8 flex-shrink-0 text-center" title={plat.label}>{plat.icon}</span>
      <span className="text-[12px] font-semibold text-foreground w-12 flex-shrink-0 text-center">{leads}</span>
      <span className="text-[11px] text-foreground-muted w-16 flex-shrink-0 text-center">{convRate}</span>
      <div className="w-40 flex-shrink-0 text-right">
        {campaign.daily_budget_ils != null && (
          <p className="text-[11px] text-foreground">₪{campaign.daily_budget_ils}, יומי</p>
        )}
        {campaign.created_date && (
          <p className="text-[10px] text-foreground-muted">
            מתחיל ב-{new Date(campaign.created_date).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })}
          </p>
        )}
      </div>
      <div className="w-12 flex-shrink-0 flex justify-center" onClick={(e) => e.stopPropagation()}>
        <ToggleSwitch active={isActive} onToggle={() => onToggle(campaign)} />
      </div>
      <button onClick={(e) => { e.stopPropagation(); if (window.confirm('למחוק קמפיין?')) onDelete(campaign.id); }}
        className="text-foreground-muted hover:text-foreground flex-shrink-0">
        <MoreVertical className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Main Marketing Page ───────────────────────────────────────────────────────

const STATUS_FILTER_TABS = [
  { key: 'active',         label: 'קמפיינים פעילים',    match: ['active', 'published'] },
  { key: 'paused',         label: 'קמפיינים בהשהיה',    match: ['paused', 'pending_launch'] },
  { key: 'drafts',         label: 'טיוטות',              match: ['draft'] },
  { key: 'completed',      label: 'הסתיימו',             match: ['completed'] },
];




export default function Marketing() {
  const { businessProfile } = useOutletContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const bpId = businessProfile?.id;
  const [showWaBlast,     setShowWaBlast]     = useState(false);
  const [waBlastCtx,      setWaBlastCtx]      = useState(null);
  const [statusFilter,    setStatusFilter]    = useState('active');
  const [campaignSearch,  setCampaignSearch]  = useState('');

  // Auto-open WhatsApp blast drawer if URL says so
  useEffect(() => {
    if (searchParams.get('create') === 'whatsapp') {
      setWaBlastCtx({
        signalId: searchParams.get('signalId') || '',
        summary:  searchParams.get('summary')  || '',
      });
      setShowWaBlast(true);
    }
  }, []); // eslint-disable-line

  // ── Paid campaigns ──
  const { data: campaigns = [], isLoading: loadingPaid } = useQuery({
    queryKey: ['campaigns', bpId],
    queryFn: () => base44.entities.Campaign.filter({ linked_business: bpId }, '-created_date', 50),
    enabled: !!bpId,
  });

  const deleteCampaign = useMutation({
    mutationFn: (id) => base44.entities.Campaign.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaigns', bpId] }); toast.success('נמחק'); },
  });

  const filteredCampaigns = campaigns.filter(c => {
    const tab = STATUS_FILTER_TABS.find(t => t.key === statusFilter);
    const matchesStatus = tab ? tab.match.includes(c.status) : true;
    const matchesSearch = !campaignSearch || (c.title || '').toLowerCase().includes(campaignSearch.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  // ── Stats ──
  const totalLeads = campaigns.reduce((s, c) => s + (c.conversions || c.leads_count || 0), 0);
  const activeLeads = campaigns.filter(c => ['active', 'published'].includes(c.status)).reduce((s, c) => s + (c.conversions || 0), 0);
  const platformsUsed = [...new Set(campaigns.map(c => c.platform).filter(Boolean))].length;
  const dailyBudget = campaigns.filter(c => c.status === 'active').reduce((s, c) => s + (c.daily_budget_ils || 0), 0);

  const pendingLaunch = campaigns.filter(c => c.status === 'pending_launch');
  const urgentActions = pendingLaunch.slice(0, 2).map(c => ({
    title: `קמפיין ממתין לפרסום: ${c.title}`,
    description: c.platform ? `פלטפורמה: ${PLATFORM_CONFIG[c.platform]?.label || c.platform}` : '',
    ctaLabel: 'פרסם עכשיו',
    onCta: () => navigate(`/marketing/create?campaignId=${c.id}`),
  }));

  const statCards = [
    { count: totalLeads,          label: 'לידים מהיום',       borderColor: 'blue' },
    { count: activeLeads,         label: 'לידים חמים',        borderColor: 'red' },
    { count: platformsUsed,       label: 'מקורות',            borderColor: 'yellow' },
    { count: `₪${dailyBudget}`,   label: 'תקציב פרסום יומי', borderColor: 'none' },
  ];

  return (
    <div className="space-y-5">
      {/* Header row: title + status filter tabs + new campaign button */}
      <div dir="rtl" className="flex items-center gap-3 mb-6 flex-wrap">
        {/* Title */}
        <div className="text-right">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-foreground">{campaigns.length}</span>
            <span className="text-lg font-semibold text-foreground">מרכז השיווק</span>
          </div>
          <p className="text-xs text-foreground-muted mt-0.5">ניהול קמפיינים ממומנים, פוסטים אורגניים וניתוח קהל יעד</p>
        </div>

        {/* Status filter tabs */}
        <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl flex-1 justify-center flex-wrap">
          {STATUS_FILTER_TABS.map(tab => {
            const cnt = campaigns.filter(c => tab.match.includes(c.status)).length;
            return (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1 ${
                  statusFilter === tab.key
                    ? 'bg-[#e8344d] text-white shadow-sm'
                    : 'text-foreground-muted hover:text-foreground'
                }`}
              >
                {tab.label}
                {cnt > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusFilter === tab.key ? 'bg-white/30 text-white' : 'bg-gray-200 text-gray-600'}`}>{cnt}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* New campaign button */}
        <button
          onClick={() => navigate('/marketing/create')}
          className="flex items-center gap-1.5 bg-foreground text-background px-4 py-2 rounded-full text-sm font-semibold hover:opacity-85 transition-opacity shadow-sm flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          קמפיין חדש
        </button>
      </div>

      <StatCards cards={statCards} />

      {urgentActions.length > 0 && (
        <UrgentActionsSection actions={urgentActions} />
      )}

      {/* Campaigns table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Section header with search */}
        <div dir="rtl" className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Radio className="w-3 h-3 text-green-500" />
            <span className="text-[13px] font-semibold text-foreground">קמפיינים</span>
          </div>
          <div className="flex items-center gap-2 mr-auto">
            {/* Dropdowns first so search appears leftmost in RTL */}
            <button className="flex items-center gap-1 px-3 py-1.5 text-[12px] border border-border rounded-lg bg-secondary/50 text-foreground-muted hover:text-foreground transition-colors">
              ממומן / אורגני
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button className="flex items-center gap-1 px-3 py-1.5 text-[12px] border border-border rounded-lg bg-secondary/50 text-foreground-muted hover:text-foreground transition-colors">
              כל הזמנים
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted pointer-events-none" />
              <input
                type="text"
                placeholder="חיפוש"
                value={campaignSearch}
                onChange={e => setCampaignSearch(e.target.value)}
                className="pr-8 pl-3 py-1.5 text-[12px] border border-border rounded-lg bg-secondary/50 focus:outline-none focus:ring-1 focus:ring-foreground/20 w-32"
                dir="rtl"
              />
            </div>
          </div>
        </div>

        {/* Table column headers */}
        <div dir="rtl" className="flex items-center gap-3 px-4 py-2 bg-secondary/30 border-b border-border text-[11px] font-semibold text-foreground-muted">
          <span className="flex-1">קמפיין</span>
          <span className="w-8 text-center">פלטפורמה</span>
          <span className="w-12 text-center">לידים</span>
          <span className="w-16 text-center">יחס המרה</span>
          <span className="w-40 text-right">תקציב ומשך</span>
          <span className="w-12 text-center">סטאטוס</span>
          <span className="w-4" />
        </div>

        {/* Rows */}
        {loadingPaid ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-foreground-muted" /></div>
        ) : filteredCampaigns.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[13px] text-foreground-muted mb-4">אין קמפיינים בקטגוריה זו</p>
            <button onClick={() => navigate('/marketing/create')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-full text-[12px] font-semibold hover:opacity-90">
              <Plus className="w-4 h-4" /> צור קמפיין
            </button>
          </div>
        ) : (
          <div>
            {filteredCampaigns.map(c => (
              <CampaignRow
                key={c.id}
                campaign={c}
                onDelete={(id) => deleteCampaign.mutate(id)}
                bpId={bpId}
                onToggle={(camp) => {
                  const newStatus = ['active', 'published'].includes(camp.status) ? 'paused' : 'active';
                  base44.entities.Campaign.update(camp.id, { status: newStatus })
                    .then(() => queryClient.invalidateQueries({ queryKey: ['campaigns', bpId] }));
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Audience discovery — informs who to target with the campaigns above */}
      <div className="space-y-3">
        <div>
          <h2 className="text-[15px] font-bold text-foreground">קהל יעד לקמפיינים ממומנים</h2>
          <p className="text-xs text-foreground-muted">הכירו את הלקוחות שלכם ובנו קהלי יעד לטרגוט מדויק בפרסום ממומן</p>
        </div>
        <AudienceInsights businessProfileId={bpId} />
        <AudienceSegments businessProfileId={bpId} />
      </div>

      {showWaBlast && (
        <WhatsAppBlastDrawer
          businessProfile={businessProfile}
          signalContext={waBlastCtx}
          onClose={() => setShowWaBlast(false)}
        />
      )}
    </div>
  );
}
