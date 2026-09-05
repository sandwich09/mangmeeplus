import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayReceiptQuotaLimit,
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
    assert.match(receiptQuotaExceededTextTh(15), /15 ครั้ง/);
    // The warm-up wall is 10, and a shop that meets it must not be told it read 15.
    assert.match(receiptQuotaExceededTextTh(10), /10 ครั้ง/);
    assert.doesNotMatch(receiptQuotaExceededTextTh(10), /15/);
    assert.match(receiptQuotaExceededShortTextTh(30), /30 ครั้ง/);
  });

  it('says the §7 sentence for the trial, and the follow-up points at the package-change command', () => {
    assert.equal(
      receiptQuotaExceededTextTh(15, TRIAL_COUNTER_TIER_KEY),
      'ช่วงทดลองให้ AI อ่านรูปได้ 15 ครั้ง ตอนนี้ครบแล้วค่ะ (ใบเสร็จ 1 ใบ = 1 ครั้ง) ดูแพ็กเกจที่ใหญ่ขึ้นได้เลย',
    );
    assert.match(receiptQuotaExceededShortTextTh(15, TRIAL_COUNTER_TIER_KEY), /ขอเปลี่ยนแพ็กเกจ/);
  });

  // A STARTER_249 shop that meets its own 30 is a PAYING customer. Telling it the trial ran out is
  // both false and a reason to churn.
  it('says "ช่วงทดลอง" for the free trial and for nobody else', () => {
    for (const tierKey of ['STARTER_249', 'PRO_999', null, undefined]) {
      assert.doesNotMatch(receiptQuotaExceededTextTh(30, tierKey), /ทดลอง/, String(tierKey));
      assert.doesNotMatch(receiptQuotaExceededShortTextTh(30, tierKey), /ทดลอง/, String(tierKey));
      assert.match(receiptQuotaExceededTextTh(30, tierKey), /แพ็กเกจของคุณให้ AI อ่านรูปได้ 30 ครั้งต่อเดือน/, String(tierKey));
    }
    assert.match(receiptQuotaExceededTextTh(15, TRIAL_COUNTER_TIER_KEY), /ช่วงทดลอง/);
    assert.match(receiptQuotaExceededShortTextTh(15, TRIAL_COUNTER_TIER_KEY), /ในช่วงทดลอง/);
  });

  it('numbers the trial counter line n of limit', () => {
    assert.equal(trialReceiptCounterLineTh(3, 15), 'อ่านครั้งที่ 3 จาก 15 ในช่วงทดลอง');
  });

  it('counts AI IMAGE READS, never receipts — the ceiling charges both', () => {
    // `admitCompanyOcr` admits every image the assistant reads, including a signature photo or a
    // picture sent with a question. Promising receipts while charging for reads is a promise the
    // system does not keep, so no customer-facing sentence may count in receipts.
    for (const text of [
      receiptQuotaExceededTextTh(15, TRIAL_COUNTER_TIER_KEY),
      receiptQuotaExceededShortTextTh(15, TRIAL_COUNTER_TIER_KEY),
      receiptQuotaExceededTextTh(30, 'STARTER_249'),
      receiptQuotaExceededShortTextTh(30, 'STARTER_249'),
      trialReceiptCounterLineTh(3, 15),
    ]) {
      assert.doesNotMatch(text, /\d+ ใบ(?!\s*=)/, text);
      assert.doesNotMatch(text, /\+/, 'the "+" character is not used in customer copy');
    }
  });
});


/**
 * Residual-4: `planLimit ?? 0` would have printed "อ่านรูปได้ 0 ครั้ง" if the term row disappeared
 * between the admission and the reply — a broken-looking sentence shown to the one customer least
 * willing to forgive it.
 */
describe('printed ceiling fallback', () => {
  it('prefers the live plan limit', () => {
    assert.equal(displayReceiptQuotaLimit(10, 'FREE_TRIAL_15'), 10, 'warm-up ceiling wins over the preset');
  });

  it('falls back to the tier preset when the term row is gone or zeroed', () => {
    assert.equal(displayReceiptQuotaLimit(null, 'FREE_TRIAL_15'), 15);
    assert.equal(displayReceiptQuotaLimit(0, 'STARTER_249'), 30, 'zero is never a ceiling worth printing');
  });

  it('gives up on the number rather than inventing one', () => {
    assert.equal(displayReceiptQuotaLimit(null, null), null);
    assert.equal(displayReceiptQuotaLimit(null, 'TIER_THAT_NEVER_EXISTED'), null);
  });

  it('drops the number from the copy instead of printing zero', () => {
    for (const tierKey of [TRIAL_COUNTER_TIER_KEY, 'STARTER_249']) {
      const text = receiptQuotaExceededTextTh(null, tierKey);
      // The fixed "ใบเสร็จ 1 ใบ = 1 ครั้ง" rate clause stays; only the CEILING loses its number.
      assert.doesNotMatch(text, /อ่านรูปได้ \d+ ครั้ง/, tierKey);
      assert.doesNotMatch(text, /0 ครั้ง/, tierKey);
      assert.match(text, /ครบตามจำนวน/, tierKey);
      assert.doesNotMatch(receiptQuotaExceededShortTextTh(null, tierKey), /\bครบ \d+ ครั้ง/, tierKey);
    }
    // And the trial still owns its own word in the numberless form.
    assert.match(receiptQuotaExceededTextTh(null, TRIAL_COUNTER_TIER_KEY), /ช่วงทดลอง/);
    assert.doesNotMatch(receiptQuotaExceededTextTh(null, 'STARTER_249'), /ทดลอง/);
  });
});
