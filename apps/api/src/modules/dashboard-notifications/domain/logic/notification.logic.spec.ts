import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDedupKey,
  computeCooldownUntil,
  isChannelEligible,
  isImplementedTrigger,
  isInCooldown,
  isInQuietHours,
  isRetryableDeliveryError,
  computeDeliveryBackoffAt,
  getPeriodBoundaries,
  resolveDeliveryOutcome,
  notificationSourceHref,
} from './notification.logic';
import { ALWAYS_DELIVERED_TRIGGER_KEYS, MAX_DELIVERY_ATTEMPTS, IMPLEMENTED_TRIGGER_KEYS } from '../models/notification.model';
import { WORKFLOW_TEMPLATE_CATALOG } from '../../../workflow/domain/workflow-template-catalog';

describe('notification source links', () => {
  it('opens the exact persisted report export without substituting another report', () => {
    assert.equal(notificationSourceHref({ companyId: 'co', sourceType: 'report_export', sourceId: 'old-id', deepLinkHref: '/companies/co/reports' }), '/companies/co/reports?exportId=old-id');
    assert.equal(notificationSourceHref({ companyId: 'co', sourceType: 'expense', sourceId: 'exp', deepLinkHref: '/companies/co/expenses/exp' }), '/companies/co/expenses/exp');
  });
});

describe('implemented-trigger gate (LINE preference suppression)', () => {
  // ProcessQueuedDeliveryUseCase falls back to IMPLEMENTED_TRIGGER_KEYS when a user has no
  // preference row and suppresses any triggerKey outside the enabled list — a workflow key
  // missing here means the LINE push is dropped before it ever reaches LINE.
  it('passes every notification triggerKey the auto-enabled workflow templates emit', () => {
    const workflowTriggerKeys = WORKFLOW_TEMPLATE_CATALOG
      .filter((template) => template.autoEnable)
      .flatMap((template) => template.defaultActionJson)
      .filter((action) => action.actionType === 'SEND_NOTIFICATION')
      .map((action) => String(action.configJson['triggerKey']));

    assert.equal(workflowTriggerKeys.length, 13);
    for (const key of workflowTriggerKeys) {
      assert.equal(isImplementedTrigger(key), true, key);
    }
  });

  // Payout spec §8.5 (AC45): letting anyone else set a member's payout account is conditional on the
  // account owner being told. A key outside the implemented list would be dropped before LINE.
  it('delivers the notice that someone else set a member payout account', () => {
    assert.equal(isImplementedTrigger('reimbursement.payout_account_set_by_other'), true);
    // Not droppable by a preference list saved before the trigger existed; every such key is a real trigger.
    assert.ok(ALWAYS_DELIVERED_TRIGGER_KEYS.includes('reimbursement.payout_account_set_by_other'));
    assert.ok(ALWAYS_DELIVERED_TRIGGER_KEYS.every((key) => IMPLEMENTED_TRIGGER_KEYS.includes(key)));
  });

  // The list is short on purpose: every key on it overrides a person's saved trigger list. Adding one
  // is a decision, so the whole list is pinned here.
  it('always delivers exactly the six claim notices a saved preference list must not drop', () => {
    assert.deepEqual(ALWAYS_DELIVERED_TRIGGER_KEYS, [
      'reimbursement.payout_account_set_by_other',
      // Audit B9: a voided payment (to the requester) and a claim waiting past the deadline (to whoever can pay).
      'workflow.reimbursement_payment_voided',
      'workflow.reimbursement_finance_blocked_requester',
      'workflow.reimbursement_payment_sla_breach',
      // Payout spec §14: a claim held back until its payout account is corrected (to the requester), and
      // the corrected account waiting for approval (to the approvers of the new step).
      'workflow.reimbursement_payout_correction_requested',
      'workflow.reimbursement_payout_correction_submitted',
    ]);
    // Each workflow key on it is one an auto-enabled template's notice really carries.
    const emitted = WORKFLOW_TEMPLATE_CATALOG.filter((template) => template.autoEnable)
      .flatMap((template) => template.defaultActionJson).map((action) => String(action.configJson['triggerKey']));
    for (const key of ALWAYS_DELIVERED_TRIGGER_KEYS.filter((entry) => entry.startsWith('workflow.'))) assert.ok(emitted.includes(key), key);
  });

  it('keeps the pre-existing implemented keys', () => {
    for (const key of ['daily_owner_summary', 'stock_low', 'crm_sla_breach', 'crm_new_conversation', 'crm_payment_proof', 'crm_booking_reminder']) {
      assert.ok(IMPLEMENTED_TRIGGER_KEYS.includes(key), key);
    }
    assert.equal(isImplementedTrigger('not_a_real_trigger'), false);
  });
});

describe('notification.logic', () => {
  it('builds stable dedup key from tenant, trigger, source, and period', () => {
    assert.equal(
      buildDedupKey({
        companyId: 'c1',
        triggerKey: 'stock_low',
        sourceModule: 'inventory',
        sourceType: 'product',
        sourceId: 'p1',
        periodKey: '2026-06-25',
      }),
      'c1:stock_low:inventory:product:p1:2026-06-25',
    );
  });

  it('keeps repeated event inside cooldown', () => {
    const now = new Date('2026-06-25T10:00:00.000Z');
    assert.equal(isInCooldown(computeCooldownUntil(30, now), new Date('2026-06-25T10:20:00.000Z')), true);
    assert.equal(isInCooldown(computeCooldownUntil(30, now), new Date('2026-06-25T10:31:00.000Z')), false);
  });

  it('suppresses non-critical LINE during overnight quiet hours only', () => {
    const quietNow = new Date('2026-06-25T16:30:00.000Z'); // 23:30 Asia/Bangkok
    assert.equal(isInQuietHours(quietNow, '22:00', '07:00', 'Asia/Bangkok'), true);
    assert.equal(isChannelEligible('line', 'action', ['web', 'line'], true), false);
    assert.equal(isChannelEligible('line', 'critical', ['web', 'line'], true), true);
  });
});

