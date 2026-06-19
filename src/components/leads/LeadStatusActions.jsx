import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Phone, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function LeadStatusActions({ lead }) {
  const queryClient = useQueryClient();

  const updateStatus = useMutation({
    mutationFn: ({ status }) => base44.entities.Lead.update(lead.id, { status }),
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
      queryClient.invalidateQueries({ queryKey: ['hotLeads'] });
      queryClient.invalidateQueries({ queryKey: ['allLeads'] });
      const labels = { contacted: 'נוצר קשר', completed: 'טופל בהצלחה', lost: 'לא רלוונטי' };
      toast.success(`✓ ${labels[status]}`);
    }
  });

  if (['completed', 'lost'].includes(lead.status)) return null;

  return (
    <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
      {lead.status !== 'contacted' && (
        <button onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ status: 'contacted' }); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium text-foreground-muted/70 bg-white border border-border/60 hover:border-border-hover hover:text-foreground-secondary transition-colors">
          <Phone className="w-3 h-3" /> נוצר קשר
        </button>
      )}
      <button onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ status: 'completed' }); }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium text-[#10b981] bg-[#f0fdf8] border border-[#d1fae5] hover:bg-[#d1fae5] transition-colors">
        <CheckCircle className="w-3 h-3" /> טופל בהצלחה ✓
      </button>
      <button onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ status: 'lost' }); }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium text-foreground-muted/70 bg-white border border-border/60 hover:border-border-hover hover:text-foreground-secondary transition-colors">
        <XCircle className="w-3 h-3" /> לא רלוונטי
      </button>
    </div>
  );
}