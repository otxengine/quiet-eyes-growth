import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Sparkles, Loader2, Users, Trash2, Check } from 'lucide-react';
import AudienceSegmentCard from './AudienceSegmentCard';

/**
 * Audience tab in Marketing: generate AI audience candidates (grounded in
 * real reviews/leads/signals/competitor data via getAudienceSegments) and
 * save the ones worth keeping as named, reusable AudienceSegment rows —
 * picked from later when creating a campaign (CampaignCreate.jsx).
 */
export default function AudienceTab({ businessProfileId: bpId }) {
  const queryClient = useQueryClient();

  const { data: audiences = [], isLoading } = useQuery({
    queryKey: ['audienceSegments', bpId],
    queryFn: () => base44.entities.AudienceSegment.filter({ linked_business: bpId }, '-created_date', 50),
    enabled: !!bpId,
  });

  const [candidates,  setCandidates]  = useState(null); // freshly-generated, unsaved segments
  const [generating,  setGenerating]  = useState(false);
  const [genError,    setGenError]    = useState('');
  const [savedIdx,    setSavedIdx]    = useState({}); // { [candidateIndex]: true } once saved

  const generate = async () => {
    if (!bpId) return;
    setGenerating(true);
    setGenError('');
    setSavedIdx({});
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 45000));
      const res = await Promise.race([
        base44.functions.invoke('getAudienceSegments', { businessProfileId: bpId }),
        timeout,
      ]);
      const data = res?.data || res;
      setCandidates(data?.segments || []);
    } catch (e) {
      setGenError(e?.message === 'timeout' ? 'פג זמן הטעינה — נסה שנית' : (e?.message || 'שגיאה לא ידועה'));
    }
    setGenerating(false);
  };

  const saveMutation = useMutation({
    mutationFn: (segment) => base44.entities.AudienceSegment.create({
      linked_business: bpId,
      name: segment.segment_name,
      description: segment.description || '',
      segment_json: JSON.stringify(segment),
      source: 'ai_generated',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audienceSegments', bpId] });
      toast.success('הקהל נשמר');
    },
    onError: (err) => toast.error('שגיאה: ' + (err?.message || 'נסה שוב')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.AudienceSegment.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audienceSegments', bpId] });
      toast.success('נמחק');
    },
  });

  const handleSave = (segment, idx) => {
    saveMutation.mutate(segment, {
      onSuccess: () => setSavedIdx(s => ({ ...s, [idx]: true })),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-[12px] text-foreground-muted">
          {audiences.length} קהלים שמורים · מבוסס על ביקורות, לידים, סיגנלים ומתחרים אמיתיים
        </p>
        <button onClick={generate} disabled={generating || !bpId}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground text-background rounded-lg text-[11px] font-semibold hover:opacity-90 disabled:opacity-60">
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {generating ? 'מנתח קהל יעד...' : 'צור קהל יעד חדש'}
        </button>
      </div>

      {genError && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-right">
          <p className="text-[11px] font-semibold text-red-700 mb-1">שגיאה ביצירת קהל יעד</p>
          <p className="text-[11px] text-red-600 font-mono break-all">{genError}</p>
        </div>
      )}

      {candidates?.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold text-foreground-muted">קהלים חדשים — שמור את מה שרלוונטי</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {candidates.map((seg, i) => (
              <AudienceSegmentCard
                key={i}
                segment={seg}
                actions={
                  savedIdx[i] ? (
                    <span className="flex items-center gap-1 text-[11px] text-green-700 font-medium">
                      <Check className="w-3.5 h-3.5" /> נשמר
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSave(seg, i)}
                      disabled={saveMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground text-background rounded-lg text-[11px] font-semibold hover:opacity-90 disabled:opacity-60"
                    >
                      {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      שמור קהל
                    </button>
                  )
                }
              />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <p className="text-[11px] font-semibold text-foreground-muted">קהלים שמורים</p>
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-foreground-muted" /></div>
        ) : audiences.length === 0 ? (
          !candidates && (
            <div className="text-center py-16">
              <Users className="w-10 h-10 text-foreground-muted opacity-30 mx-auto mb-3" />
              <p className="text-[13px] text-foreground-muted">אין עדיין קהלי יעד שמורים</p>
            </div>
          )
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
    </div>
  );
}
