import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { X } from 'lucide-react';
import { toast } from 'sonner';

const priorities = [
  { value: 'critical', label: 'קריטי' },
  { value: 'high', label: 'גבוה' },
  { value: 'medium', label: 'בינוני' },
  { value: 'low', label: 'נמוך' },
];

const inputClass = 'w-full px-3 py-2.5 rounded-lg border border-border bg-white text-[12px] text-foreground placeholder-foreground-muted focus:outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/20 transition-colors';

export default function AddTaskModal({ bpId, onClose, onAdded, prefill }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: prefill?.title || '',
    description: prefill?.description || '',
    priority: prefill?.priority || 'medium',
    assignee: '',
    branch: '',
    due_date: '',
    source_alert_id: prefill?.source_alert_id || '',
    source_type: prefill?.source_alert_id ? 'alert' : 'manual',
    notes: '',
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Task.create({ ...data, linked_business: bpId, status: 'pending' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('המשימה נוצרה בהצלחה ✓');
      onAdded?.();
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    createMutation.mutate(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl border border-border shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto fade-in-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-[15px] font-bold text-foreground">משימה חדשה</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
            <X className="w-4 h-4 text-foreground-muted" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-[11px] font-medium text-foreground-muted mb-1.5 block">כותרת *</label>
            <input className={inputClass} placeholder="מה צריך לעשות?" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-foreground-muted mb-1.5 block">תיאור</label>
            <textarea className={`${inputClass} h-20 resize-none`} placeholder="פרטים נוספים..." value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-foreground-muted mb-1.5 block">הקצה לעובד</label>
              <input className={inputClass} placeholder="שם העובד" value={form.assignee} onChange={e => setForm({ ...form, assignee: e.target.value })} />
            </div>
            <div>
              <label className="text-[11px] font-medium text-foreground-muted mb-1.5 block">סניף</label>
              <input className={inputClass} placeholder="שם הסניף" value={form.branch} onChange={e => setForm({ ...form, branch: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-foreground-muted mb-1.5 block">עדיפות</label>
              <select className={inputClass} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                {priorities.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-foreground-muted mb-1.5 block">תאריך יעד</label>
              <input type="date" className={inputClass} value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium text-foreground-muted mb-1.5 block">הערות</label>
            <textarea className={`${inputClass} h-16 resize-none`} placeholder="הערות..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          {form.source_type === 'alert' && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10">
              <span className="text-[10px] text-primary font-medium">נוצרה מהתראת AI</span>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-subtle flex-1 px-4 py-2.5 rounded-lg text-[12px] font-medium bg-secondary border border-border text-foreground-secondary hover:bg-secondary/80 transition-all">
              ביטול
            </button>
            <button type="submit" disabled={!form.title.trim() || createMutation.isPending}
              className="btn-subtle flex-1 px-4 py-2.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-all disabled:opacity-50">
              {createMutation.isPending ? 'יוצר...' : 'צור משימה'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}