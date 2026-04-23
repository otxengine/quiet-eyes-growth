import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Bot, MessageSquare, Send, Loader2, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

export default function WhatsAppBotStatus({ lead, businessProfile }) {
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [processingReply, setProcessingReply] = useState(false);
  const [botResponse, setBotResponse] = useState(null);

  const phone = lead.contact_info?.match(/[\d\-+()]{7,}/)?.[0]?.replace(/[^0-9+]/g, '') || null;
  const botEnabled = businessProfile?.bot_enabled;

  // Parse conversation state
  let state = null;
  try {
    state = JSON.parse(lead.questionnaire_answers || '{}');
  } catch (_) {}

  const isQualificationDone = state?.completed_at || state?.fit_score !== undefined;
  const currentStep = state?.step || 0;
  const totalSteps = state?.total_steps || state?.questions?.length || 0;
  const answers = state?.answers || [];

  if (!phone || !botEnabled) return null;

  const handleStartBot = async () => {
    setSending(true);
    try {
      const res = await base44.functions.invoke('whatsappBotHandler', {
        mode: 'new_lead',
        data: { ...lead, id: lead.id },
        event: { type: 'create', entity_id: lead.id },
      });
      if (res.data?.whatsapp_link) {
        window.open(res.data.whatsapp_link, '_blank');
        toast.success('הודעת הפתיחה נוצרה — נפתח WhatsApp');
      }
    } catch (err) {
      toast.error('שגיאה בהפעלת הבוט: ' + err.message);
    }
    setSending(false);
  };

  const handleProcessReply = async () => {
    if (!replyText.trim()) return;
    setProcessingReply(true);
    setBotResponse(null);
    try {
      const res = await base44.functions.invoke('whatsappBotHandler', {
        mode: 'reply',
        sender_phone: phone,
        sender_message: replyText.trim(),
      });
      if (res.data?.bot_response) {
        setBotResponse(res.data);
        setReplyText('');
        toast.success(res.data.action === 'qualification_complete' ? 'סינון הושלם!' : 'תשובה עובדה — השאלה הבאה מוכנה');
      }
    } catch (err) {
      toast.error('שגיאה בעיבוד התשובה: ' + err.message);
    }
    setProcessingReply(false);
  };

  return (
    <div className="border border-[#e8f5e9] bg-[#fafff9] rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-[#f0faf0] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Bot className="w-4 h-4 text-[#10b981]" />
        <span className="text-[12px] font-medium text-[#222]">בוט סינון WhatsApp</span>
        <div className="mr-auto flex items-center gap-2">
          {isQualificationDone ? (
            <span className="text-[10px] font-medium text-[#10b981] flex items-center gap-1"><CheckCircle className="w-3 h-3" /> הושלם</span>
          ) : totalSteps > 0 ? (
            <span className="text-[10px] text-[#999]">{currentStep}/{totalSteps} שאלות</span>
          ) : (
            <span className="text-[10px] text-[#ccc]">לא הופעל</span>
          )}
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-[#ccc]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#ccc]" />}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-[#e8f5e9]">
          {/* Show answers so far */}
          {answers.length > 0 && (
            <div className="space-y-1.5 pt-2">
              {answers.map((a, i) => (
                <div key={i} className="text-[11px]">
                  <span className="text-[#999]">ש: {a.question}</span>
                  <span className="block text-[#333] font-medium">ת: {a.answer}</span>
                </div>
              ))}
            </div>
          )}

          {/* Qualification result */}
          {isQualificationDone && state?.fit_score !== undefined && (
            <div className="bg-white rounded-md p-2.5 border border-[#e0e0e0]">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-semibold text-[#222]">תוצאת סינון:</span>
                <span className={`text-[11px] font-bold ${state.fit_score >= 70 ? 'text-[#10b981]' : state.fit_score >= 40 ? 'text-[#d97706]' : 'text-[#999]'}`}>
                  {state.fit_score}/100
                </span>
              </div>
              {state.fit_reasoning && <p className="text-[10px] text-[#666]">{state.fit_reasoning}</p>}
            </div>
          )}

          {/* Start bot button */}
          {!isQualificationDone && currentStep === 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); handleStartBot(); }}
              disabled={sending}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[11px] font-medium bg-[#10b981] text-white hover:bg-[#059669] transition-colors disabled:opacity-50 w-full justify-center"
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {sending ? 'שולח...' : 'שלח הודעת פתיחה בוואטסאפ'}
            </button>
          )}

          {/* Reply processing — for when the lead replies */}
          {!isQualificationDone && currentStep > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] text-[#999]">הזן את תשובת הליד כדי לקבל את השאלה הבאה:</p>
              <div className="flex gap-2">
                <input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleProcessReply()}
                  placeholder="הקלד את תשובת הליד..."
                  className="flex-1 bg-white border border-[#e0e0e0] rounded-md px-2.5 py-1.5 text-[12px] text-[#222] placeholder-[#ccc] focus:outline-none focus:border-[#10b981]"
                />
                <button
                  onClick={(e) => { e.stopPropagation(); handleProcessReply(); }}
                  disabled={processingReply || !replyText.trim()}
                  className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-[#111] text-white hover:bg-[#333] transition-colors disabled:opacity-50"
                >
                  {processingReply ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          )}

          {/* Show bot response after processing reply */}
          {botResponse && (
            <div className="bg-white rounded-md p-2.5 border border-[#d1fae5]">
              <p className="text-[11px] text-[#10b981] font-medium mb-1">תגובת הבוט:</p>
              <p className="text-[12px] text-[#333]">{botResponse.bot_response}</p>
              {botResponse.whatsapp_link && (
                <a
                  href={botResponse.whatsapp_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 mt-2 px-3 py-1.5 rounded-md text-[11px] font-medium bg-[#10b981] text-white hover:bg-[#059669] transition-colors"
                >
                  <Send className="w-3 h-3" /> שלח בוואטסאפ
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}