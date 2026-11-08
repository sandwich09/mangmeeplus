import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  AI_BUDGET_ESTIMATOR_VERSION_V2,
  AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
  AI_BUDGET_PROFILE_TABLE_VERSION_V2,
  AI_BUDGET_PROFILES_V2,
  aiBudgetV2CallAllowed,
  aiBudgetV2OrdinalCeiling,
  aiBudgetV2RepairsBefore,
  parseAiBudgetEnvelopeV2,
  parseAiBudgetGrantV2,
} from './ai-budget-bounds.js';

const hash = 'a'.repeat(64);

test('v2 profile table digest matches its canonical frozen table', () => {
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sort(item)]))
      : value;
  const canonical = JSON.stringify(sort({
    version: AI_BUDGET_PROFILE_TABLE_VERSION_V2,
    estimatorVersion: AI_BUDGET_ESTIMATOR_VERSION_V2,
    profiles: AI_BUDGET_PROFILES_V2,
  }));
  assert.equal(createHash('sha256').update(canonical).digest('hex'), AI_BUDGET_PROFILE_TABLE_DIGEST_V2);
});
const grant = () => ({
  version: 2,
  turnKey: 'turn-1',
  authorityKind: 'webhook_event',
  authorityId: 'event-1',
  channelOwnerDigest: hash,
  attemptKey: 'attempt-1',
  monthKey: '2026-09',
  payerCompanyId: 'company-1',
  model: { provider: 'bedrock', modelId: 'apac.anthropic.claude-3-haiku-20240307-v1:0', region: 'ap-southeast-1' },
  allowedProfileIds: ['line-intake-text/2'],
  profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
  maxTurnSlots: 4,
  maxRepairs: 1,
  admittedAtMs: 100,
  workDeadlineAtMs: 10_000,
  finalDeadlineAtMs: 20_000,
  nonce: 'nonce-1',
  issuerVersion: 'api-1',
  signature: hash,
});

const envelope = () => ({
  version: 2,
  grant: grant(),
  ordinal: 0,
  profileId: 'line-intake-text/2',
  inputTokenBound: 5_120,
  requestedOutputTokens: 1_536,
  estimatorVersion: 'utf8-split-prefix-v4',
  promptVersion: 'line-intake-v2',
  payloadDigest: hash,
  schemaDigest: hash,
  inputDigest: hash,
  reservationId: 'reservation-1',
  invocationKey: 'company-1#attempt-1#provider-v2#0',
  tariffVersion: 'thb-usd-2026-09',
});

test('v2 budget grant parser pins the immutable profile table and rejects widening fields', () => {
  assert.equal(parseAiBudgetGrantV2(grant())?.profileTableDigest, AI_BUDGET_PROFILE_TABLE_DIGEST_V2);
  assert.equal(parseAiBudgetGrantV2({ ...grant(), profileTableDigest: hash }), undefined);
  assert.equal(parseAiBudgetGrantV2({ ...grant(), unreviewed: true }), undefined);
  assert.equal(parseAiBudgetGrantV2({ ...grant(), model: { ...grant().model, extra: 'ignored?' } }), undefined);
});

test('v2 invocation parser binds exact profile, ordinal, grant and invocation limits', () => {
  assert.equal(parseAiBudgetEnvelopeV2(envelope())?.inputTokenBound, 5_120);
  assert.equal(parseAiBudgetEnvelopeV2({ ...envelope(), estimatorVersion: 'utf8-v2' }), undefined);
  assert.equal(parseAiBudgetEnvelopeV2({ ...envelope(), inputTokenBound: 160_001 }), undefined);
  assert.equal(parseAiBudgetEnvelopeV2({ ...envelope(), ordinal: 2, invocationKey: 'company-1#attempt-1#provider-v2#2' })?.ordinal, 2);
  assert.equal(parseAiBudgetEnvelopeV2({ ...envelope(), invocationKey: 'company-2#attempt-1#provider-v2#0' }), undefined);
  assert.equal(parseAiBudgetEnvelopeV2({ ...envelope(), reservationId: 'reservation-1', unreviewed: true }), undefined);
});

