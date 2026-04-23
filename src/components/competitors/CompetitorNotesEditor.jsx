import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Tag, Save, X } from 'lucide-react';
import { toast } from 'sonner';

const presetTags = ['מתחרה עיקרי', 'למעקב', 'נישה', 'מתחרה חדש', 'מתחרה ישיר', 'מתחרה עקיף'];

export default function CompetitorNotesEditor({ competitor }) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(competitor.notes || '');
  const [tags, setTags] = useState(competitor.tags ? competitor.tags.split(',').map(t => t.trim()).filter(Boolean) : []);
  const queryClient = useQueryClient();

  const toggleTag = (tag) => {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const save = async () => {
    await base44.entities.Competitor.update(competitor.id, {
      notes,
      tags: tags.join(', '),
    });
    queryClient.invalidateQueries({ queryKey: ['competitorsPage'] });
    toast.success('נשמר ✓');
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="mt-3 space-y-2">
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map(tag => (
              <span key={tag} className="px-2 py-0.5 rounded-full text-[9px] font-medium bg-[#f5f5f5] text-[#666666] border border-[#eeeeee]">{tag}</span>
            ))}
          </div>
        )}
        {notes && <p className="text-[11px] text-[#888888] italic">{notes}</p>}
        <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-[10px] text-[#bbbbbb] hover:text-[#666666] transition-colors">
          <MessageSquare className="w-3 h-3" /> {notes || tags.length > 0 ? 'ערוך הערות ותגיות' : 'הוסף הערות ותגיות'}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 p-3 rounded-lg border border-[#eeeeee] bg-[#fafafa] space-y-3">
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Tag className="w-3 h-3 text-[#999999]" />
          <span className="text-[10px] font-medium text-[#666666]">תגיות</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presetTags.map(tag => (
            <button key={tag} onClick={() => toggleTag(tag)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors border ${tags.includes(tag) ? 'bg-[#111111] text-white border-[#111111]' : 'bg-white text-[#888888] border-[#eeeeee] hover:border-[#cccccc]'}`}>
              {tag}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <MessageSquare className="w-3 h-3 text-[#999999]" />
          <span className="text-[10px] font-medium text-[#666666]">הערות</span>
        </div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          placeholder="הערות אישיות על המתחרה..."
          className="w-full bg-white border border-[#eeeeee] rounded-lg px-3 py-2 text-[12px] text-[#111111] placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd] resize-none" />
      </div>
      <div className="flex gap-2">
        <button onClick={save} className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-medium bg-[#111111] text-white hover:bg-[#333333] transition-colors">
          <Save className="w-3 h-3" /> שמור
        </button>
        <button onClick={() => setEditing(false)} className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-medium text-[#999999] bg-white border border-[#eeeeee] hover:border-[#cccccc] transition-colors">
          <X className="w-3 h-3" /> ביטול
        </button>
      </div>
    </div>
  );
}