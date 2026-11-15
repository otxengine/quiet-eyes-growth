import React, { useEffect, useState } from 'react';
import { Mail, Search, Star } from 'lucide-react';
import { briefingApi } from './api';
import { BriefingShell, Button, Card, ErrorNote, StepHeading, TextInput } from './ui.jsx';
import { BUSINESS_QUERY_KEY } from './keys.js';
import { track } from '@/lib/gtm.js';

// The optional newsletter checkbox; the server stores this exact wording when it is ticked
// (FREE_CONSENT_TEXT in server/src/lib/freeAccess.ts). Change both together.
const CONSENT = 'Also send me the Cortexi newsletter: product news and tips for local businesses. Unsubscribe anytime.';
const muted = { color: 'var(--mkt-muted)' };
const ink2 = { color: 'var(--mkt-ink-2)' };

function Rating({ rating, reviewCount }) {
  if (rating == null) return <span style={muted}>No Google rating</span>;
  return (
    <span className="inline-flex items-center gap-1" style={ink2}>
      <Star size={12} aria-hidden="true" /> {Number(rating).toFixed(1)}{reviewCount ? ` (${Number(reviewCount).toLocaleString('en-US')} reviews)` : ''}
    </span>
  );
}

/**
 * The ad landing page of the account-less Free plan. Ad visitors left a bare email form without
 * touching it, so the page first shows what they get: they find their business and see the most
 * popular places of the same kind around it (a quick Google look, /api/briefing/preview/*). Then it
 * asks for the email address. The emailed link opens the full setup (/en/start?t=…), which offers the
 * business picked here for confirmation.
 */
