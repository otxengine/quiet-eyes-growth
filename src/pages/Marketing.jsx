import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Plus, Megaphone, Eye, MousePointerClick, Users, TrendingUp,
  Loader2, Trash2, ExternalLink, RefreshCw, X, Upload, Sparkles,
  Image as ImageIcon, Send,
} from 'lucide-react';
import { toast } from 'sonner';
import PlanGate from '@/components/subscription/PlanGate';

// ── Config ────────────────────────────────────────────────────────────────────

const PLATFORM_CONFIG = {
  meta:      { label: 'Facebook',    icon: '📘', color: '#1877f2', bg: '#e7f3ff' },
  instagram: { label: 'Instagram',   icon: '📸', color: '#e1306c', bg: '#fde8f0' },
  google:    { label: 'Google Ads',  icon: '🔍', color: '#4285f4', bg: '#e8f0fe' },
};

const ORGANIC_PLATFORMS = [
  { id: 'instagram', label: 'Instagram', icon: '📸', color: '#e1306c' },
  { id: 'facebook',  label: 'Facebook',  icon: '📘', color: '#1877f2' },
  { id: 'tiktok',    label: 'TikTok',    icon: '🎵', color: '#000' },
];

const STATUS_CONFIG = {
  draft:          { label: 'טיוטה',          cls: 'bg-gray-100 text-gray-600' },
  pending_launch: { label: 'ממתין לפרסום',   cls: 'bg-amber-50 text-amber-700' },
  published:      { label: 'פורסם',           cls: 'bg-blue-50 text-blue-700' },
  active:         { label: 'פעיל',            cls: 'bg-green-50 text-green-700' },
  completed:      { label: 'הסתיים',          cls: 'bg-purple-50 text-purple-700' },
};

const ORGANIC_STATUS = {
  draft:     { label: 'טיוטה',  cls: 'bg-gray-100 text-gray-600' },
  published: { label: 'פורסם',  cls: 'bg-green-50 text-green-700' },
};

function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(Math.round(n));
}
function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

// ── Paid Campaign Card ────────────────────────────────────────────────────────

function CampaignCard({ campaign, onDelete }) {
  const navigate = useNavigate();
  const plat   = PLATFORM_CONFIG[campaign.platform] || { label: campaign.platform, icon: '📣', color: '#555', bg: '#f5f5f5' };
  const status = STATUS_CONFIG[campaign.status] || STATUS_CONFIG.draft;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-sm transition-all">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: plat.bg, color: plat.color }}>
          {plat.icon} {plat.label}
        </span>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full mr-auto ${status.cls}`}>{status.label}</span>
      </div>
      <div className="px-4 py-3">
        <h3 className="text-[13px] font-semibold text-foreground mb-1 truncate">{campaign.title}</h3>
        {campaign.post_content && (
          <p className="text-[11px] text-foreground-muted line-clamp-2 mb-3">{campaign.post_content}</p>
        )}
        <div className="flex items-center gap-4 py-2 border-t border-border/50 text-[10px] text-foreground-muted">
          {campaign.daily_budget_ils != null && <span>₪{campaign.daily_budget_ils}/יום</span>}
          {campaign.est_reach_low != null && <span>{fmtNum(campaign.est_reach_low)}–{fmtNum(campaign.est_reach_high)} הגעה</span>}
          <span className="mr-auto">{fmtDate(campaign.published_at || campaign.created_date)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 px-4 py-2 border-t border-border bg-secondary/30">
        <button onClick={() => navigate(`/marketing/create?campaignId=${campaign.id}`)} className="text-[11px] text-foreground-muted hover:text-foreground transition-colors">✏️ ערוך</button>
        {campaign.status === 'pending_launch' && (
          <a
            href={campaign.platform === 'google' ? 'https://ads.google.com/aw/campaigns' : 'https://business.facebook.com/adsmanager/'}
            target="_blank" rel="noreferrer"
            className="flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:text-amber-800 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            פתח Ads Manager
          </a>
        )}
        <button onClick={() => onDelete(campaign.id)} className="text-[11px] text-foreground-muted hover:text-red-500 mr-auto transition-colors">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── Organic Post Card ─────────────────────────────────────────────────────────

function OrganicCard({ post, onDelete }) {
  const platCfg = ORGANIC_PLATFORMS.find(p => p.id === post.platform) || ORGANIC_PLATFORMS[0];
  const status  = ORGANIC_STATUS[post.status] || ORGANIC_STATUS.draft;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-sm transition-all">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <span className="text-[13px]">{platCfg.icon}</span>
        <span className="text-[11px] font-medium text-foreground">{platCfg.label}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-foreground-muted">
          {post.post_type === 'story' ? '📱 סטורי' : '📄 פוסט'}
        </span>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full mr-auto ${status.cls}`}>{status.label}</span>
      </div>
      <div className="flex gap-3 p-4">
        {post.image_url && (
          <img
            src={post.image_url.startsWith('data:') ? post.image_url : post.image_url}
            alt=""
            className="w-16 h-16 object-cover rounded-lg flex-shrink-0 border border-border"
          />
        )}
        <div className="flex-1 min-w-0">
          {post.signal_summary && (
            <p className="text-[9px] text-foreground-muted opacity-60 mb-1 truncate">💡 {post.signal_summary}</p>
          )}
          <p className="text-[12px] text-foreground leading-relaxed line-clamp-3">{post.content || '(אין תוכן)'}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 px-4 py-2 border-t border-border bg-secondary/30">
        <span className="text-[10px] text-foreground-muted mr-auto">{fmtDate(post.published_at || post.created_date)}</span>
        <button onClick={() => onDelete(post.id)} className="text-[11px] text-foreground-muted hover:text-red-500 transition-colors">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── Organic Post Create Drawer ────────────────────────────────────────────────

