import React, { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function WhatsAppQuickSend({ lead, onSent }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const phone = lead.contact_info?.match(/[\d\-+()]{7,}/)?.[0]?.replace(/[^0-9+]/g, '');
  if (!phone) return null;

  const handleSend = () => {
    if (!message.trim()) return;
    setSending(true);
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
    toast.success('פתח חלון WhatsApp ✓');
    if (onSent) onSent(message);
    setMessage('');
    setSending(false);
  };

  return (
    <div>
      <h4 className="text-[11px] font-semibold text-foreground mb-2">שלח הודעה חופשית</h4>
      <div className="flex gap-2">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={`כתוב הודעה ל${lead.name}...`}
          className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-[12px] text-foreground placeholder-foreground-muted focus:outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/20"
        />
        <button onClick={handleSend} disabled={!message.trim() || sending}
          className="btn-subtle px-3 py-2 rounded-lg bg-success text-success-foreground hover:opacity-90 transition-all disabled:opacity-40">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}