// UAT 2026-09-29 ("สวัสดีจ้า"): the intake's repair spent a general turn's only answer slot, so compose was
// refused with zero model calls. A repair never spends an answer slot, in every lane a repair can precede it.
test('a repair never spends an answer slot, in every lane where one can precede the answer', () => {
  for (const [lane, maxTurnSlots] of [['general', 2], ['simple', 2], ['mixed', 4], ['public', 4]] as const) {
    const lanes = { authorityKind: 'webhook_event' as const, maxTurnSlots, maxRepairs: 1 as const };
    assert.equal(aiBudgetV2OrdinalCeiling(lanes), maxTurnSlots + 1, lane);
    assert.equal(aiBudgetV2CallAllowed(lanes, 0, false, 0), true, `${lane}: intake`);
    assert.equal(aiBudgetV2CallAllowed(lanes, 1, true, 0), true, `${lane}: intake repair`);
    assert.equal(aiBudgetV2CallAllowed(lanes, 2, false, 1), true, `${lane}: the answer after the intake repair`);
    assert.equal(aiBudgetV2CallAllowed(lanes, maxTurnSlots, false, 1), true, `${lane}: the last answer slot after the repair`);
    assert.equal(aiBudgetV2CallAllowed(lanes, maxTurnSlots + 1, false, 1), false, `${lane}: no slot beyond the lane`);
    assert.equal(aiBudgetV2CallAllowed(lanes, 3, true, 1), false, `${lane}: one repair per turn`);
    assert.equal(aiBudgetV2CallAllowed(lanes, maxTurnSlots, false, 0), false, `${lane}: without a repair the lane stays capped`);
    assert.equal(aiBudgetV2CallAllowed(lanes, maxTurnSlots, true, 0), true, `${lane}: an answer repair when the intake had none`);
  }
  // QA keeps its whole-task two-dispatch ceiling: intake1+QA1 or QA1+repair1, never three.
  const qa = { authorityKind: 'qa_job' as const, maxTurnSlots: 2 as const, maxRepairs: 1 as const };
  assert.equal(aiBudgetV2OrdinalCeiling(qa), 2);
  assert.equal(aiBudgetV2CallAllowed(qa, 1, true, 0), true);
  assert.equal(aiBudgetV2CallAllowed(qa, 2, false, 1), false);
  // What a runtime holding only the narrowed grant can tell about the intake's repair.
  assert.equal(aiBudgetV2RepairsBefore({ authorityKind: 'webhook_event', nextOrdinal: 2, maxRepairs: 1 }), 1);
  assert.equal(aiBudgetV2RepairsBefore({ authorityKind: 'webhook_event', nextOrdinal: 1, maxRepairs: 1 }), 0);
  assert.equal(aiBudgetV2RepairsBefore({ authorityKind: 'webhook_event', nextOrdinal: 0, maxRepairs: 1 }), 0);
  assert.equal(aiBudgetV2RepairsBefore({ authorityKind: 'qa_job', nextOrdinal: 1, maxRepairs: 1 }), 0);
  // The envelope admits the answer's ordinal past a repair, and nothing beyond the lane's ceiling.
  const general = { ...grant(), maxTurnSlots: 2, allowedProfileIds: ['line-answer/2'] };
  const answer = (ordinal: number) => ({ ...envelope(), grant: general, profileId: 'line-answer/2', ordinal,
    invocationKey: `company-1#attempt-1#provider-v2#${ordinal}` });
  assert.equal(parseAiBudgetEnvelopeV2(answer(2))?.ordinal, 2);
  assert.equal(parseAiBudgetEnvelopeV2(answer(3)), undefined);
});

test('classify has its own two-call profile and authority without changing turn slots', () => {
  assert.deepEqual(AI_BUDGET_PROFILES_V2['line-classify/2'], {
    maxInputTokens: 24_576, maxOutputTokens: 1_024, maxCalls: 2,
  });
  const classified = parseAiBudgetGrantV2({ ...grant(), authorityKind: 'webhook_classify',
    allowedProfileIds: ['line-classify/2'], maxTurnSlots: 2 });
  assert.ok(classified);
  assert.equal(classified.authorityKind, 'webhook_classify');
  assert.equal(aiBudgetV2OrdinalCeiling(classified), 3);
  assert.equal(aiBudgetV2OrdinalCeiling(parseAiBudgetGrantV2(grant())!), 5);
  const invocation = { ...envelope(), grant: classified, profileId: 'line-classify/2', requestedOutputTokens: 1024 };
  assert.ok(parseAiBudgetEnvelopeV2(invocation));
  assert.equal(parseAiBudgetEnvelopeV2({ ...invocation, inputTokenBound: 24_577 }), undefined);
  assert.equal(parseAiBudgetEnvelopeV2({ ...invocation, requestedOutputTokens: 1025 }), undefined);
});
