import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGNUP_CLAIM_EMAIL_DRAIN_OPTIONS,
  SIGNUP_CLAIM_REMINDER_OPTIONS,
} from './signup-claim-email-worker.js';

describe('signup claim email workers', () => {
  it('drains the claim-email outbox every 30s', () => {
    assert.deepEqual(SIGNUP_CLAIM_EMAIL_DRAIN_OPTIONS, {
      queueName: 'signup-claim-email',
      kind: 'signup-claim-email-drain',
      jobId: 'signup-claim-email-drain',
      intervalMs: 30_000,
      path: '/internal/signup-claim-email/drain',
      failEvent: 'signup_claim_email_drain_failed',
    });
  });

  it('sweeps reminders every 15 min', () => {
    assert.deepEqual(SIGNUP_CLAIM_REMINDER_OPTIONS, {
      queueName: 'signup-claim-reminder',
      kind: 'signup-claim-reminder-sweep',
      jobId: 'signup-claim-reminder-sweep',
      intervalMs: 15 * 60_000,
      path: '/internal/signup-claim-email/reminder-sweep',
      failEvent: 'signup_claim_reminder_sweep_failed',
    });
  });

  it('keeps the two timers on separate queues and job ids', () => {
    // Sharing a jobId would make BullMQ's scheduler upsert one over the other, silently
    // leaving only one of the two timers running.
    assert.notEqual(SIGNUP_CLAIM_EMAIL_DRAIN_OPTIONS.queueName, SIGNUP_CLAIM_REMINDER_OPTIONS.queueName);
    assert.notEqual(SIGNUP_CLAIM_EMAIL_DRAIN_OPTIONS.jobId, SIGNUP_CLAIM_REMINDER_OPTIONS.jobId);
  });

  it('sweeps far more often than the 24h reminder window it guards', () => {
    assert.ok(SIGNUP_CLAIM_REMINDER_OPTIONS.intervalMs < 24 * 60 * 60_000);
  });
});
