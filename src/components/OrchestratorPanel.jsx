import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Activity } from 'lucide-react';

const OTX_AGENTS = [
  { key: 'SignalCollector',           label: 'אותות' },
  { key: 'EventCollector',            label: 'אירועים' },
  { key: 'CompetitorSnapshotAgent',   label: 'מתחרים' },
  { key: 'IntentClassifier',          label: 'כוונה' },
  { key: 'TrendRadar',               label: 'מגמות' },
  { key: 'EventImpactEngine',         label: 'השפעה' },
  { key: 'ProfileIntelligence',       label: 'פרופיל' },
  { key: 'MarketMemoryEngine',        label: 'זיכרון' },
  { key: 'ActionScoringService',      label: 'ניקוד' },
  { key: 'MetaConfigurator',          label: 'קונפיג' },
  { key: 'ViralCatalyst',            label: 'ויראלי' },
  { key: 'InfluenceIntegrityAuditor', label: 'אמינות' },
  { key: 'DeepContextVisionAgent',    label: 'ויז\'ן' },
  { key: 'RetentionSentinel',        label: 'שימור' },
  { key: 'NegotiationPricingCoach',   label: 'תמחור' },
  { key: 'CampaignAutoPilot',        label: 'קמפיין' },
  { key: 'ServiceExpansionScout',     label: 'הרחבה' },
  { key: 'ReputationWarRoom',        label: 'מוניטין' },
];

function statusColor(status, lastPing) {
  if (!lastPing) return '#94a3b8'; // gray — never run
  const ageMs = Date.now() - new Date(lastPing).getTime();
  if (status === 'ERROR') return '#dc2626';
  if (status === 'DELAYED' || ageMs > 4 * 3600000) return '#d97706'; // older than 4h
  return '#10b981';
}

function timeAgo(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'עכשיו';
  if (mins < 60) return `${mins}ד`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}ש`;
  return `${Math.floor(h / 24)}י`;
}

async function fetchOrchestratorStatus() {
  const API_BASE = import.meta.env.VITE_API_URL || '/api';
  const token = window.__clerk?.session
    ? await window.__clerk.session.getToken().catch(() => null)
    : null;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : { 'x-dev-user': localStorage.getItem('dev_user_id') || 'dev-user' }),
  };
  const res = await fetch(`${API_BASE}/agents/status`, { headers });
  if (!res.ok) throw new Error('status fetch failed');
  return res.json();
}

export default function OrchestratorPanel() {
  const [expanded, setExpanded] = useState(false);

  const { data } = useQuery({
    queryKey: ['orchestratorStatus'],
    queryFn: fetchOrchestratorStatus,
    refetchInterval: 30000,
    retry: false,
  });

  const heartbeats = data?.heartbeats ?? [];
  const busStats   = data?.busStats ?? { total: 0, pending: 0, processed: 0, last_event_at: null };
  const events     = data?.recentEvents ?? [];

  // Build lookup: agent_name → heartbeat
  const hbMap = {};
  for (const hb of heartbeats) hbMap[hb.agent_name] = hb;

  const okCount      = OTX_AGENTS.filter(a => hbMap[a.key]?.status === 'OK').length;
  const errorCount   = OTX_AGENTS.filter(a => hbMap[a.key]?.status === 'ERROR').length;
  const neverCount   = OTX_AGENTS.filter(a => !hbMap[a.key]).length;

  return (
    <div className="mb-4 rounded-xl border border-border bg-card overflow-hidden">
      {/* Header strip — always visible */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/30 transition-colors"
      >
        <Activity className="w-3.5 h-3.5 text-foreground-muted flex-shrink-0" />
        <span className="text-[11px] font-semibold text-foreground">OTXEngine — מרכז פיקוד</span>

        {/* Agent dots summary */}
        <div className="flex items-center gap-1.5 mr-2">
          {OTX_AGENTS.slice(0, 9).map(a => {
            const hb = hbMap[a.key];
            const color = statusColor(hb?.status, hb?.last_ping_utc);
            return (
              <span
                key={a.key}
                title={`${a.label}: ${hb?.status ?? 'לא רץ'}`}
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: color }}
              />
            );
          })}
          {OTX_AGENTS.length > 9 && (
            <span className="text-[9px] text-foreground-muted">+{OTX_AGENTS.length - 9}</span>
          )}
        </div>

        {/* Stats badges */}
        <div className="flex items-center gap-2 mr-auto">
          {errorCount > 0 && (
            <span className="text-[10px] font-semibold text-[#dc2626] bg-red-50 px-1.5 py-0.5 rounded">
              {errorCount} שגיאות
            </span>
          )}
          <span className="text-[10px] text-foreground-muted">
            {okCount}/{OTX_AGENTS.length} פעילים
          </span>
          {busStats.total > 0 && (
            <span className="text-[10px] text-foreground-muted border-r border-border pr-2 mr-1">
              {busStats.total} אירועים/שעה
            </span>
          )}
        </div>

        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-foreground-muted flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-foreground-muted flex-shrink-0" />}
      </button>

      {/* Expanded detail grid */}
      {expanded && (
        <div className="border-t border-border px-4 py-3">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
            {OTX_AGENTS.map(a => {
              const hb = hbMap[a.key];
              const color = statusColor(hb?.status, hb?.last_ping_utc);
              return (
                <div
                  key={a.key}
                  className="flex flex-col items-center gap-1 px-2 py-2 rounded-lg bg-secondary/40 border border-border hover:bg-secondary/70 transition-colors"
                  title={hb?.error_message || hb?.status || 'טרם רץ'}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                  <span className="text-[10px] font-medium text-foreground text-center leading-tight">{a.label}</span>
                  {hb?.last_ping_utc && (
                    <span className="text-[9px] text-foreground-muted">{timeAgo(hb.last_ping_utc)}</span>
                  )}
                  {!hb && (
                    <span className="text-[9px] text-foreground-muted opacity-40">לא רץ</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bus activity */}
          {events.length > 0 && (
            <div className="border-t border-border pt-2">
              <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">פעילות BUS אחרונה</p>
              <div className="space-y-1">
                {events.slice(0, 5).map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] text-foreground-secondary">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/40 flex-shrink-0" />
                    <span className="font-medium text-foreground">{e.source_agent}</span>
                    <span className="text-foreground-muted">→</span>
                    <span className="font-mono text-[9px]">{e.event_type}</span>
                    <span className="text-foreground-muted opacity-50 mr-auto">{timeAgo(e.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 mt-2 pt-2 border-t border-border">
            {[
              { color: '#10b981', label: 'פעיל' },
              { color: '#d97706', label: 'מאוחר' },
              { color: '#dc2626', label: 'שגיאה' },
              { color: '#94a3b8', label: 'לא רץ' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                <span className="text-[9px] text-foreground-muted">{label}</span>
              </div>
            ))}
            {neverCount > 0 && (
              <span className="text-[9px] text-foreground-muted mr-auto">{neverCount} סוכנים לא הופעלו עדיין</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
