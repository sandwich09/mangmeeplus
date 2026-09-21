import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The default suite is a hand-maintained list of paths in package.json, while privacy-safe whole-chain
// suites are named in the repository acceptance catalog. A new spec file runs only if one of those
// maintained runners names it. Nothing enforced that, and 52 spec files had accumulated that no
// script referenced at all — including the RedisRateLimitService spec that the tokenless-DI guard
// exists for, and this module's own body-validation coverage check. Two of them had rotted silently
// while unreferenced, which is the real cost: a spec nobody runs is worse than no spec, because it
// reads like coverage.
//
// This guard fails when a spec file is not named by any package.json script, so wiring is never
// optional again.
const API_ROOT = join(__dirname, '../');
const SRC = join(__dirname, './');

// `*.pg.spec.ts` needs a live Postgres and belongs to the dedicated scripts CI runs against a
// service container, not the default unit suite.
const NEEDS_DATABASE = (file: string) => file.endsWith('.pg.spec.ts');

// Specs that fail today and are deliberately still out of the suite. Each one is a real defect to
// resolve, not a wiring gap — remove the entry in the same change that makes it pass.
const KNOWN_FAILING = new Set([
  // Golden SHA-256 of the accountant index CSV drifted from what buildAccountantIndexCsv emits.
  // Compliance-sensitive output: someone has to decide whether the format change was intended.
  'common/export/thai-date.logic.spec.ts',
  // Rejects with UnauthorizedException even though the spec sets WORKER_INTERNAL_TOKEN itself.
  'modules/data-model-core/presentation/http/object-version-cleanup-internal.controller.spec.ts',
]);

function walkSpecs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'generated' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkSpecs(full, out);
    else if (entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('every spec file is wired into a package.json script', () => {
  const scripts: Record<string, string> = JSON.parse(
    readFileSync(join(API_ROOT, 'package.json'), 'utf8'),
  ).scripts;
  const packageReferences = Object.values(scripts)
    .filter((command) => command.includes('--test'))
    .join(' ');
  const referenced = `${packageReferences} ${readFileSync(
    join(API_ROOT, '../../scripts/line-ai-whole-chain-acceptance.catalog.mjs'),
    'utf8',
  )} ${readFileSync(join(API_ROOT, '../../.github/workflows/ci.yml'), 'utf8')} ${readFileSync(
    join(API_ROOT, '../../.github/workflows/extended-tests.yml'),
    'utf8',
  )}`;

  it('finds the scripts it is meant to police', () => {
    assert.ok(referenced.includes('--test'), 'expected at least one spec-running script');
    assert.ok(referenced.includes('.spec.ts'), 'expected the scripts to name spec files');
  });

  it('leaves no spec file unreferenced', () => {
    const orphans = walkSpecs(SRC)
      .map((file) => file.replace(SRC, ''))
      .filter((rel) => !NEEDS_DATABASE(rel) && !KNOWN_FAILING.has(rel))
      // The scripts spell paths from the package root, this walk from src/.
      .filter((rel) => !referenced.includes(`src/${rel}`));

    assert.deepEqual(
      orphans,
      [],
      `these spec files never run — add them to an owned test runner (apps/api/package.json or the whole-chain catalog):\n${orphans.join('\n')}`,
    );
  });

  it('does not carry stale exemptions', () => {
    const present = new Set(walkSpecs(SRC).map((file) => file.replace(SRC, '')));
    const gone = [...KNOWN_FAILING].filter((rel) => !present.has(rel));
    assert.deepEqual(gone, [], `exempted spec files no longer exist:\n${gone.join('\n')}`);
  });
});
