import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

const REASON_CHIPS = {
  competitor: ['לא מתחרה ישיר', 'לא באזור שלי', 'כבר מכיר אותו', 'לא רלוונטי לתחום'],
  event:      ['לא רלוונטי לתחום שלי', 'כבר מתכנן', 'לא בתקופה הנכונה', 'ידוע לי'],
  alert:      ['כבר ביצעתי', 'לא ריאלי', 'מידע שגוי', 'לא רלוונטי'],
  signal:     ['כבר ביצעתי', 'לא ריאלי', 'מידע שגוי', 'לא רלוונטי'],
  retention:  ['לקוח לא פעיל', 'כבר פנינו ללקוח', 'לא מתאים לתוכנית', 'בוטל'],
};

/**
 * DismissMenu — dropdown with reason chips + free text.
 * Calls updateInsightMemory then invokes onDismissed() on success.
 *
 * Props:
 *   entityType    'alert' | 'signal' | 'competitor' | 'event' | 'retention'
 *   entityId      string — DB record id (optional for retention/static)
 *   title         string — used for pattern extraction on server
 *   businessProfileId  string
 *   onDismissed   () => void — called after successful dismiss
 *   buttonLabel   string (default "הסר")
 *   buttonClassName string (override button style)
 */
export default function DismissMenu({
  entityType = 'alert',
  entityId,
  title = '',
  businessProfileId,
  onDismissed,
  buttonLabel,
  buttonClassName,
}) {
  const [open, setOpen]       = useState(false);
  const [reason, setReason]   = useState('');
  const [loading, setLoading] = useState(false);
  const menuRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const chips = REASON_CHIPS[entityType] || REASON_CHIPS.alert;

  const handleConfirm = async () => {
    if (!businessProfileId) return;
    setLoading(true);
    try {
      await base44.functions.invoke('updateInsightMemory', {
        businessProfileId,
        action: 'dismissed',
        entityType,
        entityId: entityId || undefined,
        title,
        reason: reason.trim() || undefined,
      });
      setOpen(false);
      setReason('');
      onDismissed?.();
    } catch {
      toast.error('שגיאה בהסרה — נסה שוב');
    }
    setLoading(false);
  };

  const defaultBtnCls = 'flex items-center gap-1 text-[10px] text-foreground-muted hover:text-red-500 transition-colors';

  return (
    <div className="relative inline-block" ref={menuRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className={buttonClassName || defaultBtnCls}
        title="הסר — ציין סיבה"
      >
        <X className="w-3 h-3" />
        {buttonLabel !== '' && (buttonLabel ?? 'לא רלוונטי')}
        <ChevronDown className={`w-2.5 h-2.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 w-64 bg-white border border-border rounded-xl shadow-lg p-3 space-y-2"
          onClick={e => e.stopPropagation()}
        >
          <p className="text-[11px] font-semibold text-foreground">מדוע זה לא רלוונטי?</p>

          {/* Quick chips */}
          <div className="flex flex-wrap gap-1.5">
            {chips.map(chip => (
              <button
                key={chip}
                onClick={() => setReason(prev => prev === chip ? '' : chip)}
                className={`text-[10px] px-2 py-1 rounded-full border transition-all ${
                  reason === chip
                    ? 'bg-foreground text-background border-foreground'
                    : 'border-border text-foreground-muted hover:border-foreground-muted'
                }`}
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Free text */}
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="או כתוב סיבה אחרת..."
            className="w-full text-[11px] border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-foreground/30 placeholder:text-foreground-muted"
          />

          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="flex-1 text-[11px] font-semibold py-1.5 rounded-lg bg-foreground text-background hover:opacity-90 transition-all disabled:opacity-50"
            >
              {loading ? 'מסיר...' : 'הסר ולמד'}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-[11px] px-3 py-1.5 rounded-lg border border-border text-foreground-muted hover:text-foreground transition-colors"
            >
              ביטול
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
