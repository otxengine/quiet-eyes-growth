// Stylesheet of the report PDF (A4 print). Ported from the redesign kit's report.css; the Heebo
// @font-face rules are added separately (assets.ts) because they embed the font files.
export const REPORT_CSS = `
@page { size: A4; margin: 14mm 14mm 15mm; }
:root { --ink:#0F172A; --ink2:#475569; --muted:#8A93A3; --line:#E6E6EC; --tint:#F5F4F9; --tint2:#ECEAF3;
        --brand:#E8344D; --brand-tint:#FDEEF1; --comp:#A3ACBC; --pos:#047857; --neg:#DC2626;
        --grad: linear-gradient(90deg, #7C3AED, #E8344D 55%, #F97316); }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin:0; background:#fff; color:var(--ink); font: 400 9.4pt/1.6 Heebo, 'Arial Hebrew', Arial, sans-serif; }
bdi { unicode-bidi: isolate; }
p { margin:0; }

.mast { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; padding-bottom:10px; }
.eyebrow { font-size:8.5pt; font-weight:700; color:var(--brand); letter-spacing:.03em; }
h1 { font-size:23pt; font-weight:800; line-height:1.1; margin:3px 0 5px; letter-spacing:-.01em; }
.meta { color:var(--ink2); font-size:9.5pt; }
.meta i { display:inline-block; width:4px; height:4px; border-radius:50%; background:var(--muted); margin:0 8px; vertical-align:middle; }
.logo { height:34px; width:auto; margin-bottom:4px; }
.rule { height:3px; border-radius:3px; background:var(--grad); margin-bottom:14px; }

.lead { background:var(--tint); border-radius:12px; padding:13px 18px 12px; break-inside:avoid; }
.kicker { font-size:8pt; font-weight:700; color:var(--ink2); letter-spacing:.04em; }
.headline { font-size:14pt; font-weight:700; line-height:1.45; margin-top:3px; }
.kpis { display:flex; margin-top:11px; padding-top:9px; border-top:1px solid var(--tint2); }
.kpi { flex:1; padding:0 14px; border-inline-start:1px solid var(--tint2); }
.kpi:first-child { padding-inline-start:0; border-inline-start:0; }
.kpi b { display:block; font-size:21pt; font-weight:800; line-height:1.15; }
.kpi span { font-size:8.3pt; color:var(--ink2); }
.quiet { font-size:8.3pt; color:var(--muted); margin-top:8px; }

section { margin-top:17px; }
.keep { break-inside:avoid; }
h2 { display:flex; align-items:center; gap:8px; font-size:12.5pt; font-weight:800; margin:0 0 8px; break-after:avoid; }
h2::before { content:''; width:4px; height:15px; border-radius:2px; background:linear-gradient(180deg,#F97316,#E8344D,#7C3AED); }
h2 small { font-size:8.3pt; font-weight:400; color:var(--muted); margin-inline-start:auto; }

.hl { list-style:none; margin:0; padding:0; }
.hl li { position:relative; padding:4px 0; padding-inline-start:16px; border-bottom:1px solid var(--line); break-inside:avoid; }
.hl li:last-child { border-bottom:0; }
.hl li::before { content:''; position:absolute; inset-inline-start:2px; top:11px; width:6px; height:6px; border-radius:50%; background:var(--brand); }

.actions { display:grid; gap:10px; }
.action { border:1px solid var(--line); border-top:3px solid var(--brand); border-radius:10px; padding:10px 12px 11px; break-inside:avoid; }
.action .n { font-size:15pt; font-weight:800; color:var(--brand); line-height:1; }
.action p { margin-top:6px; font-weight:500; line-height:1.5; }

table { width:100%; border-collapse:collapse; font-size:9pt; }
th { font-size:7.9pt; font-weight:500; color:var(--ink2); text-align:start; padding:0 8px 6px; border-bottom:1.5px solid var(--ink); white-space:nowrap; }
td { padding:5px 8px; border-bottom:1px solid var(--line); font-variant-numeric:tabular-nums; white-space:nowrap; }
td.name { white-space:normal; font-weight:500; }
tr { break-inside:avoid; }
tr.you td { background:var(--brand-tint); border-bottom-color:#F7D4DA; }
tr.you td.name b { color:var(--brand); }
tr.you .z { color:var(--ink); font-weight:700; }  /* "you: 0 posts" is the finding, not filler */
.z, .na { color:var(--muted); }
.max { font-weight:800; }
.good { color:var(--pos); font-weight:700; }
.bad { color:var(--neg); font-weight:700; }
.cnt { color:var(--muted); font-size:7.8pt; }
.cellbar { display:flex; align-items:center; gap:8px; }
.cellbar .v { min-width:30px; }
.cellbar .track { flex:1; min-width:70px; height:7px; background:#F0EFF4; border-radius:4px; overflow:hidden; }
.cellbar .track i { display:block; height:100%; background:var(--comp); border-radius:4px; }
tr.you .cellbar .track i { background:var(--brand); }
.after { font-size:8.3pt; color:var(--muted); margin-top:7px; }

.split { display:grid; grid-template-columns:1.65fr 1fr; gap:18px; align-items:start; }
.stats { display:grid; grid-template-columns:1fr 1fr; gap:1px; background:var(--line); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.stats.four { grid-template-columns:repeat(4,1fr); }
.stat { background:#fff; padding:8px 11px; }
.stat b { display:block; font-size:15pt; font-weight:800; line-height:1.2; }
.stat span { font-size:7.9pt; color:var(--ink2); }
.label { font-size:8.3pt; font-weight:700; color:var(--ink2); margin:10px 0 4px; }
.label:first-child { margin-top:0; }
.chips { display:flex; flex-wrap:wrap; gap:5px; }
.chip { border:1px solid var(--line); border-radius:999px; padding:0 9px; font-size:8.3pt; background:#fff; white-space:nowrap; }
.chip .p { color:var(--pos); font-weight:700; }
.chip .m { color:var(--neg); font-weight:700; }
.weak { margin-top:4px; font-size:8.6pt; }
.weak b { margin-inline-end:6px; }
.quotes { display:grid; gap:10px; margin-top:12px; }
.quote { background:var(--tint); border-radius:10px; padding:9px 12px 10px; font-size:8.6pt; line-height:1.55; color:var(--ink2); break-inside:avoid; }
.quote::before { content:'״'; display:block; font-size:20pt; font-weight:800; line-height:.8; height:11px; color:var(--brand); }
html[lang="en"] .quote::before { content:'“'; }
.quote cite { display:block; font-style:normal; font-weight:700; color:var(--ink); font-size:7.9pt; margin-top:5px; }

.cards { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.card { border:1px solid var(--line); border-radius:10px; overflow:hidden; background:#fff; break-inside:avoid; }
.card .pic { position:relative; height:118px; background:var(--tint); }
.card .pic img { display:block; width:100%; height:100%; object-fit:cover; }
.tag { position:absolute; top:7px; inset-inline-start:7px; background:rgba(15,23,42,.78); color:#fff; font-size:7.3pt; font-weight:700; border-radius:5px; padding:0 6px; }
.card .body { padding:8px 10px 9px; }
.card.noimg { border-top:3px solid var(--comp); }
.card.you.noimg { border-top-color:var(--brand); }
.card .who { font-size:8.6pt; font-weight:700; }
.card .sub { font-size:7.8pt; color:var(--muted); }
.card .txt { font-size:8.5pt; line-height:1.5; margin-top:5px; white-space:pre-line;
             display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; }
.links { font-size:7.8pt; margin-top:6px; }
.links a { color:var(--brand); font-weight:700; text-decoration:none; }
.badge { display:inline-block; background:#FFF1E6; color:#C2410C; border-radius:5px; padding:0 6px; font-size:7.4pt; font-weight:700; margin-inline-start:5px; }

.offers { display:grid; gap:6px; }
.offer { display:grid; grid-template-columns:120px 1fr; gap:10px; padding:7px 11px; border:1px solid var(--line); border-radius:8px; break-inside:avoid; }
.offer .who { font-weight:700; font-size:8.6pt; }
.offer .src { font-size:7.8pt; color:var(--muted); }
.offer .urg { color:var(--brand); font-size:8pt; font-weight:500; }

.comps { display:grid; grid-template-columns:1fr 1fr; gap:10px 16px; }
.comp { padding:3px 0; padding-inline-start:11px; border-inline-start:3px solid var(--tint2); break-inside:avoid; }
.comp b { display:block; font-size:9pt; }
.comp p { font-size:8.7pt; color:var(--ink2); line-height:1.55; }

.foot { margin-top:22px; padding-top:9px; border-top:1px solid var(--line); font-size:7.8pt; color:var(--muted); break-inside:avoid; }
.foot b { color:var(--ink2); }
.foot p { line-height:1.55; margin-bottom:6px; }
.foot .gen { display:flex; justify-content:space-between; align-items:center; }
`;

