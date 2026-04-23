import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Loader2, Copy, Check, Send } from 'lucide-react';
import { toast } from 'sonner';

function formatPhone(phone) {
  const cleaned = phone.replace(/[\s\-]/g, '');
  if (cleaned.startsWith('0')) return '972' + cleaned.substring(1);
  if (cleaned.startsWith('+972')) return cleaned.substring(1);
  return cleaned;
}

export default function LeadFirstContactModal({ lead, businessProfile, onClose, onSent }) {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const phoneMatch = lead.contact_info?.match(/[\d\-+()]{7,}/);
  const phone = phoneMatch ? phoneMatch[0] : null;

  useEffect(() => {
    generateMessage();
  }, []);

  const generateMessage = async () => {
    setLoading(true);
    const res = await base44.functions.invoke('generateLeadFirstContact', { leadId: lead.id });
    setMessage(res.data?.message || '');
    setLoading(false);
  };

  const handleSend = () => {
    if (!phone || !message) return;
    const waPhone = formatPhone(phone);
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/${waPhone}?text=${encoded}`, '_blank');
    
    // Update lead status to contacted
    base44.entities.Lead.update(lead.id, { status: 'contacted' });
    base44.functions.invoke('logOutcome', {
      action_type: 'lead_first_contact', was_accepted: true,
      outcome_description: `הודעה ראשונית ל-${lead.name}`,
      linked_business: lead.linked_business || '',
    }).catch(() => {});
    
    toast.success('ההודעה נפתחה ב-WhatsApp');
    onSent?.();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(message);
    setCopied(true);
    toast.success('✓ הועתק');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white border border-border rounded-[10px] p-5 w-full max-w-md mx-4 z-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-foreground">הודעה ראשונית ל-{lead.name}</h3>
          <button onClick={onClose} className="text-[#cccccc] hover:text-[#999999]"><X className="w-4 h-4" /></button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-foreground-muted" />
            <span className="text-[12px] text-foreground-muted">מכין הודעה...</span>
          </div>
        ) : (
          <div className="space-y-3">
            <textarea value={message} onChange={(e) => setMessage(e.target.value)}
              rows={5} className="w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg p-3 text-[13px] text-[#333333] resize-none focus:outline-none focus:border-[#dddddd]" />
            <div className="flex gap-2">
              <button onClick={handleSend} disabled={!phone || !message}
                className="flex-1 py-2.5 rounded-md text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                <Send className="w-4 h-4" /> שלח ב-WhatsApp
              </button>
              <button onClick={handleCopy} disabled={!message}
                className="px-4 py-2.5 rounded-md text-[12px] font-medium text-foreground-muted border border-border hover:border-border-hover transition-all disabled:opacity-50 flex items-center gap-1.5">
                {copied ? <Check className="w-3.5 h-3.5 text-[#10b981]" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'הועתק' : 'העתק'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}