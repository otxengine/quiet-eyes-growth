import React, { useState, useEffect } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Plus, Target, Sparkles, Loader2, LayoutGrid, List, RotateCcw, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { toast } from 'sonner';
import LeadCard from '@/components/leads/LeadCard';
import AddLeadModal from '@/components/leads/AddLeadModal';
import PipelineView from '@/components/leads/PipelineView';
import LeadDetailPanel from '@/components/leads/LeadDetailPanel';
import AiInsightBox from '@/components/ai/AiInsightBox';
import ScanOverlay from '@/components/dashboard/ScanOverlay';

const filterTabs = [
  { key: 'all', label: 'הכל' },
  { key: 'hot', label: 'חמים' },
  { key: 'warm', label: 'פושרים' },
  { key: 'contacted', label: 'נוצר קשר' },
  { key: 'completed', label: 'טופלו' },
];

const stages = [
  { key: 'new', label: 'חדש', color: 'bg-gray-100 text-gray-600' },
  { key: 'contacted', label: 'נוצר קשר', color: 'bg-blue-50 text-blue-600' },
  { key: 'meeting', label: 'פגישה', color: 'bg-amber-50 text-amber-600' },
  { key: 'negotiation', label: 'משא ומתן', color: 'bg-purple-50 text-purple-600' },
  { key: 'closed_won', label: 'נסגר ✓', color: 'bg-green-50 text-green-600' },
  { key: 'closed_lost', label: 'אבד', color: 'bg-red-50 text-red-400' },
];

const leadsScanSteps = [
  { key: 'leads',  label: 'מייצר לידים חדשים...',     fn: 'runLeadGeneration', resultKey: 'leads_generated' },
  { key: 'social', label: 'סורק לידים ברשתות חברתיות...', fn: 'findSocialLeads',    resultKey: 'leads_created' },
];

