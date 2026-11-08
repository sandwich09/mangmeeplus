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
import { BACKLOG_DESK_LABELS } from '../../../reimbursements/application/use-cases/reimbursement-summary.use-case';
import { GetReimbursementAiSummaryUseCase } from '../../../reimbursements/application/use-cases/reimbursement-summary.use-case';

it('R17 claim read filters retain requester scope and match an exact round', async () => {
  let query: any;
  const rows = [4, 14].map(round => ({ id: `claim-${round}`, title: `ค่าเดินทาง รอบ ${round}`, reason: '', requestNo: null,
    requesterDisplayNameSnapshot: 'สมศรี', categoryLabelSnapshot: 'ค่าเดินทาง', amount: '100', status: 'DRAFT', paymentStatus: 'UNPAID', outstandingAmount: '100' }));
  const summary = new GetReimbursementAiSummaryUseCase({ findPolicy: async () => null, listRequests: async (where: any) => { query = where; return rows; } } as any, { log: async () => {} } as any);
  const result: any = await (summary.execute as any)({ companyId: 'co', userId: 'reader', permissions: ['reimbursement.read_own'], scopes: { branchIds: ['branch'] } },
    { requesterName: 'สมศรี', categoryName: 'ค่าเดินทาง', round: '4', status: 'DRAFT' });
  assert.equal(query.requesterUserId, 'reader'); assert.deepEqual(query.scopes, { branchIds: ['branch'] });
  assert.equal(query.requesterName, 'สมศรี'); assert.equal(query.categoryName, 'ค่าเดินทาง');
  assert.equal(result.matchedCount, 1); assert.equal(result.matchedItems[0].id, 'claim-4');
});

const ctx = {
  requestId: 'r1', companyId: 'c1', userId: 'u1', membershipId: 'm1',
  permissions: ['inventory.product.read', 'accounting.document.read', 'expense.read_own', 'reimbursement.read_own'],
  roles: [], branchIds: ['b1'], locale: 'th-TH',
};

