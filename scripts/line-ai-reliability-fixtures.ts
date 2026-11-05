/** Shared fixture/oracle support for the existing LINE replay runners; no production data loader. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateReliabilityRun, type ReliabilityAttempt, type ReliabilityScenario, type ReliabilityRun } from './line-ai-reliability-evaluation';

export type FinancialFactOracle = { metric: string; value: string; unit: string; currency: string | null; period: string; basis: string; sourceRef: string; asOf: string };
export type ReliabilityFixture = ReliabilityScenario & {
  capabilities: string[];
  provenance: { kind: 'synthetic' | 'consented_redacted'; sourceId: string; consentRef: string | null; reviewedBy: string | null; reviewedAt: string | null };
  fixture: { clock: string; timezone: string; company: string; actor: string; channelKind: 'USER' | 'GROUP' | 'ROOM'; messagingChannelId: string; membership: string | null; chat: string;
    permissions: string[]; branches: string[]; enabledFeatures: string[]; sourceSnapshot: string; taskRevision: number | null; previewRevision: number | null };
  assets: Array<{ id: string; sha256: string; mimeType: 'image/png' | 'image/jpeg' | 'application/pdf'; pages: number; labelDigest: string; labelledBy: string | null }>;
  turns: Array<{ user: string; attachmentIds: string[]; expect: { outcomes: string[]; sameTask?: boolean; missingSlot?: string; forbiddenRepeatedSlot?: string;
    toolInputs: Array<{ tool: string; input: Record<string, unknown> }>; requiredFacts: FinancialFactOracle[]; requiredEffects: Array<{ kind: string; recordId: string; revision: string }>;
    forbiddenEffects: string[]; requiredDelivery: 'ACCEPTED' | 'NONE'; maxModelCalls: number; deadlineMs: number } }>;
};
export type ReliabilityCorpus = { version: 2; seed: string; status: 'draft' | 'reviewed'; fixtures: ReliabilityFixture[] };
const hashPattern = /^[0-9a-f]{64}$/;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value;
export const reliabilityDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const equal = (a: unknown, b: unknown) => reliabilityDigest(a) === reliabilityDigest(b);
const multiset = (values: unknown[]) => values.map(reliabilityDigest).sort();

/** Validate before any paid work. A draft corpus is useful for development, never acceptance. */
export function validateReliabilityCorpus(corpus: ReliabilityCorpus, acceptance = false): void {
  assert.equal(corpus.version, 2, 'CORPUS_VERSION');
  assert.ok(nonempty(corpus.seed) && ['draft', 'reviewed'].includes(corpus.status), 'CORPUS_PROVENANCE');
  assert.ok(Array.isArray(corpus.fixtures) && corpus.fixtures.length > 0, 'CORPUS_EMPTY');
  if (acceptance) assert.equal(corpus.status, 'reviewed', 'CORPUS_NOT_REVIEWED');
  const ids = new Set<string>(), split = new Map<string, string>();
  for (const row of corpus.fixtures) {
    assert.ok(nonempty(row.id) && !ids.has(row.id) && nonempty(row.familyId), 'CORPUS_ID'); ids.add(row.id);
    assert.ok(['development', 'held_out'].includes(row.split) && ['th', 'en'].includes(row.language), 'CORPUS_SPLIT');
    assert.ok(!split.has(row.familyId) || split.get(row.familyId) === row.split, 'CORPUS_FAMILY_LEAKAGE'); split.set(row.familyId, row.split);
    assert.ok(row.capabilities.length && row.capabilities.every(c => /^C(?:0[1-9]|1[0-8])$/.test(c) && c !== 'C13'), 'CORPUS_CAPABILITY');
    assert.ok(['synthetic', 'consented_redacted'].includes(row.provenance.kind) && nonempty(row.provenance.sourceId), 'CORPUS_SOURCE');
    if (row.provenance.kind === 'consented_redacted') assert.ok(nonempty(row.provenance.consentRef), 'CORPUS_CONSENT_REQUIRED');
    if (acceptance) assert.ok(nonempty(row.provenance.reviewedBy) && Number.isFinite(Date.parse(row.provenance.reviewedAt ?? '')), 'CORPUS_REVIEW_REQUIRED');
    const f = row.fixture;
    assert.ok(Number.isFinite(Date.parse(f.clock)) && nonempty(f.timezone), 'CORPUS_CLOCK');
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: f.timezone }), 'CORPUS_TIMEZONE');
    assert.ok([f.company, f.actor, f.chat, f.messagingChannelId, f.sourceSnapshot].every(nonempty), 'CORPUS_SCOPE');
    assert.ok(['USER', 'GROUP', 'ROOM'].includes(f.channelKind), 'CORPUS_CHANNEL');
    for (const list of [f.permissions, f.branches, f.enabledFeatures]) assert.ok(Array.isArray(list) && list.every(nonempty) && new Set(list).size === list.length, 'CORPUS_ACCESS');
    for (const revision of [f.taskRevision, f.previewRevision]) assert.ok(revision === null || Number.isSafeInteger(revision) && revision >= 0, 'CORPUS_REVISION');
    const assets = new Map<string, ReliabilityFixture['assets'][number]>();
    assert.ok(row.assets.length <= 5, 'CORPUS_ASSET_LIMIT');
    for (const asset of row.assets) {
      assert.ok(nonempty(asset.id) && !assets.has(asset.id) && hashPattern.test(asset.sha256) && hashPattern.test(asset.labelDigest), 'CORPUS_ASSET_HASH');
      assert.ok(['image/png', 'image/jpeg', 'application/pdf'].includes(asset.mimeType) && Number.isInteger(asset.pages) && asset.pages > 0, 'CORPUS_ASSET');
      if (acceptance) assert.ok(nonempty(asset.labelledBy), 'CORPUS_HUMAN_LABEL_REQUIRED');
      assets.set(asset.id, asset);
    }
    assert.ok(row.assets.reduce((n, a) => n + a.pages, 0) <= 20, 'CORPUS_PAGE_LIMIT');
    assert.ok(row.turns.length > 0 && row.turns.length <= 20, 'CORPUS_TURN_LIMIT');
    for (const turn of row.turns) {
      assert.ok(typeof turn.user === 'string' && turn.user.length <= 12000 && (turn.user.length > 0 || turn.attachmentIds.length), 'CORPUS_INPUT');
      assert.ok(new Set(turn.attachmentIds).size === turn.attachmentIds.length && turn.attachmentIds.every(id => assets.has(id)), 'CORPUS_UNKNOWN_ASSET');
      assert.ok(turn.expect.outcomes.length && turn.expect.outcomes.every(nonempty), 'CORPUS_OUTCOME');
      assert.ok(Number.isInteger(turn.expect.maxModelCalls) && turn.expect.maxModelCalls >= 0 && turn.expect.maxModelCalls <= 4, 'CORPUS_MODEL_LIMIT');
      assert.ok(Number.isFinite(turn.expect.deadlineMs) && turn.expect.deadlineMs > 0, 'CORPUS_DEADLINE');
      assert.ok(['ACCEPTED', 'NONE'].includes(turn.expect.requiredDelivery), 'CORPUS_DELIVERY');
      for (const fact of turn.expect.requiredFacts) {
        assert.ok([fact.metric, fact.unit, fact.period, fact.basis, fact.sourceRef].every(nonempty) && /^-?\d+(?:\.\d+)?$/.test(fact.value)
          && (fact.asOf === 'read_time' || Number.isFinite(Date.parse(fact.asOf))) && (fact.currency === null || /^[A-Z]{3}$/.test(fact.currency)), 'CORPUS_FACT_ORACLE');
      }
    }
  }
}

