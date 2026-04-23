import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { X, Star } from 'lucide-react';
import { toast } from 'sonner';

export default function SurveyResponseModal({ survey, businessProfile, onClose }) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(survey?.rating || 0);
  const [likedMost, setLikedMost] = useState(survey?.liked_most || '');
  const [improve, setImprove] = useState(survey?.improve || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await base44.entities.CustomerSurvey.update(survey.id, {
      rating, liked_most: likedMost, improve, response_received: true,
    });

    // Smart routing
    if (rating >= 4) {
      // Trigger review request
      toast.success('דירוג גבוה! נשלחת בקשת ביקורת');
    } else if (rating <= 2) {
      // Create urgent signal
      await base44.entities.MarketSignal.create({
        summary: `לקוח לא מרוצה: ${survey.customer_name}`,
        impact_level: 'high',
        category: 'threat',
        recommended_action: `צור קשר עם ${survey.customer_name} לתיקון המצב`,
        confidence: 90,
        is_read: false,
        detected_at: new Date().toISOString(),
        linked_business: businessProfile?.id,
      });
      toast.warning('דירוג נמוך — נוצרה התראה דחופה');
    } else {
      toast.success('תשובת סקר נשמרה ✓');
    }

    queryClient.invalidateQueries({ queryKey: ['surveys'] });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-xl border border-border shadow-xl p-5 w-[380px] max-w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14px] font-semibold text-foreground">הזן תשובות סקר</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-foreground-muted" /></button>
        </div>
        <p className="text-[12px] text-foreground-muted mb-4">לקוח: {survey.customer_name}</p>

        <div className="space-y-4">
          <div>
            <label className="text-[11px] font-medium text-foreground-muted block mb-1.5">דירוג (1-5)</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setRating(n)} className="p-1">
                  <Star className={`w-6 h-6 ${n <= rating ? 'text-amber-400 fill-amber-400' : 'text-gray-200'}`} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium text-foreground-muted block mb-1">מה הכי אהבת?</label>
            <input value={likedMost} onChange={e => setLikedMost(e.target.value)}
              className="w-full text-[12px] px-3 py-2 rounded-lg border border-border bg-white" />
          </div>

          <div>
            <label className="text-[11px] font-medium text-foreground-muted block mb-1">מה אפשר לשפר?</label>
            <input value={improve} onChange={e => setImprove(e.target.value)}
              className="w-full text-[12px] px-3 py-2 rounded-lg border border-border bg-white" />
          </div>

          <button onClick={save} disabled={saving || !rating}
            className="w-full text-[12px] px-4 py-2.5 rounded-lg bg-foreground text-background hover:opacity-90 transition-all disabled:opacity-50">
            {saving ? 'שומר...' : 'שמור תשובות'}
          </button>
        </div>
      </div>
    </div>
  );
}