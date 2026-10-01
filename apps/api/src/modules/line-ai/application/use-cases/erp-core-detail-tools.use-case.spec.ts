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
import { BACKLOG_DESK_LABELS, PAYOUT_CORRECTION_NOTE } from '../../../reimbursements/application/use-cases/reimbursement-summary.use-case';

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

  it('uses one snapshot aggregate for an exact receivable summary', async () => {
    let calls = 0;
    const tool = new AccountingGetReceivableSummaryTool({ aggregateOpenReceivables: async () => {
      calls += 1;
      return {
        asOf: new Date('2026-07-31T00:00:00Z'), openCount: 2,
        totalsByCurrency: [{ currency: 'THB', outstandingAmount: '50.00', count: 2 }],
        items: [
          { id: 'd1', documentNumber: '1', dueDate: null, outstandingAmount: '20', currency: 'THB', paymentStatus: 'UNPAID' },
          { id: 'd2', documentNumber: '2', dueDate: null, outstandingAmount: '30', currency: 'THB', paymentStatus: 'PARTIALLY_PAID' },
        ],
        hasMore: false,
      };
    } } as any);
    const result = await tool.execute(ctx);
    assert.equal(calls, 1);
    assert.equal((result.data as any).openCount, 2);
    assert.deepEqual((result.data as any).totalsByCurrency, [{ currency: 'THB', outstandingAmount: '50.00', count: 2 }]);
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
      payoutMethod: 'BANK_TRANSFER',
      payout: { payoutMethod: 'BANK_TRANSFER', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789', version: 1, canRevealAccountNumber: true },
    }) } as any);
    const result = await detail.execute(ctx, { reimbursementId: 'rr1' });
    // Payout spec §11.2: the claim's payout account never reaches an AI answer, masked or not.
    assert.doesNotMatch(JSON.stringify(result), /payout|6789|กสิกร|สมชาย/);
    // Step-journey spec §11/§13 (AC10): the AI's answer about a claim's status links straight to
    // that claim's journey page, the same path every notification template and the LINE handoff use.
    assert.equal(result.sourceRefs?.[0]?.webPath, '/companies/c1/reimbursements/rr1');
    assert.equal((result.data as any).primaryAttachmentId, undefined);
    assert.equal((result.data as any).approvalSteps[0].approverUserId, undefined);
  });

  // Payout spec §14.7, §17.3 (final review item 14). A claim sent back for its payout account is PENDING_APPROVAL
  // by its status, and the approval it stood on stays on it, set aside. The tool said "pending approval, one step
  // approved" of it while `reimbursement.get_approval_backlog` said it waits for its requester.
  it('says of a claim in a correction round what the backlog tool says of each phase, and lists no approval the round set aside', async () => {
    const setAside = { invalidatedAt: '2026-09-30T18:30:00.000Z', invalidatedReason: 'payout_account_correction' };
    const approvedBefore = { id: 's1', sequenceNo: 1, approverUserId: 'approver-1', status: 'APPROVED', assignedAt: '', decidedAt: '2026-09-21T03:00:00.000Z', ...setAside };
    const claim = (overrides: Record<string, unknown>) => ({
      id: 'rr2', companyId: 'c1', requestNo: 'RB-202609-000002', requesterUserId: 'u1', requesterDisplayNameSnapshot: 'User', reason: 'travel',
      categoryKey: 'travel', amount: '580.50', currency: 'THB', incurredDate: '2026-09-20', status: 'PENDING_APPROVAL',
      financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'NOT_PAYABLE', duplicateStatus: 'NO_MATCH', receiptRequirementStatus: 'ATTACHED',
      postingStatus: 'posted', paymentTotalAmount: '0', outstandingAmount: '580.50', lineCount: 1, createdAt: '', updatedAt: '',
      payments: [], duplicateCandidates: [], payoutMethod: 'BANK_TRANSFER',
      payout: { payoutMethod: 'BANK_TRANSFER', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789', version: 2, canRevealAccountNumber: true },
      ...overrides,
    });
    const round = (phase: string, overrides: Record<string, unknown> = {}) => ({
      phase, requestedAt: '2026-09-30T18:30:00.000Z', requestedByUserId: 'payer-1', requestedByName: 'ผู้จ่าย', reasonCode: 'ACCOUNT_NUMBER_WRONG',
      note: 'เลขท้ายไม่ตรงสมุดบัญชี', previous: { payoutMethod: 'BANK_TRANSFER', accountName: 'นาย สมชาย ใจดี', accountLast4: '1234', version: 1 }, ...overrides,
    });
    const read = async (item: unknown) => (await new ReimbursementGetDetailTool({ execute: async () => item } as any).execute(ctx, { reimbursementId: 'rr2' })).data as any;

    // Sent back at 01:30 on 1 October in Bangkok: with its requester since that Thai day, and no step is its approval.
    const withRequester = await read(claim({
      payoutCorrectionPhase: 'AWAITING_REQUESTER', currentDesk: { kind: 'REQUESTER' }, payoutCorrection: round('AWAITING_REQUESTER'), approvalSteps: [approvedBefore],
    }));
    assert.equal(withRequester.status, 'รอผู้เบิกแก้บัญชีรับเงิน');
    assert.equal(withRequester.status, BACKLOG_DESK_LABELS.requester_correction);
    assert.equal(withRequester.sentBackOn, '2026-10-01');
    assert.equal(withRequester.note, PAYOUT_CORRECTION_NOTE);
    assert.equal(withRequester.resubmittedOn, undefined);
    assert.deepEqual(withRequester.approvalSteps, []);

    // The account given at 09:00 on 2 October: it waits for approval again from that day, at the new step alone.
    const withApprover = await read(claim({
      payoutCorrectionPhase: 'AWAITING_APPROVAL', currentDesk: { kind: 'APPROVER', names: ['สมศรี'] },
      payoutCorrection: round('AWAITING_APPROVAL', { submittedAt: '2026-10-02T02:00:00.000Z' }),
      approvalSteps: [approvedBefore, { id: 's2', sequenceNo: 2, approverUserId: 'approver-1', status: 'PENDING', assignedAt: '2026-10-02T02:00:00.000Z' }],
    }));
    assert.equal(withApprover.status, 'รออนุมัติบัญชีรับเงินใหม่');
    assert.equal(withApprover.resubmittedOn, '2026-10-02');
    assert.equal(withApprover.sentBackOn, undefined);
    assert.equal(withApprover.note, undefined);
    assert.deepEqual(withApprover.approvalSteps, [{ status: 'PENDING', sequence: 2, actedAt: null }]);

    // Being cancelled: nobody is asked for the account meanwhile, so the round's words are not said (the backlog says the same).
    const cancelling = await read(claim({
      payoutCorrectionPhase: 'AWAITING_REQUESTER', currentDesk: { kind: 'SYSTEM' }, cancellationPending: true,
      payoutCorrection: round('AWAITING_REQUESTER'), approvalSteps: [approvedBefore],
    }));
    assert.equal(cancelling.status, 'PENDING_APPROVAL');
    assert.equal(cancelling.sentBackOn, undefined);
    assert.equal(cancelling.note, undefined);

    // Approved again: an ordinary claim ready for payment, standing on the approval of the new account.
    const approvedAgain = await read(claim({
      status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', currentDesk: { kind: 'PAYMENT' },
      approvalSteps: [approvedBefore, { id: 's2', sequenceNo: 2, approverUserId: 'approver-1', status: 'APPROVED', assignedAt: '', decidedAt: '2026-10-02T04:00:00.000Z' }],
    }));
    assert.equal(approvedAgain.status, 'READY_FOR_PAYMENT');
    assert.deepEqual(approvedAgain.approvalSteps, [{ status: 'APPROVED', sequence: 2, actedAt: '2026-10-02T04:00:00.000Z' }]);
    assert.deepEqual([approvedAgain.sentBackOn, approvedAgain.resubmittedOn, approvedAgain.note], [undefined, undefined, undefined]);

    // Payout spec §11.2: where the claim stands, and nothing of the account, the reason or who sent it back.
    assert.doesNotMatch(JSON.stringify([withRequester, withApprover, cancelling, approvedAgain]),
      /payout|6789|1234|กสิกร|สมชาย|สมศรี|ACCOUNT_NUMBER_WRONG|payer-1|ผู้จ่าย|เลขท้าย|AWAITING_|approver-1/);
  });

  it('wires all eight adapters into the internal tool map', () => {
    const dependenciesBeforeCoreDetailAdapters = Array.from({ length: 45 }, () => ({}));
    const adapters = [
      { execute: async () => ({}) }, { execute: async () => ({}) },
      { execute: async () => ({}) }, { execute: async () => ({}) },
      { execute: async () => ({}) }, { execute: async () => ({}) },
      { execute: async () => ({}) }, { execute: async () => ({}) },
    ];
    const controller = new (InternalToolsController as any)(
      {}, {}, {}, {}, {}, ...dependenciesBeforeCoreDetailAdapters, ...adapters,
    );
    const map = (controller as any).toolMap as Map<string, unknown>;
    assert.equal(map.get('inventory.get_product_detail'), adapters[0]);
    assert.equal(map.get('expense.get_detail'), adapters[1]);
    assert.equal(map.get('expense.explain_record'), adapters[2]);
    // §17.5: the file-attempt read sits beside the record explainer it cannot answer for.
    assert.equal(map.get('line.explain_file_attempt'), adapters[3]);
    assert.equal(map.get('reimbursement.get_summary'), adapters[4]);
    assert.equal(map.get('reimbursement.get_detail'), adapters[5]);
    assert.equal(map.get('accounting.get_document_detail'), adapters[6]);
    assert.equal(map.get('accounting.get_receivable_summary'), adapters[7]);
  });
});
