import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Search, CircleCheck } from 'lucide-react';
import { briefingApi, setFreeLink } from './api';
import { BriefingShell, Button, Card, ErrorNote, Spinner, StepHeading, TextInput } from './ui.jsx';
import CompetitorPicker from './CompetitorPicker.jsx';
import DeliveryForm from './DeliveryForm.jsx';
import PlanCards from './PlanCards.jsx';
import { BRIEFING_SIGNUP_KEY, BUSINESS_QUERY_KEY, freeToken, forgetFreeToken } from './keys.js';

/**
 * Sign-up flow of the English report-only product: find your business → competitors are discovered →
 * pick them → delivery → plan. A returning user resumes at the competitors step.
 *
 * `free`: the account-less Free plan, opened from the emailed link (its token stands in for a
 * login — keys.js, api.js). The email page was step 1, so this is find your business → pick
 * competitors → done; the report goes to the confirmed address and there is no plan to choose.
 * Opened again after setup, it is the "change competitors" page.
 */
// Discovery (maps search, AI selection, page lookup) often runs longer than the 2 minutes the CDN
// keeps a request open. The request is then cut off but the search carries on server-side, so wait
// for its suggestions: until the list has stopped growing, or about 3 more minutes.
// The suggestions are saved well before the search ends: after saving them it looks up each one's
// Instagram, Facebook and website. So the list is shown once it has stopped growing, and the pages
// fill in while the visitor chooses (CompetitorPicker `pending`).
async function firstSuggestions(businessProfileId) {
  let last = 0;
  for (let i = 0; i < 45; i += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 4000); });
    const n = await briefingApi.competitors(businessProfileId).then((list) => list.length, () => 0);
    if (n > 0 && n === last) return;
    last = n;
  }
}

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

