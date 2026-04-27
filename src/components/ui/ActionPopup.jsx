import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { base44 } from '@/api/base44Client';
import { X, Copy, CheckCheck, Sparkles, Loader2, Image, Users, Send, Phone, MessageSquare, Target } from 'lucide-react';
import { toast } from 'sonner';
import { classifyInsight, popupTypeToActionType, getPlatformSetupConfig } from '@/lib/popup_classifier';
import CampaignPlanner from './CampaignPlanner';

const _apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3007/api';
const SERVER_BASE = _apiUrl.replace(/\/api\/?$/, '');

/**
 * ActionPopup — 4-step action modal for a MarketSignal.
 *
 * Steps: content → image → audience → publish
 *
 * Props:
 *   signal         — MarketSignal object
 *   businessProfile
 *   onClose        — close handler
 */

const ACTION_TYPE_CONFIG = {
  social_post:    { label: 'פרסום ברשתות חברתיות', icon: '📣' },
  respond:        { label: 'תגובה ללקוח / ביקורת',  icon: '💬' },
  promote:        { label: 'מבצע / קידום מכירות',    icon: '🎯' },
  call:           { label: 'שיחת טלפון / פגישה',     icon: '📞' },
  task:           { label: 'משימה פנימית',            icon: '✅' },
  platform_setup: { label: 'הגדרת פלטפורמה דיגיטלית', icon: '🔧' },
};

// Per-type step definitions
const STEPS_BY_TYPE = {
  social_post:    ['תוכן', 'תמונה', 'קהל', 'פרסם'],
  promote:        ['מבצע',  'תמונה', 'קהל', 'פרסם'],
  respond:        ['תגובה', 'שיגור'],
  call:           ['הכנה',  'שיחה'],
  task:           ['פרטים', 'בצע'],
  platform_setup: ['הגדרה'],
};

// Image generation is handled server-side via base44.functions.invoke('generateImage')
// to avoid CORS/403 issues with third-party APIs from the browser.

