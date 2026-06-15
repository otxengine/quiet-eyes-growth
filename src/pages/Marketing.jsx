import React, { useState } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Plus, Loader2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/shared/PageHeader';
import StatCards from '@/components/shared/StatCards';
import UrgentActionsSection from '@/components/shared/UrgentActionsSection';
import DataTable from '@/components/shared/DataTable';

const PLATFORM_CONFIG = {
  meta:      { label: 'Facebook',   icon: '📘', color: '#1877f2', bg: '#e7f3ff' },
  instagram: { label: 'Instagram',  icon: '📸', color: '#e1306c', bg: '#fde8f0' },
  google:    { label: 'Google Ads', icon: '🔍', color: '#4285f4', bg: '#e8f0fe' },
  facebook:  { label: 'Facebook',   icon: '📘', color: '#1877f2', bg: '#e7f3ff' },
  tiktok:    { label: 'TikTok',     icon: '🎵', color: '#000',    bg: '#f0f0f0' },
};

const STATUS_CONFIG = {
  draft:          { label: 'טיוטה',        cls: 'bg-gray-100 text-gray-500',   tab: 'drafts' },
  pending_launch: { label: 'ממתין לפרסום', cls: 'bg-amber-50 text-amber-700',  tab: 'paused' },
  published:      { label: 'פורסם',        cls: 'bg-blue-50 text-blue-700',    tab: 'active' },
  active:         { label: 'פעיל',         cls: 'bg-green-50 text-green-700',  tab: 'active' },
  completed:      { label: 'הסתיים',       cls: 'bg-purple-50 text-purple-700', tab: 'completed' },
  paused:         { label: 'בהשהיה',       cls: 'bg-orange-50 text-orange-700', tab: 'paused' },
};

const TABS = [
  { key: 'active',    label: 'קמפיינים פעילים' },
  { key: 'paused',    label: 'בהשהיה' },
  { key: 'drafts',    label: 'טיוטות' },
  { key: 'completed', label: 'הסתיימו' },
];

const COLUMNS = [
  { key: 'title',    label: 'קמפיין' },
  { key: 'platform', label: 'פלטפורמה' },
  { key: 'leads',    label: 'לידים' },
  { key: 'cr',       label: 'יחס המרה' },
  { key: 'budget',   label: 'תקציב ומשך' },
  { key: 'status',   label: 'סטאטוס' },
];

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

