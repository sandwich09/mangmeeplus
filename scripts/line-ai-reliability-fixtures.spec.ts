import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reliabilityOracleDigest, reliabilityDigest, replayReliabilityCorpus, scoreReliabilityTrace, scoreReliabilityTraceBundle, validateReliabilityCorpus, type ReliabilityCorpus, type ReliabilityFixture, type ReliabilityTurnTrace, type ReliabilityTraceBundle } from './line-ai-reliability-fixtures';
const digest = 'a'.repeat(64);
function fixture(): ReliabilityFixture {
  return { id: 'sum-month', familyId: 'expense-current-month', split: 'held_out', language: 'th', paraphrase: false, fixedRegression: true, group: 'single_turn', capabilities: ['C02', 'C11'],
    provenance: { kind: 'synthetic', sourceId: 'fixture-only-not-quality-acceptance', consentRef: null, reviewedBy: null, reviewedAt: null },
    fixture: { clock: '2026-09-26T03:00:00Z', timezone: 'Asia/Bangkok', company: 'synthetic-company', actor: 'synthetic-owner', channelKind: 'USER', messagingChannelId: 'synthetic-oa', membership: 'synthetic-member', chat: 'synthetic-chat',
      permissions: ['expense.read'], branches: ['synthetic-branch'], enabledFeatures: ['expenses'], sourceSnapshot: 'synthetic-source-v1', taskRevision: 0, previewRevision: null }, assets: [],
    turns: [{ user: 'ค่าใช้จ่ายเดือนนี้เท่าไหร่', attachmentIds: [], expect: { outcomes: ['answered'], toolInputs: [{ tool: 'expense.list_recent', input: { period: '2026-09' } }],
      requiredFacts: [{ metric: 'expenseTotal', value: '1000.00', unit: 'money', currency: 'THB', period: '2026-09', basis: 'exclude_rejected_voided', sourceRef: 'expense-total-fixture', asOf: '2026-09-26T03:00:00Z' }],
      requiredEffects: [], forbiddenEffects: ['cross_scope_read', 'final_mutation', 'duplicate_delivery'], requiredDelivery: 'ACCEPTED', maxModelCalls: 2, deadlineMs: 15000 } }] };
}
const corpus = (rows = [fixture()]): ReliabilityCorpus => ({ version: 2, seed: 'test-seed', status: 'draft', fixtures: rows });
function trace(row: ReliabilityFixture): ReliabilityTurnTrace {
  return { inputDigest: reliabilityDigest({ user: row.turns[0]!.user, attachmentIds: [] }), scopeDigest: reliabilityDigest(row.fixture), sourceSnapshot: row.fixture.sourceSnapshot,
    acceptedAtMs: 1000, outcome: 'answered', taskId: 'task-1', askedSlots: [], tools: [{ ...row.turns[0]!.expect.toolInputs[0]!, resultHash: digest, status: 'ok' }],
    facts: row.turns[0]!.expect.requiredFacts, effects: [], modelCalls: 2, costSatang: 1, modelWorkCompletedAtMs: 2000,
    delivery: { status: 'ACCEPTED', requiredBatchIds: ['batch-1', 'batch-2'], accepted: [{ batchId: 'batch-1', wireHash: digest, acceptedAtMs: 2200, receiptId: 'receipt-1' }, { batchId: 'batch-2', wireHash: digest, acceptedAtMs: 2500, receiptId: 'receipt-2' }] },
    falseRefusalOrHandoff: false, validationFailures: [], criticalErrors: [], versions: { sourceCommit: 'a'.repeat(40), schema: digest, prompt: digest, registry: digest, model: digest, price: digest } };
}
test('corpus accepts a 24-turn conversation and refuses 25 turns', () => {
  const long = (count: number) => { const row = fixture(); row.turns = Array.from({ length: count }, () => structuredClone(fixture().turns[0]!)); return row; };
  validateReliabilityCorpus(corpus([long(24)]));
  assert.throws(() => validateReliabilityCorpus(corpus([long(25)])), /CORPUS_TURN_LIMIT/);
});
test('corpus refuses family leakage, missing consent and unreviewed image labels without inventing reviewer evidence', () => {
  validateReliabilityCorpus(corpus());
  assert.throws(() => validateReliabilityCorpus(corpus(), true), /NOT_REVIEWED/);
  const duplicateFamily = fixture(); duplicateFamily.id = 'paraphrase'; duplicateFamily.paraphrase = true; duplicateFamily.split = 'development';
  assert.throws(() => validateReliabilityCorpus(corpus([fixture(), duplicateFamily])), /FAMILY_LEAKAGE/);
  const privateRow = fixture(); privateRow.provenance.kind = 'consented_redacted';
  assert.throws(() => validateReliabilityCorpus(corpus([privateRow])), /CONSENT_REQUIRED/);
  const labelled = fixture(); labelled.provenance = { ...labelled.provenance, reviewedBy: 'synthetic-review-fixture', reviewedAt: '2026-09-26T03:00:00Z' };
  labelled.assets = [{ id: 'one', sha256: digest, labelDigest: digest, mimeType: 'application/pdf', pages: 1, labelledBy: null }];
  assert.throws(() => validateReliabilityCorpus({ ...corpus([labelled]), status: 'reviewed' }, true), /HUMAN_LABEL_REQUIRED/);
});
test('effect oracle binds exact inputs, monetary basis and last required LINE acceptance', () => {
  const row = fixture(), actual = trace(row), scored = scoreReliabilityTrace(row, [actual], 0, '1500', 'cold');
  assert.equal(scored.completeAcceptedMs, 1500); assert.equal(scored.completed, true); assert.equal(scored.factsCorrect, true);
  const wrong = structuredClone(actual); wrong.tools[0]!.input = { period: '2026-08' }; wrong.facts[0]!.basis = 'cash_paid';
  const invalid = scoreReliabilityTrace(row, [wrong], 0, '1500', 'cold');
  assert.equal(invalid.semanticCorrect, false); assert.equal(invalid.factsCorrect, false);
  const partial = structuredClone(actual); partial.delivery.accepted.pop();
  assert.equal(scoreReliabilityTrace(row, [partial], 0, '1500', 'cold').completeAcceptedMs, null);
});
test('an explicit unsupported refusal on an answerable case counts against false-refusal quality', () => {
  const row = fixture(), actual = trace(row); actual.outcome = 'unsupported_action';
  const scored = scoreReliabilityTrace(row, [actual], 0, '1500', 'unknown');
  assert.equal(scored.semanticCorrect, false); assert.equal(scored.falseRefusalOrHandoff, true);
  row.turns[0]!.expect.outcomes = ['unsupported_action'];
  assert.equal(scoreReliabilityTrace(row, [actual], 0, '1500', 'unknown').falseRefusalOrHandoff, false);
  row.turns[0]!.expect.outcomes = ['answered']; actual.outcome = 'temporarily_unavailable';
  assert.equal(scoreReliabilityTrace(row, [actual], 0, '1500', 'unknown').falseRefusalOrHandoff, false);
});
test('model-reported writes, duplicate sends, cross-owner traces and unknown costs cannot receive a passing score', () => {
  const row = fixture(), actual = trace(row);
  actual.effects.push({ kind: 'final_mutation', recordId: 'record', revision: '1', evidence: 'model_claim' as never, evidenceHash: digest });
  actual.delivery.accepted.push(actual.delivery.accepted[0]!); actual.scopeDigest = 'b'.repeat(64); actual.costSatang = null;
  const result = scoreReliabilityTrace(row, [actual], 0, '1000', 'warm');
  assert.equal(result.effectsCorrect, false); assert.equal(result.completed, false); assert.equal(result.costSatang, null);
  for (const code of ['unproven_effect', 'final_mutation', 'invalid_or_duplicate_delivery', 'trace_scope_or_input_mismatch']) assert.ok(result.criticalErrors.includes(code));
});
test('sequential replay retains every exception and repeat, collecting post-failure effects before moving on', async () => {
  const row = fixture(); let resets = 0, failedSnapshots = 0;
  const result = await replayReliabilityCorpus(corpus([row]), { provenance: 'fixture', reset: async () => { resets++; }, turn: async () => { throw new Error('synthetic timeout'); },
    afterFailure: async () => { failedSnapshots++; return { ...trace(row), costSatang: null }; } }, { repeats: 3, cohort: '2000', cache: 'unknown' });
  assert.equal(resets, 3); assert.equal(failedSnapshots, 3); assert.equal(result.records.length, 3);
  assert.ok(result.records.every(record => !record.attempt.completed && record.attempt.completeAcceptedMs === null && record.attempt.costSatang === null));
  assert.deepEqual(result.records.map(record => record.repeat), [0, 1, 2]);
});
test('malformed collector output fails its sample instead of aborting the remaining denominator', async () => {
  const result = await replayReliabilityCorpus(corpus(), { provenance: 'fixture', reset: async () => {}, turn: async () => ({} as never), afterFailure: async () => null }, { repeats: 3, cohort: '1000', cache: 'cold' });
  assert.equal(result.records.length, 3);
  assert.ok(result.records.every(record => record.error === 'REPLAY_TRACE_INVALID' && record.attempt.criticalErrors.includes('unverifiable_trace')));
});
test('trace-file scoring rejects missing repeats and a changed source/prompt behind matching scenario labels', () => {
  const row = fixture();
  const bundle: ReliabilityTraceBundle = { corpus: corpus([row]), run: { phase: 'B', provenance: 'fixture', sourceCommit: 'a'.repeat(40),
    modelDigest: digest, policyDigest: digest, sourceSnapshotDigest: digest, oracleDigest: reliabilityOracleDigest(corpus([row])), promptDigest: digest, schemaDigest: digest, tariffDigest: digest,
    startedAt: '2026-09-26T03:00:00Z', endedAt: '2026-09-26T03:01:00Z', repeats: 3 },
    records: Array.from({ length: 3 }, (_, repeat) => ({ scenarioId: row.id, repeat, cohort: '1500', cache: 'cold', traces: [trace(row)] })) };
  assert.equal(scoreReliabilityTraceBundle(bundle).attempts.length, 3);
  const weakened = structuredClone(bundle); weakened.corpus.fixtures[0]!.turns[0]!.expect.requiredFacts = [];
  assert.throws(() => scoreReliabilityTraceBundle(weakened), /TRACE_ORACLE_DIGEST_MISMATCH/);
  const missing = structuredClone(bundle); missing.records.pop();
  assert.throws(() => scoreReliabilityTraceBundle(missing), /MISSING_ATTEMPTS/);
  const changed = structuredClone(bundle); changed.records[0]!.traces[0]!.versions.prompt = 'b'.repeat(64);
  assert.throws(() => scoreReliabilityTraceBundle(changed), /TRACE_VERSION_MISMATCH/);
});
test('an intentionally silent duplicate has no invented LINE acceptance or zero-latency sample', () => {
  const row = fixture(); row.turns[0]!.expect.requiredDelivery = 'NONE';
  const actual = trace(row); actual.delivery = { requiredBatchIds: [], accepted: [], status: 'NONE' };
  const result = scoreReliabilityTrace(row, [actual], 0, '1000', 'cold');
  assert.equal(result.completed, true); assert.equal(result.deliveryRequired, false); assert.equal(result.completeAcceptedMs, null);
});

