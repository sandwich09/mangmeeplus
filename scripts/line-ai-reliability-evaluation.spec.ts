import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareReliabilityRuns, summarizeReliabilityRun, validateReliabilityRun, type ReliabilityRun } from './line-ai-reliability-evaluation';

function run(phase: 'A' | 'B' | 'C', count = 150): ReliabilityRun {
  const scenarios = Array.from({ length: count }, (_, i) => ({
    id: `scenario-${i}`, familyId: `family-${Math.floor(i / 3)}`, split: 'held_out' as const,
    language: 'th' as const, paraphrase: i % 3 !== 0, fixedRegression: i === 0,
  }));
  return {
    phase, sourceCommit: 'a'.repeat(40), provenance: 'fixture',
    corpusDigest: 'a'.repeat(64), modelDigest: 'b'.repeat(64), policyDigest: 'c'.repeat(64),
    sourceSnapshotDigest: 'd'.repeat(64), oracleDigest: 'e'.repeat(64), promptDigest: 'f'.repeat(64),
    schemaDigest: '0'.repeat(64), tariffDigest: '1'.repeat(64),
    startedAt: '2026-09-27T01:00:00Z', endedAt: '2026-09-27T02:00:00Z', repeats: 3, scenarios,
    attempts: scenarios.flatMap((scenario) => Array.from({ length: 3 }, (_, repeat) => ({
      scenarioId: scenario.id, repeat, cohort: '2000' as const, cache: 'cold' as const,
      semanticCorrect: true, factsCorrect: true, effectsCorrect: true, completed: true,
      falseRefusalOrHandoff: false, criticalErrors: [], errorFamilies: [], modelCalls: 1,
      costSatang: 3, deadlineMs: 10000, completeAcceptedMs: 1000,
    }))),
  };
}

