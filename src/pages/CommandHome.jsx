/**
 * CommandHome — AI Command Center (Figma: Cortexi / Dashboard Ver1)
 * Route: /home
 */
import React, { useState, useRef } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, RefreshCw, Sparkles, Zap, Flame, Clock, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Time greeting ──────────────────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'בוקר טוב';
  if (h >= 12 && h < 17) return 'צהריים טובים';
  if (h >= 17 && h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

// ── Dot-grid SVG background ────────────────────────────────────────────────────
const DOT_GRID = `url("data:image/svg+xml,%3Csvg width='28' height='28' viewBox='0 0 28 28' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='14' cy='14' r='1.2' fill='%23C4C2CF' fill-opacity='0.45'/%3E%3C/svg%3E")`;

// ── Shortcut cards ─────────────────────────────────────────────────────────────
const SHORTCUTS = [
  {
    key: 'recent',
    label: 'בוצע לאחרונה',
    desc: 'הצג את הפעולות שבוצעו לאחרונה במערכת',
    Icon: RefreshCw,
    path: '/tasks',
  },
  {
    key: 'snapshot',
    label: 'תמונת מצב',
    desc: 'הצג את תמונת המצב העדכנית',
    Icon: Sparkles,
    path: '/',
  },
  {
    key: 'brief',
    label: 'בריף בוקר',
    desc: 'הצג מה השתנה מאתמול',
    Icon: Zap,
    path: '/insights',
  },
  {
    key: 'urgent',
    label: 'דחוף להיום',
    desc: 'הצג את התובנות החשובות ביותר להיום',
    Icon: Flame,
    path: '/insights',
  },
];

// ── Simple keyword router for AI input ────────────────────────────────────────
function resolveCommand(text) {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (t.includes('ליד') || t.includes('לקוח'))         return '/leads';
  if (t.includes('תובנ') || t.includes('התראה'))        return '/insights';
  if (t.includes('מתחר'))                               return '/competitors';
  if (t.includes('משימ') || t.includes('בוצע'))         return '/tasks';
  if (t.includes('שיווק') || t.includes('פוסט') || t.includes('קמפיין')) return '/marketing';
  if (t.includes('ביקורת') || t.includes('מוניטין'))    return '/reviews';
  if (t.includes('אירוע'))                              return '/events';
  if (t.includes('דוח') || t.includes('ניתוח'))         return '/reports';
  return '/insights'; // default
}

// ── Alert Card ─────────────────────────────────────────────────────────────────
function AlertCard({ alert, onAction }) {
  if (!alert) return null;

  const ago = (() => {
    const ms = Date.now() - new Date(alert.created_date || alert.created_at).getTime();
    const m  = Math.floor(ms / 60_000);
    if (m < 60)  return `${m} דק'`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h} שע'`;
    return `${Math.floor(h / 24)} ימים`;
  })();

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-3 min-w-[280px] flex-shrink-0"
      style={{ background: '#EDE8F5' }}
      dir="rtl"
    >
      <p className="text-[11px] text-foreground-muted">אתמול</p>
      <div>
        <p className="text-[15px] font-bold text-foreground leading-snug">{alert.title}</p>
        {alert.description && (
          <p className="text-[12px] text-foreground-secondary mt-1 leading-relaxed">{alert.description}</p>
        )}
      </div>
      <div className="flex items-center gap-3 mt-1">
        <button
          onClick={onAction}
          className="px-4 py-1.5 rounded-full text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: '#E8344D' }}
        >
          הגב עכשיו
        </button>
        <div className="flex items-center gap-1 text-[11px] text-foreground-muted">
          <Clock className="w-3.5 h-3.5" />
          <span>{ago}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function CommandHome() {
  const { businessProfile } = useOutletContext();
  const navigate = useNavigate();
  const [prompt, setPrompt]   = useState('');
  const inputRef = useRef(null);

  const bpId = businessProfile?.id;
  const bizName = businessProfile?.name || '';

  // Latest unread alert
  const { data: alerts = [] } = useQuery({
    queryKey: ['commandAlerts', bpId],
    queryFn: () => base44.entities.ProactiveAlert.filter(
      { linked_business: bpId, is_dismissed: false },
      '-created_date',
      5,
    ),
    enabled: !!bpId,
    staleTime: 2 * 60_000,
  });
  const topAlert = alerts[0] || null;

  const handleSubmit = (e) => {
    e?.preventDefault();
    const target = resolveCommand(prompt);
    if (target) {
      setPrompt('');
      navigate(target);
    }
  };

  const greeting = getGreeting();

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: '#F2F1F6', backgroundImage: DOT_GRID }}
      dir="rtl"
    >
      {/* ── Hero section ────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center justify-center pt-16 pb-10 px-6">

        {/* Avatar gradient */}
        <div
          className="w-24 h-24 rounded-full mb-6 flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, #9B59B6 0%, #F1C40F 100%)',
            boxShadow: '0 8px 32px rgba(155,89,182,0.25)',
          }}
        />

        {/* Greeting */}
        <h1 className="text-[28px] font-bold text-foreground text-center leading-tight">
          {greeting} {bizName},
        </h1>
        <p className="text-[20px] text-foreground-secondary text-center mt-1">
          מה תרצה לבצע היום?
        </p>

        {/* AI input row */}
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-3 mt-8 w-full max-w-[540px]"
        >
          {/* Back / submit button */}
          <button
            type="submit"
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-80"
            style={{ background: '#1A1A2E' }}
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>

          {/* Input */}
          <input
            ref={inputRef}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="תאר במילים מה תרצה לבצע והמערכת תתחיל בעבודה"
            className="flex-1 h-12 rounded-full bg-white border border-border px-5 text-[13px] text-foreground-secondary placeholder:text-foreground-muted/70 focus:outline-none focus:ring-2 focus:ring-purple-300 transition-all"
            dir="rtl"
          />
        </form>
      </div>

      {/* ── Divider ─────────────────────────────────────────────────────────── */}
      <div className="border-t border-border/70 mx-0" />

      {/* ── Bottom section: shortcuts + alert ───────────────────────────────── */}
      <div className="flex items-end gap-4 px-6 py-8 overflow-x-auto">

        {/* 4 shortcut cards */}
        {SHORTCUTS.map(({ key, label, desc, Icon, path }) => (
          <button
            key={key}
            onClick={() => navigate(path)}
            className="bg-white rounded-2xl p-4 flex flex-col gap-2 text-right min-w-[155px] flex-1 max-w-[200px] hover:shadow-md transition-all border border-transparent hover:border-border/60"
          >
            <div className="flex items-center gap-2 justify-end">
              <span className="text-[13px] font-semibold text-foreground">{label}</span>
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: '#FEE2E8' }}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: '#E8344D' }} />
              </div>
            </div>
            <p className="text-[11px] text-foreground-muted/70 leading-relaxed">{desc}</p>
          </button>
        ))}

        {/* Alert card */}
        {topAlert && (
          <AlertCard
            alert={topAlert}
            onAction={() => navigate('/insights')}
          />
        )}
      </div>
    </div>
  );
}
