import { it } from 'node:test';
import assert from 'node:assert/strict';
import { completedDocumentNotificationIds, localizeReimbursementDecision } from './document-notification-state';
it('resolves completed source work, retains active work and can reopen after a payment void', async () => {
  const queries: any[] = [];
  let paymentStatus = 'PAID';
  const db: any = {
    notificationEvent: { findMany: async (q: any) => { queries.push(q); return [
      { id: 'signed', triggerKey: 'expense.substitute_receipt_signature_pending', sourceType: 'substitute_receipt_evidence', sourceId: 'cert1' },
      { id: 'needs-sign', triggerKey: 'expense.substitute_receipt_signature_pending', sourceType: 'substitute_receipt_evidence', sourceId: 'cert2' },
      { id: 'payment', triggerKey: 'workflow.reimbursement_ready_for_payment', sourceType: 'reimbursement_request', sourceId: 'claim1' },
    ]; } },
    expenseSubstituteReceiptEvidence: { findMany: async (q: any) => { queries.push(q); return [{ id: 'cert1', status: 'ISSUED' }, { id: 'cert2', status: 'PREPARED' }]; } },
    reimbursementRequest: { findMany: async (q: any) => { queries.push(q); return [{ id: 'claim1', status: paymentStatus }]; } },
  };
  assert.deepEqual(await completedDocumentNotificationIds(db, 'co1', 'u1'), ['signed', 'payment']);
  assert.ok(queries.every(q => q.where.companyId === 'co1'));
  assert.deepEqual(queries[0].where.recipients, { some: { userId: 'u1', dismissedAt: null } });
  paymentStatus = 'READY_FOR_PAYMENT';
  assert.deepEqual(await completedDocumentNotificationIds(db, 'co1', 'u1'), ['signed']);
  assert.equal(localizeReimbursementDecision('ผลการพิจารณา: REJECTED · 125 THB'), 'ผลการพิจารณา: ไม่อนุมัติ · 125 THB');
});
it('keeps the payment reminder to do while the claim waits for payment, and done once it is paid (audit B9)', async () => {
  let status = 'READY_FOR_PAYMENT';
  const db: any = {
    notificationEvent: { findMany: async () => [
      { id: 'reminder', triggerKey: 'workflow.reimbursement_payment_sla_breach', sourceType: 'reimbursement_request', sourceId: 'claim1' },
    ] },
    reimbursementRequest: { findMany: async () => [{ id: 'claim1', status }] },
  };
  assert.deepEqual(await completedDocumentNotificationIds(db, 'co1', 'u1'), []);
  status = 'PAID';
  assert.deepEqual(await completedDocumentNotificationIds(db, 'co1', 'u1'), ['reminder']);
});
it('repairs every decision code word a notice stored before the fix can still carry (audit B15)', () => {
  assert.equal(localizeReimbursementDecision('ผลการพิจารณา: APPROVED · ยอด 125 THB'), 'ผลการพิจารณา: อนุมัติ · ยอด 125 THB');
  assert.equal(
    localizeReimbursementDecision('ผลการพิจารณา: BELOW_APPROVAL_THRESHOLD · ยอด 125 THB'),
    'ผลการพิจารณา: ไม่ต้องอนุมัติตามนโยบาย · ยอด 125 THB',
  );
  assert.equal(localizeReimbursementDecision('ผลตรวจสอบ: BLOCKED · ยอด 125 THB'), 'ผลตรวจสอบ: ระงับ · ยอด 125 THB');
  // Already in Thai (rendered at creation since the fix): nothing left to repair.
  assert.equal(localizeReimbursementDecision('ผลการพิจารณา: อนุมัติ · ยอด 125 THB'), 'ผลการพิจารณา: อนุมัติ · ยอด 125 THB');
});