export default function Start({ free = false }) {
  const navigate = useNavigate();
  // loading | search | discovering | pick | delivery | plan — and, free only: done | manage | expired
  const [step, setStep] = useState('loading');
  const [businessProfileId, setBusinessProfileId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [query, setQuery] = useState(() => sessionStorage.getItem(BUSINESS_QUERY_KEY) || (free && localStorage.getItem(BUSINESS_QUERY_KEY)) || '');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [lookingUp, setLookingUp] = useState(false); // the search is still looking up the suggestions' pages
  const [error, setError] = useState('');

  const loadSettings = async (id) => { const s = await briefingApi.settings(id); setSettings(s); return s; };
  // An emailed link lasts a day; once it is refused, everything on this page needs a new one.
  const expired = (e) => {
    if (!e?.data?.link_expired) return false;
    forgetFreeToken();
    setStep('expired');
    return true;
  };
  const message = (e) => (e.data?.not_available ? 'Cortexi reports are not available in your country yet.' : e.message);

  useEffect(() => {
    setFreeLink(free ? freeToken() : null);
    (async () => {
      try {
        const { business } = await briefingApi.me();
        if (business?.onboardingCompleted && !free) return navigate('/en/briefing', { replace: true });
        if (business) {
          setBusinessProfileId(business.businessProfileId);
          await loadSettings(business.businessProfileId);
          return setStep(business.onboardingCompleted ? 'manage' : 'pick');
        }
        return setStep('search');
      } catch (e) {
        if (expired(e)) return undefined;
        setError(e.message);
        return setStep('search');
      }
    })();
    return () => setFreeLink(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = async () => {
    setError('');
    if (query.trim().length < 3) return setError('Type your business name and city.');
    setBusy(true);
    try { setResults((await briefingApi.searchBusiness(query.trim())).results); }
    catch (e) { if (!expired(e)) setError(message(e)); }
    finally { setBusy(false); }
    return undefined;
  };

  const choose = async (placeId) => {
    setError('');
    setBusy(true);
    try {
      const { businessProfileId: id } = await briefingApi.start(placeId, Intl.DateTimeFormat().resolvedOptions().timeZone);
      sessionStorage.removeItem(BUSINESS_QUERY_KEY);
      sessionStorage.removeItem(BRIEFING_SIGNUP_KEY);
      if (free) localStorage.removeItem(BUSINESS_QUERY_KEY);
      setBusinessProfileId(id);
      setStep('discovering');
      await loadSettings(id);
      // A failed or empty discovery is not the end: the picker lets them add competitors by hand.
      // An answer of any kind — done, refused ("already suggested": a free address gets two runs) or
      // an error — means nothing more is coming. Only a cut-off request (status 0: the CDN closes it
      // at two minutes) leaves the search running server-side.
      const answered = briefingApi.discover(id).then(() => true, (e) => e.status > 0);
      setLookingUp(true);
      answered.then((yes) => (yes ? null : waitForSuggestions(id))).finally(() => setLookingUp(false));
      await Promise.race([answered, firstSuggestions(id)]);
      setStep('pick');
    } catch (e) {
      if (expired(e)) return;
      setError(message(e));
      setStep('search');
    } finally { setBusy(false); }
  };

  const finish = async () => {
    await briefingApi.finish(businessProfileId);
    navigate('/en/briefing?welcome=1', { replace: true });
  };
  // Free: saving the competitors ends the setup. The first report is built from here on.
  const finishFree = async () => {
    try { await briefingApi.finish(businessProfileId); setStep('done'); }
    catch (e) { if (!expired(e)) setError(e.message); }
  };

  const steps = free ? 3 : 4;
  const at = (n) => `Step ${free ? n + 1 : n} of ${steps}`;

  return (
    <BriefingShell signOut={!free}>
      {step === 'loading' && <Spinner label="Loading" />}

      {step === 'search' && (
        <>
          <StepHeading step={at(1)} title="Find your business" sub="We read its type and location from Google to find the right competitors." />
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
          <StepHeading step={at(2)} title="Finding your competitors" sub="We search nearby businesses of the same kind. This usually takes under a minute; their Instagram, Facebook and website are looked up while you choose." />
          <Spinner label="Searching — keep this page open" />
        </>
      )}

      {step === 'pick' && settings && (
        <>
          <StepHeading
            step={at(2)}
            title="Pick your competitors"
            sub={`Choose up to ${settings.competitorsMax} to watch. Check the pages we found for each one — the report is built from them.${free ? ' You can change them later from any report email.' : ''}`}
          />
          <CompetitorPicker businessProfileId={businessProfileId} limit={settings.competitorsMax} pending={lookingUp} saveLabel={free ? 'Finish' : 'Continue'} onSaved={free ? finishFree : () => setStep('delivery')} />
          {free && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
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
          <StepHeading step="Step 4 of 4" title="Choose your plan" sub="Every plan starts with a report on the last 30 days. You can change plans at any time." />
          <PlanCards businessProfileId={businessProfileId} currentPlan={null} onChosen={finish} hideFree />
          <p className="mt-4 text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>
            On a paid plan you can track more competitors — add them from your account once the plan is active.
          </p>
          <p className="mt-2 text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>
            By choosing a plan you agree to our <a href="/en/terms" target="_blank" rel="noopener" className="underline">Terms of Service</a> and <a href="/en/privacy" target="_blank" rel="noopener" className="underline">Privacy Policy</a>.
          </p>
        </>
      )}

      {step === 'done' && (
        <div className="space-y-4">
          <Card className="space-y-3">
            <CircleCheck size={34} strokeWidth={1.6} aria-hidden="true" />
            <h1 className="text-[26px] md:text-[28px] leading-tight">You're set</h1>
            <p className="text-[15px] leading-relaxed" style={{ color: 'var(--mkt-ink-2)' }}>
              Your first report is being prepared and will arrive{settings?.recipients?.[0] ? <> at <strong style={{ color: 'var(--mkt-ink)' }}>{settings.recipients[0]}</strong></> : ''} within the hour. Two more follow, one each month.
            </p>
            <p className="text-[13.5px]" style={{ color: 'var(--mkt-muted)' }}>Nothing to log in to. To change competitors, use the link in any report email.</p>
          </Card>
          <Card className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[220px]">
              <div className="font-extrabold text-[15px]">Want it every week or every day?</div>
              <div className="text-[13.5px] mt-0.5" style={{ color: 'var(--mkt-ink-2)' }}>Paid plans add Instagram stories, more competitors and your own numbers next to theirs.</div>
            </div>
            <a href="/en#pricing" className="inline-flex items-center justify-center rounded-full px-5 h-11 text-[14px] font-bold whitespace-nowrap" style={{ background: 'var(--mkt-surface)', color: 'var(--mkt-ink)', border: '1px solid var(--mkt-border-strong)' }}>See paid plans</a>
          </Card>
        </div>
      )}

      {step === 'manage' && settings && (
        <>
          <StepHeading title="Change competitors" sub={`Your free plan watches ${settings.competitorsMax}. Changes apply to your next report.`} />
          <CompetitorPicker businessProfileId={businessProfileId} limit={settings.competitorsMax} saveLabel="Save" onSaved={() => setSaved(true)} />
          {saved && <p role="status" className="mt-3 text-[13.5px] font-medium" style={{ color: 'var(--mkt-ink-2)' }}>Saved. Your next report will cover these competitors.</p>}
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--mkt-muted)' }}>
            A new competitor's first report shows their posts, ads and reviews. Follower growth starts from the report after.
          </p>
        </>
      )}

      {step === 'expired' && (
        <Card className="space-y-3">
          <h1 className="text-[26px] md:text-[28px] leading-tight">This link has expired</h1>
          <p className="text-[15px] leading-relaxed" style={{ color: 'var(--mkt-ink-2)' }}>Links work for 24 hours. Enter your email again and we'll send a new one; your setup is kept.</p>
          <a href="/en/free" className="inline-flex items-center justify-center rounded-full px-5 h-11 text-[14px] font-bold text-white" style={{ background: 'var(--mkt-ink)' }}>Get a new link</a>
        </Card>
      )}
    </BriefingShell>
  );
}
