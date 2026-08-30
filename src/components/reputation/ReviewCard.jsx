import React, { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Star, Loader2, RefreshCw, ExternalLink, ShieldCheck, ShieldX, Copy, CheckCheck, Bot } from 'lucide-react';

const PLATFORM_ICON = {
  'Google Maps':  '📍',
  'Facebook':     '📘',
  'Instagram':    '📸',
  'TripAdvisor':  '🦉',
  'Waze':         '🗺️',
  'Booking.com':  '🏨',
  'Wolt':         '🛵',
};

const sentimentBorder = {
  positive: 'border-l-[#10b981]',
  negative: 'border-l-[#dc2626]',
  neutral: 'border-l-[#d97706]',
};

const sentimentBadge = {
  positive: { text: 'חיובי', cls: 'bg-[#f0fdf8] text-[#10b981]' },
  negative: { text: 'שלילי', cls: 'bg-[#fef2f2] text-[#dc2626]' },
  neutral: { text: 'ניטרלי', cls: 'bg-[#fffbeb] text-[#d97706]' },
};

function StarRating({ rating }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`w-3.5 h-3.5 ${i <= rating ? 'text-[#d97706] fill-[#d97706]' : 'text-[#eeeeee]'}`} />
      ))}
    </div>
  );
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'לפני פחות משעה';
  if (hours < 24) return `לפני ${hours} שעות`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

function buildPrompt(type, review, bp) {
  const tone = bp?.tone_preference || 'friendly';
  const bName = bp?.name || '';
  const cat = bp?.category || '';
  const city = bp?.city || '';
  const toneGuide = `TONE GUIDELINES:
If tone is 'friendly': warm, personal, empathetic, use the reviewer's first name, add a personal touch.
If tone is 'formal': professional, respectful, structured, address as 'כבוד/ה [name]'.
If tone is 'direct': short, to the point, acknowledge issue, offer solution immediately, no fluff.
If tone is 'humorous': light humor to defuse tension, but still take the complaint seriously, self-deprecating humor works.`;

  if (type === 'professional') {
    return `You are a customer service expert for an Israeli small business.
Business: ${bName}
Category: ${cat}
City: ${city}
Communication tone: ${tone}

A customer left this negative review:
Reviewer: ${review.reviewer_name || 'לקוח'}
Rating: ${review.rating} stars
Review: ${review.text}

Write a professional response in Hebrew.
${toneGuide}

RESPONSE MUST:
- Acknowledge the specific issue mentioned in the review
- Apologize sincerely (not generic 'we apologize')
- Offer a concrete next step (phone number, invitation to visit, specific fix)
- Be 2-3 sentences maximum
- Feel like a HUMAN wrote it, not a bot

Write the response in natural Hebrew. Return ONLY the response text, nothing else.`;
  }

  if (type === 'thank') {
    return `You are writing a thank-you response for a positive review.
Business: ${bName}, Category: ${cat}
Tone: ${tone}
Reviewer: ${review.reviewer_name || 'לקוח'}
Rating: ${review.rating} stars
Review: ${review.text}

Write a warm thank-you response in Hebrew that:
- Thanks the reviewer by name
- References something SPECIFIC from their review
- Invites them to visit again or try something new
- Feels genuine, not template-like

${toneGuide}
2 sentences max. Return ONLY the response text.`;
  }

  // referral
  return `Write a response to a positive review that thanks the reviewer and naturally asks for a referral.
Business: ${bName}, Tone: ${tone}
Reviewer: ${review.reviewer_name || 'לקוח'}
Review: ${review.text}

The response should:
- Thank warmly
- Mention you'd love if they told friends/family
- Offer a small incentive (like: 'אם תביא/י חבר/ה, שניכם תקבלו 10% הנחה')
- Feel natural, not salesy

2-3 sentences. Hebrew only. Return ONLY the response text.`;
}