/** Evidence comes from instrumented tools/domain snapshots/LINE receipts, not a model's success claim. */
export type ReliabilityTurnTrace = {
  inputDigest: string; scopeDigest: string; sourceSnapshot: string; acceptedAtMs: number;
  outcome: string; taskId: string | null; askedSlots: string[];
  tools: Array<{ tool: string; input: Record<string, unknown>; resultHash: string; status: string }>;
  facts: FinancialFactOracle[];
  effects: Array<{ kind: string; recordId: string; revision: string; evidence: 'database_snapshot' | 'audit_receipt'; evidenceHash: string }>;
  modelCalls: number; costSatang: number | null; modelWorkCompletedAtMs: number | null;
  delivery: { requiredBatchIds: string[]; accepted: Array<{ batchId: string; wireHash: string; acceptedAtMs: number; receiptId: string }>; status: string };
  falseRefusalOrHandoff: boolean; validationFailures: string[]; criticalErrors: string[];
  versions: { sourceCommit: string; schema: string; prompt: string; registry: string; model: string; price: string };
};

/** Dynamic snapshot timestamps must still be proven inside this actual turn's read window. */
function matchesFact(actual: FinancialFactOracle, expected: FinancialFactOracle, trace: ReliabilityTurnTrace): boolean {
  if (expected.asOf !== 'read_time') return equal(actual, expected);
  const at = Date.parse(actual.asOf), end = trace.modelWorkCompletedAtMs;
  return Number.isFinite(at) && end !== null && Number.isFinite(end) && at >= trace.acceptedAtMs && at <= end
    && equal({ ...actual, asOf: 'read_time' }, expected);
}

