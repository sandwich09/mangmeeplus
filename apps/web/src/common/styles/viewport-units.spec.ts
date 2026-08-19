import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

/**
 * INV-10 (source-level) — decision D3 of the mobile-first spec.
 *
 * `100vh` on iOS Safari is the height with the browser toolbars retracted, ~86px taller than
 * what the user can actually see on an iPhone 13. A `min-h-screen` container therefore adds
 * dead scrollable space, and anything centred inside it sits ~43px below the optical centre.
 *
 * This has to be a source check, not a browser check: the mobile Playwright project runs
 * headless Chromium, which has no collapsing toolbar, so `100vh` and `100dvh` measure
 * identically there and no runtime assertion can ever fail on this.
 *
 * Every hit is a real defect until it is added to ALLOWED with a reason.
 */

const WEB_ROOT = join(import.meta.dirname, '..', '..', '..');
const SCAN_DIRS = ['src', 'app'];
const SCAN_EXTENSIONS = ['.ts', '.tsx', '.css'];

// Tailwind `*-screen` utilities resolve to 100vh, and raw `100vh` speaks for itself.
// `dvh`/`svh`/`lvh` are the dynamic units we want and must not match.
const BANNED = /\b(?:min-h-screen|max-h-screen|h-screen|(?<![a-z-])100vh)\b/g;

/** path (relative to apps/web) -> why it is allowed to keep a static viewport unit. */
const ALLOWED = new Map<string, string>([
  ['src/common/styles/viewport-units.spec.ts', 'this file names the banned patterns in order to ban them'],
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : walk(full);
    return SCAN_EXTENSIONS.some((extension) => entry.endsWith(extension)) ? [full] : [];
  });
}

test('INV-10: no static viewport units (100vh / *-screen) in apps/web', () => {
  const offences: string[] = [];

  for (const directory of SCAN_DIRS) {
    for (const file of walk(join(WEB_ROOT, directory))) {
      const path = relative(WEB_ROOT, file);
      if (ALLOWED.has(path)) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        for (const match of line.matchAll(BANNED)) {
          offences.push(`${path}:${index + 1}  ${match[0]}  ${line.trim().slice(0, 110)}`);
        }
      });
    }
  }

  assert.deepEqual(
    offences,
    [],
    `Use dvh instead — 100vh overshoots the visible viewport on iOS Safari.\n${offences.join('\n')}`,
  );
});
