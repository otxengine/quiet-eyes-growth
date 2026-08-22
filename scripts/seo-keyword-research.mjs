#!/usr/bin/env node
/**
 * SEO keyword research for the Cortexi midsite via DataForSEO Labs.
 * Location: Israel (2376), language: Hebrew.
 *
 * Usage:
 *   DATAFORSEO_LOGIN=... DATAFORSEO_PASSWORD=... node scripts/seo-keyword-research.mjs
 *
 * Output: docs/keyword-research.json + docs/keyword-research.md
 * (ranked by search volume; feeds titles/descriptions in docs/midsite-content-audit.md)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const LOGIN = process.env.DATAFORSEO_LOGIN;
const PASSWORD = process.env.DATAFORSEO_PASSWORD;
if (!LOGIN || !PASSWORD) {
  console.error('Missing DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD env vars. Aborting (no changes made).');
  process.exit(1);
}
const AUTH = 'Basic ' + Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');

const LOCATION_CODE = 2376; // Israel
const LANGUAGE_CODE = 'he';

// One seed per midsite page (see docs/midsite-content-audit.md §9)
const SEEDS = [
  'ניהול מוניטין לעסקים',
  'מענה לביקורות גוגל',
  'מעקב מתחרים',
  'ניתוח מתחרים',
  'מודיעין תחרותי',
  'מערכת AI לניהול שיווק',
  'שיווק לעסקים קטנים',
  'ניהול ביקורות',
  'ניטור רשתות חברתיות',
];

async function post(path, payload) {
  const res = await fetch(`https://api.dataforseo.com/v3/${path}`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify([payload]),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const task = json.tasks?.[0];
  if (task?.status_code !== 20000) throw new Error(`${path} -> ${task?.status_code} ${task?.status_message}`);
  return task.result ?? [];
}

function rowsFromItems(items, source) {
  return (items ?? []).map((it) => {
    const kw = it.keyword ?? it.keyword_data?.keyword;
    const info = it.keyword_info ?? it.keyword_data?.keyword_info ?? {};
    const props = it.keyword_properties ?? it.keyword_data?.keyword_properties ?? {};
    return {
      keyword: kw,
      volume: info.search_volume ?? null,
      cpc: info.cpc ?? null,
      competition: info.competition_level ?? info.competition ?? null,
      difficulty: props.keyword_difficulty ?? null,
      source,
    };
  }).filter((r) => r.keyword);
}

const all = new Map();
for (const seed of SEEDS) {
  console.log(`▸ ${seed}`);
  try {
    const overview = await post('dataforseo_labs/google/keyword_overview/live', {
      keywords: [seed], location_code: LOCATION_CODE, language_code: LANGUAGE_CODE,
    });
    rowsFromItems(overview[0]?.items, `overview:${seed}`).forEach((r) => all.set(r.keyword, r));
  } catch (e) { console.warn(`  overview failed: ${e.message}`); }

  try {
    const ideas = await post('dataforseo_labs/google/keyword_ideas/live', {
      keywords: [seed], location_code: LOCATION_CODE, language_code: LANGUAGE_CODE,
      limit: 30, order_by: ['keyword_info.search_volume,desc'],
    });
    rowsFromItems(ideas[0]?.items, `ideas:${seed}`).forEach((r) => { if (!all.has(r.keyword)) all.set(r.keyword, r); });
  } catch (e) { console.warn(`  ideas failed: ${e.message}`); }

  try {
    const related = await post('dataforseo_labs/google/related_keywords/live', {
      keyword: seed, location_code: LOCATION_CODE, language_code: LANGUAGE_CODE, depth: 1, limit: 20,
    });
    rowsFromItems(related[0]?.items, `related:${seed}`).forEach((r) => { if (!all.has(r.keyword)) all.set(r.keyword, r); });
  } catch (e) { console.warn(`  related failed: ${e.message}`); }
}

const rows = [...all.values()].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'keyword-research.json'), JSON.stringify(rows, null, 2));

const md = [
  '# Keyword research — Cortexi midsite (DataForSEO Labs, IL/he)',
  '',
  `Generated: ${new Date().toISOString().slice(0, 10)} · ${rows.length} keywords`,
  '',
  '| Keyword | Volume | CPC | Competition | Difficulty | Source |',
  '|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.keyword} | ${r.volume ?? '—'} | ${r.cpc ?? '—'} | ${r.competition ?? '—'} | ${r.difficulty ?? '—'} | ${r.source} |`),
].join('\n');
writeFileSync(join(ROOT, 'docs', 'keyword-research.md'), md);

console.log(`\n✓ ${rows.length} keywords → docs/keyword-research.{json,md}`);
