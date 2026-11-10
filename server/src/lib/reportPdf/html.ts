/**
 * Competitor report (daily / weekly / monthly) -> the HTML that is printed to PDF.
 * TypeScript port of render() in the redesign kit's render_reports.py; the layout rules, section order,
 * show-when rules and Hebrew labels are the kit's IMPLEMENTATION.md. Pure: no I/O, no network —
 * images arrive already inlined (media.ts) and fonts/logo come from assets.ts.
 */
import { esc as e } from '../html';
import { REPORT_CSS } from './css';
import { loadReportAssets, ReportAssets } from './assets';

export interface ReportRow {
  report_type: string;
  period_start: Date | string;
  period_end: Date | string;
  status?: string | null;
  data: any;
  summary: any;
  created_date?: Date | string | null;
}

export interface BuildOptions {
  businessName: string;
  /** Original media URL -> data: URI. A card whose image is missing renders text-only. */
  images?: Record<string, string>;
  /** Link for a stored (S3) video, or null for any other URL — raw social CDN video links expire. */
  videoHref?: (url: string) => string | null;
  assets?: ReportAssets;
}

const KIND: Record<string, string> = { daily: 'יומי', weekly: 'שבועי', monthly: 'חודשי' };
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const DAYS = ['שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת', 'ראשון']; // Monday = 0
const PLATFORM: Record<string, string> = { instagram: 'אינסטגרם', facebook: 'פייסבוק', google: 'גוגל' };
const SOURCE: Record<string, string> = { post: 'בפוסט', story: 'בסטורי', ad: 'במודעה' };
const TOTALS: [string, string][] = [
  ['posts', 'פוסטים'], ['stories', 'סטוריז'], ['new_ads', 'מודעות חדשות'], ['active_ads', 'מודעות פעילות'],
  ['offers', 'מבצעים'], ['reviews', 'ביקורות על מתחרים'], ['changes', 'שינויים שזוהו'],
];
// Same taxonomy labels as src/components/competitors/topicLabels.js
const TOPIC_HE: Record<string, string> = {
  service: 'שירות', price: 'מחיר', quality: 'איכות', cleanliness: 'ניקיון', atmosphere: 'אווירה',
  availability: 'זמינות', delivery: 'משלוח', food_quality: 'איכות המזון', menu_variety: 'מגוון תפריט',
  wait_time: 'זמן המתנה', portion_size: 'גודל מנה', freshness: 'טריות', results: 'תוצאות',
  technique: 'טכניקה', appointment_availability: 'זמינות תורים', product_quality: 'איכות מוצרים',
  expertise: 'מקצועיות', trainers: 'מאמנים', equipment: 'ציוד', class_variety: 'מגוון שיעורים',
  schedule_flexibility: 'גמישות לוח זמנים', doctor_expertise: 'מקצועיות רופא', medical_wait_time: 'זמן המתנה',
  diagnosis_quality: 'איכות אבחון', staff_attitude: 'יחס הצוות', appointment_ease: 'נוחות קביעת תור',
  legal_expertise: 'מקצועיות', response_time: 'זמן תגובה', communication: 'תקשורת',
  value_for_money: 'תמורה לכסף', outcome: 'תוצאה', product_variety: 'מגוון מוצרים',
  staff_helpfulness: 'סיוע הצוות', stock_availability: 'זמינות מלאי', return_policy: 'מדיניות החזרות',
  repair_quality: 'איכות תיקון', diagnosis_accuracy: 'דיוק אבחון', auto_wait_time: 'זמן המתנה',
  price_transparency: 'שקיפות במחיר', warranty: 'אחריות על עבודה',
};

// ── text helpers ──────────────────────────────────────────────────────────────────────────────
const fmt = (n: unknown) => (typeof n === 'string' ? n : typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : '—');
// A competitor's latest ad scan hit its cap (see adScanCapped): its running-ads count is a floor.
const anyCapped = (comps: any[]) => comps.some(c => c.ads?.active_capped);
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + (f(x) || 0), 0);

