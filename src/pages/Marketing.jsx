import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Plus, Loader2, ChevronDown, Search, MoreVertical, Radio, Upload, Sparkles, RefreshCw, Send, Image as ImageIcon, ExternalLink, TrendingUp, X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/shared/PageHeader';
import StatCards from '@/components/shared/StatCards';
import UrgentActionsSection from '@/components/shared/UrgentActionsSection';
import BusinessSocialSnapshot from '@/components/marketing/BusinessSocialSnapshot';
import MediaLibrary from '@/components/marketing/MediaLibrary';
const PLATFORM_CONFIG = {
  meta:      { label: 'Facebook',   icon: '📘', color: '#1877f2', bg: '#e7f3ff' },
  instagram: { label: 'Instagram',  icon: '📸', color: '#e1306c', bg: '#fde8f0' },
  google:    { label: 'Google Ads', icon: '🔍', color: '#4285f4', bg: '#e8f0fe' },
  facebook:  { label: 'Facebook',   icon: '📘', color: '#1877f2', bg: '#e7f3ff' },
  whatsapp:  { label: 'WhatsApp Ads', icon: '💬', color: '#25d366', bg: '#f0fdf4' },
  tiktok:    { label: 'TikTok',     icon: '🎵', color: '#000',    bg: '#f0f0f0' },
};

const STATUS_CONFIG = {
  draft:          { label: 'טיוטה',        cls: 'bg-gray-100 text-gray-500',   tab: 'drafts' },
  pending_launch: { label: 'ממתין לפרסום', cls: 'bg-amber-50 text-amber-700',  tab: 'paused' },
  published:      { label: 'פורסם',        cls: 'bg-blue-50 text-blue-700',    tab: 'active' },
  active:         { label: 'פעיל',         cls: 'bg-green-50 text-green-700',  tab: 'active' },
  completed:      { label: 'הסתיים',       cls: 'bg-purple-50 text-purple-700', tab: 'completed' },
  paused:         { label: 'בהשהיה',       cls: 'bg-orange-50 text-orange-700', tab: 'paused' },
};

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

function fmtNum(n) {
  if (n == null || n === 0) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000)    return `${(n / 1000).toFixed(0)}K`;
  return String(Math.round(n));
}

const ORGANIC_PLATFORMS = [
  { id: 'instagram', ...PLATFORM_CONFIG.instagram },
  { id: 'facebook',  ...PLATFORM_CONFIG.facebook },
  { id: 'tiktok',    ...PLATFORM_CONFIG.tiktok },
];

const ORGANIC_STATUS = {
  draft:     { label: 'טיוטה', cls: 'bg-gray-100 text-gray-500' },
  published: { label: 'פורסם', cls: 'bg-green-50 text-green-700' },
};

// ── Paid Campaign Card ────────────────────────────────────────────────────────

const _apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:3007/api').replace(/\/$/, '');

function PublishGoogleAdsButton({ campaign, bpId, onPublished }) {
  const [loading, setLoading] = useState(false);

  const handlePublish = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${_apiBase}/campaigns/publish-google-ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: campaign.id, businessId: bpId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('הקמפיין פורסם בגוגל ✓ — מצב: מושהה (Paused)');
        onPublished?.();
      } else {
        toast.error('שגיאה: ' + (data.error || 'נסה שוב'));
      }
    } catch (e) {
      toast.error('שגיאת חיבור: ' + e.message);
    }
    setLoading(false);
  };

  return (
    <button
      onClick={handlePublish}
      disabled={loading}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white bg-blue-500 hover:bg-blue-600 transition-all disabled:opacity-50"
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
      פרסם בגוגל
    </button>
  );
}

function PublishMetaAdsButton({ campaign, bpId, onPublished }) {
  const [loading, setLoading] = useState(false);

  const handlePublish = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${_apiBase}/campaigns/publish-meta-ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: campaign.id, businessId: bpId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('הקמפיין פורסם ב-Meta ✓ — מצב: מושהה (Paused)');
        onPublished?.();
      } else {
        toast.error('שגיאה: ' + (data.error || 'נסה שוב'));
      }
    } catch (e) {
      toast.error('שגיאת חיבור: ' + e.message);
    }
    setLoading(false);
  };

  const platformLabel = campaign.platform === 'instagram'
    ? 'אינסטגרם'
    : campaign.platform === 'whatsapp'
    ? 'WhatsApp'
    : 'פייסבוק';

  return (
    <button
      onClick={handlePublish}
      disabled={loading}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 transition-all disabled:opacity-50"
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
      פרסם ב{platformLabel}
    </button>
  );
}

