import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Admin panel (admin.html). Server: server/src/routes/admin.ts. Every change is audit-logged there.

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const PLANS = ['free_trial', 'starter', 'growth', 'pro', 'enterprise'];
const PAID = new Set(['starter', 'growth', 'pro', 'enterprise']);
const JOBS = [
  { kind: 'reviews', label: 'Collect reviews', cost: 'DataForSEO, a few cents' },
  { kind: 'competitor_posts', label: 'Collect competitor posts', cost: 'Apify, a few cents' },
  { kind: 'report_daily', label: 'Daily report', cost: 'one LLM call, emails the report' },
  { kind: 'report_weekly', label: 'Weekly report', cost: 'one LLM call, emails the report' },
  { kind: 'report_monthly', label: 'Monthly report', cost: 'one LLM call, emails the report' },
];

// Clerk's browser global, set by ClerkProvider; undefined in local dev without Clerk.
const clerk = () => /** @type {any} */ (window).Clerk;

/** @param {string} path @param {{ method?: string, body?: unknown }} [opts] */
async function api(path, { method = 'GET', body = undefined } = {}) {
  const token = await clerk()?.session?.getToken().catch(() => null);
  const res = await fetch(`${API}/admin${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

const fmtDate = d => (d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' }) : '—');
const ago = d => {
  if (!d) return '—';
  const m = (Date.now() - new Date(d).getTime()) / 60000;
  return m < 60 ? `${Math.max(0, Math.round(m))}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const go = path => { window.location.hash = path; };

function useRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#/, '') || '/';
}

// ── Shell ────────────────────────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const route = useRoute();
  const me = useQuery({ queryKey: ['admin-me'], queryFn: () => api('/me'), retry: false });

  let page;
  if (me.isLoading) page = <Spinner />;
  else if (me.error) page = <AccessError error={me.error} />;
  else if (route.startsWith('/b/')) page = <CustomerPage id={decodeURIComponent(route.slice(3))} />;
  else if (route === '/audit') page = <AuditPage />;
  else page = <CustomersPage />;

  return (
    // index.css sets body to rtl / text-align right for the app; this page is English.
    <div className="min-h-screen bg-muted/30 text-foreground text-left" dir="ltr">
      <header className="h-12 border-b bg-background flex items-center gap-6 px-6">
        <a href="#/" className="font-semibold">Cortexi Admin</a>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          <a href="#/" className={route === '/' || route.startsWith('/b/') ? 'text-foreground' : ''}>Customers</a>
          <a href="#/audit" className={route === '/audit' ? 'text-foreground' : ''}>Audit log</a>
        </nav>
        {clerk() && (
          <div className="ml-auto flex gap-3 text-sm">
            <button className="text-muted-foreground hover:text-foreground" onClick={() => clerk().openUserProfile()}>Account</button>
            <button className="text-muted-foreground hover:text-foreground" onClick={() => clerk().signOut()}>Sign out</button>
          </div>
        )}
      </header>
      <main className="p-6 max-w-[1400px] mx-auto">{page}</main>
    </div>
  );
}

function AccessError({ error }) {
  if (error.message === 'not_admin') {
    return (
      <Notice title="This account isn't an admin">
        Add this Clerk user id to <code>ADMIN_USER_IDS</code> (SSM <code>/qe/&lt;env&gt;/ADMIN_USER_IDS</code>) and restart the API:
        <pre className="mt-2 p-2 bg-muted rounded text-xs select-all">{clerk()?.user?.id || 'unknown'}</pre>
      </Notice>
    );
  }
  return <Notice title="Can't reach the admin API">{error.message}</Notice>;
}

// ── Customers list ───────────────────────────────────────────────────────────────────────────

