#!/usr/bin/env node
/**
 * Builds outputs/mobile-evidence/EVIDENCE.md from the per-project results.jsonl written by
 * e2e/harness/inv11.ts. Spec section 12.6 — one table the owner can read top to bottom.
 *
 * Usage: node scripts/build-evidence-manifest.mjs [evidenceDir]
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2] ?? join(process.cwd(), 'outputs', 'mobile-evidence');
if (!existsSync(root)) {
  console.error(`No evidence at ${root} — run the evidence suite first.`);
  process.exit(1);
}

const rows = readdirSync(root)
  .filter((entry) => statSync(join(root, entry)).isDirectory())
  .flatMap((project) => {
    const file = join(root, project, 'results.jsonl');
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  });

const verdict = (row) => {
  if (row.noEvidence) return `NO EVIDENCE — ${row.noEvidence}`;
  if (!row.failures.length) return 'pass';
  const counts = row.failures.reduce((acc, failure) => ({ ...acc, [failure.check]: (acc[failure.check] ?? 0) + 1 }), {});
  const summary = Object.entries(counts).map(([check, n]) => `${check} x${n}`).join(', ');
  return row.desktopFinding ? `DESKTOP-FINDING — ${summary}` : `FAIL — ${summary}`;
};

const blocking = rows.filter((row) => !row.desktopFinding && (row.noEvidence?.includes('0 cards') || row.failures.length));
const desktopFindings = rows.filter((row) => row.desktopFinding && row.failures.length);

const lines = [
  '# Mobile-first evidence bundle',
  '',
  `Subjects: ${rows.length} · devices: ${new Set(rows.map((row) => row.device)).size} · blocking failures: ${blocking.length} · DESKTOP-FINDING: ${desktopFindings.length}`,
  '',
  'Decision D11: desktop rows are measured, not enforced — they never block a phase.',
  '',
  '| Device | Width | Subject | Cards | Controls | Verdict | Screenshot |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((row) => `| ${row.device} | ${row.width} | ${row.subject} | ${row.cardsChecked} | ${row.controlsChecked} | ${verdict(row)} | [png](${relative(root, row.screenshot)}) |`),
];

if (blocking.length || desktopFindings.length) {
  lines.push('', '## Failure detail', '');
  for (const row of [...blocking, ...desktopFindings]) {
    lines.push(`### ${row.device} · ${row.subject}${row.desktopFinding ? ' (DESKTOP-FINDING)' : ''}`, '');
    for (const failure of row.failures) {
      lines.push(`- **[${failure.check}]** ${failure.detail}`, `  - rect ${failure.rect.x},${failure.rect.y} ${failure.rect.width}x${failure.rect.height}`, `  - \`${failure.html}\``);
    }
    lines.push('');
  }
}

const out = join(root, 'EVIDENCE.md');
writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`${out} — ${rows.length} subjects, ${blocking.length} blocking, ${desktopFindings.length} desktop findings`);
