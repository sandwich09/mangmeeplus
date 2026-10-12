import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expensePaymentFormState } from './expenses.model';

test('first payment names the amount; only an effective payment names the remainder', () => {
  for (const effective of [false, true]) {
    const form = expensePaymentFormState('500', '500', '2026-10-12', false, '2026-10-12', effective);
    assert.equal(form.label, effective ? 'บันทึกจ่ายส่วนที่เหลือ ฿500.00' : 'บันทึกจ่าย ฿500.00');
    assert.equal(expensePaymentFormState('500', '100', '2026-10-12', false, '2026-10-12', effective).label, 'บันทึกจ่าย ฿100.00');
  }
});
