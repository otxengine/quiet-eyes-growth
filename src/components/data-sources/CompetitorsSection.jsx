import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Users, Trash2, Plus, MapPin, Briefcase } from 'lucide-react';
import { toast } from 'sonner';
import AddCompetitorModal from '@/components/competitors/AddCompetitorModal';

export default function CompetitorsSection({ competitors, bpId }) {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);

  const handleDelete = async (id) => {
    await base44.entities.Competitor.delete(id);
    queryClient.invalidateQueries({ queryKey: ['dsCompetitors'] });
    queryClient.invalidateQueries({ queryKey: ['competitorsPage'] });
    toast.success('מתחרה הוסר');
  };

  return (
    <div className="card-base p-5 fade-in-up stagger-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <h3 className="text-[13px] font-semibold text-foreground">מתחרים שזוהו</h3>
          <span className="text-[10px] text-foreground-muted">({competitors.length})</span>
        </div>
        <button onClick={() => setShowModal(true)} className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-secondary border border-border hover:bg-secondary/80 transition-colors flex items-center gap-1">
          <Plus className="w-3 h-3" /> הוסף מתחרה
        </button>
      </div>
      <p className="text-[11px] text-foreground-muted mb-3">הסוכנים יעקבו אחר המתחרים האלה, ינתחו ביקורות, מחירים ופעילות חברתית</p>

      {showModal && (
        <AddCompetitorModal
          bpId={bpId}
          onClose={() => setShowModal(false)}
          onAdded={() => setShowModal(false)}
        />
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