function CustomersPage() {
  const { data, error, isLoading } = useQuery({ queryKey: ['customers'], queryFn: () => api('/customers') });
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const all = data?.businesses || [];
    return s ? all.filter(b => [b.name, b.owner_email, b.id, b.city, b.category, b.plan].some(v => v?.toLowerCase().includes(s))) : all;
  }, [data, search]);

  if (isLoading) return <Spinner />;
  if (error) return <Notice title="Couldn't load customers">{error.message}</Notice>;
  const paid = data.businesses.filter(b => PAID.has(b.plan)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-6">
        <Stat label="Businesses" value={data.businesses.length} />
        <Stat label="On a paid plan" value={paid} />
        <Stat label="Sign-ups without a business" value={data.pendingOrgs.length} />
        <Input className="ml-auto w-72 bg-background" placeholder="Search name, email, id, city…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <Section>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Business</TableHead><TableHead>Owner</TableHead><TableHead>Plan</TableHead>
              <TableHead>Created</TableHead><TableHead className="text-right">Competitors</TableHead>
              <TableHead>Reviews collected</TableHead><TableHead>Last reports (D / W / M)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(b => (
              <TableRow key={b.id} className="cursor-pointer" onClick={() => go(`/b/${b.id}`)}>
                <TableCell>
                  <div dir="auto" className="font-medium">{b.name}</div>
                  <div dir="auto" className="text-xs text-muted-foreground">{[b.category, b.city].filter(Boolean).join(' · ')}{!b.is_active && ' · inactive'}</div>
                </TableCell>
                <TableCell className="text-sm">{b.owner_email || '—'}</TableCell>
                <TableCell><PlanBadge plan={b.plan} paddle={b.paddle} /></TableCell>
                <TableCell className="text-sm whitespace-nowrap">{fmtDate(b.created)}</TableCell>
                <TableCell className="text-right">{b.competitors}</TableCell>
                <TableCell className="text-sm">{ago(b.last_reviews_at)}</TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  {['daily', 'weekly', 'monthly'].map(t => ago(b.last_reports?.[t])).join(' / ')}
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && <EmptyRow cols={7} />}
          </TableBody>
        </Table>
      </Section>

      {data.pendingOrgs.length > 0 && (
        <Section title="Sign-ups without a business (onboarding not finished)">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Organization</TableHead><TableHead>Owner</TableHead><TableHead>Created</TableHead><TableHead>Plan</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {data.pendingOrgs.map(o => (
                <TableRow key={o.id}>
                  <TableCell dir="auto">{o.name}</TableCell>
                  <TableCell className="text-sm">{o.owner_email || '—'}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{fmtDate(o.created)}</TableCell>
                  <TableCell><PlanControl org={o} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
    </div>
  );
}

// ── One customer ─────────────────────────────────────────────────────────────────────────────

const ACTIVE = new Set(['queued', 'running']);

function CustomerPage({ id }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api(`/customers/${encodeURIComponent(id)}`),
    refetchInterval: q => (q.state.data?.jobs?.some(j => ACTIVE.has(j.status)) ? 5000 : false),
  });
  if (isLoading) return <Spinner />;
  if (error) return <Notice title="Couldn't load this business">{error.message}</Notice>;
  const { business: b, org, members, counts, reports, logs, jobs, audit } = data;

  return (
    <div className="space-y-6">
      <div>
        <a href="#/" className="text-sm text-muted-foreground">← Customers</a>
        <h1 dir="auto" className="text-2xl font-semibold mt-1">{b.name}</h1>
        <p className="text-sm text-muted-foreground">
          {[b.category, b.city].filter(Boolean).join(' · ')} · created {fmtDate(b.created)} · {b.owner_email || 'no owner email'}
          {!b.is_active && ' · inactive'}{!b.onboarding_completed && ' · onboarding not completed'}
        </p>
        <p className="text-xs text-muted-foreground mt-1 select-all">{b.id}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Section title="Plan">
          <div className="p-4 space-y-3">
            <div><PlanBadge plan={b.plan} paddle={!!org?.paddle_subscription_id} /></div>
            {org ? <PlanControl org={{ ...org, paddle: !!org.paddle_subscription_id }} /> : <p className="text-sm text-muted-foreground">No organization, so the plan can't be set here.</p>}
            {org?.current_period_end && <p className="text-xs text-muted-foreground">Paddle period ends {fmtDate(org.current_period_end)}</p>}
          </div>
        </Section>
        <Section title="Data">
          <dl className="p-4 grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Own reviews</dt><dd>{counts.own_reviews}</dd>
            <dt className="text-muted-foreground">Competitor reviews</dt><dd>{counts.competitor_reviews}</dd>
            <dt className="text-muted-foreground">Competitors</dt><dd>{counts.competitors_approved} approved / {counts.competitors_total}</dd>
            <dt className="text-muted-foreground">Competitor posts</dt><dd>{counts.competitor_posts}</dd>
            <dt className="text-muted-foreground">Report language</dt><dd>{b.locale || 'he'} · {b.timezone || 'Asia/Jerusalem'}</dd>
          </dl>
        </Section>
        <Section title="Team">
          <ul className="p-4 text-sm space-y-1">
            {members.map((m, i) => <li key={i}>{m.email || '—'} <span className="text-muted-foreground">· {m.role}{m.status !== 'active' && ` · ${m.status}`}</span></li>)}
            {!members.length && <li className="text-muted-foreground">No members</li>}
          </ul>
        </Section>
      </div>

      <RunNow id={id} jobs={jobs} />

      <Section title="Reports">
        <SimpleTable cols={['Type', 'Period start', 'Status', 'PDF', 'Cost', 'Created']} rows={reports.map(r => [
          r.report_type, fmtDate(r.period_start), r.status, r.pdf ? 'yes' : '—', r.cost_usd != null ? `$${r.cost_usd.toFixed(3)}` : '—', fmtDate(r.created_date),
        ])} />
      </Section>

      <Section title="Recent activity (automation logs)">
        <SimpleTable cols={['Agent', 'When', 'Status', 'Items', 'Cost', 'Error']} rows={logs.map(l => [
          l.automation_name, fmtDate(l.created_date), l.status, l.items_processed ?? '—', l.cost_usd ? `$${l.cost_usd.toFixed(3)}` : '—',
          <span className="text-xs text-muted-foreground break-all">{l.error_message || ''}</span>,
        ])} />
      </Section>

      <Section title="Admin history">
        <AuditTable rows={audit} />
      </Section>

      <DeleteBusiness business={b} />
    </div>
  );
}

function RunNow({ id, jobs }) {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: kind => api(`/customers/${encodeURIComponent(id)}/jobs`, { method: 'POST', body: { kind } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customer', id] }),
  });
  const busy = new Set(jobs.filter(j => ACTIVE.has(j.status)).map(j => j.kind));
  const start = job => {
    if (window.confirm(`${job.label} now? Cost: ${job.cost}. The worker picks it up within a minute.`)) run.mutate(job.kind);
  };
  return (
    <Section title="Run now">
      <div className="p-4 flex flex-wrap gap-2">
        {JOBS.map(j => (
          <Button key={j.kind} size="sm" variant="outline" disabled={busy.has(j.kind) || run.isPending} onClick={() => start(j)}>
            {busy.has(j.kind) && <Loader2 className="animate-spin" />}{j.label}
          </Button>
        ))}
        {run.error && <span className="text-sm text-destructive self-center">{run.error.message}</span>}
      </div>
      {jobs.length > 0 && (
        <SimpleTable cols={['Job', 'Status', 'Queued', 'Finished', 'Result']} rows={jobs.map(j => [
          JOBS.find(x => x.kind === j.kind)?.label || j.kind,
          <JobStatus status={j.status} />,
          fmtDate(j.created_at),
          fmtDate(j.finished_at),
          j.result ? <Json value={j.result} /> : '—',
        ])} />
      )}
    </Section>
  );
}

function DeleteBusiness({ business }) {
  const qc = useQueryClient();
  const [confirmName, setConfirmName] = useState('');
  const preview = useMutation({ mutationFn: () => api(`/customers/${encodeURIComponent(business.id)}/delete-preview`) });
  const del = useMutation({
    mutationFn: () => api(`/customers/${encodeURIComponent(business.id)}/delete`, { method: 'POST', body: { confirmName } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); go('/'); },
  });
  return (
    <Section title="Delete business" danger>
      <div className="p-4 space-y-3 text-sm">
        <p>
          Deletes the business and every row tied to it or to its competitors, in one transaction. The login,
          the organization and stored PDFs stay. Undo is an RDS point-in-time restore (7 days).
        </p>
        {!preview.data && <Button size="sm" variant="outline" disabled={preview.isPending} onClick={() => preview.mutate()}>Show what would be deleted</Button>}
        {preview.error && <p className="text-destructive">{preview.error.message}</p>}
        {preview.data && (
          <>
            <SimpleTable cols={['Table', 'Column', 'Rows']} rows={preview.data.tables.map(t => [t.table, t.column, t.rows])} />
            <div className="flex flex-wrap items-center gap-2">
              <Input dir="auto" className="w-72" placeholder="Type the business name to confirm" value={confirmName} onChange={e => setConfirmName(e.target.value)} />
              <Button size="sm" variant="destructive" disabled={confirmName !== business.name || del.isPending} onClick={() => del.mutate()}>
                {del.isPending && <Loader2 className="animate-spin" />}Delete permanently
              </Button>
            </div>
            {del.error && <p className="text-destructive">{del.error.message}</p>}
          </>
        )}
      </div>
    </Section>
  );
}

// ── Audit log ────────────────────────────────────────────────────────────────────────────────

function AuditPage() {
  const { data, error, isLoading } = useQuery({ queryKey: ['audit'], queryFn: () => api('/audit') });
  if (isLoading) return <Spinner />;
  if (error) return <Notice title="Couldn't load the audit log">{error.message}</Notice>;
  return <Section title="Audit log (last 200 changes)"><AuditTable rows={data} /></Section>;
}

function AuditTable({ rows }) {
  return (
    <SimpleTable cols={['When', 'Admin', 'Action', 'Target', 'Detail']} rows={rows.map(a => [
      fmtDate(a.created_at),
      <span className="text-xs">{a.admin_user_id}</span>,
      a.action,
      a.action.startsWith('plan.') ? <span className="text-xs">{a.target}</span> : <a className="text-xs underline" href={`#/b/${a.target}`}>{a.target}</a>,
      <Json value={a.detail} />,
    ])} />
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────

function PlanControl({ org }) {
  const qc = useQueryClient();
  const [plan, setPlan] = useState(org.plan || 'free_trial');
  const save = useMutation({
    mutationFn: () => api(`/orgs/${encodeURIComponent(org.id)}/plan`, { method: 'POST', body: { plan } }),
    onSuccess: () => qc.invalidateQueries(),
  });
  if (org.paddle) return <p className="text-sm text-muted-foreground">Pays through Paddle; change the plan there.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="h-8 rounded-md border bg-background px-2 text-sm" value={plan} onChange={e => setPlan(e.target.value)}>
        {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <Button size="sm" disabled={plan === org.plan || save.isPending}
        onClick={() => window.confirm(`Set the plan of every business in this organization to "${plan}"?`) && save.mutate()}>
        {save.isPending && <Loader2 className="animate-spin" />}Save
      </Button>
      {save.error && <span className="text-xs text-destructive">{save.error.message}</span>}
    </div>
  );
}

function PlanBadge({ plan, paddle }) {
  return (
    <span className="inline-flex gap-1">
      <Badge variant={PAID.has(plan) ? 'default' : 'secondary'}>{plan}</Badge>
      {PAID.has(plan) && <Badge variant="outline">{paddle ? 'Paddle' : 'manual'}</Badge>}
    </span>
  );
}

function JobStatus({ status }) {
  const variant = status === 'failed' ? 'destructive' : status === 'done' ? 'default' : 'secondary';
  return <Badge variant={variant}>{ACTIVE.has(status) && <Loader2 className="size-3 mr-1 animate-spin" />}{status}</Badge>;
}

function Json({ value }) {
  const text = JSON.stringify(value, null, 2);
  if (text.length < 80) return <code className="text-xs break-all">{JSON.stringify(value)}</code>;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">{JSON.stringify(value).slice(0, 70)}…</summary>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all">{text}</pre>
    </details>
  );
}

function SimpleTable({ cols, rows }) {
  return (
    <Table>
      <TableHeader><TableRow>{cols.map(c => <TableHead key={c}>{c}</TableHead>)}</TableRow></TableHeader>
      <TableBody>
        {rows.map((r, i) => <TableRow key={i}>{r.map((v, j) => <TableCell key={j} className="text-sm align-top">{v}</TableCell>)}</TableRow>)}
        {!rows.length && <EmptyRow cols={cols.length} />}
      </TableBody>
    </Table>
  );
}

const EmptyRow = ({ cols }) => <TableRow><TableCell colSpan={cols} className="text-center text-sm text-muted-foreground">Nothing yet</TableCell></TableRow>;

function Section({ title = '', danger = false, children }) {
  return (
    <section className={`rounded-lg border bg-background ${danger ? 'border-destructive/40' : ''}`}>
      {title && <h2 className={`px-4 pt-3 pb-2 text-sm font-semibold ${danger ? 'text-destructive' : ''}`}>{title}</h2>}
      {children}
    </section>
  );
}

const Stat = ({ label, value }) => (
  <div><div className="text-2xl font-semibold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>
);

const Notice = ({ title, children }) => (
  <div className="max-w-xl mx-auto mt-16 rounded-lg border bg-background p-6">
    <h2 className="font-semibold mb-2">{title}</h2>
    <div className="text-sm text-muted-foreground">{children}</div>
  </div>
);

const Spinner = () => <div className="grid place-items-center py-24"><Loader2 className="animate-spin text-muted-foreground" /></div>;