/** Competitor names are sometimes stored as a site URL: "https://www.ediamonds.co.il/" -> "ediamonds.co.il". */
export function cleanName(s: unknown): string {
  return String(s ?? '').trim().replace(/^(https?:\/\/)?(www\.)?|\/+$/g, '') || '—';
}

/** Escaped LLM / scraped text, with bare site URLs shortened the same way as names. */
export function tx(v: unknown): string {
  return e(String(v ?? '').trim().replace(/https?:\/\/(?:www\.)?([^\s/]+)\/?(?=\s|$|[,.:;)])/g, '$1'));
}

const clip = (s: unknown, n: number) => {
  const t = String(s ?? '').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

// ── dates (Israel time) ───────────────────────────────────────────────────────────────────────
const IL_PARTS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });
type YMD = { y: number; m: number; d: number };

function ilDate(v: unknown): YMD {
  const dt = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(dt.getTime())) throw new Error(`bad date: ${String(v)}`);
  const p: Record<string, string> = {};
  for (const x of IL_PARTS.formatToParts(dt)) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day };
}
const addDays = ({ y, m, d }: YMD, n: number): YMD => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const weekday = ({ y, m, d }: YMD) => DAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
const two = (n: number) => String(n).padStart(2, '0');

/** `יום שבת, 7 בנובמבר 2026` / `1–7 בנובמבר 2026` / `29 בנובמבר – 5 בדצמבר 2026` / `אוקטובר 2026`. end is exclusive. */
export function hebrewPeriodLabel(type: string, start: unknown, end: unknown): string {
  const s = ilDate(start);
  const last = addDays(ilDate(end), -1);
  if (type === 'daily') return `יום ${weekday(s)}, ${s.d} ב${MONTHS[s.m - 1]} ${s.y}`;
  if (type === 'monthly') return `${MONTHS[s.m - 1]} ${s.y}`;
  if (s.m === last.m) return `${s.d}–${last.d} ב${MONTHS[last.m - 1]} ${last.y}`;
  return `${s.d} ב${MONTHS[s.m - 1]} – ${last.d} ב${MONTHS[last.m - 1]} ${last.y}`;
}

const shortDate = (iso: unknown) => {
  if (!iso) return '';
  try { const x = ilDate(iso); return `${two(x.d)}.${two(x.m)}`; } catch { return ''; }
};

// ── building blocks ───────────────────────────────────────────────────────────────────────────
function section(title: string, body: string, keep = true, note = ''): string {
  const small = note ? `<small>${e(note)}</small>` : '';
  return `<section${keep ? ' class="keep"' : ''}><h2>${e(title)}${small}</h2>${body}</section>`;
}

/** The lead-box numbers: non-zero ones (big), and the labels of the zero ones (one grey line). Also used by the email. */
export function reportKpis(d: any): { on: [string, number | string][]; off: string[] } {
  const comps: any[] = d?.competitors ?? [];
  const t: Record<string, any> = { ...(d?.totals ?? {}) };
  // Rows stored before totals.active_ads existed carry running ads only per competitor (ads.active_count).
  if (!('active_ads' in t)) t.active_ads = sum(comps, c => c.ads?.active_count ?? 0);
  // The stored total also counts the business's own reviews; this strip is about competitors.
  if ('reviews' in t) t.reviews = sum(comps, c => c.reviews?.count ?? 0);
  return {
    on: TOTALS.filter(([k]) => t[k]).map(([k, label]) =>
      [label, k === 'active_ads' && anyCapped(comps) ? `${fmt(t[k])}+` : t[k]] as [string, number | string]),
    off: TOTALS.filter(([k]) => k in t && !t[k]).map(([, label]) => label),
  };
}

function kpis(d: any, when: string): string {
  const { on, off } = reportKpis(d);
  const big = on.length
    ? `<div class="kpis">${on.map(([label, v]) => `<div class="kpi"><b>${fmt(v)}</b><span>${e(label)}</span></div>`).join('')}</div>` : '';
  return big + (off.length ? `<div class="quiet">ללא פעילות ${when}: ${off.join(' · ')}</div>` : '');
}