describe('v2.4 paired quality/speed evidence', () => {
  it('retains every failed attempt in latency, cost, model calls and success denominators', () => {
    const candidate = run('C', 100);
    for (const row of candidate.attempts.slice(0, 30)) {
      Object.assign(row, { completed: false, semanticCorrect: false, completeAcceptedMs: null, modelCalls: 2, errorFamilies: ['PROVIDER_FAILURE'] });
    }
    const result = summarizeReliabilityRun(candidate);
    assert.equal(result.attempts, 300);
    assert.equal(result.successful, 270);
    assert.equal(result.completionRate, 0.9);
    assert.equal(result.withinDeadline, 270);
    assert.equal(result.modelCalls, 330);
    assert.equal(result.costSatang, 900);
    assert.equal(result.firstCompleteAcceptedMs.p95, null, 'undelivered tail must not disappear');
    assert.equal(result.errors.PROVIDER_FAILURE, 30);
    assert.equal(result.worstRepeat, 0.9);
  });

  it('rejects missing rows, duplicates, or out-of-range repeats rather than silently shrinking coverage', () => {
    const missing = run('A'); missing.attempts.pop();
    assert.throws(() => validateReliabilityRun(missing), /MISSING_ATTEMPTS/);
    const duplicate = run('A'); duplicate.attempts[1] = { ...duplicate.attempts[0]! };
    assert.throws(() => validateReliabilityRun(duplicate), /DUPLICATE_ATTEMPT/);
    const badRepeat = run('A'); badRepeat.attempts[0]!.repeat = 3;
    assert.throws(() => validateReliabilityRun(badRepeat), /INVALID_REPEAT/);
  });

  it('keeps a paraphrase family in one split and counts repeats separately from independent families', () => {
    const candidate = run('C');
    const result = summarizeReliabilityRun(candidate);
    assert.equal(result.scenarios, 150);
    assert.equal(result.attempts, 450);
    assert.equal(result.independentFamilies, 50);
    assert.equal(result.heldOutFamilies, 50);
    candidate.scenarios[1]!.split = 'development';
    assert.throws(() => validateReliabilityRun(candidate), /FAMILY_SPLIT_LEAKAGE/);
  });

  it('cannot trade correctness for a faster response or an improvement over baseline A', () => {
    const a = run('A'); const b = run('B'); const c = run('C');
    a.attempts[0]!.semanticCorrect = false;
    c.attempts[0]!.semanticCorrect = false;
    c.attempts[0]!.completeAcceptedMs = 1;
    const result = compareReliabilityRuns(a, b, c);
    assert.equal(result.status, 'failed');
    assert.ok(result.failures.some((v) => v.startsWith('QUALITY_REGRESSION:')));
    assert.ok(result.failures.includes('FIXED_REGRESSION:scenario-0:0'));
  });

  it('detects a regression on one dimension even when another dimension was already failing', () => {
    const b = run('B'); const c = run('C');
    b.attempts[4]!.factsCorrect = false;
    c.attempts[4]!.factsCorrect = false;
    c.attempts[4]!.semanticCorrect = false;
    const result = compareReliabilityRuns(run('A'), b, c);
    assert.ok(result.failures.includes('QUALITY_REGRESSION:semanticCorrect:scenario-1:1'));
  });

  it('fails critical scope/finance errors regardless of the aggregate score', () => {
    const c = run('C');
    c.attempts[7]!.criticalErrors.push('UNAUTHORIZED_EFFECT');
    c.attempts[7]!.effectsCorrect = false;
    const result = compareReliabilityRuns(run('A'), run('B'), c);
    assert.equal(result.mechanicalPass, false);
    assert.ok(result.failures.includes('CRITICAL_ERROR:scenario-2:1'));
  });

  it('refuses to compare different data, pricing, model or scoring policies', () => {
    for (const key of ['corpusDigest', 'modelDigest', 'policyDigest', 'sourceSnapshotDigest', 'oracleDigest', 'tariffDigest'] as const) {
      const c = run('C'); c[key] = '9'.repeat(64);
      assert.throws(() => compareReliabilityRuns(run('A'), run('B'), c), /PAIR_MISMATCH/);
    }
    const c = run('C'); c.attempts[1]!.deadlineMs = 10001;
    assert.throws(() => compareReliabilityRuns(run('A'), run('B'), c), /PAIR_ATTEMPT_MISMATCH/);
  });

  it('allows versioned prompt/schema changes while preserving paired data/model/policy', () => {
    const c = run('C'); c.promptDigest = '2'.repeat(64); c.schemaDigest = '3'.repeat(64);
    assert.equal(compareReliabilityRuns(run('A'), run('B'), c).mechanicalPass, true);
  });

  it('does not count an ack, UNKNOWN, or partial batch as completed delivery', () => {
    const c = run('C'); c.attempts[0]!.completeAcceptedMs = null;
    assert.throws(() => validateReliabilityRun(c), /COMPLETION_REQUIRES_FULL_DELIVERY/);
    c.attempts[0]!.completed = false;
    assert.equal(summarizeReliabilityRun(c).successful, 449);
  });

  it('counts a correct late answer as completed but outside the deadline', () => {
    const c = run('C'); c.attempts[0]!.completeAcceptedMs = 10001;
    const result = summarizeReliabilityRun(c);
    assert.equal(result.successful, 450);
    assert.equal(result.withinDeadline, 449);
  });

  it('keeps missing usage pending instead of turning it into free inference', () => {
    const c = run('C'); c.attempts[0]!.costSatang = null;
    const result = compareReliabilityRuns(run('A'), run('B'), c);
    assert.equal(result.summaries[2]!.costSatang, null);
    assert.ok(result.missingEvidence.includes('COST_RECONCILIATION_REQUIRED'));
  });

  it('does not publish p95/p99 from a tiny cohort or fabricate zero when a cohort has no samples', () => {
    const result = summarizeReliabilityRun(run('C', 1));
    assert.equal(result.firstCompleteAcceptedMs.p95, null);
    assert.equal(result.byCohort['1000']!.firstCompleteAcceptedMs.p50, null);
    assert.equal(result.byCohort['1000']!.completionRate, null);
  });

  it('never reports a fixture comparison or a mechanical pass as released or ChatGPT-equivalent', () => {
    const result = compareReliabilityRuns(run('A'), run('B'), run('C'));
    assert.equal(result.status, 'inconclusive');
    assert.equal(result.mechanicalPass, true);
    assert.ok(result.missingEvidence.includes('REAL_PROVIDER_REQUIRED'));
    assert.ok(result.missingEvidence.includes('BLIND_REVIEW_AND_CLUSTER_INTERVALS_REQUIRED'));
    assert.ok(result.missingEvidence.includes('NATIVE_LINE_AND_RELEASE_ACCEPTANCE_REQUIRED'));
  });
});
