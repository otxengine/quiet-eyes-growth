import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

const GOAL_LABELS = {
  new_customers:     { emoji: '🎯', text: 'להביא לקוחות חדשים' },
  retain:            { emoji: '🔁', text: 'לשמר לקוחות קיימים' },
  more_per_customer: { emoji: '📈', text: 'להרוויח יותר מכל לקוח' },
  reviews:           { emoji: '⭐', text: 'לשפר דירוגים וביקורות' },
};

const ALERT_CTA = {
  review:     { label: 'הגב לביקורת', path: '/reviews',     bg: '#dc2626' },
  lead:       { label: 'פתח ליד',     path: '/leads',       bg: '#059669' },
  competitor: { label: 'בדוק מתחרה', path: '/competitors', bg: '#d97706' },
  trend:      { label: 'ראה מגמה',   path: '/intelligence', bg: '#6366f1' },
};
const DEFAULT_ALERT_CTA = { label: 'ראה פרטים', path: '/signals', bg: '#6366f1' };

const SIGNAL_STYLE = {
  threat:      { border: 'border-red-200',     bg: 'bg-red-50',     label: 'ראה מתחרים',   path: '/competitors' },
  opportunity: { border: 'border-emerald-200', bg: 'bg-emerald-50', label: 'גלה הזדמנות',  path: '/leads' },
  trend:       { border: 'border-amber-200',   bg: 'bg-amber-50',   label: 'גלה מגמה',     path: '/intelligence' },
};
const DEFAULT_SIGNAL_STYLE = { border: 'border-[#e5e7eb]', bg: 'bg-white', label: 'ראה פרטים', path: '/signals' };

export default function OnboardingInsights() {
  const location = useLocation();
  const navigate = useNavigate();
  const { businessProfile, signals = [], proactiveAlerts = [] } = location.state || {};

  if (!businessProfile) { navigate('/onboarding'); return null; }

  const completeOnboarding = async (targetPath = '/') => {
    if (businessProfile?.id) {
      await base44.entities.BusinessProfile.update(businessProfile.id, { onboarding_completed: true });
      try { base44.functions.invoke('runFullScan', { businessProfileId: businessProfile.id }, 360000); } catch (_) {}
    }
    sessionStorage.setItem('otx_just_onboarded', '1');
    navigate(targetPath, { state: { fromOnboarding: true } });
  };

  const goal = GOAL_LABELS[businessProfile.business_goal] || { emoji: '🚀', text: 'צמיחה עסקית' };

  // Parse quick wins from agent_missions
  let quickWins = [];
  try {
    const missions = JSON.parse(businessProfile.agent_missions || '{}');
    quickWins = (missions.quick_wins_he || []).slice(0, 3);
  } catch (_) {}

  const topAlerts = (proactiveAlerts || []).filter(a => !a.is_dismissed).slice(0, 3);
  const topSignals = (signals || []).slice(0, 3);

  return (
    <div className="min-h-screen bg-secondary/60 py-8 px-4" dir="rtl">
      <div className="max-w-lg mx-auto space-y-4">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="text-center pb-2">
          <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-full px-4 py-1.5 mb-4">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="text-[13px] font-medium text-emerald-700">הסריקה הושלמה בהצלחה</span>
          </div>
          <h1 className="text-[22px] font-bold text-[#111111] mb-1">התוכנית שלך מוכנה</h1>
          <p className="text-[13px] text-foreground-muted">{businessProfile.name} · {businessProfile.city}</p>
        </div>

        {/* ── Goal banner ─────────────────────────────────────────── */}
        <div className="bg-[#111111] text-white rounded-2xl px-5 py-4 flex items-center gap-4">
          <span className="text-3xl leading-none">{goal.emoji}</span>
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-wider mb-0.5">המטרה שהגדרת</p>
            <p className="text-[16px] font-semibold">{goal.text}</p>
          </div>
        </div>

        {/* ── Quick wins from agent missions ──────────────────────── */}
        {quickWins.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-foreground-muted/70 uppercase tracking-wider px-1 mb-2">
              3 פעולות שיקדמו אותך הכי מהר
            </p>
            <div className="bg-white rounded-2xl border border-border/60 overflow-hidden">
              {quickWins.map((win, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 px-4 py-3.5 ${i < quickWins.length - 1 ? 'border-b border-[#f4f4f4]' : ''}`}
                >
                  <span className="w-6 h-6 rounded-full bg-[#111111] text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-[13px] text-[#222222] leading-snug">{win}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Proactive alerts with direct CTAs ───────────────────── */}
        {topAlerts.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-foreground-muted/70 uppercase tracking-wider px-1 mb-2">
              פעולות שמחכות לך עכשיו
            </p>
            <div className="space-y-2">
              {topAlerts.map((alert, i) => {
                const cta = ALERT_CTA[alert.alert_type] || DEFAULT_ALERT_CTA;
                return (
                  <div key={alert.id || i} className="bg-white border border-border/60 rounded-2xl p-4">
                    <p className="text-[14px] font-semibold text-[#111111] mb-1">{alert.title}</p>
                    {alert.description && (
                      <p className="text-[12px] text-foreground-muted leading-relaxed mb-3">{alert.description}</p>
                    )}
                    <button
                      onClick={() => completeOnboarding(cta.path)}
                      className="text-[12px] font-semibold text-white px-4 py-2 rounded-lg transition-opacity hover:opacity-90 flex items-center gap-1.5"
                      style={{ backgroundColor: cta.bg }}
                    >
                      {cta.label} <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Market signals ───────────────────────────────────────── */}
        {topSignals.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-foreground-muted/70 uppercase tracking-wider px-1 mb-2">
              מה הסוכן גילה על השוק שלך
            </p>
            <div className="space-y-2">
              {topSignals.map((signal, i) => {
                const style = SIGNAL_STYLE[signal.category] || DEFAULT_SIGNAL_STYLE;
                return (
                  <div key={signal.id || i} className={`border ${style.border} ${style.bg} rounded-2xl p-4`}>
                    <p className="text-[13px] font-semibold text-[#111111] mb-1">{signal.summary}</p>
                    {signal.recommended_action && (
                      <p className="text-[12px] text-foreground-secondary leading-relaxed mb-3">{signal.recommended_action}</p>
                    )}
                    <button
                      onClick={() => completeOnboarding(style.path)}
                      className="text-[12px] font-semibold text-[#111111] underline underline-offset-2 hover:no-underline transition-all"
                    >
                      {style.label} ←
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Main CTA ─────────────────────────────────────────────── */}
        <div className="pt-2 pb-6">
          <button
            onClick={() => completeOnboarding('/')}
            className="w-full h-14 text-[14px] font-semibold bg-[#111111] hover:bg-[#2a2a2a] text-white rounded-2xl transition-colors flex items-center justify-center gap-2"
          >
            כניסה למרכז הפיקוד
            <ArrowLeft className="w-5 h-5" />
          </button>
          <p className="text-[11px] text-foreground-muted/70 text-center mt-3">
            הסוכנים ימשיכו לעבוד ברקע — תקבל עדכונים בזמן אמת
          </p>
        </div>

      </div>
    </div>
  );
}
