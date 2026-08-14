import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { X, Paperclip, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const CATEGORIES = [
  'שיווק וניהול',
  'חגים ומועדים',
  'מסחרי',
  'עונתי',
  'ספורט',
  'תרבות',
  'מקומי',
  'אחר',
];

const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#e8344d]/40 transition-colors';

export default function AddEventPanel({ bpId, onClose, onAdded }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    date: '',
    category: '',
    description: '',
    goals: '',
    notes: '',
    auto_30_days: true,
    auto_10_days: false,
  });

  const createMutation = useMutation({
    mutationFn: (data) =>
      base44.entities.MarketSignal.create({
        linked_business: bpId,
        category: 'event',
        agent_name: data.name,
        summary: data.description,
        source_description: JSON.stringify({
          event_date: data.date,
          event_category: data.category,
          goals: data.goals,
          notes: data.notes,
          auto_30_days: data.auto_30_days,
          auto_10_days: data.auto_10_days,
        }),
        is_dismissed: false,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eventSignals', bpId] });
      toast.success('האירוע נשמר ✓');
      onAdded?.();
    },
    onError: () => toast.error('שגיאה בשמירת האירוע'),
  });

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    createMutation.mutate(form);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <h3 className="text-[15px] font-bold text-gray-900">הוספת אירוע חדש</h3>
      </div>

      <div className="px-5 py-5 space-y-4">
        {/* Row 1: Name + Date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-medium text-gray-500 block mb-1.5">תאריך האירוע</label>
            <input
              type="date"
              value={form.date}
              onChange={e => setForm({ ...form, date: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-gray-500 block mb-1.5">שם האירוע</label>
            <input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="מה יום האירוע"
              className={inputCls}
              autoFocus
            />
          </div>
        </div>

        {/* Category */}
        <div>
          <label className="text-[11px] font-medium text-gray-500 block mb-1.5">קטגוריה</label>
          <select
            value={form.category}
            onChange={e => setForm({ ...form, category: e.target.value })}
            className={inputCls}
          >
            <option value="">בחר קטגוריה...</option>
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div>
          <label className="text-[11px] font-medium text-gray-500 block mb-1.5">תיאור האירוע</label>
          <textarea
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            rows={3}
            placeholder="תאר את האירוע, ההזדמנות והרלוונטיות לעסק שלך..."
            className={`${inputCls} resize-none`}
          />
        </div>

        {/* Goals */}
        <div>
          <label className="text-[11px] font-medium text-gray-500 block mb-1.5">מטרות האירוע</label>
          <textarea
            value={form.goals}
            onChange={e => setForm({ ...form, goals: e.target.value })}
            rows={2}
            placeholder="למשל: להגדיל מכירות, לייצר לקוחות חדשים..."
            className={`${inputCls} resize-none`}
          />
        </div>

        {/* Automation */}
        <div>
          <p className="text-[12px] font-semibold text-gray-700 mb-2">
            מה חברה שהמערכת תעשה לאחר הוספת האירוע?
          </p>
          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.auto_30_days}
                onChange={e => setForm({ ...form, auto_30_days: e.target.checked })}
                className="w-4 h-4 accent-[#e8344d] rounded"
              />
              <div>
                <span className="text-[12px] font-medium text-gray-700">30 ימים לפני האירוע</span>
                <span className="text-[11px] text-gray-400 mr-2">הפעל מסעות קמפיין</span>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.auto_10_days}
                onChange={e => setForm({ ...form, auto_10_days: e.target.checked })}
                className="w-4 h-4 accent-[#e8344d] rounded"
              />
              <span className="text-[12px] font-medium text-gray-700">10 ימים לפני האירוע</span>
            </label>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-[11px] font-medium text-gray-500 block mb-1.5">הערות</label>
          <textarea
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            rows={3}
            placeholder="הערות נוספות לגבי האירוע..."
            className={`${inputCls} resize-none`}
          />
        </div>

        {/* Files (visual only) */}
        <div>
          <label className="text-[11px] font-medium text-gray-500 block mb-1.5">קבצים מצורפים (אופציונלי)</label>
          <div className="flex items-center gap-2 border border-dashed border-gray-200 rounded-xl px-4 py-3 text-gray-400 text-[12px] cursor-pointer hover:border-[#e8344d]/40 transition-colors">
            <Paperclip className="w-4 h-4" />
            <span>גרור קבצים לכאן או לחץ לבחירה</span>
          </div>
        </div>

        {/* Info */}
        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-[11px] font-semibold text-gray-700 mb-1">תוכן ומנגנון לפעולה</p>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            לאחר הוספת האירוע, המערכת תכין באופן אוטומטי תוכן שיווקי, תזמינים קמפיינים ותשלח התראות בהתאם להגדרות שלך.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 pb-5 flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 py-2.5 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          בטל
        </button>
        <button
          onClick={handleSubmit}
          disabled={!form.name.trim() || createMutation.isPending}
          className="flex-1 py-2.5 rounded-xl bg-[#e8344d] text-white text-[13px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          שמור אירוע
        </button>
      </div>
    </div>
  );
}
