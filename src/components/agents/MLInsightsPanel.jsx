import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Brain, TrendingUp, TrendingDown, Zap, Loader2 } from 'lucide-react';

export default function MLInsightsPanel({ businessProfile }) {
  const bpId = businessProfile?.id;

  const { data: sk, isLoading } = useQuery({
    queryKey: ['sectorKnowledge', bpId],
    queryFn: () => base44.entities.SectorKnowledge.filter({ linked_business: bpId }),
    enabled: !!bpId,
    select: (data) => data[0],
  });

  if (isLoading) {
    return (
      <div className="card-base p-5 flex items-center justify-center gap-2 text-foreground-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-[12px]">טוען נתוני ML...</span>
      </div>
    );
  }

  if (!sk?.ml_last_run) {
    return (
      <div className="card-base p-5 text-center">
        <Brain className="w-8 h-8 text-foreground-muted opacity-30 mx-auto mb-2" />
        <p className="text-[12px] text-foreground-muted">מנוע ML לא הופעל עדיין</p>
        <p className="text-[11px] text-foreground-muted mt-1">הרץ "המוח" בדף הסוכנים</p>
      </div>
    );
  }

  let crossInsights = [];
  let positiveTopics = [];
  let negativeTopics = [];
  let winnerDNA = null;

  try { crossInsights = JSON.parse(sk.agent_insights || '[]'); } catch (_) {}
  try { positiveTopics = JSON.parse(sk.top_review_topics_positive || '[]'); } catch (_) {}
  try { negativeTopics = JSON.parse(sk.top_review_topics_negative || '[]'); } catch (_) {}
  try { winnerDNA = JSON.parse(sk.winner_lead_dna || 'null'); } catch (_) {}

  const lastRunDate = sk.ml_last_run
    ? new Date(sk.ml_last_run).toLocaleDateString('he-IL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="space-y-4">
      <div className="card-base p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-indigo-500" />
            <h3 className="text-[13px] font-semibold text-foreground">תובנות ML</h3>
          </div>
          {lastRunDate && <span className="text-[10px] text-foreground-muted">{lastRunDate}</span>}
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="text-center">
            <p className="text-[22px] font-bold text-green-600">{sk.wins_count || 0}</p>
            <p className="text-[10px] text-foreground-muted">עסקאות שנסגרו</p>
          </div>
          <div className="text-center">
            <p className="text-[22px] font-bold text-foreground">{sk.conversion_rate || 0}%</p>
            <p className="text-[10px] text-foreground-muted">שיעור המרה</p>
          </div>
          <div className="text-center">
            <p className="text-[22px] font-bold text-red-500">{sk.competitor_threat_score || 0}</p>
            <p className="text-[10px] text-foreground-muted">סיכון תחרותי</p>
          </div>
        </div>

        {winnerDNA && (
          <div className="bg-green-50 rounded-lg p-3 mb-3">
            <p className="text-[11px] font-semibold text-green-700 mb-1.5 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> DNA של עסקאות מוצלחות
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(winnerDNA.top_services || []).slice(0, 3).map(s => (
                <span key={s} className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{s}</span>
              ))}
              {(winnerDNA.top_sources || []).slice(0, 2).map(s => (
                <span key={s} className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{s}</span>
              ))}
            </div>
          </div>
        )}

        {(positiveTopics.length > 0 || negativeTopics.length > 0) && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            {positiveTopics.length > 0 && (
              <div className="bg-emerald-50 rounded-lg p-2.5">
                <p className="text-[10px] font-semibold text-emerald-700 mb-1">חיובי בביקורות</p>
                {positiveTopics.slice(0, 3).map(t => (
                  <p key={t} className="text-[10px] text-emerald-600">· {t}</p>
                ))}
              </div>
            )}
            {negativeTopics.length > 0 && (
              <div className="bg-red-50 rounded-lg p-2.5">
                <p className="text-[10px] font-semibold text-red-600 mb-1 flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" /> שלילי בביקורות
                </p>
                {negativeTopics.slice(0, 3).map(t => (
                  <p key={t} className="text-[10px] text-red-500">· {t}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {crossInsights.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-foreground-muted mb-2 flex items-center gap-1">
              <Zap className="w-3 h-3" /> תובנות חוצות-מקורות
            </p>
            <div className="space-y-2">
              {crossInsights.slice(0, 3).map((ins, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className="text-[10px] font-bold text-indigo-500 mt-0.5 shrink-0">{ins.confidence || 70}%</span>
                  <div>
                    <p className="text-[11px] text-foreground">{ins.insight}</p>
                    {ins.action && <p className="text-[10px] text-foreground-muted mt-0.5">→ {ins.action}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
