import React, { useState, useRef } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ChevronLeft, X, ArrowUpRight, Sparkles, Zap, Flame, Clock } from 'lucide-react';
import LiveStreamCard from '@/components/shared/LiveStreamCard';
import KoriAvatar from '@/components/onboarding/KoriAvatar';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  if (h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

const ACTION_TYPE_LABELS = {
  social_post:   'פוסט',
  review_reply:  'תגובה',
  lead_followup: 'ליד',
  email:         'מייל',
  whatsapp:      'WhatsApp',
};

export default function Dashboard() {
  const { businessProfile } = useOutletContext();
  const navigate = useNavigate();
  const bpId = businessProfile?.id;
  const [aiInput, setAiInput] = useState('');
  const [aiResponse, setAiResponse] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [urgentDismissed, setUrgentDismissed] = useState(false);
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

  // Live stream items
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
          type: 'לידים',
          typeBg: 'bg-green-100 text-green-700',
          time: 'לפני 5 דקות',
          description: `${l.name || 'ליד חדש'} — ${l.company || l.source || 'ממתין לטיפול'}`,
          ctaLabel: 'צפיה ושליחה',
          timerMinutes: 2,
        })),
        ...urgentSignals.slice(0, 2).map(s => ({
          type: 'תוכן',
          typeBg: 'bg-purple-100 text-purple-700',
          time: 'לפני 12 דקות',
          description: s.title || s.summary || 'תובנה חדשה מהמערכת',
          ctaLabel: 'צפיה ופרסום',
          timerMinutes: 3,
        })),
      ];

  // Shortcut cards
  const shortcuts = [
    { label: 'בוצע לאחרונה',  sub: `הצג את הפעולות שבוצעו לאחרונה במערכת`, path: '/approvals',  Icon: ArrowUpRight },
    { label: 'תמונת מצב',      sub: `הצג את תמונת המצב העדכנית של designeed`, path: '/leads',       Icon: Sparkles    },
    { label: 'התובנות שלי',    sub: `הצג את כל התובנות וההמלצות המותאמות אישית`, path: '/insights',    Icon: Zap         },
    { label: 'דחוף להיום',     sub: `הצג את התובנות החשובות ביותר להיום`,      path: '/insights',    Icon: Flame       },
  ];

  const quickChips = [
    { label: 'בנה קמפיין חדש',   path: '/marketing/create' },
    { label: 'בצע מחקר שוק',      prompt: 'תעשה לי מחקר שוק קצר על העסק שלי' },
    { label: 'הצג פעולות לאישור', path: '/approvals' },
    { label: 'סכם לי את השבוע',   prompt: 'תסכם לי את השבוע — מה קרה, מה הישגים, מה הצעדים הבאים' },
  ];

  // AI chat
  const sendAiMessage = async (message) => {
    const msg = message || aiInput;
    if (!msg.trim() || isAiLoading) return;
    setAiInput('');
    setIsAiLoading(true);
    setAiResponse(null);
    try {
      let result;
      try {
        result = await base44.functions.invoke('chatWithBusiness', { message: msg, businessProfileId: bpId, history: [] });
      } catch (_) {
        result = await base44.integrations.Core.InvokeLLM({ prompt: `אתה עוזר עסקי חכם. ענה בעברית בקצרה. שאלה: ${msg}`, response_json_schema: null });
      }
      const text = result?.response || result?.message || result?.content || result?.text || (typeof result === 'string' ? result : 'לא הצלחתי לקבל תשובה.');
      setAiResponse(text);
    } catch (err) {
      setAiResponse('שגיאה בהתחברות. נסה שוב.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleChipClick = (chip) => {
    if (chip.path) navigate(chip.path);
    else if (chip.prompt) sendAiMessage(chip.prompt);
  };

  const bpName = businessProfile?.name || '';
  const userName = businessProfile?.contact_name || '';

  return (
    <div className="flex flex-col gap-5 max-w-4xl mx-auto pb-8" dir="rtl">

      {/* ── Hero: Kori avatar + greeting + input ──────────────────────────── */}
      <div className="flex flex-col items-center text-center gap-5 pt-2">
        <KoriAvatar size="lg" className="shadow-md" />

        <div className="space-y-1">
          <h1 className="text-[22px] font-bold text-gray-900">
            {getGreeting()} {userName},
          </h1>
          <h1 className="text-[22px] font-bold text-gray-900">
            מה תרצה לבצע ב-{bpName} היום?
          </h1>
        </div>

        {/* Input row */}
        <div className="flex items-center bg-white border border-gray-200 rounded-full shadow-sm w-full max-w-2xl overflow-hidden pr-5 pl-1.5 py-1.5">
          {/* Text input (RTL: starts from right) */}
          <input
            ref={inputRef}
            value={aiInput}
            onChange={e => setAiInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendAiMessage()}
            placeholder="תאר במילים מה תרצה לבצע והמערכת תתחיל בעבודה"
            className="flex-1 bg-transparent text-[13px] text-gray-700 placeholder:text-gray-400 outline-none min-w-0"
          />
          {/* Send button — visual left in RTL (end of flex row) */}
          <button
            onClick={() => sendAiMessage()}
            disabled={!aiInput.trim() || isAiLoading}
            className="w-10 h-10 rounded-full bg-[#111] flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-opacity"
            style={{ marginRight: '8px' }}
          >
            {isAiLoading
              ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />
              : <ChevronLeft className="w-5 h-5 text-white" />
            }
          </button>
        </div>

        {/* Quick chips */}
        <div className="flex flex-wrap gap-2 justify-center">
          {quickChips.map((chip, i) => (
            <button
              key={i}
              onClick={() => handleChipClick(chip)}
              className="text-[12px] font-medium bg-white border border-gray-200 text-gray-700 px-4 py-1.5 rounded-full hover:bg-gray-50 transition-colors shadow-sm"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── AI Response card ──────────────────────────────────────────────── */}
      {aiResponse && (
        <div className="bg-[#fce4ec] border border-[#f8bbd0] rounded-2xl px-5 py-4 relative">
          <button onClick={() => setAiResponse(null)} className="absolute top-3 left-3 text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="text-[13px] text-gray-800 leading-relaxed whitespace-pre-line pl-6">{aiResponse}</p>
            </div>
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5"
              style={{ background: 'linear-gradient(135deg, #9c27b0 0%, #e8344d 100%)' }}
            >
              ק
            </div>
          </div>
        </div>
      )}

      {/* ── 2×2 Shortcuts + Urgent card ──────────────────────────────────── */}
      <div className="flex gap-4">
        {/* 2×2 Shortcut grid */}
        <div className="grid grid-cols-2 gap-3" style={{ flex: '0 0 55%' }}>
          {shortcuts.map((sc, i) => (
            <button
              key={i}
              onClick={() => navigate(sc.path)}
              className="text-right p-4 rounded-2xl border border-gray-100 bg-white shadow-sm hover:shadow-md transition-shadow flex flex-col gap-2"
            >
              <sc.Icon className="w-5 h-5 text-[#e8344d]" />
              <div>
                <div className="font-semibold text-[13px] text-gray-900">{sc.label}</div>
                <div className="text-[11px] text-gray-400 mt-0.5 leading-snug">{sc.sub}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Urgent card */}
        {(urgentReview || urgentItem) && !urgentDismissed ? (
          <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <button onClick={() => setUrgentDismissed(true)} className="text-gray-300 hover:text-gray-500 flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
              <div className="flex-1 text-right space-y-1.5">
                <div className="text-[10px] text-gray-400">אתמול</div>
                <div className="font-bold text-[13px] text-gray-900 leading-snug">
                  {urgentReview ? 'ביקורת שלילית חדשה בגוגל – לא נענתה' : (urgentItem?.title || 'תובנה דחופה מהמערכת')}
                </div>
                <div className="text-[12px] text-gray-500 leading-relaxed">
                  {urgentReview
                    ? (urgentReview.content?.slice(0, 120) || 'תגובה מהירה מעלה את הציון הכולל ומגבירה את שביעות רצון הלקוחות.')
                    : (urgentItem?.summary?.slice(0, 120) || '')}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between mt-auto">
              <div className="flex items-center gap-1 text-gray-400 text-[11px]">
                <Clock className="w-3.5 h-3.5" />
                <span>2 דק'</span>
              </div>
              <button
                onClick={() => navigate(urgentReview ? '/reputation' : '/insights')}
                className="bg-[#e8344d] text-white text-[12px] font-semibold px-4 py-2 rounded-full hover:bg-[#c92b40] transition-colors"
              >
                {urgentReview ? 'קרא ואשר תגובה' : 'צפה בתובנה'}
              </button>
            </div>
          </div>
        ) : (
          /* Placeholder when no urgent item */
          <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-center">
            <p className="text-[13px] text-gray-300">אין פריטים דחופים</p>
          </div>
        )}
      </div>

      {/* ── זרם חי ───────────────────────────────────────────────────────── */}
      {liveItems.length > 0 && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-baseline justify-between mb-1">
            <button onClick={() => navigate('/approvals')} className="text-[12px] font-semibold text-[#e8344d] flex items-center gap-0.5">
              כל הפעולות <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <h3 className="text-[15px] font-bold text-gray-900">
              זרם חי {pendingActions.length > 0 && <span className="text-[#e8344d]">· {pendingActions.length}</span>}
            </h3>
          </div>
          <p className="text-[11px] text-gray-400 text-right mb-4">פעולות שהמערכת ביצעה וממתינות לאישור שלך</p>
          <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
            {liveItems.map((item, i) => (
              <LiveStreamCard key={i} {...item} />
            ))}
          </div>
        </div>
      )}

      {/* ── בזמן שישנת ───────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <div className="flex items-start justify-between mb-4">
          <button onClick={() => navigate('/insights')} className="text-[12px] font-semibold text-[#e8344d] flex items-center gap-0.5 mt-1">
            כל התובנות <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <div className="text-right">
            <h3 className="text-[15px] font-bold text-gray-900">בזמן שישנת</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">הינה כל מה שהמערכת עשתה עבורך בימה האחרונה</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'לידים חדשים שנמצאו', value: newLeadsToday.length },
            { label: 'נטישות',              value: 0 },
            { label: 'פעולות בוצעו',        value: actionsCompleted.length },
            { label: 'שעות שנחסכו',          value: (actionsCompleted.length * 0.5).toFixed(1) },
          ].map((kpi, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <span className="text-green-500 text-xs font-bold">✓</span>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-gray-900">{kpi.value}</div>
                <div className="text-[11px] text-gray-400 leading-snug">{kpi.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Upgrade banner ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-[#fce4ec] p-5 flex items-center justify-between gap-4">
        <button
          onClick={() => navigate('/subscription')}
          className="flex-shrink-0 bg-[#e8344d] text-white text-[13px] font-semibold px-5 py-2.5 rounded-full hover:bg-[#c92b40] transition-colors shadow-sm"
        >
          גלה הזדמנויות
        </button>
        <div className="text-right">
          <div className="font-semibold text-[13px] text-gray-900">המערכת יכולה לזהות יותר עבורך</div>
          <div className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
            כלל שתחבר יותר מקורות מידע, המערכת תזהה יותר הזדמנויות ותספק המלצות מדויקות יותר לפעולה.
          </div>
        </div>
      </div>

    </div>
  );
}
