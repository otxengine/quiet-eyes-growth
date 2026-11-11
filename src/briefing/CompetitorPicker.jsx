import React, { useEffect, useMemo, useState } from 'react';
import { Star, Instagram, Facebook, Globe, Plus, RefreshCw } from 'lucide-react';
import { briefingApi } from './api';
import { Button, Card, ErrorNote, Spinner, TextInput } from './ui.jsx';

/**
 * Choose which competitors to watch: the suggestions we found plus any the user adds, capped at the
 * plan's limit. Used at sign-up and in the account. `onSaved` fires after the choice is stored.
 */
export default function CompetitorPicker({ businessProfileId, limit, saveLabel = 'Continue', onSaved }) {
  const [rows, setRows] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', instagram_url: '' });
  const [editing, setEditing] = useState(null); // { id, field, value }
  const [lookingUp, setLookingUp] = useState(new Set()); // ids whose pages are being looked up

  const load = async (keepPicked) => {
    const all = (await briefingApi.competitors(businessProfileId)).filter((c) => !c.not_relevant && c.tracking_status !== 'rejected');
    all.sort((a, b) => (b.review_count || 0) - (a.review_count || 0));
    setRows(all);
    if (!keepPicked) {
      // Already-tracked ones stay picked; otherwise the best-known suggestions, up to the plan limit.
      const approved = all.filter((c) => c.tracking_status === 'approved').map((c) => c.id);
      setPicked(new Set(approved.length ? approved : all.slice(0, limit).map((c) => c.id)));
    }
    return all;
  };

  useEffect(() => { load(false).catch((e) => setError(e.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [businessProfileId]);

  const full = picked.size >= limit;
  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else if (next.size < limit) next.add(id);
    return next;
  });

  // The page lookup of a hand-added competitor takes up to a couple of minutes. The competitor is
  // shown right away, and the list is reloaded while the lookup runs so its pages appear as found.
  const lookUp = async (id) => {
    setLookingUp((prev) => new Set(prev).add(id));
    let finished = false;
    briefingApi.lookUpPages(id).catch(() => null).finally(() => { finished = true; });
    for (let i = 0; i < 22 && !finished; i += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 8000); });
      await load(true).catch(() => null);
    }
    await load(true).catch(() => null);
    setLookingUp((prev) => { const next = new Set(prev); next.delete(id); return next; });
  };

  const add = async () => {
    setError('');
    if (form.name.trim().length < 2) return setError('Enter the competitor\'s name.');
    setAdding(true);
    try {
      const created = await briefingApi.addCompetitor(businessProfileId, form.name.trim(), { instagram_url: form.instagram_url.trim() });
      setForm({ name: '', instagram_url: '' });
      await load(true);
      // Picked right away when there is room; otherwise it joins the list for them to swap in.
      setPicked((prev) => (prev.size < limit ? new Set(prev).add(created.id) : prev));
      lookUp(created.id); // not awaited: the form is free for the next one
    } catch (e) {
      setError(e.data?.plan_limit
        ? `Your plan tracks ${limit} competitors. Save your selection first, then swap one out — or upgrade.`
        : 'We could not add this competitor. Try again in a moment.');
    } finally { setAdding(false); }
  };

  const saveLink = async () => {
    const { id, field, value } = editing;
    try {
      const row = rows.find((r) => r.id === id);
      await briefingApi.updateCompetitor(id, { [field]: value.trim() || null, manual_url_fields: [...new Set([...(row.manual_url_fields || []), field])] });
      setEditing(null);
      await load(true);
    } catch (e) { setError(e.message); }
  };

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      const approved = rows.filter((r) => picked.has(r.id)).map((r) => r.id);
      const rejected = rows.filter((r) => !picked.has(r.id)).map((r) => r.id);
      await briefingApi.confirmCompetitors(businessProfileId, approved, rejected);
      onSaved?.(approved.length);
    } catch (e) {
      setError(e.data?.plan_limit ? `Your plan tracks ${limit} competitors.` : e.message);
    } finally { setSaving(false); }
  };

  const counter = useMemo(() => `${picked.size} of ${limit} selected`, [picked, limit]);
  if (!rows) return error ? <ErrorNote>{error}</ErrorNote> : <Spinner label="Loading competitors" />;

  const link = (c, field, Icon, label) => {
    const url = c[field];
    const isEditing = editing?.id === c.id && editing.field === field;
    if (isEditing) {
      return (
        <span className="flex items-center gap-2 w-full mt-1">
          <TextInput autoFocus value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} placeholder={`https://${label.toLowerCase()}.com/…`} className="!h-9 text-[13px]" aria-label={`${label} page of ${c.name}`} />
          <button type="button" className="text-[13px] font-bold" onClick={saveLink}>Save</button>
          <button type="button" className="text-[13px]" style={{ color: 'var(--mkt-muted)' }} onClick={() => setEditing(null)}>Cancel</button>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: url ? 'var(--mkt-ink-2)' : 'var(--mkt-muted)' }}>
        <Icon size={13} aria-hidden="true" />
        {url
          ? <a href={url} target="_blank" rel="noreferrer" className="underline decoration-dotted">{label}</a>
          : lookingUp.has(c.id) ? `Looking for ${label}…` : `No ${label} found`}
        <button type="button" className="underline" style={{ color: 'var(--mkt-muted)' }} onClick={() => setEditing({ id: c.id, field, value: url || '' })}>
          {url ? 'Not right?' : 'Add'}
        </button>
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 text-[13.5px]">
        <span className="font-bold">{counter}</span>
        <span className="flex items-center gap-3" style={{ color: 'var(--mkt-muted)' }}>
          {full && <span>Your plan tracks {limit}. Unselect one to swap.</span>}
          {/* Pages are still being looked up for a minute or two after the list appears. */}
          <button type="button" className="inline-flex items-center gap-1 underline" onClick={() => load(true).catch((e) => setError(e.message))}>
            <RefreshCw size={12} aria-hidden="true" />Refresh
          </button>
        </span>
      </div>

      {rows.length === 0 && (
        <Card><p className="text-[14.5px]" style={{ color: 'var(--mkt-ink-2)' }}>We did not find nearby competitors automatically. Add the ones you know below.</p></Card>
      )}

      <ul className="space-y-2.5">
        {rows.map((c) => {
          const on = picked.has(c.id);
          return (
            <li key={c.id}>
              <Card className="!p-4" style={on ? { borderColor: 'var(--mkt-ink)' } : undefined}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(c.id)} className="mt-1 w-4 h-4 accent-black" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-[15px]">{c.name}</span>
                      {c.rating != null && (
                        <span className="inline-flex items-center gap-1 text-[12.5px]" style={{ color: 'var(--mkt-ink-2)' }}>
                          <Star size={12} aria-hidden="true" /> {Number(c.rating).toFixed(1)}{c.review_count ? ` (${c.review_count})` : ''}
                        </span>
                      )}
                    </span>
                    {c.address && <span className="block text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>{c.address}</span>}
                  </span>
                </label>
                <div className="mt-2.5 pl-7 flex flex-wrap gap-x-5 gap-y-1.5">
                  {link(c, 'instagram_url', Instagram, 'Instagram')}
                  {link(c, 'facebook_url', Facebook, 'Facebook')}
                  {link(c, 'website_url', Globe, 'Website')}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <Card className="!p-4">
        <div className="font-bold text-[14px] mb-2.5">Add a competitor</div>
        <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2.5">
          <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Business name" aria-label="Competitor name" maxLength={120} />
          <TextInput value={form.instagram_url} onChange={(e) => setForm({ ...form, instagram_url: e.target.value })} placeholder="Instagram link (optional)" aria-label="Competitor Instagram link" maxLength={300} />
          <Button variant="ghost" onClick={add} disabled={adding}><Plus size={15} aria-hidden="true" />{adding ? 'Adding' : 'Add'}</Button>
        </div>
        <p className="mt-2 text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>
          We look up their Instagram, Facebook and website for you. It can take a minute or two; you can keep going meanwhile.
          If we find the wrong page or none, add the link yourself.
        </p>
      </Card>

      <ErrorNote>{error}</ErrorNote>
      <div className="flex justify-end">
        <Button variant="gradient" onClick={save} disabled={saving || picked.size === 0}>{saving ? 'Saving' : saveLabel}</Button>
      </div>
    </div>
  );
}
