import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Sparkles, Loader2, Users, Trash2 } from 'lucide-react';
import AudienceSegmentCard from '@/components/marketing/AudienceSegmentCard';
import AudienceChatModal from './AudienceChatModal';

/**
 * Saved AI audience segments (grounded in real reviews/leads/signals/
 * competitor data, discussed and approved via AudienceChatModal) —
 * picked from later when creating a campaign (CampaignCreate.jsx).
 */
export default function AudienceSegments({ businessProfileId: bpId }) {
  const queryClient = useQueryClient();

  const { data: audiences = [], isLoading } = useQuery({
    queryKey: ['audienceSegments', bpId],
    queryFn: () => base44.entities.AudienceSegment.filter({ linked_business: bpId }, '-created_date', 50),
    enabled: !!bpId,
  });

  const [chatOpen, setChatOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.AudienceSegment.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audienceSegments', bpId] });
      toast.success('נמחק');
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-[12px] text-foreground-muted">
          {audiences.length} קהלים שמורים · מבוסס על ביקורות, לידים, סיגנלים ומתחרים אמיתיים
        </p>
        <button onClick={() => setChatOpen(true)} disabled={!bpId}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground text-background rounded-lg text-[11px] font-semibold hover:opacity-90 disabled:opacity-60">
          <Sparkles className="w-3.5 h-3.5" />
          צור קהל יעד חדש
        </button>
      </div>

      <div className="space-y-3">
        <p className="text-[11px] font-semibold text-foreground-muted">קהלים שמורים</p>
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-foreground-muted" /></div>
        ) : audiences.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-10 h-10 text-foreground-muted opacity-30 mx-auto mb-3" />
            <p className="text-[13px] text-foreground-muted">אין עדיין קהלי יעד שמורים</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {audiences.map(row => (
              <AudienceSegmentCard
                key={row.id}
                segment={JSON.parse(row.segment_json)}
                actions={
                  <button
                    onClick={() => deleteMutation.mutate(row.id)}
                    className="flex items-center gap-1.5 text-[11px] text-foreground-muted hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> מחק
                  </button>
                }
              />
            ))}
          </div>
        )}
      </div>

      {chatOpen && (
        <AudienceChatModal businessProfileId={bpId} onClose={() => setChatOpen(false)} />
      )}
    </div>
  );
}
