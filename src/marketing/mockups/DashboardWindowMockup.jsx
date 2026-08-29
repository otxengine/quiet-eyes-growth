import React from 'react';
import { LayoutGrid, Star, Eye, Lightbulb, Megaphone, Users, Calendar, Lock } from 'lucide-react';
import { SparkIcon } from '../ui/primitives.jsx';

/*
 * "Look into the system": a browser-chrome window onto the product's real
 * sidebar modules (src/marketing/content/modules.js — same 7 as the app
 * sidebar), showing the Reputation (מוניטין) module. Stat numbers and the
 * trend line are an illustrative example view, not live customer data —
 * labeled "דוגמה" in the chrome bar (no "LIVE" badge).
 */

const NAV = [
  { label: 'סקירה כללית', icon: LayoutGrid, active: true },
  { label: 'מוניטין', icon: Star },
  { label: 'מתחרים', icon: Eye },
  { label: 'תובנות', icon: Lightbulb },
  { label: 'מרכז השיווק', icon: Megaphone },
  { label: 'תחרות סושיאל', icon: Users },
  { label: 'אירועים', icon: Calendar },
];

const STATS = [
  { label: 'ביקורות החודש', value: '24', delta: '+6' },
  { label: 'דירוג ממוצע', value: '4.6', delta: '+0.2' },
  { label: 'זמן מענה ממוצע', value: '2 שעות', delta: '-35%' },
];

// Illustrative shape only — not a real reported trend.
const TREND = [18, 22, 20, 26, 24, 30, 28, 34, 32, 38, 36, 42];
const TREND_MAX = Math.max(...TREND);
const TREND_POINTS = TREND.map((v, i) => {
  const x = (i / (TREND.length - 1)) * 100;
  const y = 40 - (v / TREND_MAX) * 40;
  return `${x.toFixed(1)},${y.toFixed(1)}`;
}).join(' ');

export default function DashboardWindowMockup() {
  return (
    <div
      className="mkt-card w-full overflow-hidden shadow-[0_30px_80px_-35px_rgba(16,16,20,0.35)]"
      role="img"
      aria-label="הדגמה של מסך המוניטין במערכת: ביקורות, דירוג וזמן מענה, ערכים לדוגמה"
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--mkt-border)', background: '#FAFAFB' }} dir="ltr">
        <div className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#FF5F57' }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#FEBC2E' }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#28C840' }} />
        </div>
        <div
          className="flex-1 flex items-center gap-2 rounded-full border bg-white px-3.5 py-1.5 text-[12px] min-w-0"
          style={{ borderColor: 'var(--mkt-border)', color: 'var(--mkt-muted)' }}
        >
          <Lock size={11} aria-hidden="true" />
          <span className="truncate">app.cortexi.co/reputation</span>
        </div>
        <span className="text-[10.5px] font-bold rounded-full px-2.5 py-1 shrink-0" style={{ color: 'var(--mkt-muted)', background: '#F4F4F6' }}>
          דוגמה
        </span>
      </div>

      <div className="flex">
        <div className="hidden sm:flex flex-col w-40 shrink-0 border-e p-3 gap-1" style={{ borderColor: 'var(--mkt-border)' }}>
          <div className="flex items-center gap-2 px-2 py-2 mb-1">
            <span className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'var(--mkt-grad)' }} aria-hidden="true">
              <SparkIcon size={12} />
            </span>
            <span className="font-bold text-[13px]" style={{ color: 'var(--mkt-ink)' }}>Cortexi</span>
          </div>
          {NAV.map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] font-medium"
              style={item.active ? { background: '#F4F4F6', color: 'var(--mkt-ink)' } : { color: 'var(--mkt-muted)' }}
            >
              <item.icon size={13} aria-hidden="true" />
              {item.label}
            </div>
          ))}
        </div>

        <div className="flex-1 p-4 md:p-6 min-w-0">
          <div className="font-bold text-[16px]" style={{ color: 'var(--mkt-ink)' }}>מוניטין</div>
          <div className="text-[12px]" style={{ color: 'var(--mkt-muted)' }}>30 הימים האחרונים</div>

          <div className="mt-4 grid grid-cols-3 gap-2 md:gap-3">
            {STATS.map((s) => (
              <div key={s.label} className="rounded-xl border p-2.5 md:p-3" style={{ borderColor: 'var(--mkt-border)' }}>
                <div className="text-[10.5px] md:text-[11px]" style={{ color: 'var(--mkt-muted)' }}>{s.label}</div>
                <div className="mt-1 font-bold text-[15px] md:text-[18px]" style={{ color: 'var(--mkt-ink)' }}>{s.value}</div>
                <div className="mt-0.5 text-[11px] font-bold" style={{ color: '#16A34A' }} dir="ltr">{s.delta}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 md:mt-4 rounded-xl border p-3" style={{ borderColor: 'var(--mkt-border)' }}>
            <div className="text-[12px] font-bold" style={{ color: 'var(--mkt-ink-2)' }}>ביקורות לאורך זמן</div>
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="mt-2 w-full h-14 md:h-16" aria-hidden="true">
              <polyline points={TREND_POINTS} fill="none" stroke="url(#mkt-trend-grad)" strokeWidth="2" />
              <defs>
                <linearGradient id="mkt-trend-grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#C1257F" />
                  <stop offset="100%" stopColor="#F8793A" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