type Col = { key: string; header: string; get: (c: any) => any };
const COLS: Col[] = [
  { key: 'posts', header: 'פוסטים', get: c => c.posts?.count },
  { key: 'eng', header: 'מעורבות', get: c => c.posts?.total_engagement },
  { key: 'stories', header: 'סטוריז', get: c => c.stories?.count },
  { key: 'new_ads', header: 'מודעות חדשות', get: c => c.ads?.new_count },
  { key: 'active_ads', header: 'מודעות פעילות', get: c => c.ads?.active_count },
  { key: 'offers', header: 'מבצעים', get: c => c.offers?.count },
  { key: 'followers', header: 'שינוי בעוקבים', get: c => c.followers_delta },
  { key: 'reviews', header: 'ביקורות חדשות', get: c => c.reviews?.count },
  { key: 'avg', header: 'ממוצע החדשות', get: c => c.reviews?.avg_rating },
  { key: 'rating', header: 'דירוג בגוגל', get: c => c.current_rating },
];
const ACTIVITY = ['posts', 'eng', 'stories', 'new_ads', 'active_ads', 'offers', 'followers', 'reviews'];
const BAR_PREF = ['eng', 'stories', 'posts', 'active_ads', 'reviews', 'offers'];

type Row = { name: string; you?: boolean; n: number | null; v: Record<string, any>; capped?: boolean };
const val = (r: Row, k: string) => r.v[k] ?? null;

function scoreboard(comps: any[], own: any, ownRev: any, business: string): { table: string; idle: string[] } {
  const rows: Row[] = comps.map(c => ({
    name: cleanName(c.name), n: c.current_review_count ?? null, capped: !!c.ads?.active_capped,
    v: Object.fromEntries(COLS.map(col => [col.key, col.get(c) ?? null])),
  }));
  let you: Row | null = null;
  if (Object.keys(own).length || ownRev.count) {
    you = {
      name: business, you: true, n: null, v: {
        posts: own.posts?.count ?? null, eng: own.posts?.total_engagement ?? null,
        new_ads: own.ads?.new_count ?? null, followers: own.followers_delta ?? null,
        reviews: ownRev.count ?? null, avg: ownRev.count ? ownRev.avg_rating ?? null : null,
      },
    };
  }
  const active = rows.filter(r => ACTIVITY.some(k => val(r, k)));
  const idle = rows.filter(r => !active.includes(r)).map(r => r.name);
  const withYou = (xs: Row[]) => (you ? [you, ...xs] : xs);
  const cols = COLS.filter(c => withYou(active).some(r => val(r, c.key)));
  if (!active.length || !cols.length) return { table: '', idle };
  const bar = BAR_PREF.find(k => cols.some(c => c.key === k)) ?? null;
  active.sort((a, b) => (val(b, bar!) || 0) - (val(a, bar!) || 0));
  const tableRows = withYou(active);
  const mx: Record<string, number> = {};
  for (const c of cols) mx[c.key] = Math.max(0, ...tableRows.map(r => val(r, c.key) || 0));

  const cell = (r: Row, k: string): string => {
    const v = val(r, k);
    if (v === null) return '<span class="na">—</span>';
    if (k === 'avg') return `<span class="${v < 3.5 ? 'bad' : v >= 4.5 ? 'good' : ''}">${v.toFixed(2)}</span>`;
    if (k === 'rating') return r.n ? `★ ${v.toFixed(1)} <span class="cnt">(${fmt(r.n)})</span>` : `★ ${v.toFixed(1)}`;
    if (k === 'followers') {
      return `<bdi class="${v > 0 ? 'good' : v < 0 ? 'bad' : 'z'}">${v < 0 ? '-' : '+'}${Math.abs(v).toLocaleString('en-US')}</bdi>`;
    }
    const cls = !v ? 'z' : v === mx[k] && tableRows.length > 1 ? 'max' : '';
    const num = `<span class="${cls}">${fmt(v)}${k === 'active_ads' && r.capped ? '+' : ''}</span>`;
    if (k === bar) {
      return `<div class="cellbar"><span class="v">${num}</span><span class="track"><i style="width:${((v / (mx[k] || 1)) * 100).toFixed(1)}%"></i></span></div>`;
    }
    return num;
  };

  const head = `<tr><th>עסק</th>${cols.map(c => `<th>${e(c.header)}</th>`).join('')}</tr>`;
  const body = tableRows.map(r =>
    `<tr${r.you ? ' class="you"' : ''}><td class="name">`
    + (r.you ? `<b>אתם</b> <span class="cnt"><bdi>${e(r.name)}</bdi></span>` : `<bdi>${e(r.name)}</bdi>`)
    + `</td>${cols.map(c => `<td>${cell(r, c.key)}</td>`).join('')}</tr>`).join('');
  return { table: `<table>${head}${body}</table>`, idle };
}

