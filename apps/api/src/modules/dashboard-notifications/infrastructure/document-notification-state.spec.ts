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
