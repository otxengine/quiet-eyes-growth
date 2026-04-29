import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { parseLLMJson } from '@/lib/utils';
import { CATEGORY_META } from '@/components/intelligence/StrategicRecommendations';
import { Loader2, Shield, TrendingUp, MessageSquare, Target, Zap, Lightbulb, ChevronDown, ChevronUp, X } from 'lucide-react';
import { toast } from 'sonner';
import ActionPopup from '@/components/ui/ActionPopup';

const PANEL_TABS = [
  { key: 'swot',     label: 'SWOT' },
  { key: 'strategy', label: 'אסטרטגיה' },
  { key: 'battle',   label: 'השוואת מתחרה' },
];

// ─── SWOT Tab ────────────────────────────────────────────────────────────────

const SWOT_COLORS = {
  strengths:     { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700',  label: 'חוזקות' },
  weaknesses:    { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700',    label: 'חולשות' },
  opportunities: { bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700',   label: 'הזדמנויות' },
  threats:       { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  label: 'איומים' },
};

function SwotTab({ competitor, businessProfile }) {
  const [swot, setSwot]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded]   = useState(false);

  const generate = async () => {
    if (loaded) return;
    setLoading(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        model: 'haiku',
        prompt: `אתה אנליסט עסקי. העסק שלנו: "${businessProfile?.name}" (${businessProfile?.category}, ${businessProfile?.city}).
המתחרה הנבדק: "${competitor.name}" (דירוג: ${competitor.rating || '?'}, מגמה: ${competitor.trend_direction || '?'}).
${competitor.notes ? `מידע נוסף: ${competitor.notes}` : ''}

צור ניתוח SWOT עבור המתחרה "${competitor.name}" מנקודת המבט שלנו. JSON בלבד:
{
  "strengths": ["חוזקה 1", "חוזקה 2", "חוזקה 3"],
  "weaknesses": ["חולשה 1", "חולשה 2", "חולשה 3"],
  "opportunities": ["הזדמנות 1", "הזדמנות 2", "הזדמנות 3"],
  "threats": ["איום 1", "איום 2", "איום 3"]
}`,
      });
      setSwot(parseLLMJson(res));
      setLoaded(true);
    } catch (_) {
      setLoaded(true);
    }
    setLoading(false);
  };

  if (!loaded) {
    return (
      <div className="py-8 text-center">
        <p className="text-[12px] text-foreground-muted mb-3">לחץ להפיק ניתוח SWOT עבור {competitor.name}</p>
        <button onClick={generate} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-foreground text-background text-[12px] font-medium rounded-lg hover:opacity-90 transition-opacity mx-auto disabled:opacity-60">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          {loading ? 'מנתח...' : 'צור ניתוח SWOT'}
        </button>
      </div>
    );
  }

  if (!swot) {
    return <p className="text-[12px] text-foreground-muted text-center py-6">לא הצלחנו לייצר ניתוח — נסה שוב</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {(['strengths', 'weaknesses', 'opportunities', 'threats']).map(key => {
        const meta = SWOT_COLORS[key];
        return (
          <div key={key} className={`rounded-xl border ${meta.border} ${meta.bg} p-3`}>
            <p className={`text-[11px] font-bold ${meta.text} mb-2`}>{meta.label}</p>
            <ul className="space-y-1">
              {(swot[key] || []).map((item, i) => (
                <li key={i} className={`text-[11px] ${meta.text} flex items-start gap-1.5`}>
                  <span className="mt-0.5 flex-shrink-0 opacity-60">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ─── Strategy Tab ────────────────────────────────────────────────────────────

function StrategyItem({ item, businessProfile, index }) {
  const [expanded, setExpanded] = useState(false);
  const [popup,    setPopup]    = useState(null);
  const meta = CATEGORY_META[item.category] || CATEGORY_META.general;
  const Icon = meta.icon;

  return (
    <>
      <div className={`rounded-xl border ${expanded ? meta.border : 'border-border'} overflow-hidden transition-all`}>
        <button onClick={() => setExpanded(v => !v)}
          className={`w-full flex items-center gap-3 px-4 py-3 text-right transition-colors ${expanded ? meta.bg : 'bg-white hover:bg-secondary/30'}`}>
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.bg} border ${meta.border}`}>
            <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
          </div>
          <div className="flex-1 min-w-0 text-right">
            <p className="text-[12px] font-semibold text-foreground truncate">{item.title}</p>
            {!expanded && <p className="text-[10px] text-foreground-muted truncate mt-0.5">{item.summary}</p>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color} border ${meta.border}`}>{meta.label}</span>
            {expanded ? <ChevronUp className="w-3.5 h-3.5 text-foreground-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-foreground-muted" />}
          </div>
        </button>
        {expanded && (
          <div className={`px-4 pb-4 pt-2 ${meta.bg} border-t ${meta.border}`}>
            <p className="text-[11px] text-foreground-secondary leading-relaxed mb-3">{item.detail}</p>
            {item.steps?.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {item.steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`text-[9px] font-bold mt-0.5 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${meta.bg} ${meta.color} border ${meta.border}`}>{i + 1}</span>
                    <p className="text-[11px] text-foreground">{step}</p>
                  </div>
                ))}
              </div>
            )}
            {item.action_label && (
              <button onClick={() => setPopup({ id: `strat_${index}`, summary: item.title, recommended_action: item.action_label, source_description: JSON.stringify({ action_label: item.action_label, action_type: 'task', prefilled_text: `${item.title}\n\n${item.detail}`, time_minutes: item.time_minutes || 30 }), impact_level: 'medium' })}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium ${meta.color} ${meta.bg} border ${meta.border} hover:opacity-80 transition-all`}>
                {item.action_label} ←
              </button>
            )}
          </div>
        )}
      </div>
      {popup && <ActionPopup signal={popup} businessProfile={businessProfile} onClose={() => setPopup(null)} />}
    </>
  );
}

function StrategyTab({ competitor, businessProfile, competitors, signals }) {
  const [items, setItems]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded]   = useState(false);

  const generate = async () => {
    if (loaded) return;
    setLoading(true);
    try {
      const competitorStr = competitors.slice(0, 6)
        .map(c => `${c.name} (${c.trend_direction || '?'})`)
        .join('; ');
      const signalStr = signals.slice(0, 5).map(s => s.summary).join('; ');
      const res = await base44.integrations.Core.InvokeLLM({
        model: 'haiku',
        prompt: `אתה אסטרטג עסקי. העסק: "${businessProfile?.name}" (${businessProfile?.category}, ${businessProfile?.city}).
המתחרה הממוקד: ${competitor.name}.
מתחרים: ${competitorStr || 'לא ידועים'}. סיגנלים: ${signalStr || 'אין'}.

צור 3-4 המלצות אסטרטגיות ממוקדות במתחרה "${competitor.name}". JSON בלבד:
{"recommendations":[{
  "title": "כותרת קצרה",
  "summary": "תקציר חד-משפטי",
  "detail": "הסבר 2-3 משפטים",
  "category": "competitive|opportunity|defensive|general",
  "steps": ["צעד 1", "צעד 2"],
  "action_label": "פעולה לביצוע",
  "time_minutes": 20
}]}`,
      });
      setItems(parseLLMJson(res)?.recommendations || []);
      setLoaded(true);
    } catch (_) {
      setItems([]);
      setLoaded(true);
    }
    setLoading(false);
  };

  if (!loaded) {
    return (
      <div className="py-8 text-center">
        <p className="text-[12px] text-foreground-muted mb-3">לחץ להפיק המלצות אסטרטגיות מול {competitor.name}</p>
        <button onClick={generate} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-foreground text-background text-[12px] font-medium rounded-lg hover:opacity-90 transition-opacity mx-auto disabled:opacity-60">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lightbulb className="w-3.5 h-3.5" />}
          {loading ? 'מייצר...' : 'צור אסטרטגיה'}
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="space-y-2 py-2 animate-pulse">{[0,1,2].map(i => <div key={i} className="h-12 rounded-xl bg-gray-100" />)}</div>;
  }

  return (
    <div className="space-y-2">
      {!items?.length
        ? <p className="text-[12px] text-foreground-muted text-center py-4">לא נמצאו המלצות — נסה שוב</p>
        : items.map((item, i) => <StrategyItem key={i} item={item} businessProfile={businessProfile} index={i} />)
      }
    </div>
  );
}

// ─── BattleCard Tab ───────────────────────────────────────────────────────────

function BattleTab({ competitor, businessProfile }) {
  const [loading, setLoading] = useState(false);
  const [battlecard, setBattlecard] = useState(() => {
    try { return competitor.battlecard_content ? JSON.parse(competitor.battlecard_content) : null; } catch { return null; }
  });
  const [priceData, setPriceData]     = useState(null);
  const [priceLoading, setPriceLoading] = useState(false);

  const detectPrices = async () => {
    setPriceLoading(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        model: 'haiku',
        prompt: `אתה אנליסט תחרותי. זהה מחירים ושירותים עבור העסק: "${competitor.name}".
${competitor.notes ? `מידע: ${competitor.notes}` : ''}
ענף: ${businessProfile?.category || 'לא ידוע'}, עיר: ${businessProfile?.city || 'לא ידועה'}.
בהתבסס על הידע שלך, הצע רשימת שירותים ומחירים אופייניים לעסק מסוג זה. JSON בלבד:
{
  "price_range": "₪XX-₪XXX",
  "services": [
    {"name": "שם השירות", "price": "₪XX"},
    {"name": "שירות נוסף", "price": "₪XX-₪XX"}
  ],
  "notes": "הערה קצרה על מדיניות המחירים"
}`,
      });
      setPriceData(parseLLMJson(res));
    } catch (_) {
      toast.error('שגיאה בזיהוי מחירים');
    }
    setPriceLoading(false);
  };

  const generate = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('generateBattlecard', {
        competitorId: competitor.id,
        businessProfileId: businessProfile?.id,
      });
      if (res?.data?.battlecard || res?.battlecard) {
        setBattlecard(res?.data?.battlecard || res?.battlecard);
        toast.success('השוואת מתחרה עודכן ✓');
      }
    } catch (_) {
      toast.error('שגיאה ביצירת השוואת מתחרה');
    }
    setLoading(false);
  };

  if (!battlecard) {
    return (
      <div className="space-y-4">
        <div className="py-6 text-center">
          <p className="text-[12px] text-foreground-muted mb-3">אין השוואת מתחרה עבור {competitor.name} עדיין</p>
          <button onClick={generate} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-foreground text-background text-[12px] font-medium rounded-lg hover:opacity-90 transition-opacity mx-auto disabled:opacity-60">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            {loading ? 'מייצר...' : 'צור השוואת מתחרה'}
          </button>
        </div>
        <div className="border-t border-border pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] font-semibold text-foreground">מחירים ושירותים</h4>
            <button onClick={detectPrices} disabled={priceLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium bg-secondary border border-border rounded-lg hover:bg-secondary/80 transition-all disabled:opacity-60">
              {priceLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : '🔍'}
              {priceLoading ? 'מזהה...' : 'זהה מחירים ותפריט'}
            </button>
          </div>
          {priceData && (
            <div className="space-y-2">
              {priceData.price_range && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-secondary border border-border">
                  <span className="text-[10px] text-foreground-muted">טווח מחירים:</span>
                  <span className="text-[12px] font-semibold text-foreground">{priceData.price_range}</span>
                </div>
              )}
              {priceData.services?.length > 0 && (
                <div className="rounded-lg border border-border overflow-hidden">
                  {priceData.services.map((s, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 border-b border-border last:border-0 bg-white">
                      <span className="text-[11px] text-foreground">{s.name}</span>
                      <span className="text-[11px] font-medium text-foreground-secondary">{s.price || '—'}</span>
                    </div>
                  ))}
                </div>
              )}
              {priceData.notes && <p className="text-[10px] text-foreground-muted italic">{priceData.notes}</p>}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-foreground leading-snug">{battlecard.headline}</p>
          {battlecard.confidence_score && (
            <span className="text-[10px] text-foreground-muted mt-0.5 block">ביטחון: {battlecard.confidence_score}%</span>
          )}
        </div>
        <button onClick={generate} disabled={loading}
          className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-[10px] text-foreground-muted border border-border rounded-md hover:bg-secondary transition-colors">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          רענן
        </button>
      </div>
      {battlecard.our_advantages?.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-success" />
            <h4 className="text-[11px] font-semibold text-foreground">היתרונות שלנו</h4>
          </div>
          <ul className="space-y-1">
            {battlecard.our_advantages.map((adv, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px] text-foreground-secondary">
                <span className="text-success mt-0.5 flex-shrink-0">✓</span>{adv}
              </li>
            ))}
          </ul>
        </div>
      )}
      {battlecard.their_weaknesses?.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Target className="w-3.5 h-3.5 text-amber-500" />
            <h4 className="text-[11px] font-semibold text-foreground">נקודות חולשה שלהם</h4>
          </div>
          <ul className="space-y-1">
            {battlecard.their_weaknesses.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px] text-foreground-secondary">
                <span className="text-amber-500 mt-0.5 flex-shrink-0">→</span>{w}
              </li>
            ))}
          </ul>
        </div>
      )}
      {battlecard.talking_points?.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <MessageSquare className="w-3.5 h-3.5 text-primary" />
            <h4 className="text-[11px] font-semibold text-foreground">תגובות מוכנות</h4>
          </div>
          <div className="space-y-2">
            {battlecard.talking_points.map((tp, i) => (
              <div key={i} className="bg-secondary rounded-lg p-2.5 border border-border">
                <p className="text-[10px] text-foreground-muted mb-1">לקוח אומר: <span className="italic">"{tp.customer_says}"</span></p>
                <p className="text-[11px] text-foreground font-medium">"{tp.you_respond}"</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {battlecard.our_usp && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Shield className="w-3.5 h-3.5 text-success" />
            <span className="text-[11px] font-semibold text-success">ה-USP שלנו</span>
          </div>
          <p className="text-[12px] text-foreground-secondary">{battlecard.our_usp}</p>
        </div>
      )}
      {battlecard.data_gaps?.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="text-[10px] text-foreground-muted mb-1">פערי מידע:</p>
          <div className="flex flex-wrap gap-1">
            {battlecard.data_gaps.map((gap, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full text-[9px] bg-secondary text-foreground-muted border border-border">{gap}</span>
            ))}
          </div>
        </div>
      )}

      {/* Price / Menu detection */}
      <div className="border-t border-border pt-4 mt-2">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[11px] font-semibold text-foreground">מחירים ושירותים</h4>
          <button onClick={detectPrices} disabled={priceLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium bg-secondary border border-border rounded-lg hover:bg-secondary/80 transition-all disabled:opacity-60">
            {priceLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : '🔍'}
            {priceLoading ? 'מזהה...' : 'זהה מחירים ותפריט'}
          </button>
        </div>
        {priceData && (
          <div className="space-y-2">
            {priceData.price_range && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-secondary border border-border">
                <span className="text-[10px] text-foreground-muted">טווח מחירים:</span>
                <span className="text-[12px] font-semibold text-foreground">{priceData.price_range}</span>
              </div>
            )}
            {priceData.services?.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="px-3 py-2 bg-secondary border-b border-border">
                  <p className="text-[10px] font-semibold text-foreground-muted">שירותים / תפריט</p>
                </div>
                {priceData.services.map((s, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 border-b border-border last:border-0 bg-white">
                    <span className="text-[11px] text-foreground">{s.name}</span>
                    <span className="text-[11px] font-medium text-foreground-secondary">{s.price || '—'}</span>
                  </div>
                ))}
              </div>
            )}
            {priceData.notes && (
              <p className="text-[10px] text-foreground-muted italic">{priceData.notes}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function StrategicAnalysisPanel({ competitor, businessProfile, competitors, signals, onClose }) {
  const [activeTab, setActiveTab] = useState('swot');

  return (
    <div className="card-base border border-primary/20 bg-card overflow-hidden fade-in-up">
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-secondary/30">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-primary opacity-60" />
          <span className="text-[13px] font-semibold text-foreground">ניתוח אסטרטגי — {competitor.name}</span>
        </div>
        <button onClick={onClose} className="text-foreground-muted hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-0 border-b border-border">
        {PANEL_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2.5 text-[12px] font-medium transition-all relative ${
              activeTab === tab.key ? 'text-foreground' : 'text-foreground-muted hover:text-foreground-secondary'
            }`}
          >
            {tab.label}
            {activeTab === tab.key && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t" />}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4">
        {activeTab === 'swot' && (
          <SwotTab key={competitor.id} competitor={competitor} businessProfile={businessProfile} />
        )}
        {activeTab === 'strategy' && (
          <StrategyTab
            key={competitor.id}
            competitor={competitor}
            businessProfile={businessProfile}
            competitors={competitors}
            signals={signals}
          />
        )}
        {activeTab === 'battle' && (
          <BattleTab key={competitor.id} competitor={competitor} businessProfile={businessProfile} />
        )}
      </div>
    </div>
  );
}
