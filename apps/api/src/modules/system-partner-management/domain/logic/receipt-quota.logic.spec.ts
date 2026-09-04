import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveMonthlySlipLimit,
  receiptQuotaExceededShortTextTh,
  receiptQuotaExceededTextTh,
  trialReceiptCounterLineTh,
  TRIAL_COUNTER_TIER_KEY,
} from './receipt-quota.logic';

const trial = (over: Partial<Parameters<typeof effectiveMonthlySlipLimit>[0] & object> = {}) => ({
  tierKey: TRIAL_COUNTER_TIER_KEY,
  monthlySlipLimit: 15,
  warmupUntil: null,
  warmupSlipLimit: null,
  ...over,
});

/** 2026-09-08 07:00 Bangkok = 2026-09-08T00:00:00Z. Every edge below is expressed against it. */
const WARMUP_ENDS = new Date('2026-09-08T00:00:00Z');
const bangkok = (iso: string) => new Date(iso);

describe('effective monthly slip limit (P10-L §15.1)', () => {
  it('grandfathers a company with no plan term row — unlimited, never blocked', () => {
    // The whole point of review G-01's flag: enforcing this ceiling is the first limit an EXISTING
    // shop would ever meet, and a shop that predates P29 has no row at all.
    assert.equal(effectiveMonthlySlipLimit(null, new Date()), null);
  });

  it('is the tier ceiling when the term carries no warm-up', () => {
    assert.equal(effectiveMonthlySlipLimit(trial(), new Date()), 15);
  });

  it('takes the LOWER of the two inside the warm-up window', () => {
    const term = trial({ warmupUntil: WARMUP_ENDS, warmupSlipLimit: 10 });
    assert.equal(effectiveMonthlySlipLimit(term, bangkok('2026-09-01T00:00:00Z')), 10);
  });

  it('never RAISES the tier ceiling: a warm-up limit above the tier is ignored', () => {
    const term = trial({ monthlySlipLimit: 15, warmupUntil: WARMUP_ENDS, warmupSlipLimit: 100 });
    assert.equal(effectiveMonthlySlipLimit(term, bangkok('2026-09-01T00:00:00Z')), 15);
  });

  it('is half-open at the boundary: the instant warm-up ends, the tier ceiling applies', () => {
    const term = trial({ warmupUntil: WARMUP_ENDS, warmupSlipLimit: 10 });
    // One millisecond before 07:00 Bangkok on day 7 the shop is still capped at 10 …
    assert.equal(effectiveMonthlySlipLimit(term, new Date(WARMUP_ENDS.getTime() - 1)), 10);
    // … and exactly at it, and after, the trial's own 15 applies.
    assert.equal(effectiveMonthlySlipLimit(term, WARMUP_ENDS), 15);
    assert.equal(effectiveMonthlySlipLimit(term, new Date(WARMUP_ENDS.getTime() + 1)), 15);
  });

  it('ignores a half-configured warm-up rather than guessing the missing half', () => {
    assert.equal(effectiveMonthlySlipLimit(trial({ warmupUntil: WARMUP_ENDS }), bangkok('2026-09-01T00:00:00Z')), 15);
    assert.equal(effectiveMonthlySlipLimit(trial({ warmupSlipLimit: 10 }), bangkok('2026-09-01T00:00:00Z')), 15);
  });
});

describe('receipt quota copy (spec §7)', () => {
  it('carries the ACTUAL ceiling, not a hard-coded 15', () => {
    assert.match(receiptQuotaExceededTextTh(15), /15 ใบ/);
    // The warm-up wall is 10, and a shop that meets it must not be told it read 15.
    assert.match(receiptQuotaExceededTextTh(10), /10 ใบ/);
    assert.doesNotMatch(receiptQuotaExceededTextTh(10), /15/);
    assert.match(receiptQuotaExceededShortTextTh(30), /30 ใบ/);
  });

  it('says the §7 sentence, and the short follow-up points at the package-change command', () => {
    assert.equal(
      receiptQuotaExceededTextTh(15),
      'ช่วงทดลองอ่านใบเสร็จให้ได้ 15 ใบ ตอนนี้ครบแล้วค่ะ ดูแพ็กเกจที่ใหญ่ขึ้นได้เลย',
    );
    assert.match(receiptQuotaExceededShortTextTh(15), /ขอเปลี่ยนแพ็กเกจ/);
  });

  it('numbers the trial counter line n of limit', () => {
    assert.equal(trialReceiptCounterLineTh(3, 15), 'ใบที่ 3 จาก 15 ในช่วงทดลอง');
  });
});
