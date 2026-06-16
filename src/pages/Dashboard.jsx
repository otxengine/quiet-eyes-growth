import React, { useState, useRef } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Send, ChevronLeft, X } from 'lucide-react';
import LiveStreamCard from '@/components/shared/LiveStreamCard';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  if (h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

const ACTION_TYPE_LABELS = {
  social_post:    'פוסט',
  review_reply:   'תגובה',
  lead_followup:  'ליד',
  email:          'מייל',
  whatsapp:       'WhatsApp',
};

export default function Dashboard() {
  const { businessProfile } = useOutletContext();
  const navigate = useNavigate();
  const bpId = businessProfile?.id;
  const [aiInput, setAiInput] = useState('');
  const [aiResponse, setAiResponse] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const inputRef = useRef(null);

  const { data: allLeads = [] } = useQuery({
    queryKey: ['allLeads', bpId],
    queryFn: () => base44.entities.Lead.filter({ linked_business: bpId }, '-score', 50),
    enabled: !!bpId,
  });

  const { data: allSignals = [] } = useQuery({
    queryKey: ['allSignals', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 30),
    enabled: !!bpId,
  });

  const { data: allReviews = [] } = useQuery({
    queryKey: ['allReviews', bpId],
    queryFn: () => base44.entities.Review.filter({ linked_business: bpId }, '-created_date', 20),
    enabled: !!bpId,
  });

  // Fetch pending approvals for "זרם חי"
  const { data: eventBusStats } = useQuery({
    queryKey: ['eventBusStats', bpId],
    queryFn: () => base44.functions.invoke('getEventBusStats', { businessProfileId: bpId }),
    enabled: !!bpId,
    refetchInterval: 60000,
  });

  // Computed stats
  const today = new Date().toISOString().slice(0, 10);
  const newLeadsToday = allLeads.filter(l => (l.created_at || '').startsWith(today));
  const hotLeads = allLeads.filter(l => l.status === 'hot');
  const actionsCompleted = allLeads.filter(l => l.status === 'completed' || l.lifecycle_stage === 'closed_won');
  const urgentSignals = allSignals.filter(s => !s.is_read && s.impact_level === 'high');

  const urgentItem = urgentSignals[0] || allSignals[0];
  const urgentReview = allReviews.find(r => r.response_status === 'pending' && (r.sentiment === 'negative' || (r.rating && r.rating <= 2)));

  // ── Live stream: prefer real pending actions, fallback to leads/signals ──────
  const pendingActions = eventBusStats?.pending_actions || [];
  const liveItems = pendingActions.length > 0
    ? pendingActions.slice(0, 4).map(action => ({
        type: ACTION_TYPE_LABELS[action.action_type] || action.action_type || 'פעולה',
        typeBg: 'bg-purple-100 text-purple-700',
        time: 'ממתין לאישור',
        description: action.prefilled_text || action.decision_reason || 'פעולה ממתינה לאישורך',
        ctaLabel: 'צפיה ואישור',
        onCta: () => navigate('/approvals'),
        timerMinutes: action.auto_execute_minutes_remaining || 2,
      }))
    : [
        ...hotLeads.slice(0, 2).map(l => ({
          type: 'ליד חם',
          typeBg: 'bg-amber-100 text-amber-700',
          time: 'לפני 5 דקות',
          description: `${l.name || 'ליד חדש'} — ${l.company || l.source || 'ממתין לטיפול'}`,
          ctaLabel: 'צפיה ושליחה',
          timerMinutes: 2,
        })),
        ...urgentSignals.slice(0, 2).map(s => ({
          type: 'תובנה',
          typeBg: 'bg-purple-100 text-purple-700',
          time: 'לפני 12 דקות',
          description: s.title || s.summary || 'תובנה חדשה מהמערכת',
          ctaLabel: 'צפיה ופרסום',
          timerMinutes: 3,
        })),
      ];

  const shortcuts = [
    { label: 'בוצע לאחרונה',   sub: `${actionsCompleted.length} פעולות`,   bg: '#fce4ec', path: '/approvals' },
    { label: 'תמונת מצב',       sub: `${allLeads.length} לידים פעילים`,      bg: '#e3f2fd', path: '/leads' },
    { label: 'התובנות שלי',     sub: `${urgentSignals.length} דחופות`,        bg: '#f3e5f5', path: '/insights' },
    { label: 'דחוף להיום',      sub: urgentItem ? urgentItem.title?.slice(0, 25) || '...' : 'הכל תקין', bg: '#fff8e1', path: '/insights' },
  ];

  // ── AI chat ──────────────────────────────────────────────────────────────────
  const sendAiMessage = async (message) => {
    const msg = message || aiInput;
    if (!msg.trim() || isAiLoading) return;

    setAiInput('');
    setIsAiLoading(true);
    setAiResponse(null);

    try {
      let result;
      try {
        result = await base44.functions.invoke('chatWithBusiness', {
          message: msg,
          businessProfileId: bpId,
          history: [],
        });
      } catch (_) {
        // Fallback to generic LLM
        result = await base44.integrations.Core.InvokeLLM({
          prompt: `אתה עוזר עסקי חכם. ענה בעברית בקצרה ובאופן ממוקד. שאלה: ${msg}`,
          response_json_schema: null,
        });
      }
      const text = result?.response || result?.message || result?.content || result?.text || (typeof result === 'string' ? result : 'לא הצלחתי לקבל תשובה. נסה שוב.');
      setAiResponse(text);
    } catch (err) {
      console.error('AI chat failed:', err);
      setAiResponse('שגיאה בהתחברות לבינה המלאכותית. נסה שוב.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleChipClick = (chip) => {
    if (chip.path) {
      navigate(chip.path);
    } else if (chip.prompt) {
      setAiInput(chip.prompt);
      sendAiMessage(chip.prompt);
    }
  };

  const quickChips = [
    { label: 'בנה קמפיין חדש',     path: '/marketing/create' },
    { label: 'בצע מחקר שוק',        prompt: 'תעשה לי מחקר שוק קצר על העסק שלי' },
    { label: 'הצג פעולות לאישור',   path: '/approvals' },
    { label: 'סכם לי את השבוע',     prompt: 'תסכם לי את השבוע — מה קרה, מה הישגים, מה הצעדים הבאים' },
  ];

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center gap-4 mb-5">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #e8344d 0%, #9c27b0 100%)' }}
          >
            {(businessProfile?.name || 'Q')[0].toUpperCase()}
          </div>
          <div>
            <div className="text-xl font-bold text-foreground">
              {getGreeting()} {businessProfile?.contact_name || businessProfile?.name || ''}, מה תרצה לבצע היום?
            </div>
            <div className="text-sm text-foreground-secondary mt-0.5">המערכת מוכנה לעזור לך</div>
          </div>
        </div>

        {/* Free-text input */}
        <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3 border border-gray-200 mb-3">
          <input
            ref={inputRef}
            value={aiInput}
            onChange={e => setAiInput(e.target.value)}
            placeholder="שאל אותי כל דבר, למשל: מה מצב הלידים השבוע?"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-foreground-muted"
            onKeyDown={e => e.key === 'Enter' && sendAiMessage()}
          />
          <button
            onClick={() => sendAiMessage()}
            disabled={!aiInput.trim() || isAiLoading}
            className="text-[#e8344d] hover:text-[#c92b40] transition-colors disabled:opacity-40"
          >
            {isAiLoading
              ? <span className="w-4 h-4 border-2 border-[#e8344d]/30 border-t-[#e8344d] rounded-full animate-spin block" />
              : <Send className="w-4 h-4" />
            }
          </button>
        </div>

        {/* AI response card */}
        {aiResponse && (
          <div className="bg-[#fce4ec] border border-[#f8bbd0] rounded-xl px-4 py-3 mb-3 relative">
            <button
              onClick={() => setAiResponse(null)}
              className="absolute top-2 left-2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-start gap-2">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5"
                style={{ background: 'linear-gradient(135deg, #9c27b0 0%, #e8344d 100%)' }}
              >
                ק
              </div>
              <p className="text-[13px] text-gray-800 leading-relaxed whitespace-pre-line pr-4">{aiResponse}</p>
            </div>
          </div>
        )}

        {/* Quick-action chips */}
        <div className="flex flex-wrap gap-2">
          {quickChips.map((chip, i) => (
            <button
              key={i}
              onClick={() => handleChipClick(chip)}
              className="text-xs font-medium bg-gray-100 hover:bg-gray-200 text-foreground px-3 py-1.5 rounded-full transition-colors border border-gray-200"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 2×2 Shortcut Grid ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        {shortcuts.map((sc, i) => (
          <button
            key={i}
            onClick={() => sc.path && navigate(sc.path)}
            className="text-right p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow"
            style={{ background: sc.bg }}
          >
            <div className="font-semibold text-sm text-foreground mb-1">{sc.label}</div>
            <div className="text-xs text-foreground-secondary">{sc.sub}</div>
          </button>
        ))}
      </div>

      {/* ── Urgent Card ───────────────────────────────────────────────── */}
      {(urgentReview || urgentItem) && (
        <div
          className="rounded-2xl p-5 flex flex-col gap-3"
          style={{ background: 'linear-gradient(135deg, #fce4ec 0%, #f8bbd0 100%)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="text-xs font-bold text-[#c62828] mb-1 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#e8344d] inline-block animate-pulse" />
                דחוף ביותר
              </div>
              <div className="font-semibold text-sm text-foreground">
                {urgentReview
                  ? 'ביקורת שלילית חדשה בגוגל – לא נענתה'
                  : (urgentItem?.title || 'תובנה דחופה מהמערכת')}
              </div>
              <div className="text-xs text-foreground-secondary mt-1">
                {urgentReview
                  ? urgentReview.content?.slice(0, 80) || 'ממתינה לתגובה'
                  : urgentItem?.summary?.slice(0, 80) || ''}
              </div>
            </div>
            <div className="text-xs text-foreground-muted flex-shrink-0">2 ד'</div>
          </div>
          <button
            onClick={() => navigate(urgentReview ? '/reputation' : '/insights')}
            className="self-start bg-white/80 hover:bg-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors border border-white/60 shadow-sm"
          >
            {urgentReview ? 'קרא ואשר תגובה' : 'צפה בתובנה'}
          </button>
        </div>
      )}

      {/* ── זרם חי ────────────────────────────────────────────────────── */}
      {liveItems.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => navigate('/approvals')} className="text-xs font-semibold text-[#e8344d] flex items-center gap-1">
              <ChevronLeft className="w-3.5 h-3.5" />
              כל הפעולות
            </button>
            <h3 className="text-sm font-bold text-foreground">
              זרם חי {pendingActions.length > 0 && <span className="text-[#e8344d]">· {pendingActions.length} ממתינות</span>}
            </h3>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
            {liveItems.map((item, i) => (
              <LiveStreamCard key={i} {...item} />
            ))}
          </div>
        </div>
      )}

      {/* ── בזמן שישנת ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => navigate('/insights')} className="text-xs font-semibold text-[#e8344d] flex items-center gap-1">
            <ChevronLeft className="w-3.5 h-3.5" />
            כל התובנות
          </button>
          <h3 className="text-sm font-bold text-foreground">בזמן שישנת</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'לידים חדשים',   value: newLeadsToday.length },
            { label: 'נטישות',          value: 0 },
            { label: 'פעולות בוצעו',   value: actionsCompleted.length },
            { label: 'שעות שנחסכו',    value: Math.round(actionsCompleted.length * 0.5) },
          ].map((kpi, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <span className="text-green-600 text-xs">✓</span>
              </div>
              <div>
                <div className="text-lg font-bold text-foreground">{kpi.value}</div>
                <div className="text-xs text-foreground-secondary">{kpi.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Upgrade Banner ────────────────────────────────────────────── */}
      <div
        className="rounded-2xl p-5 flex items-center justify-between gap-4"
        style={{ background: 'linear-gradient(135deg, #fce4ec 0%, #e1bee7 100%)' }}
      >
        <div>
          <div className="font-semibold text-sm text-foreground">המערכת יכולה לזהות יותר עבורך</div>
          <div className="text-xs text-foreground-secondary mt-0.5">שדרג לפתיחת כל יכולות הבינה המלאכותית</div>
        </div>
        <button
          onClick={() => navigate('/subscription')}
          className="flex-shrink-0 bg-[#e8344d] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#c92b40] transition-colors shadow-sm"
        >
          גלה הזדמנויות
        </button>
      </div>
    </div>
  );
}
