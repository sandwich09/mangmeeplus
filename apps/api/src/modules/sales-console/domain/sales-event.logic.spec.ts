import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SalesEventBatchInput } from '@watchdog-bms/contracts';
import {
  batchActionReason, batchClaimOpen, eventDiscountUnitAmountSatang, firstOfferBelowMinimum, nextBatchState,
  SALES_EVENT_MIN_UNIT_AMOUNT_SATANG, SalesEventRuleError, scopeFromJson, ticketCounts,
  validateSalesEventBatch,
} from './sales-event.logic';

const NOW = new Date('2026-10-01T02:00:00.000Z'); // 09:00 Bangkok

function input(overrides: Partial<SalesEventBatchInput> = {}): SalesEventBatchInput {
  return {
    eventName: '  งานแฟร์ร้านค้า 2569 ', batchName: 'บูธ A',
    discountSatang: 10000, rewardChatCreditUnits: 5000, rewardReceiptImageUnits: 20,
    issueCap: 100,
    // The web sends `${datetime-local}+07:00` as an ISO instant.
    claimStartsAt: new Date('2026-10-01T09:00+07:00').toISOString(),
    claimEndsAt: new Date('2026-10-03T18:00+07:00').toISOString(),
    scope: { tiers: ['PRO_999', 'STARTER_249', 'STARTER_249'], intervals: ['year', 'month'] },
    agentUserIds: ['agent-1', ' agent-2 ', 'agent-1'],
    ...overrides,
  };
}

function code(run: () => unknown): string {
  try {
    run();
    return 'no-error';
  } catch (error) {
    return error instanceof SalesEventRuleError ? error.code : (error as Error).message;
  }
}

describe('batch form (spec §3.1, SD-E01)', () => {
  it('normalises names, scope order and the seller list', () => {
    const value = validateSalesEventBatch(input(), NOW);
    assert.equal(value.eventName, 'งานแฟร์ร้านค้า 2569');
    assert.deepEqual(value.scope, { tiers: ['STARTER_249', 'PRO_999'], intervals: ['month', 'year'] });
    assert.deepEqual(value.agentUserIds, ['agent-1', 'agent-2']);
    // Thai time in, UTC instant stored: 09:00 +07:00 is 02:00Z.
    assert.equal(value.claimStartsAt.toISOString(), '2026-10-01T02:00:00.000Z');
  });

  it('takes whole baht and whole AI credits only, never negative', () => {
    assert.equal(code(() => validateSalesEventBatch(input({ discountSatang: 10050 }), NOW)), 'SALES_EVENT_BATCH_INVALID');
    assert.equal(code(() => validateSalesEventBatch(input({ rewardChatCreditUnits: 150 }), NOW)), 'SALES_EVENT_BATCH_INVALID');
    assert.equal(code(() => validateSalesEventBatch(input({ rewardReceiptImageUnits: -1 }), NOW)), 'SALES_EVENT_BATCH_INVALID');
    assert.equal(code(() => validateSalesEventBatch(input({ discountSatang: 2_147_483_700 }), NOW)), 'SALES_EVENT_BATCH_INVALID');
  });

  // Owner 2026-09-29: credit for shops that already pay is withdrawn for now, so a batch needs a discount.
  it('needs a discount above zero, says so in plain Thai, and no longer takes credit alone', () => {
    const none = { discountSatang: 0, rewardChatCreditUnits: 0, rewardReceiptImageUnits: 0 };
    assert.equal(code(() => validateSalesEventBatch(input(none), NOW)), 'SALES_EVENT_REWARD_REQUIRED');
    assert.equal(code(() => validateSalesEventBatch(input({ ...none, rewardChatCreditUnits: 100 }), NOW)), 'SALES_EVENT_REWARD_REQUIRED');
    assert.equal(code(() => validateSalesEventBatch(input({ ...none, rewardReceiptImageUnits: 1 }), NOW)), 'SALES_EVENT_REWARD_REQUIRED');
    assert.throws(() => validateSalesEventBatch(input(none), NOW), { message: 'ใส่ส่วนลดมากกว่า 0 บาท' });
    assert.equal(code(() => validateSalesEventBatch(input({ ...none, discountSatang: 5000 }), NOW)), 'no-error');
    // The credit columns stay: a value already stored rides along with a discount, untouched.
    const kept = validateSalesEventBatch(input({ discountSatang: 5000, rewardChatCreditUnits: 5000, rewardReceiptImageUnits: 20 }), NOW);
    assert.deepEqual([kept.rewardChatCreditUnits, kept.rewardReceiptImageUnits], [5000, 20]);
  });

  it('refuses empty or over-long names and a cap below one', () => {
    assert.equal(code(() => validateSalesEventBatch(input({ eventName: '   ' }), NOW)), 'SALES_EVENT_BATCH_INVALID');
    assert.equal(code(() => validateSalesEventBatch(input({ batchName: 'ก'.repeat(121) }), NOW)), 'SALES_EVENT_BATCH_INVALID');
    assert.equal(code(() => validateSalesEventBatch(input({ issueCap: 0 }), NOW)), 'SALES_EVENT_BATCH_INVALID');
  });

  it('keeps the window [start, end) in order and its end in the future', () => {
    const at = (text: string) => new Date(text).toISOString();
    assert.equal(code(() => validateSalesEventBatch(input({ claimEndsAt: at('2026-10-01T09:00+07:00') }), NOW)), 'SALES_EVENT_BATCH_INVALID');
    assert.equal(code(() => validateSalesEventBatch(input({
      claimStartsAt: at('2026-09-30T09:00+07:00'), claimEndsAt: at('2026-10-01T08:59+07:00'),
    }), NOW)), 'SALES_EVENT_BATCH_INVALID');
    assert.equal(code(() => validateSalesEventBatch(input({ claimStartsAt: 'yesterday' }), NOW)), 'SALES_EVENT_BATCH_INVALID');
    // A start already in the past is fine: "open from now".
    assert.equal(code(() => validateSalesEventBatch(input({ claimStartsAt: at('2026-09-30T09:00+07:00') }), NOW)), 'no-error');
  });

  it('on an edit, keeps the cap at or above what was handed out and lets a closed batch keep its end', () => {
    const closedEnd = new Date('2026-09-30T11:00:00.000Z');
    const current = { issuedCount: 40, claimEndsAt: closedEnd };
    const edit = input({ claimStartsAt: '2026-09-29T02:00:00.000Z', claimEndsAt: closedEnd.toISOString() });
    assert.equal(code(() => validateSalesEventBatch({ ...edit, issueCap: 39 }, NOW, current)), 'SALES_EVENT_BATCH_INVALID');
    assert.equal(code(() => validateSalesEventBatch({ ...edit, issueCap: 40 }, NOW, current)), 'no-error');
    // Moving the end of a closed batch must move it into the future.
    assert.equal(code(() => validateSalesEventBatch({ ...edit, claimEndsAt: '2026-09-30T12:00:00.000Z' }, NOW, current)), 'SALES_EVENT_BATCH_INVALID');
  });

  it('needs a package and a cycle for the discount', () => {
    const empty = { tiers: [], intervals: [] };
    assert.equal(code(() => validateSalesEventBatch(input({ scope: empty }), NOW)), 'SALES_EVENT_BATCH_INVALID');
    assert.equal(code(() => validateSalesEventBatch(input({ scope: { tiers: ['STARTER_249'], intervals: [] } }), NOW)), 'SALES_EVENT_BATCH_INVALID');
    assert.equal(code(() => validateSalesEventBatch(input({ scope: { tiers: ['FREE_TRIAL_15' as never], intervals: ['month'] } }), NOW)),
      'SALES_EVENT_BATCH_INVALID');
  });

  it('needs at least one seller', () => {
    assert.equal(code(() => validateSalesEventBatch(input({ agentUserIds: [] }), NOW)), 'SALES_EVENT_BATCH_INVALID');
    assert.equal(code(() => validateSalesEventBatch(input({ agentUserIds: ['  '] }), NOW)), 'SALES_EVENT_BATCH_INVALID');
  });
});

