import React from 'react';
import { X } from 'lucide-react';

const reasons = ['מחיר', 'מתחרה', 'לא רלוונטי', 'אחר'];

export default function LostReasonPicker({ lead, onSelect, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-xl border border-border shadow-xl p-5 w-[300px]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14px] font-semibold text-foreground">סיבת אובדן</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-foreground-muted" /></button>
        </div>
        <p className="text-[12px] text-foreground-muted mb-3">למה הליד "{lead.name}" אבד?</p>
        <div className="space-y-2">
          {reasons.map(reason => (
            <button
              key={reason}
              onClick={() => onSelect(reason)}
              className="w-full text-right px-4 py-2.5 rounded-lg border border-border hover:bg-secondary hover:border-border-hover transition-all text-[12px] font-medium text-foreground"
            >
              {reason}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}