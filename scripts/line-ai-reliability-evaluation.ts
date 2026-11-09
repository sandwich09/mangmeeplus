/** v2.4 W14: compare frozen A/B/C observations, never infer quality from speed or mocks. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { familyConfidenceInterval } from './line-ai-reliability-blind-comparison';

export const RELIABILITY_GROUPS = ['single_turn', 'multi_turn', 'general_help', 'mixed_current_denied', 'receipt_document'] as const;

export type ReliabilityScenario = {
  id: string;
  familyId: string;
  split: 'development' | 'held_out';
  language: 'th' | 'en';
  paraphrase: boolean;
  fixedRegression: boolean;
  group?: typeof RELIABILITY_GROUPS[number];
};

export type ReliabilityAttempt = {
  scenarioId: string;
  repeat: number;
  cohort: '1000' | '1500' | '2000';
  cache: 'cold' | 'warm' | 'unknown';
  semanticCorrect: boolean;
  factsCorrect: boolean;
  effectsCorrect: boolean;
  completed: boolean;
  falseRefusalOrHandoff: boolean;
  criticalErrors: string[];
  errorFamilies: string[];
  modelCalls: number;
  costSatang: number | null;
  deadlineMs: number;
  /** Time from original acceptance to acceptance of the LAST required LINE batch; ack is excluded. */
  completeAcceptedMs: number | null;
  /** Explicit silence (duplicate/cancel/no-notification) has an effect oracle but no LINE latency. */
  deliveryRequired?: boolean;
};

export type ReliabilityRun = {
  phase: 'A' | 'B' | 'C';
  sourceCommit: string;
  provenance: 'real_provider' | 'fixture';
  corpusDigest: string;
  modelDigest: string;
  policyDigest: string;
  sourceSnapshotDigest: string;
  oracleDigest: string;
  promptDigest: string;
  schemaDigest: string;
  tariffDigest: string;
  startedAt: string;
  endedAt: string;
  repeats: number;
  scenarios: ReliabilityScenario[];
  attempts: ReliabilityAttempt[];
};

const sha256 = /^[0-9a-f]{64}$/;
const digestFields = ['corpusDigest', 'modelDigest', 'policyDigest', 'sourceSnapshotDigest', 'oracleDigest', 'promptDigest', 'schemaDigest', 'tariffDigest'] as const;
const pairedFields = ['corpusDigest', 'modelDigest', 'policyDigest', 'sourceSnapshotDigest', 'oracleDigest', 'tariffDigest'] as const;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const attemptKey = (row: Pick<ReliabilityAttempt, 'scenarioId' | 'repeat'>) => `${row.scenarioId}:${row.repeat}`;
const passed = (row: ReliabilityAttempt) => row.semanticCorrect && row.factsCorrect && row.effectsCorrect
  && row.completed && (row.deliveryRequired === false || row.completeAcceptedMs !== null) && !row.falseRefusalOrHandoff && row.criticalErrors.length === 0;

