// Draws the small line icons of the locked card design as PNG files for native Flex, which has no
// vector icon. The approved preview names them with `data-lucide`; these are the same Lucide icons
// (https://lucide.dev, ISC licence) in the colours the preview's CSS gives each place.
//
// Run from the repository root:  node docs/evidence/line-system-oa-native-flex-2026-10-05/make-icon-assets.mjs
// One headless Chromium, closed when the script ends. Re-run only with a new date in the file names.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = path.join(root, 'apps/web/public/assets/line');
const VERSION = '20261005';
const PATHS = {
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M14 8H8"/><path d="M16 12H8"/><path d="M13 16H8"/>',
  list: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8h8"/><path d="M7 12h10"/><path d="M7 16h6"/>',
};
// file name → [icon, colour]: the secondary button's text colour, white on the dark button, and the
// three banner colours.
const ICONS = {
  'icon-receipt': ['receipt', '#325e44'], 'icon-list': ['list', '#325e44'], 'icon-file': ['file', '#325e44'],
  'icon-clipboard-light': ['clipboard', '#ffffff'], 'icon-chevron': ['chevron', '#325e44'], 'icon-chevron-light': ['chevron', '#ffffff'],
  'icon-check-ok': ['check', '#255b38'], 'icon-check-pending': ['check', '#755418'], 'icon-scan': ['scan', '#286857'],
};

const browser = await chromium.launch();
try {
  // 16 px on the card, drawn at 4× for sharp phones.
  const page = await browser.newPage({ viewport: { width: 16, height: 16 }, deviceScaleFactor: 4 });
  for (const [name, [icon, colour]] of Object.entries(ICONS)) {
    await page.setContent(`<body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block">${PATHS[icon]}</svg></body>`);
    await page.screenshot({ path: path.join(out, `system-card-${name}-${VERSION}.png`), omitBackground: true, clip: { x: 0, y: 0, width: 16, height: 16 } });
  }
} finally {
  await browser.close();
}
console.log(`wrote ${Object.keys(ICONS).length} icons to ${path.relative(root, out)}`);
