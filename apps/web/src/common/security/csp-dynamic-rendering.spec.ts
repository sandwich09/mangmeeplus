// Regression cover for /privacy and /terms stuck on "กำลังเปิดหน้า..." in production (2026-10-20):
// the nonce CSP from proxy.ts blocks every script of a page prerendered at build time, so the root
// layout must keep all pages rendered per request and no route may opt back into static output.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const appDir = new URL('../../../app/', import.meta.url);

describe('nonce CSP needs per-request rendering', () => {
  it('the root layout opts every page out of static prerendering', () => {
    const layout = readFileSync(new URL('layout.tsx', appDir), 'utf8');
    assert.match(layout, /import \{ connection \} from 'next\/server'/);
    assert.match(layout, /await connection\(\);/);
  });

  it('no route forces static output back on', () => {
    const files = readdirSync(appDir, { recursive: true, encoding: 'utf8' }).filter((file) => /\.(tsx?|jsx?)$/.test(file));
    const staticRoutes = files.filter((file) =>
      /export const dynamic = ['"](force-static|error)['"]|export const revalidate = [1-9]|export (async )?function generateStaticParams/
        .test(readFileSync(new URL(file, appDir), 'utf8')));
    assert.deepEqual(staticRoutes, []);
  });
});