/** Missing, duplicated or malformed rows invalidate the run instead of shrinking its denominator. */
export function validateReliabilityRun(value: unknown): asserts value is ReliabilityRun {
  assert.ok(value && typeof value === 'object', 'RUN_REQUIRED');
  const run = value as ReliabilityRun;
  assert.ok(['A', 'B', 'C'].includes(run.phase), 'INVALID_PHASE');
  assert.match(run.sourceCommit, /^[0-9a-f]{40}$/, 'INVALID_SOURCE_COMMIT');
  assert.ok(['real_provider', 'fixture'].includes(run.provenance), 'INVALID_PROVENANCE');
  for (const key of digestFields) assert.match(run[key], sha256, `INVALID_${key}`);
  assert.ok(Number.isFinite(Date.parse(run.startedAt)) && Date.parse(run.endedAt) >= Date.parse(run.startedAt), 'INVALID_SAMPLE_WINDOW');
  assert.ok(Number.isInteger(run.repeats) && run.repeats >= 1 && run.repeats <= 100, 'INVALID_REPEATS');
  assert.ok(Array.isArray(run.scenarios) && run.scenarios.length > 0, 'SCENARIOS_REQUIRED');
  assert.ok(Array.isArray(run.attempts), 'ATTEMPTS_REQUIRED');
  const scenarios = new Map<string, ReliabilityScenario>();
  const familySplits = new Map<string, string>();
  for (const scenario of run.scenarios) {
    assert.ok(typeof scenario.id === 'string' && scenario.id.length > 0 && !scenarios.has(scenario.id), 'DUPLICATE_OR_INVALID_SCENARIO');
    assert.ok(typeof scenario.familyId === 'string' && scenario.familyId.length > 0, 'FAMILY_REQUIRED');
    assert.ok(['held_out', 'development'].includes(scenario.split), 'INVALID_SPLIT');
    assert.ok(['th', 'en'].includes(scenario.language), 'INVALID_LANGUAGE');
    assert.equal(typeof scenario.paraphrase, 'boolean', 'INVALID_PARAPHRASE');
    assert.equal(typeof scenario.fixedRegression, 'boolean', 'INVALID_FIXED_REGRESSION');
    assert.ok(scenario.group === undefined || RELIABILITY_GROUPS.includes(scenario.group), 'INVALID_SCENARIO_GROUP');
    const existing = familySplits.get(scenario.familyId);
    assert.ok(!existing || existing === scenario.split, `FAMILY_SPLIT_LEAKAGE:${scenario.familyId}`);
    familySplits.set(scenario.familyId, scenario.split);
    scenarios.set(scenario.id, scenario);
  }
  const seen = new Set<string>();
  for (const row of run.attempts) {
    assert.ok(scenarios.has(row.scenarioId), 'UNKNOWN_SCENARIO');
    assert.ok(Number.isInteger(row.repeat) && row.repeat >= 0 && row.repeat < run.repeats, 'INVALID_REPEAT');
    assert.ok(!seen.has(attemptKey(row)), 'DUPLICATE_ATTEMPT');
    seen.add(attemptKey(row));
    // Speed r26d: an eval run may pin any whole-millisecond debounce (MANGMEE_EVAL_DEBOUNCE_MS); the summary still groups the three cohorts.
    assert.ok(/^[1-9]\d{1,4}$/.test(row.cohort), 'INVALID_COHORT');
    assert.ok(['cold', 'warm', 'unknown'].includes(row.cache), 'INVALID_CACHE_STATE');
    for (const key of ['semanticCorrect', 'factsCorrect', 'effectsCorrect', 'completed', 'falseRefusalOrHandoff'] as const) {
      assert.equal(typeof row[key], 'boolean', `INVALID_${key}`);
    }
    for (const key of ['criticalErrors', 'errorFamilies'] as const) {
      assert.ok(Array.isArray(row[key]) && row[key].every((v) => typeof v === 'string' && v.length > 0), `INVALID_${key}`);
    }
    assert.ok(Number.isInteger(row.modelCalls) && row.modelCalls >= 0, 'INVALID_MODEL_CALLS');
    assert.ok(row.costSatang === null || nonnegative(row.costSatang), 'INVALID_COST');
    assert.ok(nonnegative(row.deadlineMs) && row.deadlineMs > 0, 'INVALID_DEADLINE');
    assert.ok(row.completeAcceptedMs === null || nonnegative(row.completeAcceptedMs), 'INVALID_ACCEPTANCE_TIME');
    assert.ok(row.deliveryRequired === undefined || typeof row.deliveryRequired === 'boolean', 'INVALID_DELIVERY_REQUIREMENT');
    if (row.deliveryRequired === false) assert.equal(row.completeAcceptedMs, null, 'SILENT_ACTION_HAS_NO_LINE_ACCEPTANCE');
    else assert.equal(row.completed, row.completeAcceptedMs !== null, 'COMPLETION_REQUIRES_FULL_DELIVERY');
  }
  assert.equal(seen.size, scenarios.size * run.repeats, 'MISSING_ATTEMPTS');
}

/** null represents an uncompleted tail, never a fabricated zero-millisecond answer. */
function percentile(values: Array<number | null>, fraction: number): number | null {
  if (!values.length) return null;
  const sorted = values.map((v) => v ?? Infinity).sort((a, b) => a - b);
  const value = sorted[Math.ceil(sorted.length * fraction) - 1]!;
  return Number.isFinite(value) ? value : null;
}

