import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Search } from 'lucide-react';
import { briefingApi } from './api';
import { BriefingShell, Button, Card, ErrorNote, Spinner, StepHeading, TextInput } from './ui.jsx';
import CompetitorPicker from './CompetitorPicker.jsx';
import DeliveryForm from './DeliveryForm.jsx';
import PlanCards from './PlanCards.jsx';
import { BRIEFING_SIGNUP_KEY, BUSINESS_QUERY_KEY } from './keys.js';

/**
 * Sign-up flow of the English report-only product: find your business → competitors are discovered →
 * pick them → delivery → plan. A returning user resumes at the competitors step.
 */
// Discovery (maps search, AI selection, page lookup) often runs longer than the 2 minutes the CDN
// keeps a request open. The request is then cut off but the search carries on server-side, so wait
// for its suggestions: until the list has stopped growing, or about 3 more minutes.
async function waitForSuggestions(businessProfileId) {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 6000); });
    const n = await briefingApi.competitors(businessProfileId).then((list) => list.length, () => last);
    stable = n > 0 && n === last ? stable + 1 : 0;
    if (stable >= 2) return;
    last = n;
  }
}

export default function Start() {
  const navigate = useNavigate();
  const [step, setStep] = useState('loading'); // loading | search | discovering | pick | delivery | plan
  const [businessProfileId, setBusinessProfileId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [query, setQuery] = useState(() => sessionStorage.getItem(BUSINESS_QUERY_KEY) || '');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadSettings = async (id) => { const s = await briefingApi.settings(id); setSettings(s); return s; };

  useEffect(() => {
    (async () => {
      try {
        const { business } = await briefingApi.me();
        if (business?.onboardingCompleted) return navigate('/en/briefing', { replace: true });
        if (business) {
          setBusinessProfileId(business.businessProfileId);
          await loadSettings(business.businessProfileId);
          return setStep('pick');
        }
        setStep('search');
      } catch (e) { setError(e.message); setStep('search'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = async () => {
    setError('');
    if (query.trim().length < 3) return setError('Type your business name and city.');
    setBusy(true);
    try { setResults((await briefingApi.searchBusiness(query.trim())).results); }
    catch (e) { setError(e.data?.not_available ? 'Cortexi reports are not available in your country yet.' : e.message); }
    finally { setBusy(false); }
  };

  const choose = async (placeId) => {
    setError('');
    setBusy(true);
    try {
      const { businessProfileId: id } = await briefingApi.start(placeId, Intl.DateTimeFormat().resolvedOptions().timeZone);
      sessionStorage.removeItem(BUSINESS_QUERY_KEY);
      sessionStorage.removeItem(BRIEFING_SIGNUP_KEY);
      setBusinessProfileId(id);
      setStep('discovering');
      await loadSettings(id);
      // A failed or empty discovery is not the end: the picker lets them add competitors by hand.
      const answered = await briefingApi.discover(id).then(() => true, () => false);
      if (!answered) await waitForSuggestions(id);
      setStep('pick');
    } catch (e) {
      setError(e.data?.not_available ? 'Cortexi reports are not available in your country yet.' : e.message);
      setStep('search');
    } finally { setBusy(false); }
  };

  const finish = async () => {
    await briefingApi.finish(businessProfileId);
    navigate('/en/briefing?welcome=1', { replace: true });
  };

  return (
    <BriefingShell>
      {step === 'loading' && <Spinner label="Loading" />}

      {step === 'search' && (
        <>
          <StepHeading step="Step 1 of 4" title="Find your business" sub="We read its type and location from Google to find the right competitors." />
          <form className="flex gap-2.5" onSubmit={(e) => { e.preventDefault(); search(); }}>
            <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Joe's Pizza, Austin TX" aria-label="Your business name and city" maxLength={120} />
            <Button variant="gradient" disabled={busy} onClick={search}><Search size={15} aria-hidden="true" />{busy ? 'Searching' : 'Search'}</Button>
          </form>
          <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
          {results && (
            <ul className="mt-6 space-y-2.5">
              {results.length === 0 && <li className="text-[14.5px]" style={{ color: 'var(--mkt-ink-2)' }}>No business found. Try adding the city or the street.</li>}
              {results.map((r) => (
                <li key={r.placeId}>
                  <Card className="!p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-bold text-[15px]">{r.name}</div>
                      <div className="text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>{[r.category, r.address].filter(Boolean).join(' · ')}</div>
                      {r.rating != null && (
                        <div className="mt-0.5 inline-flex items-center gap-1 text-[12.5px]" style={{ color: 'var(--mkt-ink-2)' }}>
                          <Star size={12} aria-hidden="true" /> {Number(r.rating).toFixed(1)}{r.reviewCount ? ` (${r.reviewCount} reviews)` : ''}
                        </div>
                      )}
                    </div>
                    <Button variant="black" className="shrink-0 !h-10 text-[13px]" disabled={busy} onClick={() => choose(r.placeId)}>That's my business</Button>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {step === 'discovering' && (
        <>
          <StepHeading step="Step 2 of 4" title="Finding your competitors" sub="We search nearby businesses of the same kind and look up their Instagram, Facebook and website. This takes two to four minutes." />
          <Spinner label="Searching — keep this page open" />
        </>
      )}

      {step === 'pick' && settings && (
        <>
          <StepHeading step="Step 2 of 4" title="Pick your competitors" sub={`Choose up to ${settings.competitorsMax} to watch. Check the pages we found for each one — the report is built from them.`} />
          <CompetitorPicker businessProfileId={businessProfileId} limit={settings.competitorsMax} onSaved={() => setStep('delivery')} />
        </>
      )}

      {step === 'delivery' && settings && (
        <>
          <StepHeading step="Step 3 of 4" title="Where should we send it?" />
          <Card><DeliveryForm businessProfileId={businessProfileId} initial={settings} saveLabel="Continue" onSaved={() => setStep('plan')} /></Card>
        </>
      )}

      {step === 'plan' && settings && (
        <>
          <StepHeading step="Step 4 of 4" title="Choose your plan" sub="Every plan starts with a free report on the last 30 days. You can change plans at any time." />
          <PlanCards businessProfileId={businessProfileId} currentPlan={null} onChosen={finish} />
          <p className="mt-4 text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>
            On a paid plan you can track more competitors — add them from your account once the plan is active.
          </p>
        </>
      )}
    </BriefingShell>
  );
}