export default function Marketing() {
  const { businessProfile } = useOutletContext();
  const navigate = useNavigate();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('active');
  const [budgetOpen, setBudgetOpen] = useState(false);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['campaigns', bpId],
    queryFn: () => base44.entities.Campaign.filter({ linked_business: bpId }, '-created_date', 100),
    enabled: !!bpId,
  });

  const { data: allLeads = [] } = useQuery({
    queryKey: ['allLeads', bpId],
    queryFn: () => base44.entities.Lead.filter({ linked_business: bpId }, '-score', 100),
    enabled: !!bpId,
  });

  const today = new Date().toISOString().slice(0, 10);
  const todayLeads = allLeads.filter(l => (l.created_at || '').startsWith(today));
  const hotLeads   = allLeads.filter(l => l.status === 'hot');
  const sources    = new Set(allLeads.map(l => l.source).filter(Boolean));
  const totalBudget = campaigns.filter(c => c.status === 'active').reduce((s, c) => s + (c.daily_budget_ils || 0), 0);

  const statCards = [
    { count: todayLeads.length, label: 'לידים מהיום',          borderColor: 'blue' },
    { count: hotLeads.length,   label: 'לידים חמים',           borderColor: 'red' },
    { count: sources.size,      label: 'מקורות',               borderColor: 'none' },
    { count: `₪${totalBudget}`, label: 'תקציב פרסום יומי',     borderColor: 'yellow' },
  ];

  const tabCount = (tabKey) => campaigns.filter(c => {
    const sc = STATUS_CONFIG[c.status];
    return sc?.tab === tabKey;
  }).length;

  const filteredCampaigns = campaigns.filter(c => {
    const sc = STATUS_CONFIG[c.status];
    return sc?.tab === activeTab;
  });

  // Urgent: campaigns with pending_launch status
  const pendingLaunch = campaigns.filter(c => c.status === 'pending_launch');
  const urgentActions = pendingLaunch.slice(0, 2).map(c => ({
    title: `קמפיין ממתין לפרסום: ${c.title}`,
    description: c.platform ? `פלטפורמה: ${PLATFORM_CONFIG[c.platform]?.label || c.platform}` : '',
    ctaLabel: 'פרסם עכשיו',
    onCta: () => navigate(`/marketing/create?campaignId=${c.id}`),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        count={campaigns.length}
        title="מרכז השיווק"
        actionLabel="קמפיין חדש"
        actionIcon={<Plus className="w-4 h-4" />}
        onAction={() => navigate('/marketing/create')}
      />

      <StatCards cards={statCards} />

      {urgentActions.length > 0 && (
        <UrgentActionsSection actions={urgentActions} />
      )}

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === tab.key ? 'bg-white shadow-sm text-foreground' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {tab.label}
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              activeTab === tab.key ? 'bg-gray-100 text-foreground-secondary' : 'bg-gray-200 text-foreground-muted'
            }`}>
              {tabCount(tab.key)}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={filteredCampaigns}
          emptyText="אין קמפיינים בקטגוריה זו"
          renderCell={(campaign, col) => {
            if (col.key === 'title') return (
              <div>
                <div className="font-semibold text-sm text-foreground">{campaign.title}</div>
                {campaign.created_date && (
                  <div className="text-[10px] text-foreground-muted mt-0.5">{fmtDate(campaign.created_date)}</div>
                )}
              </div>
            );
            if (col.key === 'platform') {
              const plat = PLATFORM_CONFIG[campaign.platform];
              if (!plat) return <span className="text-xs text-foreground-secondary">{campaign.platform || '—'}</span>;
              return (
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ background: plat.bg, color: plat.color }}
                >
                  {plat.icon} {plat.label}
                </span>
              );
            }
            if (col.key === 'leads') return (
              <span className="font-semibold text-sm text-foreground">
                {campaign.leads_count ?? campaign.clicks ?? '—'}
              </span>
            );
            if (col.key === 'cr') {
              const cr = campaign.conversion_rate ?? campaign.click_through_rate;
              return (
                <span className="text-sm text-foreground-secondary">
                  {cr != null ? `${(cr * 100).toFixed(1)}%` : '—'}
                </span>
              );
            }
            if (col.key === 'budget') return (
              <div className="text-xs text-foreground-secondary">
                {campaign.daily_budget_ils != null && <div>₪{campaign.daily_budget_ils}/יום</div>}
                {(campaign.start_date || campaign.end_date) && (
                  <div className="text-[10px] text-foreground-muted">
                    {fmtDate(campaign.start_date)} — {fmtDate(campaign.end_date)}
                  </div>
                )}
              </div>
            );
            if (col.key === 'status') {
              const sc = STATUS_CONFIG[campaign.status] || STATUS_CONFIG.draft;
              const isActive = campaign.status === 'active' || campaign.status === 'published';
              return (
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      const newStatus = isActive ? 'paused' : 'active';
                      try {
                        await base44.entities.Campaign.update(campaign.id, { status: newStatus });
                        queryClient.invalidateQueries({ queryKey: ['campaigns', bpId] });
                        toast.success(newStatus === 'active' ? 'קמפיין הופעל' : 'קמפיין הושהה');
                      } catch { toast.error('שגיאה בעדכון קמפיין'); }
                    }}
                    className={`w-9 h-5 rounded-full transition-colors relative ${isActive ? 'bg-green-400' : 'bg-gray-200'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${isActive ? 'right-0.5' : 'left-0.5'}`} />
                  </button>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${sc.cls}`}>{sc.label}</span>
                </div>
              );
            }
            return null;
          }}
        />
      )}
    </div>
  );
}
