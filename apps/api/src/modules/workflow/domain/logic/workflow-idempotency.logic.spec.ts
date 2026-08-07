import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRunDedupKey,
  buildActionIdempotencyKey,
  isRuleInCooldown,
  isRetryExhausted,
  buildRuleVersionSnapshot,
} from './workflow-idempotency.logic';

const NOW = new Date('2026-07-01T12:00:00.000Z');

describe('buildRunDedupKey', () => {
  it('EVENT trigger dedup key is the source event dedupKey, stable across retries', () => {
    const a = buildRunDedupKey({ triggerType: 'EVENT', eventDedupKey: 'reimb-submit:req_1' });
    const b = buildRunDedupKey({ triggerType: 'EVENT', eventDedupKey: 'reimb-submit:req_1' });
    assert.equal(a, b);
  });

  it('EVENT trigger requires eventDedupKey', () => {
    assert.throws(() => buildRunDedupKey({ triggerType: 'EVENT' }));
  });

  it('SCAN triggers key on period + source so a scan cannot double-fire within a bucket', () => {
    const a = buildRunDedupKey({ triggerType: 'THRESHOLD_SCAN', periodKey: '2026-07-01', sourceType: 'product', sourceId: 'p1' });
    const b = buildRunDedupKey({ triggerType: 'THRESHOLD_SCAN', periodKey: '2026-07-01', sourceType: 'product', sourceId: 'p1' });
    const c = buildRunDedupKey({ triggerType: 'THRESHOLD_SCAN', periodKey: '2026-07-02', sourceType: 'product', sourceId: 'p1' });
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it('MANUAL_TEST keys are unique per call (test runs are never persisted/deduped)', () => {
    const a = buildRunDedupKey({ triggerType: 'MANUAL_TEST' });
    const b = buildRunDedupKey({ triggerType: 'MANUAL_TEST' });
    assert.notEqual(a, b);
  });
});

describe('buildActionIdempotencyKey', () => {
  it('is stable for the same run+action across retries (excludes attempt count)', () => {
    const k1 = buildActionIdempotencyKey('run_1', 'notify');
    const k2 = buildActionIdempotencyKey('run_1', 'notify');
    assert.equal(k1, k2);
  });

  it('differs per action within the same run', () => {
    assert.notEqual(buildActionIdempotencyKey('run_1', 'notify'), buildActionIdempotencyKey('run_1', 'task'));
  });
});

describe('isRuleInCooldown', () => {
  it('is false when there is no prior run', () => {
    assert.equal(isRuleInCooldown(undefined, 3600, NOW), false);
  });

  it('is true within the cooldown window', () => {
    const lastRunAt = new Date(NOW.getTime() - 10_000);
    assert.equal(isRuleInCooldown(lastRunAt, 3600, NOW), true);
  });

  it('is false after the cooldown window elapses', () => {
    const lastRunAt = new Date(NOW.getTime() - 3601_000);
    assert.equal(isRuleInCooldown(lastRunAt, 3600, NOW), false);
  });
});

describe('isRetryExhausted', () => {
  it('flips to true once attemptCount reaches maxAttempts', () => {
    assert.equal(isRetryExhausted(2, 3), false);
    assert.equal(isRetryExhausted(3, 3), true);
  });
});

describe('buildRuleVersionSnapshot', () => {
  it('deep-clones so later mutation of the source rule does not affect the snapshot', () => {
    const rule = {
      triggerConfigJson: { eventType: 'x' },
      conditionJson: { field: 'a', op: 'EXISTS' as const },
      actionJson: [{ actionKey: 'n', actionType: 'SEND_NOTIFICATION' as const, configJson: {} }],
      recipientConfigJson: { roles: ['OWNER'] },
      cooldownSeconds: 3600,
    };
    const snapshot = buildRuleVersionSnapshot(rule);
    rule.triggerConfigJson.eventType = 'mutated';
    (rule.recipientConfigJson.roles as string[]).push('ADMIN');
    assert.equal(snapshot.triggerSnapshotJson.eventType, 'x');
    assert.deepEqual(snapshot.recipientSnapshotJson.roles, ['OWNER']);
  });
});