describe('batch state machine (spec §6.2)', () => {
  it('allows exactly the four documented transitions', () => {
    assert.equal(nextBatchState('OPEN', 'PAUSE'), 'PAUSED');
    assert.equal(nextBatchState('PAUSED', 'RESUME'), 'OPEN');
    assert.equal(nextBatchState('OPEN', 'SUSPEND'), 'SUSPENDED');
    assert.equal(nextBatchState('PAUSED', 'SUSPEND'), 'SUSPENDED');
    // Lifting a suspension lands on PAUSED; reopening the claim is a separate decision.
    assert.equal(nextBatchState('SUSPENDED', 'LIFT'), 'PAUSED');
    for (const [state, action] of [['OPEN', 'RESUME'], ['OPEN', 'LIFT'], ['PAUSED', 'PAUSE'], ['PAUSED', 'LIFT'],
      ['SUSPENDED', 'RESUME'], ['SUSPENDED', 'PAUSE'], ['SUSPENDED', 'SUSPEND'], ['CLOSED', 'PAUSE']] as const) {
      assert.equal(nextBatchState(state, action), null, `${state} + ${action}`);
    }
  });

  it('requires a reason to suspend or lift, and keeps an optional one for pause/resume', () => {
    assert.equal(code(() => batchActionReason('SUSPEND', '  ')), 'SALES_EVENT_BATCH_INVALID');
    assert.equal(code(() => batchActionReason('LIFT', undefined)), 'SALES_EVENT_BATCH_INVALID');
    assert.equal(batchActionReason('SUSPEND', ' พบการแจกผิดงาน '), 'พบการแจกผิดงาน');
    assert.equal(batchActionReason('PAUSE', undefined), null);
    assert.equal(code(() => batchActionReason('PAUSE', 'ก'.repeat(501))), 'SALES_EVENT_BATCH_INVALID');
  });
});

