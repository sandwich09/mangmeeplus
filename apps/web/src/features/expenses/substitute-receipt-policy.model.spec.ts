import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validApproverSelection, validateSubstituteReceiptPolicy } from './substitute-receipt-policy.model';

test('substitute-receipt policy requires approvers only in designated mode', () => {
  const base = { cashEvidencePolicy: 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE' as const };
  assert.equal(validateSubstituteReceiptPolicy({ ...base, approvalMode: 'OWNER_SELF', approverUserIds: [] }), null);
  assert.equal(validateSubstituteReceiptPolicy({ ...base, approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: [] }), 'เลือกผู้อนุมัติอย่างน้อย 1 คน');
  assert.equal(validateSubstituteReceiptPolicy({ ...base, approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['u1', 'u1'] }), 'ผู้อนุมัติต้องไม่ซ้ำกัน');
  assert.equal(validateSubstituteReceiptPolicy({ ...base, approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['u1'] }), null);
});

test('stale approvers remain reportable but do not block the replacement selection', () => {
  assert.deepEqual(validApproverSelection(['active', 'inactive'], ['inactive']), ['active']);
});