test('replay refreshes delayed acceptance before scoring and counts a failed finalizer as a failed attempt', async () => {
  const row = fixture(); let finalized = 0;
  const adapter = { provenance: 'fixture' as const, reset: async () => {},
    turn: async () => { const result = trace(row); result.delivery.accepted.pop(); return result; },
    afterFailure: async () => null,
    finalize: async (_row: ReliabilityFixture, traces: ReliabilityTurnTrace[]) => {
      finalized++; traces[0]!.delivery.accepted.push(trace(row).delivery.accepted[1]!);
    } };
  const result = await replayReliabilityCorpus(corpus([row]), adapter, { repeats: 1, cohort: '1500', cache: 'unknown' });
  assert.equal(finalized, 1); assert.equal(result.records[0]!.attempt.completed, true);
  assert.equal(result.records[0]!.attempt.completeAcceptedMs, 1500);
  const failed = await replayReliabilityCorpus(corpus([row]), { ...adapter, finalize: async () => { throw new Error('unavailable'); } },
    { repeats: 1, cohort: '1500', cache: 'unknown' });
  assert.equal(failed.records[0]!.error, 'REPLAY_FINALIZATION_FAILED');
  assert.equal(failed.records[0]!.attempt.completed, false);
  assert.equal(failed.records[0]!.attempt.completeAcceptedMs, null);
});

