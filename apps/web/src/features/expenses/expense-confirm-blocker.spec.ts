import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expenseConfirmBlocker } from './expenses.model';

// Owner requirement 2026-08-28: a disabled ยืนยันเอกสาร must say why, in text. The reason existed
// before as the button's hover `title`, which on the phone these receipts are reviewed on is the
// same as no reason at all — the owner hit exactly that and had to ask what was wrong.
const ok = {
  status: 'READY_FOR_CONFIRMATION', classificationBlocked: false, hasDuplicates: false,
  needsReceiptOrSubstitute: false, substituteReady: true, ocrTotalUnacknowledged: false, isZeroAmount: false,
};

describe('a refused confirmation always names its reason', () => {
  it('says nothing when nothing is wrong', () => {
    assert.equal(expenseConfirmBlocker(ok), null);
  });

  it('asks for the receipt first — the one thing the person in front of it can fix now', () => {
    const b = expenseConfirmBlocker({ ...ok, needsReceiptOrSubstitute: true, hasDuplicates: true, isZeroAmount: true });
    assert.equal(b?.key, 'expenses.confirm_needs_receipt', 'not the duplicate or the zero total');
  });

  it('covers every blocking flag, so no combination can go unexplained', () => {
    const blocked = [
      { ...ok, needsReceiptOrSubstitute: true },
      { ...ok, substituteReady: false },
      { ...ok, hasDuplicates: true },
      { ...ok, ocrTotalUnacknowledged: true },
      { ...ok, isZeroAmount: true },
      { ...ok, status: 'NEEDS_REVIEW' },
      { ...ok, classificationBlocked: true },
    ];
    for (const input of blocked) {
      const b = expenseConfirmBlocker(input);
      assert.ok(b && (b.key || b.literal), `no reason for ${JSON.stringify(input)}`);
    }
  });

  it('prefers the classification message the server actually sent over a generic key', () => {
    const b = expenseConfirmBlocker({ ...ok, classificationBlocked: true, classificationBlockMessage: 'เอกสารนี้ไม่ใช่ค่าใช้จ่าย' });
    assert.equal(b?.literal, 'เอกสารนี้ไม่ใช่ค่าใช้จ่าย');
  });
});

