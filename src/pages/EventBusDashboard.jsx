import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import {
  Activity, Zap, GitBranch, Layers, CheckCircle2, Clock,
  XCircle, AlertTriangle, RefreshCw, Loader2, Bot, ChevronDown, ChevronUp
} from 'lucide-react';

const STATUS_COLOR = {
  pending:    'bg-amber-100 text-amber-700',
  routing:    'bg-blue-100 text-blue-700',
  dispatched: 'bg-indigo-100 text-indigo-700',
  processed:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-700',
};

const EVENT_TYPE_LABEL = {
  competitor_change: '🏆 שינוי מתחרה',
  new_review:        '⭐ ביקורת חדשה',
  market_signal:     '📊 סיגנל שוק',
  local_event:       '🎯 אירוע מקומי',
  sports_match:      '⚽ משחק ספורט',
  hot_lead:          '🔥 ליד חם',
  retention_risk:    '⚠️ סיכון שימור',
  social_signal:     '📱 סיגנל חברתי',
  price_change:      '💰 שינוי מחיר',
};

const FUSION_TYPE_LABEL = {
  temporal:  'זמני',
  geographic: 'גיאוגרפי',
  semantic:  'סמנטי',
  multi:     'מרובה',
};

function StatCard({ label, value, icon: Icon, color = 'text-foreground' }) {
  return (
    <div className="card-base p-4 flex items-center gap-3">
      <Icon className={`w-5 h-5 ${color} flex-shrink-0`} />
      <div>
        <p className="text-[20px] font-bold text-foreground">{value ?? '—'}</p>
        <p className="text-[10px] text-foreground-muted">{label}</p>
      </div>
    </div>
  );
}

function EventRow({ event }) {
  const [expanded, setExpanded] = useState(false);
  let payload = {};
  let agents = [];
  try { payload = JSON.parse(event.payload || '{}'); } catch {}
  try { agents = JSON.parse(event.dispatched_to || '[]'); } catch {}

  const relTime = (() => {
    const ms = Date.now() - new Date(event.created_at).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 60) return `${m}ד' לפני`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}ש' לפני`;
    return `${Math.floor(h / 24)}י' לפני`;
  })();

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/50 transition-all text-right"
      >
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[event.routing_status] || 'bg-gray-100 text-gray-600'}`}>
          {event.routing_status}
        </span>
        <span className="text-[11px] font-medium text-foreground flex-1 text-right">
          {EVENT_TYPE_LABEL[event.event_type] || event.event_type}
        </span>
        <span className="text-[10px] text-foreground-muted">{event.source}</span>
        <span className="text-[10px] text-foreground-muted">{relTime}</span>
        {expanded ? <ChevronUp className="w-3 h-3 text-foreground-muted" /> : <ChevronDown className="w-3 h-3 text-foreground-muted" />}
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 bg-secondary/20 space-y-2">
          {agents.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] text-foreground-muted">agents:</span>
              {agents.map(a => (
                <span key={a} className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                  {a}
                </span>
              ))}
            </div>
          )}
          {Object.keys(payload).length > 0 && (
            <pre className="text-[10px] text-foreground-muted bg-white/60 rounded p-2 overflow-auto max-h-24">
              {JSON.stringify(payload, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function RuleRow({ rule }) {
  let agents = [];
  let conditions = [];
  try { agents = JSON.parse(rule.target_agents || '[]'); } catch {}
  try { conditions = JSON.parse(rule.conditions || '[]'); } catch {}

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
            rule.is_active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500 border-gray-200'
          }`}>
            {rule.is_active ? 'פעיל' : 'כבוי'}
          </span>
          <span className="text-[11px] font-mono text-foreground">{rule.event_type}</span>
          <span className="text-[10px] text-foreground-muted">עדיפות {rule.priority}</span>
        </div>
        {rule.description && <p className="text-[10px] text-foreground-muted mt-0.5">{rule.description}</p>}
        {conditions.length > 0 && (
          <p className="text-[10px] text-amber-600 mt-0.5">
            תנאים: {conditions.map(c => `${c.field} ${c.op} ${c.value}`).join(' AND ')}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {agents.map(a => (
          <span key={a} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono">
            {a.replace('generate', 'gen').replace('run', '')}
          </span>
        ))}
      </div>
    </div>
  );
}

