#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LINE_AI_WHOLE_CHAIN_SCENARIOS,
  LINE_AI_WHOLE_CHAIN_SUITES,
} from './line-ai-whole-chain-acceptance.catalog.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogOnly = process.argv.includes('--catalog-only');
const suites = [
  {
    id: 'catalog-contract', cwd: '.', command: process.execPath,
    args: ['--test', 'scripts/line-ai-whole-chain-acceptance-catalog.spec.mjs'],
  },
  ...(catalogOnly ? [] : LINE_AI_WHOLE_CHAIN_SUITES),
];

const startedAt = Date.now();
for (const suite of suites) {
  const result = spawnSync(suite.command, suite.args, {
    cwd: resolve(repoRoot, suite.cwd),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(JSON.stringify({ event: 'line_ai_acceptance_suite_failed', suite: suite.id, errorCode: 'SPAWN_FAILED' }));
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(JSON.stringify({ event: 'line_ai_acceptance_suite_failed', suite: suite.id, exitCode: result.status }));
    process.exit(result.status ?? 1);
  }
}

const controlledExternal = LINE_AI_WHOLE_CHAIN_SCENARIOS
  .filter(({ fixture }) => fixture === 'controlled_external_image')
  .map(({ id }) => id);
console.log(JSON.stringify({
  event: 'line_ai_repository_acceptance_complete',
  repositoryScenarioCount: LINE_AI_WHOLE_CHAIN_SCENARIOS.length - controlledExternal.length,
  controlledExternalScenarioCount: controlledExternal.length,
  controlledExternalStatus: 'requires_source_hashed_human_reviewed_replay',
  controlledExternal,
  suites: suites.map(({ id }) => id),
  durationMs: Date.now() - startedAt,
}, null, 2));
