import React, { useState } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Plus, Megaphone, Eye, MousePointerClick, Users, TrendingUp, Loader2, Trash2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

const PLATFORM_CONFIG = {
  meta:      { label: 'Facebook',    icon: '📘', color: '#1877f2', bg: '#e7f3ff' },
  instagram: { label: 'Instagram',   icon: '📸', color: '#e1306c', bg: '#fde8f0' },
  google:    { label: 'Google Ads',  icon: '🔍', color: '#4285f4', bg: '#e8f0fe' },
};

const OBJECTIVE_LABELS = {
  awareness: 'מודעות',
  traffic:   'תנועה',
  leads:     'לידים',
  conversions: 'מכירות',
};

const STATUS_CONFIG = {
  draft:     { label: 'טיוטה',   cls: 'bg-gray-100 text-gray-600' },
  published: { label: 'פורסם',   cls: 'bg-blue-50 text-blue-700' },
  active:    { label: 'פעיל',    cls: 'bg-green-50 text-green-700' },
  completed: { label: 'הסתיים',  cls: 'bg-purple-50 text-purple-700' },
};

const TABS = [
  { id: 'all',       label: 'הכל' },
  { id: 'draft',     label: 'טיוטות' },
  { id: 'published', label: 'פורסמו' },
  { id: 'active',    label: 'פעילים' },
  { id: 'completed', label: 'הסתיימו' },
];

function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000)    return `${(n / 1000).toFixed(0)}K`;
  return String(Math.round(n));
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

function MetricPill({ icon: Icon, label, value, accent }) {
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[56px]">
      <div className="flex items-center gap-1 text-foreground-muted">
        <Icon className="w-3 h-3" style={{ color: accent }} />
      </div>
      <span className="text-[13px] font-bold text-foreground">{value}</span>
      <span className="text-[9px] text-foreground-muted">{label}</span>
    </div>
  );
}

function CampaignCard({ campaign, onDelete }) {
  const navigate = useNavigate();
  const plat = PLATFORM_CONFIG[campaign.platform] || { label: campaign.platform, icon: '📣', color: '#555', bg: '#f5f5f5' };
  const status = STATUS_CONFIG[campaign.status] || STATUS_CONFIG.draft;
  const reach = campaign.actual_reach ?? ((campaign.est_reach_low != null && campaign.est_reach_high != null)
    ? `${fmtNum(campaign.est_reach_low)}–${fmtNum(campaign.est_reach_high)}`
    : null);
  const leads = campaign.actual_leads ?? ((campaign.est_leads_low != null && campaign.est_leads_high != null)
    ? `${campaign.est_leads_low}–${campaign.est_leads_high}`
    : null);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-sm transition-all">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <span
          className="text-[11px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: plat.bg, color: plat.color }}
        >
          {plat.icon} {plat.label}
        </span>
        {campaign.objective && (
          <span className="text-[11px] text-foreground-muted">
            {OBJECTIVE_LABELS[campaign.objective] || campaign.objective}
          </span>
        )}
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full mr-auto ${status.cls}`}>
          {status.label}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <h3 className="text-[13px] font-semibold text-foreground mb-1 truncate">{campaign.title}</h3>
        {campaign.post_content && (
          <p className="text-[11px] text-foreground-muted leading-relaxed line-clamp-2 mb-3">
            {campaign.post_content}
          </p>
        )}
        {campaign.signal_summary && (
          <p className="text-[10px] text-foreground-muted opacity-60 mb-3 line-clamp-1">
            מגמה: {campaign.signal_summary}
          </p>
        )}

        {/* Metrics row */}
        <div className="flex items-center gap-4 py-2 border-t border-border/50">
          {campaign.daily_budget_ils != null && (
            <MetricPill icon={TrendingUp} label="תקציב יומי" value={`₪${campaign.daily_budget_ils}`} accent="#10b981" />
          )}
          {reach && (
            <MetricPill icon={Eye} label="הגעה" value={reach} accent="#6366f1" />
          )}
          {campaign.actual_clicks != null && (
            <MetricPill icon={MousePointerClick} label="קליקים" value={fmtNum(campaign.actual_clicks)} accent="#f59e0b" />
          )}
          {leads && (
            <MetricPill icon={Users} label="לידים" value={leads} accent="#ef4444" />
          )}
          <div className="mr-auto text-[10px] text-foreground-muted">
            {campaign.published_at ? `פורסם ${fmtDate(campaign.published_at)}` : fmtDate(campaign.created_date)}
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-2 px-4 py-2 border-t border-border bg-secondary/30">
        <button
          onClick={() => navigate(`/campaigns/create?campaignId=${campaign.id}`)}
          className="text-[11px] text-foreground-muted hover:text-foreground flex items-center gap-1 transition-colors"
        >
          ✏️ ערוך
        </button>
        {campaign.status === 'published' || campaign.status === 'active' ? (
          <button className="text-[11px] text-blue-600 hover:text-blue-700 flex items-center gap-1 transition-colors">
            <ExternalLink className="w-3 h-3" /> הצג בפלטפורמה
          </button>
        ) : null}
        <button
          onClick={() => onDelete(campaign.id)}
          className="text-[11px] text-foreground-muted hover:text-red-500 flex items-center gap-1 mr-auto transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export default function Campaigns() {
  const { businessProfile } = useOutletContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('all');
  const bpId = businessProfile?.id;

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['campaigns', bpId],
    queryFn: () => base44.entities.Campaign.filter({ linked_business: bpId }, '-created_date', 50),
    enabled: !!bpId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Campaign.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns', bpId] });
      toast.success('הקמפיין נמחק');
    },
  });

  const filtered = activeTab === 'all'
    ? campaigns
    : campaigns.filter(c => c.status === activeTab);

  const counts = TABS.reduce((acc, t) => {
    acc[t.id] = t.id === 'all' ? campaigns.length : campaigns.filter(c => c.status === t.id).length;
    return acc;
  }, {});

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto" dir="rtl">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Megaphone className="w-5 h-5" /> קמפיינים ממומנים
          </h1>
          <p className="text-sm text-foreground-muted mt-0.5">
            ניהול קמפיינים, תוצאות וניתוחים
          </p>
        </div>
        <button
          onClick={() => navigate('/campaigns/create')}
          className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg text-[13px] font-semibold hover:opacity-90 transition-all"
        >
          <Plus className="w-4 h-4" /> קמפיין חדש
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-border">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-[12px] font-medium border-b-2 transition-all ${
              activeTab === tab.id
                ? 'border-foreground text-foreground'
                : 'border-transparent text-foreground-muted hover:text-foreground'
            }`}
          >
            {tab.label}
            {counts[tab.id] > 0 && (
              <span className="mr-1 text-[10px] opacity-60">({counts[tab.id]})</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Megaphone className="w-10 h-10 text-foreground-muted opacity-30 mx-auto mb-3" />
          <p className="text-[14px] text-foreground-muted mb-1">אין קמפיינים עדיין</p>
          <p className="text-[12px] text-foreground-muted opacity-60 mb-4">
            לחץ על "קמפיין חדש" או על "רעיון קמפיין" בתובנות
          </p>
          <button
            onClick={() => navigate('/campaigns/create')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg text-[13px] font-semibold hover:opacity-90 transition-all"
          >
            <Plus className="w-4 h-4" /> צור קמפיין ראשון
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(c => (
            <CampaignCard
              key={c.id}
              campaign={c}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
