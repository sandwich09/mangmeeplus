/** Actual compiled Nest webhook/buffer + isolated PostgreSQL/Redis opt-out proof.
 * Build contracts/config/API, commit the source, then run with tsx and an explicit
 * AI_BUDGET_RESERVATION_TEST_DATABASE_URL. The runtime accepts only a dedicated
 * local replay database and owns/reset its synthetic rows; never use a shared DB.
 * Optional LINE_RELIABILITY_TEST_REDIS_URL and LINE_RELIABILITY_TEST_RESULT_PATH.
 * Uses a local LINE sink and zero provider calls; no native LINE or model quality claim.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHORED_CORPUS, AUTHORED_SOURCE_SNAPSHOT_MANIFEST } from './line-ai-reliability-corpus';
import { reliabilityDigest } from './line-ai-reliability-fixtures';
import { runLineReliabilityRuntime } from './line-ai-reliability-runtime';

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const databaseUrl = process.env.AI_BUDGET_RESERVATION_TEST_DATABASE_URL;
  assert.ok(databaseUrl, 'AI_BUDGET_RESERVATION_TEST_DATABASE_URL_REQUIRED');
  const row = structuredClone(AUTHORED_CORPUS.fixtures.find(item => item.fixture.membership && !item.assets.length)!);
  const source = structuredClone(AUTHORED_SOURCE_SNAPSHOT_MANIFEST.snapshots[row.fixture.sourceSnapshot]!);
  source.rows.find(seed => seed.model === 'user' && seed.data.id === row.fixture.actor)!.data.aiAssistantOptOutAt = new Date().toISOString();
  const snapshotId = 'compiled-runtime-optout-smoke';
  row.id = snapshotId; row.familyId = snapshotId; row.fixedRegression = true; row.paraphrase = false;
  row.fixture.sourceSnapshot = snapshotId; row.fixture.clock = new Date().toISOString();
  row.provenance = { kind: 'synthetic', sourceId: snapshotId, consentRef: null, reviewedBy: null, reviewedAt: null };
  row.turns = [{ user: 'ช่วยสรุปรายจ่ายเดือนนี้', attachmentIds: [], expect: { outcomes: ['access_denied'], toolInputs: [], requiredFacts: [], requiredEffects: [],
    forbiddenEffects: ['ExpenseRecord.create', 'ReimbursementRequest.create'], requiredDelivery: 'ACCEPTED', maxModelCalls: 0, deadlineMs: 8000 } }];
  const fileDigest = (path: string) => reliabilityDigest(readFileSync(`${root}/${path}`, 'utf8'));
  process.env.AI_GATEWAY_INTERNAL_SECRET = 'synthetic-local-optout-smoke-only';
  const result = await runLineReliabilityRuntime({ version: 2, corpus: { version: 2, seed: snapshotId, status: 'draft', fixtures: [row] },
    snapshots: { [snapshotId]: source }, snapshotDigests: { [snapshotId]: reliabilityDigest(source) },
    versions: { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      schema: fileDigest('apps/api/prisma/schema.prisma'), prompt: fileDigest('apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts'),
      registry: fileDigest('packages/contracts/src/ai-tools.ts'), model: reliabilityDigest({ mode: 'no_provider_opt_out' }), price: fileDigest('packages/contracts/src/ai-budget-bounds.ts') },
    apiPort: 18991, gatewayUrl: 'http://127.0.0.1:18992', databaseUrl,
    redisUrl: process.env.LINE_RELIABILITY_TEST_REDIS_URL ?? 'redis://127.0.0.1:16389/13', environment: { LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED: 'true', LINE_AI_LEDGER_ENABLED: 'false', LINE_AI_RELIABILITY_V2_MODE: 'off' },
    repeats: 1, cohort: '1500' }, root);
  if (process.env.LINE_RELIABILITY_TEST_RESULT_PATH) writeFileSync(process.env.LINE_RELIABILITY_TEST_RESULT_PATH, JSON.stringify(result, null, 2));
  const attempt = result.records[0]!.attempt;
  assert.equal(attempt.semanticCorrect, true); assert.equal(attempt.factsCorrect, true); assert.equal(attempt.effectsCorrect, true);
  assert.equal(attempt.completed, true); assert.equal(attempt.modelCalls, 0); assert.equal(attempt.costSatang, 0); assert.deepEqual(attempt.criticalErrors, []);
  console.log(JSON.stringify({ passed: true, sourceCommit: result.records[0]!.traces[0]!.versions.sourceCommit, attempt, boundary: result.boundary }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
