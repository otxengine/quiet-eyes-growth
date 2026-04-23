import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, RefreshCw, ChevronDown, ChevronUp, ClipboardList } from 'lucide-react';
import WeeklyScoreRing from './WeeklyScoreRing';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'עכשיו';
  if (mins < 60) return `לפני ${mins} דקות`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שעות`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

export default function MorningBriefing({ businessProfile, stats }) {
  const navigate = useNavigate();
  const bpId = businessProfile?.id;
  const [animate, setAnimate] = useState(true);

  // Collapsed by default; persisted in localStorage
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('morningBrief_expanded') !== 'true';
    } catch {
      return true;
    }
  });

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem('morningBrief_expanded', next ? 'false' : 'true');
    } catch {}
  };

  const { data: briefingData, isLoading, refetch } = useQuery({
    queryKey: ['morningBriefing', bpId],
    queryFn: async () => {
      const res = await base44.functions.invoke('generateMorningBriefing', { businessProfileId: bpId });
      return res?.data ?? null;
    },
    enabled: !!bpId,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const briefing = briefingData?.briefing;
  const lines = briefing?.lines || [];
  // FIX 3: null = no data yet (show "—"), 0 = real score of zero
  const weeklyScore = briefing ? (briefing.weekly_score ?? null) : null;
  const scoreTrend = briefing?.score_trend || 'stable';
  const sourceCount = briefing?.source_count || 0;
  const generatedAt = briefingData?.generated_at;

  const hour = new Date().getHours();
  const briefingTitle = hour >= 5 && hour < 12 ? 'תדריך בוקר' : hour >= 12 && hour < 17 ? 'תדריך צהריים' : hour >= 17 && hour < 21 ? 'תדריך ערב' : 'תדריך לילה';
  const greeting = hour >= 5 && hour < 12 ? 'בוקר טוב' : hour >= 12 && hour < 17 ? 'צהריים טובים' : hour >= 17 && hour < 21 ? 'ערב טוב' : 'לילה טוב';

  const actions = [
    stats?.negativeReviews > 0 && { label: `הגב לביקורת ←`, path: '/reviews' },
    stats?.hotLeads > 0 && { label: `צפה בלידים ←`, path: '/leads' },
    stats?.competitorChanges > 0 && { label: `בדוק מתחרים ←`, path: '/competitors' },
    stats?.unreadSignals > 0 && { label: `צפה בתובנות ←`, path: '/signals' },
  ].filter(Boolean);

  return (
    <div
      className="rounded-xl border border-border bg-white overflow-hidden mb-4 card-lifted"
      style={{ borderTop: '3px solid hsl(var(--primary))' }}
    >
      {/* ── Header — always visible, exactly 72px ─────────────────────── */}
      <div
        className="flex items-center justify-between px-5 cursor-pointer select-none"
        style={{ height: '72px' }}
        onClick={toggleCollapsed}
      >
        {/* Right: icon + title + timestamp (RTL — appears on the right) */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <ClipboardList className="w-4 h-4 text-primary flex-shrink-0 opacity-70" />
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-foreground leading-tight">{briefingTitle}</h2>
            <span className="flex items-center gap-1 text-[10px] text-foreground-muted">
              <span className="w-[5px] h-[5px] rounded-full bg-success inline-block flex-shrink-0" />
              {isLoading ? 'מעדכן...' : timeAgo(generatedAt)}
            </span>
          </div>
        </div>

        {/* Center: compact weekly score ring */}
        <div className="flex flex-col items-center flex-shrink-0 mx-3">
          <WeeklyScoreRing score={weeklyScore} size={48} />
          <span className="text-[8px] text-foreground-muted mt-0.5 whitespace-nowrap">ציון שבועי</span>
        </div>

        {/* Left: refresh + chevron + LIVE dot (RTL — appears on the left) */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isLoading && (
            <button
              onClick={(e) => { e.stopPropagation(); refetch(); }}
              className="p-1 rounded hover:bg-secondary transition-colors"
              title="רענן תדריך"
            >
              <RefreshCw className="w-3 h-3 text-foreground-muted" />
            </button>
          )}
          {collapsed
            ? <ChevronDown className="w-4 h-4 text-foreground-muted opacity-50" />
            : <ChevronUp className="w-4 h-4 text-foreground-muted opacity-50" />
          }
        </div>
      </div>

      {/* ── Collapsible body ──────────────────────────────────────────── */}
      <div
        style={{
          maxHeight: collapsed ? 0 : '220px',
          overflow: 'hidden',
          transition: 'max-height 0.2s ease',
        }}
      >
        <div className="px-5 pb-4 border-t border-border/50">
          <p className="text-[11px] text-foreground-muted mt-3 mb-2">{greeting}, {businessProfile?.name}</p>

          {isLoading ? (
            <div className="space-y-2.5">
              {[1,2,3].map(i => (
                <div key={i} className="h-5 bg-border/50 rounded animate-pulse" style={{ width: `${85 - i * 10}%` }} />
              ))}
            </div>
          ) : lines.length > 0 ? (
            <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: '100px' }}>
              {lines.map((line, i) => (
                <div
                  key={i}
                  onClick={() => navigate(line.link || '/signals')}
                  className="flex items-start gap-2 cursor-pointer group rounded-lg px-2 py-1 -mx-2 hover:bg-secondary/50 transition-all"
                  style={animate ? { animation: `fade-in-up 0.3s ease-out ${i * 0.1}s both` } : undefined}
                >
                  <span className="text-[12px] leading-none mt-0.5 flex-shrink-0">{line.emoji}</span>
                  <span className="text-[11px] text-foreground-secondary leading-snug group-hover:text-foreground transition-colors">
                    {line.text}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-success">הכל שקט — המערכת ממשיכה לעקוב 24/7 ✓</p>
          )}

          {/* Quick actions + today's actions in one compact row */}
          {!isLoading && (
            <div className="flex flex-wrap items-center gap-2 mt-3 pt-2 border-t border-border/40">
              {actions.slice(0, 3).map((action) => (
                <button
                  key={action.path}
                  onClick={(e) => { e.stopPropagation(); navigate(action.path); }}
                  className="btn-subtle px-2.5 py-1 rounded-md text-[10px] font-medium text-foreground-muted bg-white border border-border hover:border-border-hover hover:text-foreground transition-all"
                >
                  {action.label}
                </button>
              ))}
              {sourceCount > 0 && (
                <span className="text-[9px] text-foreground-muted opacity-50 mr-auto">
                  {sourceCount} מקורות
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}