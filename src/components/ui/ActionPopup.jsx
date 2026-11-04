import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
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
  platform_setup:        { label: 'הגדרת פלטפורמה דיגיטלית', icon: '🔧' },
  competitor_response:   { label: 'תגובה לשינוי מתחרה',       icon: '⚔️' },
  retention_whatsapp:    { label: 'החזרת לקוח ישן',            icon: '💬' },
  pricing_adjustment:    { label: 'עדכון מחיר / תפריט',        icon: '💰' },
};

// Per-type step definitions
const STEPS_BY_TYPE = {
  social_post:    ['תוכן', 'תמונה', 'קהל', 'פרסם'],
  promote:        ['מבצע',  'תמונה', 'קהל', 'פרסם'],
  respond:        ['תגובה', 'שיגור'],
  call:           ['הכנה',  'שיחה'],
  task:           ['פרטים', 'בצע'],
  platform_setup:       ['הגדרה'],
  competitor_response:  ['ניתוח', 'סיום'],
  retention_whatsapp:   ['הודעה', 'שלח'],
  pricing_adjustment:   ['השוואה', 'פעולה'],
};

// Image generation is handled server-side via base44.functions.invoke('generateImage')
// to avoid CORS/403 issues with third-party APIs from the browser.

export default function ActionPopup({ signal, businessProfile, onClose }) {
  const navigate = useNavigate();

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
  const [imagePlatform,    setImagePlatform]    = useState('instagram_post');
  const [imageUrl,         setImageUrl]         = useState(null);
  const [imageProvider,    setImageProvider]    = useState(null); // 'imagen3'|'flux1'
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

  // Competitor response + pricing adjustment — chosen action
  const [compResponseChoice,  setCompResponseChoice]  = useState(null); // 'adjust_price'|'counter_promo'|'monitor'|'task'|'campaign'|'whatsapp'
  // Retention whatsapp — AI message
  const [retentionMsg,        setRetentionMsg]        = useState('');
  const [retentionMsgLoading, setRetentionMsgLoading] = useState(false);

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
    setCompResponseChoice(null);
    setRetentionMsg('');
    setRetentionMsgLoading(false);

    // For social posts: kick off the multi-brain pipeline automatically
    if (['social_post', 'promote'].includes(rawActionType)) {
      runSmartGeneration();
    }
    if (rawActionType === 'retention_whatsapp') {
      generateRetentionMessage();
    }
  }, [signal.id]);

  // ── Multi-brain: Claude audience + GPT post + Gemini Imagen 3 / Flux.1 image ──
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
        platform:          imagePlatform,
      });
      const imgData = imgRes?.data || imgRes;
      if (imgData?.url) {
        setImageUrl(imgData.url);
        setImageProvider(imgData.provider || 'stock');
        setImageIsStock(false); // only AI-generated images — never stock
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
      const toneGuide = tone === 'professional'
        ? 'מקצועי ואמין — ללא אמוג\'י, משפטים מדויקים, הכרה בבעיה + הצעת פתרון ספציפי'
        : tone === 'empathetic'
        ? 'אמפתי וחם — הכרה מלאה בתחושת הלקוח, פנייה אישית בשם, הזמנה לשיחה ישירה'
        : 'קצר וישיר — 2 משפטים בלבד: הכרה + פתרון. ללא מלל מיותר.';
      const result = await base44.integrations.Core.InvokeLLM({
        model: 'sonnet',
        maxTokens: 350,
        prompt: `אתה מנהל מוניטין מקצועי לעסקים ישראלים. כתוב תגובה שתהפוך לקוח ממורמר ללקוח חוזר.

עסק: "${businessProfile?.name || ''}" | תחום: ${businessProfile?.category || ''}
ביקורת: "${signal.summary}"
סגנון נדרש: ${toneGuide}

חוקים:
- פנה בשם אם ידוע
- הכר בדיוק בנקודה הספציפית שציינו — לא תגובה גנרית
- הצע פתרון קונקרטי / הזמן לפנות ישירות
- 2-4 משפטים, ללא תירוצים
כתוב רק את טקסט התגובה הסופי.`,
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
        model: 'sonnet',
        maxTokens: 300,
        prompt: `אתה מאמן מכירות לעסקים קטנים ישראלים. צור 4 נקודות שיחה ממוקדות שיובילו לסגירה או לפתרון.

עסק: "${businessProfile?.name || ''}" | תחום: ${businessProfile?.category || ''}
נושא השיחה: ${signal.summary}
מטרה: ${signal.recommended_action || actionLabel}

כל נקודה: פועל ציווי + תוכן ספציפי (לא "בדוק מצב" — אלא "שאל: האם [שאלה ספציפית]?").
4 נקודות בלבד, כל אחת בשורה נפרדת, ללא מספור.`,
      });
      if (typeof result === 'string') {
        setCallPoints(result.trim().split('\n').filter(Boolean).slice(0, 4));
        toast.success('נקודות השיחה מוכנות');
      }
    } catch { toast.error('שגיאה — נסה שוב'); }
    setCallPointsLoading(false);
  }

  // ── Generate WhatsApp retention message ──
  async function generateRetentionMessage() {
    if (!businessProfile?.id) return;
    setRetentionMsgLoading(true);
    const fallback = `שלום! 😊\nלא ראינו אותך אצלנו זמן מה — מתגעגעים!\nיש לנו חדשות ומבצעים שיעניינו אותך.\nמוזמן/ת לבקר — נשמח לראותך! 🙌`;
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        model: 'sonnet',
        maxTokens: 280,
        prompt: `אתה מומחה לשימור לקוחות בעסקים קטנים ישראלים. כתוב הודעת WhatsApp שתגרום ללקוח לחזור — אנושית, ולא נראית כמו ספאם.

עסק: "${businessProfile?.name || ''}" | תחום: ${businessProfile?.category || ''}
הקשר: ${signal.summary}

מבנה ההודעה (3-4 שורות):
- שורה 1: פנייה אישית חמה עם שם (אם ידוע) + תחושה שחסרת אותם
- שורה 2: סיבה ספציפית לחזור עכשיו (עדכון / מבצע / מוצר חדש — קשור לתחום)
- שורה 3: CTA ברור וקל (הודעה / הזמנה / ביקור)
עברית טבעית, עם אמוג'י בצנעה. ללא "שלום לקוח יקר".
כתוב רק את ההודעה הסופית.`,
      });
      setRetentionMsg((typeof result === 'string' && result.trim()) ? result.trim() : fallback);
    } catch {
      setRetentionMsg(fallback);
    }
    setRetentionMsgLoading(false);
  }

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Generate image — server-side endpoint (Gemini Imagen 3 → Flux.1) ──
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
        platform:          imagePlatform,
      });
      const data = res?.data || res;
      if (!data?.url) throw new Error('לא התקבלה תמונה מהשרת');
      setImageUrl(data.url);
      setImageProvider(data.provider || 'stock');
      setImageIsStock(false); // only AI-generated images — never stock
      setAltPhotos(Array.isArray(data.alt_photos) ? data.alt_photos.filter(Boolean) : []);
      setStep(1);
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
        description: `[signal:${signal.id}]\n${text}\n\nמקור: ${signal.summary}`,
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
            i <= step ? 'bg-primary' : 'bg-secondary'
          }`} />
          <span className={`text-[9px] font-medium transition-colors ${
            i === step ? 'text-primary' : i < step ? 'text-foreground-muted/70' : 'text-border'
          }`}>{label}</span>
        </button>
      ))}
    </div>
  );

  const SMART_PHASE_LABELS = {
    analyzing: 'Claude מנתח קהל יעד...',
    writing:   'GPT-4o כותב פוסט...',
    imaging:   'Imagen 3 יוצר תמונה...',
  };

  // ── STEP 0: Content ──
  const stepContent = (
    <>
      {/* Multi-brain progress bar */}
      {smartPhase && smartPhase !== 'ready' && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-primary/8 rounded-xl border border-primary/15">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary/70 flex-shrink-0" />
          <span className="text-[11px] text-primary">{SMART_PHASE_LABELS[smartPhase]}</span>
          <div className="flex gap-1 mr-auto">
            {['analyzing','writing','imaging'].map((p, i) => (
              <div key={p} className={`w-1.5 h-1.5 rounded-full transition-colors ${
                ['analyzing','writing','imaging','ready'].indexOf(smartPhase) >= i
                  ? 'bg-primary' : 'bg-primary/15'
              }`} />
            ))}
          </div>
        </div>
      )}

      {/* Smart audience context when ready */}
      {smartPhase === 'ready' && smartAudience && (
        <div className="flex items-center gap-2 mb-1.5 px-3 py-1.5 bg-primary/8 rounded-xl border border-primary/15">
          <span className="text-[10px] text-primary">👥 {smartAudience.age_range} · {smartAudience.gender} · {smartAudience.preferred_channel}</span>
          <span className="text-[9px] text-primary/50 mr-auto">Claude Sonnet</span>
        </div>
      )}
      {/* Best posting time */}
      {smartPhase === 'ready' && smartAudience?.best_time && (
        <div className="flex items-center gap-1.5 mb-2 px-3 py-1 text-[10px] text-primary/70">
          <span>⏰</span>
          <span>זמן אידיאלי לפרסום: {smartAudience.best_time}</span>
        </div>
      )}

      {/* Signal context */}
      <div className="bg-primary/8 border border-primary/15 rounded-xl px-4 py-3 mb-3">
        <p className="text-[11px] font-semibold text-primary mb-1">התובנה:</p>
        <p className="text-[12px] text-foreground">{signal.summary}</p>
      </div>

      {(!smartPhase || smartPhase === 'ready') && (
        <p className="text-[11px] font-semibold text-foreground-secondary mb-1.5">
          {isSocialType
            ? (smartPhase === 'ready' ? 'טקסט מוכן לפרסום — GPT-4o (ניתן לעריכה):' : 'טקסט מוכן לפרסום (ניתן לעריכה):')
            : 'פרטי הפעולה:'}
        </p>
      )}

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={5}
        className="w-full text-[12px] text-foreground border border-border rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
        style={{ fontFamily: 'inherit', lineHeight: 1.6 }}
      />

      {/* Smart hashtags */}
      {smartPhase === 'ready' && smartHashtags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {smartHashtags.map((tag, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 bg-primary/8 text-primary rounded-full border border-primary/15">{tag}</span>
          ))}
        </div>
      )}

      {/* CTA */}
      {smartPhase === 'ready' && smartCta && (
        <p className="text-[10px] text-primary/70 font-medium mt-1.5">
          📣 {smartCta}
        </p>
      )}

      {/* Inline image error banner */}
      {imageError && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 mb-2 bg-red-50 border border-red-100 rounded-xl text-[11px] text-red-700">
          <span>{imageError}</span>
          <button
            onClick={handleGenerateImage}
            disabled={imageLoading}
            className="flex-shrink-0 text-[10px] underline hover:no-underline disabled:opacity-50 disabled:cursor-not-allowed"
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
          className="flex flex-col items-center gap-1.5 py-2.5 px-2 border border-border rounded-xl text-[11px] hover:bg-secondary/50 hover:border-border-hover transition-all disabled:opacity-50"
        >
          {imageLoading
            ? <Loader2 className="w-4 h-4 animate-spin text-primary/70" />
            : <Image className="w-4 h-4 text-foreground-muted" />}
          <span className="text-foreground-secondary">{imageLoading ? 'מייצר...' : 'צור תמונה'}</span>
        </button>
        <button
          onClick={handleLoadAudience}
          disabled={audienceLoading}
          className="flex flex-col items-center gap-1.5 py-2.5 px-2 border border-border rounded-xl text-[11px] hover:bg-secondary/50 hover:border-border-hover transition-all disabled:opacity-50"
        >
          {audienceLoading
            ? <Loader2 className="w-4 h-4 animate-spin text-primary/70" />
            : <Users className="w-4 h-4 text-foreground-muted" />}
          <span className="text-foreground-secondary">{audienceLoading ? 'טוען...' : 'קהל יעד'}</span>
        </button>
        <button
          onClick={() => setStep(STEPS.length - 1)}
          className="flex flex-col items-center gap-1.5 py-2.5 px-2 bg-primary text-white rounded-xl text-[11px] hover:bg-primary/90 transition-all"
        >
          <Send className="w-4 h-4" />
          <span>פרסם</span>
        </button>
      </div>

      {/* Copy + create task */}
      <div className="space-y-2 pt-2 border-t border-border/60 mt-3">
        {isSocialType && (
          <button onClick={handleCopy}
            className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-primary/20 text-primary rounded-xl text-[13px] font-medium hover:bg-primary/8 transition-all">
            {copied ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'הועתק!' : 'העתק טקסט'}
          </button>
        )}
        <button onClick={handleCreateTask} disabled={creating}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-white rounded-xl text-[13px] font-semibold hover:bg-primary/90 transition-all disabled:opacity-70">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
          {creating ? 'יוצר משימה...' : 'צור משימה ועקוב'}
        </button>
      </div>
    </>
  );

  const PLATFORM_OPTIONS = [
    { key: 'instagram_post',     label: 'Instagram',  sub: '1:1',   icon: '📷' },
    { key: 'instagram_portrait', label: 'פורטרט',     sub: '4:5',   icon: '🖼' },
    { key: 'instagram_story',    label: 'סטורי',      sub: '9:16',  icon: '📱' },
    { key: 'facebook',           label: 'Facebook',   sub: '4:3',   icon: '🌐' },
    { key: 'tiktok',             label: 'TikTok',     sub: '9:16',  icon: '🎵' },
  ];

  // aspect-ratio CSS value per platform (for the preview container)
  const PLATFORM_ASPECT_CSS = {
    instagram_post:     '1 / 1',
    instagram_portrait: '4 / 5',
    instagram_story:    '9 / 16',
    facebook:           '4 / 3',
    tiktok:             '9 / 16',
    facebook_landscape: '16 / 9',
  };

  // ── STEP 1: Image ──
  const stepImage = (
    <>
      <div className="mb-3">
        {/* Platform picker */}
        <p className="text-[11px] font-semibold text-foreground-muted mb-1.5">פלטפורמה ופורמט</p>
        <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
          {PLATFORM_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => {
                if (opt.key !== imagePlatform) {
                  setImagePlatform(opt.key);
                  setImageUrl(null); // clear old image — wrong aspect ratio
                }
              }}
              className={`flex-shrink-0 flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg border text-[10px] transition-all ${
                imagePlatform === opt.key
                  ? 'bg-primary/8 border-primary/40 text-primary font-semibold'
                  : 'border-border text-foreground-secondary hover:bg-secondary/50'
              }`}
            >
              <span>{opt.icon}</span>
              <span>{opt.label}</span>
              <span className="text-[9px] opacity-70">{opt.sub}</span>
            </button>
          ))}
        </div>

        <p className="text-[12px] font-semibold text-foreground-secondary mb-2">תמונה שיווקית — נוצרה על ידי AI</p>

        {/* Loading state */}
        {imageLoading && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 mb-3 bg-secondary/50 rounded-xl border border-border/60">
            <Loader2 className="w-6 h-6 animate-spin text-primary/70" />
            <span className="text-[11px] text-foreground-muted">יוצר תמונה... (עד 30 שניות)</span>
          </div>
        )}

        {/* Error state */}
        {!imageLoading && imageError && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 mb-3 bg-red-50 border border-red-100 rounded-xl text-[11px] text-red-700">
            <span>{imageError}</span>
            <button onClick={handleGenerateImage} disabled={imageLoading} className="flex-shrink-0 text-[10px] underline hover:no-underline disabled:opacity-50 disabled:cursor-not-allowed">
              נסה שוב
            </button>
          </div>
        )}

        {/* Image */}
        {!imageLoading && imageUrl && (
          <div className="relative mb-3">
            <div
              className="w-full rounded-xl border border-border/60 overflow-hidden bg-secondary/50"
              style={{ aspectRatio: PLATFORM_ASPECT_CSS[imagePlatform] || '1 / 1', maxHeight: 320 }}
            >
              <img
                src={imageUrl}
                alt="marketing image"
                className="w-full h-full object-cover"
                onError={() => {
                  setImageUrl(null);
                  setImageError('התמונה לא נטענה — נסה שוב');
                }}
              />
            </div>
            {/* AI provider badge */}
            {imageProvider && (
              <span className="absolute bottom-2 right-2 text-[9px] font-medium px-1.5 py-0.5 rounded bg-black/60 text-white">
                {imageProvider === 'imagen3' ? '✦ Google Imagen 3' : imageProvider === 'flux1' ? '✦ Flux AI' : '✦ AI'}
              </span>
            )}
            {/* Regenerate overlay */}
            <button
              onClick={handleGenerateImage}
              disabled={imageLoading}
              className="absolute top-2 left-2 text-[10px] px-2 py-1 rounded-md bg-black/55 text-white hover:bg-black/75 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ↻ צור מחדש
            </button>
          </div>
        )}

        {/* Soft notice — image generation unavailable */}
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
                className="flex-shrink-0 w-14 h-10 rounded-lg overflow-hidden border-2 border-transparent hover:border-primary/40 transition-all"
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
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-border rounded-xl text-[12px] hover:bg-secondary/50 transition-all disabled:opacity-50"
          >
            {imageLoading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary/70" />
              : <Sparkles className="w-3.5 h-3.5 text-foreground-muted" />}
            {imageLoading ? 'יוצר...' : '↻ תמונה חדשה'}
          </button>

          <button
            onClick={() => {
              setShowCustomPrompt(v => !v);
              setTimeout(() => customPromptRef.current?.focus(), 60);
            }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] transition-all border ${
              showCustomPrompt
                ? 'bg-primary/8 border-primary/40 text-primary'
                : 'border-border text-foreground-secondary hover:bg-secondary/50'
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
              className="w-full text-[12px] text-foreground border border-border rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 bg-secondary/50 placeholder-gray-400"
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
          className="w-full py-2.5 bg-primary text-white rounded-xl text-[12px] font-medium hover:bg-primary/90 transition-all">
          המשך לפרסום ←
        </button>
      </div>
      <p className="text-[10px] text-foreground-muted/70 text-center">תמונה AI חינמית — הורד ושמור לפני פרסום</p>
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
          <p className="text-[12px] font-semibold text-foreground-secondary">
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
              <div className="bg-primary/8 border border-primary/15 rounded-xl px-4 py-3">
                <p className="text-[13px] font-bold text-foreground mb-0.5">{audience.headline}</p>
                <p className="text-[11px] text-primary">
                  {audience.age_range} · {audience.gender} · {audience.best_channel} · {audience.best_time}
                </p>
              </div>
              {audience.why_this_insight_matters && (
                <div className="bg-secondary/50 rounded-xl px-3 py-2.5 border border-border/60">
                  <p className="text-[10px] text-foreground-muted/70 mb-1">למה התובנה הזו רלוונטית לקהל</p>
                  <p className="text-[12px] text-foreground-secondary">{audience.why_this_insight_matters}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'כאב מרכזי', value: audience.pain_point },
                  { label: 'גודל קהל',  value: audience.estimated_size },
                ].map(item => (
                  <div key={item.label} className="bg-secondary/50 rounded-lg px-3 py-2 border border-border/60">
                    <p className="text-[10px] text-foreground-muted/70 mb-0.5">{item.label}</p>
                    <p className="text-[11px] text-foreground-secondary">{item.value}</p>
                  </div>
                ))}
              </div>
              {audience.keywords?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {audience.keywords.map((kw, j) => (
                    <span key={j} className="text-[10px] px-2 py-0.5 bg-primary/8 text-primary rounded-full border border-primary/15">
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
                <div key={i} className="border border-border/60 rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-primary">{seg.segment_name}</span>
                    <span className="text-[10px] text-foreground-muted/70">{seg.age_min}–{seg.age_max} | {seg.genders || seg.age_range}</span>
                  </div>
                  <p className="text-[10px] text-foreground-secondary mb-2">{seg.description}</p>
                  {/* Facebook interests */}
                  {seg.facebook_targeting?.interests?.length > 0 && (
                    <div className="mb-1.5">
                      <p className="text-[9px] text-foreground-muted/70 mb-0.5">📘 FB Interests</p>
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
                      <p className="text-[9px] text-foreground-muted/70 mb-0.5">🔍 Google Keywords</p>
                      <div className="flex flex-wrap gap-1">
                        {seg.google_targeting.keywords.slice(0, 3).map((kw, j) => (
                          <span key={j} className="text-[9px] px-1.5 py-0.5 bg-green-50 text-green-700 rounded-full border border-green-100">{kw}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 text-[9px] text-foreground-muted/70 mt-1">
                    {seg.estimated_audience_range && <span>👥 {seg.estimated_audience_range}</span>}
                    <span>המרה: {Math.round((seg.conversion_probability || 0) * 100)}%</span>
                    {seg.best_posting_time && <span>⏰ {seg.best_posting_time}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!audience && (!segments || segments.length === 0) && (
            <div className="text-center py-6 text-[12px] text-foreground-muted/70">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
              אין מספיק נתונים לפילוח עדיין
            </div>
          )}
        </>
      )}

      <button onClick={() => setStep(STEPS.length - 1)}
        className="w-full py-2.5 bg-primary text-white rounded-xl text-[12px] font-medium hover:bg-primary/90 transition-all">
        פרסם לקהל הזה ←
      </button>
    </>
  );

  // ── STEP 3: Publish ──
  const stepPublish = (
    <>
      {segments?.[0] && (
        <div className="bg-primary/8 border border-primary/15 rounded-xl px-3 py-2 mb-3 text-[11px] text-foreground">
          👥 קהל מומלץ: {segments[0].segment_name}
          {segments[0].preferred_channels?.[0] && ` — דרך ${segments[0].preferred_channels[0]}`}
        </div>
      )}
      {imageUrl && (
        <div className="mb-3">
          <img src={imageUrl} alt="marketing" className="w-full rounded-lg object-cover" style={{ maxHeight: 120 }} />
          <a href={imageUrl} download className="text-[10px] text-primary/70 hover:underline mt-1 block text-center">⬇ הורד תמונה</a>
        </div>
      )}

      {/* Preview */}
      <div className="bg-secondary/50 border border-border/60 rounded-xl px-4 py-3 mb-3 text-[12px] text-foreground-secondary leading-relaxed">
        {text}
      </div>

      {publishResult === 'ok' ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCheck className="w-10 h-10 text-emerald-500" />
          <p className="text-[14px] font-semibold text-emerald-700">הפוסט נשלח לפרסום!</p>
          <p className="text-[11px] text-foreground-muted/70">המערכת תפרסם לפי רמת האוטונומיה שהגדרת</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Primary — publish via API (connected accounts) */}
          <button
            onClick={() => handlePublishToSocial('both')}
            disabled={publishing}
            className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-xl text-[13px] font-semibold hover:bg-primary/90 transition-all disabled:opacity-60"
          >
            {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {publishing ? 'שולח לפרסום...' : 'פרסם עכשיו — Facebook + Instagram'}
          </button>

          {/* Fallback — manual copy */}
          <div className="flex gap-2">
            <button
              onClick={async () => { await navigator.clipboard.writeText(text).catch(()=>{}); window.open('https://www.instagram.com/', '_blank'); toast.success('הועתק — הדבק באינסטגרם'); }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-border rounded-xl text-[11px] text-foreground-secondary hover:bg-secondary/50 transition-all"
            >
              📸 העתק + פתח Instagram
            </button>
            <button
              onClick={async () => { await navigator.clipboard.writeText(text).catch(()=>{}); window.open('https://www.facebook.com/', '_blank'); toast.success('הועתק — הדבק בפייסבוק'); }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-border rounded-xl text-[11px] text-foreground-secondary hover:bg-secondary/50 transition-all"
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
      <div className="bg-secondary/50 border border-border rounded-xl px-4 py-3 mb-3">
        <p className="text-[10px] font-semibold text-foreground-muted/70 mb-1">הביקורת / האזכור:</p>
        <p className="text-[12px] text-foreground-secondary leading-relaxed">{signal.summary}</p>
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
            className="flex-1 py-1.5 rounded-lg border border-border text-[11px] text-foreground-secondary hover:bg-primary/8 hover:border-primary/30 hover:text-primary transition-all disabled:opacity-50">
            {toneLoading ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : t.label}
          </button>
        ))}
      </div>

      <p className="text-[11px] font-semibold text-foreground-secondary mb-1.5">טקסט תגובה (ניתן לעריכה):</p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={5}
        className="w-full text-[12px] text-foreground border border-border rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
        style={{ fontFamily: 'inherit', lineHeight: 1.6 }}
      />

      <div className="space-y-2 pt-2 border-t border-border/60 mt-3">
        <button onClick={handleCopy}
          className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-primary/20 text-primary rounded-xl text-[13px] font-medium hover:bg-primary/8 transition-all">
          {copied ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? 'הועתק!' : 'העתק תגובה'}
        </button>
        <button onClick={() => setStep(1)}
          className="w-full py-2.5 bg-primary text-white rounded-xl text-[13px] font-semibold hover:bg-primary/90 transition-all">
          המשך לשיגור ←
        </button>
      </div>
    </>
  );

  // ── STEP: Respond publish (שיגור תגובה) ──
  const stepRespondPublish = (
    <>
      <div className="bg-secondary/50 border border-border/60 rounded-xl px-4 py-3 mb-4 text-[12px] text-foreground-secondary">
        <p className="text-[10px] text-foreground-muted/70 mb-1">התגובה שתשלח:</p>
        {text}
      </div>
      <div className="space-y-2">
        {[
          { label: 'Google Reviews', emoji: '🌟', action: () => { handleCopy(); window.open('https://business.google.com/reviews', '_blank'); toast.success('הועתק — הדבק ב-Google'); }},
          { label: 'Facebook', emoji: '👤', action: () => { handleCopy(); window.open('https://www.facebook.com/', '_blank'); toast.success('הועתק — הדבק בפייסבוק'); }},
          { label: 'Instagram DM', emoji: '📸', action: () => { handleCopy(); window.open('https://www.instagram.com/', '_blank'); toast.success('הועתק — שלח ב-DM'); }},
        ].map(p => (
          <button key={p.label} onClick={p.action}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-border hover:border-primary/30 hover:bg-primary/5 transition-all text-[12px] font-medium">
            <span className="text-foreground-muted/70 text-[10px]">לחץ לשיגור</span>
            <span className="flex items-center gap-2">{p.emoji} {p.label} ←</span>
          </button>
        ))}
      </div>
      <button onClick={handleCreateTask} disabled={creating}
        className="w-full flex items-center justify-center gap-2 py-2.5 mt-3 border border-border text-foreground-secondary rounded-xl text-[12px] hover:bg-secondary/50 transition-all disabled:opacity-70">
        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
        {creating ? 'יוצר...' : 'צור משימה מעקב'}
      </button>
    </>
  );

  // ── STEP: Call prep (הכנה לשיחה) ──
  const stepCall = (
    <>
      <div className="bg-primary/8 border border-primary/15 rounded-xl px-4 py-3 mb-3">
        <p className="text-[11px] font-semibold text-primary mb-1">נושא השיחה:</p>
        <p className="text-[12px] text-foreground">{signal.summary}</p>
      </div>

      {/* Call points */}
      {callPoints.length > 0 && (
        <div className="space-y-2 mb-3">
          <p className="text-[11px] font-semibold text-foreground-secondary">נקודות לשיחה:</p>
          {callPoints.map((pt, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2 bg-secondary/50 border border-border/60 rounded-lg">
              <span className="text-primary/70 text-[11px] font-bold flex-shrink-0">{i + 1}.</span>
              <span className="text-[12px] text-foreground-secondary">{pt}</span>
            </div>
          ))}
        </div>
      )}

      {callPoints.length === 0 && (
        <div className="text-center py-4 mb-3 bg-secondary/50 rounded-xl border border-dashed border-border">
          <MessageSquare className="w-8 h-8 mx-auto mb-2 text-foreground-muted/50" />
          <p className="text-[11px] text-foreground-muted/70 mb-3">לחץ לקבלת נקודות שיחה מותאמות אישית</p>
          <button onClick={handleGenerateCallPoints} disabled={callPointsLoading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-[12px] font-medium hover:bg-primary/90 transition-all disabled:opacity-70">
            {callPointsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {callPointsLoading ? 'מכין...' : '✨ צור נקודות שיחה עם AI'}
          </button>
        </div>
      )}

      {callPoints.length > 0 && (
        <button onClick={handleGenerateCallPoints} disabled={callPointsLoading}
          className="w-full py-2 border border-border text-foreground-muted rounded-xl text-[11px] hover:bg-secondary/50 transition-all mb-3 disabled:opacity-50">
          {callPointsLoading ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : '↻'} עדכן נקודות
        </button>
      )}

      <button onClick={() => setStep(1)}
        className="w-full py-2.5 bg-primary text-white rounded-xl text-[13px] font-semibold hover:bg-primary/90 transition-all">
        מוכן לשיחה ←
      </button>
    </>
  );

  // ── STEP: Call action (שיגור שיחה) ──
  const stepCallAction = (
    <>
      {callPoints.length > 0 && (
        <div className="bg-primary/8 border border-primary/15 rounded-xl px-4 py-3 mb-4">
          <p className="text-[10px] text-primary/70 mb-1.5 font-semibold">נקודות לשיחה:</p>
          {callPoints.map((pt, i) => (
            <p key={i} className="text-[11px] text-foreground mb-1">• {pt}</p>
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
          <div className="w-full flex items-center justify-center gap-3 py-4 bg-secondary text-foreground-muted rounded-2xl text-[13px]">
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
        className="w-full flex items-center justify-center gap-2 py-2.5 mt-3 border border-border text-foreground-secondary rounded-xl text-[12px] hover:bg-secondary/50 transition-all disabled:opacity-70">
        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
        סמן שיחה כבוצעה + צור משימה
      </button>
    </>
  );

  // ── STEP: Platform Setup (הגדרת פלטפורמה) ──
  const stepPlatformSetup = platformSetupConfig ? (
    <>
      {/* Platform header */}
      <div className="flex items-center gap-3 mb-4 px-4 py-3 bg-primary/8 border border-primary/15 rounded-xl">
        <span className="text-3xl">{platformSetupConfig.icon}</span>
        <div>
          <p className="text-[13px] font-bold text-foreground">{platformSetupConfig.platform}</p>
          <p className="text-[11px] text-primary/70">{signal.summary}</p>
        </div>
      </div>

      {/* Why it matters */}
      {meta.prefilled_text && (
        <div className="mb-4 px-3 py-2.5 bg-amber-50 border border-amber-100 rounded-xl text-[11px] text-amber-800">
          💡 {meta.prefilled_text}
        </div>
      )}

      {/* Step-by-step checklist */}
      <p className="text-[11px] font-semibold text-foreground-muted mb-2">סדר פעולות:</p>
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
                  : 'bg-white border-border text-foreground-secondary hover:border-primary/30 hover:bg-primary/4'
              }`}
            >
              <span className={`w-6 h-6 flex-shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                done ? 'bg-emerald-500 text-white' : 'bg-secondary text-foreground-muted/70'
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
        <div className="mb-3 px-3 py-2 bg-secondary/50 rounded-xl">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-foreground-muted">התקדמות</span>
            <span className="text-[10px] font-semibold text-primary">{completedSteps.length}/{platformSetupConfig.steps.length}</span>
          </div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
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
        className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-xl text-[13px] font-semibold hover:bg-primary/90 transition-all mb-2"
      >
        {platformSetupConfig.icon} פתח {platformSetupConfig.platform}
      </a>

      {/* Mark done */}
      <button
        onClick={handleCreateTask}
        disabled={creating}
        className="w-full flex items-center justify-center gap-2 py-2.5 border border-border text-foreground-secondary rounded-xl text-[12px] hover:bg-secondary/50 transition-all disabled:opacity-70"
      >
        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
        {creating ? 'יוצר...' : 'צור משימה מעקב'}
      </button>
    </>
  ) : null;

  // ── STEP: Competitor Response (תגובה לשינוי מתחרה) ──
  const COMP_OPTIONS = [
    { key: 'adjust_price',  emoji: '💰', label: 'התאם מחיר בהתאם',     desc: 'צור משימה לעדכון מחיר תוך 3 ימים' },
    { key: 'counter_promo', emoji: '🎯', label: 'השק מבצע נגדי',        desc: 'צור קמפיין עם הצעה מתחרה' },
    { key: 'monitor',       emoji: '👁️', label: 'עקוב ואל תגיב עדיין', desc: 'צור משימה לעקוב שבוע נוסף' },
  ];

  const stepCompetitorResponse = (
    <>
      <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 mb-4">
        <p className="text-[11px] font-semibold text-orange-700 mb-1">מה השתנה אצל המתחרה:</p>
        <p className="text-[12px] text-orange-900">{signal.summary}</p>
      </div>
      <p className="text-[11px] font-semibold text-foreground-secondary mb-2">בחר את תגובת העסק:</p>
      <div className="space-y-2 mb-4">
        {COMP_OPTIONS.map(opt => (
          <button key={opt.key} onClick={() => setCompResponseChoice(opt.key)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-right transition-all ${
              compResponseChoice === opt.key
                ? 'bg-primary/8 border-primary/40'
                : 'bg-white border-border hover:border-primary/30 hover:bg-primary/4'
            }`}>
            <span className="text-xl">{opt.emoji}</span>
            <div>
              <p className="text-[13px] font-semibold text-foreground">{opt.label}</p>
              <p className="text-[11px] text-foreground-muted">{opt.desc}</p>
            </div>
          </button>
        ))}
      </div>
      <button
        onClick={async () => {
          if (!compResponseChoice) { toast.error('בחר פעולה'); return; }
          if (compResponseChoice === 'counter_promo') {
            onClose();
            navigate(`/marketing/create?context=counter_promo&signalId=${signal.id}`);
            return;
          }
          const taskTitle = compResponseChoice === 'adjust_price'
            ? `לעדכן מחיר בהתאם למתחרה — ${(signal.summary || '').slice(0, 60)}`
            : `לעקוב אחרי מתחרה שבוע נוסף — ${(signal.summary || '').slice(0, 60)}`;
          setCreating(true);
          try {
            await base44.entities.Task.create({
              title: taskTitle,
              description: `[signal:${signal.id}]\n${signal.summary}`,
              status: 'pending',
              priority: 'high',
              source_type: 'alert',
              linked_business: businessProfile?.id || '',
            });
            toast.success('המשימה נוצרה ✓');
            setStep(1);
          } catch { toast.error('שגיאה ביצירת המשימה'); }
          setCreating(false);
        }}
        disabled={creating || !compResponseChoice}
        className="w-full py-2.5 bg-primary text-white rounded-xl text-[13px] font-semibold hover:bg-primary/90 transition-all disabled:opacity-50"
      >
        {creating ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
        בצע פעולה ←
      </button>
    </>
  );

  const stepCompetitorResponseDone = (
    <div className="text-center py-6">
      <div className="text-4xl mb-3">✅</div>
      <p className="text-[14px] font-semibold text-foreground mb-2">
        {compResponseChoice === 'counter_promo' ? 'מועבר לבניית קמפיין נגדי' : 'המשימה נוצרה בהצלחה'}
      </p>
      <p className="text-[12px] text-foreground-muted mb-4">{(signal.summary || '').slice(0, 80)}</p>
      <button onClick={onClose} className="px-6 py-2 bg-secondary text-foreground-secondary rounded-xl text-[13px] hover:bg-secondary transition-all">סגור</button>
    </div>
  );

  // ── STEP: Retention WhatsApp — message composer ──
  const stepRetentionWhatsapp = (
    <>
      <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 mb-3">
        <p className="text-[11px] font-semibold text-green-700 mb-1">מצב:</p>
        <p className="text-[12px] text-green-900">{signal.summary}</p>
      </div>
      <p className="text-[11px] font-semibold text-foreground-secondary mb-2">הודעת WhatsApp מותאמת:</p>
      {retentionMsgLoading ? (
        <div className="flex items-center justify-center py-8 bg-secondary/50 rounded-xl border border-dashed border-border">
          <Loader2 className="w-5 h-5 animate-spin text-foreground-muted/70 ml-2" />
          <span className="text-[12px] text-foreground-muted/70">יוצר הודעה...</span>
        </div>
      ) : (
        <textarea
          value={retentionMsg}
          onChange={e => setRetentionMsg(e.target.value)}
          rows={5}
          className="w-full px-3 py-2.5 text-[12px] border border-border rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-green-200"
          placeholder="הודעת WhatsApp..."
          dir="rtl"
        />
      )}
      <div className="flex gap-2 mt-2 mb-3">
        <button onClick={generateRetentionMessage} disabled={retentionMsgLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-foreground-muted rounded-lg text-[11px] hover:bg-secondary/50 transition-all disabled:opacity-50">
          <Sparkles className="w-3 h-3" />
          {retentionMsgLoading ? 'יוצר...' : 'צור מחדש'}
        </button>
      </div>
      <button onClick={() => setStep(1)} disabled={!retentionMsg.trim()}
        className="w-full py-2.5 bg-[#25D366] text-white rounded-xl text-[13px] font-semibold hover:bg-[#1fb855] transition-all disabled:opacity-50">
        המשך לשליחה ←
      </button>
    </>
  );

  const stepRetentionSend = (
    <>
      <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 mb-4">
        <p className="text-[10px] text-green-600 font-semibold mb-1">הודעה לשליחה:</p>
        <p className="text-[12px] text-green-900 whitespace-pre-line">{retentionMsg}</p>
      </div>
      <div className="space-y-3">
        <a href={`https://wa.me/?text=${encodeURIComponent(retentionMsg)}`}
          target="_blank" rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#25D366] text-white rounded-xl text-[13px] font-bold hover:bg-[#1fb855] transition-all">
          💬 פתח WhatsApp ושלח
        </a>
        <button onClick={async () => {
          await navigator.clipboard.writeText(retentionMsg).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          toast.success('הועתק ✓');
        }}
          className="w-full flex items-center justify-center gap-2 py-2.5 border border-border text-foreground-secondary rounded-xl text-[12px] hover:bg-secondary/50 transition-all">
          {copied ? <CheckCheck className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          {copied ? 'הועתק ✓' : 'העתק הודעה'}
        </button>
        <button onClick={async () => {
          setCreating(true);
          try {
            await base44.entities.Task.create({
              title: 'מעקב אחרי לקוח שלא חזר',
              description: `[signal:${signal.id}]\nנשלחה הודעת WhatsApp:\n${retentionMsg}\n\nמקור: ${signal.summary}`,
              status: 'pending',
              priority: 'medium',
              source_type: 'alert',
              linked_business: businessProfile?.id || '',
            });
            toast.success('משימת מעקב נוצרה ✓');
            setDone(true);
          } catch { toast.error('שגיאה ביצירת המשימה'); }
          setCreating(false);
        }} disabled={creating}
          className="w-full flex items-center justify-center gap-2 py-2.5 border border-border text-foreground-secondary rounded-xl text-[12px] hover:bg-secondary/50 transition-all disabled:opacity-70">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
          צור משימת מעקב תגובות
        </button>
      </div>
    </>
  );

  // ── STEP: Pricing Adjustment (השוואת מחירים) ──
  const PRICING_OPTIONS = [
    { key: 'task',     emoji: '📋', label: 'עדכן מחיר / תפריט',          desc: 'צור משימה לעדכון המחירים' },
    { key: 'campaign', emoji: '🎯', label: 'פרסם מבצע מחיר',             desc: 'צור קמפיין עם הנחה או מבצע' },
    { key: 'whatsapp', emoji: '💬', label: 'הודע ללקוחות ב-WhatsApp',    desc: 'שלח הודעה על עדכון המחיר' },
  ];

  const stepPricingAdjustment = (
    <>
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-4">
        <p className="text-[11px] font-semibold text-blue-700 mb-1">המצב הנוכחי:</p>
        <p className="text-[12px] text-blue-900">{signal.summary}</p>
      </div>
      <p className="text-[11px] font-semibold text-foreground-secondary mb-2">בחר פעולה:</p>
      <div className="space-y-2 mb-4">
        {PRICING_OPTIONS.map(opt => (
          <button key={opt.key} onClick={() => setCompResponseChoice(opt.key)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-right transition-all ${
              compResponseChoice === opt.key
                ? 'bg-primary/8 border-primary/40'
                : 'bg-white border-border hover:border-primary/30 hover:bg-primary/4'
            }`}>
            <span className="text-xl">{opt.emoji}</span>
            <div>
              <p className="text-[13px] font-semibold text-foreground">{opt.label}</p>
              <p className="text-[11px] text-foreground-muted">{opt.desc}</p>
            </div>
          </button>
        ))}
      </div>
      <button
        onClick={async () => {
          if (!compResponseChoice) { toast.error('בחר פעולה'); return; }
          if (compResponseChoice === 'campaign') {
            onClose();
            navigate(`/marketing/create?context=pricing_promo&signalId=${signal.id}`);
            return;
          }
          if (compResponseChoice === 'whatsapp') {
            const msg = `שלום! 😊\nרצינו ליידע אותך על עדכון מחירים ב-${businessProfile?.name || 'העסק שלנו'}.\n${signal.summary}`;
            window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
            setDone(true);
            return;
          }
          setCreating(true);
          try {
            await base44.entities.Task.create({
              title: `לעדכן מחיר / תפריט — ${(signal.summary || '').slice(0, 60)}`,
              description: `[signal:${signal.id}]\n${signal.summary}`,
              status: 'pending',
              priority: 'medium',
              source_type: 'alert',
              linked_business: businessProfile?.id || '',
            });
            toast.success('המשימה נוצרה ✓');
            setDone(true);
          } catch { toast.error('שגיאה ביצירת המשימה'); }
          setCreating(false);
        }}
        disabled={creating || !compResponseChoice}
        className="w-full py-2.5 bg-primary text-white rounded-xl text-[13px] font-semibold hover:bg-primary/90 transition-all disabled:opacity-50"
      >
        {creating ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
        בצע פעולה ←
      </button>
    </>
  );

  // Dynamic step content array based on action type
  const stepContents = (() => {
    if (actionType === 'platform_setup')      return [stepPlatformSetup];
    if (actionType === 'respond')             return [stepRespond, stepRespondPublish];
    if (actionType === 'call')                return [stepCall, stepCallAction];
    if (actionType === 'competitor_response') return [stepCompetitorResponse, stepCompetitorResponseDone];
    if (actionType === 'retention_whatsapp')  return [stepRetentionWhatsapp, stepRetentionSend];
    if (actionType === 'pricing_adjustment')  return [stepPricingAdjustment];
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
          <div className="flex items-center gap-2">
            <span className="text-xl">{config.icon}</span>
            <div>
              <p className="text-[13px] font-semibold text-foreground">{config.label}</p>
              <p className="text-[11px] text-foreground-muted/70">⏱ {timeMinutes} דקות</p>
            </div>
          </div>
          <button onClick={onClose} className="text-foreground-muted/70 hover:text-foreground-secondary transition-colors">
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
              <button onClick={onClose} className="mt-2 text-[11px] text-foreground-muted/70 underline hover:text-foreground-secondary">סגור</button>
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