export function scoreReliabilityTrace(row: ReliabilityFixture, traces: ReliabilityTurnTrace[], repeat: number, cohort: ReliabilityAttempt['cohort'], cache: ReliabilityAttempt['cache']): ReliabilityAttempt {
  const errors = new Set<string>(), critical = new Set<string>();
  let semantic = traces.length === row.turns.length, facts = semantic, effects = semantic, completed = semantic;
  let first = Infinity, last = -Infinity, calls = 0, cost: number | null = 0, falseRefusal = false;
  if (!semantic) errors.add('missing_turn_trace');
  for (const [index, turn] of row.turns.entries()) {
    const trace = traces[index]; if (!trace) continue;
    const expected = turn.expect;
    const scopeValid = trace.scopeDigest === reliabilityDigest(row.fixture) && trace.sourceSnapshot === row.fixture.sourceSnapshot;
    const inputValid = trace.inputDigest === reliabilityDigest({ user: turn.user, attachmentIds: turn.attachmentIds });
    if (!scopeValid || !inputValid) { critical.add('trace_scope_or_input_mismatch'); semantic = false; }
    if (!Number.isFinite(trace.acceptedAtMs) || trace.acceptedAtMs < 0) { errors.add('invalid_acceptance_clock'); completed = false; }
    else first = Math.min(first, trace.acceptedAtMs);
    if (!expected.outcomes.includes(trace.outcome)) { semantic = false; errors.add('wrong_outcome'); }
    if (expected.sameTask && (index === 0 || !trace.taskId || trace.taskId !== traces[index - 1]?.taskId)) { semantic = false; errors.add('lost_task'); }
    if (expected.missingSlot && !trace.askedSlots.includes(expected.missingSlot) || expected.forbiddenRepeatedSlot && trace.askedSlots.includes(expected.forbiddenRepeatedSlot)) { semantic = false; errors.add('wrong_clarification'); }
    if (!equal(multiset(trace.tools.map(({ tool, input }) => ({ tool, input }))), multiset(expected.toolInputs))) { semantic = false; errors.add('tool_or_argument_mismatch'); }
    for (const fact of expected.requiredFacts) if (!trace.facts.some(actual => matchesFact(actual, fact, trace))) { facts = false; errors.add('missing_or_wrong_fact'); }
    // Extra numerical claims need their own expected ground truth; a correct total cannot mask a fabricated one.
    for (const fact of trace.facts) if (!expected.requiredFacts.some(wanted => matchesFact(fact, wanted, trace))) { facts = false; errors.add('unbound_fact'); }
    if (trace.effects.some(effect => !['database_snapshot', 'audit_receipt'].includes(effect.evidence) || !hashPattern.test(effect.evidenceHash))) { effects = false; critical.add('unproven_effect'); }
    if (!equal(trace.effects.map(({ kind, recordId, revision }) => ({ kind, recordId, revision })), expected.requiredEffects)) { effects = false; errors.add('effect_mismatch'); }
    for (const effect of trace.effects) if (expected.forbiddenEffects.includes(effect.kind)) { effects = false; critical.add(effect.kind); }
    if (!Number.isSafeInteger(trace.modelCalls) || trace.modelCalls < 0) { errors.add('unknown_model_calls'); semantic = false; }
    else { calls += trace.modelCalls; if (trace.modelCalls > expected.maxModelCalls) critical.add('model_call_limit'); }
    if (trace.costSatang === null || !Number.isFinite(trace.costSatang) || trace.costSatang < 0) cost = null;
    else if (cost !== null) cost += trace.costSatang;
    // The evaluator knows the independently authored expected behavior; the runtime must not.
    // Count an explicit wrongful refusal even when a transport adapter has no prose reviewer.
    falseRefusal ||= trace.falseRefusalOrHandoff || (expected.outcomes.includes('answered')
      && !expected.outcomes.includes(trace.outcome)
      && ['access_denied', 'unsupported_action', 'feature_unavailable', 'policy_blocked'].includes(trace.outcome));
    trace.criticalErrors.forEach(error => critical.add(error)); trace.validationFailures.forEach(error => errors.add(error));
    if (trace.validationFailures.length) semantic = false;
    const ids = trace.delivery.requiredBatchIds, receipts = trace.delivery.accepted;
    if (new Set(ids).size !== ids.length || new Set(receipts.map(r => r.batchId)).size !== receipts.length
      || receipts.some(receipt => !ids.includes(receipt.batchId) || !hashPattern.test(receipt.wireHash) || !nonempty(receipt.receiptId)
        || !Number.isFinite(receipt.acceptedAtMs) || receipt.acceptedAtMs < trace.acceptedAtMs)) { completed = false; critical.add('invalid_or_duplicate_delivery'); }
    if (expected.requiredDelivery === 'ACCEPTED') {
      if (!ids.length || trace.delivery.status !== 'ACCEPTED' || ids.some(id => !receipts.some(r => r.batchId === id))) { completed = false; errors.add('incomplete_delivery'); }
      else last = Math.max(last, ...receipts.map(r => r.acceptedAtMs));
    } else {
      if (ids.length || receipts.length) { completed = false; critical.add('unsolicited_delivery'); }
      // A deliberate no-delivery action can finish at a recorded non-provider terminal checkpoint.
      if (trace.modelWorkCompletedAtMs === null || trace.modelWorkCompletedAtMs < trace.acceptedAtMs) completed = false;
      else last = Math.max(last, trace.modelWorkCompletedAtMs);
    }
    if (!/^[0-9a-f]{40}$/.test(trace.versions.sourceCommit) || Object.entries(trace.versions).some(([key, value]) => key !== 'sourceCommit' && !hashPattern.test(value))) { errors.add('missing_version_provenance'); semantic = false; }
  }
  completed &&= Number.isFinite(first) && Number.isFinite(last) && last >= first;
  const deliveryRequired = row.turns.some(turn => turn.expect.requiredDelivery === 'ACCEPTED');
  return { scenarioId: row.id, repeat, cohort, cache, semanticCorrect: semantic, factsCorrect: facts, effectsCorrect: effects, completed,
    falseRefusalOrHandoff: falseRefusal, criticalErrors: [...critical], errorFamilies: [...errors], modelCalls: calls, costSatang: cost,
    deadlineMs: row.turns.reduce((sum, turn) => sum + turn.expect.deadlineMs, 0), deliveryRequired, completeAcceptedMs: completed && deliveryRequired ? last - first : null };
}

