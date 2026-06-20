import React, { useState, useRef } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ChevronLeft, X, ArrowUpRight, Sparkles, Zap, Flame, Clock } from 'lucide-react';
import LiveStreamCard from '@/components/shared/LiveStreamCard';
import KoriAvatar from '@/components/onboarding/KoriAvatar';
import DailyBriefPanel from '@/components/dashboard/DailyBriefPanel';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  if (h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

function renderMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^##\s+(.+)$/gm, '<p class="font-semibold text-[13px] mt-2 mb-1">$1</p>')
    .replace(/^[•\-]\s+(.+)$/gm, '<li class="mr-3 list-disc text-[12px]">$1</li>');
}

const NAV_CHIPS = [
  { pattern: /לידים?/, label: 'לידים →', path: '/leads' },
  { pattern: /ביקורות|מוניטין/, label: 'מוניטין →', path: '/reputation' },
  { pattern: /מתחרי/, label: 'מתחרים →', path: '/competitors' },
  { pattern: /תובנ|התראה/, label: 'תובנות →', path: '/insights' },
  { pattern: /קמפיין|שיווק/, label: 'שיווק →', path: '/marketing' },
];

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

  // ── Chat thread state ──────────────────────────────────────────────────────
  const [messages, setMessages] = useState([]);
  // Each message: { role: 'ai'|'user', text: string, pendingAction?: {...} }
  const [chatLoading, setChatLoading] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  const [urgentDismissed, setUrgentDismissed] = useState(false);

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

  // ── Chat logic ─────────────────────────────────────────────────────────────
  const sendAiMessage = async (message) => {
    const msg = message || aiInput;
    if (!msg.trim() || chatLoading) return;
    setAiInput('');
    setChatLoading(true);

    const userMsg = { role: 'user', text: msg };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);

    // Scroll after user message
    setTimeout(() => threadRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

    try {
      let rawResult;
      // Pass last 8 messages as history for multi-turn context
      const history = nextMessages.slice(-8).map(m => ({ role: m.role, text: m.text }));
      try {
        rawResult = await base44.functions.invoke('chatWithBusiness', {
          message: msg,
          businessProfileId: bpId,
          history,
        });
      } catch (_) {
        rawResult = await base44.integrations.Core.InvokeLLM({
          prompt: `אתה עוזר עסקי חכם. ענה בעברית בקצרה. שאלה: ${msg}`,
          response_json_schema: null,
        });
      }

      // base44.functions.invoke may wrap response in { data: {...} }
      const result = rawResult?.data || rawResult;
      const text = result?.reply || result?.response || result?.message || result?.content || result?.text
        || (typeof result === 'string' ? result : null)
        || (typeof rawResult === 'string' ? rawResult : null)
        || 'לא הצלחתי לקבל תשובה.';
      const pendingAction = result?.pendingAction || null;

      const aiMsg = { role: 'ai', text, pendingAction };
      setMessages(prev => [...prev, aiMsg]);
      setTimeout(() => threadRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', text: 'שגיאה בהתחברות. נסה שוב.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleChipClick = (chip) => {
    if (chip.path) navigate(chip.path);
    else if (chip.prompt) sendAiMessage(chip.prompt);
  };

  const handleApproveAction = async (msgIndex, pendingAction) => {
    try {
      await base44.entities.AutoAction.create({
        action_type: pendingAction.type,
        prefilled_text: pendingAction.payload?.text || pendingAction.label,
        decision_reason: pendingAction.label,
        status: 'pending_approval',
        linked_business: bpId,
      });
      // Clear the action card after creation
      setMessages(prev => prev.map((m, i) =>
        i === msgIndex ? { ...m, pendingAction: null } : m
      ));
      navigate('/approvals');
    } catch (err) {
      console.error('[Dashboard] AutoAction.create failed:', err);
    }
  };

  const handleRejectAction = (msgIndex) => {
    setMessages(prev => prev.map((m, i) =>
      i === msgIndex ? { ...m, pendingAction: null } : m
    ));
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
          <input
            ref={inputRef}
            value={aiInput}
            onChange={e => setAiInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendAiMessage()}
            placeholder="תאר במילים מה תרצה לבצע והמערכת תתחיל בעבודה"
            className="flex-1 bg-transparent text-[13px] text-gray-700 placeholder:text-gray-400 outline-none min-w-0"
          />
          <button
            onClick={() => sendAiMessage()}
            disabled={!aiInput.trim() || chatLoading}
            className="w-10 h-10 rounded-full bg-[#111] flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-opacity"
            style={{ marginRight: '8px' }}
          >
            {chatLoading
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

      {/* ── Daily Brief ────────────────────────────────────────────────────── */}
      <DailyBriefPanel businessProfile={businessProfile} />

      {/* ── Chat thread ────────────────────────────────────────────────────── */}
      {messages.length > 0 && (
        <div className="flex flex-col gap-3">
          {messages.map((msg, i) => (
            <div key={i}>
              {msg.role === 'user' ? (
                /* User bubble — right-aligned */
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-800 rounded-2xl px-4 py-2 max-w-[80%] text-[13px] leading-relaxed">
                    {msg.text}
                  </div>
                </div>
              ) : (
                /* AI bubble — left-aligned with Kori avatar */
                <div className="flex gap-3 justify-end">
                  <div className="flex-1 max-w-[85%]">
                    <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 text-[13px] text-gray-800 leading-relaxed shadow-sm">
                      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
                    </div>

                    {/* Nav chips — detect topics in AI response */}
                    {(() => {
                      const chips = NAV_CHIPS.filter(c => c.pattern.test(msg.text));
                      return chips.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {chips.map((c, ci) => (
                            <button
                              key={ci}
                              onClick={() => navigate(c.path)}
                              className="text-[11px] font-medium bg-white border border-gray-200 text-[#e8344d] px-3 py-1 rounded-full hover:bg-red-50 transition-colors shadow-sm"
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      ) : null;
                    })()}

                    {/* Action proposal card */}
                    {msg.pendingAction && (
                      <div className="mt-3 border border-[#e8344d] rounded-xl p-3 bg-[#fce4ec]">
                        <p className="text-[11px] font-semibold text-[#e8344d] mb-1 uppercase tracking-wider">פעולה מוצעת</p>
                        <p className="text-[13px] text-gray-800 mb-3">{msg.pendingAction.label}</p>
                        <div className="flex gap-2 justify-start">
                          <button
                            onClick={() => handleRejectAction(i)}
                            className="text-[12px] text-gray-500 px-3 py-1.5 rounded-full border border-gray-200 hover:bg-gray-50 transition-colors"
                          >
                            לא עכשיו
                          </button>
                          <button
                            onClick={() => handleApproveAction(i, msg.pendingAction)}
                            className="text-[12px] font-semibold bg-[#e8344d] text-white px-4 py-1.5 rounded-full hover:bg-[#c92b40] transition-colors"
                          >
                            שלח לאישור →
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <KoriAvatar size="sm" className="flex-shrink-0 mt-1" />
                </div>
              )}
            </div>
          ))}

          {/* Loading indicator */}
          {chatLoading && (
            <div className="flex gap-3 justify-end">
              <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
                <div className="flex gap-1 items-center">
                  {[0, 1, 2].map(n => (
                    <span
                      key={n}
                      className="w-2 h-2 rounded-full bg-gray-300 animate-pulse"
                      style={{ animationDelay: `${n * 150}ms` }}
                    />
                  ))}
                </div>
              </div>
              <KoriAvatar size="sm" className="flex-shrink-0 mt-1" />
            </div>
          )}

          {/* Scroll anchor */}
          <div ref={threadRef} />

          {/* Expand to full chat link */}
          <div className="flex justify-center mt-1">
            <button
              onClick={() => navigate('/chat')}
              className="text-[11px] text-gray-400 hover:text-[#e8344d] transition-colors flex items-center gap-1"
            >
              הרחב לצ'אט מלא →
            </button>
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
