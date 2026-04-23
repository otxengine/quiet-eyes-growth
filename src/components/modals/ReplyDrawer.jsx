// ReplyDrawer — bottom-sheet for drafting replies to competitor reviews / mentions
// Usage: <ReplyDrawer reviewUrl="..." reviewText="..." context="..." onClose={() => {}} />

import React, { useState, useRef, useEffect } from 'react';
import { X, Copy, ExternalLink, Check, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';

export default function ReplyDrawer({ reviewUrl, reviewText, context, onClose }) {
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const textRef = useRef(null);

  // Build a starter reply draft
  useEffect(() => {
    if (reviewText) {
      setDraft(`שלום,\nתודה על הפידבק שלך. `);
    } else {
      setDraft('שלום,\nאנחנו מעריכים את הפניה שלך. ');
    }
    setTimeout(() => textRef.current?.focus(), 100);
  }, [reviewText]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      toast.success('הטקסט הועתק ✓');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('לא ניתן להעתיק — אנא סמן ידנית');
    }
  };

  const handleOpenAndCopy = async () => {
    await handleCopy();
    if (reviewUrl) window.open(reviewUrl, '_blank', 'noopener');
  };

  const isGoogleReview = reviewUrl?.includes('google.com') || reviewUrl?.includes('maps');
  const isGoogleBusiness = reviewUrl?.includes('business.google.com');

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col animate-slide-up">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[#e0e0e0]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#f0f0f0]">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-blue-500" />
            <h3 className="text-[14px] font-semibold text-foreground">כתוב תגובה נגדית</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-[#888888] hover:bg-[#f5f5f5] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Original review / context */}
          {(reviewText || context) && (
            <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-[#fafafa] border border-[#eeeeee]">
              <p className="text-[10px] font-semibold text-[#999999] mb-1 uppercase tracking-wide">
                {reviewText ? 'ביקורת המתחרה' : 'הקשר'}
              </p>
              <p className="text-[11px] text-foreground-muted leading-snug line-clamp-4">
                {reviewText || context}
              </p>
            </div>
          )}

          {/* Textarea */}
          <div className="px-5 py-3">
            <label className="text-[11px] font-semibold text-[#666666] mb-1.5 block">
              התגובה שלך
            </label>
            <textarea
              ref={textRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full h-36 text-[13px] text-foreground leading-relaxed resize-none border border-[#e8e8e8] rounded-xl p-3 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
              placeholder="כתוב את התגובה שלך כאן..."
              dir="rtl"
            />
            <p className="text-[10px] text-[#aaaaaa] mt-1 text-left">{draft.length} תווים</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="px-5 pb-6 pt-2 flex flex-col gap-2.5">
          {reviewUrl ? (
            <button
              onClick={handleOpenAndCopy}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-foreground text-background text-[13px] font-medium hover:opacity-90 transition-all"
            >
              <ExternalLink className="w-4 h-4" />
              {isGoogleReview || isGoogleBusiness
                ? 'פתח Google Business ← הדבק'
                : 'פתח מקור ← הדבק'}
            </button>
          ) : (
            <button
              onClick={handleCopy}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-foreground text-background text-[13px] font-medium hover:opacity-90 transition-all"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'הועתק!' : 'העתק תגובה'}
            </button>
          )}

          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-[#e8e8e8] text-[12px] text-foreground-muted hover:bg-[#fafafa] transition-all"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
            העתק טקסט בלבד
          </button>

          {/* AI disclaimer */}
          <p className="text-center text-[10px] text-[#bbbbbb] leading-snug">
            ✨ טיוטה נוצרה על ידי AI · ערוך לפני שליחה
          </p>
        </div>
      </div>
    </>
  );
}
