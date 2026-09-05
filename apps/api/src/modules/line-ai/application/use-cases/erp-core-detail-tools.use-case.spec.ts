import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  AccountingGetDocumentDetailTool,
  AccountingGetReceivableSummaryTool,
  ExpenseGetDetailTool,
  InventoryGetProductDetailTool,
  ReimbursementGetDetailTool,
  ReimbursementGetSummaryTool,
} from './erp-core-detail-tools.use-case';
import { InternalToolsController } from '../../presentation/http/internal-tools.controller';

const ctx = {
  requestId: 'r1', companyId: 'c1', userId: 'u1', membershipId: 'm1',
  permissions: ['inventory.product.read', 'accounting.document.read', 'expense.read_own', 'reimbursement.read_own'],
  roles: [], branchIds: ['b1'], locale: 'th-TH',
};

describe('LINE ERP core detail tools', () => {
  it('returns bounded product detail without persistence metadata', async () => {
    const tool = new InventoryGetProductDetailTool({ execute: async () => ({
      id: 'p1', companyId: 'c1', sku: 'SKU', name: 'สินค้า', description: 'desc', unit: 'ชิ้น', kind: 'STOCKABLE',
      customerVisible: true, status: 'ACTIVE', createdByUserId: 'secret-user', createdAt: new Date(), updatedAt: new Date(),
      barcodes: Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, companyId: 'c1', productId: 'p1', type: 'EAN13', value: `${i}`, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() })),
    }) } as any);
    const result = await tool.execute(ctx, { productId: 'p1' });
    assert.equal(result.status, 'ok');
    assert.equal((result.data as any).barcodes.length, 10);
    assert.equal((result.data as any).createdByUserId, undefined);
    assert.equal(result.sourceRefs[0]?.permissionChecked, true);
  });

  it('maps source permission/not-found failures honestly', async () => {
    const forbidden = new InventoryGetProductDetailTool({ execute: async () => { throw new ForbiddenException(); } } as any);
    const missing = new InventoryGetProductDetailTool({ execute: async () => { throw new NotFoundException(); } } as any);
    assert.equal((await forbidden.execute(ctx, { productId: 'p1' })).status, 'forbidden');
    const notFound = await missing.execute(ctx, { productId: 'p1' });
    assert.equal(notFound.status, 'ok');
    assert.deepEqual(notFound.data, { found: false });
    assert.equal(notFound.errorCode, 'PRODUCT_NOT_FOUND');
    assert.equal(notFound.sourceRefs[0]?.permissionChecked, true);
  });

  it('returns bounded accounting document fields and strips internal memo/counterparty payload', async () => {
    const tool = new AccountingGetDocumentDetailTool({ execute: async () => ({
      id: 'd1', companyId: 'c1', documentType: 'INVOICE', documentNumber: 'INV-1', status: 'ISSUED',
      documentDate: new Date('2026-07-01'), currency: 'THB', vatMode: 'NO_VAT', subtotalAmount: '100',
      discountAmount: '0', taxableAmount: '100', vatAmount: '0', whtAmount: '0', grandTotalAmount: '100',
      paidAmount: '0', outstandingAmount: '100', postingStatus: 'NOT_POSTED', createdByUserId: 'u2',
      createdAt: new Date(), updatedAt: new Date(), internalMemo: 'secret',
      counterpartySnapshotJson: { displayName: 'ลูกค้า A', phone: 'secret' },
      lines: Array.from({ length: 12 }, (_, i) => ({ description: `line${i}`, quantity: '1', unitPrice: '10', lineTotalAmount: '10' })),
    }) } as any);
    const result = await tool.execute(ctx, { documentId: 'd1' });
    assert.equal(result.status, 'ok');
    assert.equal((result.data as any).counterpartyName, 'ลูกค้า A');
    assert.equal((result.data as any).internalMemo, undefined);
    assert.equal((result.data as any).lines.length, 10);
  });

  it('uses paged accounting source results for an exact receivable summary', async () => {
    let calls = 0;
    const tool = new AccountingGetReceivableSummaryTool({ execute: async (_ctx: any, input: any) => {
      calls += 1;
      return input.page === 1
        ? { data: [{ id: 'd1', documentNumber: '1', status: 'ISSUED', outstandingAmount: '20', currency: 'THB', paymentStatus: 'UNPAID' }], total: 101, page: 1, pageSize: 100 }
        : { data: [{ id: 'd2', documentNumber: '2', status: 'ISSUED', outstandingAmount: '30', currency: 'THB', paymentStatus: 'PARTIALLY_PAID' }], total: 101, page: 2, pageSize: 100 };
    } } as any);
    const result = await tool.execute(ctx);
    assert.equal(calls, 2);
    assert.equal((result.data as any).openCount, 2);
    assert.deepEqual((result.data as any).totalsByCurrency, [{ currency: 'THB', outstandingAmount: '50.00' }]);
  });

  it('returns bounded expense detail and relies on source ABAC', async () => {
    let forwardedCtx: any;
    const tool = new ExpenseGetDetailTool({ execute: async (sourceCtx: any) => {
      forwardedCtx = sourceCtx;
      return {
        id: 'e1', expenseNumber: 'EXP-1', status: 'CONFIRMED', captureSource: 'WEB', branchId: 'b1',
        vendorNameSnapshot: 'ร้าน A', vendorDocumentNumber: 'R1', expenseDate: new Date('2026-07-01'), dueDate: null,
        currency: 'THB', vatMode: 'NO_VAT', inputVatClaimStatus: 'NOT_CLAIMABLE', subtotalAmount: '50', discountAmount: '0',
        taxableAmount: '50', vatAmount: '0', whtAmount: '0', grandTotalAmount: '50', netPayableAmount: '50', paidAmount: '0',
        outstandingAmount: '50', paymentStatus: 'UNPAID', duplicateStatus: 'CLEAR', taxEvidenceStatus: 'NOT_REQUIRED', postingStatus: 'NOT_POSTED',
        lines: [], attachments: [{ id: 'private-file' }], duplicateCandidates: [], substituteReceiptEvidence: null,
      };
    } } as any);
    const result = await tool.execute(ctx, { expenseId: 'e1' });
    assert.deepEqual(forwardedCtx.scopes.branchIds, ['b1']);
    assert.equal((result.data as any).attachmentCount, 1);
    assert.equal((result.data as any).attachments, undefined);
  });

  it('returns reimbursement summary/detail without attachment ids or approver identities', async () => {
    const summary = new ReimbursementGetSummaryTool({ execute: async () => ({ pendingApprovalCount: 1, unpaidApprovedCount: 2, overdueApprovalCount: 0, totalUnpaidAmount: '300' }) } as any);
    assert.equal((await summary.execute(ctx)).status, 'ok');

    const detail = new ReimbursementGetDetailTool({ execute: async () => ({
      id: 'rr1', companyId: 'c1', requesterUserId: 'u1', requesterDisplayNameSnapshot: 'User', reason: 'travel',
      categoryKey: 'travel', amount: '100', currency: 'THB', incurredDate: '2026-07-01', status: 'PENDING_APPROVAL',
      financeReviewStatus: 'NOT_REVIEWED', paymentStatus: 'UNPAID', duplicateStatus: 'CLEAR', receiptRequirementStatus: 'SATISFIED',
      postingStatus: 'NOT_POSTED', paymentTotalAmount: '0', outstandingAmount: '100', createdAt: '', updatedAt: '', primaryAttachmentId: 'secret',
      approvalSteps: [{ id: 's1', sequenceNo: 1, approverUserId: 'secret-approver', status: 'PENDING', assignedAt: '' }],
      payments: [], duplicateCandidates: [],
    }) } as any);
    const result = await detail.execute(ctx, { reimbursementId: 'rr1' });
    assert.equal((result.data as any).primaryAttachmentId, undefined);
    assert.equal((result.data as any).approvalSteps[0].approverUserId, undefined);
  });

  it('wires all seven adapters into the internal tool map', () => {
    const dependenciesBeforeCoreDetailAdapters = Array.from({ length: 44 }, () => ({}));
    const adapters = [
      { execute: async () => ({}) }, { execute: async () => ({}) },
      { execute: async () => ({}) }, { execute: async () => ({}) },
      { execute: async () => ({}) }, { execute: async () => ({}) },
      { execute: async () => ({}) },
    ];
    const controller = new (InternalToolsController as any)(
      {}, {}, {}, {}, {}, ...dependenciesBeforeCoreDetailAdapters, ...adapters,
    );
    const map = (controller as any).toolMap as Map<string, unknown>;
    assert.equal(map.get('inventory.get_product_detail'), adapters[0]);
    assert.equal(map.get('expense.get_detail'), adapters[1]);
    assert.equal(map.get('expense.explain_record'), adapters[2]);
    assert.equal(map.get('reimbursement.get_summary'), adapters[3]);
    assert.equal(map.get('reimbursement.get_detail'), adapters[4]);
    assert.equal(map.get('accounting.get_document_detail'), adapters[5]);
    assert.equal(map.get('accounting.get_receivable_summary'), adapters[6]);
  });
});