function chips(themes: any[] | undefined, onlyNegative = false): string {
  const out: string[] = [];
  for (const t of [...(themes ?? [])].sort((a, b) => (b.total || 0) - (a.total || 0))) {
    const pos = t.positive || 0, neg = t.negative || 0;
    if (onlyNegative && !neg) continue;
    const marks = (onlyNegative || !pos ? '' : ` <span class="p">▲${pos}</span>`) + (neg ? ` <span class="m">▼${neg}</span>` : '');
    out.push(`<span class="chip">${e(TOPIC_HE[t.theme] ?? t.theme ?? '')}${marks}</span>`);
  }
  return out.length ? `<div class="chips">${out.slice(0, 6).join('')}</div>` : '';
}

function reviewsSection(s: any, comps: any[], ownRev: any): string {
  let left = '';
  if (ownRev.count) {
    const reply = ownRev.reply_rate || 0;
    const avg = ownRev.avg_rating;
    left = '<div class="label">הביקורות שלכם בתקופה</div><div class="stats">'
      + `<div class="stat"><b>${fmt(ownRev.count)}</b><span>ביקורות חדשות</span></div>`
      + `<div class="stat"><b class="${avg != null && avg < 3.5 ? 'bad' : ''}">${avg == null ? '—' : Number(avg).toFixed(2)}</b><span>ממוצע כוכבים</span></div>`
      + `<div class="stat"><b class="${ownRev.negative ? 'bad' : ''}">${fmt(ownRev.negative || 0)}</b><span>שליליות</span></div>`
      + `<div class="stat"><b class="${reply < 50 ? 'bad' : 'good'}">${reply}%</b><span>שיעור מענה</span></div></div>`;
  }
  let right = s.reviews_summary ? `<p>${tx(s.reviews_summary)}</p>` : '';
  if (ownRev.themes?.length) right += `<div class="label">על מה כותבים עליכם</div>${chips(ownRev.themes)}`;
  const weak = comps.map(c => ({ n: cleanName(c.name), ch: chips(c.reviews?.themes, true) })).filter(w => w.ch);
  if (weak.length) {
    right += '<div class="label">נקודות התורפה של המתחרים</div>'
      + weak.map(w => `<div class="weak"><b><bdi>${e(w.n)}</bdi></b>${w.ch}</div>`).join('');
  }
  if (!left && !right) return '';
  const top = left && right ? `<div class="split"><div>${right}</div><div>${left}</div></div>` : right || left;
  const quotes = comps.flatMap(c => ((c.reviews?.negative_samples as string[]) ?? []).map(q => [cleanName(c.name), q] as const)).slice(0, 3);
  const q = quotes.length
    ? `<div class="quotes" style="grid-template-columns:repeat(${quotes.length},1fr)">`
      + quotes.map(([n, t]) => `<div class="quote">${tx(clip(String(t).split(/\s+/).filter(Boolean).join(' '), 180))}<cite>ביקורת על <bdi>${e(n)}</bdi></cite></div>`).join('')
      + '</div>'
    : '';
  return section('ביקורות', top) + (q ? `<div class="keep" style="margin-top:0">${q}</div>` : '');
}

