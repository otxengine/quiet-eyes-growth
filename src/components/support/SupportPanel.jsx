import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Send, Video, Square, CheckCircle, MessageSquare, User, Loader2 } from 'lucide-react';
import { getBotResponse } from './SupportBot';

export default function SupportPanel({ onClose, businessProfile, onTicketCreated }) {
  const [step, setStep] = useState('chat'); // 'chat' | 'recording' | 'submitted'
  const [messages, setMessages] = useState([
    { role: 'bot', text: 'שלום! כיצד אוכל לעזור? תאר את הבעיה שנתקלת בה.' },
  ]);
  const [input, setInput] = useState('');
  const [issueDescription, setIssueDescription] = useState('');
  const [escalated, setEscalated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [botThinking, setBotThinking] = useState(false);

  // Recording
  const [recording, setRecording] = useState(false);
  const [recordingBlob, setRecordingBlob] = useState(null);
  const [recordingUrl, setRecordingUrl] = useState('');
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || botThinking) return;
    setInput('');

    if (!issueDescription) setIssueDescription(text);

    setMessages(prev => [...prev, { role: 'user', text }]);
    setBotThinking(true);
    setTimeout(scrollToBottom, 50);

    try {
      const botResp = await getBotResponse(text);
      setMessages(prev => [...prev, { role: 'bot', text: botResp.text }]);
      if (botResp.suggest_escalate) setEscalated(true);
    } finally {
      setBotThinking(false);
      setTimeout(scrollToBottom, 50);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        setRecordingBlob(blob);
        setRecordingUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(t => t.stop());
        setRecording(false);
      };
      mr.start();
      setRecording(true);
    } catch (err) {
      console.error('[Support] Recording error:', err);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  const submitTicket = async (withRecording = false) => {
    setSubmitting(true);
    try {
      const description = issueDescription || messages
        .filter(m => m.role === 'user')
        .map(m => m.text)
        .join(' | ') || 'פנייה ללא תיאור';

      // Send email notification to admin + create ticket
      await base44.functions.invoke('submitSupportTicket', {
        description,
        userEmail: businessProfile?.created_by || '',
        businessId: businessProfile?.id || '',
        hasRecording: withRecording && !!recordingBlob,
      });

      // Also save entity record for Admin Dashboard tab
      try {
        await base44.entities.SupportTicket.create({
          description,
          recording_url: withRecording && recordingBlob ? `recording_${Date.now()}.webm` : '',
          status: 'open',
          user_email: businessProfile?.created_by || '',
          business_id: businessProfile?.id || '',
        });
      } catch (_) {
        // Entity may not exist yet — email was already sent
      }
    } catch (err) {
      console.error('[Support] Ticket submit error:', err);
    }

    onTicketCreated?.();
    setStep('submitted');
    setSubmitting(false);
  };

  return (
    <div
      className="fixed z-50 flex flex-col overflow-hidden"
      style={{
        bottom: 96,
        left: 16,
        right: 'auto',
        width: 'min(400px, calc(100vw - 32px))',
        height: 'min(520px, calc(100vh - 104px))',
        background: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(232,52,77,0.15)',
        boxShadow: '0 16px 40px rgba(0,0,0,0.12)',
        borderRadius: '20px',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)' }}
          >
            <MessageSquare className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <span className="text-[13px] font-semibold text-foreground">תמיכה טכנית</span>
            <span className="text-[10px] text-foreground-muted block leading-none">אנחנו כאן לעזור</span>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary transition-colors">
          <X className="w-4 h-4 text-foreground-muted" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ scrollbarWidth: 'none' }}>
        {step === 'submitted' ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <CheckCircle className="w-12 h-12" style={{ color: '#10b981' }} />
            <p className="text-[15px] font-semibold text-foreground">פנייתך התקבלה!</p>
            <p className="text-[13px] text-foreground-muted">נציג יחזור אליך בהקדם האפשרי.</p>
          </div>
        ) : step === 'recording' ? (
          <div className="flex flex-col gap-4 py-4">
            <p className="text-[13px] text-foreground-secondary text-center">הקלט את הבעיה ואז שלח לנציג</p>
            {recording ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: '#fee2e2' }}>
                  <div className="w-5 h-5 rounded-full animate-pulse" style={{ background: '#E8344D' }} />
                </div>
                <p className="text-[12px] font-medium" style={{ color: '#E8344D' }}>מקליט את המסך...</p>
                <button
                  onClick={stopRecording}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-[12px] font-medium"
                  style={{ background: '#111' }}
                >
                  <Square className="w-3.5 h-3.5" />
                  עצור הקלטה
                </button>
              </div>
            ) : recordingUrl ? (
              <div className="flex flex-col gap-3">
                <video
                  src={recordingUrl}
                  controls
                  className="w-full rounded-xl"
                  style={{ maxHeight: 160 }}
                />
                <button
                  onClick={() => submitTicket(true)}
                  disabled={submitting}
                  className="w-full py-2.5 rounded-xl text-white text-[13px] font-semibold transition-opacity disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)' }}
                >
                  שלח עם הקלטה
                </button>
                <button
                  onClick={() => submitTicket(false)}
                  disabled={submitting}
                  className="w-full py-1.5 text-[12px] text-foreground-muted hover:text-foreground transition-colors"
                >
                  שלח ללא הקלטה
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <button
                  onClick={startRecording}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed text-[13px] font-medium transition-all"
                  style={{ borderColor: 'rgba(232,52,77,0.3)', color: '#E8344D' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(232,52,77,0.04)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <Video className="w-4 h-4" />
                  הקלט את הבעיה
                </button>
                <button
                  onClick={() => submitTicket(false)}
                  disabled={submitting}
                  className="w-full py-2.5 rounded-xl text-white text-[13px] font-semibold transition-opacity disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)' }}
                >
                  שלח ללא הקלטה
                </button>
              </div>
            )}
          </div>
        ) : (
          // Chat step
          <>
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'bot' && (
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)' }}
                  >
                    <MessageSquare className="w-3 h-3 text-white" />
                  </div>
                )}
                <div
                  className="max-w-[80%] rounded-2xl px-3 py-2 text-[12px] leading-relaxed"
                  style={msg.role === 'user'
                    ? { background: 'linear-gradient(135deg, #E8344D, #FF6B6B)', color: 'white' }
                    : { background: '#F3F4F6', color: '#333' }}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {botThinking && (
              <div className="flex gap-2 justify-start">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)' }}
                >
                  <MessageSquare className="w-3 h-3 text-white" />
                </div>
                <div className="rounded-2xl px-3 py-2" style={{ background: '#F3F4F6' }}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: '#E8344D' }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Footer — Input or Escalate */}
      {step === 'chat' && (
        <div className="border-t border-border/50 p-3 space-y-2">
          {escalated && (
            <button
              onClick={() => setStep('recording')}
              className="w-full py-2 rounded-xl text-white text-[12px] font-semibold flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)' }}
            >
              <User className="w-3.5 h-3.5" />
              עבור לנציג אנושי
            </button>
          )}
          <div className="flex items-center gap-2 bg-secondary/40 border border-border/60 rounded-xl px-3 py-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
              placeholder="תאר את הבעיה..."
              className="flex-1 bg-transparent text-[12px] text-foreground placeholder-foreground-muted/50 outline-none"
              dir="rtl"
              disabled={botThinking}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || botThinking}
              className="p-1.5 rounded-lg text-white transition-all disabled:opacity-30"
              style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)' }}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
