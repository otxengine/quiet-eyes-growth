import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Clock, Sparkles, Loader2, Zap, Share2, MessageSquare } from 'lucide-react';
import ActionPopup from '@/components/ui/ActionPopup';

function getCountdownFull(eventDate) {
  if (!eventDate) return null;
  const ms = new Date(eventDate).getTime() - Date.now();
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days === 0) return `${hours} שעות`;
  if (days < 7) return `${days} ימים`;
  if (days < 30) return `${Math.ceil(days / 7)} שבועות`;
  return `${Math.ceil(days / 30)} חודשים`;
}

const ACTION_SUGGESTIONS = [
  { icon: '📣', label: 'צור קמפיין שיווקי', type: 'campaign' },
  { icon: '💬', label: 'שלח הודעת WhatsApp ללקוחות', type: 'whatsapp' },
  { icon: '📸', label: 'פרסם פוסט לרשתות חברתיות', type: 'social_post' },
  { icon: '🎯', label: 'הכן מבצע מיוחד', type: 'promotion' },
];

export default function EventDetailModal({ item, type, businessProfile, onClose }) {
  const [aiContext, setAiContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionPopup, setActionPopup] = useState(false);

  const title = type === 'static' ? item.title
    : type === 'alert' ? item.title
    : item.agent_name || item.summary?.slice(0, 60);

  const description = type === 'static' ? item.description
    : type === 'alert' ? item.description
    : item.summary;

  const eventDate = item.event_date || null;
  const countdown = getCountdownFull(eventDate);

  const bizName = businessProfile?.name || '';
  const bizCategory = businessProfile?.category || '';

  useEffect(() => {
    generateContext();
  }, []);

  const generateContext = async () => {
    setLoading(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `אתה יועץ שיווקי לעסקים ישראלים.
העסק: "${bizName}" (${bizCategory})
האירוע: "${title}"
תיאור: "${(description || '').substring(0, 300)}"
${countdown ? `זמן עד לאירוע: ${countdown}` : ''}

ספק בעברית:
1. "business_opportunity" — 1-2 משפטים: מה ההזדמנות הספציפית לעסק הזה
2. "recommended_action" — פעולה אחת קונקרטית שמומלץ לבצע לפני האירוע
3. "timing_tip" — מתי כדאי להתחיל להכין (למשל: "2 שבועות מראש")

JSON בלבד: {"business_opportunity":"...","recommended_action":"...","timing_tip":"..."}`,
      });
      try {
        const parsed = typeof result === 'string' ? JSON.parse(result.trim()) : result;
        setAiContext(parsed);
      } catch {
        setAiContext({ business_opportunity: result || '', recommended_action: '', timing_tip: '' });
      }
    } catch {
      setAiContext(null);
    }
    setLoading(false);
  };

  const fakeSignal = {
    id: item.id,
    summary: description,
    agent_name: title,
    category: 'event',
    source_description: type === 'static' ? '{}' : (item.source_description || item.source_agent || '{}'),
    impact_level: 'high',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-[#f0f0f0] flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-bold text-foreground leading-snug">{title}</h2>
            {countdown && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <Clock className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-[12px] font-medium text-blue-600">בעוד {countdown}</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="flex-shrink-0 p-1 rounded-lg hover:bg-[#f5f5f5] transition-colors">
            <X className="w-4 h-4 text-[#aaaaaa]" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Description */}
          <p className="text-[13px] text-[#555555] leading-relaxed">{description}</p>

          {/* AI Business Context */}
          <div className="bg-[#faf8ff] border border-[#e8e0ff] rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-500" />
              <span className="text-[12px] font-semibold text-purple-700">מה המשמעות לעסק שלך?</span>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                <span className="text-[11px] text-purple-500">מנתח הזדמנות עסקית...</span>
              </div>
            ) : aiContext ? (
              <div className="space-y-2.5">
                {aiContext.business_opportunity && (
                  <p className="text-[12px] text-purple-800 leading-relaxed">{aiContext.business_opportunity}</p>
                )}
                {aiContext.recommended_action && (
                  <div className="flex items-start gap-2 bg-white rounded-lg p-2.5 border border-[#e8e0ff]">
                    <span className="text-[14px] flex-shrink-0">✅</span>
                    <div>
                      <p className="text-[10px] font-medium text-purple-500 mb-0.5">פעולה מומלצת</p>
                      <p className="text-[12px] text-[#333333]">{aiContext.recommended_action}</p>
                    </div>
                  </div>
                )}
                {aiContext.timing_tip && (
                  <div className="flex items-center gap-1.5 text-[11px] text-[#888888]">
                    <Clock className="w-3 h-3" />
                    <span>{aiContext.timing_tip}</span>
                  </div>
                )}
              </div>
            ) : (
              <button onClick={generateContext} className="text-[11px] text-purple-600 underline">נסה שוב</button>
            )}
          </div>

          {/* Quick action suggestions */}
          <div>
            <p className="text-[11px] font-medium text-[#888888] mb-2">פעולות מהירות לאירוע זה:</p>
            <div className="grid grid-cols-2 gap-2">
              {ACTION_SUGGESTIONS.map(a => (
                <button
                  key={a.type}
                  onClick={() => setActionPopup(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#eeeeee] bg-white hover:border-[#cccccc] hover:bg-[#fafafa] transition-colors text-right"
                >
                  <span className="text-[13px]">{a.icon}</span>
                  <span className="text-[10px] text-[#555555] leading-tight">{a.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Primary action */}
          <button
            onClick={() => setActionPopup(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#111111] text-white text-[13px] font-semibold hover:opacity-90 transition-all"
          >
            <Zap className="w-4 h-4" />
            פעל עכשיו על האירוע הזה
          </button>
        </div>
      </div>

      {actionPopup && (
        <ActionPopup
          signal={fakeSignal}
          businessProfile={businessProfile}
          onClose={() => setActionPopup(false)}
        />
      )}
    </div>
  );
}
