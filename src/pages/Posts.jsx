import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { LONG_SCAN_TIMEOUT_MS } from '@/api/client';
import { Plus, Loader2, Sparkles, Upload, RefreshCw, Send, Image as ImageIcon, X, Trash2, CheckCircle2, Calendar, Wand2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/shared/PageHeader';
import MediaLibrary from '@/components/marketing/MediaLibrary';
import BusinessSocialSnapshot from '@/components/marketing/BusinessSocialSnapshot';
import SocialProfileSuggestions from '@/components/marketing/SocialProfileSuggestions';
import { PLATFORM_LABELS } from '@/components/competitors/socialShared';

const _apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:3007/api').replace(/\/$/, '');

const ORGANIC_PLATFORMS = [
  { id: 'instagram', label: 'Instagram', icon: '📸', color: '#e1306c', bg: '#fde8f0' },
  { id: 'facebook',  label: 'Facebook',  icon: '📘', color: '#1877f2', bg: '#e7f3ff' },
];

const ORGANIC_STATUS = {
  draft:     { label: 'טיוטה', cls: 'bg-gray-100 text-gray-500' },
  published: { label: 'פורסם', cls: 'bg-green-50 text-green-700' },
};

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

function fmtDateTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Local (not UTC) Y-M-D — Date#toISOString() is UTC and shifts the calendar
// day for any non-UTC timezone (e.g. Israel's UTC+3 turns local midnight into
// the previous day), which breaks day-bucketing in CalendarView below.
function localYMD(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// datetime-local <input> uses the browser's local time, with no timezone info —
// this just formats/parses that local wall-clock string, no conversion needed.
function isoToLocalInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TABS = [
  { id: 'posts', label: 'פוסטים', icon: '📄' },
  { id: 'calendar', label: 'לוח שנה', icon: '📅' },
  { id: 'media', label: 'מדיה',   icon: '🖼️' },
];

// ── Organic Post Card ─────────────────────────────────────────────────────────

function OrganicCard({ post, onDelete, onOpen }) {
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
        {post.approved_at && (
          <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">
            <CheckCircle2 className="w-3 h-3" /> מאושר
          </span>
        )}
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${post.approved_at ? '' : 'mr-auto'} ${status.cls}`}>{status.label}</span>
      </div>
      <button onClick={() => onOpen(post)} className="flex gap-3 p-4 w-full text-right hover:bg-secondary/30 transition-colors">
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
      </button>
      <div className="flex items-center gap-2 px-4 py-2 border-t border-border bg-secondary/30">
        {post.scheduled_at && post.status !== 'published' ? (
          <span className="flex items-center gap-1 text-[10px] text-foreground-muted mr-auto">
            <Calendar className="w-3 h-3" /> מתוזמן ל-{fmtDateTime(post.scheduled_at)}
          </span>
        ) : (
          <span className="text-[10px] text-foreground-muted mr-auto">{fmtDate(post.published_at || post.created_date)}</span>
        )}
        <button onClick={() => onDelete(post.id)} className="text-[11px] text-foreground-muted hover:text-red-500 transition-colors">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── Organic Post Detail / Approve Modal ───────────────────────────────────────

function OrganicPostDetailModal({ post, businessProfile, onClose, onToggleApprove, toggling, onPublish, publishing }) {
  const queryClient = useQueryClient();
  const platCfg = ORGANIC_PLATFORMS.find(p => p.id === post.platform) || ORGANIC_PLATFORMS[0];
  const status  = ORGANIC_STATUS[post.status] || ORGANIC_STATUS.draft;
  const approved = !!post.approved_at;
  const published = post.status === 'published';

  const [editing,  setEditing]  = useState(false);
  const [content,  setContent]  = useState(post.content || '');
  const [imageUrl, setImageUrl] = useState(post.image_url || '');
  const [mediaId,  setMediaId]  = useState(post.media_asset_id || null);
  const [imageDesc, setImageDesc] = useState('');
  const [genImage,  setGenImage]  = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const [scheduleMode, setScheduleMode] = useState(post.scheduled_at ? 'manual' : 'none');
  const [scheduledAt,  setScheduledAt]  = useState(post.scheduled_at ? isoToLocalInputValue(post.scheduled_at) : '');
  const [aiTimeReason, setAiTimeReason] = useState('');
  const [suggestingTime, setSuggestingTime] = useState(false);

  const handleAiSchedule = useCallback(async () => {
    setScheduleMode('auto');
    setSuggestingTime(true);
    try {
      const res = await base44.functions.invoke('suggestPostTime', {
        businessProfileId: businessProfile.id, platform: post.platform, postType: post.post_type, content,
      });
      const data = res?.data || res;
      if (data?.scheduled_at) {
        setScheduledAt(isoToLocalInputValue(data.scheduled_at));
        setAiTimeReason(data.reasoning || '');
      }
    } catch { toast.error('שגיאה בבחירת מועד'); setScheduleMode('none'); }
    setSuggestingTime(false);
  }, [businessProfile?.id, post.platform, post.post_type, content]);

  const handlePickFromLibrary = (asset) => {
    const src = asset.url || (asset.image_base64 ? `data:${asset.mime_type || 'image/jpeg'};base64,${asset.image_base64}` : '');
    if (!src) return;
    setImageUrl(src);
    setMediaId(asset.id);
    setImageDesc(asset.description || '');
    setShowPicker(false);
  };

  const handleGenImage = async () => {
    setGenImage(true);
    try {
      const res = await base44.functions.invoke('generateImage', {
        businessProfileId: businessProfile.id,
        post_text: content,
      });
      const data = res?.data || res;
      if (data?.url) {
        setImageUrl(data.url);
        try {
          if (data.url.startsWith('data:')) {
            const b64 = data.url.split(',')[1];
            const asset = await base44.entities.MediaAsset.create({
              linked_business: businessProfile.id,
              image_base64: b64,
              mime_type: 'image/png',
              source: 'ai_generated',
              description: content.slice(0, 80),
              used_in: post.post_type,
            });
            setMediaId(asset.id);
          }
        } catch {}
      }
    } catch { toast.error('שגיאה ביצירת תמונה'); }
    setGenImage(false);
  };

  const handleUpload = async (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      setImageUrl(dataUrl);
      setAnalyzing(true);
      try {
        const b64 = dataUrl.split(',')[1];
        const mime = file.type || 'image/jpeg';
        try {
          const asset = await base44.entities.MediaAsset.create({
            linked_business: businessProfile.id,
            image_base64:    b64,
            mime_type:       mime,
            source:          'uploaded',
            used_in:         post.post_type,
          });
          setMediaId(asset.id);
        } catch { /* DB save failed — publish will fall back to error */ }

        try {
          const res = await base44.functions.invoke('describeBusinessMedia', { imageBase64: dataUrl, mimeType: mime });
          const data = res?.data || res;
          if (data?.description) setImageDesc(data.description);
        } catch { /* description failed — image still works */ }
      } catch { toast.error('שגיאה בטעינת התמונה'); }
      setAnalyzing(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveEdit = async () => {
    if (!content.trim()) { toast.error('יש להזין תוכן'); return; }
    setSaving(true);
    try {
      let finalImageUrl = imageUrl;
      let finalMediaId = mediaId;
      if (!finalImageUrl) {
        try {
          const res = await base44.functions.invoke('pickRelevantMedia', { businessProfileId: businessProfile.id, content });
          const data = res?.data || res;
          if (data?.media_asset_id) { finalMediaId = data.media_asset_id; finalImageUrl = data.image_url; }
        } catch { /* no match / call failed — post is saved without an image */ }
      }

      await base44.entities.OrganicPost.update(post.id, {
        content,
        media_asset_id: finalMediaId || null,
        image_url:      finalImageUrl || null,
        scheduled_at:   scheduleMode !== 'none' && scheduledAt ? new Date(scheduledAt).toISOString() : null,
        approved_at:    null, // edited after approval — needs a fresh look before it can publish
      });
      queryClient.invalidateQueries({ queryKey: ['organicPosts', businessProfile.id] });
      toast.success('הפוסט עודכן');
      onClose();
    } catch (err) {
      toast.error('שגיאה בשמירה: ' + (err?.message || 'נסה שוב'));
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" dir="rtl" onClick={onClose}>
      {showPicker && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowPicker(false)}>
          <div className="relative max-w-lg w-full max-h-[80vh] overflow-y-auto bg-card rounded-2xl shadow-2xl p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-bold text-foreground">בחר מהספרייה</h3>
              <button onClick={() => setShowPicker(false)} className="text-foreground-muted hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <MediaLibrary businessProfileId={businessProfile.id} onSelect={handlePickFromLibrary} />
          </div>
        </div>
      )}

      <div className="w-full max-w-lg bg-card rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
          <span className="text-[14px]">{platCfg.icon}</span>
          <span className="text-[13px] font-semibold text-foreground">{platCfg.label}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-foreground-muted">
            {post.post_type === 'story' ? '📱 סטורי' : '📄 פוסט'}
          </span>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
          {!editing && !published && (
            <button onClick={() => setEditing(true)} className="mr-auto text-foreground-muted hover:text-foreground" title="ערוך פוסט">
              <Pencil className="w-4 h-4" />
            </button>
          )}
          <button onClick={onClose} className={editing || published ? 'mr-auto text-foreground-muted hover:text-foreground' : 'text-foreground-muted hover:text-foreground'}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {!editing ? (
          <div className="p-5 space-y-4">
            {post.signal_summary && (
              <p className="text-[11px] text-foreground-muted opacity-70">💡 {post.signal_summary}</p>
            )}
            {post.scheduled_at && (
              <p className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
                <Calendar className="w-3.5 h-3.5" /> מתוזמן לפרסום: {fmtDateTime(post.scheduled_at)}
              </p>
            )}
            {post.image_url && (
              <img src={post.image_url} alt="" className="w-full max-h-96 object-cover rounded-xl border border-border" />
            )}
            <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{post.content || '(אין תוכן)'}</p>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Image */}
            <div>
              <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">תמונה</p>
              {imageUrl ? (
                <div className="relative">
                  <img src={imageUrl} alt=""
                    className={`w-full object-cover rounded-xl border border-border ${post.post_type === 'story' ? 'aspect-[9/16] max-h-64' : 'h-40'}`} />
                  {analyzing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl">
                      <div className="text-white text-[12px] flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> מנתח תמונה...
                      </div>
                    </div>
                  )}
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
              <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">תוכן</p>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                rows={post.post_type === 'story' ? 3 : 5}
                className="w-full text-[13px] text-foreground bg-secondary border border-border rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
              />
            </div>

            {/* Scheduling */}
            <div>
              <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">מתי לפרסם? (אופציונלי)</p>
              <div className="flex items-center gap-1 p-1 bg-secondary rounded-lg w-fit mb-2">
                {[
                  { id: 'none', label: 'לא לתזמן' },
                  { id: 'manual', label: 'אני אבחר' },
                ].map(m => (
                  <button key={m.id} onClick={() => setScheduleMode(m.id)}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                      scheduleMode === m.id ? 'bg-white shadow-sm text-foreground' : 'text-foreground-muted hover:text-foreground'
                    }`}>
                    {m.label}
                  </button>
                ))}
                <button onClick={handleAiSchedule} disabled={suggestingTime}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all disabled:opacity-60 ${
                    scheduleMode === 'auto' ? 'bg-white shadow-sm text-foreground' : 'text-foreground-muted hover:text-foreground'
                  }`}>
                  {suggestingTime ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                  AI יבחר
                </button>
              </div>
              {scheduleMode !== 'none' && (
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={e => { setScheduledAt(e.target.value); setScheduleMode('manual'); setAiTimeReason(''); }}
                  className="w-full text-[13px] text-foreground bg-secondary border border-border rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              )}
              {scheduleMode === 'auto' && aiTimeReason && (
                <p className="text-[10px] text-foreground-muted mt-1">✨ {aiTimeReason}</p>
              )}
            </div>

            {approved && (
              <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                שינויים בפוסט מאושר יבטלו את האישור — יהיה צריך לאשר מחדש לפני פרסום.
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2 px-5 py-4 border-t border-border">
          {editing ? (
            <>
              <button onClick={() => { setEditing(false); setContent(post.content || ''); setImageUrl(post.image_url || ''); setMediaId(post.media_asset_id || null); }}
                disabled={saving}
                className="flex-1 py-2.5 border border-border rounded-xl text-[13px] text-foreground-muted hover:text-foreground transition-colors disabled:opacity-60">
                ביטול
              </button>
              <button onClick={handleSaveEdit} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-foreground text-background rounded-xl text-[13px] font-bold hover:opacity-90 transition-all disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {saving ? 'שומר...' : 'שמור שינויים'}
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose}
                className="flex-1 py-2.5 border border-border rounded-xl text-[13px] text-foreground-muted hover:text-foreground transition-colors">
                סגור
              </button>
              <button onClick={() => onToggleApprove(post)} disabled={toggling}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold transition-all disabled:opacity-60 ${
                  approved ? 'border border-green-300 text-green-700 hover:bg-green-50' : 'bg-green-600 text-white hover:opacity-90'
                }`}>
                {toggling ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {approved ? 'בטל אישור' : 'אשר פוסט'}
              </button>
              {approved && !published && (
                <button onClick={() => onPublish(post)} disabled={publishing}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-foreground text-background rounded-xl text-[13px] font-bold hover:opacity-90 transition-all disabled:opacity-60">
                  {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {publishing ? 'מפרסם...' : 'פרסם עכשיו'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Bulk Generate Setup Modal ──────────────────────────────────────────────────

function BulkGenerateSetupModal({ onClose, onGenerate, generating }) {
  const [count, setCount] = useState(3);
  const [platform, setPlatform] = useState('both');
  const [specialRequest, setSpecialRequest] = useState('');
  const [scheduleMode, setScheduleMode] = useState('none'); // 'none' | 'manual' | 'auto'
  const [scheduledAt, setScheduledAt] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" dir="rtl" onClick={onClose}>
      <div className="w-full max-w-lg bg-card rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
          <h2 className="text-[15px] font-bold text-foreground">✨ צור פוסטים חדשים</h2>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">כמות</p>
              <input
                type="number" min={1} max={10} value={count}
                onChange={e => setCount(Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)))}
                className="w-16 text-[13px] font-bold text-foreground bg-secondary border border-border rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">פלטפורמה</p>
              <div className="flex items-center gap-1 p-1 bg-secondary rounded-lg w-fit">
                {[
                  { id: 'both', label: 'שניהם' },
                  { id: 'facebook', label: '📘 פייסבוק' },
                  { id: 'instagram', label: '📸 אינסטגרם' },
                ].map(p => (
                  <button key={p.id} onClick={() => setPlatform(p.id)}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                      platform === p.id ? 'bg-white shadow-sm text-foreground' : 'text-foreground-muted hover:text-foreground'
                    }`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">משהו ספציפי שתרצו שיופיע בפוסטים? (אופציונלי)</p>
            <textarea
              value={specialRequest}
              onChange={e => setSpecialRequest(e.target.value)}
              placeholder="לדוגמה: מבצע 20% לרגל יום האהבה, השקת מוצר חדש..."
              rows={3}
              className="w-full text-[13px] text-foreground bg-secondary border border-border rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
            />
          </div>

          <div>
            <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">מתי לפרסם? (אופציונלי)</p>
            <div className="flex items-center gap-1 p-1 bg-secondary rounded-lg w-fit mb-2">
              {[
                { id: 'none', label: 'לא לתזמן' },
                { id: 'manual', label: 'אני אבחר' },
                { id: 'auto', label: '✨ AI יבחר' },
              ].map(m => (
                <button key={m.id} onClick={() => setScheduleMode(m.id)}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                    scheduleMode === m.id ? 'bg-white shadow-sm text-foreground' : 'text-foreground-muted hover:text-foreground'
                  }`}>
                  {m.label}
                </button>
              ))}
            </div>
            {scheduleMode === 'manual' && (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={e => setScheduledAt(e.target.value)}
                className="w-full text-[13px] text-foreground bg-secondary border border-border rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            )}
            {scheduleMode === 'auto' && (
              <p className="text-[11px] text-foreground-muted">ה-AI יבחר לכל פוסט את המועד הטוב ביותר לפי הפלטפורמה וסוג התוכן.</p>
            )}
          </div>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-border rounded-xl text-[13px] text-foreground-muted hover:text-foreground transition-colors">
            ביטול
          </button>
          <button
            onClick={() => onGenerate({
              count,
              platform,
              special_request: specialRequest.trim() || undefined,
              scheduled_at: scheduleMode === 'manual' && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
              auto_schedule: scheduleMode === 'auto',
            })}
            disabled={generating}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-foreground text-background rounded-xl text-[13px] font-bold hover:opacity-90 disabled:opacity-60">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? 'יוצר...' : 'צור פוסטים'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bulk Review Queue Modal ─────────────────────────────────────────────────────

function BulkReviewQueueModal({ posts, index, onClose, onApprove, onDisapprove, onRevise, busy }) {
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [revising, setRevising] = useState(false);
  const post = posts[index];
  if (!post) return null;

  const platCfg = ORGANIC_PLATFORMS.find(p => p.id === post.platform) || ORGANIC_PLATFORMS[0];

  const submitFeedback = async () => {
    if (!feedback.trim()) return;
    setRevising(true);
    await onRevise(post, feedback.trim());
    setRevising(false);
    setFeedback('');
    setFeedbackMode(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" dir="rtl">
      <div className="w-full max-w-lg bg-card rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
          <span className="text-[14px]">{platCfg.icon}</span>
          <span className="text-[13px] font-semibold text-foreground">{platCfg.label}</span>
          <span className="text-[11px] text-foreground-muted mr-auto">פוסט {index + 1} מתוך {posts.length}</span>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {post.image_url && (
            <img src={post.image_url} alt="" className="w-full max-h-80 object-cover rounded-xl border border-border" />
          )}
          <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{post.content || '(אין תוכן)'}</p>

          {feedbackMode && (
            <div className="space-y-2">
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                placeholder="מה תרצו לשנות?"
                rows={3}
                autoFocus
                className="w-full text-[13px] text-foreground bg-secondary border border-border rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
              />
              <div className="flex gap-2">
                <button onClick={() => { setFeedbackMode(false); setFeedback(''); }}
                  className="flex-1 py-2 text-[12px] border border-border rounded-lg text-foreground-muted hover:text-foreground transition-colors">
                  ביטול
                </button>
                <button onClick={submitFeedback} disabled={revising || !feedback.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium bg-foreground text-background rounded-lg disabled:opacity-60">
                  {revising && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  שלח בקשה
                </button>
              </div>
            </div>
          )}
        </div>

        {!feedbackMode && (
          <div className="flex gap-2 px-5 py-4 border-t border-border">
            <button onClick={() => onDisapprove(post)} disabled={busy}
              className="flex-1 py-2.5 border border-red-200 text-red-600 rounded-xl text-[13px] font-medium hover:bg-red-50 transition-colors disabled:opacity-60">
              דחה
            </button>
            <button onClick={() => setFeedbackMode(true)} disabled={busy}
              className="flex-1 py-2.5 border border-border rounded-xl text-[13px] text-foreground-muted hover:text-foreground transition-colors disabled:opacity-60">
              בקש שינוי
            </button>
            <button onClick={() => onApprove(post)} disabled={busy}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-green-600 text-white rounded-xl text-[13px] font-bold hover:opacity-90 disabled:opacity-60">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              אשר
            </button>
          </div>
        )}
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
  const [specialRequest, setSpecialRequest] = useState('');
  const [imageUrl, setImageUrl]   = useState('');
  const [mediaId,  setMediaId]    = useState(null);
  const [imageDesc, setImageDesc] = useState('');

  const [genContent,  setGenContent]  = useState(false);
  const [genImage,    setGenImage]    = useState(false);
  const [analyzing,   setAnalyzing]   = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [imgPreview,  setImgPreview]  = useState(false);
  const [showPicker,  setShowPicker]  = useState(false);

  const [scheduleMode, setScheduleMode]   = useState('none'); // 'none' | 'manual' | 'auto'
  const [scheduledAt,  setScheduledAt]    = useState('');
  const [aiTimeReason, setAiTimeReason]   = useState('');
  const [suggestingTime, setSuggestingTime] = useState(false);

  const handleAiSchedule = useCallback(async () => {
    setScheduleMode('auto');
    setSuggestingTime(true);
    try {
      const res = await base44.functions.invoke('suggestPostTime', {
        businessProfileId: businessProfile.id, platform, postType, content,
      });
      const data = res?.data || res;
      if (data?.scheduled_at) {
        setScheduledAt(isoToLocalInputValue(data.scheduled_at));
        setAiTimeReason(data.reasoning || '');
      }
    } catch { toast.error('שגיאה בבחירת מועד'); setScheduleMode('none'); }
    setSuggestingTime(false);
  }, [businessProfile?.id, platform, postType, content]);

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
${specialRequest.trim() ? `בקשה ספציפית מבעל העסק — חובה לשלב בפוסט: "${specialRequest.trim()}"` : ''}
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
  }, [businessProfile, postType, platCfg.label, platform, signalContext, audienceData, recentSignals, imageDesc, specialRequest]);

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
      // If the owner didn't pick/generate/upload an image, let the system
      // match one from the media library — never invent one, better no image
      // than an irrelevant one (same guardrail as bulk-generate).
      let finalImageUrl = imageUrl;
      let finalMediaId = mediaId;
      if (!finalImageUrl) {
        try {
          const res = await base44.functions.invoke('pickRelevantMedia', { businessProfileId: businessProfile.id, content });
          const data = res?.data || res;
          if (data?.media_asset_id) {
            finalMediaId = data.media_asset_id;
            finalImageUrl = data.image_url;
          }
        } catch { /* no match / call failed — post is saved without an image */ }
      }

      // 1. Save to DB (as draft first, so we have an ID)
      const post = await base44.entities.OrganicPost.create({
        linked_business: businessProfile.id,
        signal_id:       signalContext?.signalId || null,
        signal_summary:  signalContext?.summary  || null,
        platform,
        post_type:       postType,
        content,
        media_asset_id:  finalMediaId || null,
        image_url:       finalImageUrl || null,
        status:          'draft',
        published_at:    null,
        scheduled_at:    scheduleMode !== 'none' && scheduledAt ? new Date(scheduledAt).toISOString() : null,
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
            imageUrl:      finalImageUrl || null,
            mediaAssetId:  finalMediaId  || null,
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

          {/* Special request */}
          <div>
            <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">משהו ספציפי שתרצו שיופיע בפוסט? (אופציונלי)</p>
            <textarea
              value={specialRequest}
              onChange={e => setSpecialRequest(e.target.value)}
              placeholder="לדוגמה: מבצע 20% לרגל יום האהבה, השקת מוצר חדש..."
              rows={2}
              className="w-full text-[13px] text-foreground bg-secondary border border-border rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
            />
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
              {content && (
                <button onClick={generateContent} disabled={genContent}
                  className="flex items-center gap-1 text-[10px] text-foreground-muted hover:text-foreground transition-colors">
                  {genContent ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  {genContent ? 'יוצר...' : 'צור מחדש'}
                </button>
              )}
            </div>
            {!content && (
              <button onClick={generateContent} disabled={genContent}
                className="w-full flex items-center justify-center gap-2 py-2.5 mb-2 bg-foreground text-background rounded-xl text-[13px] font-bold hover:opacity-90 disabled:opacity-60 transition-all">
                {genContent ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {genContent ? 'יוצר תוכן...' : 'צור תוכן עם AI'}
              </button>
            )}
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={postType === 'story' ? 3 : 5}
              placeholder={postType === 'story' ? 'טקסט לסטורי... (או השתמשו ב-AI למעלה)' : 'תוכן הפוסט... (או השתמשו ב-AI למעלה)'}
              className="w-full text-[13px] text-foreground bg-secondary border border-border rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
            />
          </div>

          {/* Scheduling */}
          <div>
            <p className="text-[10px] font-semibold text-foreground-muted mb-1.5">מתי לפרסם? (אופציונלי)</p>
            <div className="flex items-center gap-1 p-1 bg-secondary rounded-lg w-fit mb-2">
              {[
                { id: 'none', label: 'לא לתזמן' },
                { id: 'manual', label: 'אני אבחר' },
              ].map(m => (
                <button key={m.id} onClick={() => setScheduleMode(m.id)}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                    scheduleMode === m.id ? 'bg-white shadow-sm text-foreground' : 'text-foreground-muted hover:text-foreground'
                  }`}>
                  {m.label}
                </button>
              ))}
              <button onClick={handleAiSchedule} disabled={suggestingTime}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all disabled:opacity-60 ${
                  scheduleMode === 'auto' ? 'bg-white shadow-sm text-foreground' : 'text-foreground-muted hover:text-foreground'
                }`}>
                {suggestingTime ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                AI יבחר
              </button>
            </div>
            {scheduleMode !== 'none' && (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={e => { setScheduledAt(e.target.value); setScheduleMode('manual'); setAiTimeReason(''); }}
                className="w-full text-[13px] text-foreground bg-secondary border border-border rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            )}
            {scheduleMode === 'auto' && aiTimeReason && (
              <p className="text-[10px] text-foreground-muted mt-1">✨ {aiTimeReason}</p>
            )}
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
    const rawDate = post.scheduled_at || post.published_at || post.created_date;
    if (!rawDate) return;
    const dateStr = localYMD(rawDate);
    if (!postsByDay[dateStr]) postsByDay[dateStr] = [];
    postsByDay[dateStr].push(post);
  });

  const weekLabel = `${days[0].toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })} – ${days[6].toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  const todayStr = localYMD(today);

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
          const dateKey = localYMD(day);
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
                const time = p.scheduled_at
                  ? new Date(p.scheduled_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
                  : null;
                return (
                  <div key={p.id} className="rounded-lg px-1.5 py-1 text-[9px] leading-tight truncate" style={{ background: platCfg?.color + '22', color: platCfg?.color || '#555' }}>
                    {platCfg?.icon} {time && <span className="font-semibold">{time} · </span>}{p.content?.slice(0, 30) || '(פוסט)'}
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

// ── Main Posts Page ────────────────────────────────────────────────────────────

export default function Posts() {
  const { businessProfile } = useOutletContext();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const bpId = businessProfile?.id;
  const [activeTab,     setActiveTab]     = useState('posts');
  const [showOrgCreate, setShowOrgCreate] = useState(false);
  const [organicCtx,    setOrganicCtx]    = useState(null);

  const availableSocialPlatforms = [
    (businessProfile?.facebook_url || businessProfile?.facebook_page_id) ? 'facebook' : null,
    businessProfile?.instagram_url ? 'instagram' : null,
  ].filter(Boolean);
  const [activeSocialPlatform, setActiveSocialPlatform] = useState(null);
  const currentSocialPlatform = activeSocialPlatform || availableSocialPlatforms[0] || 'facebook';

  // Auto-open composer if URL says so (e.g. deep-linked from a signal)
  useEffect(() => {
    if (searchParams.get('create') === 'organic') {
      setOrganicCtx({
        signalId: searchParams.get('signalId') || '',
        summary:  searchParams.get('summary')  || '',
        action:   searchParams.get('action')   || '',
        type:     searchParams.get('type')     || 'post',
      });
      setShowOrgCreate(true);
    }
  }, []); // eslint-disable-line

  const { data: organicPosts = [], isLoading: loadingOrganic } = useQuery({
    queryKey: ['organicPosts', bpId],
    queryFn: () => base44.entities.OrganicPost.filter({ linked_business: bpId }, '-created_date', 50),
    enabled: !!bpId,
  });

  const deleteOrganic = useMutation({
    mutationFn: (id) => base44.entities.OrganicPost.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['organicPosts', bpId] }); toast.success('נמחק'); },
  });

  const [detailPost, setDetailPost] = useState(null);

  const approveOrganic = useMutation({
    mutationFn: ({ id, approve }) => base44.entities.OrganicPost.update(id, { approved_at: approve ? new Date().toISOString() : null }),
    onSuccess: (_data, { approve }) => {
      queryClient.invalidateQueries({ queryKey: ['organicPosts', bpId] });
      setDetailPost(null);
      toast.success(approve ? 'הפוסט אושר' : 'האישור בוטל');
    },
    onError: (err) => toast.error('שגיאה: ' + (err?.message || 'נסה שוב')),
  });

  const [publishingId, setPublishingId] = useState(null);

  const handlePublish = async (post) => {
    setPublishingId(post.id);
    try {
      const res = await fetch(`${_apiBase}/social/publish-organic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-dev-user': 'dev-user' },
        body: JSON.stringify({
          businessProfileId: bpId,
          postId: post.id,
          content: post.content,
          imageUrl: post.image_url || null,
          mediaAssetId: post.media_asset_id || null,
          platform: post.platform,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאת פרסום');
      queryClient.invalidateQueries({ queryKey: ['organicPosts', bpId] });
      setDetailPost(null);
      toast.success('פורסם בהצלחה! 🎉');
    } catch (err) {
      toast.error('שגיאה בפרסום: ' + (err?.message || 'נסה שוב'));
    }
    setPublishingId(null);
  };

  const [showBulkSetup, setShowBulkSetup] = useState(false);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [reviewQueue, setReviewQueue] = useState(null); // array of posts, or null when closed
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewBusy, setReviewBusy] = useState(false);

  const handleBulkGenerate = async ({ count, platform, special_request, scheduled_at, auto_schedule }) => {
    setBulkGenerating(true);
    try {
      const res = await base44.functions.invoke('generateBulkPosts', { businessProfileId: bpId, count, platform, special_request, scheduled_at, auto_schedule }, LONG_SCAN_TIMEOUT_MS);
      const data = res?.data || res;
      await queryClient.invalidateQueries({ queryKey: ['organicPosts', bpId] });
      toast.success(`נוצרו ${data?.created ?? 0} מתוך ${data?.requested ?? count} פוסטים`);
      setShowBulkSetup(false);
      if (data?.posts?.length) {
        setReviewQueue(data.posts);
        setReviewIndex(0);
      }
    } catch (err) {
      toast.error('שגיאה ביצירת פוסטים: ' + (err?.message || 'נסה שוב'));
    }
    setBulkGenerating(false);
  };

  const advanceReview = () => {
    setReviewIndex(i => {
      const next = i + 1;
      if (!reviewQueue || next >= reviewQueue.length) {
        setReviewQueue(null);
        return 0;
      }
      return next;
    });
  };

  const handleReviewApprove = async (post) => {
    setReviewBusy(true);
    try {
      await approveOrganic.mutateAsync({ id: post.id, approve: true });
      advanceReview();
    } catch {}
    setReviewBusy(false);
  };

  const handleReviewDisapprove = async (post) => {
    setReviewBusy(true);
    try {
      await deleteOrganic.mutateAsync(post.id);
      advanceReview();
    } catch {}
    setReviewBusy(false);
  };

  const handleReviewRevise = async (post, feedback) => {
    try {
      const res = await base44.functions.invoke('revisePost', { postId: post.id, feedback }, LONG_SCAN_TIMEOUT_MS);
      const data = res?.data || res;
      if (data?.content) {
        setReviewQueue(q => q.map(p => p.id === post.id ? { ...p, content: data.content } : p));
      }
    } catch (err) {
      toast.error('שגיאה בעדכון הפוסט: ' + (err?.message || 'נסה שוב'));
    }
  };

  const { data: marketSignals = [] } = useQuery({
    queryKey: ['marketSignalsForAudience', bpId],
    queryFn: () => base44.entities.MarketSignal.filter(
      { linked_business: bpId },
      '-detected_at', 30
    ),
    enabled: !!bpId && showOrgCreate,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        count={organicPosts.length}
        title="ניהול סושיאל"
        subtitle="יצירת פוסטים אורגניים, תמונות ופרסום לרשתות החברתיות"
      />

      {availableSocialPlatforms.length > 1 && (
        <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl w-fit">
          {availableSocialPlatforms.map(p => (
            <button
              key={p}
              onClick={() => setActiveSocialPlatform(p)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                currentSocialPlatform === p ? 'bg-white shadow-sm text-foreground' : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
      )}

      <SocialProfileSuggestions
        businessProfile={businessProfile}
        platform={currentSocialPlatform}
        onCreatePost={() => setShowOrgCreate(true)}
      />

      <BusinessSocialSnapshot businessProfile={businessProfile} platform={currentSocialPlatform} />

      {/* Sub-tab bar */}
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

      {/* Posts tab */}
      {activeTab === 'posts' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-[12px] text-foreground-muted">
              {organicPosts.length} פוסטים
              {!(businessProfile?.content_trends_copy_insight || businessProfile?.outlier_insight) && (
                <span className="text-foreground-muted/60"> · 💡 הריצו ניתוח מגמות תוכן מתחרים לתוצאות טובות יותר ביצירה עם AI</span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowOrgCreate(true)} disabled={!bpId}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[11px] font-medium text-foreground-muted hover:text-foreground hover:bg-secondary transition-all disabled:opacity-60">
                <Plus className="w-3.5 h-3.5" /> פוסט חדש
              </button>
              <button onClick={() => setShowBulkSetup(true)} disabled={!bpId}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground text-background rounded-lg text-[11px] font-semibold hover:opacity-90 disabled:opacity-60">
                <Sparkles className="w-3.5 h-3.5" /> צור פוסטים חדשים
              </button>
            </div>
          </div>

          {loadingOrganic ? (
            <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-foreground-muted" /></div>
          ) : organicPosts.length === 0 ? (
            <div className="text-center py-16">
              <ImageIcon className="w-10 h-10 text-foreground-muted opacity-30 mx-auto mb-3" />
              <p className="text-[13px] text-foreground-muted">אין פוסטים עדיין</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {organicPosts.map(p => (
                <OrganicCard key={p.id} post={p} onDelete={(id) => deleteOrganic.mutate(id)} onOpen={(post) => setDetailPost(post)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Calendar tab */}
      {activeTab === 'calendar' && (
        <CalendarView posts={organicPosts} />
      )}

      {/* Media library tab */}
      {activeTab === 'media' && (
        <MediaLibrary businessProfileId={bpId} />
      )}

      {showOrgCreate && (
        <OrganicCreateDrawer
          businessProfile={businessProfile}
          signalContext={organicCtx}
          recentSignals={marketSignals}
          onClose={() => setShowOrgCreate(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['organicPosts', bpId] })}
        />
      )}

      {detailPost && (
        <OrganicPostDetailModal
          post={detailPost}
          businessProfile={businessProfile}
          onClose={() => setDetailPost(null)}
          onToggleApprove={(post) => approveOrganic.mutate({ id: post.id, approve: !post.approved_at })}
          toggling={approveOrganic.isPending}
          onPublish={handlePublish}
          publishing={publishingId === detailPost.id}
        />
      )}

      {showBulkSetup && (
        <BulkGenerateSetupModal
          onClose={() => setShowBulkSetup(false)}
          onGenerate={handleBulkGenerate}
          generating={bulkGenerating}
        />
      )}

      {reviewQueue && (
        <BulkReviewQueueModal
          posts={reviewQueue}
          index={reviewIndex}
          onClose={() => setReviewQueue(null)}
          onApprove={handleReviewApprove}
          onDisapprove={handleReviewDisapprove}
          onRevise={handleReviewRevise}
          busy={reviewBusy}
        />
      )}
    </div>
  );
}