describe('LINE ERP core detail tools', () => {
  it('claim detail carries the shared confirmed-duplicate guidance with the viewer cancellation and payment-void rights', async () => {
    const claim: any = { id: 'rr1', requesterUserId: 'u1', branchId: 'b1', status: 'READY_FOR_PAYMENT',
      duplicateBlocksPayment: true, duplicateReasons: ['EXPENSE_CONFIRMED_DUPLICATE'], approvalSteps: [], payments: [], duplicateCandidates: [] };
    const tool = new ReimbursementGetDetailTool({ execute: async () => claim } as any);
    for (const [status, permissions, pattern] of [
      ['READY_FOR_PAYMENT', ['reimbursement.cancel_own'], /กดยกเลิกคำขอในหน้าใบเบิก/],
      ['READY_FOR_PAYMENT', [], /ผู้เบิกที่มีสิทธิ์ยกเลิกหรือผู้ตรวจการเงินที่ดูแลสาขา/],
      ['PARTIALLY_PAID', ['reimbursement.payment.void'], /ผู้มีสิทธิ์ยกเลิกการจ่ายของสาขานี้/],
    ] as const) {
      claim.status = status;
      const result = await tool.execute({ ...ctx, permissions: [...ctx.permissions, ...permissions] }, { reimbursementId: 'rr1' });
      const data = result.data as any;
      assert.equal(data.duplicateBlocksPayment, true);
      if (status === 'READY_FOR_PAYMENT') assert.equal(data.status, 'รอยกเลิก');
      assert.equal(data.message, data.paymentBlockNotice, 'the general LINE answer receives the same guidance as the compiled answer');
      assert.match(data.paymentBlockNotice, pattern);
      assert.match(data.paymentBlockNotice, /ผู้เบิกส่งใบเบิกใหม่โดยไม่ใส่รายการซ้ำ/);
      assert.doesNotMatch(data.paymentBlockNotice, /ปลดรายการซ้ำ|[a-zA-Z_]/);
    }
  });
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
      lines: Array.from({ length: 30 }, (_, i) => ({ description: `line${i}`, quantity: '1', unitPrice: '10', lineTotalAmount: '10' })),
    }) } as any);
    const result = await tool.execute(ctx, { documentId: 'd1' });
    assert.equal(result.status, 'ok');
    assert.equal((result.data as any).counterpartyName, 'ลูกค้า A');
    assert.equal((result.data as any).internalMemo, undefined);
    assert.equal((result.data as any).lines.length, 30);
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

  const expenseRecord = (over: Record<string, unknown> = {}) => ({
    id: 'e1', expenseNumber: 'EXP-1', status: 'CONFIRMED', captureSource: 'WEB', branchId: 'b1',
    vendorNameSnapshot: 'ร้าน A', vendorDocumentNumber: 'R1', expenseDate: new Date('2026-07-01'), dueDate: null,
    currency: 'THB', vatMode: 'NO_VAT', inputVatClaimStatus: 'NOT_CLAIMABLE', subtotalAmount: '50', discountAmount: '0',
    taxableAmount: '50', vatAmount: '0', whtAmount: '0', grandTotalAmount: '50', netPayableAmount: '50', paidAmount: '0',
    outstandingAmount: '50', paymentStatus: 'UNPAID', duplicateStatus: 'CLEAR', taxEvidenceStatus: 'NOT_REQUIRED', postingStatus: 'NOT_POSTED',
    expenseCategoryId: null, rejectReason: null, voidReason: null, bankAccountRef: null,
    lines: [], attachments: [{ id: 'private-file' }], duplicateCandidates: [], substituteReceiptEvidence: null, payments: [],
    ...over,
  });

  it('returns bounded expense detail and relies on source ABAC', async () => {
    let forwardedCtx: any;
    const tool = new ExpenseGetDetailTool({
      execute: async (sourceCtx: any) => { forwardedCtx = sourceCtx; return expenseRecord({ lines: Array.from({ length: 30 }, (_, i) => ({ description: `รายการ ${i + 1}`, quantity: '1', unitPrice: '1', lineTotalAmount: '1' })) }); },
      categoryName: async () => null,
    } as any);
    const result = await tool.execute(ctx, { expenseId: 'e1' });
    assert.deepEqual(forwardedCtx.scopes.branchIds, ['b1']);
    assert.equal((result.data as any).lines.length, 30);
    assert.equal((result.data as any).lines[29].description, 'รายการ 30');
    assert.equal((result.data as any).attachmentCount, 1);
    assert.equal((result.data as any).attachments, undefined);
    // A record with no category, no reason and no payment says so plainly: null and zero, nothing invented.
    assert.equal((result.data as any).categoryName, null);
    assert.deepEqual((result.data as any).payments, { count: 0, lastPaidOn: null, methods: [] });
  });

  for (const locale of ['th-TH', 'en-US']) it(`EVID-1 ${locale}: the read exposes the original in hand without claiming a missing receipt`, async () => {
    const tool = new ExpenseGetDetailTool({ execute: async () => expenseRecord({ primaryAttachmentId: null, attachments: [],
      aiVerificationSummaryJson: { documentEvidenceDraft: { route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', attachmentIds: [], reason: '', originalDocumentAvailable: true, note: 'เก็บตัวจริงที่ร้าน' } } }),
      categoryName: async () => null } as any);
    const result = await tool.execute({ ...ctx, locale }, { expenseId: 'e1' });
    const data = result.data as any;
    assert.equal(data.attachmentCount, 0); assert.equal(data.originalDocumentAvailable, true); assert.equal(data.documentImageMissing, true);
    assert.deepEqual(data.evidenceNotes, locale.startsWith('en') ? ['Document image not attached', 'Note: เก็บตัวจริงที่ร้าน'] : ['ยังไม่มีรูปเอกสาร', 'หมายเหตุ: เก็บตัวจริงที่ร้าน']);
  });

  // Design lock contexts 5 and 7: what the record and payment cards print, from the one
  // permission-checked read of that record.
  it('projects the category name, the close reason and the recorded payments — never a bank reference', async () => {
    const categoryCalls: any[] = [];
    const tool = new ExpenseGetDetailTool({
      execute: async () => expenseRecord({
        expenseCategoryId: 'cat-1', status: 'REJECTED', rejectReason: 'เอกสารประกอบไม่ครบ', paymentStatus: 'PARTIALLY_PAID',
        paidAmount: '30', outstandingAmount: '20', bankAccountRef: '123-4-56789-0', paymentMethod: 'CASH', paidAt: new Date('2026-09-01T00:00:00.000Z'),
        payments: [
          { id: 'p1', status: 'RECORDED', paymentMethod: 'CASH', paidAt: new Date('2026-09-01T00:00:00.000Z'), bankAccountRef: null, amount: '10' },
          // Recorded late in the evening in Bangkok: 17:30 UTC on the 3rd is the 4th there.
          { id: 'p2', status: 'RECORDED', paymentMethod: 'BANK_TRANSFER', paidAt: new Date('2026-09-03T17:30:00.000Z'), bankAccountRef: '123-4-56789-0', amount: '20' },
          { id: 'p3', status: 'RECORDED', paymentMethod: 'CASH', paidAt: new Date('2026-09-02T00:00:00.000Z'), bankAccountRef: null, amount: '5' },
          // A cancelled payment is not a payment: it gives no date and no method.
          { id: 'p4', status: 'VOIDED', paymentMethod: 'CHEQUE', paidAt: new Date('2026-09-09T00:00:00.000Z'), bankAccountRef: '999-9-99999-9', amount: '99' },
        ],
      }),
      categoryName: async (sourceCtx: any, expense: any) => { categoryCalls.push([sourceCtx.companyId, expense.expenseCategoryId]); return 'ค่าอุปกรณ์สำนักงาน'; },
    } as any);
    const result = await tool.execute(ctx, { expenseId: 'e1' });
    const data = result.data as any;
    assert.equal(data.categoryName, 'ค่าอุปกรณ์สำนักงาน');
    assert.deepEqual(categoryCalls, [['c1', 'cat-1']], 'the name is read for this company and this record only');
    assert.equal(data.rejectReason, 'เอกสารประกอบไม่ครบ');
    assert.equal(data.voidReason, null);
    assert.deepEqual(data.payments, { count: 3, lastPaidOn: '2026-09-04', methods: ['CASH', 'BANK_TRANSFER'] });
    assert.doesNotMatch(JSON.stringify(result), /56789|99999|bankAccountRef|CHEQUE|2026-09-09/);
  });

  it('keeps a payment with no recorded method as unknown instead of naming one', async () => {
    const tool = new ExpenseGetDetailTool({
      execute: async () => expenseRecord({ payments: [{ id: 'p1', status: 'RECORDED', paymentMethod: null, paidAt: new Date('2026-09-01T00:00:00.000Z') }] }),
      categoryName: async () => null,
    } as any);
    assert.deepEqual(((await tool.execute(ctx, { expenseId: 'e1' })).data as any).payments, { count: 1, lastPaidOn: '2026-09-01', methods: [null] });
  });

  it('keeps a refused or missing record distinct from a found one', async () => {
    const refused = new ExpenseGetDetailTool({ execute: async () => { throw new ForbiddenException('Access denied'); }, categoryName: async () => 'x' } as any);
    const denied = await refused.execute(ctx, { expenseId: 'e1' });
    assert.equal(denied.status, 'forbidden');
    assert.equal(denied.data, undefined);
    const missing = new ExpenseGetDetailTool({ execute: async () => { throw new NotFoundException('gone'); }, categoryName: async () => 'x' } as any);
    const notFound = await missing.execute(ctx, { expenseId: 'e1' });
    assert.deepEqual(notFound.data, { found: false });
    assert.equal(notFound.errorCode, 'EXPENSE_NOT_FOUND');
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
      payments: Array.from({ length: 30 }, (_, i) => ({ paymentNo: i + 1, status: 'RECORDED', paidAmount: '1', paidAt: '2026-11-05' })), duplicateCandidates: [],
      payoutMethod: 'BANK_TRANSFER',
      payout: { payoutMethod: 'BANK_TRANSFER', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789', version: 1, canRevealAccountNumber: true },
    }) } as any);
    const result = await detail.execute(ctx, { reimbursementId: 'rr1' });
    assert.equal((result.data as any).payments.length, 30);
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
    assert.equal(withRequester.sentBackOn, '2026-10-01');
    assert.equal(withRequester.note, 'ใบเบิกถูกส่งกลับให้ผู้เบิกแก้บัญชีรับเงิน ผู้เบิกแก้ได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้');
    assert.equal(withRequester.resubmittedOn, undefined);
    assert.deepEqual(withRequester.approvalSteps, []);

    // The account given at 09:00 on 2 October: it waits for approval again from that day, at the new step alone.
    const withApprover = await read(claim({
      payoutCorrectionPhase: 'AWAITING_APPROVAL', payoutCorrectionAnswer: 'NEW_ACCOUNT', currentDesk: { kind: 'APPROVER', names: ['สมศรี'] },
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
    assert.equal(cancelling.status, BACKLOG_DESK_LABELS.status_pending);
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

  // Payout spec §14.2, §17.3. The status the assistant reads is the claim page's badge: by what the claim holds while
  // it is with its requester, by what was answered while it waits for approval. It used to be one label per phase, so a
  // claim with no account, and one that asked for cash, read "รอผู้เบิกแก้บัญชีรับเงิน", and a kept account read "ใหม่".
  it('words a claim in a round by what it holds and by what its requester answered, with the note that goes with the label', async () => {
    const claim = (overrides: Record<string, unknown>) => ({
      id: 'rr4', companyId: 'c1', requestNo: 'RB-202609-000004', requesterUserId: 'u1', requesterDisplayNameSnapshot: 'User', reason: 'travel',
      categoryKey: 'travel', amount: '580.50', currency: 'THB', incurredDate: '2026-09-20', status: 'PENDING_APPROVAL',
      financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'NOT_PAYABLE', duplicateStatus: 'NO_MATCH', receiptRequirementStatus: 'ATTACHED',
      postingStatus: 'posted', paymentTotalAmount: '0', outstandingAmount: '580.50', lineCount: 1, createdAt: '', updatedAt: '',
      payments: [], duplicateCandidates: [], approvalSteps: [], ...overrides,
    });
    const round = (phase: string, submittedAt?: string) => ({ phase, requestedAt: '2026-09-30T18:30:00.000Z', reasonCode: 'OTHER', ...(submittedAt && { submittedAt }) });
    const read = async (item: unknown) => (await new ReimbursementGetDetailTool({ execute: async () => item } as any).execute(ctx, { reimbursementId: 'rr4' })).data as any;

    // With its requester: what the claim holds. A claim sent before claims carried a destination carries no method.
    const withRequester = async (payoutMethod?: string) => read(claim({ payoutCorrectionPhase: 'AWAITING_REQUESTER', payoutCorrection: round('AWAITING_REQUESTER'), ...(payoutMethod && { payoutMethod }) }));
    const [account, nothing, cash] = [await withRequester('BANK_TRANSFER'), await withRequester(), await withRequester('CASH')];
    assert.deepEqual([account.status, account.note],
      ['รอผู้เบิกแก้บัญชีรับเงิน', 'ใบเบิกถูกส่งกลับให้ผู้เบิกแก้บัญชีรับเงิน ผู้เบิกแก้ได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้']);
    assert.deepEqual([nothing.status, nothing.note],
      ['รอผู้เบิกเพิ่มบัญชีรับเงิน', 'ใบเบิกถูกส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงิน ผู้เบิกเพิ่มได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้']);
    assert.deepEqual([cash.status, cash.note],
      ['รอผู้เบิกเลือกวิธีรับเงินคืน', 'ใบเบิกถูกส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง ผู้เบิกเลือกได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้']);
    // Nothing else of the answer differs: the same fields, the same day.
    for (const other of [nothing, cash]) {
      assert.deepEqual({ ...other, status: account.status, note: account.note }, account);
      assert.deepEqual(Object.keys(other), Object.keys(account));
    }
    assert.equal(account.sentBackOn, '2026-10-01');

    // Waiting for approval: what the requester answered, against what the round began with.
    const withApprover = (payoutCorrectionAnswer?: string) => read(claim({
      payoutCorrectionPhase: 'AWAITING_APPROVAL', payoutCorrection: round('AWAITING_APPROVAL', '2026-10-02T02:00:00.000Z'), payoutMethod: 'CASH', ...(payoutCorrectionAnswer && { payoutCorrectionAnswer }),
    }));
    const labels = {
      NEW_ACCOUNT: 'รออนุมัติบัญชีรับเงินใหม่', SAME_ACCOUNT: 'รออนุมัติบัญชีรับเงินเดิม', CASH_INSTEAD: 'รออนุมัติการรับเป็นเงินสด', ACCOUNT_INSTEAD: 'รออนุมัติบัญชีรับเงิน',
      SAME_CASH: 'รออนุมัติการรับเป็นเงินสด', FIRST_ACCOUNT: 'รออนุมัติบัญชีรับเงิน', FIRST_CASH: 'รออนุมัติการรับเป็นเงินสด',
    };
    for (const [answer, label] of Object.entries(labels)) {
      const waiting = await withApprover(answer);
      assert.deepEqual([waiting.status, waiting.resubmittedOn, waiting.sentBackOn, waiting.note], [label, '2026-10-02', undefined, undefined], answer);
    }
    // A claim detail with no answer on it: words that are true of every answer.
    assert.equal((await withApprover()).status, 'รออนุมัติวิธีรับเงินคืน');
    // Where the claim stands, and nothing of an account, a method code, a reason or an answer code.
    assert.doesNotMatch(JSON.stringify([account, nothing, cash, await withApprover('SAME_ACCOUNT'), await withApprover('CASH_INSTEAD')]),
      /payout|BANK_TRANSFER|CASH|ACCOUNT|AWAITING_|OTHER/);
  });

  // The whole answer for a claim that holds an account, letter for letter. It is what `reimbursement.get_detail` returned
  // at 603f461dd (captured from that build) in everything but one word: the note now calls a claim's account
  // "บัญชีรับเงิน", the name it has everywhere else (it said "บัญชีรับเงินคืน", the name of a member's standing account).
  // The status, every other field and their order are as they were.
  it('returns for a claim that holds an account and waits for its requester the status it always had, and a note that names the account as every screen does', async () => {
    const setAside = { invalidatedAt: '2026-09-30T18:30:00.000Z', invalidatedReason: 'payout_account_correction' };
    const item = {
      id: 'rr2', companyId: 'c1', requestNo: 'RB-202609-000002', requesterUserId: 'u1', requesterDisplayNameSnapshot: 'User', reason: 'travel',
      categoryKey: 'travel', amount: '580.50', currency: 'THB', incurredDate: '2026-09-20', status: 'PENDING_APPROVAL',
      financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'NOT_PAYABLE', duplicateStatus: 'NO_MATCH', receiptRequirementStatus: 'ATTACHED',
      postingStatus: 'posted', paymentTotalAmount: '0', outstandingAmount: '580.50', lineCount: 1, createdAt: '', updatedAt: '',
      payments: [], duplicateCandidates: [], payoutMethod: 'BANK_TRANSFER',
      payout: { payoutMethod: 'BANK_TRANSFER', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789', version: 2, canRevealAccountNumber: true },
      payoutCorrectionPhase: 'AWAITING_REQUESTER', currentDesk: { kind: 'REQUESTER' },
      payoutCorrection: {
        phase: 'AWAITING_REQUESTER', requestedAt: '2026-09-30T18:30:00.000Z', requestedByUserId: 'payer-1', requestedByName: 'ผู้จ่าย', reasonCode: 'ACCOUNT_NUMBER_WRONG',
        note: 'เลขท้ายไม่ตรงสมุดบัญชี', previous: { payoutMethod: 'BANK_TRANSFER', accountName: 'นาย สมชาย ใจดี', accountLast4: '1234', version: 1 },
      },
      approvalSteps: [{ id: 's1', sequenceNo: 1, approverUserId: 'approver-1', status: 'APPROVED', assignedAt: '', decidedAt: '2026-09-21T03:00:00.000Z', ...setAside }],
    };
    const result = await new ReimbursementGetDetailTool({ execute: async () => item } as any).execute(ctx, { reimbursementId: 'rr2' });
    // What the evaluation case of the assistant for such a claim (R-23) asks of an answer is in the status and in the note.
    for (const said of [(result.data as any).status, (result.data as any).note]) {
      assert.match(said, /บัญชีรับเงิน|แก้บัญชี|แก้ไขบัญชี/);
      assert.match(said, /ผู้เบิก/);
    }
    assert.equal(JSON.stringify(result.data),
      '{"id":"rr2","requestNo":"RB-202609-000002","requesterDisplayName":"User","title":null,"reason":"travel","category":"travel","amount":"580.50","currency":"THB","incurredDate":"2026-09-20","status":"รอผู้เบิกแก้บัญชีรับเงิน","sentBackOn":"2026-10-01","note":"ใบเบิกถูกส่งกลับให้ผู้เบิกแก้บัญชีรับเงิน ผู้เบิกแก้ได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้","financeReviewStatus":"NOT_REQUIRED","paymentStatus":"NOT_PAYABLE","receiptRequirementStatus":"ATTACHED","postingStatus":"posted","paymentTotalAmount":"0","outstandingAmount":"580.50","lineCount":1,"approvalSteps":[],"payments":[],"duplicateCount":0}');
  });

  // Tool dry-run 2026-10-02: a claim whose cancellation was started came back as `status: 'PENDING_APPROVAL'` with its
  // open step, so the fixed reply said it waits for approval. Approval and payment are refused meanwhile: it waits for
  // the system, as the backlog tool, `list_pending_approvals` and the claim page say of the same claim.
  it('says a claim being cancelled waits for the system, wherever it stood, and keeps the status of every other claim', async () => {
    const claim = (overrides: Record<string, unknown>) => ({
      id: 'rr3', companyId: 'c1', requestNo: 'RB-202610-000003', requesterUserId: 'u1', requesterDisplayNameSnapshot: 'User', reason: 'travel',
      categoryKey: 'travel', amount: '120.00', currency: 'THB', incurredDate: '2026-10-01', status: 'PENDING_APPROVAL',
      financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'NOT_PAYABLE', duplicateStatus: 'NO_MATCH', receiptRequirementStatus: 'ATTACHED',
      postingStatus: 'not_required', paymentTotalAmount: '0', outstandingAmount: '120.00', lineCount: 1, createdAt: '', updatedAt: '',
      payments: [], duplicateCandidates: [], approvalSteps: [{ id: 's1', sequenceNo: 1, approverUserId: 'approver-1', status: 'PENDING', assignedAt: '' }],
      ...overrides,
    });
    const status = async (item: unknown) => ((await new ReimbursementGetDetailTool({ execute: async () => item } as any).execute(ctx, { reimbursementId: 'rr3' })).data as any).status;
    const beingCancelled = { cancellationPending: true, currentDesk: { kind: 'SYSTEM' } };
    for (const stoodAt of ['PENDING_APPROVAL', 'APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT']) {
      assert.equal(await status(claim({ status: stoodAt, ...beingCancelled })), 'รอระบบปรับสถานะ', stoodAt);
      // Not being cancelled: the status it has, as before.
      assert.equal(await status(claim({ status: stoodAt })), stoodAt);
    }
    assert.equal(BACKLOG_DESK_LABELS.status_pending, 'รอระบบปรับสถานะ');
    // A cancelled claim is finished: the detail carries no pending cancellation for it, and its status is its own.
    assert.equal(await status(claim({ status: 'CANCELLED', currentDesk: undefined })), 'CANCELLED');
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

it('R17 approved-unpaid named claims keep the reader scope and exclude paid claims', async () => {
  let query: any;
  const rows = ['UNPAID', 'PAID'].map(paymentStatus => ({ id: paymentStatus, status: 'APPROVED', paymentStatus,
    reason: '', amount: '100', outstandingAmount: paymentStatus === 'PAID' ? '0' : '100' }));
  const summary = new GetReimbursementAiSummaryUseCase({ findPolicy: async () => null,
    listRequests: async (where: any) => { query = where; return rows; } } as any, { log: async () => {} } as any);
  const result = await summary.execute({ companyId: 'shop', userId: 'reader', permissions: ['reimbursement.read_related'],
    scopes: { branchIds: ['branch'] } } as any, { requesterName: 'สมศรี', status: 'APPROVED_UNPAID' });
  assert.equal(query.relatedUserId, 'reader');
  assert.deepEqual(query.scopes, { branchIds: ['branch'] });
  assert.deepEqual(query.statuses, ['APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'PARTIALLY_PAID']);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.matchedItems?.[0]?.id, 'UNPAID');
});

it('R17 a unique named claim uses its permission-checked detail and actual deciding person', async () => {
  let selected: string | undefined;
  const tool = new ReimbursementGetDetailTool({ execute: async (_ctx: any, id: string) => {
    selected = id;
    return { id, requesterUserId: 'u1', branchId: 'b1', status: 'APPROVED', approvalSteps: [
      { sequenceNo: 1, status: 'APPROVED', decidedAt: '2026-11-05T03:00:00Z', approverName: 'ผู้รับมอบหมาย', decidedByName: 'ผู้ที่เซ็นจริง' }],
      payments: [{ status: 'RECORDED', paidAmount: '100', paidAt: '2026-11-06T03:00:00Z' }], duplicateCandidates: [] };
  } } as any, { execute: async (_ctx: any, filters: any) => {
    assert.deepEqual(filters, { requesterName: 'สมศรี', categoryName: 'ค่าเดินทาง', round: '4' });
    return { matchedCount: 1, matchedItems: [{ id: 'claim-4' }] };
  } } as any);
  const result = await tool.execute(ctx, { requesterName: 'สมศรี', categoryName: 'ค่าเดินทาง', round: '4' });
  assert.equal(result.status, 'ok');
  assert.equal(selected, 'claim-4');
  assert.deepEqual((result.data as any).approvalSteps, [{ status: 'APPROVED', sequence: 1,
    actedAt: '2026-11-05T03:00:00Z', approverName: 'ผู้ที่เซ็นจริง' }]);
  assert.equal((result.data as any).payments[0].paidAt, '2026-11-06T03:00:00Z');
});

it('R22 summary narrows me within company, related and own permission scopes', async () => {
  for (const permission of ['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own']) {
    let query: any;
    const summary = new GetReimbursementAiSummaryUseCase({ findPolicy: async () => null, listRequests: async (where: any) => { query = where; return []; } } as any, { log: async () => {} } as any);
    await summary.execute({ companyId: 'co', userId: 'reader', permissions: [permission], scopes: { branchIds: ['branch'] } } as any, { requester: 'me', paymentStatus: 'PAID' } as any);
    assert.equal(query.requesterUserId, 'reader');
    assert.deepEqual(query.scopes, { branchIds: ['branch'] });
    assert.equal(query.relatedUserId, permission === 'reimbursement.read_related' ? 'reader' : undefined);
  }
});

it('R22 summary applies strict and inclusive thresholds and totals every currency beyond five shown claims', async () => {
  const rows = ['611', '1000', '1000.01', '1200', '1300', '1400', '1500', '1600'].map((amount, i) => ({ id: `claim-${i}`, title: 'ค่าเดินทาง รอบ 2', reason: '', requestNo: null,
    requesterDisplayNameSnapshot: 'สมชาย', amount, currency: i === 7 ? 'USD' : 'THB', status: 'DRAFT', paymentStatus: 'UNPAID', outstandingAmount: amount }));
  const summary = new GetReimbursementAiSummaryUseCase({ findPolicy: async () => null, listRequests: async () => rows } as any, { log: async () => {} } as any);
  const context: any = { companyId: 'co', userId: 'reader', permissions: ['reimbursement.read_own'] };
  for (const [key, count] of [['amountGt', 6], ['amountGte', 7], ['amountLt', 1], ['amountLte', 2]] as const) {
    const result: any = await summary.execute(context, { [key]: '1000', round: '2' });
    assert.equal(result.matchedCount, count);
    assert.equal(result.matchedItems.length, Math.min(count, 5));
    if (key === 'amountGt') assert.deepEqual(result.matchedTotalsByCurrency, [{ currency: 'THB', amount: '6400.01' }, { currency: 'USD', amount: '1600.00' }]);
    assert.equal(result.appliedFilters[key], '1000');
  }
});

it('R22 standalone round returns all matching claims, and free source-drafts permissions refuse before repository reads', async () => {
  let reads = 0;
  const summary = new GetReimbursementAiSummaryUseCase({ findPolicy: async () => null, listRequests: async () => { reads++; return [1, 2].map(id => ({ id: String(id), title: 'ค่าเดินทาง รอบ 2', reason: '', amount: '100', currency: 'THB', status: 'DRAFT' })); } } as any, { log: async () => {} } as any);
  const result: any = await summary.execute({ companyId: 'co', userId: 'reader', permissions: ['reimbursement.read_own'] } as any, { round: '2' });
  assert.equal(result.matchedCount, 2);
  assert.deepEqual(result.matchedTotalsByCurrency, [{ currency: 'THB', amount: '200.00' }]);
  await assert.rejects(() => summary.execute({ companyId: 'co', userId: 'reader', permissions: ['expense.read'], freeExpenseDrafts: true } as any, { round: '2' }), ForbiddenException);
  assert.equal(reads, 1);
});
