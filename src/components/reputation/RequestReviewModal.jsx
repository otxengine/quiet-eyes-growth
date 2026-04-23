import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Loader2, Copy, Check, Send } from 'lucide-react';
import { toast } from 'sonner';

const platforms = ['Google', 'Facebook', 'Instagram'];

function formatPhone(phone) {
  const cleaned = phone.replace(/[\s\-]/g, '');
  if (cleaned.startsWith('0')) return '972' + cleaned.substring(1);
  if (cleaned.startsWith('+972')) return cleaned.substring(1);
  if (cleaned.startsWith('972')) return cleaned;
  return cleaned;
}

export default function RequestReviewModal({ businessProfile, onClose, onSent }) {
  const [form, setForm] = useState({ customer_name: '', phone: '', platform: 'Google' });
  const [message, setMessage] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);

  const bpName = businessProfile?.name || 'העסק';
  const tone = businessProfile?.tone_preference || 'friendly';

  useEffect(() => {
    if (!form.customer_name) {
      setMessage('');
      return;
    }
    generateMessage();
  }, [form.customer_name, form.platform, tone]);

  const generateMessage = async () => {
    if (!form.customer_name) return;
    setGenerating(true);
    const toneInstructions = {
      friendly: `כתוב הודעה חמה וידידותית עם אימוג'ים. פנה ללקוח בשם. התחל עם "היי" ופנה בגוף שני.`,
      formal: `כתוב הודעה מנומסת ורשמית. פנה ב"שלום" ובלשון מכבדת.`,
      direct: `כתוב הודעה קצרה וישירה ללא מילים מיותרות. שורה אחת עם קישור.`,
      humorous: `כתוב הודעה קלילה עם הומור קל ואימוג'ים. תהיה מצחיק אבל לא מוגזם.`,
    };
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `כתוב הודעת WhatsApp קצרה בעברית לבקשת ביקורת מלקוח.
שם הלקוח: ${form.customer_name}
שם העסק: ${bpName}
פלטפורמה: ${form.platform}
${toneInstructions[tone] || toneInstructions.friendly}
ההודעה צריכה לכלול: פנייה אישית, תודה על הביקור, בקשה לביקורת קצרה, ומקום לקישור [קישור לביקורת].
מקסימום 4 שורות. החזר רק את טקסט ההודעה, ללא הסברים.`,
    });
    setMessage(result.trim());
    setGenerating(false);
  };

  const handleSend = async () => {
    if (!form.customer_name || !form.phone) return;
    setSending(true);
    const waPhone = formatPhone(form.phone);
    const encoded = encodeURIComponent(message);
    const waUrl = `https://wa.me/${waPhone}?text=${encoded}`;

    await base44.entities.ReviewRequest.create({
      customer_name: form.customer_name,
      phone: form.phone,
      platform: form.platform,
      sent_at: new Date().toISOString(),
      linked_business: businessProfile?.id,
    });

    window.open(waUrl, '_blank');
    toast.success('ההודעה נפתחה ב-WhatsApp');
    setSending(false);
    onSent();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(message);
    setCopied(true);
    toast.success('✓ הועתק');
    setTimeout(() => setCopied(false), 2000);
  };

  const inputCls = "w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2 text-[13px] text-foreground placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white border border-border rounded-[10px] p-5 w-full max-w-md mx-4 z-10 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-foreground">בקש ביקורת מלקוח</h3>
          <button onClick={onClose} className="text-[#cccccc] hover:text-[#999999]"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[12px] text-[#999999] mb-1 block">שם הלקוח *</label>
            <input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} className={inputCls} placeholder="שם הלקוח..." />
          </div>
          <div>
            <label className="text-[12px] text-[#999999] mb-1 block">טלפון *</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} placeholder="05X-XXXXXXX" dir="ltr" />
          </div>
          <div>
            <label className="text-[12px] text-[#999999] mb-1 block">פלטפורמה</label>
            <div className="flex gap-2">
              {platforms.map((p) => (
                <button key={p} onClick={() => setForm({ ...form, platform: p })}
                  className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${form.platform === p ? 'bg-foreground text-background' : 'text-foreground-muted border border-border hover:border-border-hover'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {generating && (
            <div className="flex items-center gap-2 justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-foreground-muted" />
              <span className="text-[12px] text-foreground-muted">מייצר הודעה...</span>
            </div>
          )}

          {message && !generating && (
            <div>
              <label className="text-[12px] text-[#999999] mb-1 block">תצוגה מקדימה</label>
              <div className="bg-[#fafafa] border border-[#eeeeee] rounded-lg p-4 text-[13px] text-[#444444] whitespace-pre-wrap leading-relaxed">
                {message}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={handleSend} disabled={sending || !form.customer_name || !form.phone || !message}
              className="flex-1 py-2.5 rounded-md text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              שלח ב-WhatsApp
            </button>
            <button onClick={handleCopy} disabled={!message}
              className="px-4 py-2.5 rounded-md text-[12px] font-medium text-foreground-muted border border-border hover:border-border-hover transition-all disabled:opacity-50 flex items-center gap-1.5">
              {copied ? <Check className="w-3.5 h-3.5 text-[#10b981]" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'הועתק' : 'העתק הודעה'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}