import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path: string) => readFileSync(resolve(webRoot, path), 'utf8');

test('the production shell has no build-time Google Fonts dependency', () => {
  const layout = read('app/layout.tsx');
  const globals = read('app/globals.css');
  const fonts = read('src/common/styles/fonts.css');
  const packageJson = JSON.parse(read('package.json')) as { scripts?: { build?: string } };

  assert.doesNotMatch(layout, /next\/font\/google/);
  // Neither build nor runtime may reach a font CDN: every face is served from /public.
  for (const [name, source] of [['globals.css', globals], ['fonts.css', fonts]] as const) {
    assert.doesNotMatch(source, /fonts\.(googleapis|gstatic)\.com/, `${name} must not link a font CDN`);
  }
  assert.equal(packageJson.scripts?.build, 'next build --webpack');
});

test('every @font-face src resolves to a file checked in under public/', () => {
  const fonts = read('src/common/styles/fonts.css');
  const sources = [...fonts.matchAll(/url\('([^']+)'\)/g)].map((match) => match[1]);

  assert.ok(sources.length > 0, 'fonts.css declares no @font-face sources');
  for (const source of sources) {
    assert.match(source, /^\/fonts\/.+\.woff2$/, `${source} must be a local woff2 under /fonts`);
    assert.ok(
      existsSync(resolve(webRoot, 'public', source.replace(/^\//, ''))),
      `${source} is referenced by fonts.css but missing from public/`,
    );
  }
});

test('globals.css leaves the brand type stack to the design tokens', () => {
  const globals = read('app/globals.css');
  const fonts = read('src/common/styles/fonts.css');

  // Redefining the token locally is what previously stranded the brand faces: the
  // override named families the app never shipped, so each machine substituted its own.
  assert.doesNotMatch(
    globals,
    /^\s*--font-family-sans:/m,
    'globals.css must not redefine --font-family-sans; the design tokens own it',
  );
  assert.match(globals, /@import "\.\.\/src\/common\/styles\/fonts\.css"/);

  // Both families named by packages/design-tokens/tokens.json must actually be served.
  for (const family of ['Outfit', 'IBM Plex Sans Thai']) {
    assert.match(fonts, new RegExp(`font-family: '${family}'`), `${family} has no @font-face`);
  }
});