export type ReliabilityReplayAdapter = {
  provenance: 'fixture' | 'real_provider';
  /** Must initialize/reset an isolated source snapshot for each scenario/repeat; no shared customer state. */
  reset(row: ReliabilityFixture, repeat: number): Promise<void>;
  turn(row: ReliabilityFixture, turnIndex: number): Promise<ReliabilityTurnTrace>;
  /** The finalizer reads side effects even after a timeout/throw; unknown effects must not be scored safe. */
  afterFailure(row: ReliabilityFixture, turnIndex: number, error: unknown): Promise<ReliabilityTurnTrace | null>;
  /** Later continuation clicks may finish an earlier frozen delivery without another model call. */
  finalize?(row: ReliabilityFixture, traces: ReliabilityTurnTrace[]): Promise<void>;
};

/** Reuses the existing replay's sequential turn loop; exceptions never disappear from denominators. */
export async function replayReliabilityCorpus(corpus: ReliabilityCorpus, adapter: ReliabilityReplayAdapter, options: { repeats: number; cohort: ReliabilityAttempt['cohort']; cache: ReliabilityAttempt['cache']; acceptance?: boolean; stopOnError?: boolean }) {
  validateReliabilityCorpus(corpus, options.acceptance);
  assert.ok(Number.isInteger(options.repeats) && options.repeats >= 1 && options.repeats <= 10, 'INVALID_REPEATS');
  if (options.acceptance) { assert.ok(options.repeats >= 3, 'ACCEPTANCE_REPEATS'); assert.equal(adapter.provenance, 'real_provider', 'ACCEPTANCE_PROVIDER'); }
  const records: Array<{ scenarioId: string; repeat: number; traces: ReliabilityTurnTrace[]; error: string | null; attempt: ReliabilityAttempt }> = [];
  replay: for (let repeat = 0; repeat < options.repeats; repeat++) for (const row of corpus.fixtures) {
    const traces: ReliabilityTurnTrace[] = []; let error: string | null = null;
    try {
      await adapter.reset(row, repeat);
      for (let index = 0; index < row.turns.length; index++) {
        try { traces.push(await adapter.turn(row, index)); }
        catch (caught) {
          const evidence = await adapter.afterFailure(row, index, caught).catch(() => null);
          if (evidence) traces.push(evidence);
          throw caught;
        }
      }
    } catch { error = 'REPLAY_EXECUTION_FAILED'; }
    try { await adapter.finalize?.(row, traces); } catch { error = 'REPLAY_FINALIZATION_FAILED'; }
    let attempt: ReliabilityAttempt;
    try { attempt = scoreReliabilityTrace(row, traces, repeat, options.cohort, options.cache); }
    catch {
      // Malformed/truncated collector output is an observed failure, never a removed sample.
      error = 'REPLAY_TRACE_INVALID';
      attempt = { scenarioId: row.id, repeat, cohort: options.cohort, cache: options.cache, semanticCorrect: false,
        factsCorrect: false, effectsCorrect: false, completed: false, falseRefusalOrHandoff: false,
        criticalErrors: ['unverifiable_trace'], errorFamilies: [], modelCalls: 0, costSatang: null,
        deadlineMs: row.turns.reduce((sum, turn) => sum + turn.expect.deadlineMs, 0), completeAcceptedMs: null };
    }
    if (error) { attempt.completed = false; attempt.completeAcceptedMs = null; attempt.semanticCorrect = false; attempt.errorFamilies.push(error); if (!traces.length) attempt.costSatang = null; }
    records.push({ scenarioId: row.id, repeat, traces, error, attempt });
    if (error && options.stopOnError) break replay;
  }
  return { corpusDigest: reliabilityDigest(corpus), provenance: adapter.provenance, records };
}