function LeadQualityGuide({ businessProfile }) {
  const [open, setOpen] = useState(false);
  const hasCriteria = businessProfile?.relevant_services || businessProfile?.min_budget || businessProfile?.lead_intent_signals || businessProfile?.lead_quality_notes;

  return (
    <div className="card-base border border-blue-100 bg-blue-50/30">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-right"
      >
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-500" />
          <span className="text-[12px] font-semibold text-blue-700">
            {hasCriteria ? 'קריטריוני ליד מוגדרים — הסוכן יסנן בהתאם' : 'טרם הוגדרו קריטריונים ללידים — הסוכן יחפש בצורה כללית'}
          </span>
          {!hasCriteria && (
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-200">
              מומלץ להגדיר
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-blue-400" /> : <ChevronDown className="w-4 h-4 text-blue-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2 border-t border-blue-100">
          <p className="text-[11px] text-blue-600 pt-2">
            ליד איכותי נחשב — לפי ההגדרות שלך בהגדרות ← קריטריונים ללידים:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            {[
              { label: 'תקציב מינימום', value: businessProfile?.min_budget },
              { label: 'שירותים רלוונטיים', value: businessProfile?.relevant_services },
              { label: 'אזור מועדף', value: businessProfile?.preferred_area },
              { label: 'סימני כוונת קנייה', value: businessProfile?.lead_intent_signals },
            ].map(item => item.value && (
              <div key={item.label} className="bg-white rounded-lg p-2.5 border border-blue-100">
                <p className="text-[9px] font-semibold text-blue-400 mb-0.5">{item.label}</p>
                <p className="text-[11px] text-foreground line-clamp-2">{item.value}</p>
              </div>
            ))}
          </div>
          {businessProfile?.lead_quality_notes && (
            <div className="bg-white rounded-lg p-2.5 border border-blue-100">
              <p className="text-[9px] font-semibold text-blue-400 mb-0.5">הגדרת ליד איכותי</p>
              <p className="text-[11px] text-foreground">{businessProfile.lead_quality_notes}</p>
            </div>
          )}
          {!hasCriteria && (
            <Link to="/settings" className="inline-flex items-center gap-1.5 mt-1 text-[11px] font-medium text-blue-600 hover:underline">
              → עבור להגדרות והגדר קריטריונים
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export default function Leads() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('all');
  const [showScan, setShowScan] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [huntingLeads, setHuntingLeads] = useState(false);
  const [searchState, setSearchState] = useState('idle'); // 'idle'|'running'|'done'|'empty'
  const [searchLog,   setSearchLog]   = useState([]);
  const [newLeadsCount, setNewLeadsCount] = useState(0);

  // Check URL for pipeline view
  const urlParams = new URLSearchParams(window.location.search);
  const [viewMode, setViewMode] = useState(urlParams.get('view') === 'pipeline' ? 'pipeline' : 'list');

  const handleEnrich = async () => {
    setEnriching(true);
    await base44.functions.invoke('enrichLeads', { businessProfileId: bpId });
    queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
    toast.success('הלידים הועשרו בהצלחה ✓');
    setEnriching(false);
  };

  const handleHuntSocialLeads = async () => {
    if (!bpId) { toast.error('לא נמצא פרופיל עסקי'); return; }
    const beforeCount = leads.length;
    setSearchState('running');
    setSearchLog(['מחפש בפייסבוק וקבוצות...']);
    setNewLeadsCount(0);
    try {
      // Staggered progress messages while API runs
      const addLog = (msg) => setSearchLog(p => [...p, msg]);
      const t1 = setTimeout(() => addLog('מחפש באינסטגרם...'), 5000);
      const t2 = setTimeout(() => addLog('מנתח ומדרג לידים...'), 12000);
      const t3 = setTimeout(() => addLog('מסנן כפילויות...'), 20000);

      const leadCriteria = {
        min_budget: businessProfile?.min_budget,
        relevant_services: businessProfile?.relevant_services,
        preferred_area: businessProfile?.preferred_area,
        lead_intent_signals: businessProfile?.lead_intent_signals,
        lead_quality_notes: businessProfile?.lead_quality_notes,
      };
      const res = await base44.functions.invoke('findSocialLeads', { businessProfileId: bpId, lead_criteria: leadCriteria });
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);

      const count = res?.data?.leads_created ?? res?.leads_created ?? 0;
      queryClient.invalidateQueries({ queryKey: ['leadsPage'] });

      setNewLeadsCount(count);
      if (count > 0) {
        addLog(`✅ נמצאו ${count} לידים חדשים!`);
        setSearchState('done');
      } else {
        addLog('סריקה הושלמה — לא נמצאו לידים חדשים');
        setSearchState('empty');
      }
    } catch (err) {
      setSearchLog(p => [...p, `שגיאה: ${err.message || 'שגיאת שרת'}`]);
      setSearchState('idle');
      console.error('[findSocialLeads]', err);
    }
    setHuntingLeads(false);
  };

  useEffect(() => {
    window.__quieteyes_scan = () => setShowScan(true);
    return () => { delete window.__quieteyes_scan; };
  }, []);

  const { data: allLeadsRaw = [] } = useQuery({
    queryKey: ['leadsPage', bpId],
    queryFn: () => base44.entities.Lead.filter({ linked_business: bpId }, '-score', 200),
    enabled: !!bpId
  });

  // Split archived vs active
  const leads = allLeadsRaw.filter(l => !l.is_archived);
  const retentionLeads = allLeadsRaw.filter(l => l.retention_candidate && !l.is_archived);

  const today = new Date().toISOString().split('T')[0];
  const thisMonth = new Date().toISOString().slice(0, 7);
  const todayLeads = leads.filter(l => (l.created_at || l.created_date || '').startsWith(today));
  const hotCount = leads.filter(l => l.status === 'hot').length;
  const warmCount = leads.filter(l => l.status === 'warm').length;
  const coldCount = leads.filter(l => l.status === 'cold').length;
  const contactedCount = leads.filter(l => l.status === 'contacted').length;
  const completedCount = leads.filter(l => l.status === 'completed').length;
  const intentCount = leads.filter(l => l.intent_strength && l.intent_strength !== 'none').length;
  const totalValue = leads.reduce((sum, l) => sum + (l.total_value || 0), 0);

  // Revenue attribution
  const closedLeads = leads.filter(l => l.lifecycle_stage === 'closed_won' || l.status === 'completed');
  const monthClosedLeads = closedLeads.filter(l => (l.closed_at || l.created_at || '').startsWith(thisMonth));
  const monthRevenue = monthClosedLeads.reduce((sum, l) => sum + (l.closed_value || 0), 0);

  const sorted = [...leads].sort((a, b) => {
    // Primary: freshness_score (חם עכשיו first)
    const aFresh = a.freshness_score ?? 100;
    const bFresh = b.freshness_score ?? 100;
    if (Math.abs(bFresh - aFresh) >= 10) return bFresh - aFresh;
    // Secondary: intent signal
    const aIntent = a.intent_strength && a.intent_strength !== 'none' ? 1 : 0;
    const bIntent = b.intent_strength && b.intent_strength !== 'none' ? 1 : 0;
    if (bIntent !== aIntent) return bIntent - aIntent;
    // Tertiary: AI score
    return (b.score || 0) - (a.score || 0);
  });
  const filtered = activeTab === 'all' ? sorted.filter(l => l.status !== 'lost') : sorted.filter(l => l.status === activeTab);

  const statCards = [
    { label: 'לידים היום', value: todayLeads.length },
    { label: 'חמים', value: hotCount, change: hotCount > 0 ? `+${hotCount}` : null, changeColor: 'text-[#10b981]' },
    { label: 'כוונת קנייה', value: intentCount },
    { label: 'הכנסות החודש', value: monthRevenue > 0 ? `₪${monthRevenue.toLocaleString()}` : '—', change: monthRevenue > 0 ? `${monthClosedLeads.length} עסקאות` : null, changeColor: 'text-[#10b981]' },
  ];

  return (
    <div className="space-y-5">
      {showScan && (
        <ScanOverlay
          businessProfile={businessProfile}
          steps={leadsScanSteps}
          title="סורק לידים..."
          onComplete={() => {
            setShowScan(false);
            queryClient.invalidateQueries({ queryKey: ['leadsPage', bpId] });
          }}
          onClose={() => setShowScan(false)}
        />
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-[16px] font-bold text-foreground tracking-tight">לידים</h1>
        <div className="flex gap-2.5">
          {/* View toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => setViewMode('list')}
              className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-foreground text-background' : 'bg-white text-foreground-muted hover:bg-secondary'}`}>
              <List className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode('pipeline')}
              className={`p-2 transition-colors ${viewMode === 'pipeline' ? 'bg-foreground text-background' : 'bg-white text-foreground-muted hover:bg-secondary'}`}>
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
          {searchState === 'idle' && (
            <button onClick={handleHuntSocialLeads}
              className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 transition-all">
              <Target className="w-4 h-4" /> חפש לידים מסושיאל
            </button>
          )}
          {searchState === 'done' && (
            <button onClick={() => setSearchState('idle')}
              className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium text-green-700 bg-green-50 border border-green-200 hover:bg-green-100 transition-all">
              ✅ {newLeadsCount} לידים חדשים — חפש שוב
            </button>
          )}
          {searchState === 'empty' && (
            <button onClick={() => setSearchState('idle')}
              className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium text-gray-500 bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-all">
              <Target className="w-4 h-4" /> לא נמצאו — נסה שוב
            </button>
          )}
          {searchState === 'running' && (
            <div className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium text-purple-700 bg-purple-50 border border-purple-200">
              <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
              <span>{searchLog[searchLog.length - 1] || 'מחפש...'}</span>
            </div>
          )}
          <button onClick={async () => {
              if (!bpId) return;
              toast.info('מטפח לידים לא פעילים...');
              try {
                const res = await base44.functions.invoke('smartLeadNurture', { businessProfileId: bpId });
                const { nurtured = 0, marked_cold = 0 } = res?.data || {};
                queryClient.invalidateQueries({ queryKey: ['leadsPage', bpId] });
                toast.success(nurtured > 0 || marked_cold > 0 ? `${nurtured} הודעות מעקב · ${marked_cold} קורים` : 'אין לידים שדורשים טיפוח כרגע');
              } catch { toast.error('שגיאה בטיפוח לידים'); }
            }}
            className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-all">
            <RotateCcw className="w-4 h-4" /> טפח לידים
          </button>
          <button onClick={handleEnrich} disabled={enriching}
            className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium text-foreground-secondary bg-secondary border border-border hover:bg-secondary/80 hover:border-border-hover transition-all disabled:opacity-50">
            {enriching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {enriching ? 'מעשיר...' : 'העשר לידים'}
          </button>
          <button onClick={() => setShowAddModal(true)} className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-all">
            <Plus className="w-4 h-4" /> ליד חדש
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map((card, i) => (
          <div key={card.label} className={`card-base p-5 fade-in-up stagger-${i + 1}`}>
            <p className="text-[11px] font-medium text-foreground-muted mb-1">{card.label}</p>
            <span className="text-[28px] font-bold text-foreground leading-none tracking-tight">{card.value}</span>
            {card.change && <p className={`text-[10px] font-semibold mt-1 ${card.changeColor}`}>{card.change}</p>}
          </div>
        ))}
      </div>

      <LeadQualityGuide businessProfile={businessProfile} />

      <AiInsightBox
        title="המלצות לטיפול בלידים — הפעולה הבאה"
        prompt={`אתה יועץ מכירות מומחה. העסק "${businessProfile?.name}" (${businessProfile?.category}, ${businessProfile?.city}).
סטטוס לידים: ${hotCount} חמים, ${warmCount} פושרים, ${coldCount} סוננו, ${todayLeads.length} חדשים היום.
לידים חמים אחרונים: ${leads.filter(l => l.status === 'hot').slice(0, 5).map(l => `${l.name} (${l.service_needed || '?'}, ${l.budget_range || '?'}, מקור: ${l.source || '?'})`).join('; ')}.
הבוט מטפל בלידים אוטומטית. הצע: 1) סדר עדיפויות ליצירת קשר 2) מסרים מותאמים לכל ליד חם 3) טיפים לשיפור שיעור ההמרה. בעברית, Markdown.`}
      />

      {viewMode === 'pipeline' ? (
        <PipelineView leads={leads} businessProfile={businessProfile} />
      ) : (
        <>
          <div className="flex gap-0.5 border-b border-border">
            {filterTabs.map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2.5 text-[12px] font-medium transition-all duration-150 relative ${activeTab === tab.key ? 'text-foreground' : 'text-foreground-muted hover:text-foreground-secondary'}`}>
                {tab.label}
                {activeTab === tab.key && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-t" />}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="card-base py-20 text-center">
              <Target className="w-12 h-12 text-foreground-muted opacity-20 mx-auto mb-3" />
              <p className="text-[13px] text-foreground-muted mb-4">עוד אין לידים</p>
              <button onClick={() => setShowAddModal(true)} className="btn-subtle px-5 py-2.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-all">+ הוסף ליד ראשון</button>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((lead) => (
                <LeadCard key={lead.id} lead={lead} businessProfile={businessProfile} onOpenDetail={() => setSelectedLead(lead)} />
              ))}
            </div>
          )}
        </>
      )}

      {selectedLead && viewMode === 'list' && (
        <LeadDetailPanel
          lead={selectedLead}
          businessProfile={businessProfile}
          stages={stages}
          onClose={() => setSelectedLead(null)}
          onStageChange={(newStage) => {
            base44.entities.Lead.update(selectedLead.id, { lifecycle_stage: newStage, lifecycle_updated_at: new Date().toISOString() });
            queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
            setSelectedLead(null);
          }}
        />
      )}

      {retentionLeads.length > 0 && (
        <div className="card-base p-4">
          <div className="flex items-center gap-2 mb-3">
            <RotateCcw className="w-4 h-4 text-amber-500" />
            <h3 className="text-[13px] font-semibold text-foreground">לקוחות לאיחזור ({retentionLeads.length})</h3>
          </div>
          <div className="space-y-2">
            {retentionLeads.slice(0, 5).map(lead => (
              <div key={lead.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-amber-50 border border-amber-100">
                <div>
                  <span className="text-[13px] font-medium text-foreground">{lead.name}</span>
                  {lead.service_needed && <span className="text-[11px] text-foreground-muted mr-2">— {lead.service_needed}</span>}
                </div>
                {lead.contact_phone && (
                  <a href={`https://wa.me/${lead.contact_phone}`} target="_blank" rel="noreferrer"
                    className="text-[11px] font-medium text-green-600 hover:text-green-700">
                    WhatsApp ←
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showAddModal && <AddLeadModal businessProfile={businessProfile} onClose={() => setShowAddModal(false)} onAdded={() => { queryClient.invalidateQueries({ queryKey: ['leadsPage'] }); queryClient.invalidateQueries({ queryKey: ['hotLeads'] }); setShowAddModal(false); }} />}
    </div>
  );
}