import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Play, AlertCircle, CheckCircle2 } from 'lucide-react';
import DataFreshnessBadge from '@/components/ai/DataFreshnessBadge';
import FeedbackWidget from '@/components/FeedbackWidget';
import { useAuth } from '@/lib/AuthContext';

function timeAgoShort(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'עכשיו';
  if (mins < 60) return `לפני ${mins} דקות`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שעות`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

function nextRunLabel(intervalHours, lastRunAt) {
  if (!lastRunAt) return 'מתוזמן';
  const next = new Date(new Date(lastRunAt).getTime() + intervalHours * 3600000);
  const diff = next.getTime() - Date.now();
  if (diff <= 0) return 'בקרוב';
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `בעוד ${hours} שעות`;
  return `בעוד ${mins} דקות`;
}

// Simulated log lines shown while the agent runs
const LOG_SEQUENCE = [
  '🔄 מאתחל סוכן...',
  '📡 מתחבר למקורות נתונים...',
  '🔍 סורק מידע...',
  '🧠 מנתח תוצאות...',
  '💾 שומר נתונים...',
];

function LiveLogPanel({ isRunning, result }) {
  const [visibleLines, setVisibleLines] = useState([]);
  const timerRef = useRef(null);

  useEffect(() => {
    if (isRunning) {
      setVisibleLines([LOG_SEQUENCE[0]]);
      let idx = 1;
      timerRef.current = setInterval(() => {
        if (idx < LOG_SEQUENCE.length) {
          setVisibleLines(prev => [...prev, LOG_SEQUENCE[idx]]);
          idx++;
        } else {
          clearInterval(timerRef.current);
        }
      }, 800);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isRunning]);

  if (!isRunning && !result) return null;

  return (
    <div className="mt-3 rounded-lg border border-border bg-secondary/30 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-border bg-secondary/50 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
        <span className="text-[10px] font-mono font-medium text-foreground-muted">לוג ריצה</span>
      </div>
      <div className="px-3 py-2 space-y-1 font-mono" dir="ltr">
        {isRunning && visibleLines.map((line, i) => (
          <p key={i} className="text-[10px] text-foreground-secondary leading-relaxed">{line}</p>
        ))}
        {isRunning && (
          <p className="text-[10px] text-foreground-muted opacity-60 animate-pulse">▊</p>
        )}
        {!isRunning && result && (
          <div className={`flex items-start gap-1.5 text-[10px] ${result.ok ? 'text-success' : 'text-[#dc2626]'}`}>
            {result.ok
              ? <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0" />
              : <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />}
            <span className="leading-relaxed" dir="rtl">{result.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgentCard({ agent, isRunning, onRun, lastRunResult, businessProfileId }) {
  const { businessProfile } = useAuth();
  const bpId = businessProfileId || businessProfile?.id;
  const { automation } = agent;
  const lastRun = automation?.last_run_at;
  const lastStatus = automation?.last_run_status;
  const hasRun = !!lastRun;

  let statusColor = '#cccccc';
  let statusText = 'מתוזמן';
  if (isRunning) { statusColor = '#d97706'; statusText = 'רץ...'; }
  else if (hasRun && lastStatus === 'success') { statusColor = '#10b981'; statusText = 'פעיל'; }
  else if (hasRun && lastStatus === 'failed') { statusColor = '#dc2626'; statusText = 'שגיאה'; }

  const lastRunText = hasRun ? timeAgoShort(lastRun) : null;
  const nextRun = agent.intervalHours ? nextRunLabel(agent.intervalHours, lastRun) : null;

  // Record count diff: shown as "+N רשומות" when result contains count info
  const recordDiff = lastRunResult?.ok && lastRunResult?.count != null
    ? lastRunResult.count
    : null;

  return (
    <div
      className="card-base border-r-2 p-5 relative group"
      style={{ borderRightColor: statusColor }}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-2 h-2 rounded-full flex-shrink-0 ring-2 ring-white" style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}40` }} />
        <span className="text-[14px] font-semibold text-foreground">{agent.name}</span>
        <span className="text-[12px] text-foreground-muted font-medium">({agent.nameEn})</span>
        <span className="text-[10px] font-semibold mr-auto tracking-wide uppercase" style={{ color: statusColor }}>{statusText}</span>
      </div>

      <p className="text-[12px] text-foreground-secondary leading-relaxed mb-4">{agent.description}</p>

      <div className="space-y-1.5">
        {hasRun && (
          <div className="flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-2">
              <span className="text-foreground-muted">{agent.lastRunLabel}:</span>
              <DataFreshnessBadge dateStr={lastRun} maxAgeHours={agent.intervalHours * 2} />
            </div>
            {automation && (
              <span className="text-foreground font-medium">
                {automation.successful_runs || 0} רשומות
                {recordDiff != null && recordDiff > 0 && (
                  <span className="text-success ml-1 font-semibold">+{recordDiff}</span>
                )}
              </span>
            )}
          </div>
        )}
        {nextRun && (
          <div className="text-[11px] text-foreground-muted opacity-60">
            ריצה הבאה: {nextRun}
          </div>
        )}
        {hasRun && lastStatus === 'failed' && !isRunning && (
          <div className="flex items-center gap-1.5 text-[11px] text-[#dc2626] bg-[#fef2f2] rounded-md px-2 py-1">
            <AlertCircle className="w-3 h-3" /> הריצה האחרונה נכשלה — נסה שוב
          </div>
        )}
        {!hasRun && !isRunning && (
          <div className="text-[11px] text-foreground-muted opacity-40">טרם רץ</div>
        )}
      </div>

      {/* Live log panel — shows while running + result after */}
      <LiveLogPanel isRunning={isRunning} result={isRunning ? null : lastRunResult} />

      {/* Feedback widget — shown after a run completes */}
      {!isRunning && lastRunResult && (
        <FeedbackWidget
          agentName={agent.functionName}
          outputType="agent_run"
          businessProfileId={bpId}
          compact={true}
        />
      )}

      {onRun && (
        <button
          onClick={onRun}
          disabled={isRunning}
          className="mt-4 btn-subtle flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-medium bg-secondary border border-border hover:bg-secondary/80 hover:border-border-hover text-foreground-secondary disabled:opacity-50"
        >
          {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {isRunning ? 'רץ...' : 'הפעל עכשיו'}
        </button>
      )}
    </div>
  );
}