function CompositeRow({ signal }) {
  let selected = null;
  try { selected = JSON.parse(signal.selected_action || 'null'); } catch {}

  return (
    <div className="card-base p-3 space-y-1">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
          signal.status === 'scored' ? 'bg-blue-100 text-blue-700' :
          signal.status === 'executed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
        }`}>{signal.status}</span>
        <span className="text-[10px] text-foreground-muted">{FUSION_TYPE_LABEL[signal.fusion_type] || signal.fusion_type} fusion</span>
        {signal.composite_score && (
          <span className="text-[10px] font-bold text-foreground">ציון: {Math.round(signal.composite_score)}</span>
        )}
      </div>
      {selected && (
        <p className="text-[11px] text-foreground">{selected.label || selected.type}</p>
      )}
      <p className="text-[10px] text-foreground-muted">
        {new Date(signal.created_at).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  );
}

export function EventBusPanel({ bpId }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('events');

  const { data: stats, isLoading, isFetching } = useQuery({
    queryKey: ['eventBusStats', bpId],
    queryFn: () => base44.functions.invoke('getEventBusStats', { businessProfileId: bpId }),
    enabled: !!bpId,
    refetchInterval: 30000,
  });

  const triggerBus = useMutation({
    mutationFn: () => base44.functions.invoke('processEventBus', { businessProfileId: bpId }),
    onSuccess: (res) => {
      toast.success(`עיבוד הושלם — ${res.actions_created || 0} פעולות נוצרו`);
      queryClient.invalidateQueries({ queryKey: ['eventBusStats'] });
    },
    onError: () => toast.error('שגיאה בעיבוד ה-Bus'),
  });

  const eventCounts = stats?.event_counts || {};
  const totalEvents = Object.values(eventCounts).reduce((s, v) => s + v, 0);
  const agentFreq = stats?.agent_frequency || {};
  const topAgents = Object.entries(agentFreq).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const tabs = [
    { key: 'events',   label: `אירועים (${stats?.recent_events?.length || 0})` },
    { key: 'rules',    label: `חוקי ניתוב (${stats?.routing_rules?.length || 0})` },
    { key: 'signals',  label: `Composite (${stats?.composite_signals?.length || 0})` },
  ];

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
          <Activity className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-[16px] font-bold text-foreground">Event Bus Dashboard</h1>
          <p className="text-[11px] text-foreground-muted">ניטור פעילות מערכת OTX — ב-24 שעות האחרונות</p>
        </div>
        <button
          onClick={() => triggerBus.mutate()}
          disabled={triggerBus.isPending}
          className="mr-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium transition-all disabled:opacity-60"
        >
          {triggerBus.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          הפעל עיבוד
        </button>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['eventBusStats'] })}
          className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-secondary transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="אירועים (24ש')" value={totalEvents} icon={Activity} color="text-indigo-600" />
        <StatCard label="עובדו" value={eventCounts.processed || 0} icon={CheckCircle2} color="text-green-600" />
        <StatCard label="ממתינות לאישור" value={stats?.pending_actions?.length || 0} icon={Clock} color="text-amber-600" />
        <StatCard label="Composite Signals" value={stats?.composite_signals?.length || 0} icon={Layers} color="text-purple-600" />
      </div>

      {/* Event type breakdown */}
      {Object.keys(eventCounts).length > 0 && (
        <div className="card-base p-4">
          <p className="text-[11px] font-semibold text-foreground mb-3">סטטוס אירועים</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(eventCounts).map(([status, count]) => (
              <div key={status} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium ${STATUS_COLOR[status] || 'bg-gray-100 text-gray-600'}`}>
                <span className="font-bold">{count}</span>
                <span>{status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top activated agents */}
      {topAgents.length > 0 && (
        <div className="card-base p-4">
          <p className="text-[11px] font-semibold text-foreground mb-3 flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5 text-indigo-500" /> סוכנים מופעלים לרוב
          </p>
          <div className="flex flex-wrap gap-2">
            {topAgents.map(([agent, count]) => (
              <div key={agent} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-100 text-[11px]">
                <span className="font-bold text-indigo-700">{count}×</span>
                <span className="text-foreground font-mono text-[10px]">{agent}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-secondary rounded-lg p-1 w-fit">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-[11px] font-medium transition-all ${
              tab === t.key ? 'bg-white text-foreground shadow-sm' : 'text-foreground-muted hover:text-foreground'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
        </div>
      ) : (
        <>
          {tab === 'events' && (
            <div className="space-y-2">
              {(stats?.recent_events || []).length === 0 ? (
                <div className="card-base p-8 text-center text-foreground-muted text-[12px]">אין אירועים עדיין</div>
              ) : (stats?.recent_events || []).map(ev => (
                <EventRow key={ev.id} event={ev} />
              ))}
            </div>
          )}
          {tab === 'rules' && (
            <div className="card-base p-4">
              {(stats?.routing_rules || []).map(rule => (
                <RuleRow key={rule.id} rule={rule} />
              ))}
            </div>
          )}
          {tab === 'signals' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(stats?.composite_signals || []).length === 0 ? (
                <div className="col-span-2 card-base p-8 text-center text-foreground-muted text-[12px]">אין Composite Signals עדיין</div>
              ) : (stats?.composite_signals || []).map(s => (
                <CompositeRow key={s.id} signal={s} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function EventBusDashboard() {
  const { businessProfile } = useOutletContext();
  return <EventBusPanel bpId={businessProfile?.id} />;
}