const BLANK_LINES = /\n\s*\n+/g;
const gridCols = (n: number) => (n === 2 ? 2 : n === 4 ? 4 : 3); // avoids a lone orphan card on its own row
const cardGrid = (cards: string[]) => `<div class="cards" style="grid-template-columns:repeat(${gridCols(cards.length)},1fr)">${cards.join('')}</div>`;
const engagementOf = (p: any) => Math.max(p.likes || 0, 0) + (p.comments || 0);

// ── which cards a report shows (shared with media.ts so only shown images are fetched) ─────────
export interface CardPlan {
  tops: [string, any][];
  ownTop: any[];
  newAds: [string, any][];
  activeAds: [string, any][];
}

export function planCards(row: ReportRow): CardPlan {
  const d = row.data ?? {};
  const comps: any[] = d.competitors ?? [];
  const adsOf = (key: string): [string, any][] =>
    comps.flatMap(c => ((c.ads?.[key] as any[]) ?? []).map(a => [c.name, a] as [string, any])).slice(0, 6);
  return {
    tops: comps
      .flatMap(c => ((c.posts?.top as any[]) ?? []).slice(0, 3).map(p => [cleanName(c.name), p] as [string, any]))
      .sort((a, b) => engagementOf(b[1]) - engagementOf(a[1])).slice(0, 6),
    ownTop: ((d.own?.posts?.top as any[]) ?? []).slice(0, 3),
    newAds: adsOf('new'),
    activeAds: adsOf('active'),
  };
}

/** Media URLs of the cards the report will show (images and video posters), without duplicates. */
export function reportMediaUrls(row: ReportRow): string[] {
  const plan = planCards(row);
  const urls = [...plan.tops.map(([, p]) => p.media_url), ...plan.ownTop.map(p => p.media_url),
    ...plan.newAds.map(([, a]) => a.media_url), ...plan.activeAds.map(([, a]) => a.media_url)];
  return [...new Set(urls.filter((u): u is string => typeof u === 'string' && u.length > 0))];
}

