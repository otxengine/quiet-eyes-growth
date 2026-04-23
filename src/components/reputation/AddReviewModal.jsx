import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Star, Loader2 } from 'lucide-react';

const platforms = ['Google', 'Facebook', 'Instagram'];

export default function AddReviewModal({ bpId, onClose, onAdded }) {
  const [form, setForm] = useState({ platform: 'Google', rating: 0, reviewer_name: '', text: '', source_url: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.text || form.rating === 0) return;
    setSaving(true);
    const sentimentResult = await base44.integrations.Core.InvokeLLM({ prompt: `Analyze the sentiment of this Hebrew review: "${form.text}"\nReturn ONLY one word: positive, negative, or neutral` });
    const sentiment = sentimentResult.trim().toLowerCase().replace(/[^a-z]/g, '');
    const validSentiment = ['positive', 'negative', 'neutral'].includes(sentiment) ? sentiment : 'neutral';
    await base44.entities.Review.create({ ...form, sentiment: validSentiment, response_status: 'pending', created_at: new Date().toISOString(), linked_business: bpId });
    setSaving(false);
    onAdded();
  };

  const inputCls = "w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2 text-[13px] text-[#111111] placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white border border-[#f0f0f0] rounded-[10px] p-5 w-full max-w-md mx-4 z-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-[#111111]">הוסף ביקורת</h3>
          <button onClick={onClose} className="text-[#cccccc] hover:text-[#999999]"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[12px] text-[#999999] mb-1 block">פלטפורמה</label>
            <div className="flex gap-2">
              {platforms.map((p) => (
                <button key={p} onClick={() => setForm({ ...form, platform: p })}
                  className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${form.platform === p ? 'bg-[#111111] text-white' : 'text-[#aaaaaa] border border-[#eeeeee] hover:border-[#cccccc]'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[12px] text-[#999999] mb-1 block">דירוג</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <button key={i} onClick={() => setForm({ ...form, rating: i })}>
                  <Star className={`w-6 h-6 ${i <= form.rating ? 'text-[#d97706] fill-[#d97706]' : 'text-[#eeeeee]'}`} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[12px] text-[#999999] mb-1 block">שם המבקר</label>
            <input value={form.reviewer_name} onChange={(e) => setForm({ ...form, reviewer_name: e.target.value })} className={inputCls} placeholder="שם..." />
          </div>
          <div>
            <label className="text-[12px] text-[#999999] mb-1 block">קישור לביקורת (אופציונלי)</label>
            <input value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} className={inputCls} placeholder="https://..." />
          </div>
          <div>
            <label className="text-[12px] text-[#999999] mb-1 block">תוכן הביקורת</label>
            <textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} rows={4} className={`${inputCls} resize-none`} placeholder="כתוב את הביקורת..." />
          </div>
          <button onClick={handleSubmit} disabled={saving || !form.text || form.rating === 0}
            className="w-full py-2.5 rounded-md text-[12px] font-medium bg-[#111111] hover:bg-[#333333] text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} {saving ? 'מנתח סנטימנט...' : 'שמור ביקורת'}
          </button>
        </div>
      </div>
    </div>
  );
}