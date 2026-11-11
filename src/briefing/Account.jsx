import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { EN_PLANS } from '../marketing/en/plans.js';
import { billingApi } from '@/api/billingApi';
import { openLinkedPaddleCheckout } from '@/lib/paddle';
import { briefingApi } from './api';
import { BriefingShell, Button, Card, ErrorNote, Spinner } from './ui.jsx';
import CompetitorPicker from './CompetitorPicker.jsx';
import DeliveryForm from './DeliveryForm.jsx';
import PlanCards from './PlanCards.jsx';

const TABS = [['reports', 'Reports'], ['competitors', 'Competitors'], ['delivery', 'Delivery'], ['plan', 'Plan']];
const TYPE = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

function periodText(r, timeZone) {
  const f = (d, o) => new Intl.DateTimeFormat('en-US', { timeZone, ...o }).format(new Date(d));
  const last = new Date(new Date(r.period_end).getTime() - 1);
  const full = { month: 'short', day: 'numeric', year: 'numeric' };
  if (r.report_type === 'daily') return f(r.period_start, full);
  return `${f(r.period_start, { month: 'short', day: 'numeric' })} – ${f(last, full)}`;
}

function Reports({ businessProfileId, timezone, welcome }) {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stop = false;
    const load = () => briefingApi.reports(businessProfileId)
      .then((d) => { if (!stop) setReports(d.reports); })
      .catch((e) => { if (!stop) setError(e.message); });
    load();
    // The first report takes a few minutes to build; keep checking while there is none.
    const t = setInterval(() => { if (!stop && !(reports && reports.length)) load(); }, 30000);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessProfileId, reports?.length]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!reports) return <Spinner label="Loading reports" />;
  if (!reports.length) {
    return (
      <Card>
        <h2 className="text-[19px]">{welcome ? 'You are all set' : 'No reports yet'}</h2>
        <p className="mt-2 text-[14.5px]" style={{ color: 'var(--mkt-ink-2)' }}>
          We are collecting your competitors' last 30 days and writing your first report. It usually takes 10 to 20 minutes;
          you will get it by email and it will appear here.
        </p>
        <div className="mt-4"><Spinner label="Working on your first report" /></div>
      </Card>
    );
  }
  return (
    <ul className="space-y-2.5">
      {reports.map((r) => (
        <li key={r.id}>
          <Card className="!p-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[12.5px] font-bold" style={{ color: 'var(--mkt-muted)' }}>{TYPE[r.report_type]} · {periodText(r, timezone)}</div>
              <div className="mt-0.5 text-[14.5px] font-medium">
                {r.headline || (r.status === 'empty' ? 'No new competitor activity in this period.' : 'Report is being written.')}
              </div>
            </div>
            {r.has_pdf && (
              <Button variant="ghost" className="shrink-0 !h-10 text-[13px]" onClick={() => briefingApi.openReportPdf(r.id).catch((e) => setError(e.message))}>
                <FileText size={14} aria-hidden="true" />Open PDF
              </Button>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** Account area of the English report-only product: reports, competitors, delivery, plan. */
export default function Account() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'reports';
  const [business, setBusiness] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadSettings = (id) => briefingApi.settings(id).then(setSettings);

  // A link from a Paddle email (?_ptxn=…) opens its checkout here, as Subscription.jsx does for the app.
  useEffect(() => { openLinkedPaddleCheckout(); }, []);

  useEffect(() => {
    (async () => {
      try {
        const { business: b } = await briefingApi.me();
        if (!b || !b.onboardingCompleted) return navigate('/en/start', { replace: true });
        setBusiness(b);
        await loadSettings(b.businessProfileId);
      } catch (e) { setError(e.message); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const planName = EN_PLANS.find((p) => p.id === settings?.plan)?.name || 'Free';
  const openPortal = async () => {
    try { const { url } = await billingApi.portal(settings.orgId); if (url) window.open(url, '_blank', 'noopener'); }
    catch { setError('We could not open billing. Write to contact@cortexi.ai.'); }
  };

  const nav = (
    <nav className="flex items-center gap-1 text-[13.5px] font-medium overflow-x-auto" aria-label="Account">
      {TABS.map(([k, label]) => (
        <button key={k} type="button" onClick={() => { setNotice(''); setParams({ tab: k }); }} aria-current={tab === k ? 'page' : undefined}
          className="rounded-full px-3.5 h-9 whitespace-nowrap" style={tab === k ? { background: 'var(--mkt-ink)', color: '#fff' } : { color: 'var(--mkt-ink-2)' }}>
          {label}
        </button>
      ))}
    </nav>
  );

  return (
    <BriefingShell nav={nav}>
      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}
      {!settings && !error && <Spinner label="Loading" />}
      {settings && business && (
        <>
          <div className="mb-6">
            <h1 className="text-[26px] leading-tight">{settings.name}</h1>
            <p className="text-[13.5px]" style={{ color: 'var(--mkt-muted)' }}>{settings.city} · {planName} plan</p>
          </div>
          {notice && <p className="mb-4 text-[14px] font-medium" role="status">{notice}</p>}

          {tab === 'reports' && <Reports businessProfileId={business.businessProfileId} timezone={settings.timezone} welcome={params.get('welcome') === '1'} />}

          {tab === 'competitors' && (
            <CompetitorPicker businessProfileId={business.businessProfileId} limit={settings.competitorsMax} saveLabel="Save changes"
              onSaved={(n) => setNotice(`Saved. Watching ${n} competitor${n === 1 ? '' : 's'}.`)} />
          )}

          {tab === 'delivery' && (
            <Card><DeliveryForm businessProfileId={business.businessProfileId} initial={settings} onSaved={() => loadSettings(business.businessProfileId)} /></Card>
          )}

          {tab === 'plan' && (
            <div className="space-y-4">
              <PlanCards businessProfileId={business.businessProfileId} currentPlan={settings.plan} orgId={settings.orgId}
                onChosen={(_, paid) => {
                  setNotice(paid ? 'Payment received. Your new plan becomes active within a minute.' : 'Plan updated.');
                  setTimeout(() => loadSettings(business.businessProfileId), paid ? 8000 : 0);
                }} />
              {settings.plan !== 'brief_free' && (
                <Button variant="ghost" onClick={openPortal}>Manage billing or cancel</Button>
              )}
            </div>
          )}
        </>
      )}
    </BriefingShell>
  );
}