// ── the document ──────────────────────────────────────────────────────────────────────────────
export function buildReportHtml(row: ReportRow, opts: BuildOptions): string {
  const t = row.report_type;
  const d = row.data ?? {};
  const s = row.summary ?? {};
  const comps: any[] = d.competitors ?? [];
  const own = d.own ?? {};
  const ownRev = d.own_reviews ?? {};
  const business = opts.businessName ?? '';
  const images = opts.images ?? {};
  const videoHref = opts.videoHref ?? (() => null);
  const assets = opts.assets ?? loadReportAssets();
  const when = t === 'daily' ? 'ביום הזה' : t === 'weekly' ? 'בשבוע הזה' : 'בחודש הזה';
  const period = hebrewPeriodLabel(t, row.period_start, row.period_end);
  const kind = KIND[t] ?? '';

  const mediaCard = (o: { who: string; sub: string; text: string; media?: string | null; video?: string | null; page?: string | null; badge?: string; you?: boolean }) => {
    const pic = o.media ? images[o.media] : undefined;
    const links: string[] = [];
    if (o.page && /^https?:\/\//.test(String(o.page)) && !String(o.page).includes('fb.me')) links.push(`<a href="${e(o.page)}">למקור ↗</a>`);
    const vid = o.video ? videoHref(o.video) : null;
    if (vid) links.push(`<a href="${e(vid)}">צפייה בוידאו ↗</a>`);
    return `<div class="card${o.you ? ' you' : ''}${pic ? '' : ' noimg'}">`
      + (pic ? `<div class="pic"><img src="${e(pic)}" alt="">${o.video ? '<span class="tag">וידאו</span>' : ''}</div>` : '')
      + `<div class="body"><div class="who"><bdi>${e(o.who)}</bdi>${o.badge ?? ''}</div><div class="sub">${e(o.sub)}</div>`
      + `<div class="txt">${tx((o.text ?? '').replace(BLANK_LINES, '\n')) || 'ללא טקסט'}</div>`
      + (links.length ? `<div class="links">${links.join(' · ')}</div>` : '') + '</div></div>';
  };

  const postCard = (who: string, p: any, you = false) => {
    const likesTxt = p.likes == null || p.likes < 0 ? 'לייקים מוסתרים' : `${fmt(p.likes)} לייקים`;
    const sub = [PLATFORM[p.platform] ?? p.platform ?? '', shortDate(p.posted_at), likesTxt, `${fmt(p.comments || 0)} תגובות`].filter(Boolean).join(' · ');
    return mediaCard({
      who, sub, text: clip(p.caption, 400), media: p.media_url, video: p.video_url, page: p.url, you,
      badge: p.offer ? '<span class="badge">מבצע</span>' : '',
    });
  };

  const adCard = (name: string, a: any, since: string) => {
    const body = String(a.body ?? '').trim();
    const title = String(a.title ?? '').trim();
    const text = body || (title.length > 12 && !/^(fb\.me|http)/.test(title) ? title : 'מודעה ללא טקסט');
    const sub = [PLATFORM[a.platform] ?? a.platform ?? '', `${since} ${shortDate(a.started_at)}`.trim(), a.cta ? `כפתור: ${a.cta}` : ''].filter(Boolean).join(' · ');
    return mediaCard({
      who: cleanName(name), sub, text: clip(text, 400), media: a.media_url, video: a.video_url, page: a.link,
      badge: a.offer ? `<span class="badge">${tx(clip(a.offer.details || 'מבצע', 40))}</span>` : '',
    });
  };

  const plan = planCards(row);
  const adSections = (): string[] => {
    // ads.new = launched in the period; ads.active = launched earlier and still running at its end.
    const res: string[] = [];
    for (const [items, title, since, note] of [
      [plan.newAds, 'מודעות חדשות', 'עלתה', ''],
      [plan.activeAds, 'מודעות שעדיין רצות', 'רצה מאז', 'הושקו לפני התקופה ועדיין פעילות'],
    ] as [[string, any][], string, string, string][]) {
      if (items.length) res.push(section(title, cardGrid(items.map(([n, a]) => adCard(n, a, since))), items.length <= 4, note));
    }
    return res;
  };

  const numbers = (): string => {
    const { table, idle } = scoreboard(comps, own, ownRev, business);
    if (!table && !idle.length) return '';
    const after = idle.length ? `<div class="after">ללא פעילות ${when}: ${e(idle.join(', '))}</div>` : '';
    return section(Object.keys(own).length || ownRev.count ? 'אתם מול המתחרים' : 'המתחרים במספרים', table + after);
  };

  const out: string[] = [
    `<header class="mast"><div><div class="eyebrow">דוח מתחרים ${kind}</div><h1><bdi>${e(business)}</bdi></h1>`
    + `<div class="meta">${e(period)}<i></i>${comps.length} מתחרים במעקב</div></div>`
    + `<img class="logo" src="${assets.logo}" alt="Cortexi"></header><div class="rule"></div>`,
  ];

  if (row.status === 'empty' || !s.headline) {
    // No new activity — ads launched earlier can still be running, so show them instead of a blank page.
    const running = sum(comps, c => c.ads?.active_count ?? 0);
    const line = `לא זוהתה פעילות חדשה של המתחרים ${when}${running ? ` — ${running}${anyCapped(comps) ? '+' : ''} מודעות שלהם ממשיכות לרוץ.` : '.'}`;
    out.push(`<div class="lead"><div class="kicker">בשורה אחת</div><p class="headline">${line}</p>${kpis(d, when)}</div>`);
    out.push(running ? numbers() : section('המתחרים במעקב',
      `<div class="chips">${comps.map(c => `<span class="chip"><bdi>${e(cleanName(c.name))}</bdi></span>`).join('')}</div>`));
    out.push(...adSections());
  } else {
    out.push(`<div class="lead"><div class="kicker">בשורה אחת</div><p class="headline">${tx(s.headline)}</p>${kpis(d, when)}</div>`);
    if (s.highlights?.length) out.push(section('עיקרי התקופה', `<ul class="hl">${s.highlights.map((h: unknown) => `<li>${tx(h)}</li>`).join('')}</ul>`, false));
    const acts: unknown[] = s.recommended_actions ?? [];
    if (acts.length) {
      out.push(section('מה כדאי לעשות', `<div class="actions" style="grid-template-columns:repeat(${Math.min(acts.length, 3)},1fr)">`
        + acts.map((a, i) => `<div class="action"><div class="n">${two(i + 1)}</div><p>${tx(a)}</p></div>`).join('') + '</div>'));
    }
    out.push(numbers());

    if (Object.keys(own).length) { // monthly: the business's own funnel (its posts/engagement are in the table above)
      const stats: [string, any][] = [
        ['לידים חדשים', own.leads?.created], ['לידים שנסגרו', own.leads?.won],
        ['שיחות', own.conversations], ['פעולות אוטומטיות', own.auto_actions?.completed],
      ];
      const grid = `<div class="stats four">${stats.map(([l, v]) => `<div class="stat"><b class="${v ? '' : 'z'}">${fmt(v || 0)}</b><span>${l}</span></div>`).join('')}</div>`;
      out.push(section('הפעילות שלכם', (s.own_summary ? `<p style="margin-bottom:10px">${tx(s.own_summary)}</p>` : '') + grid));
    }

    out.push(reviewsSection(s, comps, ownRev)); // only weekly/monthly rows carry review data

    if (plan.tops.length) {
      out.push(section('הפוסטים הבולטים של המתחרים', cardGrid(plan.tops.map(([n, p]) => postCard(n, p))), plan.tops.length <= 4, 'לפי לייקים + תגובות'));
    }
    if (plan.ownTop.length) out.push(section('הפוסטים הבולטים שלכם', cardGrid(plan.ownTop.map(p => postCard(business, p, true)))));

    const offers = comps.flatMap(c => ((c.offers?.items as any[]) ?? []).map(o => [cleanName(c.name), o] as const));
    if (offers.length) {
      out.push(section('מבצעים שזוהו', '<div class="offers">' + offers.map(([n, o]) =>
        `<div class="offer"><div><div class="who"><bdi>${e(n)}</bdi></div><div class="src">${e(SOURCE[o.source] ?? '')}`
        + `${o.at ? ` · ${shortDate(o.at)}` : ''}</div></div>`
        + `<div>${tx(clip(o.details || 'מבצע', 200))}${o.urgency ? `<div class="urg">${tx(o.urgency)}</div>` : ''}</div></div>`).join('') + '</div>', offers.length <= 4));
    }

    out.push(...adSections());

    const changes: any[] = d.changes ?? [];
    if (changes.length) out.push(section('שינויים שזוהו', `<ul class="hl">${changes.map(c => `<li>${tx(c.summary)}</li>`).join('')}</ul>`));

    const per: any[] = s.per_competitor ?? [];
    if (per.length && t !== 'daily') { // a daily's per-competitor lines repeat its highlights
      out.push(section('לפי מתחרה', `<div class="comps">${per.map(c =>
        `<div class="comp"><b><bdi>${e(cleanName(c.name))}</bdi></b><p>${tx(c.summary)}</p></div>`).join('')}</div>`, false));
    }
  }

  const limits: unknown[] = d.limits ?? [];
  let created = '';
  if (row.created_date) { try { const x = ilDate(row.created_date); created = `${two(x.d)}.${two(x.m)}.${x.y}`; } catch { /* leave blank */ } }
  out.push(`<div class="foot">${limits.length ? `<p><b>על הנתונים:</b> ${limits.map(x => e(x)).join(' · ')}</p>` : ''}`
    + `<div class="gen"><span>הדוח הופק אוטומטית ע״י Cortexi מנתוני הפלטפורמה</span><span>הופק ${created}</span></div></div>`);

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">`
    + `<title>דוח מתחרים ${kind} · ${e(business)} · ${e(period)}</title><style>${assets.fontsCss}${REPORT_CSS}</style></head>\n<body>\n${out.filter(Boolean).join('\n')}\n</body></html>\n`;
}
