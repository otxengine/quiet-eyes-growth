#!/usr/bin/env node
/**
 * Generates all brand assets from the source logo
 * (scripts/assets/cortexi-logo-1080.jpg):
 *
 *   public/logo/cortexi-logo.png        — trimmed wordmark, transparent-ish white, 800w (nav/footer/JSON-LD)
 *   public/logo/cortexi-mark.png        — the "C" mark, square 512 (base icon)
 *   public/logo/icon-192.png / icon-512.png / icon-512-maskable.png (manifest)
 *   public/logo/apple-touch-icon.png    — 180×180
 *   public/logo/favicon-32.png          — 32×32
 *   public/og/og-default.png            — 1200×630 with the real wordmark
 *
 * Run: node scripts/generate-brand-assets.mjs   (requires sharp devDep)
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'scripts', 'assets', 'cortexi-logo-1080.jpg');
const LOGO_DIR = join(ROOT, 'public', 'logo');
const OG_DIR = join(ROOT, 'public', 'og');
mkdirSync(LOGO_DIR, { recursive: true });
mkdirSync(OG_DIR, { recursive: true });

// Key near-white pixels to transparent so the logo sits cleanly on any light bg
async function whiteToAlpha(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    if (min > 232) data[i + 3] = 0;
    else if (min > 210) data[i + 3] = Math.round(((232 - min) / 22) * 255); // soft edge
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

// 1. Wordmark: auto-trim the near-white background, then key it transparent
const wordmark = await sharp(SRC).trim({ threshold: 30 }).toBuffer();
const wm = await sharp(wordmark).metadata();
console.log(`wordmark trimmed: ${wm.width}x${wm.height}`);
const wordmarkAlpha = await whiteToAlpha(wordmark);
await sharp(wordmarkAlpha).resize({ width: 800 }).png().toFile(join(LOGO_DIR, 'cortexi-logo.png'));
// Small variant for nav/footer (rendered ≤104px wide; 208w covers 2x screens)
await sharp(wordmarkAlpha).resize({ width: 208 }).png({ compressionLevel: 9 }).toFile(join(LOGO_DIR, 'cortexi-logo-nav.png'));

// 2. "C" mark: left slice of the trimmed wordmark (0.9×height avoids the first
// letter of the CORTEXI text), then re-trim
const markSlice = await sharp(wordmark)
  .extract({ left: 0, top: 0, width: Math.round(wm.height * 0.9), height: wm.height })
  .trim({ threshold: 30 })
  .toBuffer();
const mk = await sharp(markSlice).metadata();
console.log(`mark trimmed: ${mk.width}x${mk.height}`);

const squareMark = (size, padRatio) => {
  const pad = Math.round(size * padRatio);
  return sharp(markSlice)
    .resize(size - pad * 2, size - pad * 2, { fit: 'contain', background: '#FFFFFF' })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#FFFFFF' })
    .png();
};

await squareMark(512, 0.06).toFile(join(LOGO_DIR, 'cortexi-mark.png'));
await squareMark(512, 0.18).toFile(join(LOGO_DIR, 'icon-512-maskable.png')); // safe-zone padding
await squareMark(512, 0.06).toFile(join(LOGO_DIR, 'icon-512.png'));
await squareMark(192, 0.06).toFile(join(LOGO_DIR, 'icon-192.png'));
await squareMark(180, 0.08).toFile(join(LOGO_DIR, 'apple-touch-icon.png'));
await squareMark(32, 0.02).toFile(join(LOGO_DIR, 'favicon-32.png'));

// 3. og:image 1200×630 — dot-grid canvas + real wordmark + Hebrew value line
const bgSvg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#C1257F"/><stop offset="45%" stop-color="#EC1E63"/><stop offset="100%" stop-color="#F8793A"/>
    </linearGradient>
    <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.4" fill="#DCDCE1"/>
    </pattern>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="white" stop-opacity="1"/><stop offset="100%" stop-color="white" stop-opacity="0"/>
    </linearGradient>
    <mask id="dotmask"><rect width="1200" height="630" fill="url(#fade)"/></mask>
  </defs>
  <rect width="1200" height="630" fill="#FAFAFB"/>
  <rect width="1200" height="630" fill="url(#dots)" mask="url(#dotmask)"/>
  <text x="600" y="420" text-anchor="middle" direction="rtl" font-family="Arial" font-size="34" font-weight="500" fill="#3F3F46">מערכת AI לשיווק דיגיטלי, ניהול מוניטין ומעקב מתחרים</text>
  <rect x="450" y="465" width="300" height="10" rx="5" fill="url(#grad)"/>
  <text x="600" y="540" text-anchor="middle" font-family="Arial" font-size="22" fill="#71717A">Inspired by the brain. Built for intelligence.</text>
</svg>`;

const wordmarkForOg = await sharp(wordmarkAlpha).resize({ width: 640 }).png().toBuffer();
const ogWm = await sharp(wordmarkForOg).metadata();
await sharp(Buffer.from(bgSvg))
  .composite([{ input: wordmarkForOg, left: Math.round((1200 - ogWm.width) / 2), top: Math.round(330 - ogWm.height) }])
  .png()
  .toFile(join(OG_DIR, 'og-default.png'));

console.log('✓ brand assets generated');
