import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Loader2, CheckCircle2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import {
  API_BASE, apiFetch, isFacebookAutoBio, weeklyPostingRate,
} from '@/components/competitors/socialShared';

// ponytail: starting heuristics, not tuned values — revisit once we have real usage data.
const BIO_MIN_LENGTH = 30; // chars below this = effectively no real bio content
const MIN_COMPETITOR_SAMPLE = 3; // need at least this many competitor profiles with data before comparing presence rates
const COMPETITOR_HAVE_RATE_THRESHOLD = 0.5; // flag a missing attribute once >=50% of sampled competitors have it
const POSTING_RATE_DEFICIT_RATIO = 0.5; // flag if own weekly rate is under 50% of the competitor average

function competitorHaveRate(competitorProfiles, field) {
  if (competitorProfiles.length < MIN_COMPETITOR_SAMPLE) return null;
  return competitorProfiles.filter(p => p[field]).length / competitorProfiles.length;
}

function bioIssue(profile) {
  if (!profile.bio?.trim()) return 'missing';
  if (isFacebookAutoBio(profile)) return 'auto';
  if (profile.bio.trim().length < BIO_MIN_LENGTH) return 'short';
  return null;
}

/**
 * Pure — applies the thresholds above to build the flagged-suggestion list.
 * Kept separate from the component so the trigger logic is easy to read/tune
 * in one place, independent of rendering/data-fetching concerns.
 */
export function buildSuggestions({ ownProfiles, competitorProfiles, ownWeeklyRate, competitorAvgWeeklyRate }) {
  const suggestions = [];

  // Bio and logo used to be two separate suggestion cards; combined into one
  // "analyze profile" entry point (generating a fix for each stays a
  // separate action inside the popup). bioReason is free — computed locally,
  // no LLM call — so it's attached here and shown immediately on open; the
  // logo side has no equivalent cheap heuristic, so its critique is always
  // fetched via critiqueLogo when the popup opens.
  const bioIssues = ownProfiles.map(p => bioIssue(p)).filter(Boolean);
  const bioReason = bioIssues.includes('missing') ? 'לא הוגדר ביו'
    : bioIssues.includes('auto') ? 'הביו הוא טקסט אוטומטי של הפלטפורמה'
    : bioIssues.includes('short') ? 'הביו קצר מדי ולא אומר הרבה'
    : null;
  const hasLogo = ownProfiles.some(p => p.profile_picture_url);
  if (bioReason || hasLogo) {
    suggestions.push({
      id: 'profile-analysis',
      title: 'נתחו את הפרופיל שלכם',
      description: 'ביו ותמונת פרופיל מול המתחרים שלכם',
      kind: 'profile-analysis',
      bioReason,
    });
  }

  for (const [field, label] of [
    ['profile_picture_url', 'תמונת פרופיל'],
    ['cover_photo_url', 'תמונת קאבר'],
    ['external_url', 'קישור בביו'],
    ['highlight_count', 'היילייטס'],
  ]) {
    const ownHasIt = ownProfiles.some(p => (field === 'highlight_count' ? p[field] > 0 : !!p[field]));
    if (ownHasIt) continue;
    const rate = competitorHaveRate(competitorProfiles, field);
    if (rate == null || rate < COMPETITOR_HAVE_RATE_THRESHOLD) continue;
    suggestions.push({
      id: field,
      title: `חסר לכם ${label}`,
      description: `${Math.round(rate * 100)}% מהמתחרים שאתם עוקבים אחריהם הגדירו ${label}`,
      kind: 'open-profile',
    });
  }

  if (ownWeeklyRate == null) {
    suggestions.push({
      id: 'posting-rate',
      title: 'קצב פרסום נמוך מאוד',
      description: 'לא זוהו מספיק פוסטים כדי לקבוע קצב פרסום קבוע',
      kind: 'create-post',
    });
  } else if (competitorAvgWeeklyRate != null && ownWeeklyRate < competitorAvgWeeklyRate * POSTING_RATE_DEFICIT_RATIO) {
    suggestions.push({
      id: 'posting-rate',
      title: 'אתם מפרסמים פחות מהמתחרים',
      description: `כ-${ownWeeklyRate.toFixed(1)} פוסטים בשבוע, לעומת ממוצע מתחרים של ${competitorAvgWeeklyRate.toFixed(1)}`,
      kind: 'create-post',
    });
  }

  return suggestions;
}

