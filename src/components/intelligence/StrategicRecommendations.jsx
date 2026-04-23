import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { ChevronDown, ChevronUp, Loader2, Lightbulb, Target, TrendingUp, Shield } from 'lucide-react';
import ActionPopup from '@/components/ui/ActionPopup';

const CATEGORY_META = {
  competitive: { icon: Target,      label: 'תחרותי',   color: 'text-indigo-600', bg: 'bg-indigo-50',  border: 'border-indigo-100' },
  opportunity: { icon: TrendingUp,  label: 'הזדמנות',  color: 'text-green-600',  bg: 'bg-green-50',   border: 'border-green-100'  },
  defensive:   { icon: Shield,      label: 'הגנתי',    color: 'text-amber-600',  bg: 'bg-amber-50',   border: 'border-amber-100'  },
  general:     { icon: Lightbulb,   label: 'כללי',     color: 'text-blue-600',   bg: 'bg-blue-50',    border: 'border-blue-100'   },
};

function StrategyCard({ item, businessProfile, index }) {
  const [expanded,    setExpanded]    = useState(false);
  const [popupSignal, setPopupSignal] = useState(null);

  const meta = CATEGORY_META[item.category] || CATEGORY_META.general;
  const Icon = meta.icon;

  return (
    <>
    <div className={`rounded-xl border ${expanded ? meta.border : 'border-[#eeeeee]'} overflow-hidden transition-all`}>
      {/* Collapsed header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-right transition-colors ${expanded ? meta.bg : 'bg-white hover:bg-[#fafafa]'}`}
      >
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.bg} border ${meta.border}`}>
          <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
        </div>
        <div className="flex-1 min-w-0 text-right">
          <p className="text-[12px] font-semibold text-[#222222] truncate">{item.title}</p>
          {!expanded && (
            <p className="text-[10px] text-[#888888] truncate mt-0.5">{item.summary}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color} border ${meta.border}`}>
            {meta.label}
          </span>
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-[#bbbbbb]" />
            : <ChevronDown className="w-3.5 h-3.5 text-[#bbbbbb]" />}
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className={`px-4 pb-4 pt-2 ${meta.bg} border-t ${meta.border}`}>
          <p className="text-[11px] text-[#444444] leading-relaxed mb-3">{item.detail}</p>

          {item.steps?.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {item.steps.map((step, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className={`text-[9px] font-bold mt-0.5 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${meta.bg} ${meta.color} border ${meta.border}`}>
                    {i + 1}
                  </span>
                  <p className="text-[11px] text-[#333333]">{step}</p>
                </div>
              ))}
            </div>
          )}

          {item.action_label && (
            <button
              onClick={() => setPopupSignal({
                id: `strategy_card_${index}`,
                summary: item.title,
                recommended_action: item.action_label,
                source_description: JSON.stringify({
                  action_label: item.action_label,
                  action_type: 'task',
                  prefilled_text: `${item.title}\n\n${item.detail}\n\nצעדים:\n${(item.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
                  time_minutes: item.time_minutes || 30,
                }),
                impact_level: item.category === 'competitive' ? 'high' : 'medium',
              })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium ${meta.color} ${meta.bg} border ${meta.border} hover:opacity-80 transition-all`}
            >
              {item.action_label} ←
            </button>
          )}
        </div>
      )}
    </div>

    {popupSignal && (
      <ActionPopup
        signal={popupSignal}
        businessProfile={businessProfile}
        onClose={() => setPopupSignal(null)}
      />
    )}
    </>
  );
}

/**
 * StrategicRecommendations — condensed accordion strategy cards.
 * Calls InvokeLLM to generate 4-6 strategic recommendations, each shown
 * collapsed by default. User can expand individually to see details + action.
 *
 * Props: businessProfile, competitors (array), signals (array), title (string)
 */
export default function StrategicRecommendations({ businessProfile, competitors = [], signals = [], title = 'המלצות אסטרטגיות' }) {
  const [items,   setItems]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);

  const generate = async () => {
    if (loaded) return;
    setLoading(true);
    try {
      const competitorStr = competitors.slice(0, 6)
        .map(c => `${c.name} (דירוג: ${c.rating || '?'}, מגמה: ${c.trend_direction || '?'})`)
        .join('; ');
      const signalStr = signals.slice(0, 5).map(s => s.summary).join('; ');

      const res = await base44.integrations.Core.InvokeLLM({
        model: 'haiku',
        prompt: `אתה אסטרטג עסקי. העסק: "${businessProfile?.name}" (${businessProfile?.category}, ${businessProfile?.city}).
מתחרים: ${competitorStr || 'לא ידועים'}.
סיגנלים: ${signalStr || 'אין'}.

צור 4 המלצות אסטרטגיות קצרות. JSON בלבד:
{"recommendations":[{
  "title": "כותרת קצרה 3-5 מילים",
  "summary": "תקציר חד-משפטי",
  "detail": "הסבר 2-3 משפטים",
  "category": "competitive|opportunity|defensive|general",
  "steps": ["צעד 1", "צעד 2", "צעד 3"],
  "action_label": "פעולה לביצוע — עד 5 מילים",
  "time_minutes": 20
}]}`,
      });

      let parsed = null;
      try {
        const src = typeof res === 'string' ? res : JSON.stringify(res);
        const match = src.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch (_) {}

      setItems(parsed?.recommendations || []);
      setLoaded(true);
    } catch (_) {
      setItems([]);
      setLoaded(true);
    }
    setLoading(false);
  };

  return (
    <div className="card-base overflow-hidden">
      {/* Header — click to load */}
      <button
        onClick={generate}
        disabled={loading}
        className="w-full flex items-center justify-between px-5 py-3.5 border-b border-border hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-primary opacity-60" />
          <span className="text-[13px] font-semibold text-foreground">{title}</span>
          {loaded && items && (
            <span className="text-[10px] text-foreground-muted opacity-60">({items.length})</span>
          )}
        </div>
        {loading
          ? <Loader2 className="w-4 h-4 animate-spin text-foreground-muted" />
          : !loaded
            ? <span className="text-[11px] text-primary font-medium">צור המלצות ←</span>
            : null}
      </button>

      {/* Skeleton while loading */}
      {loading && (
        <div className="p-4 space-y-2 animate-pulse">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-12 rounded-xl bg-gray-100" />
          ))}
        </div>
      )}

      {/* Strategy cards */}
      {!loading && loaded && items && (
        <div className="p-4 space-y-2">
          {items.length === 0 ? (
            <p className="text-[12px] text-foreground-muted text-center py-4">לא נמצאו המלצות — נסה שוב</p>
          ) : (
            items.map((item, i) => (
              <StrategyCard
                key={i}
                item={item}
                businessProfile={businessProfile}
                index={i}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
