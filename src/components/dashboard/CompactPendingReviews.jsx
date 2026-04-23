import React, { useState } from 'react';
import { Star, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

function StarRating({ rating }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`w-3 h-3 ${i <= rating ? 'text-[#d97706] fill-[#d97706]' : 'text-[#eeeeee]'}`} />
      ))}
    </div>
  );
}

function DashboardReviewItem({ review, businessProfile }) {
  const [expanded, setExpanded] = useState(false);
  const [responseText, setResponseText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const isNeg = review.sentiment === 'negative' || review.sentiment === 'neutral';

  const generate = async () => {
    setGenerating(true);
    const tone = businessProfile?.tone_preference || 'friendly';
    const bName = businessProfile?.name || '';
    const prompt = isNeg
      ? `You are a customer service expert for "${bName}". Tone: ${tone}. A customer (${review.reviewer_name || 'לקוח'}) left a ${review.rating}-star review: "${review.text}". Write a professional 2-3 sentence response in Hebrew. Acknowledge the issue, apologize sincerely, offer a next step. Return ONLY the response.`
      : `You are writing a thank-you for "${bName}". Tone: ${tone}. Customer ${review.reviewer_name || 'לקוח'} left ${review.rating} stars: "${review.text}". Write a warm 2-sentence thank-you in Hebrew referencing their review. Return ONLY the response.`;
    const result = await base44.integrations.Core.InvokeLLM({ prompt });
    setResponseText(result?.trim() || '');
    setExpanded(true);
    setGenerating(false);
  };

  const save = async () => {
    if (!responseText.trim()) return;
    await base44.entities.Review.update(review.id, { suggested_response: responseText, response_status: 'responded' });
    setSaved(true);
    queryClient.invalidateQueries({ queryKey: ['allReviews'] });
    queryClient.invalidateQueries({ queryKey: ['reviewsPage'] });
    queryClient.invalidateQueries({ queryKey: ['pendingReviews'] });
    setTimeout(() => { setExpanded(false); setSaved(false); }, 1500);
  };

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center justify-between mb-1">
        <StarRating rating={review.rating} />
        <span className="text-[7.5px] text-[#bbbbbb] bg-[#f8f8f8] px-1.5 py-0.5 rounded">{review.platform}</span>
      </div>
      <p className="text-[10px] text-[#666666] line-clamp-2 mb-1">{review.text}</p>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[#cccccc]">{review.reviewer_name}</span>
        <button onClick={generate} disabled={generating}
          className="mr-auto px-2 py-1 text-[10px] font-medium bg-[#111111] text-white rounded hover:bg-[#333333] transition-colors flex items-center gap-1 disabled:opacity-50">
          {generating ? <><Loader2 className="w-2.5 h-2.5 animate-spin" /> מייצר...</> : (isNeg ? 'הצע תגובה' : 'הודה ושתף')}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 pt-2 border-t border-[#f5f5f5]">
          <textarea value={responseText} onChange={(e) => setResponseText(e.target.value)}
            rows={2} className="w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg p-2 text-[11px] text-[#333333] resize-none focus:outline-none focus:border-[#dddddd]" />
          <div className="flex gap-1.5 mt-1.5">
            {saved ? (
              <span className="text-[10px] text-[#10b981] font-medium">✓ נשמר</span>
            ) : (
              <>
                <button onClick={save} className="px-2.5 py-1 text-[10px] font-medium bg-[#111111] text-white rounded hover:bg-[#333333] transition-colors">אשר ✓</button>
                <button onClick={() => { setExpanded(false); setResponseText(''); }} className="px-2.5 py-1 text-[10px] font-medium text-[#aaaaaa] border border-[#eeeeee] rounded hover:border-[#cccccc] transition-colors">בטל</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CompactPendingReviews({ reviews = [], businessProfile }) {
  const navigate = useNavigate();

  // Sort: negative first
  const sorted = [...reviews].sort((a, b) => {
    const order = { negative: 0, neutral: 1, positive: 2 };
    return (order[a.sentiment] ?? 1) - (order[b.sentiment] ?? 1);
  });

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] flex flex-col">
      <div className="px-4 py-3 border-b border-[#f5f5f5] flex items-center justify-between cursor-pointer" onClick={() => navigate('/reviews')}>
        <h3 className="text-[13px] font-semibold text-[#222222]">ביקורות ממתינות</h3>
        {reviews.length > 0 && <span className="text-[10px] text-[#999999]">{reviews.length} ממתינות</span>}
      </div>
      {reviews.length === 0 ? (
        <div className="p-6 text-center">
          <Star className="w-8 h-8 text-[#cccccc] mx-auto mb-1.5" />
          <p className="text-[11px] text-[#999999]">אין ביקורות ממתינות</p>
        </div>
      ) : (
        <div className="divide-y divide-[#f5f5f5]">
          {sorted.slice(0, 2).map((review) => (
            <DashboardReviewItem key={review.id} review={review} businessProfile={businessProfile} />
          ))}
        </div>
      )}
    </div>
  );
}