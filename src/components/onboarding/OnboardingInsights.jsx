import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import KoriAvatar from './KoriAvatar';

const GOAL_LABELS = {
  new_customers:     { emoji: '🎯', text: 'להביא לקוחות חדשים' },
  retain:            { emoji: '🔁', text: 'לשמר לקוחות קיימים' },
  more_per_customer: { emoji: '📈', text: 'להרוויח יותר מכל לקוח' },
  reviews:           { emoji: '⭐', text: 'לשפר דירוגים וביקורות' },
};

const ALERT_CTA = {
  review:     { label: 'הגב לביקורת', path: '/reviews',      bg: '#dc2626' },
  lead:       { label: 'פתח ליד',     path: '/leads',        bg: '#059669' },
  competitor: { label: 'בדוק מתחרה', path: '/competitors',  bg: '#d97706' },
  trend:      { label: 'ראה מגמה',   path: '/intelligence', bg: '#6366f1' },
};
const DEFAULT_ALERT_CTA = { label: 'ראה פרטים', path: '/signals', bg: '#e8344d' };

const SIGNAL_STYLE = {
  threat:      { border: 'border-red-200',     bg: 'bg-red-50',     label: 'ראה מתחרים',  path: '/competitors' },
  opportunity: { border: 'border-emerald-200', bg: 'bg-emerald-50', label: 'גלה הזדמנות', path: '/leads' },
  trend:       { border: 'border-amber-200',   bg: 'bg-amber-50',   label: 'גלה מגמה',    path: '/intelligence' },
};
const DEFAULT_SIGNAL_STYLE = { border: 'border-gray-200', bg: 'bg-white', label: 'ראה פרטים', path: '/signals' };

const BG_STYLE = {
  backgroundColor: '#f5f5f7',
  backgroundImage: 'radial-gradient(circle, #d1d1d1 1px, transparent 1px)',
  backgroundSize: '24px 24px',
};

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

  let quickWins = [];
  try {
    const missions = JSON.parse(businessProfile.agent_missions || '{}');
    quickWins = (missions.quick_wins_he || []).slice(0, 3);
  } catch (_) {}

  const topAlerts = (proactiveAlerts || []).filter(a => !a.is_dismissed).slice(0, 3);
  const topSignals = (signals || []).slice(0, 3);

  return (
    <div dir="rtl" className="min-h-screen py-8 px-4" style={BG_STYLE}>
      <div className="max-w-lg mx-auto space-y-4">

        {/* ── Header with Kori ─────────────────────────────── */}
        <div className="text-center pb-2">
          <KoriAvatar size="md" className="mx-auto mb-4 shadow-md" />
          <div className="inline-flex items-center gap-2 bg-white border border-emerald-200 rounded-full px-4 py-1.5 mb-4">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span className="text-[13px] font-medium text-emerald-700">הסריקה הושלמה בהצלחה</span>
          </div>
          <h1 className="text-[22px] font-bold text-gray-900 mb-1">התוכנית שלך מוכנה</h1>
          <p className="text-[13px] text-gray-500">{businessProfile.name} · {businessProfile.city}</p>
        </div>

        {/* ── Goal banner ──────────────────────────────────── */}
        <div
          className="text-white rounded-2xl px-5 py-4 flex items-center gap-4"
          style={{ background: 'linear-gradient(135deg, #9c27b0 0%, #e8344d 100%)' }}
        >
          <span className="text-3xl leading-none">{goal.emoji}</span>
          <div>
            <p className="text-[10px] text-white/60 uppercase tracking-wider mb-0.5">המטרה שהגדרת</p>
            <p className="text-[16px] font-semibold">{goal.text}</p>
          </div>
        </div>

        {/* ── Quick wins ───────────────────────────────────── */}
        {quickWins.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-1 mb-2">
              3 פעולות שיקדמו אותך הכי מהר
            </p>
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              {quickWins.map((win, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 px-4 py-3.5 ${i < quickWins.length - 1 ? 'border-b border-gray-100' : ''}`}
                >
                  <span
                    className="w-6 h-6 rounded-full text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: 'linear-gradient(135deg, #9c27b0 0%, #e8344d 100%)' }}
                  >
                    {i + 1}
                  </span>
                  <p className="text-[13px] text-gray-800 leading-snug">{win}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Proactive alerts ─────────────────────────────── */}
        {topAlerts.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-1 mb-2">
              פעולות שמחכות לך עכשיו
            </p>
            <div className="space-y-2">
              {topAlerts.map((alert, i) => {
                const cta = ALERT_CTA[alert.alert_type] || DEFAULT_ALERT_CTA;
                return (
                  <div key={alert.id || i} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                    <p className="text-[14px] font-semibold text-gray-900 mb-1">{alert.title}</p>
                    {alert.description && (
                      <p className="text-[12px] text-gray-500 leading-relaxed mb-3">{alert.description}</p>
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

        {/* ── Market signals ───────────────────────────────── */}
        {topSignals.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-1 mb-2">
              מה קורי גילה על השוק שלך
            </p>
            <div className="space-y-2">
              {topSignals.map((signal, i) => {
                const style = SIGNAL_STYLE[signal.category] || DEFAULT_SIGNAL_STYLE;
                return (
                  <div key={signal.id || i} className={`border ${style.border} ${style.bg} rounded-2xl p-4`}>
                    <p className="text-[13px] font-semibold text-gray-900 mb-1">{signal.summary}</p>
                    {signal.recommended_action && (
                      <p className="text-[12px] text-gray-500 leading-relaxed mb-3">{signal.recommended_action}</p>
                    )}
                    <button
                      onClick={() => completeOnboarding(style.path)}
                      className="text-[12px] font-semibold text-[#e8344d] underline underline-offset-2 hover:no-underline transition-all"
                    >
                      {style.label} ←
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Main CTA ─────────────────────────────────────── */}
        <div className="pt-2 pb-8">
          <button
            onClick={() => completeOnboarding('/')}
            className="w-full h-14 text-[14px] font-semibold text-white rounded-2xl transition-colors flex items-center justify-center gap-2 shadow-md hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #9c27b0 0%, #e8344d 100%)' }}
          >
            כניסה למרכז הפיקוד
            <ArrowLeft className="w-5 h-5" />
          </button>
          <p className="text-[11px] text-gray-400 text-center mt-3">
            הסוכנים ימשיכו לעבוד ברקע — תקבל עדכונים בזמן אמת
          </p>
        </div>

      </div>
    </div>
  );
}