describe('the claim window a QR works in (spec §3.2, SD-E02, SD-O11)', () => {
  const batch = { state: 'OPEN', claimStartsAt: new Date('2026-10-01T02:00:00.000Z'), claimEndsAt: new Date('2026-10-01T10:00:00.000Z') };

  it('is open only while OPEN inside [start, end)', () => {
    assert.equal(batchClaimOpen(batch, new Date('2026-10-01T01:59:59.999Z')), false);
    assert.equal(batchClaimOpen(batch, batch.claimStartsAt), true);
    assert.equal(batchClaimOpen(batch, new Date('2026-10-01T09:59:59.999Z')), true);
    assert.equal(batchClaimOpen(batch, batch.claimEndsAt), false);
    assert.equal(batchClaimOpen({ ...batch, state: 'PAUSED' }, new Date('2026-10-01T05:00:00.000Z')), false);
    assert.equal(batchClaimOpen({ ...batch, state: 'SUSPENDED' }, new Date('2026-10-01T05:00:00.000Z')), false);
  });
});

describe('first-bill price and the ฿10 floor (spec §4.5, §5.1, SD-E14)', () => {
  it('matches the spec table for ฿499 less ฿100 under all three tax treatments', () => {
    assert.equal(eventDiscountUnitAmountSatang(49900, 10000, 'NOT_VAT_REGISTERED'), 39900);
    assert.equal(eventDiscountUnitAmountSatang(49900, 10000, 'EXCLUSIVE_VAT_7'), 39900);
    // INCLUSIVE: subtotal 46636 − 10000 = 36636, plus round(0.07 × 36636) = 2565 → 39201 (฿392.01).
    assert.equal(eventDiscountUnitAmountSatang(49900, 10000, 'INCLUSIVE_VAT_7'), 39201);
    // No policy yet (billing disabled) prices like NOT_VAT: the card price minus the discount.
    assert.equal(eventDiscountUnitAmountSatang(49900, 10000, null), 39900);
  });

  it('names the first package and cycle in scope that would fall under ฿10', () => {
    const offers = [
      { offerKey: 'STARTER_249', interval: 'month', priceSatang: 24900 },
      { offerKey: 'STARTER_249', interval: 'year', priceSatang: 249000 },
      { offerKey: 'BASIC_499', interval: 'month', priceSatang: 49900 },
    ];
    const everything = { tiers: ['STARTER_249', 'BASIC_499'] as const, intervals: ['month', 'year'] as const };
    const scope = { tiers: [...everything.tiers], intervals: [...everything.intervals] };
    assert.equal(SALES_EVENT_MIN_UNIT_AMOUNT_SATANG, 1000);
    // Exactly ฿10 left is allowed; one baht more discount is not.
    assert.equal(firstOfferBelowMinimum(offers, scope, 23900, 'NOT_VAT_REGISTERED'), null);
    assert.deepEqual(firstOfferBelowMinimum(offers, scope, 24000, 'NOT_VAT_REGISTERED'), { offerKey: 'STARTER_249', interval: 'month' });
    // Out of scope does not block: the lead removed the cheap package from the discount.
    assert.equal(firstOfferBelowMinimum(offers, { tiers: ['BASIC_499'], intervals: ['month', 'year'] }, 24000, 'NOT_VAT_REGISTERED'), null);
    assert.equal(firstOfferBelowMinimum(offers, { tiers: ['STARTER_249'], intervals: ['year'] }, 24000, 'NOT_VAT_REGISTERED'), null);
    // A batch with no price discount is never checked.
    assert.equal(firstOfferBelowMinimum(offers, scope, 0, 'INCLUSIVE_VAT_7'), null);
  });
});

describe('ticket figures and stored scope', () => {
  it('splits used-as-discount from used-as-credit and takes expired out of available', () => {
    const counts = ticketCounts([
      { state: 'ISSUED', redeemedAs: null, count: 7 },
      { state: 'RESERVED', redeemedAs: 'DISCOUNT', count: 1 },
      { state: 'USED', redeemedAs: 'DISCOUNT', count: 3 },
      { state: 'USED', redeemedAs: 'CREDIT', count: 2 },
      { state: 'REVOKED', redeemedAs: null, count: 1 },
    ], 2);
    assert.deepEqual(counts, { issued: 14, available: 5, inPayment: 1, usedAsDiscount: 3, usedAsCredit: 2, expired: 2, revoked: 1 });
  });

  it('reads a stored scope back totally, dropping anything it does not know', () => {
    assert.deepEqual(scopeFromJson({ tiers: ['PRO_999', 'X'], intervals: ['year', 'week'] }), { tiers: ['PRO_999'], intervals: ['year'] });
    assert.deepEqual(scopeFromJson(null), { tiers: [], intervals: [] });
  });
});
