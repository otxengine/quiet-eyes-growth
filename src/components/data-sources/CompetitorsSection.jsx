import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Users, Trash2, Plus, MapPin, Briefcase } from 'lucide-react';
import { toast } from 'sonner';

export default function CompetitorsSection({ competitors, bpId }) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newComp, setNewComp] = useState({ name: '', category: '', address: '', services: '' });

  const handleDelete = async (id) => {
    await base44.entities.Competitor.delete(id);
    queryClient.invalidateQueries({ queryKey: ['dsCompetitors'] });
    queryClient.invalidateQueries({ queryKey: ['competitorsPage'] });
    toast.success('מתחרה הוסר');
  };

  const handleAdd = async () => {
    if (!newComp.name.trim()) return;
    await base44.entities.Competitor.create({ ...newComp, linked_business: bpId });
    queryClient.invalidateQueries({ queryKey: ['dsCompetitors'] });
    queryClient.invalidateQueries({ queryKey: ['competitorsPage'] });
    setNewComp({ name: '', category: '', address: '', services: '' });
    setShowAdd(false);
    toast.success('מתחרה נוסף');
  };

  const inputCls = "w-full bg-secondary border border-border rounded-lg px-3 py-2 text-[12px] text-foreground placeholder-foreground-muted focus:outline-none focus:border-primary/30";

  return (
    <div className="card-base p-5 fade-in-up stagger-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <h3 className="text-[13px] font-semibold text-foreground">מתחרים שזוהו</h3>
          <span className="text-[10px] text-foreground-muted">({competitors.length})</span>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-secondary border border-border hover:bg-secondary/80 transition-colors flex items-center gap-1">
          <Plus className="w-3 h-3" /> הוסף מתחרה
        </button>
      </div>
      <p className="text-[11px] text-foreground-muted mb-3">הסוכנים יעקבו אחר המתחרים האלה, ינתחו ביקורות, מחירים ופעילות חברתית</p>

      {showAdd && (
        <div className="p-4 rounded-lg bg-secondary/50 border border-border mb-3 space-y-2">
          <input value={newComp.name} onChange={(e) => setNewComp({ ...newComp, name: e.target.value })} placeholder="שם המתחרה" className={inputCls} />
          <div className="grid grid-cols-2 gap-2">
            <input value={newComp.category} onChange={(e) => setNewComp({ ...newComp, category: e.target.value })} placeholder="קטגוריה" className={inputCls} />
            <input value={newComp.address} onChange={(e) => setNewComp({ ...newComp, address: e.target.value })} placeholder="כתובת" className={inputCls} />
          </div>
          <input value={newComp.services} onChange={(e) => setNewComp({ ...newComp, services: e.target.value })} placeholder="שירותים עיקריים (מופרדים בפסיקים)" className={inputCls} />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 rounded-md text-[11px] text-foreground-muted hover:text-foreground transition-colors">ביטול</button>
            <button onClick={handleAdd} className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-primary text-white hover:opacity-90 transition-all">הוסף</button>
          </div>
        </div>
      )}

      {competitors.length === 0 ? (
        <p className="text-[12px] text-foreground-muted text-center py-6">טרם זוהו מתחרים — לחץ ״צור מחדש עם AI״ או הוסף ידנית</p>
      ) : (
        <div className="space-y-2">
          {competitors.map((comp) => (
            <div key={comp.id} className="flex items-center gap-3 px-3 py-3 rounded-lg bg-secondary border border-border group">
              <div className="w-8 h-8 rounded-lg bg-white border border-border flex items-center justify-center flex-shrink-0">
                <Users className="w-3.5 h-3.5 text-foreground-muted" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[12px] font-medium text-foreground block">{comp.name}</span>
                <div className="flex items-center gap-3 mt-0.5">
                  {comp.category && (
                    <span className="flex items-center gap-1 text-[10px] text-foreground-muted">
                      <Briefcase className="w-2.5 h-2.5" /> {comp.category}
                    </span>
                  )}
                  {comp.address && (
                    <span className="flex items-center gap-1 text-[10px] text-foreground-muted">
                      <MapPin className="w-2.5 h-2.5" /> {comp.address}
                    </span>
                  )}
                </div>
                {comp.services && (
                  <p className="text-[10px] text-foreground-muted mt-0.5 truncate">{comp.services}</p>
                )}
              </div>
              <button onClick={() => handleDelete(comp.id)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-danger/10">
                <Trash2 className="w-3.5 h-3.5 text-foreground-muted hover:text-danger" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}