function summarizeAttempts(rows: ReliabilityAttempt[]) {
  const count = rows.length;
  const successful = rows.filter(passed).length;
  const unknownCosts = rows.filter((row) => row.costSatang === null).length;
  const timed = rows.filter(row => row.deliveryRequired !== false), times = timed.map((row) => row.completeAcceptedMs);
  return {
    attempts: count,
    successful,
    completionRate: count ? successful / count : null,
    semanticCorrect: rows.filter((row) => row.semanticCorrect).length,
    falseRefusalOrHandoff: rows.filter((row) => row.falseRefusalOrHandoff).length,
    criticalErrors: rows.reduce((sum, row) => sum + row.criticalErrors.length, 0),
    incomplete: rows.filter((row) => !row.completed).length,
    requiredDeliveries: timed.length,
    withinDeadline: timed.filter((row) => passed(row) && row.completeAcceptedMs! <= row.deadlineMs).length,
    modelCalls: rows.reduce((sum, row) => sum + row.modelCalls, 0),
    costSatang: unknownCosts ? null : rows.reduce((sum, row) => sum + row.costSatang!, 0),
    unknownCosts,
    firstCompleteAcceptedMs: {
      p50: percentile(times, 0.5),
      p95: timed.length >= 100 ? percentile(times, 0.95) : null,
      p99: timed.length >= 100 ? percentile(times, 0.99) : null,
      tailSampleMinimumMet: timed.length >= 100,
    },
    errors: Object.fromEntries([...new Set(rows.flatMap((row) => row.errorFamilies))]
      .map((error) => [error, rows.filter((row) => row.errorFamilies.includes(error)).length])),
  };
}

export function summarizeReliabilityRun(run: ReliabilityRun) {
  validateReliabilityRun(run);
  const families = [...new Set(run.scenarios.map((scenario) => scenario.familyId))];
  return {
    phase: run.phase,
    provenance: run.provenance,
    window: { startedAt: run.startedAt, endedAt: run.endedAt },
    ...summarizeAttempts(run.attempts),
    scenarios: run.scenarios.length,
    independentFamilies: families.length,
    heldOutFamilies: new Set(run.scenarios.filter((s) => s.split === 'held_out').map((s) => s.familyId)).size,
    completionInterval: familyConfidenceInterval(families.map(family => {
      const ids = new Set(run.scenarios.filter(s => s.familyId === family).map(s => s.id));
      const rows = run.attempts.filter(row => ids.has(row.scenarioId));
      return rows.filter(passed).length / rows.length;
    })),
    byGroup: Object.fromEntries(RELIABILITY_GROUPS.map(group => {
      const ids = new Set(run.scenarios.filter(s => s.group === group).map(s => s.id));
      return [group, summarizeAttempts(run.attempts.filter(row => ids.has(row.scenarioId)))];
    })),
    worstRepeat: Math.min(...Array.from({ length: run.repeats }, (_, repeat) => summarizeAttempts(run.attempts.filter((r) => r.repeat === repeat)).completionRate!)),
    byCohort: Object.fromEntries(['1000', '1500', '2000'].map((cohort) => [cohort, summarizeAttempts(run.attempts.filter((row) => row.cohort === cohort))])),
    byCache: Object.fromEntries(['cold', 'warm', 'unknown'].map((cache) => [cache, summarizeAttempts(run.attempts.filter((row) => row.cache === cache))])),
    byFamily: Object.fromEntries(families.map((family) => {
      const ids = new Set(run.scenarios.filter((scenario) => scenario.familyId === family).map((s) => s.id));
      return [family, summarizeAttempts(run.attempts.filter((row) => ids.has(row.scenarioId)))];
    })),
  };
}

