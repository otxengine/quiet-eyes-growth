import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, MessageSquare, Copy, CheckCheck, Search, MoreVertical, Plus, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import StatCards from '@/components/shared/StatCards';
import PlanGate from '@/components/subscription/PlanGate';
import SurveyResponseModal from '@/components/surveys/SurveyResponseModal';
import ActionPopup from '@/components/ui/ActionPopup';
import PageHeader from '@/components/shared/PageHeader';

function daysAgo(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

const HEALTH = {
  high_risk: {
    label: 'לקוחות בסיכון גבוהה',
    dot: 'bg-red-500',
    border: 'border-r-red-500',
    statusText: 'דורש טיפול',
    statusDot: 'bg-red-500',
    statusColor: 'text-red-600',
    action: 'צור קשר',
    actionCls: 'border-[#e8344d] text-[#e8344d] hover:bg-red-50',
  },
  watch: {
    label: 'לקוחות במעקב',
    dot: 'bg-amber-400',
    border: 'border-r-amber-400',
    statusText: 'במעקב',
    statusDot: 'bg-amber-400',
    statusColor: 'text-amber-600',
    action: 'שלח הטבה',
    actionCls: 'border-amber-300 text-amber-600 hover:bg-amber-50',
  },
  ok: {
    label: 'לקוחות תקינים',
    dot: 'bg-blue-500',
    border: 'border-r-blue-500',
    statusText: 'תקין',
    statusDot: 'bg-green-500',
    statusColor: 'text-green-600',
    action: 'קבע שיחה',
    actionCls: 'border-blue-300 text-blue-600 hover:bg-blue-50',
  },
};

function CustomerRow({ lead, health, onAction }) {
  const cfg = HEALTH[health];
  const days = daysAgo(lead.updated_at || lead.created_date);
  const activityText = {
    high_risk: days != null ? `לא ביצע רכישה ב-${days} ימים האחרונים` : 'ללא פעילות',
    watch:     days != null ? `ללא אינטראקציה ${days} ימים` : 'ללא פעילות',
    ok:        lead.service_needed || 'שימוש עקבי',
  }[health];
  const revenueStr = lead.est_value
    ? `₪${Number(lead.est_value).toLocaleString('he-IL')} הכנסה`
    : (lead.service_needed ? lead.service_needed.slice(0, 20) : '—');

  return (
    <div dir="rtl" className="flex items-center gap-3 px-4 py-3 border-b border-border/40 last:border-0 hover:bg-gray-50/40 transition-colors">
      <span className="flex-1 text-[12px] font-medium text-foreground truncate min-w-0">{lead.name || 'לקוח'}</span>
      <div className="flex items-center gap-1.5 w-28 flex-shrink-0">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.statusDot}`} />
        <span className={`text-[11px] font-medium ${cfg.statusColor}`}>{cfg.statusText}</span>
      </div>
      <span className="text-[11px] text-foreground-muted w-52 flex-shrink-0 truncate">{activityText}</span>
      <span className="text-[11px] text-foreground-muted w-32 flex-shrink-0 truncate">{revenueStr}</span>
      <button onClick={() => onAction(lead)}
        className={`flex-shrink-0 text-[11px] px-3 py-1.5 rounded-full border font-medium transition-colors ${cfg.actionCls}`}>
        {cfg.action}
      </button>
      <button className="text-foreground-muted hover:text-foreground transition-colors flex-shrink-0">
        <MoreVertical className="w-4 h-4" />
      </button>
    </div>
  );
}

function CustomerGroup({ health, leads, onAction }) {
  const cfg = HEALTH[health];
  if (!leads.length) return null;
  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden mb-3">
      <div className={`flex items-center gap-2 px-4 py-2.5 bg-gray-50/60 border-r-4 ${cfg.border}`} dir="rtl">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
        <span className="text-[13px] font-semibold text-foreground">{cfg.label} ({leads.length})</span>
      </div>
      {leads.map(lead => (
        <CustomerRow key={lead.id} lead={lead} health={health} onAction={onAction} />
      ))}
    </div>
  );
}

export default function Retention() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const [selectedSurvey, setSelectedSurvey] = useState(null);
  const [retentionPopup, setRetentionPopup] = useState(null);
  const [winBackLoading, setWinBackLoading] = useState(false);
  const [winBackMessage, setWinBackMessage] = useState('');
  const [winBackCopied, setWinBackCopied] = useState(false);
  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState('all');

  const { data: leads = [] } = useQuery({
    queryKey: ['retentionLeads', bpId],
    queryFn: () => base44.entities.Lead.filter({ linked_business: bpId }, '-created_date', 200),
    enabled: !!bpId,
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['retentionReviews', bpId],
    queryFn: () => base44.entities.Review.filter({ linked_business: bpId }, '-created_date', 200),
    enabled: !!bpId,
  });

  const { data: surveys = [] } = useQuery({
    queryKey: ['surveys', bpId],
    queryFn: () => base44.entities.CustomerSurvey.filter({ linked_business: bpId }, '-created_date', 50),
    enabled: !!bpId,
  });

  const churnLeads = useMemo(() =>
    leads
      .filter(l => l.status === 'lost' || l.status === 'cold')
      .map(l => ({ ...l, daysSince: daysAgo(l.updated_at || l.created_date) }))
      .sort((a, b) => (b.daysSince || 0) - (a.daysSince || 0))
      .slice(0, 6),
    [leads]
  );

  const generateWinBack = async () => {
    setWinBackLoading(true);
    setWinBackMessage('');
    try {
      const names = churnLeads.slice(0, 3).map(l => l.name || 'לקוח').join(', ');
      const res = await base44.integrations.Core.InvokeLLM({
        model: 'sonnet',
        maxTokens: 250,
        prompt: `אתה מומחה שימור לקוחות לעסקים קטנים ישראלים. כתוב הודעת Win-Back שתגרום ללקוחות לחזור.

עסק: "${businessProfile?.name}" | תחום: ${businessProfile?.category}
לקוחות בסיכון נטישה: ${names || 'מספר לקוחות'}

הודעת WhatsApp (3-4 שורות):
- פנייה חמה בשם (אחד מהשמות)
- ציין שחסרת — אנושי ולא שיווקי
- סיבה ספציפית לחזור עכשיו (מבצע / חדשות / הזמנה)
- CTA קל ולא מחייב
עברית טבעית עם אמוג'י בצנעה. החזר רק את הטקסט.`,
      });
      // InvokeLLM returns parsed object or string — extract text
      const rawText = typeof res === 'string' ? res
        : typeof res === 'object' && res !== null
          ? (res.text || res.message || res.content || res.result || Object.values(res).find(v => typeof v === 'string') || '')
          : '';
      setWinBackMessage(rawText.trim());
    } catch (_) {}
    setWinBackLoading(false);
  };

  // Data classification
  const lostLeads = leads.filter(l => l.status === 'lost');
  const coldLeads = leads.filter(l => l.status === 'cold');
  const activeLeads = leads.filter(l => !['lost', 'cold'].includes(l.status));
  const negativeReviews = reviews.filter(r => r.sentiment === 'negative');
  const pendingSurveys = surveys.filter(s => !s.response_received);
  const totalActive = activeLeads.length;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const lostThisMonth = lostLeads.filter(l => (l.updated_at || l.created_date || '') >= monthStart).length;
  const potentialRevAtRisk = lostLeads.reduce((s, l) => s + (Number(l.est_value) || 0), 0);

  // Search filter
  const bySearch = (group) =>
    !search ? group : group.filter(l => (l.name || '').toLowerCase().includes(search.toLowerCase()));

  const highRiskLeads = bySearch(lostLeads);
  const watchLeads    = bySearch(coldLeads);
  const okLeads       = bySearch(activeLeads);
  const totalFiltered = highRiskLeads.length + watchLeads.length + okLeads.length;

  const visibleHighRisk = (healthFilter === 'all' || healthFilter === 'high_risk') ? highRiskLeads : [];
  const visibleWatch    = (healthFilter === 'all' || healthFilter === 'watch')     ? watchLeads    : [];
  const visibleOk       = healthFilter === 'all' ? okLeads : [];

  const statCards = [
    { count: totalActive, label: 'לקוחות פעילים', borderColor: 'blue', change: '+12% מהשבוע הקודם', changeColor: 'text-green-600' },
    { count: lostLeads.length, label: 'לקוחות בסיכון גבוהה', borderColor: 'red', change: lostLeads.length > 0 ? `+20% מהשבוע הקודם` : null, changeColor: 'text-red-500' },
    { count: potentialRevAtRisk > 0 ? `₪${potentialRevAtRisk.toLocaleString('he-IL')}` : '—', label: 'פוטנציאל הכנסה בסיכון', borderColor: 'yellow' },
    { count: lostThisMonth, label: 'נטשו החודש', borderColor: 'none', change: '+12% מהשבוע הקודם', changeColor: 'text-red-500' },
  ];

  const FILTER_TABS = [
    { key: 'all',       label: 'הכל',          count: leads.length },
    { key: 'high_risk', label: 'בסיכון גבוהה', count: lostLeads.length },
    { key: 'watch',     label: 'במעקב',         count: coldLeads.length },
  ];

  const handleCustomerAction = (lead) => {
    setRetentionPopup({
      id: `retention_lead_${lead.id}`,
      summary: `לקוח בסיכון: ${lead.name || 'לקוח'} — ${lead.status === 'lost' ? 'ליד שאבד' : 'לקוח קר'}`,
      recommended_action: 'שלח הצעה אישית להחזרה',
      source_description: JSON.stringify({
        action_label: 'שלח הצעה',
        action_type: 'social_post',
        prefilled_text: `שלום ${lead.name || ''},\n\nראינו שלא המשכנו ביחד — נשמח להציע לך הצעה מיוחדת!\n\nצרו קשר ונסגור בתנאים טובים 🙏\n\n${businessProfile?.name}`,
        time_minutes: 5,
      }),
      impact_level: 'high',
    });
  };

  return (
    <PlanGate requires="growth" featureName="שימור לקוחות">
      <div className="space-y-5">
        <PageHeader
          count={leads.length}
          title="ניהול לקוחות"
          subtitle="מניעת נטישה ושימור לקוחות קיימים"
          actionLabel="הוספת לקוח"
          actionIcon={<Plus className="w-4 h-4" />}
          onAction={() => {}}
        />

        <StatCards cards={statCards} />

        {/* פעולות דחופות */}
        {(lostLeads.length > 0 || negativeReviews.length > 0 || churnLeads.length > 0) && (
          <div className="bg-gradient-to-l from-pink-50 via-purple-50 to-blue-50 border border-gray-200 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3" dir="rtl">
              <h3 className="text-[14px] font-bold text-foreground">פעולות דחופות</h3>
              <button className="flex items-center gap-1.5 text-[11px] text-foreground-muted hover:text-foreground border border-gray-200 rounded-lg px-3 py-1.5 transition-colors bg-white/60">
                צפייה בכל הפעולות
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {lostLeads.length > 0 && (
                <div className="rounded-xl p-4 flex flex-col gap-3 text-right" style={{ background: 'linear-gradient(135deg, #fff1f1 0%, #ffd6d6 100%)' }}>
                  <div>
                    <p className="text-[13px] font-bold text-foreground">{lostLeads.length} לקוחות בסיכון גבוהה לנטישה</p>
                    <p className="text-[11px] text-foreground-secondary mt-1">
                      {potentialRevAtRisk > 0 ? `פוטנציאל הכנסה בסיכון: ₪${potentialRevAtRisk.toLocaleString('he-IL')}` : 'דורשים טיפול מיידי'}
                    </p>
                  </div>
                  <button onClick={() => setHealthFilter('high_risk')}
                    className="self-start bg-white/80 hover:bg-white text-[#e8344d] text-[11px] font-semibold px-4 py-1.5 rounded-full border border-[#e8344d]/40 transition-colors">
                    צפה בלקוחות
                  </button>
                </div>
              )}
              {churnLeads.length > 0 && (
                <div className="rounded-xl p-4 flex flex-col gap-3 text-right" style={{ background: 'linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%)' }}>
                  <div>
                    <p className="text-[13px] font-bold text-foreground">{churnLeads.length} לקוחות לא חזרו מאז הרכישה</p>
                    <p className="text-[11px] text-foreground-secondary mt-1">חלפו 30 יום ללא אינטראקציה</p>
                  </div>
                  <button onClick={generateWinBack} disabled={winBackLoading}
                    className="self-start flex items-center gap-1.5 bg-white/80 hover:bg-white text-amber-700 text-[11px] font-semibold px-4 py-1.5 rounded-full border border-amber-300 transition-colors disabled:opacity-60">
                    {winBackLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                    שלח קמפיין
                  </button>
                </div>
              )}
              {negativeReviews.length > 0 && (
                <div className="rounded-xl p-4 flex flex-col gap-3 text-right" style={{ background: 'linear-gradient(135deg, #e8f4f8 0%, #b3d9e8 100%)' }}>
                  <div>
                    <p className="text-[13px] font-bold text-foreground">לקוח גדול לא קיבל מענה</p>
                    <p className="text-[11px] text-foreground-secondary mt-1">{negativeReviews.length} ביקורות שליליות ממתינות לתגובה</p>
                  </div>
                  <button onClick={() => { window.location.href = '/reviews'; }}
                    className="self-start bg-white/80 hover:bg-white text-blue-700 text-[11px] font-semibold px-4 py-1.5 rounded-full border border-blue-300 transition-colors">
                    צור תגובה
                  </button>
                </div>
              )}
            </div>
            {winBackMessage && (
              <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200" dir="rtl">
                <div className="flex items-center justify-between mb-1.5">
                  <button onClick={() => { navigator.clipboard.writeText(winBackMessage).then(() => { setWinBackCopied(true); toast.success('הועתק ✓'); setTimeout(() => setWinBackCopied(false), 2000); }); }}
                    className="flex items-center gap-1 text-[10px] text-foreground-muted hover:text-foreground px-2 py-0.5 rounded border border-border bg-white">
                    {winBackCopied ? <CheckCheck className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    {winBackCopied ? 'הועתק' : 'העתק'}
                  </button>
                  <p className="text-[10px] font-semibold text-amber-700">📱 מסר WhatsApp להחזרת לקוח:</p>
                </div>
                <p className="text-[12px] text-foreground leading-relaxed whitespace-pre-line">{winBackMessage}</p>
              </div>
            )}
          </div>
        )}

        {/* Customer list */}
        <div>
          {/* Title on RIGHT (first in RTL DOM), filters on LEFT (second) */}
          <div className="flex items-center justify-between mb-3" dir="rtl">
            <h2 className="text-[15px] font-bold text-foreground">{totalFiltered} לקוחות</h2>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Filter tabs first = appear rightmost in the group (RTL) */}
              <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                {FILTER_TABS.map(tab => (
                  <button key={tab.key} onClick={() => setHealthFilter(tab.key)}
                    className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                      healthFilter === tab.key ? 'bg-white shadow-sm text-foreground' : 'text-foreground-muted hover:text-foreground'
                    }`}>
                    {tab.label} <span className="opacity-50">{tab.count}</span>
                  </button>
                ))}
              </div>
              <button className="flex items-center gap-1 text-[11px] text-foreground-muted border border-border rounded-lg px-2.5 py-1.5 hover:bg-secondary transition-colors">
                פוטנציאל הכנסה <ChevronDown className="w-3 h-3" />
              </button>
              <button className="flex items-center gap-1 text-[11px] text-foreground-muted border border-border rounded-lg px-2.5 py-1.5 hover:bg-secondary transition-colors">
                ערך לקוח <ChevronDown className="w-3 h-3" />
              </button>
              {(search || healthFilter !== 'all') && (
                <button onClick={() => { setSearch(''); setHealthFilter('all'); }} className="text-[11px] text-foreground-muted hover:text-foreground transition-colors">
                  נקה פילטרים
                </button>
              )}
              {/* Search last = leftmost in RTL */}
              <div className="relative">
                <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted" />
                <input type="text" placeholder="חיפוש" value={search} onChange={e => setSearch(e.target.value)} dir="rtl"
                  className="pr-8 pl-3 py-1.5 text-[12px] border border-border rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-foreground w-32" />
              </div>
            </div>
          </div>

          <CustomerGroup health="high_risk" leads={visibleHighRisk} onAction={handleCustomerAction} />
          <CustomerGroup health="watch"     leads={visibleWatch}    onAction={handleCustomerAction} />
          <CustomerGroup health="ok"        leads={visibleOk}       onAction={handleCustomerAction} />

          {totalFiltered === 0 && (
            <div className="bg-white rounded-xl border border-border p-10 text-center">
              <p className="text-[12px] text-foreground-muted">אין לקוחות התואמים את הסינון</p>
            </div>
          )}
        </div>

        {selectedSurvey && (
          <SurveyResponseModal survey={selectedSurvey} businessProfile={businessProfile} onClose={() => setSelectedSurvey(null)} />
        )}
        {retentionPopup && (
          <ActionPopup signal={retentionPopup} businessProfile={businessProfile} onClose={() => setRetentionPopup(null)} />
        )}
      </div>
    </PlanGate>
  );
}