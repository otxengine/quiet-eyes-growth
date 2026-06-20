/**
 * DailyBriefPanel — AI-powered daily action brief
 *
 * Self-contained: fetches signals, alerts, reviews, leads internally.
 * Caches LLM output in localStorage keyed by bpId + today's date.
 * Auto-generates on first mount; "עדכן" button forces regeneration.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';

const PRIORITY = {
  0: { dot: 'bg-red-500',    border: 'border-r-red-400',    badge: 'bg-red-50 text-red-700',       label: 'דחוף'   },
  1: { dot: 'bg-orange-400', border: 'border-r-orange-300', badge: 'bg-orange-50 text-orange-700', label: 'היום'   },
  2: { dot: 'bg-blue-400',   border: 'border-r-blue-300',   badge: 'bg-blue-50 text-blue-700',     label: 'השבוע'  },
};

const VALID_LINKS = new Set([
  '/reviews', '/leads', '/retention', '/marketing',
  '/marketing/create', '/competitors', '/insights',
]);

function cacheKey(bpId) {
  const today = new Date().toISOString().slice(0, 10);
  return `daily_brief_${bpId}_${today}`;
}
function readCache(bpId) {
  try { return JSON.parse(localStorage.getItem(cacheKey(bpId)) || 'null'); } catch { return null; }
}
function writeCache(bpId, data) {
  try { localStorage.setItem(cacheKey(bpId), JSON.stringify(data)); } catch {}
}

// ── Action row ────────────────────────────────────────────────────────────────
function BriefAction({ action, index, navigate }) {
  const p = PRIORITY[action.priority] ?? PRIORITY[1];
  const link = VALID_LINKS.has(action.cta_link) ? action.cta_link : '/insights';

  return (
    <div
      dir="rtl"
      onClick={() => navigate(link)}
      className={`group flex items-center gap-3 px-5 py-3.5 bg-white/40 hover:bg-white/75 transition-colors border-r-[3px] ${p.border} cursor-pointer`}
    >
      {/* Index bubble */}
      <div className="w-5 h-5 rounded-full bg-white shadow-sm flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-foreground-muted">
        {index + 1}
      </div>

      {/* Emoji */}
      <span className="text-[18px] flex-shrink-0 leading-none">{action.emoji || '⚡'}</span>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[12px] font-semibold text-foreground leading-snug">{action.title}</p>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${p.badge}`}>
            {p.label}
          </span>
        </div>
        {action.why && (
          <p className="text-[11px] text-foreground-muted mt-0.5 line-clamp-1">{action.why}</p>
        )}
      </div>

      {/* Right side: time + CTA */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {action.time_minutes && (
          <span className="text-[9px] text-foreground-muted opacity-60">
            {action.time_minutes} דק׳
          </span>
        )}
        <button
          onClick={e => { e.stopPropagation(); navigate(link); }}
          className="text-[11px] font-semibold text-[#e8344d] border border-rose-200 px-3 py-1 rounded-full hover:bg-rose-50 transition-colors opacity-0 group-hover:opacity-100 whitespace-nowrap"
        >
          {action.cta_label || 'פעל'} →
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DailyBriefPanel({ businessProfile }) {
  const navigate = useNavigate();
  const bpId = businessProfile?.id;

  const [brief,   setBrief]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  // Fetch data needed to build the brief context
  const { data: signals = [] } = useQuery({
    queryKey: ['briefSignals', bpId],
    queryFn: () => base44.entities.MarketSignal.filter(
      { linked_business: bpId }, '-detected_at', 20
    ),
    enabled: !!bpId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['briefAlerts', bpId],
    queryFn: () => base44.entities.ProactiveAlert.filter(
      { linked_business: bpId }, '-created_at', 20
    ),
    enabled: !!bpId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['briefReviews', bpId],
    queryFn: () => base44.entities.Review.filter(
      { linked_business: bpId, response_status: 'pending' }, '-created_date', 10
    ),
    enabled: !!bpId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['briefLeads', bpId],
    queryFn: () => base44.entities.Lead.filter(
      { linked_business: bpId, status: 'hot' }, '-created_date', 10
    ),
    enabled: !!bpId,
    staleTime: 5 * 60 * 1000,
  });

  const generate = useCallback(async (force = false) => {
    if (!bpId || !businessProfile) return;

    if (!force) {
      const cached = readCache(bpId);
      if (cached?.actions?.length) { setBrief(cached); return; }
    }

    setLoading(true);
    setError('');

    try {
      // Build context strings
      const IMPACT_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };
      const topSignals = [...signals]
        .filter(s => !s.is_dismissed)
        .sort((a, b) => (IMPACT_ORDER[b.impact_level] ?? 2) - (IMPACT_ORDER[a.impact_level] ?? 2))
        .slice(0, 8)
        .map(s => {
          const age = Math.floor((Date.now() - new Date(s.detected_at || s.created_date || 0)) / 86400000);
          const fresh = age <= 3 ? ' [עדכני]' : age <= 7 ? ` [לפני ${age} ימים]` : '';
          return `- [${s.impact_level}]${fresh} ${s.summary}${s.recommended_action ? ` → ${s.recommended_action}` : ''}`;
        })
        .join('\n');

      const pendingNegReviews = reviews.filter(r => r.sentiment === 'negative').length;
      const pendingAllReviews = reviews.length;
      const hotLeadsCount = leads.length;
      const urgentAlerts = alerts.filter(a =>
        a.status !== 'dismissed' && (a.priority === 'critical' || a.priority === 'high')
      ).length;

      const prompt = `אתה יועץ עסקי AI לעסקים קטנים ישראלים. תפקידך: לנתח את כל הנתונים שלהלן ולהפיק בריף יומי ממוקד עם 3-4 פעולות שבעל העסק חייב לעשות היום.

עסק: "${businessProfile.name}" | תחום: ${businessProfile.category || 'לא צוין'} | עיר: ${businessProfile.city || ''}

נתוני עסק לעכשיו:
- ביקורות שליליות ממתינות לתגובה: ${pendingNegReviews} (מתוך ${pendingAllReviews} בסה"כ ממתינות)
- לידים חמים שטרם טופלו: ${hotLeadsCount}
- התראות דחופות: ${urgentAlerts}

אותות שוק שנאספו (${signals.length} סה"כ — מציגים הכי חשובים):
${topSignals || 'אין אותות זמינים כרגע'}

הנחיות קריטיות:
1. כל פעולה חייבת להיות ספציפית לעסק הזה — לא גנרית
2. אם יש ביקורות שליליות → זה תמיד priority 0
3. אם יש לידים חמים → priority 0 או 1
4. אל תמציא נתונים שלא קיימים ברשימה
5. כל "why" חייב להכיל מספר קונקרטי ("3 לקוחות", "40% מהחיפושים", "48 שעות") כשאפשר

החזר JSON בלבד (ללא \`\`\`json ולא טקסט נוסף):
{
  "summary": "משפט אחד — מהי התמונה הכוללת של היום",
  "actions": [
    {
      "priority": 0,
      "emoji": "⭐",
      "title": "פעולה ספציפית (עד 8 מילים)",
      "why": "למה עכשיו — עם מספר קונקרטי (עד 12 מילים)",
      "cta_label": "פועל + יעד (עד 4 מילים)",
      "cta_link": "/reviews",
      "time_minutes": 5
    }
  ]
}

cta_link חייב להיות אחד בדיוק מ: /reviews, /leads, /retention, /marketing, /marketing/create, /competitors, /insights`;

      const result = await base44.integrations.Core.InvokeLLM({
        model: 'sonnet',
        maxTokens: 700,
        prompt,
      });

      const text = typeof result === 'string' ? result : (result?.content || '{}');
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('no JSON in response');
      const parsed = JSON.parse(match[0]);
      if (!Array.isArray(parsed.actions) || parsed.actions.length === 0) throw new Error('empty actions');

      writeCache(bpId, parsed);
      setBrief(parsed);
    } catch (err) {
      console.error('[DailyBriefPanel]', err);
      setError('לא הצלחנו לייצר את הבריף. נסה שוב.');
    }

    setLoading(false);
  }, [bpId, businessProfile, signals, alerts, reviews, leads]);

  // Auto-generate on first load (uses cache if available)
  useEffect(() => {
    if (bpId && signals.length + alerts.length + reviews.length + leads.length > 0) {
      generate(false);
    }
  }, [bpId, signals.length, alerts.length, reviews.length, leads.length]); // eslint-disable-line

  if (!bpId) return null;

  return (
    <div
      className="border border-gray-200 rounded-2xl overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #f5f0ff 50%, #fff0f6 100%)' }}
    >
      {/* Header */}
      <div dir="rtl" className="flex items-center justify-between px-5 py-3.5 border-b border-white/60">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-full bg-foreground flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-background" />
          </div>
          <span className="text-[13px] font-bold text-foreground">בריף יומי</span>
          {brief?.summary && !loading && (
            <span className="text-[11px] text-foreground-muted hidden sm:block border-r border-gray-300 pr-2.5 mr-0.5">
              {brief.summary}
            </span>
          )}
        </div>
        <button
          onClick={() => generate(true)}
          disabled={loading}
          className="flex items-center gap-1.5 text-[11px] text-foreground-muted hover:text-foreground transition-colors bg-white/60 hover:bg-white border border-white/80 rounded-lg px-2.5 py-1.5 disabled:opacity-60"
        >
          {loading
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <RefreshCw className="w-3.5 h-3.5" />}
          {loading ? 'מייצר...' : 'עדכן'}
        </button>
      </div>

      {/* Skeleton while loading */}
      {loading && (
        <div className="px-5 py-5 space-y-4">
          {[80, 65, 70].map((w, i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="w-5 h-5 rounded-full bg-gray-200 flex-shrink-0" />
              <div className="w-[22px] h-[22px] rounded bg-gray-200 flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-gray-200 rounded" style={{ width: `${w}%` }} />
                <div className="h-2.5 bg-gray-100 rounded" style={{ width: `${w - 15}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="px-5 py-5 text-center">
          <p className="text-[12px] text-foreground-muted mb-2">{error}</p>
          <button
            onClick={() => generate(true)}
            className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1 mx-auto"
          >
            <RefreshCw className="w-3 h-3" /> נסה שוב
          </button>
        </div>
      )}

      {/* Empty state — data not loaded yet */}
      {!brief && !loading && !error && (
        <div className="px-5 py-5 text-center" dir="rtl">
          <p className="text-[12px] text-foreground-muted mb-2">
            ייצור בריף יומי מותאם אישית לעסק שלך...
          </p>
          <button
            onClick={() => generate(true)}
            className="text-[12px] font-semibold text-primary hover:underline flex items-center gap-1 mx-auto"
          >
            <Sparkles className="w-3.5 h-3.5" /> צור בריף עכשיו
          </button>
        </div>
      )}

      {/* Brief actions */}
      {brief && !loading && (
        <div className="divide-y divide-white/50">
          {(brief.actions || []).slice(0, 4).map((action, i) => (
            <BriefAction key={i} action={action} index={i} navigate={navigate} />
          ))}
        </div>
      )}

      {/* Footer timestamp */}
      {brief && !loading && (
        <div dir="rtl" className="px-5 py-2 border-t border-white/50 text-[9px] text-foreground-muted/50 text-left">
          עודכן {new Date().toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })} · מופעל על ידי AI
        </div>
      )}
    </div>
  );
}