export default function ActionPopup({ signal, businessProfile, onClose }) {
  const [step,     setStep]     = useState(0); // 0=content, 1=image, 2=audience, 3=publish
  const [text,     setText]     = useState('');
  const [copied,   setCopied]   = useState(false);
  const [creating, setCreating] = useState(false);
  const [done,     setDone]     = useState(false);

  // Multi-brain smart post (ITEM: PostGenerationAgent)
  const [smartPhase,   setSmartPhase]   = useState(null); // null | 'analyzing' | 'writing' | 'imaging' | 'ready'
  const [smartHashtags,setSmartHashtags]= useState([]);
  const [smartCta,     setSmartCta]     = useState('');
  const [smartAudience,setSmartAudience]= useState(null); // from generateSmartPost
  const [smartImagePrompt, setSmartImagePrompt] = useState('');

  // Image step
  const [imageUrl,         setImageUrl]         = useState(null);
  const [imageProvider,    setImageProvider]    = useState(null); // 'dalle3'|'pexels'|'unsplash'|'stock'
  const [imageIsStock,     setImageIsStock]     = useState(false);
  const [imageLoading,     setImageLoading]     = useState(false);
  const [imageError,       setImageError]       = useState(null); // null | string — blocking error
  const [imageNotice,      setImageNotice]      = useState(null); // null | string — soft notice
  const [altPhotos,        setAltPhotos]        = useState([]);   // thumbnail URLs for quick swap
  const [customPrompt,     setCustomPrompt]     = useState('');   // free-text user description
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);
  const customPromptRef = useRef(null);

  // Audience step — per-insight single audience profile (fast) + legacy segments fallback
  const [audience,        setAudience]        = useState(null);  // per-insight profile
  const [segments,        setSegments]        = useState(null);   // legacy 3-segment list
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [dataQuality,     setDataQuality]     = useState(null); // 'real' | 'estimated'
  const [showCampaign,    setShowCampaign]    = useState(false); // toggle campaign planner

  // Respond type — tone regeneration
  const [toneLoading, setToneLoading] = useState(false);

  // Call type — AI call points
  const [callPoints,        setCallPoints]        = useState([]);
  const [callPointsLoading, setCallPointsLoading] = useState(false);
  const [callDone,          setCallDone]          = useState(false);

  // Direct publish to social API
  const [publishing,     setPublishing]     = useState(false);
  const [publishResult,  setPublishResult]  = useState(null); // null | 'ok' | 'error'

  // Platform setup — completed steps checklist
  const [completedSteps, setCompletedSteps] = useState([]);

  const meta = (() => {
    try { return JSON.parse(signal.source_description || '{}'); } catch { return {}; }
  })();

  // Auto-classify when action_type isn't set explicitly
  const rawActionType = meta.action_type || (() => {
    const popupType = classifyInsight({
      action_platform:  meta.platform,
      action_label:     meta.action_label || signal.recommended_action,
      action_type:      meta.action_type,
      summary:          signal.summary,
      recommended_action: signal.recommended_action,
      category:         signal.category,
    });
    return popupTypeToActionType(popupType);
  })();

  const actionType  = rawActionType || 'task';
  const platformSetupConfig = actionType === 'platform_setup'
    ? getPlatformSetupConfig(signal.summary || '', meta.action_label || signal.recommended_action || '')
    : null;
  const actionLabel = meta.action_label || signal.recommended_action || 'פעולה מומלצת';
  const timeMinutes = meta.time_minutes || 15;
  const config      = ACTION_TYPE_CONFIG[actionType] || ACTION_TYPE_CONFIG.task;
  const isSocialType = ['social_post', 'promote'].includes(actionType);
  const STEPS = STEPS_BY_TYPE[actionType] || STEPS_BY_TYPE.task;

  useEffect(() => {
    setText(meta.prefilled_text || signal.recommended_action || '');
    setStep(0);
    setImageUrl(null);
    setImageProvider(null);
    setImageIsStock(false);
    setImageError(null);
    setAltPhotos([]);
    setImageNotice(null);
    setCustomPrompt('');
    setShowCustomPrompt(false);
    setAudience(null);
    setSegments(null);
    setSmartPhase(null);
    setSmartHashtags([]);
    setSmartCta('');
    setSmartAudience(null);
    setSmartImagePrompt('');
    setDone(false);
    setToneLoading(false);
    setCallPoints([]);
    setCallPointsLoading(false);
    setCallDone(false);
    setPublishing(false);
    setPublishResult(null);
    setCompletedSteps([]);

    // For social posts: kick off the multi-brain pipeline automatically
    if (['social_post', 'promote'].includes(rawActionType)) {
      runSmartGeneration();
    }
  }, [signal.id]);

  // ── Multi-brain: Claude audience + GPT post + DALL-E image ──
  async function runSmartGeneration() {
    if (!businessProfile?.id) return;
    setSmartPhase('analyzing');
    try {
      // Phase 1+2: Claude builds audience + GPT writes post (server does both)
      const res = await base44.functions.invoke('generateSmartPost', {
        businessProfileId: businessProfile.id,
        insight_text:      signal.summary,
        action_label:      actionLabel,
        platform:          'instagram',
      });
      const data = res?.data || res;

      if (data?.post?.text) {
        setText(data.post.text);
        setSmartHashtags(data.post.hashtags || []);
        setSmartCta(data.post.cta || '');
      }
      if (data?.audience) setSmartAudience(data.audience);
      if (data?.imagePrompt) setSmartImagePrompt(data.imagePrompt);

      setSmartPhase('imaging');

      // Phase 3: generate image — use GPT-4o's English image_description so it matches the post
      const imgRes = await base44.functions.invoke('generateImage', {
        businessProfileId: businessProfile?.id,
        custom_prompt:     data?.post?.image_description || '',
        insight_text:      signal.summary,
        post_text:         data?.post?.text || '',
        force_regenerate:  false,
      });
      const imgData = imgRes?.data || imgRes;
      if (imgData?.url) {
        setImageUrl(imgData.url);
        setImageProvider(imgData.provider || 'stock');
        setImageIsStock(!['dalle3', 'imagen3'].includes(imgData.provider));
        setAltPhotos(Array.isArray(imgData.alt_photos) ? imgData.alt_photos.filter(Boolean) : []);
      }

      setSmartPhase('ready');
    } catch (err) {
      console.warn('[ActionPopup] smart generation failed:', err?.message);
      setSmartPhase('ready'); // show whatever we have
    }
  }

  // ── Respond tone regeneration ──
  async function handleRegenerateTone(tone) {
    if (!businessProfile?.id) return;
    setToneLoading(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        model: 'haiku',
        prompt: `כתוב תגובה לביקורת שלילית עבור העסק "${businessProfile?.name || ''}".
ביקורת: "${signal.summary}"
סגנון: ${tone === 'professional' ? 'מקצועי ורשמי, ללא אמוג\'י' : tone === 'empathetic' ? 'אמפתי וחם, עם הרגשה של אכפתיות אמיתית' : 'קצר ופשוט, 2-3 משפטים בלבד'}

כתוב רק את טקסט התגובה בעברית, ללא כותרות.`,
      });
      if (typeof result === 'string' && result.trim()) {
        setText(result.trim());
        toast.success('התגובה עודכנה');
      }
    } catch { toast.error('שגיאה — נסה שוב'); }
    setToneLoading(false);
  }

  // ── Generate call preparation points ──
  async function handleGenerateCallPoints() {
    if (!businessProfile?.id) return;
    setCallPointsLoading(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        model: 'haiku',
        prompt: `צור 4 נקודות שיחה קצרות ועסקיות בעברית עבור שיחת טלפון.

עסק: "${businessProfile?.name || ''}"
נושא: ${signal.summary}
פעולה מומלצת: ${signal.recommended_action || actionLabel}

כל נקודה: משפט אחד, פועל ציווי, ספציפי. ללא מספור — רק הנקודות, כל אחת בשורה.`,
      });
      if (typeof result === 'string') {
        setCallPoints(result.trim().split('\n').filter(Boolean).slice(0, 4));
        toast.success('נקודות השיחה מוכנות');
      }
    } catch { toast.error('שגיאה — נסה שוב'); }
    setCallPointsLoading(false);
  }

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Generate image — server-side endpoint (DALL-E → Pexels → Unsplash → stock) ──
  async function handleGenerateImage() {
    setImageLoading(true);
    setImageError(null);
    setImageNotice(null);
    try {
      const res = await base44.functions.invoke('generateImage', {
        businessProfileId: businessProfile?.id,
        insight_text:      signal.summary,
        post_text:         text,
        custom_prompt:     customPrompt.trim() || undefined,
        force_regenerate:  imageUrl !== null,
      });
      const data = res?.data || res;
      if (!data?.url) throw new Error('לא התקבלה תמונה מהשרת');
      setImageUrl(data.url);
      setImageProvider(data.provider || 'stock');
      // is_stock=true + dalle_attempted=false means OpenAI key not configured
      setImageIsStock(!['dalle3', 'imagen3'].includes(data.provider));
      setAltPhotos(Array.isArray(data.alt_photos) ? data.alt_photos.filter(Boolean) : []);
      setStep(1);
      // Soft notice when user wrote custom prompt but DALL-E key not configured
      if (customPrompt.trim() && data.provider !== 'dalle3' && data.dalle_attempted === false) {
        setImageNotice('תמונת AI אינה זמינה — הוצגה תמונה דומה לתיאור שלך');
      }
    } catch (err) {
      setImageError(err?.message || 'שגיאה ביצירת תמונה — נסה שוב');
    } finally {
      setImageLoading(false);
    }
  }

  // ── Load per-insight audience (ITEM 1) ──
  async function handleLoadAudience() {
    if (audience || segments) { setStep(2); return; }
    setAudienceLoading(true);
    try {
      // Primary: per-insight specific audience profile
      const res = await base44.functions.invoke('buildInsightAudience', {
        businessProfileId: businessProfile?.id,
        insight_text:      signal.summary,
        action_label:      actionLabel,
        insight_type:      signal.category || actionType,
      });
      const data = res?.data || res;
      if (data?.audience) {
        setAudience(data.audience);
        setDataQuality('real');
      } else {
        // Fallback to 3-segment list
        const res2 = await base44.functions.invoke('getAudienceSegments', {
          businessProfileId: businessProfile?.id,
          insight_text: signal.summary,
          action_type:  actionType,
        });
        const data2 = res2?.data || res2;
        setSegments(Array.isArray(data2?.segments) ? data2.segments : []);
        setDataQuality(data2?.data_quality || 'estimated');
      }
      setStep(2);
    } catch {
      toast.error('שגיאה בטעינת קהל יעד');
    }
    setAudienceLoading(false);
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('הטקסט הועתק ✓');
  }

  async function handleCreateTask() {
    setCreating(true);
    try {
      await base44.entities.Task.create({
        title: actionLabel,
        description: `${text}\n\nמקור: ${signal.summary}`,
        status: 'pending',
        priority: signal.impact_level === 'high' ? 'high' : 'medium',
        source_type: 'alert',
        linked_business: businessProfile?.id || '',
      });
      toast.success('המשימה נוצרה ✓');
      setDone(true);
    } catch {
      toast.error('שגיאה ביצירת המשימה');
    }
    setCreating(false);
  }

  // Direct API publish to Facebook/Instagram
  async function handlePublishToSocial(platform = 'both') {
    if (!businessProfile?.id) { toast.error('נדרש חשבון עסקי'); return; }
    setPublishing(true);
    try {
      const res = await fetch(`${SERVER_BASE}/api/functions/publishPost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessProfileId: businessProfile.id,
          caption: text,
          imageUrl: imageUrl || null,
          platform,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה בפרסום');
      setPublishResult('ok');
      toast.success(data.message || 'הפוסט נשלח לפרסום ✓');
    } catch (err) {
      setPublishResult('error');
      toast.error(`שגיאה: ${err.message}`);
    } finally {
      setPublishing(false);
    }
  }

  // Step bar progress
  const stepBar = (
    <div className="flex gap-1.5 mb-5">
      {STEPS.map((label, i) => (
        <button
          key={i}
          onClick={() => i <= step && setStep(i)}
          className="flex-1 flex flex-col items-center gap-1 group"
          disabled={i > step}
        >
          <div className={`w-full h-1 rounded-full transition-colors ${
            i <= step ? 'bg-indigo-600' : 'bg-gray-100'
          }`} />
          <span className={`text-[9px] font-medium transition-colors ${
            i === step ? 'text-indigo-600' : i < step ? 'text-gray-400' : 'text-gray-200'
          }`}>{label}</span>
        </button>
      ))}
    </div>
  );

  const SMART_PHASE_LABELS = {
    analyzing: 'Claude מנתח קהל יעד...',
    writing:   'GPT-4o כותב פוסט...',
    imaging:   'DALL-E יוצר תמונה...',
  };

  // ── STEP 0: Content ──
  const stepContent = (
    <>
      {/* Multi-brain progress bar */}
      {smartPhase && smartPhase !== 'ready' && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-indigo-50 rounded-xl border border-indigo-100">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500 flex-shrink-0" />
          <span className="text-[11px] text-indigo-700">{SMART_PHASE_LABELS[smartPhase]}</span>
          <div className="flex gap-1 mr-auto">
            {['analyzing','writing','imaging'].map((p, i) => (
              <div key={p} className={`w-1.5 h-1.5 rounded-full transition-colors ${
                ['analyzing','writing','imaging','ready'].indexOf(smartPhase) >= i
                  ? 'bg-indigo-500' : 'bg-indigo-200'
              }`} />
            ))}
          </div>
        </div>
      )}

      {/* Smart audience context when ready */}
      {smartPhase === 'ready' && smartAudience && (
        <div className="flex items-center gap-2 mb-1.5 px-3 py-1.5 bg-indigo-50 rounded-xl border border-indigo-100">
          <span className="text-[10px] text-indigo-600">👥 {smartAudience.age_range} · {smartAudience.gender} · {smartAudience.preferred_channel}</span>
          <span className="text-[9px] text-indigo-400 mr-auto">Claude Sonnet</span>
        </div>
      )}
      {/* Best posting time */}
      {smartPhase === 'ready' && smartAudience?.best_time && (
        <div className="flex items-center gap-1.5 mb-2 px-3 py-1 text-[10px] text-indigo-500">
          <span>⏰</span>
          <span>זמן אידיאלי לפרסום: {smartAudience.best_time}</span>
        </div>
      )}

      {/* Signal context */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 mb-3">
        <p className="text-[11px] font-semibold text-indigo-700 mb-1">התובנה:</p>
        <p className="text-[12px] text-indigo-900">{signal.summary}</p>
      </div>

      {(!smartPhase || smartPhase === 'ready') && (
        <p className="text-[11px] font-semibold text-gray-600 mb-1.5">
          {isSocialType
            ? (smartPhase === 'ready' ? 'טקסט מוכן לפרסום — GPT-4o (ניתן לעריכה):' : 'טקסט מוכן לפרסום (ניתן לעריכה):')
            : 'פרטי הפעולה:'}
        </p>
      )}

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={5}
        className="w-full text-[12px] text-gray-800 border border-gray-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
        style={{ fontFamily: 'inherit', lineHeight: 1.6 }}
      />

      {/* Smart hashtags */}
      {smartPhase === 'ready' && smartHashtags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {smartHashtags.map((tag, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full border border-indigo-100">{tag}</span>
          ))}
        </div>
      )}

      {/* CTA */}
      {smartPhase === 'ready' && smartCta && (
        <p className="text-[10px] text-indigo-500 font-medium mt-1.5">
          📣 {smartCta}
        </p>
      )}

      {/* Inline image error banner */}
      {imageError && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 mb-2 bg-red-50 border border-red-100 rounded-xl text-[11px] text-red-700">
          <span>{imageError}</span>
          <button
            onClick={handleGenerateImage}
            className="flex-shrink-0 text-[10px] underline hover:no-underline"
          >
            נסה שוב
          </button>
        </div>
      )}

      {/* 3 action buttons: image | audience | publish */}
      <div className="grid grid-cols-3 gap-2 mt-3 mb-2">
        <button
          onClick={handleGenerateImage}
          disabled={imageLoading}
          className="flex flex-col items-center gap-1.5 py-2.5 px-2 border border-gray-200 rounded-xl text-[11px] hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-50"
        >
          {imageLoading
            ? <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
            : <Image className="w-4 h-4 text-gray-500" />}
          <span className="text-gray-600">{imageLoading ? 'מייצר...' : 'צור תמונה'}</span>
        </button>
        <button
          onClick={handleLoadAudience}
          disabled={audienceLoading}
          className="flex flex-col items-center gap-1.5 py-2.5 px-2 border border-gray-200 rounded-xl text-[11px] hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-50"
        >
          {audienceLoading
            ? <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
            : <Users className="w-4 h-4 text-gray-500" />}
          <span className="text-gray-600">{audienceLoading ? 'טוען...' : 'קהל יעד'}</span>
        </button>
        <button
          onClick={() => setStep(STEPS.length - 1)}
          className="flex flex-col items-center gap-1.5 py-2.5 px-2 bg-indigo-600 text-white rounded-xl text-[11px] hover:bg-indigo-700 transition-all"
        >
          <Send className="w-4 h-4" />
          <span>פרסם</span>
        </button>
      </div>

      {/* Copy + create task */}
      <div className="space-y-2 pt-2 border-t border-gray-100 mt-3">
        {isSocialType && (
          <button onClick={handleCopy}
            className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-indigo-200 text-indigo-700 rounded-xl text-[13px] font-medium hover:bg-indigo-50 transition-all">
            {copied ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'הועתק!' : 'העתק טקסט'}
          </button>
        )}
        <button onClick={handleCreateTask} disabled={creating}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white rounded-xl text-[13px] font-semibold hover:bg-indigo-700 transition-all disabled:opacity-70">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
          {creating ? 'יוצר משימה...' : 'צור משימה ועקוב'}
        </button>
      </div>
    </>
  );

  // ── STEP 1: Image ──
  const stepImage = (
    <>
      <div className="mb-3">
        <p className="text-[12px] font-semibold text-gray-700 mb-2">תמונה שיווקית — נוצרה על ידי AI</p>

        {/* Loading state */}
        {imageLoading && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 mb-3 bg-gray-50 rounded-xl border border-gray-100">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
            <span className="text-[11px] text-gray-500">יוצר תמונה... (עד 30 שניות)</span>
          </div>
        )}

        {/* Error state */}
        {!imageLoading && imageError && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 mb-3 bg-red-50 border border-red-100 rounded-xl text-[11px] text-red-700">
            <span>{imageError}</span>
            <button onClick={handleGenerateImage} className="flex-shrink-0 text-[10px] underline hover:no-underline">
              נסה שוב
            </button>
          </div>
        )}

        {/* Image */}
        {!imageLoading && imageUrl && (
          <div className="relative mb-3">
            <img
              src={imageUrl}
              alt="marketing image"
              className="w-full rounded-xl border border-gray-100"
              style={{ maxHeight: 260, objectFit: 'cover' }}
              onError={() => {
                setImageUrl(null);
                setImageError('התמונה לא נטענה — נסה שוב');
              }}
            />
            {/* Stock badge */}
            {imageIsStock && (
              <span className="absolute bottom-2 right-2 text-[9px] font-medium px-1.5 py-0.5 rounded bg-black/60 text-white">
                {imageProvider === 'imagen3' ? 'Google AI' : imageProvider === 'dalle3' ? 'DALL-E' : 'תמונת stock'}
              </span>
            )}
            {/* Regenerate overlay */}
            <button
              onClick={handleGenerateImage}
              className="absolute top-2 left-2 text-[10px] px-2 py-1 rounded-md bg-black/55 text-white hover:bg-black/75 transition-all"
            >
              ↻ צור מחדש
            </button>
          </div>
        )}

        {/* Soft notice — DALL-E not available */}
        {imageNotice && (
          <div className="flex items-center gap-2 px-3 py-2 mb-2 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-700">
            <span>⚠️ {imageNotice}</span>
          </div>
        )}

        {/* Alt photos thumbnail strip — quick swap without new API call */}
        {!imageLoading && altPhotos.length > 0 && (
          <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
            {altPhotos.slice(0, 5).map((thumb, i) => (
              <button
                key={i}
                onClick={() => setImageUrl(thumb.replace(/w=\d+/, 'w=1024').replace(/h=\d+/, 'h=576'))}
                className="flex-shrink-0 w-14 h-10 rounded-lg overflow-hidden border-2 border-transparent hover:border-indigo-400 transition-all"
                title="החלף תמונה"
              >
                <img src={thumb} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}

        {/* Action buttons row */}
        <div className="flex gap-2 mb-2">
          <button
            onClick={handleGenerateImage}
            disabled={imageLoading}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-gray-200 rounded-xl text-[12px] hover:bg-gray-50 transition-all disabled:opacity-50"
          >
            {imageLoading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
              : <Sparkles className="w-3.5 h-3.5 text-gray-500" />}
            {imageLoading ? 'יוצר...' : '↻ תמונה חדשה'}
          </button>

          <button
            onClick={() => {
              setShowCustomPrompt(v => !v);
              setTimeout(() => customPromptRef.current?.focus(), 60);
            }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] transition-all border ${
              showCustomPrompt
                ? 'bg-indigo-50 border-indigo-400 text-indigo-700'
                : 'border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            ✏️ תאר תמונה
          </button>
        </div>

        {/* Custom prompt textarea */}
        {showCustomPrompt && (
          <div className="mb-2">
            <textarea
              ref={customPromptRef}
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              placeholder='תאר מה אתה רוצה לראות בתמונה... למשל: "מנת סטייק על גריל עם עשן, תאורת ערב"'
              rows={3}
              className="w-full text-[12px] text-gray-800 border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-gray-50 placeholder-gray-400"
              style={{ direction: 'rtl', fontFamily: 'inherit', lineHeight: 1.5 }}
            />
            <button
              onClick={() => {
                if (customPrompt.trim()) {
                  handleGenerateImage();
                  setShowCustomPrompt(false);
                }
              }}
              disabled={!customPrompt.trim() || imageLoading}
              className="w-full mt-1.5 py-2.5 rounded-xl text-[12px] font-medium transition-all disabled:opacity-40 disabled:cursor-default"
              style={{
                background: customPrompt.trim() ? '#4f46e5' : '#e5e7eb',
                color: customPrompt.trim() ? '#fff' : '#9ca3af',
              }}
            >
              {imageLoading ? 'יוצר...' : 'צור לפי התיאור ←'}
            </button>
          </div>
        )}

        <button onClick={() => setStep(STEPS.length - 1)}
          className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-[12px] font-medium hover:bg-indigo-700 transition-all">
          המשך לפרסום ←
        </button>
      </div>
      <p className="text-[10px] text-gray-400 text-center">תמונה AI חינמית — הורד ושמור לפני פרסום</p>
    </>
  );

  // ── STEP 2: Audience ──
  const SIZE_LABELS   = { small: 'קטן', medium: 'בינוני', large: 'גדול' };
  const INCOME_LABELS = { low: 'נמוך', mid: 'בינוני', high: 'גבוה' };

  const stepAudience = (
    <>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <p className="text-[12px] font-semibold text-gray-700">
            {audience ? 'קהל יעד לתובנה זו' : '3 קהלי יעד מבוססי נתונים'}
          </p>
          {dataQuality && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
              dataQuality === 'real'
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-amber-50 text-amber-600 border-amber-200'
            }`}>
              {dataQuality === 'real' ? 'נתונים אמיתיים' : 'הערכה'}
            </span>
          )}
        </div>
        {/* Campaign planner toggle */}
        <button
          onClick={() => setShowCampaign(v => !v)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all"
          style={{
            background: showCampaign ? '#4f46e5' : '#eef2ff',
            color: showCampaign ? '#fff' : '#4f46e5',
          }}
        >
          <Target className="w-3 h-3" />
          {showCampaign ? 'קהל יעד' : 'בנה קמפיין'}
        </button>
      </div>

      {/* ── Campaign Planner panel ── */}
      {showCampaign ? (
        <CampaignPlanner
          businessProfile={businessProfile}
          audienceSegments={segments}
        />
      ) : (
        <>
          {/* Per-insight audience profile */}
          {audience && (
            <div className="space-y-2.5 mb-3">
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
                <p className="text-[13px] font-bold text-indigo-800 mb-0.5">{audience.headline}</p>
                <p className="text-[11px] text-indigo-600">
                  {audience.age_range} · {audience.gender} · {audience.best_channel} · {audience.best_time}
                </p>
              </div>
              {audience.why_this_insight_matters && (
                <div className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
                  <p className="text-[10px] text-gray-400 mb-1">למה התובנה הזו רלוונטית לקהל</p>
                  <p className="text-[12px] text-gray-700">{audience.why_this_insight_matters}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'כאב מרכזי', value: audience.pain_point },
                  { label: 'גודל קהל',  value: audience.estimated_size },
                ].map(item => (
                  <div key={item.label} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <p className="text-[10px] text-gray-400 mb-0.5">{item.label}</p>
                    <p className="text-[11px] text-gray-700">{item.value}</p>
                  </div>
                ))}
              </div>
              {audience.keywords?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {audience.keywords.map((kw, j) => (
                    <span key={j} className="text-[10px] px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full border border-indigo-100">
                      {kw}
                    </span>
                  ))}
                </div>
              )}
              {audience.confidence === 'low' && (
                <p className="text-[10px] text-amber-600">⚠ נתונים מועטים — הפעל סריקה לדיוק גבוה יותר</p>
              )}
            </div>
          )}

          {/* 3-segment paid-ads format (new getAudienceSegments output) */}
          {!audience && segments && segments.length > 0 && (
            <div className="space-y-3 mb-3">
              {segments.map((seg, i) => (
                <div key={i} className="border border-gray-100 rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-indigo-700">{seg.segment_name}</span>
                    <span className="text-[10px] text-gray-400">{seg.age_min}–{seg.age_max} | {seg.genders || seg.age_range}</span>
                  </div>
                  <p className="text-[10px] text-gray-600 mb-2">{seg.description}</p>
                  {/* Facebook interests */}
                  {seg.facebook_targeting?.interests?.length > 0 && (
                    <div className="mb-1.5">
                      <p className="text-[9px] text-gray-400 mb-0.5">📘 FB Interests</p>
                      <div className="flex flex-wrap gap-1">
                        {seg.facebook_targeting.interests.slice(0, 4).map((kw, j) => (
                          <span key={j} className="text-[9px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-full border border-blue-100">{kw}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Google keywords */}
                  {seg.google_targeting?.keywords?.length > 0 && (
                    <div className="mb-1.5">
                      <p className="text-[9px] text-gray-400 mb-0.5">🔍 Google Keywords</p>
                      <div className="flex flex-wrap gap-1">
                        {seg.google_targeting.keywords.slice(0, 3).map((kw, j) => (
                          <span key={j} className="text-[9px] px-1.5 py-0.5 bg-green-50 text-green-700 rounded-full border border-green-100">{kw}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 text-[9px] text-gray-400 mt-1">
                    {seg.estimated_audience_range && <span>👥 {seg.estimated_audience_range}</span>}
                    <span>המרה: {Math.round((seg.conversion_probability || 0) * 100)}%</span>
                    {seg.best_posting_time && <span>⏰ {seg.best_posting_time}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!audience && (!segments || segments.length === 0) && (
            <div className="text-center py-6 text-[12px] text-gray-400">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
              אין מספיק נתונים לפילוח עדיין
            </div>
          )}
        </>
      )}

      <button onClick={() => setStep(STEPS.length - 1)}
        className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-[12px] font-medium hover:bg-indigo-700 transition-all">
        פרסם לקהל הזה ←
      </button>
    </>
  );

  // ── STEP 3: Publish ──
  const stepPublish = (
    <>
      {segments?.[0] && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2 mb-3 text-[11px] text-indigo-800">
          👥 קהל מומלץ: {segments[0].segment_name}
          {segments[0].preferred_channels?.[0] && ` — דרך ${segments[0].preferred_channels[0]}`}
        </div>
      )}
      {imageUrl && (
        <div className="mb-3">
          <img src={imageUrl} alt="marketing" className="w-full rounded-lg object-cover" style={{ maxHeight: 120 }} />
          <a href={imageUrl} download className="text-[10px] text-indigo-500 hover:underline mt-1 block text-center">⬇ הורד תמונה</a>
        </div>
      )}

      {/* Preview */}
      <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 mb-3 text-[12px] text-gray-700 leading-relaxed">
        {text}
      </div>

      {publishResult === 'ok' ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCheck className="w-10 h-10 text-emerald-500" />
          <p className="text-[14px] font-semibold text-emerald-700">הפוסט נשלח לפרסום!</p>
          <p className="text-[11px] text-gray-400">המערכת תפרסם לפי רמת האוטונומיה שהגדרת</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Primary — publish via API (connected accounts) */}
          <button
            onClick={() => handlePublishToSocial('both')}
            disabled={publishing}
            className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white rounded-xl text-[13px] font-semibold hover:bg-indigo-700 transition-all disabled:opacity-60"
          >
            {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {publishing ? 'שולח לפרסום...' : 'פרסם עכשיו — Facebook + Instagram'}
          </button>

          {/* Fallback — manual copy */}
          <div className="flex gap-2">
            <button
              onClick={async () => { await navigator.clipboard.writeText(text).catch(()=>{}); window.open('https://www.instagram.com/', '_blank'); toast.success('הועתק — הדבק באינסטגרם'); }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-gray-200 rounded-xl text-[11px] text-gray-600 hover:bg-gray-50 transition-all"
            >
              📸 העתק + פתח Instagram
            </button>
            <button
              onClick={async () => { await navigator.clipboard.writeText(text).catch(()=>{}); window.open('https://www.facebook.com/', '_blank'); toast.success('הועתק — הדבק בפייסבוק'); }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-gray-200 rounded-xl text-[11px] text-gray-600 hover:bg-gray-50 transition-all"
            >
              👤 העתק + פתח Facebook
            </button>
          </div>

          {/* WhatsApp share */}
          <button
            onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(text + (imageUrl ? `\n\n🖼 תמונה: ${imageUrl}` : ''))}`, '_blank')}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#25D366] text-white rounded-xl text-[12px] font-medium hover:bg-[#1fb855] transition-all"
          >
            💬 שתף ב-WhatsApp
          </button>
        </div>
      )}
    </>
  );

  // ── STEP: Respond (תגובה לביקורת) ──
  const stepRespond = (
    <>
      {/* Original review/mention */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-3">
        <p className="text-[10px] font-semibold text-gray-400 mb-1">הביקורת / האזכור:</p>
        <p className="text-[12px] text-gray-700 leading-relaxed">{signal.summary}</p>
      </div>

      {/* Tone selector */}
      <div className="flex gap-2 mb-2">
        {[
          { key: 'professional', label: 'מקצועי' },
          { key: 'empathetic',   label: 'אמפתי' },
          { key: 'short',        label: 'קצר ופשוט' },
        ].map(t => (
          <button key={t.key}
            onClick={() => handleRegenerateTone(t.key)}
            disabled={toneLoading}
            className="flex-1 py-1.5 rounded-lg border border-gray-200 text-[11px] text-gray-600 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 transition-all disabled:opacity-50">
            {toneLoading ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : t.label}
          </button>
        ))}
      </div>

      <p className="text-[11px] font-semibold text-gray-600 mb-1.5">טקסט תגובה (ניתן לעריכה):</p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={5}
        className="w-full text-[12px] text-gray-800 border border-gray-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
        style={{ fontFamily: 'inherit', lineHeight: 1.6 }}
      />

      <div className="space-y-2 pt-2 border-t border-gray-100 mt-3">
        <button onClick={handleCopy}
          className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-indigo-200 text-indigo-700 rounded-xl text-[13px] font-medium hover:bg-indigo-50 transition-all">
          {copied ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? 'הועתק!' : 'העתק תגובה'}
        </button>
        <button onClick={() => setStep(1)}
          className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-[13px] font-semibold hover:bg-indigo-700 transition-all">
          המשך לשיגור ←
        </button>
      </div>
    </>
  );

  // ── STEP: Respond publish (שיגור תגובה) ──
  const stepRespondPublish = (
    <>
      <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 mb-4 text-[12px] text-gray-700">
        <p className="text-[10px] text-gray-400 mb-1">התגובה שתשלח:</p>
        {text}
      </div>
      <div className="space-y-2">
        {[
          { label: 'Google Reviews', emoji: '🌟', action: () => { handleCopy(); window.open('https://business.google.com/reviews', '_blank'); toast.success('הועתק — הדבק ב-Google'); }},
          { label: 'Facebook', emoji: '👤', action: () => { handleCopy(); window.open('https://www.facebook.com/', '_blank'); toast.success('הועתק — הדבק בפייסבוק'); }},
          { label: 'Instagram DM', emoji: '📸', action: () => { handleCopy(); window.open('https://www.instagram.com/', '_blank'); toast.success('הועתק — שלח ב-DM'); }},
        ].map(p => (
          <button key={p.label} onClick={p.action}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition-all text-[12px] font-medium">
            <span className="text-gray-400 text-[10px]">לחץ לשיגור</span>
            <span className="flex items-center gap-2">{p.emoji} {p.label} ←</span>
          </button>
        ))}
      </div>
      <button onClick={handleCreateTask} disabled={creating}
        className="w-full flex items-center justify-center gap-2 py-2.5 mt-3 border border-gray-200 text-gray-600 rounded-xl text-[12px] hover:bg-gray-50 transition-all disabled:opacity-70">
        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
        {creating ? 'יוצר...' : 'צור משימה מעקב'}
      </button>
    </>
  );

  // ── STEP: Call prep (הכנה לשיחה) ──
  const stepCall = (
    <>
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 mb-3">
        <p className="text-[11px] font-semibold text-indigo-700 mb-1">נושא השיחה:</p>
        <p className="text-[12px] text-indigo-900">{signal.summary}</p>
      </div>

      {/* Call points */}
      {callPoints.length > 0 && (
        <div className="space-y-2 mb-3">
          <p className="text-[11px] font-semibold text-gray-600">נקודות לשיחה:</p>
          {callPoints.map((pt, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2 bg-gray-50 border border-gray-100 rounded-lg">
              <span className="text-indigo-500 text-[11px] font-bold flex-shrink-0">{i + 1}.</span>
              <span className="text-[12px] text-gray-700">{pt}</span>
            </div>
          ))}
        </div>
      )}

      {callPoints.length === 0 && (
        <div className="text-center py-4 mb-3 bg-gray-50 rounded-xl border border-dashed border-gray-200">
          <MessageSquare className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p className="text-[11px] text-gray-400 mb-3">לחץ לקבלת נקודות שיחה מותאמות אישית</p>
          <button onClick={handleGenerateCallPoints} disabled={callPointsLoading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[12px] font-medium hover:bg-indigo-700 transition-all disabled:opacity-70">
            {callPointsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {callPointsLoading ? 'מכין...' : '✨ צור נקודות שיחה עם AI'}
          </button>
        </div>
      )}

      {callPoints.length > 0 && (
        <button onClick={handleGenerateCallPoints} disabled={callPointsLoading}
          className="w-full py-2 border border-gray-200 text-gray-500 rounded-xl text-[11px] hover:bg-gray-50 transition-all mb-3 disabled:opacity-50">
          {callPointsLoading ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : '↻'} עדכן נקודות
        </button>
      )}

      <button onClick={() => setStep(1)}
        className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-[13px] font-semibold hover:bg-indigo-700 transition-all">
        מוכן לשיחה ←
      </button>
    </>
  );

  // ── STEP: Call action (שיגור שיחה) ──
  const stepCallAction = (
    <>
      {callPoints.length > 0 && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 mb-4">
          <p className="text-[10px] text-indigo-500 mb-1.5 font-semibold">נקודות לשיחה:</p>
          {callPoints.map((pt, i) => (
            <p key={i} className="text-[11px] text-indigo-800 mb-1">• {pt}</p>
          ))}
        </div>
      )}
      <div className="space-y-3">
        {meta.phone && (
          <a href={`tel:${meta.phone}`}
            className="w-full flex items-center justify-center gap-3 py-4 bg-green-600 text-white rounded-2xl text-[14px] font-bold hover:bg-green-700 transition-all">
            <Phone className="w-5 h-5" />
            התקשר עכשיו
          </a>
        )}
        {!meta.phone && (
          <div className="w-full flex items-center justify-center gap-3 py-4 bg-gray-100 text-gray-500 rounded-2xl text-[13px]">
            <Phone className="w-5 h-5" />
            מספר טלפון לא זמין — בדוק בפרטי הליד
          </div>
        )}
        <a href={`https://wa.me/${(meta.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(text || signal.recommended_action || '')}`}
          target="_blank" rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2 py-3 bg-[#25D366] text-white rounded-xl text-[13px] font-medium hover:bg-[#1fb855] transition-all">
          💬 שלח WhatsApp קודם
        </a>
      </div>
      <button onClick={() => { setCallDone(true); handleCreateTask(); }}
        disabled={creating}
        className="w-full flex items-center justify-center gap-2 py-2.5 mt-3 border border-gray-200 text-gray-600 rounded-xl text-[12px] hover:bg-gray-50 transition-all disabled:opacity-70">
        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
        סמן שיחה כבוצעה + צור משימה
      </button>
    </>
  );

  // ── STEP: Platform Setup (הגדרת פלטפורמה) ──
  const stepPlatformSetup = platformSetupConfig ? (
    <>
      {/* Platform header */}
      <div className="flex items-center gap-3 mb-4 px-4 py-3 bg-indigo-50 border border-indigo-100 rounded-xl">
        <span className="text-3xl">{platformSetupConfig.icon}</span>
        <div>
          <p className="text-[13px] font-bold text-indigo-800">{platformSetupConfig.platform}</p>
          <p className="text-[11px] text-indigo-500">{signal.summary}</p>
        </div>
      </div>

      {/* Why it matters */}
      {meta.prefilled_text && (
        <div className="mb-4 px-3 py-2.5 bg-amber-50 border border-amber-100 rounded-xl text-[11px] text-amber-800">
          💡 {meta.prefilled_text}
        </div>
      )}

      {/* Step-by-step checklist */}
      <p className="text-[11px] font-semibold text-gray-500 mb-2">סדר פעולות:</p>
      <div className="space-y-2 mb-4">
        {platformSetupConfig.steps.map((step, i) => {
          const done = completedSteps.includes(i);
          return (
            <button
              key={i}
              onClick={() => setCompletedSteps(prev =>
                done ? prev.filter(x => x !== i) : [...prev, i]
              )}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-[12px] text-right transition-all ${
                done
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-white border-gray-200 text-gray-700 hover:border-indigo-300 hover:bg-indigo-50/30'
              }`}
            >
              <span className={`w-6 h-6 flex-shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                done ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-400'
              }`}>
                {done ? '✓' : i + 1}
              </span>
              <span className={done ? 'line-through opacity-60' : ''}>{step}</span>
            </button>
          );
        })}
      </div>

      {/* Progress indicator */}
      {completedSteps.length > 0 && (
        <div className="mb-3 px-3 py-2 bg-gray-50 rounded-xl">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-500">התקדמות</span>
            <span className="text-[10px] font-semibold text-indigo-600">{completedSteps.length}/{platformSetupConfig.steps.length}</span>
          </div>
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all"
              style={{ width: `${(completedSteps.length / platformSetupConfig.steps.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Primary CTA — open platform */}
      <a
        href={platformSetupConfig.url}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white rounded-xl text-[13px] font-semibold hover:bg-indigo-700 transition-all mb-2"
      >
        {platformSetupConfig.icon} פתח {platformSetupConfig.platform}
      </a>

      {/* Mark done */}
      <button
        onClick={handleCreateTask}
        disabled={creating}
        className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-[12px] hover:bg-gray-50 transition-all disabled:opacity-70"
      >
        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
        {creating ? 'יוצר...' : 'צור משימה מעקב'}
      </button>
    </>
  ) : null;

  // Dynamic step content array based on action type
  const stepContents = (() => {
    if (actionType === 'platform_setup') return [stepPlatformSetup];
    if (actionType === 'respond') return [stepRespond, stepRespondPublish];
    if (actionType === 'call')    return [stepCall, stepCallAction];
    // social_post / promote / task — full 4-step flow
    return [stepContent, stepImage, stepAudience, stepPublish];
  })();

  // FIX 6: render at document.body via portal so position:fixed is never broken
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col"
        style={{ direction: 'rtl', maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-xl">{config.icon}</span>
            <div>
              <p className="text-[13px] font-semibold text-gray-800">{config.label}</p>
              <p className="text-[11px] text-gray-400">⏱ {timeMinutes} דקות</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 flex-1 overflow-y-auto">
          {/* Urgency Banner — shown when high impact or urgent time window */}
          {(signal.impact_level === 'high' || (meta.urgency_hours && meta.urgency_hours <= 6)) && (
            <div className="flex items-center gap-2 px-3 py-2 mb-3 bg-red-50 border border-red-100 rounded-xl text-[11px] text-red-700">
              <span className="flex-shrink-0">🔴</span>
              <span>
                {meta.urgency_hours
                  ? `פעולה נדרשת תוך ${meta.urgency_hours} שעות`
                  : 'השפעה גבוהה — פעל עכשיו'}
              </span>
              {meta.impact_reason && (
                <span className="text-red-400 text-[10px] mr-auto truncate">{meta.impact_reason}</span>
              )}
            </div>
          )}
          {stepBar}
          {done ? (
            <div className="text-center py-4">
              <p className="text-[13px] font-semibold text-green-600">✓ הפעולה בוצעה בהצלחה!</p>
              <button onClick={onClose} className="mt-2 text-[11px] text-gray-400 underline hover:text-gray-600">סגור</button>
            </div>
          ) : (
            stepContents[step]
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
