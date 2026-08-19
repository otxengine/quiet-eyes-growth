import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { LONG_SCAN_TIMEOUT_MS } from '@/api/client';
import { Loader2, Users, Plus } from 'lucide-react';
import { getLimits } from '@/lib/planConfig';
import { addCompetitorManually } from '@/lib/addCompetitorManually';
import KoriAvatar from './KoriAvatar';
import CompetitorSelectCard from './CompetitorSelectCard';

const BG_STYLE = {
  backgroundColor: '#f5f5f7',
  backgroundImage: 'radial-gradient(circle, #d1d1d1 1px, transparent 1px)',
  backgroundSize: '24px 24px',
};

const EMPTY_URLS = { website_url: '', instagram_url: '', facebook_url: '', tiktok_url: '' };

const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-[12px] text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-300';

function AddCompetitorForm({ businessProfileId, onAdded }) {
  const [open, setOpen] = useState(false);
  const [showUrls, setShowUrls] = useState(false);
  const [name, setName] = useState('');
  const [urls, setUrls] = useState(EMPTY_URLS);
  const [adding, setAdding] = useState(false);

  const reset = () => { setName(''); setUrls(EMPTY_URLS); setShowUrls(false); setOpen(false); };

  const handleAdd = async () => {
    if (!name.trim() || adding) return;
    setAdding(true);
    try {
      const providedUrls = Object.fromEntries(Object.entries(urls).filter(([, v]) => v.trim()));
      const competitor = await addCompetitorManually({ businessProfileId, name: name.trim(), urls: providedUrls });
      onAdded(competitor);
      reset();
    } catch (err) {
      console.error('addCompetitorManually failed:', err);
    }
    setAdding(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-[12px] font-medium text-[#e8344d] hover:opacity-80 transition-opacity"
      >
        <Plus className="w-3.5 h-3.5" /> הוסף מתחרה ידנית
      </button>
    );
  }

  return (
    <div className="p-3.5 rounded-xl border border-gray-200 bg-white space-y-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם המתחרה *" className={inputCls} />
      {showUrls ? (
        <div className="space-y-2">
          <input value={urls.website_url} onChange={(e) => setUrls({ ...urls, website_url: e.target.value })} placeholder="אתר (אופציונלי)" className={inputCls} />
          <input value={urls.instagram_url} onChange={(e) => setUrls({ ...urls, instagram_url: e.target.value })} placeholder="Instagram (אופציונלי)" className={inputCls} />
          <input value={urls.facebook_url} onChange={(e) => setUrls({ ...urls, facebook_url: e.target.value })} placeholder="Facebook (אופציונלי)" className={inputCls} />
          <input value={urls.tiktok_url} onChange={(e) => setUrls({ ...urls, tiktok_url: e.target.value })} placeholder="TikTok (אופציונלי)" className={inputCls} />
        </div>
      ) : (
        <button onClick={() => setShowUrls(true)} className="text-[11px] text-gray-500 underline">
          יש לך קישורים? (אופציונלי — אם לא, נמצא אותם בעצמנו)
        </button>
      )}
      <div className="flex gap-2 justify-end pt-1">
        <button onClick={reset} className="px-3 py-1.5 text-[11px] text-gray-500 hover:text-gray-700 transition-colors">ביטול</button>
        <button
          onClick={handleAdd}
          disabled={adding || !name.trim()}
          className="px-3 py-1.5 text-[11px] font-medium text-white rounded-lg disabled:opacity-50 flex items-center gap-1.5"
          style={{ background: 'linear-gradient(135deg, #9c27b0, #e8344d)' }}
        >
          {adding && <Loader2 className="w-3 h-3 animate-spin" />}
          {adding ? 'מוסיף...' : 'הוסף'}
        </button>
      </div>
    </div>
  );
}

export default function OnboardingDiscoverCompetitors() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state;
  const businessProfile = state?.businessProfile;
  const ranRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [competitors, setCompetitors] = useState([]);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);

  if (!businessProfile) { navigate('/onboarding'); return null; }

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const run = async () => {
      const bp = businessProfile;
      try {
        await base44.functions.invoke('runCompetitorIdentification', {
          businessProfileId: bp.id, name: bp.name, category: bp.category, city: bp.city,
        }, 180000);
      } catch (err) {
        console.error('runCompetitorIdentification failed:', err);
      }
      try {
        const found = await base44.entities.Competitor.filter(
          { linked_business: bp.id, tracking_status: 'pending_review' }, '-created_date',
        );
        setCompetitors(found || []);
        setCheckedIds(new Set((found || []).map(c => c.id)));
      } catch (err) {
        console.error('Failed to load discovered competitors:', err);
      }
      setLoading(false);
    };

    run();
  }, [businessProfile]);

  const toggle = (id) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const confirm = async (approvedIds) => {
    setSubmitting(true);
    try {
      const rejectedIds = competitors.map(c => c.id).filter(id => !approvedIds.includes(id));
      await base44.raw.post('/onboarding/confirm-competitors', {
        businessProfileId: businessProfile.id, approvedIds, rejectedIds,
      });
    } catch (err) {
      console.error('confirm-competitors failed:', err);
    }

    // Deep-research scans for the just-approved competitors + the business's own
    // reviews — fired in the background, NOT awaited: Insights doesn't read this
    // data (only quick wins/alerts/signals from an earlier onboarding step), so
    // there's nothing to gain by making the user wait here. The fetches keep
    // running after navigation (client-side routing doesn't cancel in-flight
    // requests); results show up next time the user opens the competitors page.
    const bp = businessProfile.id;
    const invoke = (fn, params, timeoutMs) =>
      base44.functions.invoke(fn, params, timeoutMs).catch((err) => console.error(`${fn} failed:`, err));

    invoke('collectCompetitorSocialPosts', { businessProfileId: bp, force: true }, LONG_SCAN_TIMEOUT_MS);
    invoke('collectCompetitorSocialStories', { businessProfileId: bp, force: true }, LONG_SCAN_TIMEOUT_MS);
    invoke('detectCompetitorAds', { businessProfileId: bp, force: true, allCompetitors: true }, LONG_SCAN_TIMEOUT_MS);
    invoke('collectReviews', { businessProfileId: bp, force: true, skipCompetitorTrigger: true }, LONG_SCAN_TIMEOUT_MS);
    invoke('collectCompetitorReviews', { businessProfileId: bp }, LONG_SCAN_TIMEOUT_MS);

    navigate('/onboarding/insights', { state });
  };

  const handleConfirm = () => confirm(Array.from(checkedIds));
  const handleSkip = () => confirm(competitors.map(c => c.id));

  const handleManuallyAdded = (competitor) => {
    setCompetitors(prev => [...prev, competitor]);
    setCheckedIds(prev => new Set(prev).add(competitor.id));
  };

  const planLimits = getLimits(businessProfile.subscription_plan);
  const atCap = planLimits.competitors_max !== Infinity && competitors.length >= planLimits.competitors_max;

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center p-4" style={BG_STYLE}>
        <div className="text-center max-w-sm w-full">
          <div className="relative w-28 h-28 mx-auto mb-6 flex items-center justify-center">
            <div
              className="absolute inset-0 rounded-full opacity-20 animate-ping"
              style={{ background: 'linear-gradient(135deg, #9c27b0 0%, #e8344d 60%, #ff9800 100%)' }}
            />
            <KoriAvatar size="md" className="relative z-10 shadow-lg" />
          </div>
          <h2 className="text-[16px] font-bold text-gray-800 mb-1">מזהה מתחרים רלוונטיים...</h2>
          <p className="text-[12px] text-gray-500">מוצא את המתחרים האמיתיים שלך בלבד</p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen py-8 px-4" style={BG_STYLE}>
      <div className="max-w-lg mx-auto space-y-4">
        <div className="text-center pb-2">
          <KoriAvatar size="md" className="mx-auto mb-4 shadow-md" />
          <h1 className="text-[20px] font-bold text-gray-900 mb-1">אילו מתחרים לעקוב אחריהם?</h1>
          <p className="text-[13px] text-gray-500">קורי מצא את המתחרים האלה — בחר את אלה שרלוונטיים לך</p>
        </div>

        {competitors.length === 0 ? (
          <div className="text-center py-10 text-gray-500 text-[13px]">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
            לא נמצאו מתחרים כרגע — אפשר להוסיף ידנית מאוחר יותר
          </div>
        ) : (
          <div className="space-y-2">
            {competitors.map((c) => (
              <CompetitorSelectCard
                key={c.id}
                competitor={c}
                checked={checkedIds.has(c.id)}
                onToggle={toggle}
              />
            ))}
          </div>
        )}

        {atCap ? (
          <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            הגעת למכסת {planLimits.competitors_max} מתחרים בתוכנית שלך — שדרג כדי להוסיף עוד
          </p>
        ) : (
          <AddCompetitorForm businessProfileId={businessProfile.id} onAdded={handleManuallyAdded} />
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className="flex-1 py-3 rounded-xl text-[13px] font-semibold text-white hover:opacity-90 transition-all flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, #9c27b0, #e8344d)' }}
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            אשר בחירה ({checkedIds.size})
          </button>
          <button
            onClick={handleSkip}
            disabled={submitting}
            className="text-[12px] text-gray-500 underline"
          >
            מלאו אחר כך
          </button>
        </div>
      </div>
    </div>
  );
}
