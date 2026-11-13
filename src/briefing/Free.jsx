import React, { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { briefingApi } from './api';
import { BriefingShell, Button, Card, ErrorNote, StepHeading, TextInput } from './ui.jsx';
import { BUSINESS_QUERY_KEY } from './keys.js';
import { track } from '@/lib/gtm.js';

// The exact wording the server stores with the address (FREE_CONSENT_TEXT in server/src/lib/freeAccess.ts).
// Change both together.
const CONSENT = 'I agree to receive the Cortexi newsletter. It comes with the free reports, and one unsubscribe link stops both.';

/**
 * The Free plan needs no account: an email address and the newsletter consent. We email a link, and
 * that link opens the setup (/en/start?t=…).
 */
export default function Free() {
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [again, setAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // What they typed in the landing page's search box, kept for the setup page. localStorage, not
  // sessionStorage: the emailed link opens in a new tab.
  useEffect(() => {
    const business = (new URLSearchParams(window.location.search).get('business') || '').trim().slice(0, 120);
    if (business) localStorage.setItem(BUSINESS_QUERY_KEY, business);
  }, []);

  const send = async (address) => {
    setError('');
    if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(address)) return setError('Enter a valid email address.');
    if (!consent) return setError('To get the free reports, agree to receive the Cortexi newsletter.');
    setBusy(true);
    try {
      await briefingApi.requestFreeLink(address, true);
      if (!sentTo) track('generate_lead', { market: 'en', method: 'free_email' }); // not on "send again"
      setAgain(!!sentTo);
      setSentTo(address);
    } catch (e) {
      setError(e.data?.not_available ? 'Cortexi reports are not available in your country yet.' : e.message);
    } finally { setBusy(false); }
    return undefined;
  };

  return (
    <BriefingShell signOut={false}>
      {!sentTo && (
        <>
          <StepHeading step="Step 1 of 3" title="Where should we send your reports?" sub="Three free monthly reports on your competitors. No account, no password." />
          <Card>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); send(email.trim().toLowerCase()); }} noValidate>
              <div>
                <label htmlFor="free-email" className="block text-[13.5px] font-bold mb-1.5">Email</label>
                <TextInput id="free-email" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} placeholder="name@company.com" maxLength={200} />
              </div>
              <label className="flex items-start gap-2.5 text-[13.5px] leading-snug cursor-pointer" style={{ color: 'var(--mkt-ink-2)' }}>
                <input type="checkbox" className="mt-0.5 shrink-0 w-[18px] h-[18px]" style={{ accentColor: 'var(--mkt-ink)' }} checked={consent} onChange={(e) => { setConsent(e.target.checked); setError(''); }} />
                <span>{CONSENT}</span>
              </label>
              <ErrorNote>{error}</ErrorNote>
              <Button type="submit" variant="gradient" disabled={busy}>{busy ? 'Sending' : 'Send my link'}</Button>
            </form>
          </Card>
          <p className="mt-4 text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>
            By continuing you agree to our <a href="/en/terms" target="_blank" rel="noopener" className="underline">Terms of Service</a> and <a href="/en/privacy" target="_blank" rel="noopener" className="underline">Privacy Policy</a>.
            Want reports every week or every day? <a href="/sign-up?briefing=1" className="underline">See paid plans</a>.
          </p>
        </>
      )}

      {sentTo && (
        <>
          <Card className="space-y-3">
            <Mail size={34} strokeWidth={1.6} aria-hidden="true" />
            <h1 className="text-[26px] md:text-[28px] leading-tight">Check your email</h1>
            <p className="text-[15px] leading-relaxed" style={{ color: 'var(--mkt-ink-2)' }}>
              We sent a link to <strong style={{ color: 'var(--mkt-ink)' }}>{sentTo}</strong>. Open it to tell us about your business and pick your competitors.
            </p>
            <p className="text-[13.5px]" style={{ color: 'var(--mkt-muted)' }}>The link works for 24 hours. Nothing is collected until you use it.</p>
            <div className="pt-1 flex items-center gap-3 flex-wrap">
              <Button variant="ghost" disabled={busy} onClick={() => send(sentTo)}>{busy ? 'Sending' : 'Send it again'}</Button>
              {again && !busy && <span role="status" className="text-[13px]" style={{ color: 'var(--mkt-ink-2)' }}>Sent. A new link can take a couple of minutes.</span>}
            </div>
            <ErrorNote>{error}</ErrorNote>
          </Card>
          <p className="mt-4 text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>
            Wrong address? <button type="button" className="underline" onClick={() => { setSentTo(''); setAgain(false); setError(''); }}>Change it</button>
          </p>
        </>
      )}
    </BriefingShell>
  );
}