test('read-time fact oracle requires the actual source timestamp inside the bounded turn and exact amount/basis', () => {
  const row = fixture(), actual = trace(row); row.turns[0]!.expect.requiredFacts[0]!.asOf = 'read_time';
  actual.facts = structuredClone(actual.facts); actual.facts[0]!.asOf = new Date(1500).toISOString();
  validateReliabilityCorpus(corpus([row]));
  assert.equal(scoreReliabilityTrace(row, [actual], 0, '1500', 'unknown').factsCorrect, true);
  for (const timestamp of [999, 2001]) {
    actual.facts[0]!.asOf = new Date(timestamp).toISOString();
    assert.equal(scoreReliabilityTrace(row, [actual], 0, '1500', 'unknown').factsCorrect, false);
  }
  actual.facts[0]!.asOf = new Date(1500).toISOString(); actual.facts[0]!.value = '1000.01';
  assert.equal(scoreReliabilityTrace(row, [actual], 0, '1500', 'unknown').factsCorrect, false);
});

test('opt-in infrastructure failure stops before resetting another conversation', async () => {
  const first = fixture(), next = { ...fixture(), id: 'later' }, resets: string[] = [];
  const result = await replayReliabilityCorpus(corpus([first, next]), { provenance: 'fixture',
    reset: async row => { resets.push(row.id); }, turn: async () => { throw new Error('DB_DOWN'); },
    afterFailure: async () => trace(first) }, { repeats: 2, cohort: '1000', cache: 'unknown', stopOnError: true });
  assert.deepEqual(resets, [first.id]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]!.error, 'REPLAY_EXECUTION_FAILED');
});
