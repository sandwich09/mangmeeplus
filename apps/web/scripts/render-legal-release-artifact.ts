import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RELEASE_VERSION = '2026-08-09.2';
const FIXED_COPYRIGHT_YEAR = '2026';

/**
 * The artifact inlines the application's own stylesheets rather than restating them.
 * The previous version hand-approximated Tailwind output with attribute selectors
 * (`[class*="rounded-xl"]`), so every design change silently drifted away from the
 * snapshot. The legal pages now emit semantic `doc-*` classes, which means the real
 * rules can be embedded verbatim and the snapshot matches the live document exactly.
 */
function readStylesheet(...segments: string[]): string {
  return readFileSync(resolve(import.meta.dirname, '..', ...segments), 'utf8');
}

function buildStylesheet(): string {
  const designTokens = readFileSync(
    resolve(import.meta.dirname, '../../../packages/design-tokens/generated/web/theme.css'),
    'utf8',
  );
  const fonts = readStylesheet('src', 'common', 'styles', 'fonts.css');
  const legal = readStylesheet('src', 'common', 'legal', 'legal.css');

  // The app gets these from Tailwind's preflight and utilities, which this standalone
  // document does not load. Everything else comes from the stylesheets above.
  const base = `
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:var(--font-family-sans);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.release-banner{margin:0;border-bottom:1px solid var(--color-gray-200);background:#fff;padding:0.6875rem 1.25rem;color:var(--color-gray-500);text-align:center;font-size:0.8125rem;font-variant-numeric:tabular-nums}
.release-banner strong{color:var(--color-gray-900);font-weight:600}
@media print{.release-banner{border-bottom:0;padding-left:0;text-align:left}}
`;

  return [designTokens, fonts, legal, base].join('\n');
}

type LegalDocument = 'terms' | 'privacy';
type PageModule = {
  default?: (() => React.ReactNode) | { default?: () => React.ReactNode };
};

async function main(): Promise<void> {
  const document = process.argv[2] as LegalDocument | undefined;
  if (document !== 'terms' && document !== 'privacy') {
    throw new Error('Usage: render-legal-release-artifact.ts <terms|privacy> [--write]');
  }

  // The application TS config preserves JSX for Next.js. The local tsx runner compiles that JSX
  // in classic mode, so expose React before loading the page module. This script writes to stdout
  // only; release files are deliberately checked in through a reviewed patch.
  (globalThis as typeof globalThis & { React: typeof React }).React = React;

  const pageModule = document === 'terms'
    ? await import('../app/terms/page') as PageModule
    : await import('../app/privacy/page') as PageModule;
  const moduleDefault = pageModule.default;
  const renderPage = typeof moduleDefault === 'function'
    ? moduleDefault
    : moduleDefault?.default;
  if (!renderPage) throw new Error(`Unable to load the ${document} legal page`);

  const renderedPage = renderToStaticMarkup(renderPage())
    .replace(/© \d{4}/g, `© ${FIXED_COPYRIGHT_YEAR}`);
  const title = document === 'terms'
    ? 'ข้อกำหนดการใช้งาน MangmeePlus'
    : 'นโยบายความเป็นส่วนตัว MangmeePlus';

  const html = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,follow">
  <meta name="mangmeeplus-legal-version" content="${RELEASE_VERSION}">
  <title>${title} · ฉบับ ${RELEASE_VERSION}</title>
  <style>
${buildStylesheet()}
  </style>
</head>
<body>
  <p class="release-banner">เอกสารฉบับคงที่สำหรับการยอมรับทางอิเล็กทรอนิกส์ · เวอร์ชัน <strong>${RELEASE_VERSION}</strong> · มีผลวันที่ 9 สิงหาคม 2569</p>
  ${renderedPage}
</body>
</html>
`;

  if (process.argv[3] === '--write') {
    const releaseDirectory = resolve(
      import.meta.dirname,
      '..',
      'public',
      'legal',
      'releases',
      RELEASE_VERSION,
    );
    mkdirSync(releaseDirectory, { recursive: true });
    // Append-only release discipline: a reviewed legal artifact can never be overwritten.
    writeFileSync(resolve(releaseDirectory, `${document}-th.html`), html, { flag: 'wx' });
    return;
  }

  process.stdout.write(html);
}

void main();
