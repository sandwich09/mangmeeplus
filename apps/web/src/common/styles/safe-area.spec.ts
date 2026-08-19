import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

/**
 * INV-9 (source-level) — bottom-anchored bars must clear the iPhone home indicator.
 *
 * Like INV-10 this cannot be a browser assertion: `env(safe-area-inset-bottom)` computes to
 * 0px in headless Chromium and WebKit, so a bar with no safe-area padding measures exactly
 * like a correct one. On a real iPhone the difference is a primary action sitting in the
 * home-indicator swipe zone.
 *
 * Rule: anything pinned to the bottom (`sticky bottom-0` / `fixed bottom-0` / `inset-0`)
 * must also carry `.mangmee-safe-bottom`, or an explicit `env(safe-area-inset-bottom)`.
 */

const WEB_ROOT = join(import.meta.dirname, '..', '..', '..');
const SCAN_DIRS = ['src', 'app'];

const BOTTOM_ANCHORED = /\b(?:sticky|fixed)\b[^"'`]*\bbottom-0\b|\bbottom-0\b[^"'`]*\b(?:sticky|fixed)\b/;
const HAS_SAFE_AREA = /mangmee-safe-bottom|safe-area-inset-bottom/;

/** path (relative to apps/web) -> why this bottom-anchored element needs no safe-area padding. */
const ALLOWED = new Map<string, string>([
  ['src/common/styles/safe-area.spec.ts', 'this file names the patterns in order to check them'],
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : walk(full);
    return entry.endsWith('.tsx') || entry.endsWith('.ts') ? [full] : [];
  });
}

test('INV-9: bottom-anchored bars carry safe-area padding', () => {
  const offences: string[] = [];

  for (const directory of SCAN_DIRS) {
    for (const file of walk(join(WEB_ROOT, directory))) {
      const path = relative(WEB_ROOT, file);
      if (ALLOWED.has(path)) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (BOTTOM_ANCHORED.test(line) && !HAS_SAFE_AREA.test(line)) {
          offences.push(`${path}:${index + 1}  ${line.trim().slice(0, 120)}`);
        }
      });
    }
  }

  assert.deepEqual(
    offences,
    [],
    `Add .mangmee-safe-bottom — these bars sit under the iPhone home indicator.\n${offences.join('\n')}`,
  );
});
