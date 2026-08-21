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

  const bioIssues = ownProfiles.map(p => bioIssue(p)).filter(Boolean);
  if (bioIssues.length) {
    const reason = bioIssues.includes('missing') ? 'לא הוגדר ביו'
      : bioIssues.includes('auto') ? 'הביו הוא טקסט אוטומטי של הפלטפורמה'
      : 'הביו קצר מדי ולא אומר הרבה';
    suggestions.push({
      id: 'bio',
      title: 'הביו שלכם דורש שיפור',
      description: reason,
      kind: 'bio-fix',
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

  // Not a gap to flag (there's no cheap heuristic for "is this logo good") —
  // an opportunity to offer whenever there's actually a logo to look at.
  if (ownProfiles.some(p => p.profile_picture_url)) {
    suggestions.push({
      id: 'logo',
      title: 'בדקו את איכות הלוגו שלכם',
      description: 'ניתוח חזותי של תמונת הפרופיל שלכם מול המתחרים',
      kind: 'logo-critique',
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
function LogoReviewModal({ platform, imageUrl, loading, busy, onAccept, onReject, onRequestChange, onClose }) {
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
  const [bioFixState, setBioFixState] = useState({ loading: false, suggestions: [] });
  const [logoFixState, setLogoFixState] = useState({ loading: false, critiques: [] });
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
    setBioFixState({ loading: false, suggestions: [] });
    setLogoFixState({ loading: false, critiques: [] });
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

  const fixBioNow = async () => {
    setBioFixState({ loading: true, suggestions: [] });
    try {
      if (!businessProfile?.content_trends_bio_insight) {
        await base44.functions.invoke('analyzeBioProfiles', { businessProfileId: bpId }, 60000);
      }
      const result = await base44.functions.invoke('suggestBioFix', { businessProfileId: bpId, platform }, 60000);
      const data = result?.data ?? result;
      setBioFixState({ loading: false, suggestions: data?.suggestions ?? [] });
    } catch (e) {
      console.warn('[SocialProfileSuggestions] fixBioNow failed:', e.message);
      setBioFixState({ loading: false, suggestions: [] });
    }
  };

  const critiqueLogoNow = async () => {
    setLogoFixState({ loading: true, critiques: [] });
    try {
      if (!businessProfile?.content_trends_logo_insight) {
        await base44.functions.invoke('analyzeLogoTrends', { businessProfileId: bpId }, 60000);
      }
      const result = await base44.functions.invoke('critiqueLogo', { businessProfileId: bpId, platform }, 60000);
      const data = result?.data ?? result;
      setLogoFixState({ loading: false, critiques: data?.critiques ?? [] });
    } catch (e) {
      console.warn('[SocialProfileSuggestions] critiqueLogoNow failed:', e.message);
      setLogoFixState({ loading: false, critiques: [] });
    }
  };

  const generateLogoNow = async (critiquePlatform, feedback) => {
    setLogoReviewPlatform(critiquePlatform);
    setLogoGenState(prev => ({ ...prev, [critiquePlatform]: { ...prev[critiquePlatform], loading: true } }));
    try {
      const result = await base44.functions.invoke('generateLogo', { businessProfileId: bpId, platform: critiquePlatform, feedback }, 60000);
      const data = result?.data ?? result;
      setLogoGenState(prev => ({ ...prev, [critiquePlatform]: { loading: false, url: data?.suggested_logo_url ?? null } }));
    } catch (e) {
      console.warn('[SocialProfileSuggestions] generateLogoNow failed:', e.message);
      setLogoGenState(prev => ({ ...prev, [critiquePlatform]: { loading: false, error: true } }));
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
            {s.kind === 'bio-fix' && (
              <button
                onClick={fixBioNow}
                disabled={bioFixState.loading}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
              >
                {bioFixState.loading ? 'מנתח...' : '🔧 תקנו לי את הביו'}
              </button>
            )}
            {s.kind === 'logo-critique' && (
              <button
                onClick={critiqueLogoNow}
                disabled={logoFixState.loading}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
              >
                {logoFixState.loading ? 'מנתח...' : '🔍 בדקו את הלוגו שלי'}
              </button>
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

      {bioFixState.suggestions.map((s, i) => (
        <div key={i} className="border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 rounded-lg p-3 space-y-1.5">
          <p className="text-[10px] font-semibold text-violet-800 dark:text-violet-300">{s.platform}</p>
          {s.suggested_bio && (
            <p className="text-xs leading-relaxed text-violet-950 dark:text-violet-100 whitespace-pre-line">{s.suggested_bio}</p>
          )}
          {s.rationale && (
            <p className="text-[11px] text-violet-700 dark:text-violet-400 border-t border-violet-200 dark:border-violet-800 pt-1.5">{s.rationale}</p>
          )}
        </div>
      ))}

      {logoFixState.critiques.map((c, i) => {
        const genState = logoGenState[c.platform] ?? {};
        return (
          <div key={i} className="border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg p-3 space-y-1.5">
            <p className="text-[10px] font-semibold text-indigo-800 dark:text-indigo-300">{c.platform}</p>
            {c.critique && (
              <p className="text-xs leading-relaxed text-indigo-950 dark:text-indigo-100">{c.critique}</p>
            )}
            {c.needs_redesign && !genState.url && (
              <button
                onClick={() => generateLogoNow(c.platform)}
                disabled={genState.loading}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 disabled:opacity-50"
              >
                {genState.loading ? 'יוצר לוגו...' : '🎨 צרו לי לוגו חדש'}
              </button>
            )}
            {genState.error && (
              <p className="text-[11px] text-red-600 dark:text-red-400">יצירת הלוגו נכשלה, נסו שוב</p>
            )}
            {genState.url && !genState.loading && (
              <div className="flex items-center gap-2">
                <img
                  src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(genState.url)}`}
                  alt="הצעת לוגו חדש"
                  className="rounded-lg border border-indigo-200 dark:border-indigo-800 w-12 h-12 object-cover shrink-0"
                />
                {genState.accepted ? (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-green-700 dark:text-green-400">
                    <CheckCircle2 className="w-3.5 h-3.5" /> ההצעה אושרה
                  </span>
                ) : (
                  <button
                    onClick={() => setLogoReviewPlatform(c.platform)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
                  >
                    פתחו לבדיקה
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {logoReviewPlatform && (
        <LogoReviewModal
          platform={logoReviewPlatform}
          imageUrl={logoGenState[logoReviewPlatform]?.url}
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