export default function Free() {
  // find → competitors → sent; email = straight to the address (they skipped, or the search is unavailable)
  const [step, setStep] = useState('find');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [preview, setPreview] = useState(null);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [again, setAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const message = (e) => (e.data?.not_available ? 'Cortexi reports are not available in your country yet.' : e.message);
  const fail = (e) => {
    setError(message(e));
    if (e.data?.preview_full) setStep('email'); // the day's lookups are spent: the setup will find them
  };

  const pick = async (placeId) => {
    setError('');
    setBusy(true);
    try {
      const found = await briefingApi.previewCompetitors(placeId);
      track('view_competitors', { market: 'en', count: found.competitors.length });
      setPreview(found);
      setStep('competitors');
      window.scrollTo(0, 0);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const find = async (text) => {
    setError('');
    setResults(null);
    if (text.trim().length < 3) return setError('Type your business name and city.');
    setBusy(true);
    try {
      const found = (await briefingApi.previewSearch(text.trim())).results;
      track('find_competitors', { market: 'en' });
      if (found.length === 1) return await pick(found[0].placeId);
      setResults(found);
    } catch (e) { fail(e); } finally { setBusy(false); }
    return undefined;
  };

  // The landing page's search box sends what they typed (?business=…): search it right away. Also kept
  // for the setup page, in localStorage because the emailed link opens in a new tab.
  useEffect(() => {
    const business = (new URLSearchParams(window.location.search).get('business') || '').trim().slice(0, 120);
    if (!business) return;
    localStorage.setItem(BUSINESS_QUERY_KEY, business);
    setQuery(business);
    find(business);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async (address) => {
    setError('');
    if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(address)) return setError('Enter a valid email address.');
    setBusy(true);
    try {
      await briefingApi.requestFreeLink(address, consent, preview?.business?.placeId);
      if (!sentTo) track('generate_lead', { market: 'en', method: 'free_email' }); // not on "send again"
      setAgain(!!sentTo);
      setSentTo(address);
      setStep('sent');
    } catch (e) {
      setError(message(e));
    } finally { setBusy(false); }
    return undefined;
  };

  const emailForm = (
    <form id="free-email-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); send(email.trim().toLowerCase()); }} noValidate>
      <div>
        <label htmlFor="free-email" className="block text-[13.5px] font-bold mb-1.5">Email</label>
        <TextInput id="free-email" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} placeholder="name@company.com" maxLength={200} />
      </div>
      <label className="flex items-start gap-2.5 text-[13.5px] leading-snug cursor-pointer" style={ink2}>
        <input type="checkbox" className="mt-0.5 shrink-0 w-[18px] h-[18px]" style={{ accentColor: 'var(--mkt-ink)' }} checked={consent} onChange={(e) => { setConsent(e.target.checked); setError(''); }} />
        <span>{CONSENT}</span>
      </label>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" variant="gradient" disabled={busy}>{busy ? 'Sending' : 'Send my free report'}</Button>
    </form>
  );
  const legal = (
    <p className="mt-4 text-[12.5px]" style={muted}>
      By continuing you agree to our <a href="/en/terms" target="_blank" rel="noopener" className="underline">Terms of Service</a> and <a href="/en/privacy" target="_blank" rel="noopener" className="underline">Privacy Policy</a>.
      Want reports every week or every day? <a href="/sign-up?briefing=1" className="underline">See paid plans</a>.
    </p>
  );

  const biz = preview?.business;
  const rivals = preview?.competitors || [];
  const ratedHigher = biz?.rating != null ? rivals.filter((c) => c.rating != null && c.rating > biz.rating).length : 0;

  return (
    <BriefingShell signOut={false}>
      {step === 'find' && (
        <>
          <StepHeading title="See who you're up against" sub="Type your business and we'll show the competitors around you. Free, no account." />
          <form id="find-competitors" className="flex flex-col sm:flex-row gap-2.5" onSubmit={(e) => { e.preventDefault(); find(query); }}>
            <TextInput value={query} onChange={(e) => { setQuery(e.target.value); setError(''); }} placeholder="Joe's Pizza, Austin TX" aria-label="Your business name and city" maxLength={120} />
            <Button type="submit" variant="gradient" className="shrink-0" disabled={busy}><Search size={15} aria-hidden="true" />{busy ? 'Searching' : 'Find my competitors'}</Button>
          </form>
          <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
          {results && (
            <>
              {results.length > 0 && <h2 className="mt-6 text-[17px] font-extrabold">Which one is yours?</h2>}
              <ul className="mt-3 space-y-2.5">
                {results.length === 0 && <li className="text-[14.5px]" style={ink2}>No business found. Try adding the city or the street.</li>}
                {results.map((r) => (
                  <li key={r.placeId}>
                    <Card className="!p-4 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-bold text-[15px]">{r.name}</div>
                        <div className="text-[12.5px]" style={muted}>{[r.category, r.address].filter(Boolean).join(' · ')}</div>
                        <div className="mt-0.5 text-[12.5px]"><Rating rating={r.rating} reviewCount={r.reviewCount} /></div>
                      </div>
                      <Button variant="black" className="shrink-0 !h-10 text-[13px]" disabled={busy} onClick={() => pick(r.placeId)}>That's mine</Button>
                    </Card>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-6 text-[13px]" style={muted}>
            Three free monthly reports on your competitors' posts, ads and Google reviews. No card, no account.{' '}
            <button type="button" className="underline" onClick={() => { setError(''); setStep('email'); }}>Skip this and just email me the link</button>
          </p>
        </>
      )}

      {step === 'competitors' && biz && (
        <>
          <StepHeading
            title={rivals.length ? `${rivals.length} businesses competing with ${biz.name}` : `We'll find ${biz.name}'s competitors`}
            sub={rivals.length
              ? `The most popular places within 5 miles that Google lists ${biz.category ? `as “${biz.category}”` : 'like yours'}.${ratedHigher ? ` ${ratedHigher} of them ${ratedHigher === 1 ? 'is' : 'are'} rated higher than you on Google.` : ''}`
              : 'Nothing close by matched at a first look. The setup searches wider, and you can add competitors by name.'}
          />
          {rivals.length > 0 && (
            <Card className="!p-0 overflow-hidden">
              <ul>
                <li className="px-4 py-3 flex items-center justify-between gap-3" style={{ background: 'var(--mkt-surface)' }}>
                  <div className="min-w-0">
                    <div className="font-bold text-[14.5px] truncate">{biz.name}</div>
                    <div className="text-[12.5px]"><Rating rating={biz.rating} reviewCount={biz.reviewCount} /></div>
                  </div>
                  <span className="shrink-0 text-[12px] font-extrabold mkt-grad-text">You</span>
                </li>
                {rivals.map((c) => (
                  <li key={c.placeId} className="px-4 py-3 flex items-center justify-between gap-3 border-t" style={{ borderColor: 'var(--mkt-border)' }}>
                    <div className="min-w-0">
                      <div className="font-bold text-[14.5px] truncate">{c.name}</div>
                      <div className="text-[12.5px]"><Rating rating={c.rating} reviewCount={c.reviewCount} /></div>
                    </div>
                    {c.miles != null && <span className="shrink-0 text-[12.5px]" style={muted}>{c.miles < 0.1 ? 'next door' : `${c.miles} mi`}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card className="mt-5">
            <h2 className="text-[19px] leading-snug font-extrabold">See what they post, advertise and hear from customers</h2>
            <p className="mt-1.5 mb-4 text-[14px] leading-relaxed" style={ink2}>
              Your free report covers their last 30 days: new Instagram and Facebook posts, Meta ads, Google reviews, and what to do about it. Two more follow, one a month.
            </p>
            {emailForm}
          </Card>
          {legal}
          <p className="mt-2 text-[12.5px]" style={muted}>
            Not your business? <button type="button" className="underline" onClick={() => { setPreview(null); setResults(null); setError(''); setStep('find'); }}>Search again</button>
          </p>
        </>
      )}

      {step === 'email' && (
        <>
          <StepHeading title="Where should we send your reports?" sub="Three free monthly reports on your competitors. No account, no password." />
          <Card>{emailForm}</Card>
          {legal}
        </>
      )}

      {step === 'sent' && (
        <>
          <Card className="space-y-3">
            <Mail size={34} strokeWidth={1.6} aria-hidden="true" />
            <h1 className="text-[26px] md:text-[28px] leading-tight">Check your email</h1>
            <p className="text-[15px] leading-relaxed" style={ink2}>
              We sent a link to <strong style={{ color: 'var(--mkt-ink)' }}>{sentTo}</strong>. Open it to confirm your business and pick the competitors to watch.
            </p>
            <p className="text-[13.5px]" style={muted}>The link works for 24 hours. Nothing is collected until you use it.</p>
            <div className="pt-1 flex items-center gap-3 flex-wrap">
              <Button variant="ghost" disabled={busy} onClick={() => send(sentTo)}>{busy ? 'Sending' : 'Send it again'}</Button>
              {again && !busy && <span role="status" className="text-[13px]" style={ink2}>Sent. A new link can take a couple of minutes.</span>}
            </div>
            <ErrorNote>{error}</ErrorNote>
          </Card>
          <p className="mt-4 text-[12.5px]" style={muted}>
            Wrong address? <button type="button" className="underline" onClick={() => { setSentTo(''); setAgain(false); setError(''); setStep(preview ? 'competitors' : 'email'); }}>Change it</button>
          </p>
        </>
      )}
    </BriefingShell>
  );
}
