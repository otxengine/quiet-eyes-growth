import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { X, Phone, MapPin, Briefcase, Wallet, Clock, MessageSquare, Tag, Calendar, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import ConversationPanel from './ConversationPanel';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'לפני פחות משעה';
  if (hours < 24) return `לפני ${hours} שעות`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

const stageLabels = {
  new: 'חדש', contacted: 'נוצר קשר', meeting: 'פגישה',
  negotiation: 'משא ומתן', closed_won: 'נסגר ✓', closed_lost: 'אבד', customer: 'לקוח'
};

export default function LeadDetailPanel({ lead, businessProfile, stages, onClose, onStageChange }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [nextAction, setNextAction] = useState(lead.next_action || '');
  const [nextDate, setNextDate] = useState(lead.next_action_date || '');
  const [tags, setTags] = useState(lead.tags || '');
  const [totalValue, setTotalValue] = useState(lead.total_value || '');
  const phoneMatch = lead.contact_info?.match(/[\d\-+()]{7,}/);
  const phone = phoneMatch ? phoneMatch[0] : null;

  const isOverdue = lead.next_action_date && new Date(lead.next_action_date) <= new Date();

  const saveNote = async () => {
    if (!note.trim()) return;
    const prev = lead.notes || '';
    const updated = `${new Date().toLocaleDateString('he-IL')} — ${note}\n${prev}`;
    await base44.entities.Lead.update(lead.id, { notes: updated });
    setNote('');
    queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
    toast.success('הערה נוספה ✓');
  };

  const saveNextAction = async () => {
    await base44.entities.Lead.update(lead.id, { next_action: nextAction, next_action_date: nextDate });
    queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
    toast.success('פעולה הבאה נשמרה ✓');
  };

  const saveTags = async () => {
    await base44.entities.Lead.update(lead.id, { tags });
    queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
    toast.success('תגיות נשמרו ✓');
  };

  const saveValue = async () => {
    await base44.entities.Lead.update(lead.id, { total_value: Number(totalValue) || 0 });
    queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
    toast.success('שווי עסקה נשמר ✓');
  };

  const timeline = [];
  if (lead.created_at || lead.created_date) timeline.push({ text: 'ליד נוצר', date: lead.created_at || lead.created_date });
  if (lead.lifecycle_stage && lead.lifecycle_stage !== 'new' && lead.lifecycle_updated_at) {
    timeline.push({ text: `הועבר ל${stageLabels[lead.lifecycle_stage] || lead.lifecycle_stage}`, date: lead.lifecycle_updated_at });
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative z-10 w-[400px] max-w-full h-full bg-white shadow-2xl overflow-y-auto mr-auto" style={{ scrollbarWidth: 'thin' }}>
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-border px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[16px] font-bold text-foreground">{lead.name}</h2>
            <button onClick={onClose}><X className="w-5 h-5 text-foreground-muted" /></button>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${lead.score >= 70 ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
              {lead.score || 0} ניקוד
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-secondary text-foreground-secondary">
              {stageLabels[lead.lifecycle_stage] || 'חדש'}
            </span>
            {lead.status && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-secondary text-foreground-muted">{lead.status}</span>
            )}
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Tags */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Tag className="w-3.5 h-3.5 text-foreground-muted" />
              <span className="text-[11px] font-semibold text-foreground">תגיות</span>
            </div>
            <div className="flex gap-2">
              <input value={tags} onChange={e => setTags(e.target.value)} placeholder="תגית1, תגית2..."
                className="flex-1 text-[12px] px-3 py-1.5 rounded-lg border border-border bg-white" />
              <button onClick={saveTags} className="text-[11px] px-3 py-1.5 rounded-lg bg-secondary text-foreground-secondary hover:bg-secondary/80">שמור</button>
            </div>
          </div>

          {/* Contact info */}
          <div>
            <h4 className="text-[11px] font-semibold text-foreground mb-2">פרטי קשר</h4>
            <div className="space-y-1.5">
              {phone && <div className="flex items-center gap-2 text-[12px]"><Phone className="w-3.5 h-3.5 text-foreground-muted" /><a href={`tel:${phone}`} className="text-primary hover:underline">{phone}</a></div>}
              {lead.city && <div className="flex items-center gap-2 text-[12px]"><MapPin className="w-3.5 h-3.5 text-foreground-muted" /><span className="text-foreground-secondary">{lead.city}</span></div>}
              {lead.source && <div className="flex items-center gap-2 text-[12px]"><span className="text-[10px] text-foreground-muted">מקור:</span><span className="text-foreground-secondary">{lead.source}</span></div>}
              {lead.budget_range && <div className="flex items-center gap-2 text-[12px]"><Wallet className="w-3.5 h-3.5 text-foreground-muted" /><span className="text-foreground-secondary">{lead.budget_range}</span></div>}
              {lead.service_needed && <div className="flex items-center gap-2 text-[12px]"><Briefcase className="w-3.5 h-3.5 text-foreground-muted" /><span className="text-foreground-secondary">{lead.service_needed}</span></div>}
              {lead.urgency && <div className="flex items-center gap-2 text-[12px]"><Clock className="w-3.5 h-3.5 text-foreground-muted" /><span className="text-foreground-secondary">דחיפות: {lead.urgency}</span></div>}
            </div>
          </div>

          {/* Deal value */}
          <div>
            <h4 className="text-[11px] font-semibold text-foreground mb-1.5">שווי עסקה</h4>
            <div className="flex gap-2">
              <input type="number" value={totalValue} onChange={e => setTotalValue(e.target.value)} placeholder="₪"
                className="flex-1 text-[12px] px-3 py-1.5 rounded-lg border border-border bg-white" />
              <button onClick={saveValue} className="text-[11px] px-3 py-1.5 rounded-lg bg-secondary text-foreground-secondary hover:bg-secondary/80">שמור</button>
            </div>
          </div>

          {/* Timeline */}
          {timeline.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold text-foreground mb-2">ציר זמן</h4>
              <div className="space-y-2 pr-3 border-r-2 border-border">
                {timeline.map((event, i) => (
                  <div key={i} className="relative pr-4">
                    <div className="absolute -right-[9px] top-1 w-2.5 h-2.5 rounded-full bg-primary border-2 border-white" />
                    <p className="text-[12px] text-foreground-secondary">{event.text}</p>
                    <p className="text-[10px] text-foreground-muted">{timeAgo(event.date)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <h4 className="text-[11px] font-semibold text-foreground mb-1.5">הערות</h4>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="הוסף הערה..."
              className="w-full text-[12px] px-3 py-2 rounded-lg border border-border bg-white resize-none" />
            <button onClick={saveNote} className="mt-1.5 text-[11px] px-3 py-1.5 rounded-lg bg-foreground text-background hover:opacity-90">הוסף הערה</button>
            {lead.notes && (
              <div className="mt-2 bg-secondary rounded-lg p-3 max-h-[120px] overflow-y-auto">
                <p className="text-[11px] text-foreground-secondary whitespace-pre-wrap">{lead.notes}</p>
              </div>
            )}
          </div>

          {/* Next action */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <h4 className="text-[11px] font-semibold text-foreground">פעולה הבאה</h4>
              {isOverdue && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
            </div>
            <input value={nextAction} onChange={e => setNextAction(e.target.value)} placeholder="מה לעשות?"
              className="w-full text-[12px] px-3 py-1.5 rounded-lg border border-border bg-white mb-1.5" />
            <div className="flex gap-2">
              <input type="date" value={nextDate} onChange={e => setNextDate(e.target.value)}
                className="flex-1 text-[12px] px-3 py-1.5 rounded-lg border border-border bg-white" />
              <button onClick={saveNextAction} className="text-[11px] px-3 py-1.5 rounded-lg bg-foreground text-background hover:opacity-90">שמור</button>
            </div>
          </div>

          {/* WhatsApp Conversation */}
          <div className="border-t border-border pt-4">
            <ConversationPanel lead={lead} businessProfile={businessProfile} />
          </div>

          {/* Actions */}
          <div className="border-t border-border pt-4 space-y-2">
            <h4 className="text-[11px] font-semibold text-foreground mb-2">פעולות</h4>
            {phone && (
              <a href={`https://wa.me/${phone.replace(/[^0-9+]/g, '')}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-medium bg-green-50 text-green-700 hover:bg-green-100 transition-colors w-full">
                <MessageSquare className="w-3.5 h-3.5" /> שלח הודעה ב-WhatsApp
              </a>
            )}
            <select onChange={e => { if (e.target.value) onStageChange(e.target.value); e.target.value = ''; }}
              className="w-full text-[12px] px-4 py-2 rounded-lg border border-border bg-white text-foreground">
              <option value="">העבר שלב...</option>
              {stages?.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}