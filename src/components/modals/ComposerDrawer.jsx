// ComposerDrawer — bottom-sheet for prefilled social media post composition
// Usage: <ComposerDrawer text="..." platform="instagram" onClose={() => {}} />

import React, { useState, useRef, useEffect } from 'react';
import { X, Copy, ExternalLink, Check, Instagram, Facebook } from 'lucide-react';
import { toast } from 'sonner';

const PLATFORM_META = {
  instagram: {
    label: 'Instagram',
    icon: Instagram,
    color: 'text-pink-500',
    openUrl: (text) => `https://www.instagram.com/create/story/`,
    copyLabel: 'העתק לאינסטגרם',
  },
  facebook: {
    label: 'Facebook',
    icon: Facebook,
    color: 'text-blue-600',
    openUrl: () => `https://www.facebook.com/`,
    copyLabel: 'העתק לפייסבוק',
  },
  tiktok: {
    label: 'TikTok',
    icon: null,
    color: 'text-foreground',
    openUrl: () => `https://www.tiktok.com/upload`,
    copyLabel: 'העתק לטיקטוק',
  },
  default: {
    label: 'פרסום',
    icon: null,
    color: 'text-primary',
    openUrl: () => null,
    copyLabel: 'העתק טקסט',
  },
};

export default function ComposerDrawer({ text = '', platform, context, onClose }) {
  const [draft, setDraft] = useState(text);
  const [copied, setCopied] = useState(false);
  const textRef = useRef(null);
  const meta = PLATFORM_META[platform] ?? PLATFORM_META.default;
  const PlatformIcon = meta.icon;

  // Auto-focus textarea when drawer opens
  useEffect(() => {
    setTimeout(() => textRef.current?.focus(), 100);
  }, []);

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

  const openUrl = meta.openUrl(draft);

  const handleOpen = async () => {
    await handleCopy();
    if (openUrl) window.open(openUrl, '_blank', 'noopener');
  };

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
            {PlatformIcon && <PlatformIcon className={`w-4 h-4 ${meta.color}`} />}
            {!PlatformIcon && platform === 'tiktok' && (
              <span className="text-[13px]">🎵</span>
            )}
            <h3 className="text-[14px] font-semibold text-foreground">
              {meta.label ? `כתוב פוסט ל${meta.label}` : 'צור תוכן לפרסום'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-[#888888] hover:bg-[#f5f5f5] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Context hint */}
        {context && (
          <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10">
            <p className="text-[11px] text-primary/80 leading-snug">{context}</p>
          </div>
        )}

        {/* Textarea */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <textarea
            ref={textRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full h-40 text-[13px] text-foreground leading-relaxed resize-none border border-[#e8e8e8] rounded-xl p-3 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            placeholder="כתוב את הפוסט שלך כאן..."
            dir="rtl"
          />
          <p className="text-[10px] text-[#aaaaaa] mt-1.5 text-left">
            {draft.length} תווים
          </p>
        </div>

        {/* Action buttons */}
        <div className="px-5 pb-6 pt-2 flex flex-col gap-2.5">
          {openUrl ? (
            <button
              onClick={handleOpen}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-foreground text-background text-[13px] font-medium hover:opacity-90 transition-all"
            >
              <ExternalLink className="w-4 h-4" />
              {meta.copyLabel} ← פתח אפליקציה
            </button>
          ) : (
            <button
              onClick={handleCopy}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-foreground text-background text-[13px] font-medium hover:opacity-90 transition-all"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'הועתק!' : meta.copyLabel}
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
            ✨ טקסט נוצר על ידי AI · ערוך לפני פרסום
          </p>
        </div>
      </div>
    </>
  );
}
