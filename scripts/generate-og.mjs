#!/usr/bin/env node
/**
 * Generates public/og/og-default.png (1200×630) from an inline SVG in the
 * midsite design language. Run manually when the design changes:
 *   node scripts/generate-og.mjs
 * Requires the `sharp` devDependency.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Dot grid as an SVG pattern; gradient + wordmark + Hebrew value line
const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#C1257F"/>
      <stop offset="45%" stop-color="#EC1E63"/>
      <stop offset="100%" stop-color="#F8793A"/>
    </linearGradient>
    <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.4" fill="#DCDCE1"/>
    </pattern>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="white" stop-opacity="1"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </linearGradient>
    <mask id="dotmask"><rect width="1200" height="630" fill="url(#fade)"/></mask>
  </defs>

  <rect width="1200" height="630" fill="#FAFAFB"/>
  <rect width="1200" height="630" fill="url(#dots)" mask="url(#dotmask)"/>

  <!-- spark icon -->
  <g transform="translate(548,120) scale(4.3)">
    <path fill="url(#grad)" d="M12 2c.6 4.8 2.4 6.9 7.5 7.5-5.1.6-6.9 2.7-7.5 7.5-.6-4.8-2.4-6.9-7.5-7.5C9.6 8.9 11.4 6.8 12 2Z"/>
  </g>

  <text x="600" y="330" text-anchor="middle" font-family="Arial" font-size="92" font-weight="800" letter-spacing="-2" fill="#101014">Cortexi</text>

  <text x="600" y="410" text-anchor="middle" direction="rtl" font-family="Arial" font-size="34" font-weight="500" fill="#3F3F46">מערכת AI לניהול השיווק, המוניטין והמתחרים של העסק שלך</text>

  <rect x="450" y="465" width="300" height="10" rx="5" fill="url(#grad)"/>

  <text x="600" y="540" text-anchor="middle" font-family="Arial" font-size="22" font-weight="400" fill="#71717A">Inspired by the brain. Built for intelligence.</text>
</svg>`;

mkdirSync(join(ROOT, 'public', 'og'), { recursive: true });
const out = join(ROOT, 'public', 'og', 'og-default.png');
await sharp(Buffer.from(svg)).png().toFile(out);
writeFileSync(join(ROOT, 'public', 'og', 'og-default.svg'), svg.trim());
console.log(`✓ ${out}`);
