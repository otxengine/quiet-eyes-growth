import fs from 'fs';
import path from 'path';

// server/assets/ sits next to src/ and dist/, so ../../../assets resolves from both
// src/lib/reportPdf (ts-jest, ts-node) and dist/lib/reportPdf (the Docker image copies assets/ to /app/assets).
const ASSETS_DIR = path.resolve(__dirname, '../../../assets');

const HEBREW = 'U+0307-0308,U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F';
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

const dataUri = (file: string, mime: string) =>
  `data:${mime};base64,${fs.readFileSync(path.join(ASSETS_DIR, file)).toString('base64')}`;

export interface ReportAssets { fontsCss: string; logo: string }

let cached: ReportAssets | null = null;

/** The Heebo @font-face rules and the logo, embedded as data URIs so the render needs no network or file access. */
export function loadReportAssets(): ReportAssets {
  if (!cached) {
    const faces: string[] = [];
    for (const w of [400, 500, 700, 800]) {
      for (const [subset, range] of [['hebrew', HEBREW], ['latin', LATIN]]) {
        faces.push(`@font-face { font-family:Heebo; font-weight:${w}; src:url(${dataUri(`fonts/heebo-${w}-${subset}.woff2`, 'font/woff2')}) format('woff2'); unicode-range:${range}; }`);
      }
    }
    cached = { fontsCss: faces.join('\n'), logo: dataUri('logo/cortexi-logo.png', 'image/png') };
  }
  return cached;
}