function PublishTikTokAdsButton({ campaign, bpId, onPublished }) {
  const [loading, setLoading] = useState(false);

  const handlePublish = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${_apiBase}/campaigns/publish-tiktok-ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: campaign.id, businessId: bpId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('קמפיין TikTok נוצר ✓ — העלה וידאו ב-Ads Manager כדי להפעיל');
        onPublished?.();
      } else {
        toast.error('שגיאה: ' + (data.error || 'נסה שוב'));
      }
    } catch (e) {
      toast.error('שגיאת חיבור: ' + e.message);
    }
    setLoading(false);
  };

  return (
    <button
      onClick={handlePublish}
      disabled={loading}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white bg-black hover:bg-gray-800 transition-all disabled:opacity-50"
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
      פרסם ב-TikTok
    </button>
  );
}

function CampaignCard({ campaign, onDelete, bpId, onPublished }) {
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
        {campaign.status === 'pending_launch' && campaign.platform === 'google' && (
          <div className="flex items-center gap-2">
            <PublishGoogleAdsButton campaign={campaign} bpId={bpId} onPublished={onPublished} />
            <a
              href="https://ads.google.com/aw/campaigns"
              target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-800 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              פתח Ads Manager
            </a>
          </div>
        )}
        {campaign.status === 'pending_launch' && ['facebook', 'instagram', 'whatsapp'].includes(campaign.platform) && (
          <div className="flex items-center gap-2">
            <PublishMetaAdsButton campaign={campaign} bpId={bpId} onPublished={onPublished} />
            <a
              href="https://adsmanager.facebook.com/adsmanager/manage/campaigns"
              target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-800 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              פתח Ads Manager
            </a>
          </div>
        )}
        {campaign.status === 'pending_launch' && campaign.platform === 'tiktok' && (
          <div className="flex items-center gap-2">
            <PublishTikTokAdsButton campaign={campaign} bpId={bpId} onPublished={onPublished} />
            <a
              href="https://ads.tiktok.com/i18n/dashboard"
              target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-800 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              פתח TikTok Ads
            </a>
          </div>
        )}
        {campaign.status === 'active' && ['facebook', 'instagram', 'whatsapp'].includes(campaign.platform) && (
          <div className="flex items-center gap-2">
            {campaign.external_campaign_id && (
              <a
                href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${campaign.external_campaign_id}`}
                target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                פתח ב-Meta
              </a>
            )}
            <a
              href="https://adsmanager.facebook.com/adsmanager/manage/campaigns"
              target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-800 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              פתח Ads Manager
            </a>
          </div>
        )}
        {campaign.status === 'active' && campaign.platform === 'google' && (
          <div className="flex items-center gap-2">
            {campaign.external_campaign_id && (
              <a
                href={`https://ads.google.com/aw/campaigns?campaignId=${campaign.external_campaign_id}`}
                target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                פתח בגוגל
              </a>
            )}
            <a
              href="https://ads.google.com/aw/campaigns"
              target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-800 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              פתח Ads Manager
            </a>
          </div>
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
  const [showPicker,  setShowPicker]  = useState(false);

  const fileRef = useRef(null);

  const handlePickFromLibrary = (asset) => {
    const src = asset.url || (asset.image_base64 ? `data:${asset.mime_type || 'image/jpeg'};base64,${asset.image_base64}` : '');
    if (!src) return;
    setImageUrl(src);
    setMediaId(asset.id);
    setImageDesc(asset.description || '');
    setShowPicker(false);
  };

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
${imageDesc ? `תמונת הפוסט מציגה: ${imageDesc}` : ''}
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
  }, [businessProfile, postType, platCfg.label, platform, signalContext, audienceData, recentSignals, imageDesc]);

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

        // Always save MediaAsset immediately so we have an ID for Instagram publishing.
        // analyzeImageForPost may fail (LLM credits), but the asset must exist first.
        let assetId = null;
        try {
          const asset = await base44.entities.MediaAsset.create({
            linked_business: businessProfile.id,
            image_base64:    b64,
            mime_type:       mime,
            source:          'uploaded',
            used_in:         postType,
          });
          assetId = asset.id;
          setMediaId(asset.id);
        } catch { /* DB save failed — Instagram publish will fall back to error */ }

        // Try AI analysis (may enrich the asset, but failure is non-blocking)
        try {
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
        } catch { /* AI analysis failed — image still works, just no caption suggestion */ }
      } catch { toast.error('שגיאה בטעינת התמונה'); }
      setAnalyzing(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (publish = false) => {
    if (!content.trim()) { toast.error('יש להזין תוכן'); return; }
    setSaving(true);
    try {
      // 1. Save to DB (as draft first, so we have an ID)
      const post = await base44.entities.OrganicPost.create({
        linked_business: businessProfile.id,
        signal_id:       signalContext?.signalId || null,
        signal_summary:  signalContext?.summary  || null,
        platform,
        post_type:       postType,
        content,
        media_asset_id:  mediaId || null,
        image_url:       imageUrl || null,
        status:          'draft',
        published_at:    null,
      });

      if (publish) {
        // 2. Actually publish to social platform via API
        const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:3007/api');
        const res = await fetch(`${apiBase}/social/publish-organic`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-dev-user': 'dev-user' },
          body: JSON.stringify({
            businessProfileId: businessProfile.id,
            postId:        post.id,
            content,
            imageUrl:      imageUrl || null,
            mediaAssetId:  mediaId  || null,
            platform,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'שגיאת פרסום');
        toast.success('פורסם בהצלחה! 🎉');
      } else {
        toast.success('נשמר כטיוטה');
      }

      queryClient.invalidateQueries({ queryKey: ['organicPosts', businessProfile.id] });
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error('שגיאה: ' + (err?.message || 'נסה שוב'));
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" dir="rtl" onClick={onClose}>

      {/* Media library picker — z-[60] to appear above the drawer */}
      {showPicker && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowPicker(false)}
        >
          <div className="relative max-w-lg w-full max-h-[80vh] overflow-y-auto bg-card rounded-2xl shadow-2xl p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-bold text-foreground">בחר מהספרייה</h3>
              <button onClick={() => setShowPicker(false)} className="text-foreground-muted hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <MediaLibrary businessProfileId={businessProfile.id} onSelect={handlePickFromLibrary} />
          </div>
        </div>
      )}

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
                <button onClick={() => setShowPicker(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-dashed border-border rounded-xl text-[12px] text-foreground-muted hover:bg-secondary transition-colors">
                  <ImageIcon className="w-4 h-4" /> מהספרייה
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

// ── CampaignRow — table row with platform icon + toggle ───────────────────────

function ToggleSwitch({ active, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-10 h-5.5 rounded-full transition-colors flex-shrink-0 ${active ? 'bg-green-500' : 'bg-gray-300'}`}
      style={{ height: '22px', width: '40px' }}
    >
      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${active ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function CampaignRow({ campaign, onDelete, bpId, onToggle }) {
  const navigate = useNavigate();
  const plat = PLATFORM_CONFIG[campaign.platform] || { label: campaign.platform, icon: '📣', color: '#555' };
  const isActive = ['active', 'published'].includes(campaign.status);
  const leads = campaign.conversions || campaign.clicks || 0;
  const convRate = campaign.clicks > 0 && campaign.conversions
    ? ((campaign.conversions / campaign.clicks) * 100).toFixed(1) + '%'
    : '—';

  return (
    <div dir="rtl" className="flex items-center gap-3 px-4 py-3 border-b border-border/40 last:border-0 hover:bg-gray-50/40 transition-colors">
      <span className="flex-1 text-[12px] font-medium text-foreground truncate min-w-0">
        {campaign.title}
      </span>
      <span className="text-[20px] w-8 flex-shrink-0 text-center" title={plat.label}>{plat.icon}</span>
      <span className="text-[12px] font-semibold text-foreground w-12 flex-shrink-0 text-center">{leads}</span>
      <span className="text-[11px] text-foreground-muted w-16 flex-shrink-0 text-center">{convRate}</span>
      <div className="w-40 flex-shrink-0 text-right">
        {campaign.daily_budget_ils != null && (
          <p className="text-[11px] text-foreground">₪{campaign.daily_budget_ils}, יומי</p>
        )}
        {campaign.created_date && (
          <p className="text-[10px] text-foreground-muted">
            מתחיל ב-{new Date(campaign.created_date).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })}
          </p>
        )}
      </div>
      <div className="w-12 flex-shrink-0 flex justify-center">
        <ToggleSwitch active={isActive} onToggle={() => onToggle(campaign)} />
      </div>
      <button onClick={() => { if (window.confirm('למחוק קמפיין?')) onDelete(campaign.id); }}
        className="text-foreground-muted hover:text-foreground flex-shrink-0">
        <MoreVertical className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Main Marketing Page ───────────────────────────────────────────────────────

const STATUS_FILTER_TABS = [
  { key: 'active',         label: 'קמפיינים פעילים',    match: ['active', 'published'] },
  { key: 'paused',         label: 'קמפיינים בהשהיה',    match: ['paused', 'pending_launch'] },
  { key: 'drafts',         label: 'טיוטות',              match: ['draft'] },
  { key: 'completed',      label: 'הסתיימו',             match: ['completed'] },
];

const TABS = [
  { id: 'paid',      label: 'ממומן',     icon: '💰' },
  { id: 'organic',   label: 'אורגני',    icon: '🌱' },
  { id: 'media',     label: 'מדיה',      icon: '🖼️' },
  { id: 'audiences', label: 'קהל יעד',   icon: '🎯' },
  { id: 'calendar',  label: 'לוח שנה',   icon: '📅' },
];


export default function Marketing() {
  const { businessProfile } = useOutletContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const bpId = businessProfile?.id;
  const [activeTab,       setActiveTab]       = useState('paid');
  const [showOrgCreate,   setShowOrgCreate]   = useState(false);
  const [organicCtx,      setOrganicCtx]      = useState(null);
  const [showWaBlast,     setShowWaBlast]     = useState(false);
  const [waBlastCtx,      setWaBlastCtx]      = useState(null);
  const [statusFilter,    setStatusFilter]    = useState('active');
  const [campaignSearch,  setCampaignSearch]  = useState('');

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

  const filteredCampaigns = campaigns.filter(c => {
    const tab = STATUS_FILTER_TABS.find(t => t.key === statusFilter);
    const matchesStatus = tab ? tab.match.includes(c.status) : true;
    const matchesSearch = !campaignSearch || (c.title || '').toLowerCase().includes(campaignSearch.toLowerCase());
    return matchesStatus && matchesSearch;
  });

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
    } catch (err) { toast.error(`שגיאה בניתוח קהל יעד: ${err?.message || 'נסה שוב'}`); }
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
        ? `קהל ראשי: ${latestAudience.primary_audience.age_range}, ${latestAudience.primary_audience.gender_skew}.`
        : '';
      const res = await base44.integrations.Core.InvokeLLM({
        model: 'sonnet',
        maxTokens: 700,
        prompt: `אתה מומחה לפרסום ממוקד עבור עסקים קטנים ישראלים.
עסק: "${businessProfile?.name}" (${businessProfile?.category}, ${businessProfile?.city}).
${audienceCtx}
אותות שוק ומודיעין שנאסף: ${signalContext || 'אין'}.
בהתבסס על המידע שנאסף, צור תוכנית קהל יעד מפורטת. JSON בלבד:
{"segments":[{"name":"","description":"","age":"","gender":"","interests":[],"pain_points":[],"best_channels":[],"message_angle":"","budget_priority":"high"}],"top_insight":"","recommended_first_campaign":""}`,
      });
      const txt = typeof res === 'string' ? res : (res?.content || '{}');
      const match = txt.match(/\{[\s\S]*\}/);
      setAudiencePlan(match ? JSON.parse(match[0]) : null);
    } catch (err) { toast.error('שגיאה ביצירת תוכנית: ' + (err?.message || '')); }
    setPlanLoading(false);
  };

  // ── Stats ──
  const totalLeads = campaigns.reduce((s, c) => s + (c.conversions || c.leads_count || 0), 0);
  const activeLeads = campaigns.filter(c => ['active', 'published'].includes(c.status)).reduce((s, c) => s + (c.conversions || 0), 0);
  const platformsUsed = [...new Set(campaigns.map(c => c.platform).filter(Boolean))].length;
  const dailyBudget = campaigns.filter(c => c.status === 'active').reduce((s, c) => s + (c.daily_budget_ils || 0), 0);

  const pendingLaunch = campaigns.filter(c => c.status === 'pending_launch');
  const urgentActions = pendingLaunch.slice(0, 2).map(c => ({
    title: `קמפיין ממתין לפרסום: ${c.title}`,
    description: c.platform ? `פלטפורמה: ${PLATFORM_CONFIG[c.platform]?.label || c.platform}` : '',
    ctaLabel: 'פרסם עכשיו',
    onCta: () => navigate(`/marketing/create?campaignId=${c.id}`),
  }));

  const statCards = [
    { count: totalLeads,          label: 'לידים מהיום',       borderColor: 'blue' },
    { count: activeLeads,         label: 'לידים חמים',        borderColor: 'red' },
    { count: platformsUsed,       label: 'מקורות',            borderColor: 'yellow' },
    { count: `₪${dailyBudget}`,   label: 'תקציב פרסום יומי', borderColor: 'none' },
  ];

  return (
    <div className="space-y-5">
      {/* Header row: title + status filter tabs + new campaign button */}
      <div dir="rtl" className="flex items-center gap-3 mb-6 flex-wrap">
        {/* Title */}
        <div className="text-right">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-foreground">{campaigns.length}</span>
            <span className="text-lg font-semibold text-foreground">מרכז השיווק</span>
          </div>
          <p className="text-xs text-foreground-muted mt-0.5">ניהול קמפיינים ממומנים, פוסטים אורגניים וניתוח קהל יעד</p>
        </div>

        {/* Status filter tabs */}
        <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl flex-1 justify-center flex-wrap">
          {STATUS_FILTER_TABS.map(tab => {
            const cnt = campaigns.filter(c => tab.match.includes(c.status)).length;
            return (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1 ${
                  statusFilter === tab.key
                    ? 'bg-[#e8344d] text-white shadow-sm'
                    : 'text-foreground-muted hover:text-foreground'
                }`}
              >
                {tab.label}
                {cnt > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusFilter === tab.key ? 'bg-white/30 text-white' : 'bg-gray-200 text-gray-600'}`}>{cnt}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* New campaign button */}
        <button
          onClick={() => navigate('/marketing/create')}
          className="flex items-center gap-1.5 bg-foreground text-background px-4 py-2 rounded-full text-sm font-semibold hover:opacity-85 transition-opacity shadow-sm flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          קמפיין חדש
        </button>
      </div>

      <StatCards cards={statCards} />

      {urgentActions.length > 0 && (
        <UrgentActionsSection actions={urgentActions} />
      )}

      <BusinessSocialSnapshot businessProfile={businessProfile} />

      {/* Secondary tab bar */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === tab.id ? 'bg-white shadow-sm text-foreground' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Campaigns table */}
      {activeTab === 'paid' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {/* Section header with search */}
          <div dir="rtl" className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Radio className="w-3 h-3 text-green-500" />
              <span className="text-[13px] font-semibold text-foreground">קמפיינים</span>
            </div>
            <div className="flex items-center gap-2 mr-auto">
              {/* Dropdowns first so search appears leftmost in RTL */}
              <button className="flex items-center gap-1 px-3 py-1.5 text-[12px] border border-border rounded-lg bg-secondary/50 text-foreground-muted hover:text-foreground transition-colors">
                ממומן / אורגני
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <button className="flex items-center gap-1 px-3 py-1.5 text-[12px] border border-border rounded-lg bg-secondary/50 text-foreground-muted hover:text-foreground transition-colors">
                כל הזמנים
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <div className="relative">
                <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted pointer-events-none" />
                <input
                  type="text"
                  placeholder="חיפוש"
                  value={campaignSearch}
                  onChange={e => setCampaignSearch(e.target.value)}
                  className="pr-8 pl-3 py-1.5 text-[12px] border border-border rounded-lg bg-secondary/50 focus:outline-none focus:ring-1 focus:ring-foreground/20 w-32"
                  dir="rtl"
                />
              </div>
            </div>
          </div>

          {/* Table column headers */}
          <div dir="rtl" className="flex items-center gap-3 px-4 py-2 bg-secondary/30 border-b border-border text-[11px] font-semibold text-foreground-muted">
            <span className="flex-1">קמפיין</span>
            <span className="w-8 text-center">פלטפורמה</span>
            <span className="w-12 text-center">לידים</span>
            <span className="w-16 text-center">יחס המרה</span>
            <span className="w-40 text-right">תקציב ומשך</span>
            <span className="w-12 text-center">סטאטוס</span>
            <span className="w-4" />
          </div>

          {/* Rows */}
          {loadingPaid ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-foreground-muted" /></div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-[13px] text-foreground-muted mb-4">אין קמפיינים בקטגוריה זו</p>
              <button onClick={() => navigate('/marketing/create')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-full text-[12px] font-semibold hover:opacity-90">
                <Plus className="w-4 h-4" /> צור קמפיין
              </button>
            </div>
          ) : (
            <div>
              {filteredCampaigns.map(c => (
                <CampaignRow
                  key={c.id}
                  campaign={c}
                  onDelete={(id) => deleteCampaign.mutate(id)}
                  bpId={bpId}
                  onToggle={(camp) => {
                    const newStatus = ['active', 'published'].includes(camp.status) ? 'paused' : 'active';
                    base44.entities.Campaign.update(camp.id, { status: newStatus })
                      .then(() => queryClient.invalidateQueries({ queryKey: ['campaigns', bpId] }));
                  }}
                />
              ))}
            </div>
          )}
        </div>
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

      {/* Media library tab */}
      {activeTab === 'media' && (
        <MediaLibrary businessProfileId={bpId} />
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
    </div>
  );
}