/** This is a mechanical gate, not a substitute for blind human review, CI intervals or native LINE. */
export function compareReliabilityRuns(a: ReliabilityRun, b: ReliabilityRun, c: ReliabilityRun) {
  [a, b, c].forEach(validateReliabilityRun);
  assert.deepEqual([a.phase, b.phase, c.phase], ['A', 'B', 'C'], 'EXPECTED_A_B_C');
  for (const run of [b, c]) {
    for (const key of pairedFields) assert.equal(run[key], a[key], `PAIR_MISMATCH:${key}`);
    assert.equal(run.repeats, a.repeats, 'PAIR_REPEAT_MISMATCH');
    assert.deepEqual([...run.scenarios].sort((x, y) => x.id.localeCompare(y.id)), [...a.scenarios].sort((x, y) => x.id.localeCompare(y.id)), 'PAIR_SCENARIO_MISMATCH');
  }
  const before = new Map(b.attempts.map((row) => [attemptKey(row), row]));
  const failures: string[] = [];
  for (const row of c.attempts) {
    const previous = before.get(attemptKey(row))!;
    for (const key of ['cohort', 'cache', 'deadlineMs'] as const) assert.equal(row[key], previous[key], `PAIR_ATTEMPT_MISMATCH:${key}`);
    if (passed(previous) && !passed(row)) failures.push(`QUALITY_REGRESSION:${attemptKey(row)}`);
    for (const key of ['semanticCorrect', 'factsCorrect', 'effectsCorrect', 'completed'] as const) {
      if (previous[key] && !row[key]) failures.push(`QUALITY_REGRESSION:${key}:${attemptKey(row)}`);
    }
    if (!previous.falseRefusalOrHandoff && row.falseRefusalOrHandoff) failures.push(`QUALITY_REGRESSION:falseRefusalOrHandoff:${attemptKey(row)}`);
    if (row.criticalErrors.length) failures.push(`CRITICAL_ERROR:${attemptKey(row)}`);
    if (!row.effectsCorrect) failures.push(`EFFECT_MISMATCH:${attemptKey(row)}`);
    if (c.scenarios.find((s) => s.id === row.scenarioId)!.fixedRegression && !passed(row)) failures.push(`FIXED_REGRESSION:${attemptKey(row)}`);
  }
  const summaries = [a, b, c].map(summarizeReliabilityRun);
  const candidate = summaries[2]!;
  if (candidate.semanticCorrect / candidate.attempts < 0.95) failures.push('SEMANTIC_RATE_BELOW_95_PERCENT');
  if (candidate.completionRate! < 0.95) failures.push('COMPLETION_BELOW_95_PERCENT');
  if (candidate.falseRefusalOrHandoff / candidate.attempts > 0.02) failures.push('FALSE_REFUSAL_ABOVE_2_PERCENT');
  const heldOut = new Set(c.scenarios.filter(s => s.split === 'held_out').map(s => s.id));
  const heldOutRows = c.attempts.filter(row => heldOut.has(row.scenarioId));
  if (heldOutRows.length && heldOutRows.filter(row => row.semanticCorrect).length / heldOutRows.length < 0.95) failures.push('HELD_OUT_SEMANTIC_BELOW_95_PERCENT');
  for (const group of RELIABILITY_GROUPS) {
    const cases = c.scenarios.filter(s => s.group === group && s.split === 'held_out');
    if (cases.length < 10) continue;
    const ids = new Set(cases.map(s => s.id)), rows = c.attempts.filter(row => ids.has(row.scenarioId));
    if (rows.filter(row => row.semanticCorrect).length / rows.length < 0.95) failures.push(`GROUP_SEMANTIC_BELOW_95_PERCENT:${group}`);
    if (rows.filter(passed).length / rows.length < 0.95) failures.push(`GROUP_COMPLETION_BELOW_95_PERCENT:${group}`);
  }
  const missingEvidence = [
    ...([a, b, c].some((run) => run.provenance !== 'real_provider') ? ['REAL_PROVIDER_REQUIRED'] : []),
    ...(c.scenarios.filter(s => !s.paraphrase).length < 150 ? ['MINIMUM_150_BASE_SCENARIOS'] : []),
    ...(c.scenarios.filter(s => !s.paraphrase && s.split === 'development').length < 100 ? ['MINIMUM_100_DEVELOPMENT_SCENARIOS'] : []),
    ...(candidate.heldOutFamilies < 50 ? ['MINIMUM_50_HELD_OUT_FAMILIES'] : []),
    ...(c.scenarios.filter((s) => s.language === 'th' && s.paraphrase).length < 75 ? ['MINIMUM_75_THAI_PARAPHRASES'] : []),
    ...(c.repeats < 3 ? ['MINIMUM_3_REPEATS'] : []),
    ...RELIABILITY_GROUPS.filter(group => new Set(c.scenarios.filter(s => s.group === group && s.split === 'held_out').map(s => s.familyId)).size < 10)
      .map(group => `MINIMUM_10_HELD_OUT_FAMILIES:${group}`),
    ...(summaries.some((summary) => summary.unknownCosts > 0) ? ['COST_RECONCILIATION_REQUIRED'] : []),
    'BLIND_REVIEW_AND_CLUSTER_INTERVALS_REQUIRED',
    'NATIVE_LINE_AND_RELEASE_ACCEPTANCE_REQUIRED',
  ];
  return { scope: 'mechanical_paired_quality_check', status: failures.length ? 'failed' : 'inconclusive', mechanicalPass: failures.length === 0, failures, missingEvidence, summaries };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    assert.equal(process.argv.length, 5, 'Usage: tsx scripts/line-ai-reliability-evaluation.ts A.json B.json C.json');
    const runs = process.argv.slice(2).map((path) => JSON.parse(readFileSync(path, 'utf8')));
    const result = compareReliabilityRuns(runs[0], runs[1], runs[2]);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.mechanicalPass ? 2 : 1; // 2 = incomplete external acceptance, never a release success.
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'INVALID_EVIDENCE');
    process.exitCode = 1;
  }
}