/**
 * Popup for reviewing one AI-generated logo candidate — accept / reject /
 * request change, mirroring the organic-post review popup (BulkReviewQueueModal
 * in Marketing.jsx). "Request change" re-generates in place with the owner's
 * feedback folded into the design brief, same pattern as post revision.
 */
function LogoReviewModal({ platform, imageUrl, style, loading, busy, onAccept, onReject, onRequestChange, onClose }) {
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [feedback, setFeedback] = useState('');

  const submitFeedback = async () => {
    if (!feedback.trim()) return;
    await onRequestChange(feedback.trim());
    setFeedback('');
    setFeedbackMode(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" dir="rtl">
      <div className="w-full max-w-lg bg-card rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
          <span className="text-[13px] font-semibold text-foreground">הצעת לוגו חדש — {platform === 'instagram' ? 'אינסטגרם' : 'פייסבוק'}</span>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground mr-auto"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
            </div>
          ) : (
            <img
              src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(imageUrl)}`}
              alt="הצעת לוגו חדש"
              className="w-full max-h-80 object-contain rounded-xl border border-border bg-secondary"
            />
          )}
          <p className="text-[11px] text-foreground-muted">
            הצעה ראשונית שנוצרה על ידי AI — אין אפשרות להעלות אותה אוטומטית לפרופיל; אם תאשרו, הורידו ותעלו אותה ידנית.
            {style === 'wordmark' && ' מודלים ליצירת תמונות לא תמיד מדייקים בטקסט (בעיקר בעברית) — אם השם יצא מטושטש, בקשו שינוי או נסו שוב.'}
          </p>

          {feedbackMode && (
            <div className="space-y-2">
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                placeholder="מה תרצו לשנות בלוגו?"
                rows={3}
                autoFocus
                className="w-full text-[13px] text-foreground bg-secondary border border-border rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
              />
              <div className="flex gap-2">
                <button onClick={() => { setFeedbackMode(false); setFeedback(''); }}
                  className="flex-1 py-2 text-[12px] border border-border rounded-lg text-foreground-muted hover:text-foreground transition-colors">
                  ביטול
                </button>
                <button onClick={submitFeedback} disabled={busy || !feedback.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium bg-foreground text-background rounded-lg disabled:opacity-60">
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  שלח בקשה
                </button>
              </div>
            </div>
          )}
        </div>

        {!feedbackMode && (
          <div className="flex gap-2 px-5 py-4 border-t border-border">
            <button onClick={onReject} disabled={loading || busy}
              className="flex-1 py-2.5 border border-red-200 text-red-600 rounded-xl text-[13px] font-medium hover:bg-red-50 transition-colors disabled:opacity-60">
              דחה
            </button>
            <button onClick={() => setFeedbackMode(true)} disabled={loading || busy}
              className="flex-1 py-2.5 border border-border rounded-xl text-[13px] text-foreground-muted hover:text-foreground transition-colors disabled:opacity-60">
              בקש שינוי
            </button>
            <button onClick={onAccept} disabled={loading || busy}
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

/**
 * Popup for reviewing the AI-suggested bio rewrite — accept / reject /
 * request change, same pattern and chrome as LogoReviewModal above.
 */
function BioReviewModal({ platform, suggestion, loading, busy, onAccept, onReject, onRequestChange, onClose }) {
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [feedback, setFeedback] = useState('');

  const submitFeedback = async () => {
    if (!feedback.trim()) return;
    await onRequestChange(feedback.trim());
    setFeedback('');
    setFeedbackMode(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" dir="rtl">
      <div className="w-full max-w-lg bg-card rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
          <span className="text-[13px] font-semibold text-foreground">הצעת ביו חדש — {platform === 'instagram' ? 'אינסטגרם' : 'פייסבוק'}</span>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground mr-auto"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
            </div>
          ) : (
            <div className="space-y-2">
              {suggestion?.suggested_bio && (
                <p className="text-[13px] leading-relaxed text-foreground whitespace-pre-line bg-secondary border border-border rounded-xl px-3 py-2.5">
                  {suggestion.suggested_bio}
                </p>
              )}
              {suggestion?.rationale && (
                <p className="text-[11px] text-foreground-muted">{suggestion.rationale}</p>
              )}
              {!suggestion?.suggested_bio && (
                <p className="text-[13px] text-red-600 dark:text-red-400">לא הצלחנו להציע ביו חדש, נסו שוב</p>
              )}
            </div>
          )}

          {feedbackMode && (
            <div className="space-y-2">
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                placeholder="מה תרצו לשנות בביו?"
                rows={3}
                autoFocus
                className="w-full text-[13px] text-foreground bg-secondary border border-border rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
              />
              <div className="flex gap-2">
                <button onClick={() => { setFeedbackMode(false); setFeedback(''); }}
                  className="flex-1 py-2 text-[12px] border border-border rounded-lg text-foreground-muted hover:text-foreground transition-colors">
                  ביטול
                </button>
                <button onClick={submitFeedback} disabled={busy || !feedback.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium bg-foreground text-background rounded-lg disabled:opacity-60">
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  שלח בקשה
                </button>
              </div>
            </div>
          )}
        </div>

        {!feedbackMode && (
          <div className="flex gap-2 px-5 py-4 border-t border-border">
            <button onClick={onReject} disabled={loading || busy}
              className="flex-1 py-2.5 border border-red-200 text-red-600 rounded-xl text-[13px] font-medium hover:bg-red-50 transition-colors disabled:opacity-60">
              דחה
            </button>
            <button onClick={() => setFeedbackMode(true)} disabled={loading || busy}
              className="flex-1 py-2.5 border border-border rounded-xl text-[13px] text-foreground-muted hover:text-foreground transition-colors disabled:opacity-60">
              בקש שינוי
            </button>
            <button onClick={onAccept} disabled={loading || busy}
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

/**
 * Combined "analyze profile" popup — one entry point covering both the bio
 * and the logo, each its own section with its own "generate a fix" action:
 * - Bio: bioReason is a free client-side heuristic (no LLM call), shown
 *   instantly; "fix my bio" hands off to the bio-review cycle (closes this
 *   popup, opens BioReviewModal via fixBioNow).
 * - Logo: critiqueLogo is fetched when this popup opens (no free heuristic
 *   exists for "is this logo good"); when it flags needs_redesign, its two
 *   generate buttons hand off to LogoReviewModal, same as before.
 */
function ProfileAnalysisModal({ platform, bioReason, bioAccepted, logoCritique, logoLoading, onFixBio, onGenerateLogo, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" dir="rtl">
      <div className="w-full max-w-lg bg-card rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
          <span className="text-[13px] font-semibold text-foreground">ניתוח פרופיל — {platform === 'instagram' ? 'אינסטגרם' : 'פייסבוק'}</span>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground mr-auto"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-5">
          {bioReason && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-foreground-muted">ביו</p>
              <p className="text-[13px] leading-relaxed text-foreground">{bioReason}</p>
              {bioAccepted ? (
                <span className="flex items-center gap-1 text-[11px] font-medium text-green-700 dark:text-green-400">
                  <CheckCircle2 className="w-3.5 h-3.5" /> ההצעה אושרה
                </span>
              ) : (
                <button
                  onClick={onFixBio}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border hover:bg-muted"
                >
                  🔧 תקנו לי את הביו
                </button>
              )}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-foreground-muted">לוגו</p>
            {logoLoading ? (
              <div className="flex items-center justify-center h-20">
                <Loader2 className="w-5 h-5 animate-spin text-foreground-muted" />
              </div>
            ) : logoCritique?.critique ? (
              <>
                <p className="text-[13px] leading-relaxed text-foreground">{logoCritique.critique}</p>
                {logoCritique.needs_redesign && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => onGenerateLogo('creative')}
                      className="flex-1 text-xs font-semibold px-3 py-2 rounded-lg border border-indigo-300 dark:border-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
                    >
                      🎨 לוגו יצירתי
                    </button>
                    <button
                      onClick={() => onGenerateLogo('wordmark')}
                      className="flex-1 text-xs font-semibold px-3 py-2 rounded-lg border border-indigo-300 dark:border-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
                    >
                      🔤 שם העסק כלוגו
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-[13px] text-red-600 dark:text-red-400">לא הצלחנו לנתח את הלוגו, נסו שוב</p>
            )}
          </div>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-border rounded-xl text-[13px] text-foreground-muted hover:text-foreground transition-colors">
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Proactive, always-visible suggestions comparing the business's own social
 * profile(s) against its tracked competitors — bio quality, profile/cover
 * picture, external link/highlights, posting frequency. Every trigger is a
 * cheap deterministic heuristic (see thresholds above); the LLM is only
 * invoked when the user acts on the bio suggestion (same suggestBioFix/
 * analyzeBioProfiles endpoints already used by CompetitorContentTrends).
 * `platform` scopes both the own data and the competitor comparison to one
 * platform, so e.g. Instagram gaps are only compared against competitors'
 * Instagram profiles, not pooled with Facebook.
 */
export default function SocialProfileSuggestions({ businessProfile, platform, onCreatePost }) {
  const bpId = businessProfile?.id;
  // Single object, not an array — this component is already scoped to one
  // `platform`, so suggestBioFix/critiqueLogo only ever return one entry.
  const [bioState, setBioState] = useState({ loading: false, suggestion: null, accepted: false });
  const [bioReviewOpen, setBioReviewOpen] = useState(false);
  const [bioReviewBusy, setBioReviewBusy] = useState(false);
  const [logoCritique, setLogoCritique] = useState({ loading: false, critique: null });
  const [profileAnalysisOpen, setProfileAnalysisOpen] = useState(false);
  // Keyed by platform — holds the generated-logo result/loading state for the
  // "🎨 צרו לי לוגו חדש" CTA, independent per platform toggle.
  const [logoGenState, setLogoGenState] = useState({});
  // Which platform's review popup is open (accept/reject/request-change), or null.
  const [logoReviewPlatform, setLogoReviewPlatform] = useState(null);
  const [logoReviewBusy, setLogoReviewBusy] = useState(false);

  // Clear any bio-fix/logo-critique result left over from the previous
  // platform when the toggle switches — this component is no longer
  // remounted via `key` (that caused stray duplicate renders), so this is
  // the reset mechanism instead.
  useEffect(() => {
    setBioState({ loading: false, suggestion: null, accepted: false });
    setBioReviewOpen(false);
    setLogoCritique({ loading: false, critique: null });
    setProfileAnalysisOpen(false);
    setLogoGenState({});
    setLogoReviewPlatform(null);
  }, [platform]);

  const { data: competitors = [] } = useQuery({
    queryKey: ['socialCompetitors', bpId],
    queryFn:  () => base44.entities.Competitor.filter({ linked_business: bpId, is_dismissed: { not: true }, not_relevant: { not: true } }),
    enabled:  !!bpId,
  });
  const compIds = competitors.map(c => c.id);

  const { data: allCompetitorPosts = [] } = useQuery({
    queryKey: ['socialPosts', bpId, compIds],
    queryFn:  () => base44.entities.CompetitorPost.filter({ competitor_id: { in: compIds } }, '-posted_at', 300),
    enabled:  !!bpId && compIds.length > 0,
  });
  const competitorPosts = allCompetitorPosts.filter(p => p.platform === platform);

  const { data: allCompetitorProfiles = [] } = useQuery({
    queryKey: ['socialProfiles', bpId, compIds],
    queryFn:  () => base44.entities.CompetitorSocialProfile.filter({ competitor_id: { in: compIds } }, '-fetched_at', 300),
    enabled:  !!bpId && compIds.length > 0,
  });
  const competitorProfiles = allCompetitorProfiles.filter(p => p.platform === platform);

  const { data: ownProfileData } = useQuery({
    queryKey: ['businessSnapshotProfile', bpId],
    queryFn:  () => apiFetch(`/social/snapshot/profile?businessProfileId=${bpId}`),
    enabled:  !!bpId,
  });
  const ownProfiles = (ownProfileData?.profiles ?? []).filter(p => p.platform === platform);

  const { data: ownFeedData } = useQuery({
    queryKey: ['businessSnapshotFeed', bpId],
    queryFn:  () => apiFetch(`/social/snapshot/feed?businessProfileId=${bpId}`),
    enabled:  !!bpId,
  });
  const ownPosts = (ownFeedData?.posts ?? []).filter(p => p.platform === platform);

  const ownWeeklyRate = useMemo(() => weeklyPostingRate(ownPosts), [ownPosts]);
  const competitorAvgWeeklyRate = useMemo(() => {
    const byCompetitor = {};
    for (const p of competitorPosts) (byCompetitor[p.competitor_id] ||= []).push(p);
    const rates = Object.values(byCompetitor).map(weeklyPostingRate).filter(r => r != null);
    return rates.length ? rates.reduce((s, v) => s + v, 0) / rates.length : null;
  }, [competitorPosts]);

  const suggestions = useMemo(() => (ownProfiles.length ? buildSuggestions({
    ownProfiles, competitorProfiles, ownWeeklyRate, competitorAvgWeeklyRate,
  }) : []), [ownProfiles, competitorProfiles, ownWeeklyRate, competitorAvgWeeklyRate]);

  const fixBioNow = async (feedback) => {
    setProfileAnalysisOpen(false);
    setBioReviewOpen(true);
    setBioState(prev => ({ ...prev, loading: true }));
    try {
      if (!businessProfile?.content_trends_bio_insight) {
        await base44.functions.invoke('analyzeBioProfiles', { businessProfileId: bpId }, 60000);
      }
      const result = await base44.functions.invoke('suggestBioFix', { businessProfileId: bpId, platform, feedback }, 60000);
      const data = result?.data ?? result;
      setBioState({ loading: false, suggestion: data?.suggestions?.[0] ?? null, accepted: false });
    } catch (e) {
      console.warn('[SocialProfileSuggestions] fixBioNow failed:', e.message);
      setBioState({ loading: false, suggestion: null, accepted: false });
    }
  };

  const acceptBioNow = async () => {
    setBioReviewBusy(true);
    try {
      await base44.functions.invoke('reviewSuggestedBio', { businessProfileId: bpId, platform, action: 'accept' }, 30000);
      setBioState(prev => ({ ...prev, accepted: true }));
      setBioReviewOpen(false);
    } catch (e) {
      console.warn('[SocialProfileSuggestions] acceptBioNow failed:', e.message);
    }
    setBioReviewBusy(false);
  };

  const rejectBioNow = async () => {
    setBioReviewBusy(true);
    try {
      await base44.functions.invoke('reviewSuggestedBio', { businessProfileId: bpId, platform, action: 'reject' }, 30000);
      setBioState({ loading: false, suggestion: null, accepted: false });
      setBioReviewOpen(false);
    } catch (e) {
      console.warn('[SocialProfileSuggestions] rejectBioNow failed:', e.message);
    }
    setBioReviewBusy(false);
  };

  const critiqueLogoNow = async () => {
    setLogoCritique(prev => ({ ...prev, loading: true }));
    try {
      if (!businessProfile?.content_trends_logo_insight) {
        await base44.functions.invoke('analyzeLogoTrends', { businessProfileId: bpId }, 60000);
      }
      const result = await base44.functions.invoke('critiqueLogo', { businessProfileId: bpId, platform }, 60000);
      const data = result?.data ?? result;
      setLogoCritique({ loading: false, critique: data?.critiques?.[0] ?? null });
    } catch (e) {
      console.warn('[SocialProfileSuggestions] critiqueLogoNow failed:', e.message);
      setLogoCritique({ loading: false, critique: null });
    }
  };

  const analyzeProfileNow = () => {
    setProfileAnalysisOpen(true);
    if (!logoCritique.critique) critiqueLogoNow();
  };

  const generateLogoNow = async (critiquePlatform, feedback, styleArg) => {
    // "request change" (feedback set, no styleArg) keeps whatever style the
    // candidate being revised was generated with, instead of silently
    // switching a wordmark attempt back to creative.
    const style = styleArg || logoGenState[critiquePlatform]?.style || 'creative';
    setProfileAnalysisOpen(false);
    setLogoReviewPlatform(critiquePlatform);
    setLogoGenState(prev => ({ ...prev, [critiquePlatform]: { ...prev[critiquePlatform], loading: true, style } }));
    try {
      const result = await base44.functions.invoke('generateLogo', { businessProfileId: bpId, platform: critiquePlatform, feedback, style }, 60000);
      const data = result?.data ?? result;
      setLogoGenState(prev => ({ ...prev, [critiquePlatform]: { loading: false, url: data?.suggested_logo_url ?? null, style } }));
    } catch (e) {
      console.warn('[SocialProfileSuggestions] generateLogoNow failed:', e.message);
      setLogoGenState(prev => ({ ...prev, [critiquePlatform]: { loading: false, error: true, style } }));
      setLogoReviewPlatform(null);
    }
  };

  const acceptLogoNow = async (critiquePlatform) => {
    setLogoReviewBusy(true);
    try {
      await base44.functions.invoke('reviewSuggestedLogo', { businessProfileId: bpId, platform: critiquePlatform, action: 'accept' }, 30000);
      setLogoGenState(prev => ({ ...prev, [critiquePlatform]: { ...prev[critiquePlatform], accepted: true } }));
      setLogoReviewPlatform(null);
    } catch (e) {
      console.warn('[SocialProfileSuggestions] acceptLogoNow failed:', e.message);
    }
    setLogoReviewBusy(false);
  };

  const rejectLogoNow = async (critiquePlatform) => {
    setLogoReviewBusy(true);
    try {
      await base44.functions.invoke('reviewSuggestedLogo', { businessProfileId: bpId, platform: critiquePlatform, action: 'reject' }, 30000);
      setLogoGenState(prev => ({ ...prev, [critiquePlatform]: { loading: false, url: null } }));
      setLogoReviewPlatform(null);
    } catch (e) {
      console.warn('[SocialProfileSuggestions] rejectLogoNow failed:', e.message);
    }
    setLogoReviewBusy(false);
  };

  const ownProfileUrl = platform === 'instagram' ? businessProfile?.instagram_url : businessProfile?.facebook_url;

  if (!suggestions.length) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-foreground-secondary flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[#e8344d] inline-block" />
        שיפורי עמוד סושיאל
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {suggestions.map(s => (
          <div key={s.id} className="border border-border rounded-xl bg-card p-3 space-y-2">
            <div>
              <p className="font-semibold text-sm text-foreground">{s.title}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
            </div>
            {s.kind === 'profile-analysis' && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={analyzeProfileNow}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border hover:bg-muted"
                >
                  {logoCritique.critique || bioState.suggestion ? '🔎 צפו בניתוח' : '🔎 נתחו את הפרופיל שלי'}
                </button>
                {bioState.accepted && (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-green-700 dark:text-green-400">
                    <CheckCircle2 className="w-3.5 h-3.5" /> הביו אושר
                  </span>
                )}
              </div>
            )}
            {s.kind === 'open-profile' && ownProfileUrl && (
              <button
                onClick={() => window.open(ownProfileUrl, '_blank', 'noopener,noreferrer')}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border hover:bg-muted"
              >
                פתחו את הפרופיל
              </button>
            )}
            {s.kind === 'create-post' && onCreatePost && (
              <button
                onClick={onCreatePost}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border hover:bg-muted"
              >
                צרו פוסט
              </button>
            )}
          </div>
        ))}
      </div>

      {logoGenState[platform]?.url && !logoGenState[platform]?.loading && (
        <div className="flex items-center gap-2 border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg p-3">
          <img
            src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(logoGenState[platform].url)}`}
            alt="הצעת לוגו חדש"
            className="rounded-lg border border-indigo-200 dark:border-indigo-800 w-12 h-12 object-cover shrink-0"
          />
          {logoGenState[platform].accepted ? (
            <span className="flex items-center gap-1 text-[11px] font-medium text-green-700 dark:text-green-400">
              <CheckCircle2 className="w-3.5 h-3.5" /> ההצעה אושרה
            </span>
          ) : (
            <button
              onClick={() => setLogoReviewPlatform(platform)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
            >
              פתחו לבדיקה
            </button>
          )}
        </div>
      )}

      {bioReviewOpen && (
        <BioReviewModal
          platform={platform}
          suggestion={bioState.suggestion}
          loading={bioState.loading}
          busy={bioReviewBusy}
          onAccept={acceptBioNow}
          onReject={rejectBioNow}
          onRequestChange={(feedback) => fixBioNow(feedback)}
          onClose={() => setBioReviewOpen(false)}
        />
      )}

      {profileAnalysisOpen && (
        <ProfileAnalysisModal
          platform={platform}
          bioReason={suggestions.find(s => s.kind === 'profile-analysis')?.bioReason}
          bioAccepted={bioState.accepted}
          logoCritique={logoCritique.critique}
          logoLoading={logoCritique.loading}
          onFixBio={() => fixBioNow()}
          onGenerateLogo={(style) => generateLogoNow(platform, undefined, style)}
          onClose={() => setProfileAnalysisOpen(false)}
        />
      )}

      {logoReviewPlatform && (
        <LogoReviewModal
          platform={logoReviewPlatform}
          imageUrl={logoGenState[logoReviewPlatform]?.url}
          style={logoGenState[logoReviewPlatform]?.style}
          loading={!!logoGenState[logoReviewPlatform]?.loading}
          busy={logoReviewBusy}
          onAccept={() => acceptLogoNow(logoReviewPlatform)}
          onReject={() => rejectLogoNow(logoReviewPlatform)}
          onRequestChange={(feedback) => generateLogoNow(logoReviewPlatform, feedback)}
          onClose={() => setLogoReviewPlatform(null)}
        />
      )}
    </div>
  );
}
