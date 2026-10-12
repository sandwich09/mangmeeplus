import { test } from 'node:test';
import assert from 'node:assert/strict';

test('one-pass confirmation records the send answer before confirming and uses its version for the VAT attestation', async () => {
  const { sendAndConfirmExpense } = await import('./expense-one-pass-confirm');
  const events: string[] = [];
  const sent = { status: 'READY_FOR_CONFIRMATION', updatedAt: 'new-version' };
  const override = { reason: 'ตามเอกสาร', vatLineNumber: 1, expectedUpdatedAt: 'old-version' };
  const result = await sendAndConfirmExpense(async () => { events.push('send'); return sent; }, async value => {
    events.push('confirm'); assert.deepEqual(value, { ...override, expectedUpdatedAt: sent.updatedAt }); return { status: 'CONFIRMED' };
  }, value => { events.push('sent'); assert.equal(value, sent); }, override);
  assert.deepEqual(events, ['send', 'sent', 'confirm']); assert.deepEqual(result, { status: 'CONFIRMED' });
});

test('a send refusal never confirms; a confirm refusal retains the successful send and is propagated unchanged', async () => {
  const { sendAndConfirmExpense } = await import('./expense-one-pass-confirm');
  const refusal = { code: 'duplicate_unresolved', message: 'กรุณาตรวจรายการซ้ำก่อนยืนยัน' };
  let sends = 0, confirmations = 0, shown = '';
  await assert.rejects(() => sendAndConfirmExpense(async () => { throw refusal; }, async () => { confirmations++; }, () => {}), error => error === refusal);
  assert.equal(confirmations, 0);
  await assert.rejects(() => sendAndConfirmExpense(async () => { sends++; return { updatedAt: 'v2', status: 'READY_FOR_CONFIRMATION' }; }, async () => { confirmations++; throw refusal; }, sent => { shown = sent.status; }), error => error === refusal);
  assert.equal(shown, 'READY_FOR_CONFIRMATION'); assert.equal(sends, 1); assert.equal(confirmations, 1);
});
