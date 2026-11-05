import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  LINE_AI_WHOLE_CHAIN_SCENARIOS,
  LINE_AI_WHOLE_CHAIN_SUITES,
} from './line-ai-whole-chain-acceptance.catalog.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_IDS = [
  'royal-pizza-printed-receipt',
  'handwritten-cash-bill',
  'handwritten-multi-entry-ledger',
  'owner-daily-closing-shorthand',
  'help-card-memory-follow-up',
  'help-card-simpler-follow-up',
  'ambiguous-urgency-after-image',
  'receipt-choice-plus-substitute-request',
  'substitute-request-four-missing-fields',
  'partial-answers-across-turns',
  'expense-draft-all-items-and-questions',
  'expense-draft-durable-resume-and-cas',
  'partial-answer-plus-vat-question',
  'intervening-question-between-answers',
  'intervening-question-with-pending-media',
  'resume-after-web-edit-or-context-expiry',
  'valid-receipt-already-exists',
  'text-instead-of-evidence-or-signature',
  'casual-lottery-exclamation',
  'safe-joking-provocation',
  'capability-then-vague-follow-up',
  'companies-command',
  'forced-agentcore-timeout',
  'permission-revoked-between-turns',
  'same-media-redelivered',
  'agentcore-ecs-source-mismatch',
  'claim-by-buttons-zero-model',
  'claim-new-line-deterministic',
  'credit-out-mid-claim',
  'next-step-after-ten-minutes',
  'pending-reason-intervening-question',
  'pending-payee-intervening-question',
  'greeting-bound-chat-zero-model',
  'fixed-read-button-zero-model',
  'workflow-button-during-support-pause',
  'claim-edit-route-unchanged',
  'partial-payment-next-step-keeps-amount',
  'invalid-token-vs-expired-card',
  'buffered-workflow-control-survives',
  'fixed-read-unavailable-honest',
  'expired-card-recovery-after-redis-ttl',
  'free-expense-month-summary-zero-model',
  'stranger-text-before-door-zero-model',
  'claim-multi-message-accepted-provenance',
  'claim-options-only-turn-preserves-amount',
];

describe('LINE AI whole-chain acceptance catalog', () => {
  it('encodes every mandatory replay row exactly once with semantic assertions', () => {
    assert.deepEqual(LINE_AI_WHOLE_CHAIN_SCENARIOS.map(({ id }) => id), EXPECTED_IDS);
    for (const scenario of LINE_AI_WHOLE_CHAIN_SCENARIOS) {
      assert.ok(['repository', 'controlled_external_image'].includes(scenario.fixture));
      assert.deepEqual(Object.keys(scenario.assertions).sort(), ['delivery', 'mutation', 'outcome', 'tool']);
      for (const value of Object.values(scenario.assertions)) assert.match(value, /^[a-z0-9_]+$/);
      assert.ok(scenario.evidence.length > 0, `${scenario.id} needs runnable evidence`);
    }
  });

  it('keeps the owner month summary and stranger entry model-free with no business write', () => {
    for (const id of ['free-expense-month-summary-zero-model', 'stranger-text-before-door-zero-model']) {
      const scenario = LINE_AI_WHOLE_CHAIN_SCENARIOS.find(row => row.id === id);
      assert.ok(scenario, id);
      assert.equal(scenario.fixture, 'repository');
      assert.match(scenario.assertions.tool, /zero_model_calls/);
      assert.match(scenario.assertions.mutation, /zero_business_mutation/);
    }
  });

  it('binds every catalog assertion to a file and behavioral evidence pattern run by the harness', async () => {
    const runFiles = new Set(LINE_AI_WHOLE_CHAIN_SUITES.flatMap(({ args }) => args));
    for (const scenario of LINE_AI_WHOLE_CHAIN_SCENARIOS) {
      for (const [file, pattern] of scenario.evidence) {
        const content = await readFile(resolve(REPO_ROOT, file), 'utf8');
        assert.ok(content.includes(pattern), `${scenario.id}: missing evidence ${pattern} in ${file}`);
        assert.ok(runFiles.has(file.replace(/^apps\/(api|ai-gateway)\//, '')) || runFiles.has(file),
          `${scenario.id}: evidence file is not executed by the harness: ${file}`);
      }
    }
  });

  it('keeps raw external images and final mutations outside the automated LINE path', () => {
    const controlled = LINE_AI_WHOLE_CHAIN_SCENARIOS.filter(({ fixture }) => fixture === 'controlled_external_image');
    assert.deepEqual(controlled.map(({ id }) => id), EXPECTED_IDS.slice(0, 3));
    for (const scenario of controlled) {
      assert.equal('imagePath' in scenario, false);
      assert.equal('expectedExtractedFacts' in scenario, false);
    }
    for (const scenario of LINE_AI_WHOLE_CHAIN_SCENARIOS) {
      assert.match(scenario.assertions.mutation, /final_mutation|zero_mutation|zero_business_mutation|stored_business_record_unchanged|one_attachment_one_pending_row_one_draft_at_most|zero_release_mutation/);
    }
  });

  it('fails stale local-only readiness claims and context-cap drift', async () => {
    const plan = await readFile(resolve(REPO_ROOT, 'docs/plans/line-ai-production-parity-and-receipt-continuity-remediation-plan.md'), 'utf8');
    assert.match(plan, /- \[ \] Run the complete replay matrix at expected UAT concurrency/);
    assert.match(plan, /4\. Run the full replay matrix through real LINE\/UAT identities/);
    assert.match(plan, /implementation branch pushed; no deploy/i);
    const sourceFiles = [
      'apps/api/src',
      'apps/ai-gateway/src',
      'packages/contracts/src',
    ];
    const { spawnSync } = await import('node:child_process');
    // `git grep` instead of ripgrep: the GitHub runner has no `rg`, so spawnSync returned
    // status null (ENOENT) and this gate failed for a missing tool rather than real drift.
    // `--untracked` keeps ripgrep's working-tree reach; POSIX classes keep the pattern ERE-safe.
    const search = spawnSync('git', [
      'grep', '--untracked', '-nE',
      'maxTurns:[[:space:]]*16|LINE_AI_CONTEXT_MAX_TURNS[[:space:]]*=[[:space:]]*16',
      '--', ...sourceFiles,
    ], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.ok([0, 1].includes(search.status ?? -1), search.stderr);
    const stale = search.stdout.trim();
    assert.equal(stale, '', `15-turn contract drift:\n${stale}`);
  });
});