export const reliabilityOracleDigest = (corpus: ReliabilityCorpus): string => reliabilityDigest(corpus.fixtures.map(row => ({ id: row.id, expected: row.turns.map(turn => turn.expect) })));

export type ReliabilityTraceBundle = {
  corpus: ReliabilityCorpus;
  run: Omit<ReliabilityRun, 'corpusDigest' | 'scenarios' | 'attempts'>;
  records: Array<{ scenarioId: string; repeat: number; cohort: ReliabilityAttempt['cohort']; cache: ReliabilityAttempt['cache']; traces: ReliabilityTurnTrace[] }>;
};

/** Existing replay CLI's evidence mode: score recorded real effects, not model self-evaluation. */
export function scoreReliabilityTraceBundle(bundle: ReliabilityTraceBundle): ReliabilityRun {
  validateReliabilityCorpus(bundle.corpus, bundle.run.provenance === 'real_provider');
  assert.equal(bundle.run.oracleDigest, reliabilityOracleDigest(bundle.corpus), 'TRACE_ORACLE_DIGEST_MISMATCH');
  const scenarios = bundle.corpus.fixtures.map(({ id, familyId, split, language, paraphrase, fixedRegression, group }) => ({ id, familyId, split, language, paraphrase, fixedRegression, group }));
  const attempts = bundle.records.map(record => {
    const row = bundle.corpus.fixtures.find(f => f.id === record.scenarioId); assert.ok(row, 'UNKNOWN_TRACE_SCENARIO');
    for (const trace of record.traces) {
      assert.equal(trace.versions.sourceCommit, bundle.run.sourceCommit, 'TRACE_SOURCE_COMMIT_MISMATCH');
      for (const [traceKey, runKey] of [['schema', 'schemaDigest'], ['prompt', 'promptDigest'], ['model', 'modelDigest'], ['price', 'tariffDigest']] as const) {
        assert.equal(trace.versions[traceKey], bundle.run[runKey], `TRACE_VERSION_MISMATCH:${traceKey}`);
      }
    }
    return scoreReliabilityTrace(row, record.traces, record.repeat, record.cohort, record.cache);
  });
  const run: ReliabilityRun = { ...bundle.run, corpusDigest: reliabilityDigest(bundle.corpus), scenarios, attempts };
  validateReliabilityRun(run); // Includes exact scenario×repeat denominator and duplicate rejection.
  return run;
}
