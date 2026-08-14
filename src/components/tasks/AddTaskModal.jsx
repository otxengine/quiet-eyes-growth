import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const SUGGESTION_CHIPS = [
  'לייצר לקוחות חדשים',
  'לשמח לקוחות קיימים',
  'להגדיל מכירות',
  'להגדיל מניות',
];

function GradientOrb() {
  return (
    <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
      style={{
        background: 'radial-gradient(circle at 35% 35%, #a78bfa, #ec4899, #f97316)',
        boxShadow: '0 8px 32px rgba(167,139,250,0.4)',
      }}
    >
      <span className="text-white text-[22px] font-bold">K</span>
    </div>
  );
}

export default function AddTaskModal({ bpId, onClose, onAdded, prefill }) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState(prefill?.title || prefill?.description || '');

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Task.create({ ...data, linked_business: bpId, status: 'pending' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('המשימה נוצרה בהצלחה ✓');
      onAdded?.();
    },
  });

  const handleSubmit = () => {
    if (!description.trim()) return;
    createMutation.mutate({
      title: description.trim(),
      description: description.trim(),
      priority: prefill?.priority || 'medium',
      source_alert_id: prefill?.source_alert_id || '',
      source_type: prefill?.source_alert_id ? 'alert' : 'manual',
    });
  };

  const handleChip = (chip) => {
    setDescription(chip);
  };

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
        <h2 className="text-[15px] font-bold text-gray-900">הוספת משימה חדשה</h2>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 transition-colors"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-10">
        <GradientOrb />

        <p className="text-[17px] font-bold text-gray-900 text-center mb-6 leading-snug">
          ערב טוב טל, תאר במילים שלך<br />את המשימה החדשה
        </p>

        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="תאר מה ברצונך להשיג..."
          rows={3}
          className="w-full max-w-md bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-800 placeholder-gray-400 resize-none focus:outline-none focus:border-[#e8344d]/40 transition-colors mb-5"
          dir="rtl"
          autoFocus
        />

        {/* Suggestion chips */}
        <div className="flex flex-wrap gap-2 justify-center mb-8 max-w-md">
          {SUGGESTION_CHIPS.map(chip => (
            <button
              key={chip}
              onClick={() => handleChip(chip)}
              className="px-3 py-1.5 rounded-full border border-gray-200 text-[12px] text-gray-600 bg-white hover:border-[#e8344d]/40 hover:text-[#e8344d] transition-colors"
            >
              {chip}
            </button>
          ))}
        </div>

        {/* CTA */}
        <button
          onClick={handleSubmit}
          disabled={!description.trim() || createMutation.isPending}
          className="w-full max-w-md py-3 rounded-xl bg-[#e8344d] text-white text-[14px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2 mb-3"
        >
          {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          בוא נתקדם
        </button>

        <button
          onClick={onClose}
          className="text-[13px] text-gray-400 hover:text-gray-600 transition-colors"
        >
          מלאו אחרי כך
        </button>
      </div>
    </div>
  );
}
