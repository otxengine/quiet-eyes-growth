import React, { useState } from 'react';
import { briefingApi } from './api';
import { Button, ErrorNote, TextInput } from './ui.jsx';

// US zones first (the product is sold in the US); the browser's own zone is added if it is not one of them.
const US_ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];
const zoneLabel = (z) => z.replace(/_/g, ' ').replace('/', ' / ');

/** Who gets the report, and the timezone its periods are cut in. */
export default function DeliveryForm({ businessProfileId, initial, saveLabel = 'Save', onSaved }) {
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = [...new Set([initial.timezone, browserZone, ...US_ZONES].filter(Boolean))];
  const [recipients, setRecipients] = useState((initial.recipients || []).join(', '));
  const [timezone, setTimezone] = useState(initial.timezone || browserZone);
  const [instagramUrl, setInstagramUrl] = useState(initial.instagramUrl || '');
  const [facebookUrl, setFacebookUrl] = useState(initial.facebookUrl || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setError('');
    setSaved(false);
    const list = recipients.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) return setError('Enter at least one email address.');
    setSaving(true);
    try {
      await briefingApi.saveSettings(businessProfileId, { recipients: list, timezone, instagramUrl: instagramUrl.trim(), facebookUrl: facebookUrl.trim() });
      setSaved(true);
      onSaved?.();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="bf-recipients" className="block font-bold text-[14px] mb-1.5">Send the report to</label>
        <TextInput id="bf-recipients" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="you@yourbusiness.com, partner@yourbusiness.com" />
        <p className="mt-1.5 text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>
          Up to 5 addresses, separated by commas. Reports arrive at 9am in your time zone, and every email has an unsubscribe link.
          WhatsApp delivery is coming soon.
        </p>
      </div>
      <div>
        <label htmlFor="bf-tz" className="block font-bold text-[14px] mb-1.5">Your time zone</label>
        <select id="bf-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full h-11 rounded-xl border bg-white px-3 text-[14.5px]" style={{ borderColor: 'var(--mkt-border-strong)' }}>
          {zones.map((z) => <option key={z} value={z}>{zoneLabel(z)}</option>)}
        </select>
        <p className="mt-1.5 text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>"Yesterday" and "last week" in your reports follow this time zone.</p>
      </div>
      <div>
        <div className="font-bold text-[14px] mb-1.5">Your own pages</div>
        <div className="grid sm:grid-cols-2 gap-2.5">
          <TextInput value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} placeholder="https://www.instagram.com/yourbusiness" aria-label="Your Instagram page" maxLength={300} />
          <TextInput value={facebookUrl} onChange={(e) => setFacebookUrl(e.target.value)} placeholder="https://www.facebook.com/yourbusiness" aria-label="Your Facebook page" maxLength={300} />
        </div>
        <p className="mt-1.5 text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>
          {initial.youVsThem === false
            ? 'Used for the "you vs. your competitors" section of the monthly report, on paid plans.'
            : 'Used for the "you vs. your competitors" section of your monthly report.'}
        </p>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-[13.5px]" style={{ color: 'var(--mkt-ink-2)' }}>Saved</span>}
        <Button variant="gradient" onClick={save} disabled={saving}>{saving ? 'Saving' : saveLabel}</Button>
      </div>
    </div>
  );
}
