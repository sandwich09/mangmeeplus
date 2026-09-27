import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  AI_BUDGET_ESTIMATOR_VERSION_V2,
  AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
  AI_BUDGET_PROFILE_TABLE_VERSION_V2,
  AI_BUDGET_PROFILES_V2,
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
  estimatorVersion: 'utf8-v2',
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
  assert.equal(parseAiBudgetEnvelopeV2({ ...envelope(), inputTokenBound: 160_001 }), undefined);
  assert.equal(parseAiBudgetEnvelopeV2({ ...envelope(), ordinal: 2, invocationKey: 'company-1#attempt-1#provider-v2#2' })?.ordinal, 2);
  assert.equal(parseAiBudgetEnvelopeV2({ ...envelope(), invocationKey: 'company-2#attempt-1#provider-v2#0' }), undefined);
  assert.equal(parseAiBudgetEnvelopeV2({ ...envelope(), reservationId: 'reservation-1', unreviewed: true }), undefined);
});