describe('Bangkok dashboard period boundaries', () => {
  it('moves the day boundary at Bangkok midnight, not UTC midnight', () => {
    const before = getPeriodBoundaries('today', new Date('2026-07-12T16:59:59.999Z'));
    const after = getPeriodBoundaries('today', new Date('2026-07-12T17:00:00.000Z'));
    assert.deepEqual([before.periodStart.toISOString(), before.periodEnd.toISOString()], ['2026-07-11T17:00:00.000Z', '2026-07-12T16:59:59.999Z']);
    assert.deepEqual([after.periodStart.toISOString(), after.periodEnd.toISOString()], ['2026-07-12T17:00:00.000Z', '2026-07-13T16:59:59.999Z']);
  });

  it('keeps the dashboard week Monday-Sunday in Bangkok', () => {
    const sunday = getPeriodBoundaries('week', new Date('2026-07-12T16:59:59.999Z'));
    const monday = getPeriodBoundaries('week', new Date('2026-07-12T17:00:00.000Z'));
    assert.deepEqual([sunday.periodStart.toISOString(), sunday.periodEnd.toISOString()], ['2026-07-05T17:00:00.000Z', '2026-07-12T16:59:59.999Z']);
    assert.deepEqual([monday.periodStart.toISOString(), monday.periodEnd.toISOString()], ['2026-07-12T17:00:00.000Z', '2026-07-19T16:59:59.999Z']);
  });

  it('moves the month boundary at Bangkok midnight', () => {
    const july = getPeriodBoundaries('month', new Date('2026-07-31T16:59:59.999Z'));
    const august = getPeriodBoundaries('month', new Date('2026-07-31T17:00:00.000Z'));
    assert.deepEqual([july.periodStart.toISOString(), july.periodEnd.toISOString()], ['2026-06-30T17:00:00.000Z', '2026-07-31T16:59:59.999Z']);
    assert.deepEqual([august.periodStart.toISOString(), august.periodEnd.toISOString()], ['2026-07-31T17:00:00.000Z', '2026-08-31T16:59:59.999Z']);
  });
});

describe('delivery retry/backoff (A4)', () => {
  it('classifies transient vs terminal delivery errors', () => {
    assert.equal(isRetryableDeliveryError('RATE_LIMIT'), true);
    assert.equal(isRetryableDeliveryError('NETWORK_ERROR'), true);
    assert.equal(isRetryableDeliveryError('HTTP_500'), true);
    assert.equal(isRetryableDeliveryError('HTTP_503'), true);
    assert.equal(isRetryableDeliveryError('HTTP_401'), false); // bad token — terminal
    assert.equal(isRetryableDeliveryError('HTTP_400'), false);
    assert.equal(isRetryableDeliveryError('NO_LINE_DELIVERY_TARGET'), false);
    assert.equal(isRetryableDeliveryError(undefined), false);
    assert.equal(isRetryableDeliveryError(null), false);
  });

  it('backoff grows exponentially from 30s and caps at 1h', () => {
    const from = new Date('2026-07-09T00:00:00.000Z');
    assert.equal(computeDeliveryBackoffAt(0, from).getTime() - from.getTime(), 30_000);
    assert.equal(computeDeliveryBackoffAt(1, from).getTime() - from.getTime(), 60_000);
    assert.equal(computeDeliveryBackoffAt(2, from).getTime() - from.getTime(), 120_000);
    assert.equal(computeDeliveryBackoffAt(10, from).getTime() - from.getTime(), 3_600_000); // capped
  });

  it('resolveDeliveryOutcome: non-failed statuses pass through unchanged', () => {
    const now = new Date();
    assert.deepEqual(resolveDeliveryOutcome({ resultStatus: 'sent', attemptCountAfter: 1, maxAttempts: MAX_DELIVERY_ATTEMPTS, now }), { status: 'sent' });
    assert.deepEqual(resolveDeliveryOutcome({ resultStatus: 'suppressed', attemptCountAfter: 1, maxAttempts: MAX_DELIVERY_ATTEMPTS, now }), { status: 'suppressed' });
    assert.deepEqual(resolveDeliveryOutcome({ resultStatus: 'skipped', attemptCountAfter: 1, maxAttempts: MAX_DELIVERY_ATTEMPTS, now }), { status: 'skipped' });
  });

  it('resolveDeliveryOutcome: retryable failure with attempts left requeues with backoff', () => {
    const now = new Date('2026-07-09T00:00:00.000Z');
    const out = resolveDeliveryOutcome({ resultStatus: 'failed', errorCode: 'RATE_LIMIT', attemptCountAfter: 2, maxAttempts: 5, now });
    assert.equal(out.status, 'queued');
    assert.equal(out.nextAttemptAt?.getTime(), computeDeliveryBackoffAt(2, now).getTime());
  });

  it('resolveDeliveryOutcome: exhausted retries go terminal FAILED', () => {
    const now = new Date();
    assert.deepEqual(resolveDeliveryOutcome({ resultStatus: 'failed', errorCode: 'RATE_LIMIT', attemptCountAfter: 5, maxAttempts: 5, now }), { status: 'failed' });
  });

  it('resolveDeliveryOutcome: non-retryable failure goes terminal FAILED even with attempts left', () => {
    const now = new Date();
    assert.deepEqual(resolveDeliveryOutcome({ resultStatus: 'failed', errorCode: 'HTTP_401', attemptCountAfter: 1, maxAttempts: 5, now }), { status: 'failed' });
  });
});