function OrganicCreateDrawer({ businessProfile, signalContext, audienceData, recentSignals, onClose, onSaved }) {
  const queryClient = useQueryClient();
  const [platform, setPlatform]   = useState('instagram');
  const [postType, setPostType]   = useState(signalContext?.type || 'post');
  const [content,  setContent]    = useState('');
  const [imageUrl, setImageUrl]   = useState('');
  const [mediaId,  setMediaId]    = useState(null);
  const [imageDesc, setImageDesc] = useState('');

  const [genContent,  setGenContent]  = useState(false);
  const [genImage,    setGenImage]    = useState(false);
  const [analyzing,   setAnalyzing]   = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [imgPreview,  setImgPreview]  = useState(false);

  const fileRef = useRef(null);

  const platCfg = ORGANIC_PLATFORMS.find(p => p.id === platform) || ORGANIC_PLATFORMS[0];

  // Auto-generate content on open
  useEffect(() => {
    if (!businessProfile || content) return;
    generateContent();
  }, []); // eslint-disable-line

  const generateContent = useCallback(async () => {
    setGenContent(true);
    try {
      const pa = audienceData?.primary_audience;
      const audienceCtx = pa
        ? `קהל יעד מאומת: גיל ${pa.age_range}, ${pa.gender_skew}. תחומי עניין: ${(pa.interests || []).join(', ')}. כאבים: ${(pa.pain_points || []).join(', ')}. Hooks שעובדים: ${(audienceData?.hooks_that_work || []).slice(0, 3).join(' | ')}.`
        : '';

      const platformGuide = {
        instagram: 'Instagram: Hook חזק בשורה ראשונה, טקסט 80-120 מילה, ויזואלי ואמוציונלי, 5-8 האשטאגים (3 רחבים + 2 נישה + 1 עיר)',
        facebook:  'Facebook: פוסט עם ערך אמיתי + שאלה שמניעה תגובות, 60-100 מילה, 2-3 האשטאגים בסוף',
        tiktok:    'TikTok: Hook בשנייה הראשונה (שאלה חדה / עובדה מפתיעה), 50-80 מילה, ויראלי, 4-5 האשטאגים טרנדיים',
      };

      const signalBlock = recentSignals?.length
        ? `מגמות שוק רלוונטיות:\n${recentSignals.slice(0, 4).map(s => `- ${s.summary}`).join('\n')}`
        : '';

      const isStory = postType === 'story';
      const formatInstr = isStory
        ? 'סטורי: 1-2 משפטים מנצחים + CTA ברור. קצר, ישיר, מניע לפעולה.'
        : `פוסט מלא עם:\n1. Hook — שורה ראשונה שעוצרת גלילה (שאלה / עובדה / אמירה אמיצה)\n2. גוף — 60-100 מילה עם ערך אמיתי, שפה חיה, לא שיווקית\n3. CTA — קריאה לפעולה ספציפית בסוף\n4. האשטאגים לפי הנחיות הפלטפורמה`;

      const result = await base44.integrations.Core.InvokeLLM({
        model: 'sonnet',
        maxTokens: 600,
        prompt: `אתה כותב תוכן מקצועי לרשתות חברתיות לעסקים ישראלים. הפוסט שתכתוב חייב להיות ברמה גבוהה מספיק לפרסום ישיר — ללא עריכה.

עסק: "${businessProfile.name}" | תחום: ${businessProfile.category} | עיר: ${businessProfile.city || ''}
${businessProfile.description ? `תיאור: ${businessProfile.description}` : ''}
${signalContext?.summary ? `הקשר / תובנה: "${signalContext.summary}"` : ''}
${audienceCtx ? `\n${audienceCtx}` : ''}
${signalBlock ? `\n${signalBlock}` : ''}

פלטפורמה: ${platCfg.label}
${platformGuide[platform] || platformGuide.instagram}

${formatInstr}

כתוב רק את טקסט הפוסט הסופי — ללא כותרות, ללא הסברים, ללא מרכאות עוטפות.`,
      });
      setContent(typeof result === 'string' ? result.trim() : (result?.content || ''));
    } catch { toast.error('שגיאה ביצירת תוכן'); }
    setGenContent(false);
  }, [businessProfile, postType, platCfg.label, platform, signalContext, audienceData, recentSignals]);

  // Generate AI image
  const handleGenImage = async () => {
    setGenImage(true);
    try {
      const res = await base44.functions.invoke('generateImage', {
        businessProfileId: businessProfile.id,
        post_text: content,
        insight_text: signalContext?.summary || '',
      });
      const data = res?.data || res;
      if (data?.url) {
        setImageUrl(data.url);
        // Save as MediaAsset
        try {
          if (data.url.startsWith('data:')) {
            const b64 = data.url.split(',')[1];
            const asset = await base44.entities.MediaAsset.create({
              linked_business: businessProfile.id,
              image_base64: b64,
              mime_type: 'image/png',
              source: 'ai_generated',
              description: content.slice(0, 80),
              used_in: postType,
            });
            setMediaId(asset.id);
          }
        } catch {}
      }
    } catch { toast.error('שגיאה ביצירת תמונה'); }
    setGenImage(false);
  };

  // Upload image from device
  const handleUpload = async (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      setImageUrl(dataUrl);
      // Analyze with Vision
      setAnalyzing(true);
      try {
        const b64 = dataUrl.split(',')[1];
        const mime = file.type || 'image/jpeg';
        const res = await base44.functions.invoke('analyzeImageForPost', {
          businessProfileId: businessProfile.id,
          imageBase64: b64,
          mimeType: mime,
          platform,
        });
        const data = res?.data || res;
        if (data?.mediaAssetId) setMediaId(data.mediaAssetId);
        if (data?.description) setImageDesc(data.description);
        if (data?.suggested_post) {
          toast('התוכן עודכן לפי התמונה ✨', { duration: 3000 });
          setContent(data.suggested_post);
        }
      } catch { toast.error('שגיאה בניתוח התמונה'); }
      setAnalyzing(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (publish = false) => {
    if (!content.trim()) { toast.error('יש להזין תוכן'); return; }
    setSaving(true);
    try {
      await base44.entities.OrganicPost.create({
        linked_business: businessProfile.id,
        signal_id:       signalContext?.signalId || null,
        signal_summary:  signalContext?.summary  || null,
        platform,
        post_type:       postType,
        content,
        media_asset_id:  mediaId || null,
        image_url:       imageUrl || null,
        status:          publish ? 'published' : 'draft',
        published_at:    publish ? new Date().toISOString() : null,
      });
      queryClient.invalidateQueries({ queryKey: ['organicPosts', businessProfile.id] });
      toast.success(publish ? 'פורסם! 🎉' : 'נשמר כטיוטה');
      onSaved?.();
      onClose();
    } catch { toast.error('שגיאה בשמירה'); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" dir="rtl" onClick={onClose}>

      {/* Image lightbox — z-[60] to appear above the drawer */}
      {imgPreview && imageUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setImgPreview(false)}
        >
          <div className="relative max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <img src={imageUrl} alt="" className="w-full rounded-xl shadow-2xl" />
            <button
              onClick={() => setImgPreview(false)}
              className="absolute top-3 left-3 w-8 h-8 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-black/80 text-[14px]"
            >✕</button>
          </div>
        </div>
      )}

      <div
        className="w-full max-w-lg bg-card rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
          <h2 className="text-[15px] font-bold text-foreground">
            {postType === 'story' ? '📱 סטורי חדש' : '📄 פוסט חדש'}
          </h2>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Signal banner */}
          {signalContext?.summary && (
            <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800">
              💡 {signalContext.summary}
            </div>
          )}

          {/* Platform + Type */}
          <div className="flex gap-3">
            <div className="flex-1">
              <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">פלטפורמה</p>
              <div className="flex gap-1.5 flex-wrap">
                {ORGANIC_PLATFORMS.map(p => (
                  <button key={p.id} onClick={() => setPlatform(p.id)}
                    className="text-[11px] px-2.5 py-1 rounded-full border transition-all"
                    style={{
                      background: platform === p.id ? p.color + '20' : 'transparent',
                      borderColor: platform === p.id ? p.color : 'hsl(var(--border))',
                      color: platform === p.id ? p.color : 'hsl(var(--foreground-muted))',
                    }}>
                    {p.icon} {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">סוג</p>
              <div className="flex gap-1.5">
                {['post', 'story'].map(t => (
                  <button key={t} onClick={() => setPostType(t)}
                    className="text-[11px] px-2.5 py-1 rounded-full border transition-all"
                    style={{
                      background: postType === t ? 'hsl(var(--foreground))' : 'transparent',
                      color: postType === t ? 'hsl(var(--background))' : 'hsl(var(--foreground-muted))',
                      borderColor: postType === t ? 'hsl(var(--foreground))' : 'hsl(var(--border))',
                    }}>
                    {t === 'story' ? '📱 סטורי' : '📄 פוסט'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Image section */}
          <div>
            <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">תמונה</p>
            {imageUrl ? (
              <div className="relative">
                <img
                  src={imageUrl} alt=""
                  onClick={() => setImgPreview(true)}
                  className={`w-full object-cover rounded-xl border border-border cursor-zoom-in ${postType === 'story' ? 'aspect-[9/16] max-h-64' : 'h-40'}`}
                />
                {analyzing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl">
                    <div className="text-white text-[12px] flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> מנתח תמונה...
                    </div>
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity pointer-events-none rounded-xl bg-black/10">
                  <span className="text-white text-[11px] bg-black/50 px-2 py-1 rounded-full">לחץ להגדלה</span>
                </div>
                {imageDesc && <p className="text-[10px] text-foreground-muted mt-1">🔍 {imageDesc}</p>}
                <button onClick={() => { setImageUrl(''); setMediaId(null); setImageDesc(''); }}
                  className="absolute top-2 left-2 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center text-[10px] hover:bg-black/80">
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={handleGenImage} disabled={genImage}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-dashed border-border rounded-xl text-[12px] text-foreground-muted hover:bg-secondary transition-colors">
                  {genImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {genImage ? 'יוצר...' : 'תמונה AI'}
                </button>
                <button onClick={() => fileRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-dashed border-border rounded-xl text-[12px] text-foreground-muted hover:bg-secondary transition-colors">
                  <Upload className="w-4 h-4" /> העלה תמונה
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => handleUpload(e.target.files?.[0])} />
              </div>
            )}
          </div>

          {/* Content */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold text-foreground-muted">תוכן</p>
              <button onClick={generateContent} disabled={genContent}
                className="flex items-center gap-1 text-[10px] text-foreground-muted hover:text-foreground transition-colors">
                {genContent ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {genContent ? 'יוצר...' : 'צור מחדש'}
              </button>
            </div>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={postType === 'story' ? 3 : 5}
              placeholder={postType === 'story' ? 'טקסט לסטורי...' : 'תוכן הפוסט...'}
              className="w-full text-[13px] text-foreground bg-secondary border border-border rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button onClick={() => handleSave(false)} disabled={saving}
              className="flex-1 py-2.5 border border-border rounded-xl text-[13px] text-foreground-muted hover:text-foreground transition-colors">
              שמור טיוטה
            </button>
            <button onClick={() => handleSave(true)} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all"
              style={{ background: platCfg.color }}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              פרסם
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── WhatsApp Blast Drawer ─────────────────────────────────────────────────────

function WhatsAppBlastDrawer({ businessProfile, signalContext, audienceData, onClose }) {
  const [msg,     setMsg]     = useState('');
  const [loading, setLoading] = useState(false);
  const [copied,  setCopied]  = useState(false);

  useEffect(() => {
    generateMessage();
  }, []); // eslint-disable-line

  async function generateMessage() {
    setLoading(true);
    const fallback = `שלום! 😊\nיש לנו חדשות מיוחדות ב-${businessProfile?.name || 'העסק שלנו'}!\nמוזמנ/ת לבקר — מחכים לך! 🙌`;
    try {
      const pa = audienceData?.primary_audience;
      const audienceHint = pa
        ? `קהל: גיל ${pa.age_range}, ${pa.gender_skew}. כאבים: ${(pa.pain_points || []).slice(0, 2).join(', ')}.`
        : '';
      const result = await base44.integrations.Core.InvokeLLM({
        model: 'sonnet',
        maxTokens: 300,
        prompt: `אתה כותב הודעות WhatsApp שיווקיות לעסקים ישראלים. ההודעה חייבת להיות ברמה גבוהה — אנושית, ממוקדת, ומניעה לפעולה.

עסק: "${businessProfile?.name || ''}" | תחום: ${businessProfile?.category || ''} | עיר: ${businessProfile?.city || ''}
${signalContext?.summary ? `הקשר / הזדמנות: "${signalContext.summary}"` : ''}
${audienceHint ? `${audienceHint}` : ''}

כתוב הודעת WhatsApp בלסט (הפצה המונית ללקוחות):
- שורה 1: פתיחה חמה / קריאה לתשומת לב עם אמוג'י
- שורה 2-3: הצעת ערך ספציפית — מה מקבלים / למה עכשיו
- שורה 4: CTA ברור וישיר (להזמין / לכתוב / לבקר)
- סה"כ: 3-4 שורות קצרות, עברית ידידותית, בגוף ראשון מטעם העסק
כתוב רק את ההודעה הסופית — ללא כותרות, ללא הסברים.`,
      });
      setMsg((typeof result === 'string' && result.trim()) ? result.trim() : fallback);
    } catch {
      setMsg(fallback);
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-t-2xl w-full max-w-lg shadow-2xl" dir="rtl" style={{ maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-2xl">💬</span>
            <div>
              <p className="text-[14px] font-bold text-gray-800">WhatsApp Blast</p>
              <p className="text-[11px] text-gray-400">שלח הודעה שיווקית ללקוחות</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {signalContext?.summary && (
            <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-2.5">
              <p className="text-[11px] font-semibold text-green-700 mb-0.5">הקשר:</p>
              <p className="text-[12px] text-green-900">{signalContext.summary}</p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[12px] font-semibold text-gray-700">הודעה:</p>
              <button onClick={generateMessage} disabled={loading}
                className="flex items-center gap-1.5 px-2.5 py-1 border border-gray-200 text-gray-500 rounded-lg text-[11px] hover:bg-gray-50 disabled:opacity-50">
                <Sparkles className="w-3 h-3" />
                {loading ? 'יוצר...' : 'צור מחדש'}
              </button>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-10 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400 ml-2" />
                <span className="text-[12px] text-gray-400">יוצר הודעה...</span>
              </div>
            ) : (
              <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={5} dir="rtl"
                className="w-full px-3 py-2.5 text-[13px] border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-green-200"
                placeholder="הודעת WhatsApp..." />
            )}
            <p className="text-[10px] text-gray-400 mt-1">{msg.length} / 4096 תווים</p>
          </div>

          <div className="space-y-2.5">
            <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`}
              target="_blank" rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#25D366] text-white rounded-xl text-[14px] font-bold hover:bg-[#1fb855] transition-all">
              💬 פתח WhatsApp ושלח
            </a>
            <button onClick={async () => {
              await navigator.clipboard.writeText(msg).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-[13px] hover:bg-gray-50 transition-all">
              {copied ? '✓ הועתק' : '📋 העתק הודעה'}
            </button>
          </div>

          <p className="text-[11px] text-gray-400 text-center">
            WhatsApp Blast עובד דרך הפתחת WhatsApp Web — העתק את ההודעה ושלח ישירות.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Content Calendar ─────────────────────────────────────────────────────────

const DAY_LABELS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

function CalendarView({ posts }) {
  const [weekOffset, setWeekOffset] = useState(0);

  // Build week starting Sunday
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay() + weekOffset * 7);
  startOfWeek.setHours(0, 0, 0, 0);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return d;
  });

  const postsByDay = {};
  posts.forEach(post => {
    const dateStr = (post.published_at || post.created_date || '').slice(0, 10);
    if (!dateStr) return;
    if (!postsByDay[dateStr]) postsByDay[dateStr] = [];
    postsByDay[dateStr].push(post);
  });

  const weekLabel = `${days[0].toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })} – ${days[6].toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  const todayStr = today.toISOString().slice(0, 10);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setWeekOffset(w => w - 1)}
          className="px-3 py-1.5 rounded-lg border border-border text-[11px] text-foreground-muted hover:bg-secondary transition-all">
          → שבוע קודם
        </button>
        <span className="text-[12px] font-semibold text-foreground">{weekLabel}</span>
        <button onClick={() => setWeekOffset(w => w + 1)}
          className="px-3 py-1.5 rounded-lg border border-border text-[11px] text-foreground-muted hover:bg-secondary transition-all">
          שבוע הבא ←
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((day, i) => {
          const dateKey = day.toISOString().slice(0, 10);
          const dayPosts = postsByDay[dateKey] || [];
          const isToday = dateKey === todayStr;
          return (
            <div key={dateKey} className={`min-h-[120px] rounded-xl border p-2 flex flex-col gap-1 ${isToday ? 'border-primary bg-primary/5' : 'border-border bg-secondary/30'}`}>
              <div className={`text-center mb-1 ${isToday ? 'font-bold text-primary' : 'text-foreground-muted'}`}>
                <div className="text-[9px]">{DAY_LABELS[i]}'</div>
                <div className="text-[13px] font-semibold">{day.getDate()}</div>
              </div>
              {dayPosts.map(p => {
                const platCfg = ORGANIC_PLATFORMS.find(pl => pl.id === p.platform);
                return (
                  <div key={p.id} className="rounded-lg px-1.5 py-1 text-[9px] leading-tight truncate" style={{ background: platCfg?.color + '22', color: platCfg?.color || '#555' }}>
                    {platCfg?.icon} {p.content?.slice(0, 30) || '(פוסט)'}
                  </div>
                );
              })}
              {dayPosts.length === 0 && (
                <div className="flex-1 flex items-center justify-center">
                  <span className="text-[9px] text-foreground-muted/30">—</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {posts.length === 0 && (
        <div className="text-center py-8 text-[12px] text-foreground-muted">
          אין פוסטים לוח השנה — צור פוסט אורגני כדי שיופיע כאן
        </div>
      )}
    </div>
  );
}

// ── Main Marketing Page ───────────────────────────────────────────────────────

const TABS = [
  { id: 'paid',      label: 'ממומן',     icon: '💰' },
  { id: 'organic',   label: 'אורגני',    icon: '🌱' },
  { id: 'audiences', label: 'קהל יעד',   icon: '🎯' },
  { id: 'calendar',  label: 'לוח שנה',   icon: '📅' },
];

const PAID_TABS = ['all', 'pending_launch', 'draft', 'published', 'active', 'completed'];
const PAID_TAB_LABELS = { all: 'הכל', pending_launch: 'ממתין לפרסום', draft: 'טיוטות', published: 'פורסמו', active: 'פעילים', completed: 'הסתיימו' };

export default function Marketing() {
  const { businessProfile } = useOutletContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const bpId = businessProfile?.id;
  const [activeTab,       setActiveTab]       = useState('paid');
  const [paidFilter,      setPaidFilter]      = useState('all');
  const [showOrgCreate,   setShowOrgCreate]   = useState(false);
  const [organicCtx,      setOrganicCtx]      = useState(null);
  const [showWaBlast,     setShowWaBlast]     = useState(false);
  const [waBlastCtx,      setWaBlastCtx]      = useState(null);

  // Auto-open organic drawer / switch tab if URL says so
  useEffect(() => {
    if (searchParams.get('create') === 'organic') {
      setActiveTab('organic');
      setOrganicCtx({
        signalId: searchParams.get('signalId') || '',
        summary:  searchParams.get('summary')  || '',
        action:   searchParams.get('action')   || '',
        type:     searchParams.get('type')     || 'post',
      });
      setShowOrgCreate(true);
    }
    if (searchParams.get('create') === 'whatsapp') {
      setWaBlastCtx({
        signalId: searchParams.get('signalId') || '',
        summary:  searchParams.get('summary')  || '',
      });
      setShowWaBlast(true);
    }
    // Handle tab param: /marketing?tab=audiences (etc.)
    const tab = searchParams.get('tab');
    if (tab) setActiveTab(tab);
  }, []); // eslint-disable-line

  // ── Paid campaigns ──
  const { data: campaigns = [], isLoading: loadingPaid } = useQuery({
    queryKey: ['campaigns', bpId],
    queryFn: () => base44.entities.Campaign.filter({ linked_business: bpId }, '-created_date', 50),
    enabled: !!bpId,
  });

  const deleteCampaign = useMutation({
    mutationFn: (id) => base44.entities.Campaign.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaigns', bpId] }); toast.success('נמחק'); },
  });

  const filteredCampaigns = paidFilter === 'all' ? campaigns : campaigns.filter(c => c.status === paidFilter);

  // ── Organic posts ──
  const { data: organicPosts = [], isLoading: loadingOrganic } = useQuery({
    queryKey: ['organicPosts', bpId],
    queryFn: () => base44.entities.OrganicPost.filter({ linked_business: bpId }, '-created_date', 50),
    enabled: !!bpId && (activeTab === 'organic' || activeTab === 'calendar'),
  });

  const deleteOrganic = useMutation({
    mutationFn: (id) => base44.entities.OrganicPost.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['organicPosts', bpId] }); toast.success('נמחק'); },
  });

  // ── Audience intelligence ──
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [audiencePlan, setAudiencePlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);

  const { data: audienceSignals = [], refetch: refetchAudience } = useQuery({
    queryKey: ['audienceSignals', bpId],
    queryFn: () => base44.entities.MarketSignal.filter(
      { linked_business: bpId, category: 'tiktok_audience' },
      '-detected_at', 5
    ),
    enabled: !!bpId && activeTab === 'audiences',
  });

  const { data: marketSignals = [] } = useQuery({
    queryKey: ['marketSignalsForAudience', bpId],
    queryFn: () => base44.entities.MarketSignal.filter(
      { linked_business: bpId },
      '-detected_at', 30
    ),
    enabled: !!bpId && activeTab === 'audiences',
  });

  const latestAudience = audienceSignals[0] ? (() => {
    try { return JSON.parse(audienceSignals[0].source_description || '{}'); } catch { return null; }
  })() : null;

  const runAudienceAgent = async () => {
    setAudienceLoading(true);
    try {
      await base44.functions.invoke('tiktokAudienceAgent', { businessProfileId: bpId, force: true });
      await refetchAudience();
      toast.success('קהל יעד עודכן ✓');
    } catch (err) { console.error('runAudienceAgent error:', err); toast.error(`שגיאה בניתוח קהל יעד: ${err?.message || 'נסה שוב'}`); }
    setAudienceLoading(false);
  };

  const generateAudiencePlan = async () => {
    setPlanLoading(true);
    try {
      const signalContext = marketSignals
        .filter(s => ['tiktok_sector_trend', 'competitor_move', 'local_trend', 'demand_gap'].includes(s.category))
        .slice(0, 8)
        .map(s => s.summary)
        .join('; ');
      const audienceCtx = latestAudience?.primary_audience
        ? `קהל ראשי: ${latestAudience.primary_audience.age_range}, ${latestAudience.primary_audience.gender_skew}. תחומי עניין: ${(latestAudience.primary_audience.interests || []).join(', ')}.`
        : '';
      const res = await base44.integrations.Core.InvokeLLM({
        model: 'sonnet',
        maxTokens: 700,
        prompt: `אתה מומחה לפרסום ממוקד עבור עסקים קטנים ישראלים.
עסק: "${businessProfile?.name}" (${businessProfile?.category}, ${businessProfile?.city}).
${audienceCtx}
אותות שוק ומודיעין שנאסף: ${signalContext || 'אין'}.

בהתבסס על המידע שנאסף, צור תוכנית קהל יעד מפורטת. JSON בלבד:
{
  "segments": [
    {
      "name": "שם הסגמנט",
      "description": "תיאור קצר",
      "age": "טווח גיל",
      "gender": "התפלגות מגדרית",
      "interests": ["תחום 1","תחום 2","תחום 3"],
      "pain_points": ["כאב 1","כאב 2"],
      "best_channels": ["ערוץ 1","ערוץ 2"],
      "message_angle": "זווית מסר מנצחת",
      "budget_priority": "high|medium|low"
    }
  ],
  "top_insight": "התובנה החשובה ביותר מהמודיעין שנאסף",
  "recommended_first_campaign": "תיאור קמפיין ראשון מומלץ"
}`,
        response_json_schema: { type: 'object' },
      });
      setAudiencePlan(res?.segments ? res : null);
      if (!res?.segments) toast.error('לא הצלחנו לייצר תוכנית — נסה שוב');
    } catch (err) { console.error('generateAudiencePlan error:', err); toast.error(`שגיאה: ${err?.message || 'נסה שוב'}`); }
    setPlanLoading(false);
  };

  return (
    <PlanGate requires="growth" featureName="מרכז השיווק">
    <div className="p-4 md:p-6 max-w-5xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Megaphone className="w-5 h-5" /> מרכז שיווק
          </h1>
          <p className="text-sm text-foreground-muted mt-0.5">פוסטים, סטוריז וקמפיינים ממומנים</p>
        </div>
        {activeTab !== 'calendar' && activeTab !== 'audiences' && (
          <button
            onClick={() => activeTab === 'paid' ? navigate('/marketing/create') : setShowOrgCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg text-[13px] font-semibold hover:opacity-90 transition-all"
          >
            <Plus className="w-4 h-4" />
            {activeTab === 'paid' ? 'קמפיין חדש' : 'פוסט חדש'}
          </button>
        )}
      </div>

      {/* Main tabs */}
      <div className="flex gap-1 mb-5 p-1 bg-secondary rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
              activeTab === t.id ? 'bg-card shadow-sm text-foreground' : 'text-foreground-muted hover:text-foreground'
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Paid tab */}
      {activeTab === 'paid' && (
        <>
          <div className="flex gap-1 mb-4 border-b border-border">
            {PAID_TABS.map(t => (
              <button key={t} onClick={() => setPaidFilter(t)}
                className={`px-3 py-2 text-[12px] font-medium border-b-2 transition-all ${
                  paidFilter === t ? 'border-foreground text-foreground' : 'border-transparent text-foreground-muted hover:text-foreground'
                }`}>
                {PAID_TAB_LABELS[t]}
                {t !== 'all' && campaigns.filter(c => c.status === t).length > 0 && (
                  <span className="mr-1 text-[10px] opacity-60">({campaigns.filter(c => c.status === t).length})</span>
                )}
              </button>
            ))}
          </div>
          {loadingPaid ? (
            <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-foreground-muted" /></div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="text-center py-20">
              <Megaphone className="w-10 h-10 text-foreground-muted opacity-30 mx-auto mb-3" />
              <p className="text-[13px] text-foreground-muted mb-4">אין קמפיינים עדיין</p>
              <button onClick={() => navigate('/marketing/create')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg text-[13px] font-semibold hover:opacity-90">
                <Plus className="w-4 h-4" /> צור קמפיין
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredCampaigns.map(c => (
                <CampaignCard key={c.id} campaign={c} onDelete={(id) => deleteCampaign.mutate(id)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Organic tab */}
      {activeTab === 'organic' && (
        <>
          {loadingOrganic ? (
            <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-foreground-muted" /></div>
          ) : organicPosts.length === 0 ? (
            <div className="text-center py-20">
              <ImageIcon className="w-10 h-10 text-foreground-muted opacity-30 mx-auto mb-3" />
              <p className="text-[13px] text-foreground-muted mb-4">אין פוסטים עדיין</p>
              <button onClick={() => setShowOrgCreate(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg text-[13px] font-semibold hover:opacity-90">
                <Plus className="w-4 h-4" /> צור פוסט ראשון
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {organicPosts.map(p => (
                <OrganicCard key={p.id} post={p} onDelete={(id) => deleteOrganic.mutate(id)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Audiences tab */}
      {activeTab === 'audiences' && (
        <div className="space-y-4">
          {/* Header actions */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] text-foreground-muted">ניתוח קהל יעד מתוך מודיעין שוק שנאסף</p>
              {latestAudience && audienceSignals[0]?.detected_at && (
                <p className="text-[10px] text-foreground-muted/60 mt-0.5">
                  עדכון אחרון: {new Date(audienceSignals[0].detected_at).toLocaleDateString('he-IL')}
                </p>
              )}
            </div>
            <button onClick={runAudienceAgent} disabled={audienceLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[11px] font-medium text-foreground-muted hover:text-foreground hover:bg-secondary transition-all disabled:opacity-60">
              {audienceLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {audienceLoading ? 'מנתח...' : 'רענן נתונים'}
            </button>
          </div>

          {/* Collected intelligence — primary audience */}
          {latestAudience?.primary_audience ? (
            <div className="card-base p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[13px] font-bold text-foreground">קהל ראשי — מבוסס TikTok & מודיעין</span>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">AI</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-secondary">
                  <p className="text-[9px] text-foreground-muted mb-1">גיל</p>
                  <p className="text-[13px] font-bold text-foreground">{latestAudience.primary_audience.age_range}</p>
                </div>
                <div className="p-3 rounded-xl bg-secondary">
                  <p className="text-[9px] text-foreground-muted mb-1">מגדר</p>
                  <p className="text-[13px] font-bold text-foreground">{latestAudience.primary_audience.gender_skew}</p>
                </div>
              </div>
              {latestAudience.primary_audience.interests?.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">תחומי עניין</p>
                  <div className="flex flex-wrap gap-1.5">
                    {latestAudience.primary_audience.interests.map((i, idx) => (
                      <span key={idx} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{i}</span>
                    ))}
                  </div>
                </div>
              )}
              {latestAudience.primary_audience.pain_points?.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">כאבים / מניעים לרכישה</p>
                  <ul className="space-y-1">
                    {latestAudience.primary_audience.pain_points.map((p, idx) => (
                      <li key={idx} className="text-[11px] text-foreground-secondary flex items-start gap-1.5">
                        <span className="text-amber-500 mt-0.5 flex-shrink-0">→</span>{p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {latestAudience.primary_audience.why_they_follow && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <p className="text-[10px] font-semibold text-amber-700 mb-1">למה הם עוקבים אחרי עסקים בקטגוריה שלנו</p>
                  <p className="text-[11px] text-amber-900">{latestAudience.primary_audience.why_they_follow}</p>
                </div>
              )}
              {latestAudience.hooks_that_work?.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">Hooks שעובדים בסקטור</p>
                  <ul className="space-y-1">
                    {latestAudience.hooks_that_work.slice(0, 3).map((h, idx) => (
                      <li key={idx} className="text-[11px] text-foreground p-2 rounded-lg bg-secondary border border-border">"{h}"</li>
                    ))}
                  </ul>
                </div>
              )}
              {latestAudience.best_posting_windows?.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">שעות פרסום אופטימליות</p>
                  <div className="flex flex-col gap-1.5">
                    {latestAudience.best_posting_windows.slice(0, 3).map((w, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-[11px]">
                        <span className="font-medium text-foreground w-24 flex-shrink-0">{w.days}</span>
                        <span className="text-primary font-bold">{w.time}</span>
                        <span className="text-foreground-muted">{w.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {latestAudience.growth_strategy_30d && (
                <div className="p-3 rounded-xl bg-green-50 border border-green-200">
                  <p className="text-[10px] font-semibold text-green-700 mb-1">אסטרטגיית גדילה 30 יום</p>
                  <p className="text-[11px] text-green-900 leading-relaxed">{latestAudience.growth_strategy_30d}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="card-base p-8 text-center">
              <p className="text-[13px] font-semibold text-foreground mb-2">אין נתוני קהל יעד עדיין</p>
              <p className="text-[11px] text-foreground-muted mb-4">לחץ "רענן נתונים" להפעיל ניתוח קהל יעד מבוסס מודיעין שוק</p>
              <button onClick={runAudienceAgent} disabled={audienceLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg text-[12px] font-semibold hover:opacity-90 disabled:opacity-60">
                {audienceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
                {audienceLoading ? 'מנתח...' : 'נתח קהל יעד'}
              </button>
            </div>
          )}

          {/* AI Campaign Plan based on intelligence */}
          <div className="card-base p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[13px] font-bold text-foreground">תוכנית סגמנטים — מבוסס מודיעין</p>
                <p className="text-[10px] text-foreground-muted mt-0.5">AI ימפה סגמנטים אידיאלים מתוך {marketSignals.length} אותות שוק שנאספו</p>
              </div>
              <button onClick={generateAudiencePlan} disabled={planLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground text-background rounded-lg text-[11px] font-semibold hover:opacity-90 disabled:opacity-60">
                {planLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {planLoading ? 'מייצר...' : 'צור תוכנית'}
              </button>
            </div>
            {audiencePlan ? (
              <div className="space-y-3">
                {audiencePlan.top_insight && (
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                    <p className="text-[10px] font-semibold text-blue-700 mb-1">תובנה מובילה מהמודיעין</p>
                    <p className="text-[12px] text-blue-900">{audiencePlan.top_insight}</p>
                  </div>
                )}
                {(audiencePlan.segments || []).map((seg, idx) => (
                  <div key={idx} className="p-4 rounded-xl border border-border bg-secondary/30">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[12px] font-bold text-foreground">{seg.name}</p>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${seg.budget_priority === 'high' ? 'bg-red-100 text-red-700' : seg.budget_priority === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                        {seg.budget_priority === 'high' ? 'עדיפות גבוהה' : seg.budget_priority === 'medium' ? 'עדיפות בינונית' : 'עדיפות נמוכה'}
                      </span>
                    </div>
                    <p className="text-[11px] text-foreground-muted mb-2">{seg.description}</p>
                    <div className="flex gap-3 text-[10px] text-foreground-secondary mb-2">
                      <span>👤 {seg.age}</span>
                      <span>⚖️ {seg.gender}</span>
                    </div>
                    {seg.interests?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {seg.interests.map((i, ii) => (
                          <span key={ii} className="text-[9px] px-1.5 py-0.5 rounded-full bg-white border border-border text-foreground-muted">{i}</span>
                        ))}
                      </div>
                    )}
                    {seg.message_angle && (
                      <p className="text-[11px] text-primary font-medium mt-2">💡 {seg.message_angle}</p>
                    )}
                    {seg.best_channels?.length > 0 && (
                      <p className="text-[10px] text-foreground-muted mt-1">ערוצים: {seg.best_channels.join(', ')}</p>
                    )}
                  </div>
                ))}
                {audiencePlan.recommended_first_campaign && (
                  <div className="p-3 rounded-xl bg-green-50 border border-green-200">
                    <p className="text-[10px] font-semibold text-green-700 mb-1">קמפיין ראשון מומלץ</p>
                    <p className="text-[12px] text-green-900">{audiencePlan.recommended_first_campaign}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-foreground-muted text-center py-4">לחץ "צור תוכנית" לקבל ניתוח סגמנטים מבוסס מודיעין שוק אמיתי שנאסף עבורך</p>
            )}
          </div>
        </div>
      )}

      {/* Calendar tab */}
      {activeTab === 'calendar' && (
        <CalendarView posts={organicPosts} />
      )}

      {/* Organic create drawer */}
      {showOrgCreate && (
        <OrganicCreateDrawer
          businessProfile={businessProfile}
          signalContext={organicCtx}
          audienceData={latestAudience}
          recentSignals={marketSignals?.slice(0, 6) || []}
          onClose={() => { setShowOrgCreate(false); setOrganicCtx(null); }}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['organicPosts', bpId] })}
        />
      )}

      {/* WhatsApp blast drawer */}
      {showWaBlast && (
        <WhatsAppBlastDrawer
          businessProfile={businessProfile}
          signalContext={waBlastCtx}
          audienceData={latestAudience}
          onClose={() => { setShowWaBlast(false); setWaBlastCtx(null); }}
        />
      )}
    </div>
    </PlanGate>
  );
}