/**
 * The web page (html.ts `web` option) on top of REPORT_CSS: screen sizes instead of A4 points, a centred
 * column that folds to one column on a phone, and the "Show all" lists. The PDF never loads it. The cards,
 * actions and quotes grids carry inline column counts, so the narrow-screen overrides need !important.
 */
export const REPORT_WEB_CSS = `
@media screen {
  html, body { background:#FAFAFC; }
  body { font-size:15px; }
  a { color:var(--brand); }
  .page { max-width:960px; margin:24px auto 48px; padding:36px 40px; background:#fff; border:1px solid var(--line); border-radius:18px; }
  .webbar { display:flex; justify-content:flex-end; margin-bottom:12px; }
  .btn { display:inline-block; background:var(--ink); color:#fff; font-weight:700; font-size:14px; border-radius:10px; padding:7px 14px; text-decoration:none; }
  .eyebrow { font-size:13px; } h1 { font-size:clamp(26px, 4.4vw, 36px); } .meta { font-size:14.5px; } .logo { height:30px; }
  .kicker { font-size:12px; } .headline { font-size:clamp(17px, 2.4vw, 20px); }
  .kpis { flex-wrap:wrap; row-gap:12px; } .kpi { min-width:96px; } .kpi b { font-size:26px; } .kpi span { font-size:13px; }
  .quiet, .after { font-size:13px; }
  section { margin-top:30px; } h2 { font-size:19px; } h2 small { font-size:13px; }
  .hl li { padding-top:7px; padding-bottom:7px; } .hl li::before { top:15px; }
  .action .n { font-size:20px; } .action p { font-size:15px; }
  .tw { overflow-x:auto; } .tw table { min-width:640px; }
  table { font-size:14px; } th { font-size:12.5px; } .cnt { font-size:12px; }
  .stat b { font-size:22px; } .stat span, .label, .chip, .weak { font-size:13px; }
  .quote { font-size:14px; } .quote cite { font-size:13px; }
  .card .pic { height:auto; aspect-ratio:4 / 3; } .card .who { font-size:14px; } .card .sub, .links { font-size:12.5px; } .card .txt { font-size:14px; }
  .tag, .badge { font-size:11.5px; }
  .offer { grid-template-columns:170px 1fr; } .offer .who { font-size:14px; } .offer .src { font-size:12.5px; } .offer .urg { font-size:13px; }
  .comp b { font-size:15px; } .comp p { font-size:14px; }
  .foot { font-size:12.5px; }

  details.more { margin-top:12px; border:1px solid var(--line); border-radius:12px; background:#fff; }
  details.more > summary, details.grp > summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:10px; }
  details.more > summary::-webkit-details-marker, details.grp > summary::-webkit-details-marker { display:none; }
  details.more > summary { justify-content:space-between; padding:11px 14px; font-weight:700; font-size:14.5px; }
  summary .from { font-weight:400; color:var(--muted); font-size:13.5px; }
  summary:focus-visible { outline:2px solid var(--brand); outline-offset:2px; border-radius:8px; }
  .chev { flex:none; width:22px; height:22px; border-radius:50%; background:var(--tint); position:relative; transition:transform .2s; }
  .chev::after { content:''; position:absolute; left:7px; top:5px; width:6px; height:6px; border-right:2px solid var(--ink2); border-bottom:2px solid var(--ink2); transform:rotate(45deg); }
  details[open] > summary .chev { transform:rotate(180deg); }
  .more-body { border-top:1px solid var(--line); padding:2px 14px 10px; }
  details.grp { border-bottom:1px solid var(--line); }
  details.grp:last-child { border-bottom:0; }
  details.grp > summary { padding:10px 0; font-weight:700; font-size:14px; }
  details.grp > summary .cnt { margin-inline-start:auto; font-weight:400; font-size:13px; color:var(--muted); }
  .rows { padding-bottom:8px; }
  .row { display:grid; grid-template-columns:64px 1fr auto; gap:12px; align-items:start; padding:8px 0; border-top:1px dashed var(--line); }
  .row:first-child { border-top:0; }
  .row.noimg { grid-template-columns:1fr auto; }
  .thumb { display:block; width:64px; height:64px; border-radius:8px; object-fit:cover; background:var(--tint); }
  .row .sub { font-size:12.5px; color:var(--muted); }
  .row .txt { font-size:14px; line-height:1.5; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
  .row .urg { color:var(--brand); font-size:13px; }
  .lnk { font-size:12.5px; font-weight:700; text-decoration:none; white-space:nowrap; }
  .stars { color:#C2410C; letter-spacing:1px; }
}
@media screen and (max-width: 1000px) { .page { margin:16px; } }
@media screen and (max-width: 760px) {
  .page { margin:0; border:0; border-radius:0; padding:18px max(16px, env(safe-area-inset-right, 0px)) 36px max(16px, env(safe-area-inset-left, 0px)); }
  .cards { grid-template-columns:repeat(2, 1fr) !important; }
  .actions, .quotes { grid-template-columns:1fr !important; }
  .split, .comps { grid-template-columns:1fr; }
  .offer { grid-template-columns:1fr; gap:4px; }
}
@media screen and (max-width: 480px) {
  .cards { grid-template-columns:1fr !important; }
  .row { grid-template-columns:52px 1fr; }
  .thumb { width:52px; height:52px; }
  .row > :last-child { grid-column:2; }
  .row.noimg > :last-child { grid-column:1; }
}
@media (prefers-reduced-motion: reduce) { .chev { transition:none; } }
`;
