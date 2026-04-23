import React, { useState } from 'react';
import { X, Copy, CheckCheck, ExternalLink, MessageCircle, Phone } from 'lucide-react';

/**
 * Universal ActionDrawer — slide-in panel from the right (RTL layout: from left).
 * Triggered by CTA buttons throughout the app.
 *
 * Props:
 *   open         {boolean}
 *   onClose      {() => void}
 *   title        {string}
 *   description  {string}
 *   actionType   {string}  — 'social_post' | 'respond' | 'promote' | 'whatsapp' | 'navigate' | 'generic'
 *   content      {string}  — prefilled text / body
 *   links        {Array<{ label, url }>}
 *   phone        {string}  — for WhatsApp actions
 *   onActed      {() => void}  — called after user acts
 */
export default function ActionDrawer({ open, onClose, title, description, actionType, content, links = [], phone, onActed }) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onActed?.();
    } catch {}
  };

  const handleWhatsApp = () => {
    const cleanPhone = (phone || '').replace(/[^0-9+]/g, '');
    const encoded = encodeURIComponent(content || '');
    const url = cleanPhone
      ? `https://wa.me/${cleanPhone.startsWith('0') ? '972' + cleanPhone.slice(1) : cleanPhone}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;
    window.open(url, '_blank');
    onActed?.();
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer — slides in from the right (RTL: right side = start) */}
      <div className="fixed top-0 right-0 z-50 h-full w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border">
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-semibold text-foreground leading-snug">{title || 'פעולה'}</h2>
            {description && (
              <p className="text-[12px] text-foreground-secondary mt-1 leading-relaxed">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-secondary transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Prefilled text block */}
          {content && (
            <div>
              <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-2">תוכן מוכן לשימוש</p>
              <div className="relative">
                <div className="bg-secondary/50 border border-border rounded-xl px-4 py-3 text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
                  {content}
                </div>
                <button
                  onClick={handleCopy}
                  className="absolute top-2 left-2 p-1.5 rounded-lg bg-card border border-border text-foreground-muted hover:text-foreground transition-colors"
                  title="העתק"
                >
                  {copied ? <CheckCheck className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          )}

          {/* External links */}
          {links.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide mb-2">קישורים</p>
              <div className="space-y-1.5">
                {links.map((link, i) => (
                  <a
                    key={i}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-[12px] text-primary hover:underline"
                  >
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                    {link.label || link.url}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="px-5 py-4 border-t border-border space-y-2">
          {/* Copy button */}
          {content && (actionType === 'social_post' || actionType === 'respond' || actionType === 'promote' || actionType === 'generic') && (
            <button
              onClick={handleCopy}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold bg-foreground text-background hover:opacity-90 transition-all"
            >
              {copied ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'הועתק! ✓' : 'העתק תוכן'}
            </button>
          )}

          {/* WhatsApp button */}
          {(actionType === 'whatsapp' || phone) && content && (
            <button
              onClick={handleWhatsApp}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold bg-[#25D366] text-white hover:opacity-90 transition-all"
            >
              <MessageCircle className="w-4 h-4" />
              שלח WhatsApp
            </button>
          )}

          {/* Phone button */}
          {actionType === 'call' && phone && (
            <a
              href={`tel:${phone}`}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold bg-primary text-white hover:opacity-90 transition-all"
            >
              <Phone className="w-4 h-4" />
              התקשר עכשיו
            </a>
          )}

          <button
            onClick={onClose}
            className="w-full py-2 rounded-xl text-[12px] text-foreground-muted border border-border hover:bg-secondary transition-all"
          >
            סגור
          </button>
        </div>
      </div>
    </>
  );
}
