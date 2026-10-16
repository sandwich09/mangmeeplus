import assert from 'node:assert/strict';
import { test } from 'node:test';
import { disbursementDocumentKind, disbursementVoucherPageTitle } from './disbursement-voucher-document.logic';
import { disbursementVoucherMenu } from './disbursement-voucher-journey.logic';
import type { DisbursementVoucherDetail, DisbursementVoucherHeader } from './disbursement-vouchers.model';
test('print uses a submitted revision, paid download survives cancellation, and an unsent draft has neither', () => {
  const header = { status: 'DRAFT', revision: 0, documentNumber: null, cancelledAfterPaid: false } as DisbursementVoucherHeader;
  assert.equal(disbursementDocumentKind(header), null);
  for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED'] as const) {
    const sent = { ...header, status, revision: 1, documentNumber: 'DV-1' };
    assert.equal(disbursementDocumentKind(sent), 'prepare');
    assert.ok(disbursementVoucherMenu({ header: sent, actions: {}, lines: [] } as unknown as DisbursementVoucherDetail).includes('print' as never));
  }
  assert.equal(disbursementDocumentKind({ ...header, status: 'PAID', documentNumber: 'DV-1' }), 'paid');
  assert.equal(disbursementDocumentKind({ ...header, status: 'CANCELLED', cancelledAfterPaid: true, documentNumber: 'DV-1' }), 'paid');
});

test('document titles distinguish drafts, numbered preparation and paid documents including cancelled payments', () => {
  const header = { status: 'DRAFT', revision: 0, documentNumber: null } as DisbursementVoucherHeader;
  assert.equal(disbursementVoucherPageTitle(header), 'ใบเตรียมจ่าย (ร่าง)');
  for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED'] as const)
    assert.equal(disbursementVoucherPageTitle({ ...header, status, revision: 1, documentNumber: 'DV-1' }), 'ใบเตรียมจ่าย เลขที่ DV-1');
  assert.equal(disbursementVoucherPageTitle({ ...header, status: 'PAID', documentNumber: 'DV-2' }), 'ใบสำคัญจ่าย เลขที่ DV-2');
  assert.equal(disbursementVoucherPageTitle({ ...header, status: 'CANCELLED', cancelledAfterPaid: true, documentNumber: 'DV-2' }), 'ใบสำคัญจ่าย เลขที่ DV-2');
});