export default function ReviewCard({ review, businessProfile, compact = false }) {
  const [expanded, setExpanded] = useState(review.response_status === 'suggested');
  const [responseText, setResponseText] = useState(review.response_status === 'suggested' ? (review.suggested_response || '') : '');
  const [generating, setGenerating] = useState(false);
  const [generatingType, setGeneratingType] = useState('');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const textareaRef = useRef(null);
  const queryClient = useQueryClient();

  const borderCls = sentimentBorder[review.sentiment] || 'border-l-[#d97706]';
  const badge = sentimentBadge[review.sentiment] || sentimentBadge.neutral;
  const isSuggested = review.response_status === 'suggested' && !dismissed;
  const isPending = review.response_status === 'pending' && !dismissed;
  const isResponded = review.response_status === 'responded';
  const isAutoResponded = review.response_status === 'auto_responded';
  const isPublished = review.response_status === 'published';
  const [showAutoResponse, setShowAutoResponse] = useState(false);

  const topics = review.topics ? review.topics.split(',').map(t => t.trim()).filter(Boolean) : [];

  const generateResponse = async (type) => {
    setGenerating(true);
    setGeneratingType(type);
    setError('');
    setExpanded(false);
    const prompt = buildPrompt(type, review, businessProfile);
    try {
      const result = await base44.integrations.Core.InvokeLLM({ prompt, model: 'sonnet', maxTokens: 350 });
      if (!result || !result.trim()) {
        setError('לא הצלחנו לייצר תגובה. נסה שוב.');
        setGenerating(false);
        setGeneratingType('');
        return;
      }
      setResponseText(result.trim());
      setExpanded(true);
    } catch {
      setError('לא הצלחנו לייצר תגובה. נסה שוב.');
    }
    setGenerating(false);
    setGeneratingType('');
  };

  const logOutcome = async (actionType, accepted, desc) => {
    try {
      await base44.functions.invoke('logOutcome', {
        action_type: actionType,
        was_accepted: accepted,
        outcome_description: desc || '',
        linked_business: businessProfile?.id || '',
      });
    } catch (_) { /* non-critical */ }
  };

  const saveResponse = async () => {
    if (!responseText.trim()) return;
    try {
      await base44.entities.Review.update(review.id, {
        suggested_response: responseText,
        response_status: 'responded',
      });
      // Copy to clipboard so user can paste directly into Google/Facebook
      await navigator.clipboard.writeText(responseText).catch(() => {});
      setSaved(true);
      setCopied(true);
      logOutcome('review_response', true, `תגובה לביקורת של ${review.reviewer_name}`);
      queryClient.invalidateQueries({ queryKey: ['reviewsPage'] });
      queryClient.invalidateQueries({ queryKey: ['pendingReviews'] });
      queryClient.invalidateQueries({ queryKey: ['allReviews'] });
      setTimeout(() => { setExpanded(false); setSaved(false); setCopied(false); }, 3500);
    } catch {
      setError('שגיאה בשמירת התגובה. נסה שוב.');
    }
  };

  const copyToClipboard = async () => {
    if (!responseText.trim()) return;
    await navigator.clipboard.writeText(responseText).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEdit = () => {
    if (textareaRef.current) textareaRef.current.focus();
  };

  const handleCancel = () => {
    setExpanded(false);
    setResponseText('');
    logOutcome('review_response', false, `ביטול תגובה לביקורת של ${review.reviewer_name}`);
  };

  const buttonLabel = (type, label) => {
    if (generating && generatingType === type) return (
      <><Loader2 className="w-3 h-3 animate-spin" /> מייצר תגובה...</>
    );
    return label;
  };

  return (
    <div className={`bg-white rounded-[10px] border border-border/50 border-l-2 ${borderCls} hover:border-border transition-colors`}>
      <div className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-2 gap-1">
          <StarRating rating={review.rating} />
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-foreground-muted/70 bg-secondary/50 px-1.5 py-0.5 rounded">{PLATFORM_ICON[review.platform] || '📋'} {review.platform}</span>
            {review.source_url ? (
              <>
                <a href={review.source_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 bg-primary/5 hover:bg-primary/10 px-2 py-0.5 rounded-md transition-colors">
                  <ExternalLink className="w-3 h-3" /> צפה במקור
                </a>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#10b981] bg-[#f0fdf8] px-2 py-0.5 rounded-md">
                  <ShieldCheck className="w-3 h-3" /> מאומת
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-foreground-muted/70 bg-secondary/50 px-2 py-0.5 rounded-md">
                <ShieldX className="w-3 h-3" /> הוזן ידנית
              </span>
            )}
            <span className="text-[11px] text-foreground-muted">{review.reviewer_name}</span>
            <span className="text-[10px] text-foreground-muted/50">{timeAgo(review.created_at || review.created_date)}</span>
          </div>
        </div>
        <p className={`text-[${compact ? '10' : '12'}px] text-foreground-secondary leading-relaxed mb-2 ${compact ? 'line-clamp-2' : ''}`}>{review.text}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.text}</span>

          {isResponded && <span className="text-[10px] font-medium text-[#10b981]">✓ נשמר — העתק ופרסם ב-Google</span>}
          {isPublished && <span className="text-[10px] font-medium text-[#10b981]">✓ פורסם</span>}
          {isAutoResponded && <span className="text-[10px] font-medium text-[#6366f1]">⚡ AI הכין תגובה</span>}
          {isSuggested && <span className="text-[10px] font-medium text-[#d97706]">⏳ ממתין לאישורך</span>}

          {isSuggested && (
            <button onClick={() => { setResponseText(review.suggested_response || ''); setExpanded(true); }}
              className="px-3 py-1.5 text-[11px] font-medium bg-[#111111] text-white rounded-md hover:bg-[#333333] transition-colors">
              אשר תגובה →
            </button>
          )}

          {isPending && (review.sentiment === 'negative' || review.sentiment === 'neutral') && (
            <>
              <button onClick={() => generateResponse('professional')} disabled={generating}
                className="px-3 py-1.5 text-[11px] font-medium bg-[#111111] text-white rounded-md hover:bg-[#333333] transition-colors flex items-center gap-1 disabled:opacity-50">
                {buttonLabel('professional', 'הצע תגובה מקצועית')}
              </button>
              <button
                onClick={() => {
                  const reviewSnippet = (review.text || '').slice(0, 120);
                  window.dispatchEvent(new CustomEvent('chat:open', {
                    detail: { message: `קיבלתי ביקורת שלילית מ${review.reviewer_name || 'לקוח'}: "${reviewSnippet}" — תעזור לי לנסח תגובה מקצועית` }
                  }));
                }}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-foreground-muted/70 bg-white border border-border/60 rounded-md hover:border-primary/30 hover:text-primary transition-colors">
                <Bot className="w-3 h-3" /> שאל AI
              </button>
              <button onClick={() => setDismissed(true)} disabled={generating}
                className="px-3 py-1.5 text-[11px] font-medium text-foreground-muted/70 bg-white border border-border/60 rounded-md hover:border-border-hover hover:text-foreground-secondary transition-colors">
                אחר כך
              </button>
            </>
          )}

          {isAutoResponded && (
            <>
              <button onClick={() => setShowAutoResponse(!showAutoResponse)}
                className="px-3 py-1.5 text-[11px] font-medium text-foreground-muted/70 bg-white border border-border/60 rounded-md hover:border-border-hover hover:text-foreground-secondary transition-colors">
                {showAutoResponse ? 'הסתר' : 'צפה בתגובה'}
              </button>
              <button onClick={() => { setResponseText(review.suggested_response || ''); setExpanded(true); }}
                className="px-3 py-1.5 text-[11px] font-medium text-foreground-muted/70 bg-white border border-border/60 rounded-md hover:border-border-hover hover:text-foreground-secondary transition-colors">
                ערוך ואשר
              </button>
            </>
          )}

          {isPending && review.sentiment === 'positive' && (
            <>
              <button onClick={() => generateResponse('thank')} disabled={generating}
                className="px-3 py-1.5 text-[11px] font-medium bg-[#111111] text-white rounded-md hover:bg-[#333333] transition-colors flex items-center gap-1 disabled:opacity-50">
                {buttonLabel('thank', 'הודה ושתף')}
              </button>
              <button onClick={() => generateResponse('referral')} disabled={generating}
                className="px-3 py-1.5 text-[11px] font-medium text-foreground-muted/70 bg-white border border-border/60 rounded-md hover:border-border-hover hover:text-foreground-secondary transition-colors flex items-center gap-1 disabled:opacity-50">
                {buttonLabel('referral', 'בקש המלצה')}
              </button>
            </>
          )}
        </div>

        {/* Topic tags from AI extraction */}
        {topics.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {topics.map((t, i) => (
              <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-full bg-secondary/60 text-foreground-muted border border-border/60">
                {t}
              </span>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] text-[#dc2626]">{error}</span>
            <button onClick={() => generateResponse(generatingType || 'professional')} className="text-[11px] text-[#111111] underline flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> נסה שוב
            </button>
          </div>
        )}
      </div>

      {isAutoResponded && showAutoResponse && review.suggested_response && (
        <div className="px-4 pb-3 border-t border-border/40 pt-3">
          <label className="text-[11px] text-foreground-muted mb-1.5 block">תגובה אוטומטית:</label>
          <p className="text-[12px] text-foreground-secondary bg-[#f0fdf8] border border-[#d1fae5] rounded-lg p-3 leading-relaxed">{review.suggested_response}</p>
        </div>
      )}

      {expanded && (
        <div className="px-4 pb-4 border-t border-border/40 pt-3">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <label className="text-[11px] text-foreground-muted">תגובה מוצעת:</label>
            <span className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-[#fffbeb] border border-[#fef3c7] text-[#d97706]">
              ⚡ נוצר ע"י AI — עיין ואשר לפני פרסום
            </span>
          </div>
          <textarea ref={textareaRef} value={responseText} onChange={(e) => setResponseText(e.target.value)}
            rows={3} style={{ minHeight: '80px' }}
            className="w-full bg-secondary/50 border border-border/60 rounded-lg p-3 text-[12px] text-[#333333] resize-none focus:outline-none focus:border-border" />
          <div className="flex flex-wrap gap-2 mt-2 items-center">
            {saved ? (
              <div className="flex items-center gap-2">
                <span className="px-3 py-1.5 text-[12px] font-medium text-[#10b981]">✓ נשמר</span>
                <span className="text-[11px] text-[#6366f1] flex items-center gap-1">
                  <Copy className="w-3 h-3" /> הועתק ללוח — פרסם עכשיו ב-Google/Facebook
                </span>
              </div>
            ) : (
              <>
                <button onClick={saveResponse} className="px-4 py-2 text-[12px] font-medium bg-[#111111] text-white rounded-md hover:bg-[#333333] transition-colors">
                  שמור והעתק ✓
                </button>
                <button onClick={copyToClipboard} className="px-3 py-1.5 text-[12px] font-medium text-[#6366f1] bg-primary/8 border border-primary/15 rounded-md hover:bg-primary/10 transition-colors flex items-center gap-1">
                  {copied ? <><CheckCheck className="w-3 h-3" /> הועתק</> : <><Copy className="w-3 h-3" /> העתק</>}
                </button>
                {review.source_url && (
                  <a href={review.source_url} target="_blank" rel="noopener noreferrer"
                    className="px-3 py-1.5 text-[12px] font-medium text-foreground-muted/70 bg-white border border-border/60 rounded-md hover:border-border-hover hover:text-foreground-secondary transition-colors flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" /> פתח ב-Google
                  </a>
                )}
                <button onClick={handleEdit} className="px-3 py-1.5 text-[12px] font-medium text-foreground-muted/70 bg-white border border-border/60 rounded-md hover:border-border-hover hover:text-foreground-secondary transition-colors">ערוך</button>
                <button onClick={handleCancel} className="px-3 py-1.5 text-[12px] font-medium text-foreground-muted/70 bg-white border border-border/60 rounded-md hover:border-border-hover hover:text-foreground-secondary transition-colors">בטל</button>
              </>
            )}
          </div>
          <p className="text-[10px] text-foreground-muted/70 mt-2">
            * המערכת שומרת את התגובה — לשליחה בפועל יש להדביק אותה בדף הביזנס שלך ב-Google / Facebook
          </p>
        </div>
      )}
    </div>
  );
}