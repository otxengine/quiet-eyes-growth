import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ArrowRight, Search, Globe, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

function GradientOrb() {
  return (
    <div
      className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
      style={{
        background: 'radial-gradient(circle at 35% 35%, #a78bfa, #ec4899, #f97316)',
        boxShadow: '0 8px 32px rgba(167,139,250,0.4)',
      }}
    />
  );
}

export default function AddCompetitorModal({ bpId, onClose, onAdded }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1); // 1 = reviews URL, 2 = website URL
  const [reviewsUrl, setReviewsUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Competitor.create({ ...data, linked_business: bpId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dsCompetitors'] });
      queryClient.invalidateQueries({ queryKey: ['competitorsPage'] });
      toast.success('מתחרה נוסף בהצלחה ✓');
      onAdded?.();
    },
    onError: () => toast.error('שגיאה בהוספת מתחרה'),
  });

  const handleStep1 = () => {
    if (!reviewsUrl.trim()) return;
    setStep(2);
  };

  const handleSubmit = () => {
    const name = websiteUrl.trim()
      ? websiteUrl.replace(/^https?:\/\//, '').split('/')[0]
      : reviewsUrl.replace(/^https?:\/\//, '').split('/')[0];

    createMutation.mutate({
      name,
      website: websiteUrl.trim() || undefined,
      reviews_url: reviewsUrl.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
        <h2 className="text-[15px] font-bold text-gray-900">הוספת מתחרה</h2>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 transition-colors"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-10">
        <GradientOrb />

        {step === 1 ? (
          <>
            <p className="text-[17px] font-bold text-gray-900 text-center mb-2 leading-snug">
              ערב טוב טל,<br />בוא נוסיף ביקורות ל-המתחרה
            </p>
            <p className="text-[13px] text-gray-400 text-center mb-6">
              מה הלינק לביקורות שהשאלתו ל-?המתחרה
            </p>

            <div className="w-full max-w-md flex gap-2 mb-5">
              <input
                value={reviewsUrl}
                onChange={e => setReviewsUrl(e.target.value)}
                placeholder="לינק לביקורות"
                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#e8344d]/40 transition-colors"
                dir="ltr"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleStep1()}
              />
              <button
                onClick={handleStep1}
                disabled={!reviewsUrl.trim()}
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-gray-900 text-white text-[13px] font-semibold hover:bg-gray-800 transition-colors disabled:opacity-40"
              >
                <ArrowRight className="w-4 h-4" />
                חיפוש ביקורות
              </button>
            </div>

            <button
              onClick={onClose}
              className="text-[13px] text-[#e8344d] border border-[#e8344d]/30 rounded-full px-4 py-1.5 hover:bg-[#e8344d]/5 transition-colors"
            >
              הסכות לדיות
            </button>
          </>
        ) : (
          <>
            <p className="text-[17px] font-bold text-gray-900 text-center mb-2 leading-snug">
              ערב טוב טל,<br />מה כתובת האתר של המתחרה?
            </p>
            <p className="text-[13px] text-gray-400 text-center mb-6">
              נשתמש באתר כדי לזהות את פרטי העסק והשירותים שלו
            </p>

            <div className="w-full max-w-md flex gap-2 mb-5">
              <input
                value={websiteUrl}
                onChange={e => setWebsiteUrl(e.target.value)}
                placeholder="competitor.co.il/דוגמא"
                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#e8344d]/40 transition-colors"
                dir="ltr"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
              <button
                onClick={handleSubmit}
                disabled={createMutation.isPending}
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-gray-900 text-white text-[13px] font-semibold hover:bg-gray-800 transition-colors disabled:opacity-40"
              >
                {createMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
                סריקת מתחרה
              </button>
            </div>

            <button
              onClick={handleSubmit}
              disabled={createMutation.isPending}
              className="text-[13px] text-[#e8344d] border border-[#e8344d]/30 rounded-full px-4 py-1.5 hover:bg-[#e8344d]/5 transition-colors disabled:opacity-40"
            >
              אין למתחרה אתר
            </button>
          </>
        )}
      </div>
    </div>
  );
}
