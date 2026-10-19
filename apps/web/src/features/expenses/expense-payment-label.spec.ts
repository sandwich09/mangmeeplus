import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expensePaymentFormState } from './expenses.model';

test('first payment names the amount; only an effective payment names the remainder', () => {
  for (const effective of [false, true]) {
    const form = expensePaymentFormState('500', '500', '2026-10-12', false, '2026-10-12', effective);
    assert.equal(form.label, effective ? 'บันทึกจ่ายส่วนที่เหลือ 500.00 บาท' : 'บันทึกจ่าย 500.00 บาท');
    assert.equal(expensePaymentFormState('500', '100', '2026-10-12', false, '2026-10-12', effective).label, 'บันทึกจ่าย 100.00 บาท');
  }
});

import { readFileSync } from 'node:fs';
import { expensePaymentAttempt } from './expenses.model';
test('optional slip uses the claim file control and is opened from its payment row', () => {
  const source = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /ThemedFile[\s\S]*?aria-label="แนบสลิป \(ถ้ามี\)"/);
  assert.match(source, /payment\.slipAttachmentId/);
  assert.match(source, /ดูหลักฐานการจ่าย/);
});
test('changing a slip starts a new payment intent while retrying keeps its key', () => {
  const input = { paidAmount: '100', slipAttachmentId: 'a' };
  const first = expensePaymentAttempt(null, 'co', 'exp', input, () => 'key-one');
  assert.equal(expensePaymentAttempt(first, 'co', 'exp', input), first);
  assert.notEqual(expensePaymentAttempt(first, 'co', 'exp', { ...input, slipAttachmentId: 'b' }, () => 'key-two'), first);
});
