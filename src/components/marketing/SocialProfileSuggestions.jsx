import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  apiFetch, isFacebookAutoBio, weeklyPostingRate,
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

  // Clear any bio-fix/logo-critique result left over from the previous
  // platform when the toggle switches — this component is no longer
  // remounted via `key` (that caused stray duplicate renders), so this is
  // the reset mechanism instead.
  useEffect(() => {
    setBioFixState({ loading: false, suggestions: [] });
    setLogoFixState({ loading: false, critiques: [] });
    setLogoGenState({});
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

  const generateLogoNow = async (critiquePlatform) => {
    setLogoGenState(prev => ({ ...prev, [critiquePlatform]: { loading: true } }));
    try {
      const result = await base44.functions.invoke('generateLogo', { businessProfileId: bpId, platform: critiquePlatform }, 60000);
      const data = result?.data ?? result;
      setLogoGenState(prev => ({ ...prev, [critiquePlatform]: { loading: false, url: data?.suggested_logo_url ?? null } }));
    } catch (e) {
      console.warn('[SocialProfileSuggestions] generateLogoNow failed:', e.message);
      setLogoGenState(prev => ({ ...prev, [critiquePlatform]: { loading: false, error: true } }));
    }
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
            {genState.url && (
              <div className="space-y-1">
                <img src={genState.url} alt="הצעת לוגו חדש" className="rounded-lg border border-indigo-200 dark:border-indigo-800 w-24 h-24 object-cover" />
                <p className="text-[11px] text-indigo-700 dark:text-indigo-400">
                  הצעה ראשונית שנוצרה על ידי AI — הורידו ותעלו ידנית לפרופיל ב{c.platform === 'instagram' ? 'אינסטגרם' : 'פייסבוק'}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
