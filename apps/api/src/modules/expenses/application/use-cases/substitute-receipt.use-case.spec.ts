import { ctx as lineCtx, expense as lineExpense, harness as lineHarness, readyHarness as lineReadyHarness } from './line-substitute-receipt-continuation.use-case.spec';
import { SUBSTITUTE_PHOTO_ASK_WINDOW_MS, substituteAwaitsCaptionlessPhoto } from './line-substitute-receipt-continuation.use-case';
import { LineSubstituteReceiptActionService, buildSubstituteReceiptActionCard, buildSubstituteReceiptFactsCard } from '../../../line-ai/application/line-substitute-receipt-action.service';
import { ProcessLineWebhookUseCase, chatKeyHashOf } from '../../../line-ai/application/use-cases/process-line-webhook.use-case';
import { buildLineDeliveryPlan, lineDeliveryPlanId, validateLineDeliveryPlan } from '../../../line-ai/domain/logic/line-delivery-plan.logic';
import assert from 'node:assert/strict';
import { expenseEvidenceFingerprint, SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS } from '@watchdog-bms/contracts';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import {
  PaperSubstituteReceiptUseCase,
  ApproveSubstituteReceiptUseCase,
  CertifySubstituteReceiptUseCase,
  DownloadSubstituteReceiptFormPdfUseCase,
  DownloadSubstituteReceiptPdfUseCase,
  InitSubstituteSignatureUploadUseCase,
  PrepareSubstituteReceiptUseCase,
  ListCompanySubstituteReceiptsUseCase,
  ListSubstituteReceiptHistoryUseCase,
  ListSubstituteReceiptCandidatesUseCase,
  SubstituteReceiptEvidenceUploadUseCase,
  SaveOwnSubstituteReceiptReviewUseCase,
  PreviewSubstituteReceiptUseCase,
} from './substitute-receipt.use-case';
import { SetSignatureDerivedAssetUseCase } from './signature-asset.use-case';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { buildSubstituteCertificationText, canonicalSnapshotHash, type SubstituteReceiptSnapshot } from '../../domain/logic/substitute-receipt.logic';
import { buildDedupKey } from '../../../dashboard-notifications/domain/logic/notification.logic';
import { IMPLEMENTED_TRIGGER_KEYS } from '../../../dashboard-notifications/domain/models/notification.model';

const now = new Date('2026-07-13T10:00:00.000Z');
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const audit = { log: async () => undefined } as any;
const notification = { execute: async () => ({}) } as any;
const cleanup = { enqueue: async () => true } as any;

function ctx(userId = 'payer-1', permissions = ['expense.review'], roles: string[] = []) {
  return {
    requestId: 'req-1', authSubject: userId, sessionId: 's-1', userId,
    companyId: 'co-1', membershipId: `m-${userId}`, roles, permissions,
    scopes: {}, authProvider: 'watchdog',
  } as any;
}

function expense(overrides: Record<string, unknown> = {}) {
  const result = {
    id: 'exp-1', companyId: 'co-1', branchId: null, expenseNumber: 'EXP-1', status: 'NEEDS_REVIEW',
    captureSource: 'WEB_UPLOAD', sourceDocumentType: 'EXPENSE_NOTE_TEXT', taxEvidenceStatus: 'SUPPORTING_ONLY',
    inputVatClaimStatus: 'NON_CLAIMABLE', grandTotalAmount: '65.00', currency: 'THB', expenseDate: now,
    paidAmount: '0', paidAt: now, paymentMethod: 'CASH', bankAccountRef: null, expenseCategoryId: 'cat-1', accountHintKey: null,
    vendorNameSnapshot: 'ผู้ขายในตลาด',
    updatedAt: now, aiVerificationSummaryJson: null,
    lines: [{ description: 'ผักสด', quantity: '1', lineTotalAmount: '65.00', expenseCategoryId: 'cat-1', accountHintKey: null }],
    attachments: [{ id: 'att-source', purpose: 'expense.receipt.primary', originalFileName: 'bill.jpg', mimeType: 'image/jpeg', checksumSha256: 'src' }],
    ...overrides,
  } as any;
  const assessment = { route: 'SUBSTITUTE_RECEIPT' as const, receiptProblem: 'NOT_AVAILABLE' as const, attachmentIds: [], reason: 'ผู้ขายไม่ออกใบเสร็จ' };
  // These lifecycle fixtures have completed the human evidence review. Negative review cases below
  // remove or stale this marker explicitly; prepare/signature/numbering tests retain their focus.
  result.aiVerificationSummaryJson = { ...result.aiVerificationSummaryJson, documentReview: {
    version: 2, reviewedByUserId: 'finance-1', reviewedAt: now.toISOString(), assessment,
    fingerprint: expenseEvidenceFingerprint(result, assessment),
  } };
  return result;
}

function prepared(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1', companyId: 'co-1', expenseId: 'exp-1', branchId: null, version: 1, status: 'PREPARED',
    documentNumber: 'SRC-EXP-1-V1', idempotencyKey: 'idem-1', snapshotJson: null, snapshotChecksumSha256: null,
    originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', fundingSource: 'COMPANY' as const, reasonCode: 'PAYEE_CANNOT_ISSUE',
    missingReceiptReason: 'ผู้ขายในตลาดไม่ออกใบเสร็จ', businessPurpose: 'ซื้อวัตถุดิบ',
    paymentEvidenceAttachmentIds: [], supportingAttachmentIds: ['att-source'], paymentDate: now, paymentMethod: 'CASH', note: null,
    preparedByUserId: 'finance-1', preparedAt: now, expenseUpdatedAtAtPreparation: now,
    payerUserId: 'payer-1', payerName: 'สมชาย', payerPosition: null, payerSignatureAttachmentId: null, payerSignatureChecksumSha256: null,
    payeeName: 'ผู้ขายในตลาด', payeeAddress: null, payeeTaxId: null,
    certifiedArtifactAttachmentId: null, certifiedArtifactChecksumSha256: null, certifiedAt: null,
    approverUserId: null, approverName: null, approverPosition: null, approverSignatureAttachmentId: null, approvedAt: null,
    artifactAttachmentId: null, checksumSha256: null, issuedByUserId: null, issuedAt: null, supersededAt: null, supersedeReason: null,
    signatureMode: 'DIGITAL', wetSignedScanAttachmentId: null, wetSignedScanChecksumSha256: null, preparedFromChannel: 'WEB',
    createdAt: now, updatedAt: now,
    ...overrides,
  } as any;
}

describe('PrepareSubstituteReceiptUseCase', () => {
  it('amends incomplete facts through the existing validation and ignores client funding/signer overrides', async () => {
    let captured: any;
    const current = prepared();
    const repo = {
      findSubstituteEvidence: async (companyId: string, expenseId: string, evidenceId: string) => companyId === 'co-1' && expenseId === 'exp-1' && evidenceId === 'sub-1' ? current : null,
      findByIdWithRelations: async () => ({ ...expense(), aiVerificationSummaryJson: null }),
      findActiveMemberIdentity: async () => ({ userId: 'payer-1', displayName: 'สมชาย' }),
      getSubstituteReceiptPolicy: async () => ({ approvalMode: 'OWNER_SELF', cashEvidencePolicy: 'ALLOW_SUPPORTING_EVIDENCE_ONLY' }),
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1' }],
      findSubstituteEvidenceAttachments: async () => [],
      createPreparedSubstituteEvidence: async (input: any) => { captured = input; return prepared(); },
    } as any;
    const useCase = new PrepareSubstituteReceiptUseCase(repo, audit, notification);
    const input = { reasonCode: 'OTHER', missingReceiptReason: 'เหตุผลแก้ไข', businessPurpose: 'เพื่อกิจการ', paymentMethod: 'CASH',
      paymentDate: '2026-08-14', keepDocumentNumberConfirmed: true, payeeName: 'ร้านใหม่', expectedExpenseUpdatedAt: now.toISOString(), expectedEvidenceUpdatedAt: now.toISOString(),
      fundingSource: 'PERSONAL_ADVANCE', payerUserId: 'attacker', signatureMode: 'PAPER', continuationId: 'not-allowed',
    } as any;
    await useCase.executeAmendment(ctx(), 'exp-1', 'sub-1', input);
    assert.equal(captured.fundingSource, 'COMPANY'); assert.equal(captured.signatureMode, 'DIGITAL'); assert.equal(captured.payerUserId, 'payer-1');
    assert.equal(captured.paymentDate.toISOString(), '2026-08-14T00:00:00.000Z'); assert.equal(captured.lineContinuation, undefined);
    assert.deepEqual(captured.amendment, { evidenceId: 'sub-1', expectedUpdatedAt: now, keepDocumentNumberConfirmed: true, previousPaymentDate: now.toISOString() });
    await assert.rejects(useCase.executeAmendment(ctx('reader', []), 'exp-1', 'sub-1', input), /expense.review/);
    await assert.rejects(useCase.executeAmendment({ ...ctx(), authProvider: 'line' }, 'exp-1', 'sub-1', input), /authenticated web/);
    await assert.rejects(useCase.executeAmendment({ ...ctx(), companyId: 'other' }, 'exp-1', 'sub-1', input), /not found/);
    await assert.rejects(useCase.executeAmendment(ctx(), 'exp-1', 'sub-1', { ...input, expectedEvidenceUpdatedAt: '2026-01-01' }), /เปิดหน้านี้ใหม่/);
    await assert.rejects(useCase.executeAmendment(ctx(), 'exp-1', 'sub-1', { ...input, payeeTaxId: '123' }), /13 digits/);
    await assert.rejects(useCase.executeAmendment(ctx(), 'exp-1', 'sub-1', { ...input, paymentMethod: 'BANK_TRANSFER' }), /Attach separate proof/);
    await assert.rejects(useCase.executeAmendment(ctx(), 'exp-1', 'sub-1', { ...input, paymentDate: '2026-02-31' }), /วันที่จ่ายเงินไม่ถูกต้อง/);
    await assert.rejects(useCase.executeAmendment(ctx(), 'exp-1', 'sub-1', { ...input, paymentMethod: 'invalid' }), /วิธีจ่ายไม่ถูกต้อง/);
    for (const status of ['ISSUED', 'SUPERSEDED']) {
      current.status = status;
      await assert.rejects(useCase.executeAmendment(ctx(), 'exp-1', 'sub-1', input), /เปิดหน้านี้ใหม่/);
    }
  });
  it('prepares a version without replacing the original source type', async () => {
    let captured: any;
    const notifications: any[] = [];
    const repo = {
      findByIdWithRelations: async () => expense(),
      findActiveMemberIdentity: async () => ({ userId: 'payer-1', displayName: 'สมชาย' }),
      getSubstituteReceiptPolicy: async () => ({ approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['approver-1'], cashEvidencePolicy: 'ALLOW_SUPPORTING_EVIDENCE_ONLY' }),
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
      findSubstituteEvidenceAttachments: async () => [{ id: 'att-source', originalFileName: 'bill.jpg' }],
      createPreparedSubstituteEvidence: async (input: any) => { captured = input; return prepared(); },
    } as any;
    const useCase = new PrepareSubstituteReceiptUseCase(repo, audit, {
      execute: async (input: any) => { notifications.push(input); return {}; },
    } as any);
    await useCase.execute(ctx('finance-1'), 'exp-1', {
      fundingSource: 'COMPANY' as const, paidInFullAcknowledged: true as const,
      reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'ผู้ขายในตลาดไม่ออกใบเสร็จ',
      businessPurpose: 'ซื้อวัตถุดิบ', payerUserId: 'payer-1', supportingAttachmentIds: ['att-source'],
      payeeAddress: '  1 ถนนทดสอบ  ', payeeTaxId: '1-2345-67890-12-3',
      paymentMethod: 'CASH', idempotencyKey: 'idem-1', expectedExpenseUpdatedAt: now.toISOString(),
      continuationId: 'workflow-1',
    });
    assert.equal(captured.originalSourceDocumentType, 'EXPENSE_NOTE_TEXT');
    assert.equal(captured.payerUserId, 'payer-1');
    assert.equal(captured.payeeName, 'ผู้ขายในตลาด');
    assert.equal(captured.payeeAddress, '1 ถนนทดสอบ');
    assert.equal(captured.payeeTaxId, '1234567890123');
    assert.equal(captured.paymentEvidenceAttachmentIds.length, 0);
    assert.deepEqual(captured.lineContinuation, { workflowId: 'workflow-1', userId: 'finance-1', formRequested: false });
    assert.deepEqual(notifications, [{
      companyId: 'co-1',
      triggerKey: 'expense.substitute_receipt_signature_pending',
      sourceModule: 'expenses',
      sourceType: 'substitute_receipt_evidence',
      sourceId: 'sub-1',
      severity: 'action',
      title: 'ใบรับรองแทนใบเสร็จรอการลงลายมือชื่อ เลขที่ SRC-EXP-1-V1',
      body: 'เปิดระบบเพื่อตรวจสอบเอกสารและลงลายมือชื่อ',
      deepLinkHref: '/companies/co-1/expenses/substitute-receipts/sub-1',
      recipientUserIds: ['payer-1'],
    }]);
  });

  it('does not notify the actor when they prepare a certificate for themselves', async () => {
    let notificationCount = 0;
    const repo = {
      findByIdWithRelations: async () => expense(),
      findActiveMemberIdentity: async () => ({ userId: 'payer-1', displayName: 'สมชาย' }),
      getSubstituteReceiptPolicy: async () => ({ approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['approver-1'], cashEvidencePolicy: 'ALLOW_SUPPORTING_EVIDENCE_ONLY' }),
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
      findSubstituteEvidenceAttachments: async () => [{ id: 'att-source', originalFileName: 'bill.jpg' }],
      createPreparedSubstituteEvidence: async () => prepared(),
    } as any;
    await new PrepareSubstituteReceiptUseCase(repo, audit, {
      execute: async () => { notificationCount += 1; return {}; },
    } as any).execute(ctx('payer-1'), 'exp-1', {
      fundingSource: 'COMPANY' as const, paidInFullAcknowledged: true as const,
      reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'ผู้ขายในตลาดไม่ออกใบเสร็จ',
      businessPurpose: 'ซื้อวัตถุดิบ', payerUserId: 'payer-1', supportingAttachmentIds: ['att-source'],
      paymentMethod: 'CASH', idempotencyKey: 'idem-1', expectedExpenseUpdatedAt: now.toISOString(),
    });
    assert.equal(notificationCount, 0);
  });

  it('requires a payee name without a vendor snapshot and requires 13 tax-ID digits', async () => {
    const input = {
      fundingSource: 'COMPANY' as const, paidInFullAcknowledged: true as const,
      reasonCode: 'PAYEE_CANNOT_ISSUE' as const, missingReceiptReason: 'ผู้ขายไม่ออกใบเสร็จ',
      businessPurpose: 'ซื้อวัตถุดิบ', payerUserId: 'payer-1', supportingAttachmentIds: ['att-source'],
      paymentMethod: 'CASH' as const, idempotencyKey: 'idem-1', expectedExpenseUpdatedAt: now.toISOString(),
    };
    await assert.rejects(
      () => new PrepareSubstituteReceiptUseCase({ findByIdWithRelations: async () => expense({ vendorNameSnapshot: null }) } as any, audit, notification)
        .execute(ctx('finance-1'), 'exp-1', input),
      /payeeName is required/,
    );
    await assert.rejects(
      () => new PrepareSubstituteReceiptUseCase({ findByIdWithRelations: async () => expense() } as any, audit, notification)
        .execute(ctx('finance-1'), 'exp-1', { ...input, payeeTaxId: '123-456' }),
      /exactly 13 digits/,
    );
  });

  it('rejects valid receipts and quantity-only/zero-value documents', async () => {
    const make = (row: any) => new PrepareSubstituteReceiptUseCase({ findByIdWithRelations: async () => row } as any, audit, notification);
    const input = {
      fundingSource: 'COMPANY' as const, paidInFullAcknowledged: true as const,
      reasonCode: 'OTHER' as const, missingReceiptReason: 'x', businessPurpose: 'y', payerUserId: 'payer-1',
      supportingAttachmentIds: ['att-source'], idempotencyKey: 'idem-1', expectedExpenseUpdatedAt: now.toISOString(),
    };
    await assert.rejects(() => make(expense({ sourceDocumentType: 'RECEIPT' })).execute(ctx('finance-1'), 'exp-1', input), /ใบรับรองแทนใบเสร็จรับเงินใช้ได้เมื่อต้นฉบับหายหรือข้อมูลสำคัญไม่ครบ/);
    await assert.rejects(() => make(expense({ grandTotalAmount: '0' })).execute(ctx('finance-1'), 'exp-1', input), /ยอดรวมที่ตรวจแล้วต้องมากกว่า 0 บาท/);
  });

  it('routes only an authoritative paid check bill through the same expense', async () => {
    let captured: any;
    const repo = {
      findByIdWithRelations: async () => expense({
        sourceDocumentType: 'OTHER_EXPENSE_DOCUMENT',
        taxEvidenceStatus: 'SUPPORTING_ONLY',
        aiVerificationSummaryJson: {
          status: 'NOT_EXPENSE_DOCUMENT',
          classification: { documentKind: 'ORDER_OR_CHECK_BILL' },
        },
      }),
      findActiveMemberIdentity: async () => ({ userId: 'payer-1', displayName: 'สมชาย' }),
      getSubstituteReceiptPolicy: async () => null,
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
      findSubstituteEvidenceAttachments: async () => [{
        id: 'att-source', purpose: 'expense.receipt.primary', originalFileName: 'check-bill.jpg', mimeType: 'image/jpeg',
      }, { id: 'att-payment', purpose: 'expense.payment.evidence', originalFileName: 'cash-payment.jpg', mimeType: 'image/jpeg' }],
      createPreparedSubstituteEvidence: async (input: any) => { captured = input; return prepared({ originalSourceDocumentType: 'NEEDS_REVIEW' }); },
    } as any;
    const input = {
      fundingSource: 'COMPANY' as const, paidInFullAcknowledged: true as const,
      reasonCode: 'RECEIPT_UNAVAILABLE' as const,
      missingReceiptReason: 'ชำระแล้วแต่ร้านไม่ออกใบเสร็จฉบับสุดท้าย',
      businessPurpose: 'รับรองลูกค้า', payerUserId: 'payer-1', supportingAttachmentIds: ['att-source'],
      paymentMethod: 'CASH' as const, idempotencyKey: 'idem-check-bill', expectedExpenseUpdatedAt: now.toISOString(),
      routeCheckBill: true as const,
      paymentEvidenceAttachmentIds: ['att-payment'],
    };

    await new PrepareSubstituteReceiptUseCase(repo, audit, notification).execute(ctx('finance-1'), 'exp-1', input);
    assert.equal(captured.routeCheckBill, true);
    assert.equal(captured.originalSourceDocumentType, 'OTHER_EXPENSE_DOCUMENT');

    await assert.rejects(
      () => new PrepareSubstituteReceiptUseCase({ ...repo, findByIdWithRelations: async () => expense() } as any, audit, notification)
        .execute(ctx('finance-1'), 'exp-1', input),
      /ใช้ได้เฉพาะเช็กบิล/,
    );
  });

  it('requires separate actual payment proof for check bills regardless of cash policy, finance override, or a previously resolved route', async () => {
    let writes = 0;
    const checkBillSummary = { status: 'NOT_EXPENSE_DOCUMENT', classification: { documentKind: 'ORDER_OR_CHECK_BILL' } };
    const input = { fundingSource: 'COMPANY' as const, paidInFullAcknowledged: true as const, reasonCode: 'RECEIPT_UNAVAILABLE' as const, missingReceiptReason: 'ชำระแล้วแต่ไม่มีใบเสร็จ',
      businessPurpose: 'รับรองลูกค้า', payerUserId: 'payer-1', expectedExpenseUpdatedAt: now.toISOString(),
      idempotencyKey: 'check-payment', routeCheckBill: true as const, paymentEvidenceAttachmentIds: [] as string[] };
    const make = (summary: any, policy: any, attachments: any[] = [], extra: any = {}) => new PrepareSubstituteReceiptUseCase({
      findByIdWithRelations: async () => expense({ primaryAttachmentId: 'att-source', aiVerificationSummaryJson: summary, ...extra }),
      findActiveMemberIdentity: async () => ({ userId: 'payer-1', displayName: 'สมชาย' }),
      getSubstituteReceiptPolicy: async () => policy,
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1' }],
      findSubstituteEvidenceAttachments: async () => attachments,
      createPreparedSubstituteEvidence: async () => { writes++; return prepared(); },
    } as any, audit, notification);
    const codeIs = (code: string) => (error: unknown) => {
      assert.ok(error instanceof BadRequestException || error instanceof ConflictException);
      assert.equal((error.getResponse() as { code: string }).code, code);
      return true;
    };
    const resolved = { ...checkBillSummary, classificationResolution: {
      outcome: 'ROUTED_TO_SUBSTITUTE_RECEIPT', acknowledgedPaidWithoutFinalReceipt: true,
      sourceDocumentKind: 'ORDER_OR_CHECK_BILL', resolvedAt: now.toISOString(), resolvedByUserId: 'finance-1',
    } };
    const overridden = { ...checkBillSummary, classificationResolution: {
      outcome: 'FINANCE_OVERRIDDEN_AS_EXPENSE', acknowledged: true,
      sourceDocumentType: 'EXPENSE_NOTE_TEXT', reason: 'finance checked', resolvedAt: now.toISOString(), resolvedByUserId: 'finance-1',
    } };
    for (const summary of [checkBillSummary, overridden, resolved]) {
      for (const policy of [null, { cashEvidencePolicy: 'ALLOW_SUPPORTING_EVIDENCE_ONLY' }, { cashEvidencePolicy: 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE' }]) {
        for (const paymentMethod of ['CASH', 'BANK_TRANSFER', 'CARD'] as const) {
          await assert.rejects(() => make(summary, policy).execute(ctx(), 'exp-1', { ...input, paymentMethod }), codeIs('check_bill_payment_evidence_required'));
        }
      }
    }
    // An old route cannot turn a false/omitted flag into a cash-policy escape hatch.
    for (const routeCheckBill of [undefined, false]) {
      await assert.rejects(() => make(resolved, null).execute(ctx(), 'exp-1', { ...input, routeCheckBill } as any), codeIs('check_bill_payment_evidence_required'));
      await assert.rejects(() => make(overridden, null).execute(ctx(), 'exp-1', { ...input, routeCheckBill } as any), codeIs('check_bill_route_required'));
    }
    const payment = { id: 'proof', purpose: 'expense.payment.evidence', originalFileName: 'paid.jpg', mimeType: 'image/jpeg' };
    const proofInput = { ...input, paymentEvidenceAttachmentIds: ['proof'] };
    for (const invalid of [{ ...payment, purpose: 'expense.receipt.primary' }, { ...payment, mimeType: 'text/plain' }]) {
      await assert.rejects(() => make(checkBillSummary, null, [invalid]).execute(ctx(), 'exp-1', proofInput), codeIs('substitute_payment_evidence_invalid'));
    }
    await assert.rejects(() => make(checkBillSummary, null, [{ ...payment, id: 'att-source' }]).execute(ctx(), 'exp-1', {
      ...input, paymentEvidenceAttachmentIds: ['att-source'],
    }), codeIs('substitute_payment_evidence_invalid'));
    await assert.rejects(() => make(checkBillSummary, null).execute(ctx(), 'exp-1', {
      ...input, supportingAttachmentIds: ['proof'], paymentEvidenceAttachmentIds: ['proof'],
    }), codeIs('substitute_evidence_overlap'));
    // Cancelled certificate files remain viewable history, never new payment proof.
    await assert.rejects(() => make(checkBillSummary, null, [payment], { attachments: [{ ...payment, isHistorical: true }] }).execute(ctx(), 'exp-1', proofInput), codeIs('substitute_evidence_unavailable'));
    // Repository returns no match for inactive, unlinked, or other-tenant evidence.
    await assert.rejects(() => make(checkBillSummary, null).execute(ctx(), 'exp-1', proofInput), codeIs('substitute_evidence_unavailable'));
    await assert.rejects(() => make(checkBillSummary, null).execute(ctx(), 'exp-1', {
      ...input, expectedExpenseUpdatedAt: new Date(now.getTime() - 1000).toISOString(),
    }), codeIs('substitute_expense_changed'));
    assert.equal(writes, 0);
    await make(checkBillSummary, null, [payment]).execute(ctx(), 'exp-1', proofInput);
    assert.equal(writes, 1);
    await make(resolved, null, [payment]).execute(ctx(), 'exp-1', { ...proofInput, routeCheckBill: undefined });
    assert.equal(writes, 2, 'an already-resolved route remains usable with valid proof');
  });

  it('keeps coded repository conflicts actionable without retrying a stale prepare', async () => {
    const stale = new ConflictException({ code: 'expense_stale_reload', message: 'Reload before preparing.' });
    const useCase = new PrepareSubstituteReceiptUseCase({
      findByIdWithRelations: async () => expense(),
      findActiveMemberIdentity: async () => ({ userId: 'payer-1', displayName: 'สมชาย' }),
      getSubstituteReceiptPolicy: async () => null,
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1' }],
      findSubstituteEvidenceAttachments: async () => [],
      createPreparedSubstituteEvidence: async () => { throw stale; },
    } as any, audit, notification);
    await assert.rejects(() => useCase.execute(ctx(), 'exp-1', {
      fundingSource: 'COMPANY' as const, paidInFullAcknowledged: true as const,
      reasonCode: 'OTHER', missingReceiptReason: 'ไม่มีใบเสร็จ', businessPurpose: 'ใช้ในกิจการ', payerUserId: 'payer-1',
      expectedExpenseUpdatedAt: now.toISOString(), idempotencyKey: 'stale-prepare',
    }), (error) => error === stale);
  });

  it('rejects certificate layouts beyond the shared line bounds before preparation', async () => {
    const make = (row: any) => new PrepareSubstituteReceiptUseCase({ findByIdWithRelations: async () => row } as any, audit, notification);
    const input = {
      fundingSource: 'COMPANY' as const, paidInFullAcknowledged: true as const,
      reasonCode: 'OTHER' as const, missingReceiptReason: 'ไม่มีใบเสร็จ', businessPurpose: 'ใช้ในกิจการ', payerUserId: 'payer-1',
      supportingAttachmentIds: ['att-source'], idempotencyKey: 'idem-layout', expectedExpenseUpdatedAt: now.toISOString(),
    };
    const codeIs = (expected: string) => (error: unknown) => {
      assert.equal((error as { getResponse(): { code?: string } }).getResponse().code, expected);
      return true;
    };

    await assert.rejects(
      () => make(expense({ lines: Array.from({ length: 9 }, () => expense().lines[0]) }))
        .execute(ctx('finance-1'), 'exp-1', input),
      codeIs('substitute_receipt_too_many_lines'),
    );
    await assert.rejects(
      () => make(expense({ lines: [{ ...expense().lines[0], description: 'ก'.repeat(201) }] }))
        .execute(ctx('finance-1'), 'exp-1', input),
      codeIs('substitute_receipt_line_description_too_long'),
    );
  });

  it('rejects too many or overlong linked evidence names before persisting a prepared version', async () => {
    const baseRepo = {
      findByIdWithRelations: async () => expense(),
      findActiveMemberIdentity: async () => ({ userId: 'payer-1', displayName: 'สมชาย' }),
      getSubstituteReceiptPolicy: async () => ({
        approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['approver-1'], cashEvidencePolicy: 'ALLOW_SUPPORTING_EVIDENCE_ONLY',
      }),
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
    };
    const input = {
      fundingSource: 'COMPANY' as const, paidInFullAcknowledged: true as const,
      reasonCode: 'OTHER' as const, missingReceiptReason: 'ไม่มีใบเสร็จ', businessPurpose: 'ใช้ในกิจการ', payerUserId: 'payer-1',
      paymentMethod: 'CASH' as const, idempotencyKey: 'idem-evidence', expectedExpenseUpdatedAt: now.toISOString(),
    };
    const codeIs = (expected: string) => (error: unknown) => {
      assert.equal((error as { getResponse(): { code?: string } }).getResponse().code, expected);
      return true;
    };

    await assert.rejects(
      () => new PrepareSubstituteReceiptUseCase(baseRepo as any, audit, notification).execute(ctx('finance-1'), 'exp-1', {
        ...input,
        supportingAttachmentIds: Array.from({ length: 9 }, (_, index) => `att-${index}`),
      }),
      codeIs('substitute_receipt_too_many_evidence'),
    );
    await assert.rejects(
      () => new PrepareSubstituteReceiptUseCase({
        ...baseRepo,
        findSubstituteEvidenceAttachments: async () => [{
          id: 'att-source', purpose: 'expense.receipt.supporting', originalFileName: `${'ก'.repeat(252)}.pdf`, mimeType: 'application/pdf',
        }],
      } as any, audit, notification).execute(ctx('finance-1'), 'exp-1', {
        ...input, supportingAttachmentIds: ['att-source'],
      }),
      codeIs('substitute_receipt_evidence_filename_too_long'),
    );
  });

  it('accepts the exact shared line and evidence boundary', async () => {
    const limits = SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS;
    let persisted = false;
    const repo = {
      findByIdWithRelations: async () => expense({
        lines: Array.from({ length: limits.maxExpenseLines }, () => ({
          ...expense().lines[0], description: 'ก'.repeat(limits.maxLineDescriptionLength),
        })),
      }),
      findActiveMemberIdentity: async () => ({ userId: 'payer-1', displayName: 'สมชาย' }),
      getSubstituteReceiptPolicy: async () => ({
        approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['approver-1'], cashEvidencePolicy: 'ALLOW_SUPPORTING_EVIDENCE_ONLY',
      }),
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
      findSubstituteEvidenceAttachments: async (_companyId: string, _expenseId: string, ids: string[]) => ids.map((id) => ({
        id, purpose: 'expense.receipt.supporting', originalFileName: `${'ก'.repeat(limits.maxEvidenceFileNameLength - 4)}.pdf`, mimeType: 'application/pdf',
      })),
      createPreparedSubstituteEvidence: async () => { persisted = true; return prepared(); },
    } as any;

    await new PrepareSubstituteReceiptUseCase(repo, audit, notification).execute(ctx('finance-1'), 'exp-1', {
      fundingSource: 'COMPANY' as const, paidInFullAcknowledged: true as const,
      reasonCode: 'OTHER', missingReceiptReason: 'ไม่มีใบเสร็จ', businessPurpose: 'ใช้ในกิจการ', payerUserId: 'payer-1',
      supportingAttachmentIds: Array.from({ length: limits.maxEvidenceAttachments }, (_, index) => `att-${index}`),
      paymentMethod: 'CASH', idempotencyKey: 'idem-boundary', expectedExpenseUpdatedAt: now.toISOString(),
    });
    assert.equal(persisted, true);
  });

  it('prepares without a policy row under the permissive cash-evidence default', async () => {
    let captured: any;
    const baseRepo = {
      findByIdWithRelations: async () => expense(),
      findActiveMemberIdentity: async () => ({ userId: 'payer-1', displayName: 'สมชาย' }),
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
      findSubstituteEvidenceAttachments: async (_companyId: string, _expenseId: string, ids: string[]) => ids.map((id) => ({
        id,
        originalFileName: `${id}.jpg`,
        purpose: id === 'att-payment' ? 'expense.payment.evidence' : 'expense.receipt.primary',
        mimeType: 'image/jpeg',
      })),
      createPreparedSubstituteEvidence: async (input: any) => { captured = input; return prepared(); },
    };
    const input = {
      fundingSource: 'COMPANY' as const, paidInFullAcknowledged: true as const,
      reasonCode: 'PAYEE_CANNOT_ISSUE' as const, missingReceiptReason: 'ผู้ขายไม่ออกใบเสร็จ',
      businessPurpose: 'ซื้อวัตถุดิบ', payerUserId: 'payer-1', supportingAttachmentIds: ['att-source'],
      paymentMethod: 'CASH' as const, idempotencyKey: 'idem-1', expectedExpenseUpdatedAt: now.toISOString(),
    };
    await new PrepareSubstituteReceiptUseCase({
      ...baseRepo, getSubstituteReceiptPolicy: async () => null,
    } as any, audit, notification).execute(ctx('finance-1'), 'exp-1', {
      ...input, paymentEvidenceAttachmentIds: ['att-payment'],
    });
    assert.deepEqual(captured.paymentEvidenceAttachmentIds, ['att-payment']);
    // R6: no policy row now means ALLOW_SUPPORTING_EVIDENCE_ONLY — the same cash prepare passes.
    await new PrepareSubstituteReceiptUseCase({
      ...baseRepo, getSubstituteReceiptPolicy: async () => null,
    } as any, audit, notification).execute(ctx('finance-1'), 'exp-1', input);
    assert.deepEqual(captured.paymentEvidenceAttachmentIds, []);
  });

  it('R5: prepares a large cash expense with no attachment at all and audits evidenceCount 0', async () => {
    const auditRows: any[] = [];
    let captured: any;
    const repo = {
      findByIdWithRelations: async () => expense({ grandTotalAmount: '48500.00', attachments: [] }),
      findActiveMemberIdentity: async () => ({ userId: 'payer-1', displayName: 'สมชาย' }),
      getSubstituteReceiptPolicy: async () => null,
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
      findSubstituteEvidenceAttachments: async () => [],
      createPreparedSubstituteEvidence: async (input: any) => { captured = input; return prepared({ supportingAttachmentIds: [] }); },
    } as any;
    const input = {
      fundingSource: 'COMPANY' as const, paidInFullAcknowledged: true as const,
      reasonCode: 'PAYEE_CANNOT_ISSUE' as const, missingReceiptReason: 'วินมอเตอร์ไซค์ไม่ออกใบเสร็จ',
      businessPurpose: 'เดินทางไปพบลูกค้า', payerUserId: 'payer-1',
      paymentMethod: 'CASH' as const, idempotencyKey: 'idem-none', expectedExpenseUpdatedAt: now.toISOString(),
    };
    await new PrepareSubstituteReceiptUseCase(repo, {
      log: async (row: any) => { auditRows.push(row); },
    } as any, notification).execute(ctx('finance-1'), 'exp-1', input);
    assert.deepEqual(captured.supportingAttachmentIds, []);
    assert.deepEqual(captured.paymentEvidenceAttachmentIds, []);
    assert.equal(auditRows[0].action, 'expense.substitute_receipt.prepare');
    assert.equal(auditRows[0].metadataJson.evidenceCount, 0, 'auditors can list every no-evidence document in one query');

    // The removed guard was unconditional; the rules that still gate the document are unchanged.
    await assert.rejects(() => new PrepareSubstituteReceiptUseCase({
      ...repo, getSubstituteReceiptPolicy: async () => ({
        approvalMode: 'OWNER_SELF', approverUserIds: [], cashEvidencePolicy: 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE',
      }),
    } as any, audit, notification).execute(ctx('finance-1'), 'exp-1', input),
    /Attach separate proof of actual payment/);
    await assert.rejects(() => new PrepareSubstituteReceiptUseCase(repo, audit, notification)
      .execute(ctx('finance-1'), 'exp-1', { ...input, paymentMethod: 'BANK_TRANSFER' }),
    /Attach separate proof of actual payment/);
    await assert.rejects(() => new PrepareSubstituteReceiptUseCase(repo, audit, notification)
      .execute(ctx('finance-1'), 'exp-1', { ...input, businessPurpose: '  ' }),
    /businessPurpose/);
  });
});

describe('substitute receipt signing lifecycle', () => {
  it('accepts omitted positions through digital and legacy paper certification and approval', async () => {
    for (const authProvider of ['watchdog']) for (const signatureMode of ['DIGITAL', 'PAPER']) {
      const actor = (...args: Parameters<typeof ctx>) => ({ ...ctx(...args), authProvider });
      let evidence = prepared({ signatureMode, ...(signatureMode === 'PAPER' ? { wetSignedScanAttachmentId: 'scan', wetSignedScanChecksumSha256: 'scan-sha' } : {}), supportingAttachmentIds: [] });
      let issuedInput: any;
      const repo = {
        findSubstituteEvidence: async () => evidence,
        findById: async () => expense(), findByIdWithRelations: async () => expense(),
        findSubstituteEvidenceAttachments: async () => [],
        getSubstituteCompanyContext: async () => ({ name: 'บริษัท ทดสอบ จำกัด', taxId: null, branchName: null }),
        findPersonalSignatureAttachment: async () => ({ id: 'sig', bucket: 'b', objectKey: 'sig', mimeType: 'image/png', byteSize: png.length, checksumSha256: null }),
        getSubstituteReceiptPolicy: async () => ({ approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['approver-1'] }),
        listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้อนุมัติ' }],
        findActiveMemberIdentity: async () => ({ userId: 'approver-1', displayName: 'ผู้อนุมัติ' }),
        markSubstituteEvidenceCertified: async (input: any) => {
          evidence = prepared({ ...evidence, ...input, status: 'PAYER_CERTIFIED', certifiedArtifactChecksumSha256: input.artifact.checksumSha256 });
          return evidence;
        },
        issueSubstituteEvidence: async (input: any) => { issuedInput = input; return prepared({ ...evidence, status: 'ISSUED' }); },
      } as any;
      const storage = { getObject: async () => ({ bytes: png }), putObject: async (input: any) => ({ bucket: 'b', objectKey: input.objectKey, byteSize: input.bytes.length }), deleteObject: async () => {} } as any;
      const events: any[] = [];
      const signingAudit = { log: async (event: any) => { events.push(event); } } as any;
      const previewCase = new PreviewSubstituteReceiptUseCase(repo);
      const certifyCase = new CertifySubstituteReceiptUseCase(repo, storage, signingAudit, notification, cleanup);
      const approveCase = new ApproveSubstituteReceiptUseCase(repo, storage, signingAudit, cleanup);
      const preview = await previewCase.execute(actor(), 'exp-1', 'sub-1', {});
      for (const position of [123, 'ก'.repeat(121)]) {
        await assert.rejects(previewCase.execute(actor(), 'exp-1', 'sub-1', { payerPosition: position } as any), /payerPosition/);
        await assert.rejects(certifyCase.execute(actor(), 'exp-1', 'sub-1', { certificationAcknowledged: true, payerPosition: position } as any), /payerPosition/);
        await assert.rejects(approveCase.execute(actor('approver-1', ['expense.confirm']), 'exp-1', 'sub-1', { approvalAcknowledged: true, approverPosition: position } as any), /approverPosition/);
      }
      const certifyInput = { certificationAcknowledged: true as const, signatureAttachmentId: 'sig', previewChecksumSha256: preview.previewChecksumSha256, expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString() };
      await assert.rejects(certifyCase.execute(actor(), 'exp-1', 'sub-1', { ...certifyInput, payerPosition: 'เปลี่ยนหลังตรวจ' }), /preview no longer matches/);
      await certifyCase.execute(actor(), 'exp-1', 'sub-1', certifyInput);
      assert.equal(evidence.payerPosition, '');
      assert.equal(evidence.snapshotJson.payer.position, '');
      assert.doesNotMatch(evidence.snapshotJson.certificationText, /ตำแหน่ง/);
      await approveCase.execute(actor('approver-1', ['expense.confirm']), 'exp-1', 'sub-1', { approvalAcknowledged: true, signatureAttachmentId: 'sig', certifiedArtifactChecksumSha256: evidence.certifiedArtifactChecksumSha256, expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString() });
      assert.equal(issuedInput.approverPosition, '');
      assert.deepEqual(events.map(event => event.action), ['expense.substitute_receipt.certify', 'expense.substitute_receipt.approve']);
      assert.ok(events.every(event => event.metadataJson.source === (authProvider === 'line' ? 'LINE' : 'WEB')));
      assert.deepEqual(events.map(event => event.actorUserId), ['payer-1', 'approver-1']);
    }
  });

  it('allows only the selected payer and stores a signed immutable snapshot', async () => {
    const evidence = prepared();
    const storageWrites: any[] = [];
    let certifiedInput: any;
    let companyReads = 0;
    const notifications: any[] = [];
    const repo = {
      findSubstituteEvidence: async () => evidence,
      findByIdWithRelations: async () => expense(),
      findPersonalSignatureAttachment: async () => ({ id: 'sig-payer', bucket: 'b', objectKey: 'sig', mimeType: 'image/png', byteSize: png.length, checksumSha256: null }),
      findSubstituteEvidenceAttachments: async () => [{ id: 'att-source', purpose: 'expense.receipt.primary', originalFileName: 'bill.jpg', mimeType: 'image/jpeg', checksumSha256: 'src' }],
      getSubstituteCompanyContext: async () => ({ name: ++companyReads <= 2 ? 'บริษัท ทดสอบ จำกัด' : 'Unreviewed B', taxId: '0101', branchName: null }),
      markSubstituteEvidenceCertified: async (input: any) => { certifiedInput = input; return prepared({ status: 'PAYER_CERTIFIED' }); },
      getSubstituteReceiptPolicy: async () => ({ approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['payer-1', 'approver-1'] }),
      listEligibleSubstituteReceiptApprovers: async () => [
        { userId: 'payer-1', displayName: 'สมชาย' },
        { userId: 'approver-1', displayName: 'ผู้จัดการ' },
        { userId: 'unconfigured-1', displayName: 'ผู้ตรวจสอบ' },
      ],
    } as any;
    const storage = {
      getObject: async () => ({ bytes: png, mimeType: 'image/png' }),
      putObject: async (input: any) => { storageWrites.push(input); return { bucket: 'b', objectKey: input.objectKey, storageProvider: 'local', byteSize: input.bytes.length }; },
      deleteObject: async () => undefined,
    } as any;
    const useCase = new CertifySubstituteReceiptUseCase(repo, storage, audit, {
      execute: async (input: any) => { notifications.push(input); return {}; },
    } as any, cleanup);
    const preview = await new PreviewSubstituteReceiptUseCase(repo).execute(ctx('payer-1'), 'exp-1', 'sub-1', { payerPosition: 'พนักงาน' });
    await assert.rejects(() => useCase.execute(ctx('other-user'), 'exp-1', 'sub-1', {
      payerPosition: 'พนักงาน', certificationAcknowledged: true, signatureAttachmentId: 'sig-payer',
      previewChecksumSha256: preview.previewChecksumSha256,
      expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
    }), /selected actual payer/);
    await useCase.execute(ctx('payer-1'), 'exp-1', 'sub-1', {
      payerPosition: 'พนักงาน', certificationAcknowledged: true, signatureAttachmentId: 'sig-payer',
      previewChecksumSha256: preview.previewChecksumSha256,
      expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
    });
    assert.equal(storageWrites[0].mimeType, 'image/svg+xml');
    assert.equal(certifiedInput.snapshotJson.originalSourceDocumentType, 'EXPENSE_NOTE_TEXT');
    assert.equal(certifiedInput.snapshotChecksumSha256, canonicalSnapshotHash(certifiedInput.snapshotJson));
    assert.deepEqual(notifications.map((item) => item.recipientUserIds), [['approver-1']]);
    assert.equal(notifications[0].triggerKey, 'expense.substitute_receipt_approval_pending');
    assert.equal(notifications[0].sourceId, 'sub-1');
    assert.equal(companyReads, 2, 'certification must reuse its reviewed business snapshot');
    assert.equal(certifiedInput.snapshotJson.company.name, 'บริษัท ทดสอบ จำกัด');
  });

  // Guard for the collision that silently dropped every approver notification: prepare and certify
  // emit for the same evidence id, so if they ever share a triggerKey again their dedup keys match,
  // prepare's cooldown swallows certify, and the approver gets no recipient or delivery row.
  it('gives the payer and approver stages distinct dedup keys for the same certificate', async () => {
    const prepareNotifications: any[] = [];
    const certifyNotifications: any[] = [];
    const evidence = prepared();
    const prepareRepo = {
      findByIdWithRelations: async () => expense(),
      findActiveMemberIdentity: async () => ({ userId: 'payer-1', displayName: 'สมชาย' }),
      getSubstituteReceiptPolicy: async () => ({ approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['approver-1'], cashEvidencePolicy: 'ALLOW_SUPPORTING_EVIDENCE_ONLY' }),
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
      findSubstituteEvidenceAttachments: async () => [{ id: 'att-source', originalFileName: 'bill.jpg' }],
      createPreparedSubstituteEvidence: async () => evidence,
    } as any;
    await new PrepareSubstituteReceiptUseCase(prepareRepo, audit, {
      execute: async (input: any) => { prepareNotifications.push(input); return {}; },
    } as any).execute(ctx('finance-1'), 'exp-1', {
      fundingSource: 'COMPANY' as const, paidInFullAcknowledged: true as const,
      reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'ผู้ขายในตลาดไม่ออกใบเสร็จ',
      businessPurpose: 'ซื้อวัตถุดิบ', payerUserId: 'payer-1', supportingAttachmentIds: ['att-source'],
      paymentMethod: 'CASH', idempotencyKey: 'idem-dedup', expectedExpenseUpdatedAt: now.toISOString(),
    });

    const certifyRepo = {
      findSubstituteEvidence: async () => evidence,
      findByIdWithRelations: async () => expense(),
      findPersonalSignatureAttachment: async () => ({ id: 'sig-payer', bucket: 'b', objectKey: 'sig', mimeType: 'image/png', byteSize: png.length, checksumSha256: null }),
      findSubstituteEvidenceAttachments: async () => [{ id: 'att-source', purpose: 'expense.receipt.primary', originalFileName: 'bill.jpg', mimeType: 'image/jpeg', checksumSha256: 'src' }],
      getSubstituteCompanyContext: async () => ({ name: 'บริษัท ทดสอบ จำกัด', taxId: '0101', branchName: null }),
      markSubstituteEvidenceCertified: async () => prepared({ status: 'PAYER_CERTIFIED' }),
      getSubstituteReceiptPolicy: async () => ({ approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['approver-1'] }),
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
    } as any;
    const storage = {
      getObject: async () => ({ bytes: png, mimeType: 'image/png' }),
      putObject: async (input: any) => ({ bucket: 'b', objectKey: input.objectKey, storageProvider: 'local', byteSize: input.bytes.length }),
      deleteObject: async () => undefined,
    } as any;
    const preview = await new PreviewSubstituteReceiptUseCase(certifyRepo).execute(ctx('payer-1'), 'exp-1', 'sub-1', { payerPosition: 'พนักงาน' });
    await new CertifySubstituteReceiptUseCase(certifyRepo, storage, audit, {
      execute: async (input: any) => { certifyNotifications.push(input); return {}; },
    } as any, cleanup).execute(ctx('payer-1'), 'exp-1', 'sub-1', {
      payerPosition: 'พนักงาน', certificationAcknowledged: true, signatureAttachmentId: 'sig-payer',
      previewChecksumSha256: preview.previewChecksumSha256,
      expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
    });

    assert.deepEqual(prepareNotifications[0].recipientUserIds, ['payer-1']);
    assert.deepEqual(certifyNotifications[0].recipientUserIds, ['approver-1']);
    assert.equal(prepareNotifications[0].sourceId, certifyNotifications[0].sourceId);
    assert.notEqual(buildDedupKey(prepareNotifications[0]), buildDedupKey(certifyNotifications[0]));
    for (const notification of [...prepareNotifications, ...certifyNotifications]) {
      assert.ok(
        IMPLEMENTED_TRIGGER_KEYS.includes(notification.triggerKey),
        `${notification.triggerKey} must be registered or the LINE preference gate drops it`,
      );
    }
  });

  it('blocks an unsafe legacy certified snapshot before issuing or writing an artifact', async () => {
    const snapshot: SubstituteReceiptSnapshot = {
      documentNumber: 'SRC-LEGACY-UNSAFE-V1', version: 1,
      company: { name: 'บริษัท ทดสอบ จำกัด', taxId: '0101', branchName: null },
      expense: {
        id: 'exp-1', expenseNumber: 'EXP-1', expenseDate: now.toISOString(), paymentDate: now.toISOString(),
        currency: 'THB', grandTotalAmount: '65.00', paymentMethod: 'CASH', paymentReference: null, category: 'cat-1',
        businessPurpose: 'ซื้อวัตถุดิบ',
        lines: Array.from({ length: 9 }, (_, index) => ({ description: `รายการ ${index + 1}`, quantity: '1', amount: '7.22' })),
      },
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', fundingSource: 'COMPANY' as const, reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'ผู้ขายไม่ออกใบเสร็จ',
      payer: { userId: 'payer-1', name: 'สมชาย', position: 'พนักงาน', certifiedAt: now.toISOString() },
      certificationText: buildSubstituteCertificationText('สมชาย', 'พนักงาน'), evidence: [], note: null,
    };
    const evidence = prepared({
      status: 'PAYER_CERTIFIED', snapshotJson: snapshot, snapshotChecksumSha256: canonicalSnapshotHash(snapshot),
      payerPosition: 'พนักงาน', payerSignatureAttachmentId: 'sig-payer', payerSignatureChecksumSha256: 'payer-checksum',
      certifiedArtifactAttachmentId: 'certified-artifact', certifiedArtifactChecksumSha256: 'certified-checksum', certifiedAt: now,
    });
    let storageWrites = 0;
    const repo = {
      findSubstituteEvidence: async () => evidence,
      findByIdWithRelations: async () => expense(),
      getSubstituteReceiptPolicy: async () => ({
        approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['approver-1'], cashEvidencePolicy: 'ALLOW_SUPPORTING_EVIDENCE_ONLY',
      }),
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
      findActiveMemberIdentity: async () => ({ userId: 'approver-1', displayName: 'ผู้จัดการ' }),
    } as any;
    const storage = { putObject: async () => { storageWrites += 1; throw new Error('must not write'); } } as any;
    const useCase = new ApproveSubstituteReceiptUseCase(repo, storage, audit, cleanup);

    await assert.rejects(
      () => useCase.execute(ctx('approver-1', ['expense.confirm']), 'exp-1', evidence.id, {
        approverPosition: 'ผู้จัดการ', approvalAcknowledged: true, certifiedArtifactChecksumSha256: 'certified-checksum',
        signatureAttachmentId: 'sig-approver', expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
      }),
      (error: unknown) => {
        assert.equal(
          (error as { getResponse(): { code?: string } }).getResponse().code,
          'substitute_receipt_too_many_lines',
        );
        return true;
      },
    );
    assert.equal(storageWrites, 0);
  });

  it('does not notify anyone after a solo owner certifies', async () => {
    const evidence = prepared({ payerUserId: 'owner-1', payerName: 'เจ้าของกิจการ' });
    let notificationCount = 0;
    const repo = {
      findSubstituteEvidence: async () => evidence,
      findByIdWithRelations: async () => expense(),
      findPersonalSignatureAttachment: async () => ({ id: 'sig-owner', bucket: 'b', objectKey: 'sig', mimeType: 'image/png', byteSize: png.length, checksumSha256: null }),
      findSubstituteEvidenceAttachments: async () => [{ id: 'att-source', purpose: 'expense.receipt.primary', originalFileName: 'bill.jpg', mimeType: 'image/jpeg', checksumSha256: 'src' }],
      getSubstituteCompanyContext: async () => ({ name: 'บริษัท ทดสอบ จำกัด', taxId: '0101', branchName: null }),
      markSubstituteEvidenceCertified: async () => prepared({ status: 'PAYER_CERTIFIED', payerUserId: 'owner-1', payerName: 'เจ้าของกิจการ' }),
      getSubstituteReceiptPolicy: async () => ({ approvalMode: 'OWNER_SELF', approverUserIds: [] }),
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'owner-1', displayName: 'เจ้าของกิจการ' }],
    } as any;
    const storage = {
      getObject: async () => ({ bytes: png, mimeType: 'image/png' }),
      putObject: async (input: any) => ({ bucket: 'b', objectKey: input.objectKey, storageProvider: 'local', byteSize: input.bytes.length }),
      deleteObject: async () => undefined,
    } as any;
    const useCase = new CertifySubstituteReceiptUseCase(repo, storage, audit, {
      execute: async () => { notificationCount += 1; return {}; },
    } as any, cleanup);
    const preview = await new PreviewSubstituteReceiptUseCase(repo).execute(ctx('owner-1'), 'exp-1', 'sub-1', { payerPosition: 'เจ้าของกิจการ' });
    await useCase.execute(ctx('owner-1', ['expense.confirm'], ['OWNER']), 'exp-1', 'sub-1', {
      payerPosition: 'เจ้าของกิจการ', certificationAcknowledged: true, signatureAttachmentId: 'sig-owner',
      previewChecksumSha256: preview.previewChecksumSha256,
      expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
    });
    assert.equal(notificationCount, 0);
  });

  it('applies approval rules and issues a legacy payee-less snapshot', async () => {
    const snapshot: SubstituteReceiptSnapshot = {
      documentNumber: 'SRC-EXP-1-V1', version: 1,
      company: { name: 'บริษัท ทดสอบ จำกัด', taxId: '0101', branchName: null },
      expense: { id: 'exp-1', expenseNumber: 'EXP-1', expenseDate: now.toISOString(), paymentDate: now.toISOString(), currency: 'THB', grandTotalAmount: '65.00', paymentMethod: 'CASH', paymentReference: null, category: 'cat-1', businessPurpose: 'ซื้อวัตถุดิบ', lines: [{ description: 'ผักสด', quantity: '1', amount: '65.00' }] },
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', fundingSource: 'COMPANY' as const, reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'ผู้ขายไม่ออกใบเสร็จ',
      payer: { userId: 'payer-1', name: 'สมชาย', position: 'พนักงาน', certifiedAt: now.toISOString() },
      certificationText: buildSubstituteCertificationText('สมชาย', 'พนักงาน'), evidence: [], note: null,
    };
    assert.equal('payee' in snapshot, false);
    const evidence = prepared({
      status: 'PAYER_CERTIFIED', snapshotJson: snapshot, snapshotChecksumSha256: canonicalSnapshotHash(snapshot),
      payerPosition: 'พนักงาน', payerSignatureAttachmentId: 'sig-payer',
      payerSignatureChecksumSha256: createHash('sha256').update(png).digest('hex'),
      certifiedArtifactAttachmentId: 'certified-artifact', certifiedArtifactChecksumSha256: 'certified-checksum', certifiedAt: now,
    });
    let issueInput: any;
    let approvalMode: 'OWNER_SELF' | 'DESIGNATED_APPROVERS' = 'DESIGNATED_APPROVERS';
    const repo = {
      findSubstituteEvidence: async () => evidence,
      findById: async () => expense(),
      findByIdWithRelations: async () => expense(),
      getSubstituteReceiptPolicy: async () => ({ approvalMode, approverUserIds: ['approver-1'], cashEvidencePolicy: 'ALLOW_SUPPORTING_EVIDENCE_ONLY' }),
      listEligibleSubstituteReceiptApprovers: async () => [
        { userId: 'payer-1', displayName: 'สมชาย' },
        { userId: 'approver-1', displayName: 'ผู้จัดการ' },
      ],
      findActiveMemberIdentity: async (_company: string, userId: string) => ({ userId, displayName: 'ผู้จัดการ' }),
      findPersonalSignatureAttachment: async (_company: string, id: string) => ({ id, bucket: 'b', objectKey: id, mimeType: 'image/png', byteSize: png.length, checksumSha256: null }),
      issueSubstituteEvidence: async (input: any) => { issueInput = input; return prepared({ status: 'ISSUED' }); },
    } as any;
    const storage = {
      getObject: async () => ({ bytes: png, mimeType: 'image/png' }),
      putObject: async (input: any) => ({ bucket: 'b', objectKey: input.objectKey, storageProvider: 'local', byteSize: input.bytes.length }),
      deleteObject: async () => undefined,
    } as any;
    const useCase = new ApproveSubstituteReceiptUseCase(repo, storage, audit, cleanup);
    await assert.rejects(() => useCase.execute(ctx('payer-1', ['expense.confirm'], ['OWNER']), 'exp-1', 'sub-1', {
      approverPosition: 'ผู้จัดการ', approvalAcknowledged: true, signatureAttachmentId: 'sig-approver',
      certifiedArtifactChecksumSha256: 'certified-checksum',
      expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
    }), /Self-approval of a substitute receipt requires/);
    approvalMode = 'OWNER_SELF';
    await assert.rejects(() => useCase.execute(ctx('payer-1', ['expense.confirm']), 'exp-1', 'sub-1', {
      approverPosition: 'เจ้าของกิจการ', approvalAcknowledged: true, signatureAttachmentId: 'sig-approver',
      certifiedArtifactChecksumSha256: 'certified-checksum',
      expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
    }), /Self-approval of a substitute receipt requires/);
    let uploadInput: any;
    await new InitSubstituteSignatureUploadUseCase(repo, {
      execute: async (_ctx: unknown, input: unknown) => { uploadInput = input; return {}; },
    } as any).execute(ctx('payer-1', ['expense.confirm'], ['OWNER']), 'exp-1', 'sub-1', {
      originalFileName: 'owner-signature.png', mimeType: 'image/png', byteSize: png.length,
    });
    assert.equal(uploadInput.metadataJson.role, 'approver');
    await useCase.execute(ctx('payer-1', ['expense.confirm'], ['OWNER']), 'exp-1', 'sub-1', {
      approverPosition: 'เจ้าของกิจการ', approvalAcknowledged: true, signatureAttachmentId: 'sig-approver',
      certifiedArtifactChecksumSha256: 'certified-checksum',
      expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
    });
    assert.equal(issueInput.approverUserId, 'payer-1');
    // The repository re-checks separation of duties inside its advisory-locked transaction, so the
    // permission has to travel with the call. A live solo-owner approval failed at that second guard
    // while every check in this use case passed.
    assert.equal(issueInput.allowSelfApproval, true);
    // Owner decision 2026-08-10: ADMIN/MANAGER share the self-approval exemption under OWNER_SELF.
    await useCase.execute(ctx('payer-1', ['expense.confirm'], ['ADMIN']), 'exp-1', 'sub-1', {
      approverPosition: 'ผู้ดูแลระบบ', approvalAcknowledged: true, signatureAttachmentId: 'sig-approver',
      certifiedArtifactChecksumSha256: 'certified-checksum',
      expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
    });
    assert.equal(issueInput.allowSelfApproval, true);
    approvalMode = 'DESIGNATED_APPROVERS';
    await assert.rejects(() => useCase.execute(ctx('unconfigured-1', ['expense.confirm']), 'exp-1', 'sub-1', {
      approverPosition: 'ผู้จัดการ', approvalAcknowledged: true, signatureAttachmentId: 'sig-unconfigured',
      certifiedArtifactChecksumSha256: 'certified-checksum',
      expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
    }), /not a currently configured/);
    await useCase.execute(ctx('approver-1', ['expense.confirm']), 'exp-1', 'sub-1', {
      approverPosition: 'ผู้จัดการ', approvalAcknowledged: true, signatureAttachmentId: 'sig-approver',
      certifiedArtifactChecksumSha256: 'certified-checksum',
      expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
    });
    assert.equal(issueInput.approverUserId, 'approver-1');
    assert.notEqual(issueInput.approverUserId, evidence.payerUserId);
    assert.equal(issueInput.allowSelfApproval, false);
    assert.match(issueInput.artifact.objectKey, /issued/);
  });
});

describe('reusable personal signature (R9)', () => {
  const library = { id: 'att-library', bucket: 'b', objectKey: 'library', mimeType: 'image/png', byteSize: png.length, checksumSha256: null };
  const libraryChecksum = createHash('sha256').update(png).digest('hex');
  const storage = {
    getObject: async () => ({ bytes: png, mimeType: 'image/png' }),
    putObject: async (input: any) => ({ bucket: 'b', objectKey: input.objectKey, storageProvider: 'local', byteSize: input.bytes.length }),
    deleteObject: async () => undefined,
  } as any;

  function signingRepo(overrides: Record<string, unknown> = {}) {
    const evidences: Record<string, any> = {
      'sub-A': prepared({ id: 'sub-A', documentNumber: 'SRC-EXP-1-V1' }),
      'sub-B': prepared({ id: 'sub-B', documentNumber: 'SRC-EXP-2-V1' }),
    };
    return {
      findSubstituteEvidence: async (_company: string, _expense: string, evidenceId: string) => evidences[evidenceId] ?? null,
      findByIdWithRelations: async () => expense(),
      findSubstituteEvidenceAttachments: async () => [{ id: 'att-source', purpose: 'expense.receipt.primary', originalFileName: 'bill.jpg', mimeType: 'image/jpeg', checksumSha256: 'src' }],
      getSubstituteCompanyContext: async () => ({ name: 'บริษัท ทดสอบ จำกัด', taxId: '0101', branchName: null }),
      getSubstituteReceiptPolicy: async () => ({ approvalMode: 'OWNER_SELF', approverUserIds: [] }),
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'payer-1', displayName: 'สมชาย' }],
      // The per-evidence upload exists for one attachment id only; everything else must fall back.
      findPersonalSignatureAttachment: async (_company: string, id: string) => (id === 'sig-upload'
        ? { id, bucket: 'b', objectKey: id, mimeType: 'image/png', byteSize: png.length, checksumSha256: null }
        : null),
      // Pinned lookups must name the attachment the evidence recorded, or nothing resolves.
      findReusableSignatureAsset: async (_company: string, _user: string, attachmentId?: string) => (
        !attachmentId || attachmentId === library.id ? library : null
      ),
      markSubstituteEvidenceCertified: async () => prepared({ status: 'PAYER_CERTIFIED' }),
      ...overrides,
    } as any;
  }

  async function certify(repo: any, evidenceId: string, input: Record<string, unknown> = {}) {
    const entries: any[] = [];
    const preview = await new PreviewSubstituteReceiptUseCase(repo).execute(ctx('payer-1'), 'exp-1', evidenceId, { payerPosition: 'พนักงาน' });
    await new CertifySubstituteReceiptUseCase(repo, storage, { log: async (entry: any) => { entries.push(entry); } } as any, notification, cleanup)
      .execute(ctx('payer-1'), 'exp-1', evidenceId, {
        payerPosition: 'พนักงาน', certificationAcknowledged: true,
        previewChecksumSha256: preview.previewChecksumSha256,
        expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
        ...input,
      } as any);
    return entries;
  }

  it('signs two different certificates from one asset, with no per-evidence upload', async () => {
    const certified: any[] = [];
    const repo = signingRepo({ markSubstituteEvidenceCertified: async (input: any) => { certified.push(input); return prepared({ status: 'PAYER_CERTIFIED' }); } });
    const auditA = await certify(repo, 'sub-A');
    const auditB = await certify(repo, 'sub-B');

    assert.deepEqual(certified.map((input) => input.evidenceId), ['sub-A', 'sub-B']);
    for (const input of certified) {
      assert.equal(input.payerSignatureAttachmentId, 'att-library');
      assert.equal(input.payerSignatureChecksumSha256, libraryChecksum);
      assert.ok(input.referencedAttachmentIds.includes('att-library'));
    }
    assert.equal(auditA[0].metadataJson.signatureSource, 'signature_library');
    assert.equal(auditB[0].metadataJson.signatureSource, 'signature_library');
  });

  it('lets a per-evidence upload win over the asset and still refuses a signer who has neither', async () => {
    const certified: any[] = [];
    const repo = signingRepo({ markSubstituteEvidenceCertified: async (input: any) => { certified.push(input); return prepared({ status: 'PAYER_CERTIFIED' }); } });
    const entries = await certify(repo, 'sub-A', { signatureAttachmentId: 'sig-upload' });
    assert.equal(certified[0].payerSignatureAttachmentId, 'sig-upload');
    assert.equal(entries[0].metadataJson.signatureSource, 'evidence_upload');

    const noSignature = signingRepo({ findReusableSignatureAsset: async () => null });
    await assert.rejects(() => certify(noSignature, 'sub-A'), /Signature must be an ACTIVE PNG\/JPEG uploaded by the payer/);
  });

  it('keeps certification and approval two audit rows under OWNER_SELF while both reuse the asset', async () => {
    const entries: any[] = [];
    const audit = { log: async (entry: any) => { entries.push(entry); } } as any;
    let certifiedInput: any;
    let issueInput: any;
    const repo = signingRepo({
      findById: async () => expense(),
      findActiveMemberIdentity: async (_company: string, userId: string) => ({ userId, displayName: 'เจ้าของกิจการ' }),
      markSubstituteEvidenceCertified: async (input: any) => { certifiedInput = input; return prepared({ status: 'PAYER_CERTIFIED' }); },
      issueSubstituteEvidence: async (input: any) => { issueInput = input; return prepared({ status: 'ISSUED' }); },
    });
    const preview = await new PreviewSubstituteReceiptUseCase(repo).execute(ctx('payer-1'), 'exp-1', 'sub-A', { payerPosition: 'เจ้าของกิจการ' });
    await new CertifySubstituteReceiptUseCase(repo, storage, audit, notification, cleanup)
      .execute(ctx('payer-1', ['expense.confirm'], ['OWNER']), 'exp-1', 'sub-A', {
        payerPosition: 'เจ้าของกิจการ', certificationAcknowledged: true,
        previewChecksumSha256: preview.previewChecksumSha256,
        expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
      });

    // Approval reads back exactly what certification recorded, so the asset must resolve by that id.
    const certifiedEvidence = prepared({
      id: 'sub-A', status: 'PAYER_CERTIFIED', payerPosition: 'เจ้าของกิจการ',
      snapshotJson: certifiedInput.snapshotJson, snapshotChecksumSha256: certifiedInput.snapshotChecksumSha256,
      payerSignatureAttachmentId: certifiedInput.payerSignatureAttachmentId,
      payerSignatureChecksumSha256: certifiedInput.payerSignatureChecksumSha256,
      certifiedArtifactAttachmentId: 'certified-artifact',
      certifiedArtifactChecksumSha256: certifiedInput.artifact.checksumSha256, certifiedAt: now,
    });
    const approveRepo = { ...repo, findSubstituteEvidence: async () => certifiedEvidence };
    await new ApproveSubstituteReceiptUseCase(approveRepo, storage, audit, cleanup)
      .execute(ctx('payer-1', ['expense.confirm'], ['OWNER']), 'exp-1', 'sub-A', {
        approverPosition: 'เจ้าของกิจการ', approvalAcknowledged: true,
        certifiedArtifactChecksumSha256: certifiedInput.artifact.checksumSha256,
        expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
      });

    assert.equal(certifiedInput.payerSignatureAttachmentId, 'att-library');
    assert.equal(issueInput.approverSignatureAttachmentId, 'att-library');
    // Spec §16: two acknowledgements stay two audit rows even when one person does both.
    assert.deepEqual(entries.map((entry) => entry.action), [
      'expense.substitute_receipt.certify',
      'expense.substitute_receipt.approve',
    ]);
    assert.deepEqual(entries.map((entry) => entry.targetId), ['sub-A', 'sub-A']);
    assert.deepEqual(entries.map((entry) => entry.metadataJson.signatureSource), ['signature_library', 'signature_library']);
    assert.equal(entries[1].metadataJson.selfApproved, true);
  });

  // OWNER_SELF also lets an admin or a manager sign both lines; the issued certificate says the owner only when it was.
  it('names a company admin who signs both lines by name, and keeps the owner wording for the owner', async () => {
    const issued = async (roles: string[]) => {
      const written: any[] = [];
      const recording = { ...storage, putObject: async (input: any) => { written.push(input); return storage.putObject(input); } };
      let certifiedInput: any;
      const repo = signingRepo({
        findById: async () => expense(),
        findActiveMemberIdentity: async (_company: string, userId: string) => ({ userId, displayName: 'สมชาย' }),
        markSubstituteEvidenceCertified: async (input: any) => { certifiedInput = input; return prepared({ status: 'PAYER_CERTIFIED' }); },
        issueSubstituteEvidence: async () => prepared({ status: 'ISSUED' }),
      });
      const preview = await new PreviewSubstituteReceiptUseCase(repo).execute(ctx('payer-1'), 'exp-1', 'sub-A', { payerPosition: '' });
      await new CertifySubstituteReceiptUseCase(repo, recording, audit, notification, cleanup)
        .execute(ctx('payer-1', ['expense.confirm'], roles), 'exp-1', 'sub-A', {
          payerPosition: '', certificationAcknowledged: true, previewChecksumSha256: preview.previewChecksumSha256,
          expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
        });
      const certifiedEvidence = prepared({
        id: 'sub-A', status: 'PAYER_CERTIFIED', payerPosition: '',
        snapshotJson: certifiedInput.snapshotJson, snapshotChecksumSha256: certifiedInput.snapshotChecksumSha256,
        payerSignatureAttachmentId: certifiedInput.payerSignatureAttachmentId,
        payerSignatureChecksumSha256: certifiedInput.payerSignatureChecksumSha256,
        certifiedArtifactAttachmentId: 'certified-artifact',
        certifiedArtifactChecksumSha256: certifiedInput.artifact.checksumSha256, certifiedAt: now,
      });
      await new ApproveSubstituteReceiptUseCase({ ...repo, findSubstituteEvidence: async () => certifiedEvidence }, recording, audit, cleanup)
        .execute(ctx('payer-1', ['expense.confirm'], roles), 'exp-1', 'sub-A', {
          approverPosition: '', approvalAcknowledged: true,
          certifiedArtifactChecksumSha256: certifiedInput.artifact.checksumSha256,
          expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
        });
      return written.find((input) => input.objectKey.includes('-issued-')).bytes.toString('utf8') as string;
    };
    const byAdmin = await issued(['ADMIN']);
    assert.doesNotMatch(byAdmin, /ลงนามโดยเจ้าของกิจการ/);
    assert.ok(byAdmin.includes('ลงนามโดย สมชาย ในฐานะผู้จ่ายเงินและผู้อนุมัติ'), 'the admin is named');
    assert.ok((await issued(['OWNER'])).includes('ลงนามโดยเจ้าของกิจการในฐานะผู้จ่ายเงินและผู้อนุมัติ'), 'the owner wording is unchanged');
  });

  it('refuses a blank signature attachment id instead of quietly using the saved signature', async () => {
    const repo = signingRepo();
    for (const signatureAttachmentId of ['', '   ']) {
      await assert.rejects(
        () => certify(repo, 'sub-A', { signatureAttachmentId }),
        /Signature must be an ACTIVE PNG\/JPEG uploaded by the payer/,
      );
    }
  });

  it('tells the approver to supersede when the recorded payer signature no longer resolves', async () => {
    let certifiedInput: any;
    const repo = signingRepo({
      findById: async () => expense(),
      findActiveMemberIdentity: async (_company: string, userId: string) => ({ userId, displayName: 'เจ้าของกิจการ' }),
      markSubstituteEvidenceCertified: async (input: any) => { certifiedInput = input; return prepared({ status: 'PAYER_CERTIFIED' }); },
    });
    await certify(repo, 'sub-A');
    const certifiedEvidence = prepared({
      id: 'sub-A', status: 'PAYER_CERTIFIED', payerPosition: 'พนักงาน',
      snapshotJson: certifiedInput.snapshotJson, snapshotChecksumSha256: certifiedInput.snapshotChecksumSha256,
      payerSignatureAttachmentId: certifiedInput.payerSignatureAttachmentId,
      payerSignatureChecksumSha256: certifiedInput.payerSignatureChecksumSha256,
      certifiedArtifactAttachmentId: 'certified-artifact',
      certifiedArtifactChecksumSha256: certifiedInput.artifact.checksumSha256, certifiedAt: now,
    });
    const approveRepo = {
      ...repo,
      findSubstituteEvidence: async () => certifiedEvidence,
      // The approver's own signature still resolves; only the recorded payer attachment is gone.
      findReusableSignatureAsset: async (_company: string, _user: string, attachmentId?: string) => (attachmentId ? null : library),
    };
    await assert.rejects(
      () => new ApproveSubstituteReceiptUseCase(approveRepo, storage, audit, cleanup)
        .execute(ctx('payer-1', ['expense.confirm'], ['OWNER']), 'exp-1', 'sub-A', {
          approverPosition: 'เจ้าของกิจการ', approvalAcknowledged: true,
          certifiedArtifactChecksumSha256: certifiedInput.artifact.checksumSha256,
          expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
        }),
      (error: any) => {
        // A state conflict the approver can act on, not a 400 blaming them for the payer's signature.
        assert.equal(error.getStatus(), 409);
        assert.match(error.message, /Supersede this evidence and re-certify/);
        return true;
      },
    );
  });
});

describe('reusable personal signature lookup (R9)', () => {
  const OLDER = new Date('2026-08-01T00:00:00.000Z');
  const NEWER = new Date('2026-08-10T00:00:00.000Z');

  function asset(overrides: Record<string, unknown> = {}) {
    return {
      id: 'sig-asset-1', companyId: 'co-1', status: 'ACTIVE', submittedByUserId: 'payer-1',
      originalAttachmentId: 'att-original', derivedAttachmentId: null, createdAt: NEWER,
      ...overrides,
    } as any;
  }

  function attachment(overrides: Record<string, unknown> = {}) {
    return {
      id: 'att-original', companyId: 'co-1', status: 'ACTIVE', mimeType: 'image/png',
      bucket: 'bucket', objectKey: 'signatures/original.png', objectVersionId: null,
      byteSize: 1024, checksumSha256: 'checksum-original',
      // F14: carried through so a preview saves under its own name instead of "download".
      originalFileName: 'signature.png',
      ...overrides,
    } as any;
  }

  /** Mirrors only the filters the lookup builds, so a widened query fails these tests. */
  function repository(assets: any[], attachments: any[]) {
    const client: any = {
      companySignatureAsset: {
        findMany: async ({ where }: any) => assets
          .filter((row) => row.companyId === where.companyId
            && row.submittedByUserId === where.submittedByUserId
            && (where.status === undefined || row.status === where.status)
            && (!where.OR || where.OR.some((clause: Record<string, unknown>) => Object.entries(clause)
              .every(([field, value]) => (row[field] ?? null) === value))))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      },
      attachmentObject: {
        findMany: async ({ where }: any) => attachments.filter((row) => where.id.in.includes(row.id)
          && row.companyId === where.companyId
          && row.status === where.status
          && where.mimeType.in.includes(row.mimeType)),
      },
    };
    return new PrismaExpenseRepository({ client } as any);
  }

  it('resolves the newest ACTIVE owned asset and prefers its background-removed derivative', async () => {
    const repo = repository(
      [
        asset({ id: 'sig-old', createdAt: OLDER, originalAttachmentId: 'att-old' }),
        asset({ id: 'sig-new', createdAt: NEWER, originalAttachmentId: 'att-original', derivedAttachmentId: 'att-derived' }),
      ],
      [
        attachment({ id: 'att-old' }),
        attachment({ id: 'att-original' }),
        attachment({ id: 'att-derived', objectKey: 'signatures/derived.png', checksumSha256: 'checksum-derived', objectVersionId: 'v2' }),
      ],
    );
    assert.deepEqual(await repo.findReusableSignatureAsset('co-1', 'payer-1'), {
      id: 'att-derived', bucket: 'bucket', objectKey: 'signatures/derived.png', objectVersionId: 'v2',
      mimeType: 'image/png', byteSize: 1024, checksumSha256: 'checksum-derived',
      // A8 mints an inline preview straight from this row, and F14 names the download.
      originalFileName: 'signature.png',
    });
  });

  it('falls back within the same asset before considering an older one', async () => {
    const newest = asset({ id: 'sig-new', createdAt: NEWER, originalAttachmentId: 'att-original', derivedAttachmentId: 'att-derived' });
    const attachments = [attachment({ id: 'att-old' }), attachment({ id: 'att-original' }), attachment({ id: 'att-derived', status: 'DELETED' })];
    // A dead derivative must not demote the newest signature to an older one: its original is live.
    const repo = repository([asset({ id: 'sig-old', createdAt: OLDER, originalAttachmentId: 'att-old' }), newest], attachments);
    assert.equal((await repo.findReusableSignatureAsset('co-1', 'payer-1'))?.id, 'att-original');
    const onlyNewest = repository([newest], attachments);
    assert.equal((await onlyNewest.findReusableSignatureAsset('co-1', 'payer-1'))?.id, 'att-original');
    const noDerivative = repository([asset()], [attachment()]);
    assert.equal((await noDerivative.findReusableSignatureAsset('co-1', 'payer-1'))?.id, 'att-original');
  });

  it('never resolves an asset that is not ACTIVE, not owned, or in another company', async () => {
    for (const status of ['PENDING_OWNER_APPROVAL', 'REJECTED', 'ARCHIVED']) {
      const repo = repository([asset({ status })], [attachment()]);
      assert.equal(await repo.findReusableSignatureAsset('co-1', 'payer-1'), null, status);
    }
    const otherUser = repository([asset({ submittedByUserId: 'approver-1' })], [attachment()]);
    assert.equal(await otherUser.findReusableSignatureAsset('co-1', 'payer-1'), null);
    const otherCompany = repository([asset({ companyId: 'co-2' })], [attachment()]);
    assert.equal(await otherCompany.findReusableSignatureAsset('co-1', 'payer-1'), null);
  });

  it('skips an asset with no live image at all', async () => {
    const repo = repository(
      [asset({ id: 'sig-old', createdAt: OLDER, originalAttachmentId: 'att-old' }), asset({ id: 'sig-new', createdAt: NEWER, originalAttachmentId: 'att-deleted' })],
      [attachment({ id: 'att-old' }), attachment({ id: 'att-deleted', status: 'DELETED' })],
    );
    assert.equal((await repo.findReusableSignatureAsset('co-1', 'payer-1'))?.id, 'att-old');
    const onlyInactive = repository([asset({ originalAttachmentId: 'att-deleted' })], [attachment({ id: 'att-deleted', status: 'DELETED' })]);
    assert.equal(await onlyInactive.findReusableSignatureAsset('co-1', 'payer-1'), null);
  });

  it('resolves a recorded attachment id whatever the asset status, and still fails closed', async () => {
    // Archiving or re-submitting a signature must not brick documents already certified with it:
    // ACTIVE gates signing something new, the pinned branch answers what certification recorded.
    for (const status of ['ACTIVE', 'ARCHIVED', 'PENDING_OWNER_APPROVAL', 'REJECTED']) {
      const repo = repository([asset({ status })], [attachment()]);
      assert.equal((await repo.findReusableSignatureAsset('co-1', 'payer-1', 'att-original'))?.id, 'att-original', status);
      // The unpinned path is unchanged: an archived asset may not sign anything new.
      assert.equal(Boolean(await repo.findReusableSignatureAsset('co-1', 'payer-1')), status === 'ACTIVE', status);
    }
    const deletedAttachment = repository([asset({ status: 'ARCHIVED' })], [attachment({ status: 'DELETED' })]);
    assert.equal(await deletedAttachment.findReusableSignatureAsset('co-1', 'payer-1', 'att-original'), null);
    const otherUser = repository([asset({ status: 'ARCHIVED', submittedByUserId: 'approver-1' })], [attachment()]);
    assert.equal(await otherUser.findReusableSignatureAsset('co-1', 'payer-1', 'att-original'), null);
  });

  it('pins to the recorded id even when the asset later gained a different derivative', async () => {
    const repo = repository(
      [
        asset({ id: 'sig-old', createdAt: OLDER, originalAttachmentId: 'att-old' }),
        asset({ id: 'sig-new', createdAt: NEWER, originalAttachmentId: 'att-original', derivedAttachmentId: 'att-derived' }),
      ],
      [attachment({ id: 'att-old' }), attachment({ id: 'att-original' }), attachment({ id: 'att-derived' })],
    );
    assert.equal((await repo.findReusableSignatureAsset('co-1', 'payer-1', 'att-old'))?.id, 'att-old');
    assert.equal((await repo.findReusableSignatureAsset('co-1', 'payer-1', 'att-derived'))?.id, 'att-derived');
    assert.equal((await repo.findReusableSignatureAsset('co-1', 'payer-1', 'att-original'))?.id, 'att-original');
    assert.equal(await repo.findReusableSignatureAsset('co-1', 'payer-1', 'att-unknown'), null);
  });
});

describe('re-pointing a signature derivative (R9 hardening)', () => {
  function harness(assetOverrides: Record<string, unknown> = {}) {
    const asset = {
      id: 'sig-1', companyId: 'co-1', status: 'ACTIVE', submittedByUserId: 'payer-1',
      originalAttachmentId: 'att-original', derivedAttachmentId: null, ...assetOverrides,
    };
    const entries: any[] = [];
    let updated: any;
    const repo = {
      findSignatureAssetById: async () => asset,
      linkAttachmentToTarget: async () => undefined,
      updateSignatureAsset: async (_company: string, _id: string, data: any) => { updated = data; return { ...asset, ...data }; },
    } as any;
    const useCase = new SetSignatureDerivedAssetUseCase(repo, { execute: async () => ({}) } as any, {
      log: async (entry: any) => { entries.push(entry); },
    } as any);
    return { useCase, entries, updated: () => updated };
  }

  const signer = (userId: string) => ctx(userId, ['expense.signature.manage']);

  /**
   * The invariant that survives the personal-signature decision unchanged, and the only one that
   * matters here: re-pointing swaps the image that signs legal artifacts, so nobody but the owner
   * may do it. Holding `expense.signature.manage` does not make someone else's signature yours.
   */
  it('lets only the submitter re-point their own signature', async () => {
    const { useCase } = harness();
    await assert.rejects(
      () => useCase.execute(signer('approver-1'), 'sig-1', { attachmentId: 'att-swapped' }),
      /Only the signature submitter/,
    );
    await assert.rejects(
      () => useCase.execute(ctx('payer-1', ['expense.read']), 'sig-1', { attachmentId: 'att-swapped' }),
      /expense.signature.manage/,
    );
  });

  // Superseded by the owner decision of 2026-08-20: re-pointing your OWN personal signature is
  // updating your own signature. There is no approval to take away, so an ACTIVE asset stays ACTIVE
  // — which is also what kept every web upload usable, since the canvas posts its transparent PNG
  // moments after creation.
  it('keeps the asset usable and records only the new derivative', async () => {
    for (const permission of ['expense.signature.manage', 'expense.review', 'expense.confirm']) {
      const { useCase, entries, updated } = harness();
      const result = await useCase.execute(ctx('payer-1', [permission]), 'sig-1', { attachmentId: 'att-swapped' });
      assert.equal('status' in updated(), false, permission);
      assert.equal(updated().derivedAttachmentId, 'att-swapped');
      assert.equal(result.status, 'ACTIVE');
      assert.equal(entries[0].action, 'expense.signature.background_remove');
      assert.equal(entries[0].metadataJson.derivedAttachmentId, 'att-swapped');
    }
  });

  it('refuses to re-point a retired signature', async () => {
    const { useCase } = harness({ status: 'ARCHIVED' });
    await assert.rejects(
      () => useCase.execute(signer('payer-1'), 'sig-1', { attachmentId: 'att-derived' }),
      /Cannot attach derived asset/,
    );
  });
});

describe('R7 / Fix-up 11 — LINE prepares; preview, signing, approval and downloads stay web-only', () => {
  const line = (userId = 'payer-1', permissions = ['expense.review']) => ({ ...ctx(userId, permissions), authProvider: 'line' });

  function prepareHarness() {
    const audits: any[] = [];
    let captured: any;
    const repo = {
      findByIdWithRelations: async () => expense(),
      findActiveMemberIdentity: async () => ({ userId: 'payer-1', displayName: 'สมชาย' }),
      getSubstituteReceiptPolicy: async () => ({ approvalMode: 'OWNER_SELF', approverUserIds: [], cashEvidencePolicy: 'ALLOW_SUPPORTING_EVIDENCE_ONLY' }),
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
      findSubstituteEvidenceAttachments: async () => [],
      createPreparedSubstituteEvidence: async (input: any) => { captured = input; return prepared(); },
    } as any;
    const useCase = new PrepareSubstituteReceiptUseCase(repo, { log: async (entry: any) => { audits.push(entry); } } as any, notification);
    return { useCase, audits, input: () => captured };
  }

  const input = {
    fundingSource: 'COMPANY' as const, paidInFullAcknowledged: true as const,
    reasonCode: 'PAYEE_CANNOT_ISSUE' as const, missingReceiptReason: 'วินไม่ออกใบเสร็จ',
    businessPurpose: 'ไปพบลูกค้า', payerUserId: 'payer-1', paymentMethod: 'CASH' as const,
    idempotencyKey: 'workflow-1', continuationId: 'workflow-1', expectedExpenseUpdatedAt: now.toISOString(),
  };

  it('prepares from LINE with expense.review and records the channel on the row and the audit', async () => {
    const h = prepareHarness();
    await h.useCase.execute(line() as any, 'exp-1', input);

    assert.equal(h.input().preparedFromChannel, 'LINE');
    const audit = h.audits.find((entry) => entry.action === 'expense.substitute_receipt.prepare');
    assert.equal(audit.metadataJson.preparedFromChannel, 'LINE');
    assert.equal(audit.metadataJson.source, 'LINE', 'spec §14 names the LINE source explicitly');
  });

  it('still records WEB for an authenticated web prepare, with no LINE source claim', async () => {
    const h = prepareHarness();
    await h.useCase.execute(ctx('payer-1'), 'exp-1', input);

    assert.equal(h.input().preparedFromChannel, 'WEB');
    const audit = h.audits.find((entry) => entry.action === 'expense.substitute_receipt.prepare');
    assert.equal(audit.metadataJson.preparedFromChannel, 'WEB');
    assert.equal('source' in audit.metadataJson, false);
  });

  it('refuses a LINE prepare without expense.review', async () => {
    const h = prepareHarness();
    await assert.rejects(
      () => h.useCase.execute(line('payer-1', []) as any, 'exp-1', input),
      /expense\.review/,
    );
  });

  it('refuses LINE preview, certify and approve before reading evidence; downloads stay web-only', async () => {
    const repo = { findSubstituteEvidence: async () => assert.fail('LINE cannot read signing evidence') } as any;
    const web = /authenticated web only/;
    await assert.rejects(
      () => new CertifySubstituteReceiptUseCase(repo, {} as any, audit, notification, cleanup)
        .execute(line() as any, 'exp-1', 'sub-1', { certificationAcknowledged: true } as any),
      web,
    );
    await assert.rejects(
      () => new ApproveSubstituteReceiptUseCase(repo, {} as any, audit, cleanup)
        .execute(line('payer-1', []) as any, 'exp-1', 'sub-1', { approvalAcknowledged: true } as any),
      web,
    );
    await assert.rejects(
      () => new PreviewSubstituteReceiptUseCase(repo).execute(line() as any, 'exp-1', 'sub-1', {}),
      web,
    );
    await assert.rejects(
      () => new DownloadSubstituteReceiptPdfUseCase({ execute: async () => ({}) } as any, repo, {} as any, audit)
        .execute(line() as any, 'exp-1', 'sub-1'),
      web,
    );
    await assert.rejects(
      () => new DownloadSubstituteReceiptFormPdfUseCase(repo, audit).execute(line() as any, 'exp-1', 'sub-1'),
      web,
    );
  });
});

describe('substitute receipt paper route (R11/R12)', () => {
  const SCAN_CHECKSUM = 'scan-checksum-abcdef';
  const paperEvidence = (overrides: Record<string, unknown> = {}) => prepared({
    signatureMode: 'PAPER', wetSignedScanAttachmentId: 'att-scan', wetSignedScanChecksumSha256: SCAN_CHECKSUM,
    ...overrides,
  });

  it('certifies and approves without any signature image and still writes two audit rows', async () => {
    let evidence = paperEvidence();
    const storageWrites: any[] = [];
    const audits: any[] = [];
    let certifiedInput: any;
    let issueInput: any;
    const repo = {
      findSubstituteEvidence: async () => evidence,
      findById: async () => expense(),
      findByIdWithRelations: async () => expense(),
      findSubstituteEvidenceAttachments: async () => [{ id: 'att-source', purpose: 'expense.receipt.primary', originalFileName: 'bill.jpg', mimeType: 'image/jpeg', checksumSha256: 'src' }],
      getSubstituteCompanyContext: async () => ({ name: 'บริษัท ทดสอบ จำกัด', taxId: '0101', branchName: null }),
      markSubstituteEvidenceCertified: async (input: any) => { certifiedInput = input; return evidence; },
      issueSubstituteEvidence: async (input: any) => { issueInput = input; return paperEvidence({ status: 'ISSUED' }); },
      getSubstituteReceiptPolicy: async () => ({ approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['approver-1'], cashEvidencePolicy: 'ALLOW_SUPPORTING_EVIDENCE_ONLY' }),
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
      findActiveMemberIdentity: async (_company: string, userId: string) => ({ userId, displayName: 'ผู้จัดการ' }),
      // Deliberately absent: findPersonalSignatureAttachment / findReusableSignatureAsset. The paper
      // route must not reach for a signature at all — calling either would throw here.
    } as any;
    const storage = {
      getObject: async () => ({ bytes: png, mimeType: 'image/png' }),
      putObject: async (input: any) => { storageWrites.push(input); return { bucket: 'b', objectKey: input.objectKey, storageProvider: 'local', byteSize: input.bytes.length }; },
      deleteObject: async () => undefined,
    } as any;
    const auditCollector = { log: async (entry: any) => { audits.push(entry); } } as any;

    const preview = await new PreviewSubstituteReceiptUseCase(repo).execute(ctx('payer-1'), 'exp-1', 'sub-1', { payerPosition: 'พนักงาน' });
    await new CertifySubstituteReceiptUseCase(repo, storage, auditCollector, notification, cleanup)
      .execute(ctx('payer-1'), 'exp-1', 'sub-1', {
        payerPosition: 'พนักงาน', certificationAcknowledged: true,
        previewChecksumSha256: preview.previewChecksumSha256,
        expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
      });

    assert.equal(certifiedInput.payerSignatureAttachmentId, undefined, 'no signature is recorded on the paper route');
    assert.deepEqual(certifiedInput.referencedAttachmentIds, ['att-scan', 'att-source'],
      'the scan is the attachment the certification is locked against');
    const certifiedSvg = storageWrites[0].bytes.toString('utf8');
    assert.match(certifiedSvg, new RegExp(certifiedInput.snapshotChecksumSha256));
    assert.match(certifiedSvg, new RegExp(SCAN_CHECKSUM));

    evidence = paperEvidence({
      status: 'PAYER_CERTIFIED', snapshotJson: certifiedInput.snapshotJson,
      snapshotChecksumSha256: certifiedInput.snapshotChecksumSha256, payerPosition: 'พนักงาน',
      certifiedArtifactAttachmentId: 'certified-artifact', certifiedArtifactChecksumSha256: 'certified-checksum', certifiedAt: now,
    });
    await new ApproveSubstituteReceiptUseCase(repo, storage, auditCollector, cleanup)
      .execute(ctx('approver-1', ['expense.confirm']), 'exp-1', 'sub-1', {
        approverPosition: 'ผู้จัดการ', approvalAcknowledged: true,
        certifiedArtifactChecksumSha256: 'certified-checksum',
        expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
      });

    assert.equal(issueInput.approverSignatureAttachmentId, undefined);
    assert.ok(issueInput.referencedAttachmentIds.includes('att-scan'));
    const issuedSvg = storageWrites[1].bytes.toString('utf8');
    assert.match(issuedSvg, new RegExp(certifiedInput.snapshotChecksumSha256), 'R11: the snapshot checksum is on the attestation');
    assert.match(issuedSvg, new RegExp(SCAN_CHECKSUM), 'R11: so is the scan checksum');
    assert.match(issuedSvg, /ผู้จัดการ/, 'the approver identity is printed, not signed');
    assert.equal(issuedSvg.includes('<image'), false, 'no signature image is embedded anywhere');

    // Journey B end to end: the document the user actually receives is composed from the artifact
    // this approval stored plus the scan it was certified against.
    const issued = paperEvidence({
      status: 'ISSUED', artifactAttachmentId: 'issued-artifact',
      snapshotJson: certifiedInput.snapshotJson, snapshotChecksumSha256: certifiedInput.snapshotChecksumSha256,
    });
    const scanBytes = await (async () => {
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.create();
      pdf.addPage([200, 300]);
      return Buffer.from(await pdf.save());
    })();
    const download = new DownloadSubstituteReceiptPdfUseCase(
      { execute: async () => expense() } as any,
      {
        findSubstituteEvidence: async () => ({ ...issued, wetSignedScanChecksumSha256: createHash('sha256').update(scanBytes).digest('hex') }),
        findSubstituteArtifactAttachment: async (_c: string, _e: string, id: string) => id === 'att-scan'
          ? { bucket: 'b', objectKey: 'scan', mimeType: 'application/pdf' }
          : { bucket: 'b', objectKey: 'issued', mimeType: 'image/svg+xml' },
      } as any,
      { getObject: async (input: any) => ({ bytes: input.objectKey === 'scan' ? scanBytes : storageWrites[1].bytes }) } as any,
      auditCollector,
    );
    const artifact = await download.execute(ctx('approver-1', ['expense.review']), 'exp-1', 'sub-1');
    const { PDFDocument } = await import('pdf-lib');
    const rendered = await PDFDocument.load(artifact.data);
    assert.equal(rendered.getPageCount(), 2, 'R11: the scan, then the attestation');
    assert.deepEqual(rendered.getPage(0).getSize(), { width: 200, height: 300 }, 'the ink comes first');

    // D8/R12: two acknowledgements, two audit rows, with the route recorded on both.
    const actions = audits.map((entry) => entry.action).filter((action) => !action.includes('artifact.download'));
    assert.deepEqual(actions, ['expense.substitute_receipt.certify', 'expense.substitute_receipt.approve']);
    const acknowledgements = audits.filter((entry) => !entry.action.includes('artifact.download'));
    assert.deepEqual(acknowledgements.map((entry) => entry.metadataJson.signatureMode), ['PAPER', 'PAPER']);
    assert.deepEqual(acknowledgements.map((entry) => entry.metadataJson.signatureSource), ['wet_signed_scan', 'wet_signed_scan']);
    assert.deepEqual(acknowledgements.map((entry) => entry.riskLevel), ['HIGH', 'CRITICAL']);
  });

  it('refuses a paper-route evidence whose scan is gone, and still demands a signature on the digital route', async () => {
    const brokenPaper = prepared({ signatureMode: 'PAPER', wetSignedScanAttachmentId: null, wetSignedScanChecksumSha256: null });
    const repo = (evidence: any, extra: Record<string, unknown> = {}) => ({
      findSubstituteEvidence: async () => evidence,
      findByIdWithRelations: async () => expense(),
      findSubstituteEvidenceAttachments: async () => [{ id: 'att-source', purpose: 'expense.receipt.primary', originalFileName: 'bill.jpg', mimeType: 'image/jpeg', checksumSha256: 'src' }],
      getSubstituteCompanyContext: async () => ({ name: 'บริษัท ทดสอบ จำกัด', taxId: '0101', branchName: null }),
      markSubstituteEvidenceCertified: async () => evidence,
      ...extra,
    } as any);
    const storage = {
      getObject: async () => ({ bytes: png, mimeType: 'image/png' }),
      putObject: async (input: any) => ({ bucket: 'b', objectKey: input.objectKey, storageProvider: 'local', byteSize: input.bytes.length }),
      deleteObject: async () => undefined,
    } as any;
    const input = (previewChecksumSha256: string) => ({
      payerPosition: 'พนักงาน', certificationAcknowledged: true as const, previewChecksumSha256,
      expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
    });

    const brokenRepo = repo(brokenPaper);
    const brokenPreview = await new PreviewSubstituteReceiptUseCase(brokenRepo).execute(ctx('payer-1'), 'exp-1', 'sub-1', { payerPosition: 'พนักงาน' });
    await assert.rejects(
      () => new CertifySubstituteReceiptUseCase(brokenRepo, storage, audit, notification, cleanup)
        .execute(ctx('payer-1'), 'exp-1', 'sub-1', input(brokenPreview.previewChecksumSha256)),
      /hand-signed scan is missing/,
    );

    // The digital route is untouched: with no per-evidence upload and no reusable asset it still refuses.
    const digitalRepo = repo(prepared(), {
      findPersonalSignatureAttachment: async () => null,
      findReusableSignatureAsset: async () => null,
    });
    const digitalPreview = await new PreviewSubstituteReceiptUseCase(digitalRepo).execute(ctx('payer-1'), 'exp-1', 'sub-1', { payerPosition: 'พนักงาน' });
    await assert.rejects(
      () => new CertifySubstituteReceiptUseCase(digitalRepo, storage, audit, notification, cleanup)
        .execute(ctx('payer-1'), 'exp-1', 'sub-1', input(digitalPreview.previewChecksumSha256)),
      /Signature must be an ACTIVE PNG\/JPEG uploaded by the payer/,
    );
  });
});

/**
 * D14: one CURRENT personal signature per person. Saving a new one retires the previous one in the
 * same transaction, so the panel's "current signature" is never ambiguous — which is what made
 * pressing ลบลายเซ็น look like a no-op: it archived one row and the next ACTIVE one took its place.
 *
 * The store is shared with the pinned lookup on purpose. Retiring must not cost a document that was
 * already signed, and the only way to prove that is to certify-resolve the retired row afterwards.
 */
describe('one current personal signature per owner (D14)', () => {
  const OLDER = new Date('2026-08-01T00:00:00.000Z');

  function store(rows: any[], attachments: any[] = []) {
    const locks: string[] = [];
    const client: any = {
      // Same connection, so the lock and both writes land in one transaction the way Prisma runs it.
      $transaction: (work: (tx: any) => Promise<unknown>) => work(client),
      $executeRaw: async (_sql: TemplateStringsArray, key: string) => { locks.push(key); return 1; },
      companySignatureAsset: {
        updateMany: async ({ where, data }: any) => {
          const hit = rows.filter((row) => row.companyId === where.companyId
            && row.submittedByUserId === where.submittedByUserId
            && row.status === where.status);
          for (const row of hit) Object.assign(row, data);
          return { count: hit.length };
        },
        create: async ({ data }: any) => {
          const row = {
            id: `sig-${rows.length + 1}`, label: null, derivedAttachmentId: null, lineMessageId: null,
            approvedByUserId: null, approvedAt: null, archivedAt: null,
            createdAt: new Date('2026-08-10T00:00:00.000Z'), updatedAt: new Date('2026-08-10T00:00:00.000Z'),
            ...data, status: data.status ?? 'ACTIVE',
          };
          // The partial unique index migration 20260821000000 adds. A path that forgets to retire the
          // previous row must fail here rather than quietly create a second current signature.
          if (row.status === 'ACTIVE' && rows.some((other) => other.companyId === row.companyId
            && other.submittedByUserId === row.submittedByUserId && other.status === 'ACTIVE')) {
            throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          }
          rows.push(row);
          return row;
        },
        findMany: async ({ where }: any) => rows
          .filter((row) => row.companyId === where.companyId
            && row.submittedByUserId === where.submittedByUserId
            && (where.status === undefined || row.status === where.status)
            && (!where.OR || where.OR.some((clause: Record<string, unknown>) => Object.entries(clause)
              .every(([field, value]) => (row[field] ?? null) === value))))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      },
      attachmentObject: {
        findMany: async ({ where }: any) => attachments.filter((row) => where.id.in.includes(row.id)
          && row.companyId === where.companyId && row.status === where.status
          && where.mimeType.in.includes(row.mimeType)),
      },
    };
    return { repo: new PrismaExpenseRepository({ client } as any), rows, locks };
  }

  function newSignature(overrides: Record<string, unknown> = {}) {
    return {
      companyId: 'co-1', submittedByUserId: 'payer-1', originalAttachmentId: 'att-new',
      submittedFromChannel: 'WEB' as const, status: 'ACTIVE', approvedByUserId: 'payer-1',
      approvedAt: new Date('2026-08-10T00:00:00.000Z'),
      ...overrides,
    };
  }

  function existing(overrides: Record<string, unknown> = {}) {
    return {
      id: 'sig-old', companyId: 'co-1', submittedByUserId: 'payer-1', status: 'ACTIVE',
      originalAttachmentId: 'att-old', derivedAttachmentId: null, archivedAt: null,
      submittedFromChannel: 'WEB', createdAt: OLDER, updatedAt: OLDER,
      ...overrides,
    };
  }

  it('retires the submitter previous ACTIVE signature, and only theirs', async () => {
    const { repo, rows, locks } = store([
      existing(),
      existing({ id: 'sig-other-user', submittedByUserId: 'approver-1' }),
      existing({ id: 'sig-other-company', companyId: 'co-2' }),
      existing({ id: 'sig-already-archived', status: 'ARCHIVED', archivedAt: OLDER }),
    ]);

    const created = await repo.createSignatureAsset(newSignature());

    assert.equal(created.status, 'ACTIVE');
    const byId = new Map(rows.map((row) => [row.id, row]));
    assert.equal(byId.get('sig-old')!.status, 'ARCHIVED');
    assert.ok(byId.get('sig-old')!.archivedAt instanceof Date, 'the retirement is dated on the row');
    // A signature is personal: nobody else's, and no other tenant's, moves.
    assert.equal(byId.get('sig-other-user')!.status, 'ACTIVE');
    assert.equal(byId.get('sig-other-company')!.status, 'ACTIVE');
    // An already-archived row keeps its original date rather than being re-stamped.
    assert.equal(byId.get('sig-already-archived')!.archivedAt, OLDER);
    // Exactly one ACTIVE row for this owner — the invariant the whole change exists for.
    assert.equal(rows.filter((row) => row.companyId === 'co-1' && row.submittedByUserId === 'payer-1'
      && row.status === 'ACTIVE').length, 1);
    // Serialised per owner, so two uploads racing cannot both read "no current signature".
    assert.deepEqual(locks, ['co-1:payer-1:signature-asset']);
  });

  it('leaves the retired row able to sign what it already signed', async () => {
    const attachments = [
      { id: 'att-old', companyId: 'co-1', status: 'ACTIVE', mimeType: 'image/png', bucket: 'bucket',
        objectKey: 'signatures/old.png', objectVersionId: null, byteSize: 1024,
        checksumSha256: 'checksum-old', originalFileName: 'signature.png' },
      { id: 'att-new', companyId: 'co-1', status: 'ACTIVE', mimeType: 'image/png', bucket: 'bucket',
        objectKey: 'signatures/new.png', objectVersionId: null, byteSize: 1024,
        checksumSha256: 'checksum-new', originalFileName: 'signature.png' },
    ];
    const { repo, rows } = store([existing()], attachments);

    await repo.createSignatureAsset(newSignature());

    // Pinned: a certificate recorded `att-old`, and approve must still resolve it after the
    // signature that produced it was retired by a replacement. This is why the pinned branch drops
    // the ACTIVE gate — retiring must never strand an already-certified document.
    assert.equal((await repo.findReusableSignatureAsset('co-1', 'payer-1', 'att-old'))?.id, 'att-old');
    // Nothing about the attachment moved, so the substitute-evidence retention hold — which reads
    // AttachmentObject, never the asset status — still protects those bytes from deletion.
    assert.equal(rows.find((row) => row.id === 'sig-old')!.originalAttachmentId, 'att-old');
    assert.deepEqual(attachments.map((row) => row.status), ['ACTIVE', 'ACTIVE']);
    // Unpinned, the retired row may no longer sign anything new: the replacement answers instead.
    assert.equal((await repo.findReusableSignatureAsset('co-1', 'payer-1'))?.id, 'att-new');
  });

  it('does not retire anything when the new row is not ACTIVE', async () => {
    const { repo, rows } = store([existing()]);
    await repo.createSignatureAsset(newSignature({ status: 'REJECTED' }));
    assert.equal(rows.find((row) => row.id === 'sig-old')!.status, 'ACTIVE');
  });
});


describe('paper signing without account identities', () => {
  const form = { schemaVersion: 2, documentNumber: 'SRC-1', version: 1, company: { name: 'บริษัท ทดสอบ จำกัด', taxId: '0100000000000', branchName: null },
    expense: { id: 'exp-1', expenseNumber: null, expenseDate: now.toISOString(), paymentDate: now.toISOString(), grandTotalAmount: '65', currency: 'THB', paymentMethod: 'CASH', paymentReference: null, category: null, businessPurpose: 'ทดสอบ', lines: [] },
    payer: { userId: null, name: '________', position: '________', certifiedAt: now.toISOString() }, certificationText: 'ข้าพเจ้า ________ ตำแหน่ง ________',
    originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', reasonCode: 'OTHER', missingReceiptReason: 'ทดสอบ', evidence: [], note: null };
  function setup(overrides: Record<string, unknown> = {}) {
    const evidence = prepared({ payerUserId: null, payerName: '', signatureMode: 'PAPER', paperFormSnapshotJson: form, supportingAttachmentIds: [], ...overrides });
    const repo = { findSubstituteEvidence: async () => evidence, findByIdWithRelations: async () => expense(), findSubstituteEvidenceAttachments: async () => [] } as any;
    const useCase = new PaperSubstituteReceiptUseCase(repo, audit, {} as any, {} as any, {} as any, cleanup);
    return { repo, useCase, evidence };
  }
  it('submits blank positions, captures uploader name and preserves required signer facts', async () => {
    const { repo, evidence } = setup();
    const { default: sharp } = await import('sharp');
    const bytes = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#222' } }).png().toBuffer();
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const attachment = { id: 'scan', branchId: null, status: 'ACTIVE', bucket: 'b', objectKey: 'scan', mimeType: 'image/png', checksumSha256: checksum, byteSize: bytes.length, metadataJson: { formChecksumSha256: canonicalSnapshotHash(form as any) } };
    repo.findSubstitutePaperUpload = async () => attachment;
    repo.findMemberDisplayName = async (companyId: string, userId: string) => {
      assert.equal(companyId, 'co-1'); assert.equal(userId, 'payer-1'); return 'ผู้จัดทำเอกสาร';
    };
    repo.submitSubstitutePaper = async (input: any) => {
      evidence.paperSubmissionJson = input.submission; evidence.wetSignedScanAttachmentId = 'scan'; evidence.wetSignedScanChecksumSha256 = checksum; return evidence;
    };
    const storage = { getObject: async () => ({ bytes }) } as any;
    const useCase = new PaperSubstituteReceiptUseCase(repo, audit, {} as any, {} as any, storage, cleanup);
    const input = { payer: { name: 'ผู้รับรอง', signedOn: '2026-07-13' }, approver: { name: 'ผู้อนุมัติ', position: '  ', signedOn: '2026-07-13' }, samePerson: false, formMatchesAcknowledged: true as const, attachmentId: 'scan', checksumSha256: checksum, byteSize: bytes.length, expectedEvidenceUpdatedAt: now.toISOString() };
    for (const role of ['payer', 'approver'] as const) {
      for (const position of [123, 'ก'.repeat(121)]) await assert.rejects(useCase.submit(ctx(), 'exp-1', 'sub-1', { ...input, [role]: { ...input[role], position } } as any), /position/);
      await assert.rejects(useCase.submit(ctx(), 'exp-1', 'sub-1', { ...input, [role]: { ...input[role], name: '' } }), /name/);
      await assert.rejects(useCase.submit(ctx(), 'exp-1', 'sub-1', { ...input, [role]: { ...input[role], signedOn: '' } }), /signedOn/);
    }
    attachment.metadataJson.formChecksumSha256 = 'old-form';
    await assert.rejects(useCase.submit(ctx(), 'exp-1', 'sub-1', input), /ดาวน์โหลดแบบฟอร์มล่าสุด/);
    attachment.metadataJson.formChecksumSha256 = canonicalSnapshotHash(form as any);
    await useCase.submit(ctx(), 'exp-1', 'sub-1', input);
    assert.equal(evidence.status, 'PREPARED');
    assert.equal(evidence.paperSubmissionJson.payer.position, '');
    assert.equal(evidence.paperSubmissionJson.approver.position, '');
    assert.equal(evidence.paperSubmissionJson.uploadedByName, 'ผู้จัดทำเอกสาร');
    repo.findMemberDisplayName = async () => { throw new Error('exact retry must retain captured name'); };
    await useCase.submit(ctx(), 'exp-1', 'sub-1', input);
  });

  it('reviews paper using the captured uploader name or a scoped legacy name, never an account ID', async () => {
    const { renderSubstituteReceiptAttestationSvg } = await import('../../domain/logic/substitute-receipt.logic');
    for (const uploadedByName of ['ชื่อขณะอัปโหลด', undefined]) {
      const submission = { payer: { name: 'ผู้รับรอง', position: '', signedOn: '2026-07-13' }, approver: { name: 'ผู้อนุมัติ', position: '', signedOn: '2026-07-13' }, samePerson: false, uploadedByUserId: 'uploader-id', uploadedByName, uploadedAt: now.toISOString() };
      const checksum = createHash('sha256').update(png).digest('hex');
      const { repo, evidence } = setup({ paperSubmissionJson: submission, wetSignedScanAttachmentId: 'scan', wetSignedScanChecksumSha256: checksum });
      repo.findActiveMemberIdentity = async () => ({ displayName: 'ผู้ตรวจรับ' });
      repo.findMemberDisplayName = async (companyId: string, userId: string) => { assert.equal(uploadedByName, undefined); assert.equal(companyId, 'co-1'); assert.equal(userId, 'uploader-id'); return 'ชื่อสมาชิกเดิม'; };
      repo.findSubstituteArtifactAttachment = async () => ({ bucket: 'b', objectKey: 'scan', mimeType: 'image/png' });
      repo.getSubstituteCompanyContext = async () => form.company;
      repo.getSubstituteReceiptPolicy = async () => ({ approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['reviewer-id'] });
      repo.listEligibleSubstituteReceiptApprovers = async () => [{ userId: 'reviewer-id' }];
      let issued: any;
      repo.issueSubstituteEvidence = async (input: any) => { issued = input; return prepared({ ...evidence, status: 'ISSUED' }); };
      const expectedSnapshot = { ...form, payer: { userId: null, name: submission.payer.name, position: '', certifiedAt: submission.payer.signedOn, roleLabel: 'ผู้รับรองการจ่าย' }, certificationText: buildSubstituteCertificationText(submission.payer.name, '', true), paperReview: { ...submission, uploadedByName: uploadedByName ?? 'ชื่อสมาชิกเดิม', reviewerUserId: 'reviewer-id', reviewerName: 'ผู้ตรวจรับ' } };
      // Public acceptance must bind its SVG to the reviewed facts and scan.
      delete (expectedSnapshot.paperReview as any).payer; delete (expectedSnapshot.paperReview as any).approver;
      const svg = renderSubstituteReceiptAttestationSvg(expectedSnapshot as any, { snapshotChecksumSha256: canonicalSnapshotHash(expectedSnapshot as any), wetSignedScanChecksumSha256: checksum, approver: { userId: null, name: 'ผู้อนุมัติ', position: '', approvedAt: '2026-07-13' } });
      const storage = { getObject: async () => ({ bytes: png }), putObject: async (input: any) => { assert.equal(input.bytes.toString(), svg.toString()); return { bucket: 'b', objectKey: 'issued', byteSize: input.bytes.length }; } } as any;
      const useCase = new PaperSubstituteReceiptUseCase(repo, audit, {} as any, {} as any, storage, cleanup);
      await useCase.accept(ctx('reviewer-id', ['expense.confirm']), 'exp-1', 'sub-1', { previewChecksumSha256: createHash('sha256').update(Buffer.concat([svg, Buffer.from(checksum)])).digest('hex'), expectedEvidenceUpdatedAt: now.toISOString(), factsAndSignaturesAcknowledged: true, approverAuthorityAcknowledged: true, originalRetainedAcknowledged: true });
      assert.equal(issued.paperAcceptance.snapshot.paperReview.uploadedByName, uploadedByName ?? 'ชื่อสมาชิกเดิม');
      assert.equal(issued.approverPosition, '');
      assert.doesNotMatch(svg.toString(), /uploader-id|reviewer-id|SHA-256|version 1|บัญชีผู้ตรวจรับ|ผู้ตรวจรับในระบบ|ผู้รับรอง ·|ผู้อนุมัติ ·|มิใช่ใบกำกับภาษี/);
    }
  });
  it('does not let an uploader certify an external paper signer through the digital endpoint', async () => {
    const { repo } = setup();
    await assert.rejects(new PreviewSubstituteReceiptUseCase(repo).execute(ctx(), 'exp-1', 'sub-1', { payerPosition: 'พนักงาน' }), /Only the selected actual payer/);
  });
  it('requires preparer permission and branch scope for paper uploads', async () => {
    const { useCase, repo } = setup();
    repo.findByIdWithRelations = async () => expense({ branchId: 'branch-1' });
    const file = { originalFileName: 'scan.pdf', mimeType: 'application/pdf', byteSize: 10 };
    await assert.rejects(useCase.initUpload(ctx('u', []), 'exp-1', 'sub-1', file), /ไม่มีสิทธิ์/);
    const scoped = ctx(); scoped.scopes = { branchIds: ['other-branch'] };
    await assert.rejects(useCase.initUpload(scoped, 'exp-1', 'sub-1', file), /Branch/);
  });
  it('rejects stale source, digital route, and unprepared paper form', async () => {
    for (const override of [{ expenseUpdatedAtAtPreparation: new Date(0) }, { signatureMode: 'DIGITAL' }, { paperFormSnapshotJson: null }]) {
      const { useCase } = setup(override);
      await assert.rejects(useCase.initUpload(ctx(), 'exp-1', 'sub-1', { originalFileName: 'scan.pdf', mimeType: 'application/pdf', byteSize: 10 }));
    }
  });
  it('validates real signer dates and two-role declaration before completing or linking uploads', async () => {
    const { useCase } = setup();
    const input: any = { payer: { name: 'สมชาย', position: 'พนักงาน', signedOn: '2026-02-30' }, approver: { name: 'สมชาย', position: 'กรรมการ', signedOn: '2026-07-13' }, samePerson: false, formMatchesAcknowledged: true };
    await assert.rejects(useCase.submit(ctx(), 'exp-1', 'sub-1', input), /วันที่/);
    input.payer.signedOn = '2026-07-13';
    await assert.rejects(useCase.submit(ctx(), 'exp-1', 'sub-1', input), /ชื่อผู้เซ็นตรงกัน/);
  });
  it('does not accept an upload as an issued document without all review acknowledgements', async () => {
    const { useCase } = setup();
    await assert.rejects(useCase.accept(ctx('reviewer', ['expense.confirm']), 'exp-1', 'sub-1', {} as any), /ยืนยันครบ/);
  });
  it('renders both blank paper signer blocks without a saved signature or account name', async () => {
    const { renderSubstituteReceiptSvg } = await import('../../domain/logic/substitute-receipt.logic');
    const svg = renderSubstituteReceiptSvg(form as any, undefined, undefined, undefined, { paperForm: true }).toString();
    assert.equal((svg.match(/ชื่อ \(________________________________\)/g) ?? []).length, 2);
    assert.equal((svg.match(/วันที่ ________/g) ?? []).length, 2);
    assert.doesNotMatch(svg, /<image|ตัวอย่างก่อนลงนาม|รอผู้อนุมัติลงนาม|ลงนามโดยเจ้าของกิจการ/);
    assert.match(svg, /ข้าพเจ้า ________ ตำแหน่ง \(ถ้ามี\) ________/);
  });
});


describe('owner certifies and issues in one signing', () => {
  function combinedFixture(mode = 'OWNER_SELF', payerUserId = 'owner-1') {
    const evidence = prepared({ payerUserId });
    let combined: any;
    const repo = {
      findSubstituteEvidence: async () => evidence,
      findByIdWithRelations: async () => expense(),
      findPersonalSignatureAttachment: async () => ({ id: 'sig-owner', bucket: 'b', objectKey: 'sig', mimeType: 'image/png', byteSize: png.length, checksumSha256: null }),
      findSubstituteEvidenceAttachments: async () => [{ id: 'att-source', originalFileName: 'bill.jpg', mimeType: 'image/jpeg', checksumSha256: 'src' }],
      getSubstituteCompanyContext: async () => ({ name: 'ร้านทดสอบ', taxId: '0101', branchName: null }),
      getSubstituteReceiptPolicy: async () => ({ approvalMode: mode, approverUserIds: ['approver-1'] }),
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'owner-1' }, { userId: 'approver-1' }],
      findActiveMemberIdentity: async () => ({ userId: 'owner-1', displayName: 'สมชาย' }),
      markSubstituteEvidenceCertified: async () => prepared({ status: 'PAYER_CERTIFIED' }),
      certifyAndIssueSubstituteEvidence: async (input: any) => {
        combined = input;
        return prepared({ ...input.certification, ...input.issuance, status: 'ISSUED',
          artifactAttachmentId: 'issued', certifiedArtifactAttachmentId: 'certified', issuedAt: input.issuance.approvedAt });
      },
    } as any;
    const storage = { getObject: async () => ({ bytes: png }), putObject: async (input: any) => ({ bucket: 'b', objectKey: input.objectKey, storageProvider: 'local', objectVersionId: 'v1', byteSize: input.bytes.length }) } as any;
    return { repo, useCase: new CertifySubstituteReceiptUseCase(repo, storage, audit, notification, cleanup), combined: () => combined };
  }
  const owner = () => ctx('owner-1', ['expense.confirm'], ['OWNER']);
  async function command(fixture: ReturnType<typeof combinedFixture>) {
    const preview = await new PreviewSubstituteReceiptUseCase(fixture.repo).execute(owner(), 'exp-1', 'sub-1', {});
    return { certificationAcknowledged: true, approvalAcknowledged: true, signatureAttachmentId: 'sig-owner',
      previewChecksumSha256: preview.previewChecksumSha256, expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString() } as any;
  }
  it('owner-self command stores both signatures with one drawing and time and both audit rows', async () => {
    const fixture = combinedFixture();
    const result = await fixture.useCase.execute(owner(), 'exp-1', 'sub-1', await command(fixture));
    assert.equal(result.status, 'ISSUED');
    const { certification, issuance, auditEntries } = fixture.combined();
    assert.equal(certification.payerSignatureAttachmentId, issuance.approverSignatureAttachmentId);
    assert.equal(certification.certifiedAt, issuance.approvedAt);
    assert.equal(certification.snapshotChecksumSha256, canonicalSnapshotHash(certification.snapshotJson));
    assert.equal(issuance.allowSelfApproval, true);
    assert.deepEqual(auditEntries.map((entry: any) => entry.action), ['expense.substitute_receipt.certify', 'expense.substitute_receipt.approve']);
    assert.equal(auditEntries[1].metadataJson.selfApproved, true);
  });
  it('refuses combined signing for designated approvers and anyone without the owner role', async () => {
    const designated = combinedFixture('DESIGNATED_APPROVERS');
    await assert.rejects(designated.useCase.execute(owner(), 'exp-1', 'sub-1', await command(designated)), /combined_signing_denied/);
    const fixture = combinedFixture();
    const input = await command(fixture);
    for (const roles of [[], ['ADMIN'], ['MANAGER']]) {
      await assert.rejects(fixture.useCase.execute(ctx('owner-1', ['expense.confirm'], roles), 'exp-1', 'sub-1', input), /combined_signing_denied/);
    }
    await assert.rejects(fixture.useCase.execute(ctx('approver-1', ['expense.confirm'], ['OWNER']), 'exp-1', 'sub-1', input), /selected actual payer/);
    assert.equal(fixture.combined(), undefined);
  });
  it('keeps document reading, certification, approval permission and paper-route checks', async () => {
    const fixture = combinedFixture(); const input = await command(fixture);
    await assert.rejects(fixture.useCase.execute(owner(), 'exp-1', 'sub-1', { ...input, certificationAcknowledged: false }), /acknowledge/);
    await assert.rejects(fixture.useCase.execute(owner(), 'exp-1', 'sub-1', { ...input, previewChecksumSha256: 'stale' }), /preview no longer matches/);
    await assert.rejects(fixture.useCase.execute(ctx('owner-1', [], ['OWNER']), 'exp-1', 'sub-1', input), /expense.confirm/);
    assert.equal(fixture.combined(), undefined);
  });
});


describe('own expense certificate preparation', () => {
  function fixture(createdByUserId = 'payer-1') {
    const source = expense({ createdByUserId }); let preparedInput: any;
    const repo = { findByIdWithRelations: async () => source, findById: async () => source,
      findActiveMemberIdentity: async (_company: string, userId: string) => ({ userId, displayName: userId }),
      listEligibleSubstituteReceiptPayers: async () => [{ userId: 'payer-1', displayName: 'ผู้จ่าย' }],
      getSubstituteReceiptPolicy: async () => ({ approvalMode: 'OWNER_SELF', approverUserIds: [] }),
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'owner-1' }],
      findSubstituteEvidenceAttachments: async () => [],
      createPreparedSubstituteEvidence: async (input: any) => { preparedInput = input; return prepared(); },
      listSubstituteEvidenceHistory: async () => [prepared({ payerUserId: 'other-payer' })],
      listCompanySubstituteReceipts: async (_company: string, _filter: any, scope: any) => { assert.equal(scope.createdByUserId, 'payer-1'); return { rows: [], total: 0 }; },
    } as any;
    return { source, repo, preparedInput: () => preparedInput };
  }
  const input = { fundingSource: 'PERSONAL_ADVANCE', paidInFullAcknowledged: true, reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'ไม่มีใบเสร็จ',
    businessPurpose: 'ซื้อของใช้ในร้าน', paymentDate: '2026-07-13', paymentMethod: 'CASH', payerUserId: 'payer-1',
    idempotencyKey: 'own-prepare', expectedExpenseUpdatedAt: now.toISOString() } as any;
  it('read-own creator may prepare and read the certificate without review permission', async () => {
    const f = fixture(); f.source.aiVerificationSummaryJson = null; const own = ctx('payer-1', ['expense.read_own']);
    await new PrepareSubstituteReceiptUseCase(f.repo, audit, notification).execute(own, 'exp-1', input);
    assert.equal(f.preparedInput().preparedByUserId, 'payer-1');
    assert.equal((await new ListSubstituteReceiptHistoryUseCase(f.repo).execute(own, 'exp-1')).length, 1);
    await new ListCompanySubstituteReceiptsUseCase(f.repo).execute(own, {});
  });
  it('other creators and callers without expense rights keep the prepare refusal; reviewers remain allowed', async () => {
    const f = fixture('someone-else'); const useCase = new PrepareSubstituteReceiptUseCase(f.repo, audit, notification);
    await assert.rejects(useCase.execute(ctx('payer-1', ['expense.read_own']), 'exp-1', input), /Missing permission: expense.review/);
    await assert.rejects(useCase.execute(ctx('payer-1', []), 'exp-1', input), /Missing permission: expense.review/);
    await useCase.execute(ctx(), 'exp-1', input);
    assert.equal(f.preparedInput().preparedByUserId, 'payer-1');
  });
});

describe('server certificate candidate list', () => {
  function candidates(rows: any[]) {
    const repo = { listSubstituteReceiptCandidateSources: async (_filter: any, _scope: any) => rows } as any;
    return new ListSubstituteReceiptCandidatesUseCase(repo);
  }
  it('offers unanswered drafts and incomplete facts to their recorder and reviewers, but never another employee', async () => {
    const row = expense({ attachments: [], createdByUserId: 'payer-1', sourceDocumentType: 'NEEDS_REVIEW', taxEvidenceStatus: 'NEEDS_REVIEW', aiVerificationSummaryJson: null, substituteReceiptEvidence: null, expenseCategoryId: null,
      lines: [{ description: 'น้ำแข็ง', expenseCategoryId: null, accountHintKey: null }] });
    row.aiVerificationSummaryJson = null;
    const list = new ListSubstituteReceiptCandidatesUseCase({ listSubstituteReceiptCandidateSources: async (scope: any) => !scope.createdByUserId || scope.createdByUserId === row.createdByUserId ? [row] : [] } as any);
    assert.equal((await list.execute(ctx('payer-1', ['expense.read_own']), {})).total, 1);
    assert.equal((await list.execute(ctx(), {})).total, 1);
    assert.equal((await list.execute(ctx('other', ['expense.read_own']), {})).total, 0);
  });
  it('excludes unanswered receipt uploads until a receipt problem is recorded, while keeping manual entries', async () => {
    const row = expense({ createdByUserId: 'payer-1', substituteReceiptEvidence: null });
    row.aiVerificationSummaryJson = null;
    for (const includeBlocked of [false, true]) {
      assert.equal((await candidates([row]).execute(ctx(), { includeBlocked })).total, 0);
      assert.equal((await candidates([{ ...row, attachments: [] }]).execute(ctx(), { includeBlocked })).total, 1);
    }
    const supporting = { ...row, attachments: row.attachments.map((file: { purpose: string }) => ({ ...file, purpose: 'expense.receipt.supporting' })) };
    assert.equal((await candidates([supporting]).execute(ctx(), { includeBlocked: true })).total, 0);
    for (const receiptProblem of ['NOT_AVAILABLE', 'LOST', 'MATERIAL_INCOMPLETE']) {
      row.aiVerificationSummaryJson = { documentReview: { assessment: { route: 'SUBSTITUTE_RECEIPT', receiptProblem, reason: 'ไม่มีใบเสร็จ', attachmentIds: [] } } };
      assert.equal((await candidates([row]).execute(ctx(), {})).total, 1);
    }
  });
  it('excludes live certificates and cancelled expenses, and usable receipts even when a legacy caller requests blocked rows', async () => {
    const base = expense({ createdByUserId: 'payer-1', substituteReceiptEvidence: null });
    for (const patch of [{ status: 'REJECTED' }, { status: 'VOIDED' }, { substituteReceiptEvidence: prepared() }]) {
      assert.equal((await candidates([{ ...base, ...patch }]).execute(ctx(), { includeBlocked: true })).total, 0);
    }
    base.aiVerificationSummaryJson.documentReview.assessment = { route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', attachmentIds: ['att-source'], reason: '' };
    assert.equal((await candidates([base]).execute(ctx(), { includeBlocked: true })).total, 0);
  });
  it('lists older-than-200 sources and missing facts without hiding them, and pages/searches on the server', async () => {
    const base = expense({ createdByUserId: 'payer-1', substituteReceiptEvidence: null });
    const valid = Array.from({ length: 205 }, (_, i) => ({ ...base, id: `e-${i}`, expenseNumber: `EXP-${i}`, createdAt: new Date(now.getTime()-i*1000) }));
    valid.push({ ...base, id: 'cancelled', substituteReceiptEvidence: prepared({ status: 'SUPERSEDED' }), createdAt: new Date(0) });
    const invalid = [{ status: 'CONFIRMED' }, { currency: 'USD' }, { grandTotalAmount: '0' }, { taxEvidenceStatus: 'USABLE_FOR_TAX' },
      { sourceDocumentType: 'NEEDS_REVIEW' }, { lines: [] }, { lines: [{ description: '' }] }, { expenseCategoryId: null, lines: [{ description: 'ของ', expenseCategoryId: null, accountHintKey: null }] },
      { paidAmount: '20', netPayableAmount: '65' }, { substituteReceiptEvidence: prepared() }].map((patch, i) => ({ ...base, id: `bad-${i}`, createdAt: new Date(1), ...patch }));
    const list = candidates([...valid, ...invalid]);
    const page = await list.execute(ctx('payer-1', ['expense.read_own']), { page: 41, pageSize: 5 });
    assert.equal(page.total, 213); assert.ok(page.items.some((row: any) => row.id === 'e-204'));
    assert.equal((await list.execute(ctx('payer-1', ['expense.read_own']), { page: 43, pageSize: 5 })).items.at(-1)?.id, 'cancelled');
    for (const search of ['EXP-204', 'ผู้ขายในตลาด', 'ผักสด']) assert.ok((await list.execute(ctx('payer-1', ['expense.read_own']), { search })).total > 0);
  });
  it('keeps repairable preparation facts visible but excludes final states, unsupported currency and non-expense documents', async () => {
    const valid = expense({ createdAt: now, substituteReceiptEvidence: null });
    const cases = [
      [{ status: 'DRAFT' }, true], [{ status: 'READY_FOR_CONFIRMATION' }, true], [{ status: 'CONFIRMED' }, false], [{ currency: 'USD' }, false], [{ status: 'VOIDED' }, false], [{ status: 'REJECTED' }, false],
      [{ sourceDocumentType: 'RECEIPT' }, true], [{ sourceDocumentType: 'SUBSTITUTE_RECEIPT' }, true],
      [{ taxEvidenceStatus: 'NEEDS_REVIEW' }, true], [{ paidAmount: '65', netPayableAmount: '65' }, true], [{ paidAmount: '66', netPayableAmount: '65' }, true],
      [{ lines: Array.from({ length: 100 }, () => ({ description: 'ของ', expenseCategoryId: 'cat' })) }, true],
      [{ lines: [{ description: 'ก'.repeat(1000), expenseCategoryId: 'cat' }] }, true],
      [{ aiVerificationSummaryJson: { classification: { documentKind: 'QUOTATION' } } }, false],
    ] as const;
    for (const [patch, expected] of cases) {
      const result = await candidates([{ ...valid, ...patch }]).execute(ctx(), {});
      assert.equal(result.total === 1, expected, JSON.stringify(patch));
    }
    for (const problem of ['LOST', 'MATERIAL_INCOMPLETE']) {
      const source = expense({ createdAt: now, sourceDocumentType: 'RECEIPT', substituteReceiptEvidence: null });
      source.aiVerificationSummaryJson.documentReview.assessment.receiptProblem = problem;
      assert.equal((await candidates([source]).execute(ctx(), {})).total, 1);
    }
  });
  it('filters usable receipts before pagination and search even for legacy includeBlocked callers', async () => {
    const source = expense({ createdAt: now, sourceDocumentType: 'RECEIPT', substituteReceiptEvidence: null });
    source.aiVerificationSummaryJson.documentReview.assessment = { route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', attachmentIds: ['att-source'], reason: '' };
    const eligible = expense({ id: 'eligible', createdAt: new Date(0), substituteReceiptEvidence: null });
    const list = candidates([source, eligible]);
    const page = await list.execute(ctx(), { includeBlocked: true, page: 1, pageSize: 1 });
    assert.equal(page.total, 1);
    assert.deepEqual(page.items.map(row => row.id), ['eligible']);
    assert.equal((await list.execute(ctx(), { page: 2, pageSize: 1 })).items.length, 0);
    assert.equal((await list.execute(ctx(), { search: 'ไม่มีในรายการ' })).total, 0);
  });
  it('uses creator and branch scope and refuses callers without expense read rights', async () => {
    let scope: any;
    const list = new ListSubstituteReceiptCandidatesUseCase({ listSubstituteReceiptCandidateSources: async (filter: any, branches: any) => { scope = { filter, branches }; return []; } } as any);
    await list.execute(ctx('payer-1', ['expense.read_own']), {});
    assert.equal(scope.filter.createdByUserId, 'payer-1');
    await list.execute(ctx(), {}); assert.equal(scope.filter.createdByUserId, undefined);
    await assert.rejects(list.execute({ ...ctx('payer-1', ['expense.read_own']), scopes: { branchIds: ['allowed'] } }, { branchId: 'other' }), /Branch/);
    await assert.rejects(list.execute(ctx('payer-1', []), {}), /Missing permission: expense.review/);
  });
});

describe('own certificate evidence uploads', () => {
  it('allows only the readable creator or reviewer, and binds completion to their expense upload', async () => {
    const source = expense({ createdByUserId: 'payer-1', substituteReceiptEvidence: null });
    let linked = false;
    const repo = { findByIdWithRelations: async () => source,
      findSubstitutePreparationUpload: async (_c: string, _e: string, _a: string, user: string) => user === 'payer-1' ? { status: 'PENDING_UPLOAD' } : null,
      updateExpense: async (_input: any, callback: any) => callback({ expenseSubstituteReceiptEvidence: { findFirst: async () => null } }), linkAttachment: async () => { linked = true; } } as any;
    const useCase = new SubstituteReceiptEvidenceUploadUseCase(repo, { execute: async (_ctx: any, input: any) => input } as any, { execute: async () => ({}) } as any);
    const input = { originalFileName: 'proof.png', mimeType: 'image/png', byteSize: 10, purpose: 'expense.payment.evidence' as const };
    const own = ctx('payer-1', ['expense.read_own']);
    const upload = await useCase.init(own, 'exp-1', input);
    assert.equal((upload as any).metadataJson.expenseId, 'exp-1');
    await useCase.complete(own, 'exp-1', 'file', input); assert.equal(linked, true);
    for (const actor of [ctx('other', ['expense.read_own']), ctx('payer-1', [])]) await assert.rejects(useCase.init(actor, 'exp-1', input), /Missing permission/);
    await assert.rejects(useCase.complete(ctx('other', ['expense.review', 'attachment.create']), 'exp-1', 'file', input), /upload/i);
    await assert.rejects(useCase.init(own, 'exp-1', { ...input, purpose: 'expense.receipt.primary' } as any), /purpose/i);
  });
});

it('certificate deep links preserve assigned payer access after the preparation hub becomes creator-only', async () => {
  const source = expense({ createdByUserId: 'someone-else' });
  const repo = { findExpenseIdForSubstituteReceipt: async () => 'exp-1', findById: async () => source,
    listSubstituteEvidenceHistory: async () => [prepared()] } as any;
  const reader = new ListSubstituteReceiptHistoryUseCase(repo);
  assert.equal(await reader.resolveExpenseId(ctx('payer-1', ['expense.read_own']), 'sub-1'), 'exp-1');
  await assert.rejects(reader.resolveExpenseId(ctx('unrelated', ['expense.read_own']), 'sub-1'), /Cannot read/);
});

it('own certificate continuation saves only the no-receipt review and cannot review other facts or usable receipts', async () => {
  const source = expense({ createdByUserId: 'payer-1' }); let saved = 0;
  const repo = { findByIdWithRelations: async () => source } as any;
  const save = new SaveOwnSubstituteReceiptReviewUseCase(repo, { execute: async (_ctx: any, _id: string, body: any, options: any) => {
    assert.equal(options.ownSubstituteReceiptReview, true); assert.equal(body.evidenceAssessment.route, 'SUBSTITUTE_RECEIPT'); saved++; return source;
  } } as any);
  const input = { expectedUpdatedAt: now.toISOString(), sourceDocumentType: 'EXPENSE_NOTE_TEXT', taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE', documentReviewAcknowledged: true,
    evidenceAssessment: { route: 'SUBSTITUTE_RECEIPT', receiptProblem: 'NOT_AVAILABLE', attachmentIds: [], reason: '' } } as any;
  await save.execute(ctx('payer-1', ['expense.read_own']), 'exp-1', input); assert.equal(saved, 1);
  await assert.rejects(save.execute(ctx('other', ['expense.read_own']), 'exp-1', input), /expense.review/);
  await assert.rejects(save.execute(ctx('payer-1', []), 'exp-1', input), /expense.review/);
  await assert.rejects(save.execute(ctx('payer-1', ['expense.read_own']), 'exp-1', { ...input, grandTotalAmount: '1' }), /review/);
  source.aiVerificationSummaryJson.documentReview.assessment = { route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', attachmentIds: ['att-source'], reason: '' };
  await assert.rejects(save.execute(ctx('payer-1', ['expense.read_own']), 'exp-1', input), /usable receipt/);
  assert.equal(saved, 1);
});

it('no-receipt acknowledgement can precede category completion without granting category edits', async () => {
  const source = expense({ createdByUserId: 'payer-1', sourceDocumentType: 'NEEDS_REVIEW', taxEvidenceStatus: 'NEEDS_REVIEW', expenseCategoryId: null, lines: [{ description: 'น้ำแข็ง', expenseCategoryId: null }] });
  source.aiVerificationSummaryJson = null;
  const save = new SaveOwnSubstituteReceiptReviewUseCase({ findByIdWithRelations: async () => source } as any, { execute: async () => ({ id: source.id }) } as any);
  const input = { expectedUpdatedAt: now.toISOString(), sourceDocumentType: 'EXPENSE_NOTE_TEXT', taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE', documentReviewAcknowledged: true,
    evidenceAssessment: { route: 'SUBSTITUTE_RECEIPT', receiptProblem: 'NOT_AVAILABLE', attachmentIds: [], reason: '' } } as any;
  assert.equal((await save.execute(ctx('payer-1', ['expense.read_own']), 'exp-1', input)).id, 'exp-1');
  await assert.rejects(save.execute(ctx('payer-1', ['expense.read_own']), 'exp-1', { ...input, expenseCategoryId: 'cat' }), /Only the no-receipt/);
});


describe('certificate payee name provenance on the source expense', () => {
  it('fills only an empty seller, follows its own unsigned name, and keeps other metadata', async () => {
    const { substitutePayeeExpenseFields } = await import('../../infrastructure/substitute-expense-edit');
    const source = { vendorNameSnapshot: null, sourceChannelMetadataJson: { unrelated: 'kept' } };
    const first = substitutePayeeExpenseFields(source, 'ป้าศรี');
    assert.equal(first.vendorNameSnapshot, 'ป้าศรี');
    assert.equal(first.sourceChannelMetadataJson.unrelated, 'kept');
    const current = { status: 'PREPARED', payeeName: 'ป้าศรี' };
    assert.equal(substitutePayeeExpenseFields({ ...source, ...first }, 'ป้าสม', current).vendorNameSnapshot, 'ป้าสม');
    assert.deepEqual(substitutePayeeExpenseFields({ ...source, vendorNameSnapshot: 'ชื่อที่คนกรอก' }, 'ป้าศรี'), {});
    assert.deepEqual(substitutePayeeExpenseFields({ ...source, ...first, vendorNameSnapshot: 'ชื่อที่แก้เอง' }, 'ป้าสม', current), {});
    assert.deepEqual(substitutePayeeExpenseFields({ ...source, vendorNameSnapshot: 'ป้าศรี' }, 'ป้าสม', current), {}, 'same text without provenance is still a person-entered seller');
    for (const signed of [{ status: 'PAYER_CERTIFIED' }, { status: 'ISSUED' }, { wetSignedScanAttachmentId: 'scan' }, { paperSubmissionJson: { submitted: true } }]) {
      assert.deepEqual(substitutePayeeExpenseFields({ ...source, ...first }, 'ป้าสม', { ...current, ...signed }), {});
    }
  });
});

describe('substitute receipt hub paging', () => {
  it('returns all-page decimal totals, status counts and personal attention independently of the page', async () => {
    const counts = { PREPARED: 12, PAYER_CERTIFIED: 3, ISSUED: 8, SUPERSEDED: 1 };
    const attention = { signature: { count: 12, evidenceId: 'sub-first' }, approval: { count: 3, evidenceId: 'sub-approve' } };
    const repo = {
      getSubstituteReceiptPolicy: async () => ({ approvalMode: 'OWNER_SELF' }),
      listCompanySubstituteReceipts: async (_company: string, filter: any, scope: any) => {
        assert.equal(filter.order, 'oldest'); assert.equal(filter.page, 2); assert.equal(filter.pageSize, 10);
        assert.equal(scope.userId, 'payer-1'); assert.equal(scope.canApprove, true); assert.equal(scope.canSelfApprove, true);
        return { rows: [], total: 12, counts, sums: { total: '123456.78' }, attention };
      },
    } as any;
    const result = await new ListCompanySubstituteReceiptsUseCase(repo).execute(ctx('payer-1', ['expense.confirm'], ['OWNER']), { status: 'PREPARED', yearMonth: '2026-10', page: 2, pageSize: 10, order: 'oldest' } as any);
    assert.deepEqual(result, { items: [], total: 12, page: 2, pageSize: 10, counts, sums: { total: '123456.78' }, attention });
  });

  it('rejects an invalid date order before reading the list', async () => {
    const repo = { listCompanySubstituteReceipts: async () => { throw new Error('must not read'); } } as any;
    await assert.rejects(new ListCompanySubstituteReceiptsUseCase(repo).execute(ctx(), { order: 'unsafe' } as any), BadRequestException);
  });
});


describe('substitute hub repository totals and order', () => {
  it('aggregates once across all pages, retains month/tenant/branch/creator/payer scope, and orders before paging', async () => {
    const sql: any[] = []; let hydrated: any;
    const groups = [
      { status: 'PREPARED', count: 12, total: '1000.005', signatureCount: 2, signatureId: 'first', approvalCount: 1, approvalId: 'paper' },
      { status: 'ISSUED', count: 5, total: '8999.995', signatureCount: 0, signatureId: null, approvalCount: 0, approvalId: null },
    ];
    const tx: any = {
      $queryRaw: async (query: any) => { sql.push(query); return query.sql.includes('GROUP BY') ? groups : [{ id: 'sub-2' }, { id: 'sub-1' }]; },
      expenseSubstituteReceiptEvidence: { findMany: async (query: any) => { hydrated = query; return [{ id: 'sub-1' }, { id: 'sub-2' }]; } },
    };
    const repo = new PrismaExpenseRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    for (const order of ['newest', 'oldest'] as const) {
      sql.length = 0;
      const result = await repo.listCompanySubstituteReceipts('co-1', { status: 'PREPARED', yearMonth: '2026-10', payerUserId: 'payer-1', order, page: 2, pageSize: 10 },
        { onlyPayerUserId: null, branchIds: ['b-1'], createdByUserId: 'creator-1', userId: 'payer-1', canApprove: true, canSelfApprove: false });
      assert.equal(result.total, 12); assert.deepEqual(result.sums, { total: '1000.01' });
      assert.deepEqual(result.counts, { PREPARED: 12, PAYER_CERTIFIED: 0, ISSUED: 5, SUPERSEDED: 0 });
      assert.deepEqual(result.attention, { signature: { count: 2, evidenceId: 'first' }, approval: { count: 1, evidenceId: 'paper' } });
      assert.deepEqual(result.rows.map(row => row.id), ['sub-2', 'sub-1']);
      assert.equal(sql.filter(q => q.sql.includes('GROUP BY')).length, 1);
      const aggregate = sql[0]; const page = sql[1];
      for (const query of sql) {
        assert.match(query.sql, /r\."companyId" =/); assert.match(query.sql, /e\."companyId" =/);
        assert.match(query.sql, /r\."branchId" IS NULL OR r\."branchId" IN/);
        assert.match(query.sql, /e\."branchId" IS NULL OR e\."branchId" IN/);
        for (const value of ['co-1', 'b-1', 'creator-1', 'payer-1']) assert.ok(query.values.includes(value));
        assert.ok(query.values.some((v: any) => v instanceof Date && v.toISOString() === '2026-10-01T00:00:00.000Z'));
        assert.ok(query.values.some((v: any) => v instanceof Date && v.toISOString() === '2026-11-01T00:00:00.000Z'));
      }
      assert.doesNotMatch(aggregate.sql, /LIMIT|OFFSET/);
      const direction = order === 'newest' ? 'DESC' : 'ASC';
      assert.ok(page.sql.includes(`ORDER BY COALESCE(r."paymentDate", e."expenseDate") ${direction}, r."createdAt" ${direction}, r.id ${direction}`));
      assert.match(page.sql, /ORDER BY[\s\S]*LIMIT \? OFFSET \?/); assert.deepEqual(page.values.slice(-2), [10, 10]);
      assert.equal(hydrated.where.companyId, 'co-1'); assert.equal(hydrated.where.status, 'PREPARED');
    }
    const all = await repo.listCompanySubstituteReceipts('co-1', {}, { onlyPayerUserId: null });
    assert.equal(all.total, 17); assert.equal(all.sums.total, '10000.00');
  });
  it('returns zero summaries and central-only predicates for an empty branch scope', async () => {
    const queries: any[] = [];
    const tx = { $queryRaw: async (q: any) => { queries.push(q); return []; }, expenseSubstituteReceiptEvidence: { findMany: async () => [] } };
    const repo = new PrismaExpenseRepository({ client: { $transaction: async (fn: any) => fn(tx) } } as any);
    const result = await repo.listCompanySubstituteReceipts('co-1', {}, { onlyPayerUserId: null, branchIds: [] });
    assert.equal(result.total, 0); assert.equal(result.sums.total, '0.00'); assert.equal(result.attention.approval.count, 0);
    assert.match(queries[0].sql, /r\."branchId" IS NULL/); assert.doesNotMatch(queries[0].sql, / IN \(\)/);
  });
});

describe('Fix-up 7B — combined facts and targeted payment evidence', () => {
  it('W1 asks once and captures every fact from the live combined influencer answer', async () => {
    const h = lineHarness({ expense: lineExpense({ vendorNameSnapshot: 'อินฟลู' }) });
    const first = await h.useCase.execute(lineCtx(), { messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'รายการนี้' }] });
    for (const label of ['เงินของบริษัท', 'เหตุผล', 'ธุรกิจ', 'ผู้รับรองการจ่าย', 'โอน', 'วันที่']) assert.match(first.pendingQuestion!, new RegExp(label));
    const answered = await h.useCase.execute(lineCtx(), { messageText: 'บริษัทจ่ายเต็มจำนวน ไม่มีใบเสร็จเพราะอินฟลูเอนเซอร์ไม่ได้ออกใบเสร็จให้ วัตถุประสงค์ ค่าจ้างรีวิวร้าน ฉันเป็นผู้จ่าย จ่ายโดยโอนเงิน วันที่จ่าย 10 ตุลา 2569',
      chatKeyHash: 'chat-hash', recentCandidates: [] });
    const values = h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues;
    assert.equal(values.payerUserId, 'user-1'); assert.equal(values.fundingSource, 'COMPANY'); assert.equal(values.paidInFullAcknowledged, true);
    assert.equal(values.missingReceiptReason, 'อินฟลูเอนเซอร์ไม่ได้ออกใบเสร็จให้');
    assert.equal(values.businessPurpose, 'ค่าจ้างรีวิวร้าน'); assert.equal(values.paymentMethod, 'BANK_TRANSFER'); assert.equal(values.paymentDate, '2026-10-10');
    assert.deepEqual(answered.blockers.map(item => item.code), ['supporting_evidence_required', 'payment_evidence_required']);
    assert.doesNotMatch(answered.pendingQuestion!, /ใครเป็นผู้จ่าย|ธุรกิจเรื่องอะไร|วันที่เท่าไร/);
    assert.equal(Object.keys(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.provenance).length, answered.acceptedFields.length);
  });

  for (const answer of ['ไม่มีหลักฐานอื่น', 'ไม่มี', 'ไม่มีค่ะ']) it(`W2 accepts ${answer} without weakening required transfer proof`, async () => {
    const h = lineHarness({ expense: lineExpense({ vendorNameSnapshot: 'อินฟลู', paymentMethod: 'BANK_TRANSFER', paidAt: new Date('2026-10-10') }) });
    await h.useCase.execute(lineCtx(), { messageText: 'เหตุผล: ไม่มีใบเสร็จ วัตถุประสงค์: รีวิวร้าน ฉันเป็นผู้จ่าย บริษัทจ่ายเต็มจำนวน',
      chatKeyHash: 'chat-hash', recentCandidates: [{ id: 'expense-1', label: 'รายการนี้' }] });
    const result = await h.useCase.execute(lineCtx(), { messageText: answer, chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.ok(result.acceptedFields.includes('evidenceNone'));
    assert.deepEqual(result.blockers.map(item => item.code), ['payment_evidence_required']);
    assert.match(result.pendingQuestion!, /ส่งรูปสลิป/);
    assert.equal(h.prepares.length, 0);
  });

  it('W3 claims a recent evidence photo, attaches to the open expense, then clears the proof blocker', async () => {
    const h = lineHarness({ expense: lineExpense({ vendorNameSnapshot: 'อินฟลู', paymentMethod: 'BANK_TRANSFER', paidAt: new Date('2026-10-10') }) });
    await h.useCase.execute(lineCtx(), { messageText: 'เหตุผล: ไม่มีใบเสร็จ วัตถุประสงค์: รีวิวร้าน ฉันเป็นผู้จ่าย บริษัทจ่ายเต็มจำนวน',
      chatKeyHash: 'chat-hash', recentCandidates: [{ id: 'expense-1', label: 'รายการนี้' }] });
    const context = await h.useCase.loadOpenMediaContext(lineCtx(), 'chat-hash');
    assert.equal(context?.expenseId, 'expense-1'); assert.ok(context?.paymentEvidenceRequestedAt);
    const now = new Date(context!.paymentEvidenceRequestedAt!);
    assert.equal(substituteAwaitsCaptionlessPhoto(context!, now), true);
    assert.equal(substituteAwaitsCaptionlessPhoto(context!, new Date(+now + SUBSTITUTE_PHOTO_ASK_WINDOW_MS + 1)), false);
    await h.useCase.attachMedia(lineCtx(['expense.review', 'expense.receipt.upload']), { expenseId: 'expense-1', attachmentId: 'slip-7b', purpose: 'expense.payment.evidence' });
    assert.equal(h.links.length, 1); assert.equal(h.links[0].expenseId, 'expense-1');
    const continued = await h.useCase.execute(lineCtx(), { messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.deepEqual(continued.blockers, []); assert.equal(continued.status, 'READY_FOR_WEB');
    assert.equal(h.prepares.length, 0, 'attaching a photo does not prepare, sign or issue');
  });
});

async function actionHarness() {
  const h = await lineReadyHarness({ signature: { id: 'my-signature' } });
  const calls: any[] = [];
  let epoch = 1, policy: any = { approvalMode: 'OWNER_SELF', approverUserIds: [] }, available = true;
  h.repo.getSubstituteReceiptPolicy = async () => policy;
  h.repo.findReusableSignatureAsset = async () => available ? { id: 'my-signature' } : null;
  const service = new LineSubstituteReceiptActionService(
    { aiGatewayInternalSecret: 'test-secret', webBaseUrl: 'https://app.example.com', isProduction: false } as any,
    { client: { aiConversation: { findFirst: async () => ({ id: 'conversation', lifecycleEpoch: epoch }) } } } as any,
    h.repo, h.useCase,
    { execute: async () => ({ asPayer: { count: 0, items: [] }, asApprover: { count: 0, items: [] } }) } as any,
  );
  return { ...h, service, calls, epoch: () => { epoch++; }, policy: (next: any) => { policy = next; }, signature: (value: boolean) => { available = value; } };
}

describe('Fix-up 11 — LINE prepares and hands signing to the web', () => {
  const confirm = (token: string) => ({ action: 'expense_action_confirm' as const, token });
  it('prepares once with the real LINE actor, then offers one facts card with the exact web signing link', async () => {
    const h = await actionHarness(), actor = lineCtx();
    const prep = await h.service.prepare(actor, 'chat-hash', 'expense-1');
    assert.equal(prep.preview?.label, 'เตรียมใบรับรอง');
    for (const fact of ['ไปพบลูกค้า', 'วินไม่ออกใบเสร็จ', 'บริษัทจ่ายเต็มจำนวน', 'คุณ (ผู้ส่งข้อความ)', 'เงินสด', '15 ส.ค. 2569'])
      assert.ok(prep.preview!.summary.includes(fact), fact);
    assert.match(JSON.stringify(buildSubstituteReceiptActionCard(prep.preview!)), /expense_action_confirm/);
    const prepared = await h.service.apply(actor, 'chat-hash', confirm(prep.preview!.token));
    assert.equal(prepared.expenseId, 'expense-1'); assert.equal(h.prepares.length, 1);
    assert.equal(h.prepares[0].preparedByUserId, actor.userId);
    assert.equal(h.prepares[0].preparedFromChannel, 'LINE');
    h.signature(false); // Signing now belongs to the web even when no asset is saved.
    const sign = (await h.service.prepare(actor, 'chat-hash', 'expense-1')).preview!;
    assert.equal(sign.label, 'เปิดลงนามในเว็บ'); assert.equal(sign.webOnly, true);
    assert.match(sign.summary, /ไปพบลูกค้า/);
    assert.equal(sign.webPath, 'https://app.example.com/companies/company-1/expenses/substitute-receipts/evidence-1');
    const rendered: any = buildSubstituteReceiptActionCard(sign);
    assert.equal(rendered.type, 'flex'); assert.equal(rendered.contents.type, 'bubble');
    assert.deepEqual(rendered.contents.footer.contents, [{ type: 'button', style: 'primary',
      action: { type: 'uri', label: 'เปิดลงนามในเว็บ', uri: sign.webPath } }]);
    assert.doesNotMatch(JSON.stringify(rendered), /expense_action_confirm|expense_action_cancel|postback|sub_/);
    assert.equal(await h.service.current(actor, 'chat-hash', sign.token), true);
    assert.deepEqual(await h.service.quoteRecords(actor, 'chat-hash', sign.token), [{ tool: 'expense.get_detail', id: 'expense-1' }]);
    assert.equal(h.calls.length, 0);
  });

  for (const action of ['CERTIFY', 'APPROVE_ISSUE']) it(`a stale ${action} postback navigates to the same web page without signing`, async () => {
    const h = await actionHarness(), actor = lineCtx();
    await h.useCase.execute(actor, { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [] });
    const current = (await h.service.prepare(actor, 'chat-hash', 'expense-1')).preview!;
    const store = (h.service as any).store, entry = await store.load(actor.companyId, 'substitute-action:chat-hash');
    entry.action = action; delete entry.preview.webOnly;
    entry.preview.token = `${entry.previewId}.${(h.service as any).sign(entry)}`;
    await store.save(entry);
    h.getExpense().updatedAt = new Date('2026-10-16'); // Old source revision cannot trigger a mutation.
    const old = await h.service.apply(actor, 'chat-hash', confirm(entry.preview.token));
    assert.equal(old.expenseId, undefined); assert.match(old.reply, /เปิดเว็บ/);
    assert.equal(old.preview?.webPath, current.webPath); assert.equal(old.preview?.webOnly, true);
    assert.doesNotMatch(JSON.stringify(buildSubstituteReceiptActionCard(old.preview!)), /postback/);
    assert.equal(h.getExpense().substituteReceiptEvidence.status, 'PREPARED'); assert.equal(h.calls.length, 0);
    assert.equal(h.prepares.length, 1);
  });

  it('an expired old postback returns the authenticated hub link without an error or document facts', async () => {
    const h = await actionHarness();
    const result = await h.service.apply(lineCtx(), 'chat-hash', confirm('sub_expired.signature'));
    assert.equal(result.preview?.webPath, 'https://app.example.com/companies/company-1/expenses/substitute-receipts');
    assert.equal(result.preview?.webOnly, true); assert.match(result.reply, /เปิดเว็บ/);
    assert.doesNotMatch(JSON.stringify(buildSubstituteReceiptActionCard(result.preview!)), /postback|ใช้ไม่ได้|expense-1/);
    assert.equal(h.prepares.length, 0);
  });

  for (const changed of ['company', 'user', 'membership', 'chat', 'branch', 'epoch', 'revision', 'attachments', 'token', 'expiry']) {
    it(`rejects a ${changed} change before any use-case mutation`, async () => {
      const h = await actionHarness();
      const card = (await h.service.prepare(lineCtx(), 'chat-hash', 'expense-1')).preview!;
      let actor = lineCtx(), chat = 'chat-hash', token = card.token;
      if (changed === 'company') actor = { ...actor, companyId: 'other' };
      if (changed === 'user') actor = { ...actor, userId: 'other' };
      if (changed === 'membership') actor = { ...actor, membershipId: 'other' };
      if (changed === 'chat') chat = 'other';
      if (changed === 'branch') actor = { ...actor, scopes: { branchIds: ['other'] } };
      if (changed === 'epoch') h.epoch();
      if (changed === 'revision') h.getExpense().updatedAt = new Date('2026-10-16');
      if (changed === 'attachments') h.getExpense().attachments.push({ id: 'new-attachment' });
      if (changed === 'token') token = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
      if (changed === 'expiry') {
        const store = (h.service as any).store, entry = await store.load(actor.companyId, 'substitute-action:chat-hash');
        entry.preview.expiresAt = '2020-01-01T00:00:00.000Z'; await store.save(entry);
      }
      assert.equal((await h.service.apply(actor, chat, confirm(token))).expenseId, undefined);
      assert.equal(h.prepares.length, 0); assert.equal(h.calls.filter(call => ['certify', 'approve'].includes(call[0])).length, 0);
    });
  }

  it('uses the approval label only for an approver allowed by current policy', async () => {
    const h = await actionHarness();
    h.issue({ status: 'PAYER_CERTIFIED', payerUserId: 'user-1', version: 1, updatedAt: '2026-10-16T00:00:00Z' });
    for (const actor of [{ ...lineCtx(), roles: [] }, lineCtx(['expense.review'])])
      assert.equal((await h.service.prepare(actor, 'chat-hash', 'expense-1')).preview?.label, 'เปิดลงนามในเว็บ');
    assert.equal((await h.service.prepare(lineCtx(), 'chat-hash', 'expense-1')).preview?.label, 'เปิดอนุมัติในเว็บ');
    h.policy({ approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['other'] });
    assert.equal((await h.service.prepare(lineCtx(), 'chat-hash', 'expense-1')).preview?.label, 'เปิดลงนามในเว็บ');
  });

  it('does not expose prepared facts to an unrelated caller after review permission is lost', async () => {
    const h = await actionHarness();
    h.issue({ status: 'PREPARED', payerUserId: 'other-payer', version: 1, updatedAt: '2026-10-16T00:00:00Z' });
    const actor = lineCtx(['expense.review']);
    const offered = (await h.service.prepare(actor, 'chat-hash', 'expense-1')).preview!;
    assert.equal(offered.webOnly, true);
    assert.equal(await h.service.current(lineCtx([]), 'chat-hash', offered.token), false);
    assert.deepEqual(await h.service.prepare(lineCtx([]), 'chat-hash', 'expense-1'), {});
    const approver = (await h.service.prepare(lineCtx(['expense.confirm']), 'chat-hash', 'expense-1')).preview!;
    assert.equal(approver.label, 'เปิดอนุมัติในเว็บ');
  });

  it('a legacy paper form opens the web and does not ask for or embed a digital signature', async () => {
    const h = await actionHarness();
    await h.useCase.execute(lineCtx(), { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [] });
    Object.assign(h.getExpense().substituteReceiptEvidence, { signatureMode: 'PAPER', wetSignedScanAttachmentId: 'original-scan' });
    h.repo.findReusableSignatureAsset = async () => assert.fail('web owns signing');
    const paper = (await h.service.prepare(lineCtx(), 'chat-hash', 'expense-1')).preview!;
    assert.equal(paper.webOnly, true); assert.equal(paper.label, 'เปิดลงนามในเว็บ');
    assert.doesNotMatch(JSON.stringify(buildSubstituteReceiptActionCard(paper)), /postback/);
    assert.equal(h.getExpense().substituteReceiptEvidence.wetSignedScanAttachmentId, 'original-scan');
  });

  it('cancellation has no mutation and completed cards have no second signing button', async () => {
    const h = await actionHarness(), actor = lineCtx();
    const card = (await h.service.prepare(actor, 'chat-hash', 'expense-1')).preview!;
    const rendered = buildSubstituteReceiptActionCard(card, `ตรวจแล้วกดยืนยันค่ะ\nเปิดเอกสาร: ${card.webPath}`);
    assert.match(JSON.stringify(rendered), /expense_action_confirm/);
    assert.equal((rendered as any).contents.footer.contents.length, 2);
    assert.doesNotMatch(JSON.stringify((rendered as any).contents.body.contents.filter((part: any) => !part.action)), /https?:|expense-1|evidence-1/);
    assert.doesNotMatch(JSON.stringify(buildSubstituteReceiptActionCard(card, 'ออกแล้วค่ะ', true)), /expense_action_confirm|expense_action_cancel/);
    await h.service.apply(actor, 'chat-hash', { action: 'expense_action_cancel', token: card.token });
    assert.equal(h.prepares.length, 0); assert.equal(await h.service.current(actor, 'chat-hash', card.token), false);
  });
});

it('Fix-up 10 P4b: prepare without a signature sends only the real ask and never reoffers a live prepare card', async () => {
  const h = await actionHarness(), actor = lineCtx();
  h.signature(false);
  const offered = await h.service.prepare(actor, 'chat-hash', 'expense-1');
  assert.ok(offered.preview);
  const event: any = { webhookEventId: 'missing-signature', lineUserId: 'user',
    expenseActionControl: { action: 'expense_action_confirm', token: offered.preview.token } };
  const flow: any = Object.assign(Object.create(ProcessLineWebhookUseCase.prototype), {
    prisma: { client: { lineDeliveryPlan: { findFirst: async () => null } } }, substituteActions: h.service,
    deliverySubstituteActions: new WeakMap(), config: { webBaseUrl: 'https://app.example.com' },
    updateEventLog: async () => undefined,
    deliverCompletedReply: async () => assert.fail('a signature ask is not a completed action or an old preview'),
  });
  // The real continuation owns its stored chat binding.
  const result = await h.service.apply(actor, 'chat-hash', event.expenseActionControl);
  assert.match(result.reply, /ส่งรูป.*ลายเซ็น|ส่งรูปลายเซ็น/u);
  assert.equal(result.expenseId, undefined); assert.equal(result.preview, undefined);
  assert.equal(h.prepares.length, 0); assert.equal(h.calls.length, 0);
  assert.equal((await h.service.prepare(actor, 'chat-hash', 'expense-1')).preview, undefined);
  const sent: string[] = [];
  flow.substituteActions = { apply: async () => result, prepare: async () => assert.fail('do not refresh a prepare preview after the signature ask') };
  flow.deliverReply = async (_event: unknown, text: string) => sent.push(text);
  await flow.handleExpenseActionPostback(event, actor, null);
  assert.deepEqual(sent, [result.reply]);
  assert.doesNotMatch(sent.join('\n'), /ข้อมูลครบแล้ว|กดเตรียมใบรับรอง|expense_action_confirm/u);
  assert.equal(flow.deliverySubstituteActions.get(event), undefined);
});

it('Fix-up 11: a designated approver resumes their own queue to the approval page without expense.review', async () => {
  const h = await actionHarness(), actor = { ...lineCtx(['expense.confirm']), roles: ['STAFF'] };
  h.issue({ status: 'PAYER_CERTIFIED', payerUserId: 'other-payer', version: 1, updatedAt: '2026-10-16T00:00:00Z' });
  h.policy({ approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['user-1'] });
  (h.service as any).queue.execute = async (supplied: any) => {
    assert.equal(supplied, actor); return { asApprover: { count: 1, items: [{ documentNumber: 'SUB-202608-00007' }] } };
  };
  (h.service as any).prisma.client.expenseSubstituteReceiptEvidence = { findFirst: async (input: any) => {
    assert.deepEqual(input.where, { companyId: 'company-1', documentNumber: 'SUB-202608-00007' }); return { expenseId: 'expense-1' };
  } };
  const resumed = await h.service.resume(actor, 'chat-hash', 'อนุมัติใบรับรอง');
  assert.equal(resumed!.preview?.label, 'เปิดอนุมัติในเว็บ');
  assert.equal(resumed!.preview?.webPath, 'https://app.example.com/companies/company-1/expenses/substitute-receipts/evidence-1');
  assert.equal(h.getExpense().substituteReceiptEvidence.status, 'PAYER_CERTIFIED'); assert.equal(h.calls.length, 0);
});

it('Fix-up 9 R2/R3: a slip refreshes its own pending question; the facts card selects the person in one press and prepares once', async () => {
  const event: any = { webhookEventId: 'facts', lineUserId: 'line-user', messagingChannelId: 'oa', messageText: 'ข้อมูลใบรับรอง' };
  const chat = chatKeyHashOf(event), actor = lineCtx(['expense.review', 'expense.confirm', 'expense.receipt.upload']);
  const h = lineHarness({ expense: lineExpense(), signature: { id: 'my-signature' } });
  const first = await h.useCase.execute(actor, { messageText: 'ทำใบรับรองแทนใบเสร็จ ผู้จ่าย บริษัท ผู้รับเงิน คุณเอ อินฟลู เหตุผล ผู้รับเงินไม่ออกใบเสร็จ วัตถุประสงค์ ค่าโปรโมทร้าน จ่ายโอน วันที่ 10 ต.ค. 2569',
    chatKeyHash: chat, recentCandidates: [{ id: 'expense-1', label: 'รายการนี้' }], webBaseUrl: 'https://app.example.com' });
  assert.ok(first.blockers.some(item => item.code === 'payer_required'));
  assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.payerUserId, undefined, 'company funding never invents a human signer');
  // Real webhook source binding/consumption over storage seams; no validator or continuation doubles.
  const flow: any = Object.create(ProcessLineWebhookUseCase.prototype), markers: any[] = [];
  let waiting: any[] = [], serial = 0;
  Object.assign(flow, { config: { webBaseUrl: 'https://app.example.com' }, substituteReceiptContinuation: h.useCase,
    prisma: { client: { $transaction: async (work: any) => work({ outboxEvent: { create: async ({ data }: any) => markers.push(data) } }) } },
    ledger: { openWaitingUser: async () => waiting, ack: async (entry: any) => { waiting = waiting.filter(item => item.id !== entry.id); },
      appendSubRequests: async (input: any) => { for (const item of input.items) waiting.push({ id: `question-${++serial}`, text: item.text, question: item.clarifyQuestion,
        clarifyForIntent: item.clarifyForIntent, candidateExpenseIds: item.candidateExpenseIds, entry: { id: `question-${serial}`, userId: actor.userId, sourceContext: item.sourceContext } }); } },
    logger: { warn: () => undefined },
  });
  for (const key of ['deliveryAccess', 'deliverySources', 'deliveryReceiptSources', 'deliveryDraftPreviews', 'deliveryCandidates', 'clarificationRouteSources',
    'boundConversations', 'deliverySubstituteSources', 'deliverySubstituteActions', 'deliverySubstituteContinuations']) flow[key] = new WeakMap();
  const bind = (turn: any) => flow.deliveryAccess.set(turn, { userId: actor.userId, companyId: actor.companyId, fingerprint: 'current-access' });
  bind(event);
  await flow.rememberSubstituteDeliverySource(event, actor, first);
  await flow.appendSourceBoundClarifications(event, { companyId: actor.companyId, userId: actor.userId, chatKey: event.lineUserId,
    turnId: 'facts', webhookEventId: event.webhookEventId, items: [{ text: 'ทำใบรับรองแทนใบเสร็จรับเงินต่อ', state: 'waiting_user', intent: 'CLARIFY',
      clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION', clarifyQuestion: first.pendingQuestion, candidateExpenseIds: ['expense-1'] }] });
  const old = waiting[0];
  waiting.push({ id: 'other-work', clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION', candidateExpenseIds: ['another-expense'], entry: { id: 'other-work', userId: actor.userId } });
  const media: any = { ...event, webhookEventId: 'slip', messageText: undefined, messageType: 'image' }; delete media.messageText; bind(media);
  await h.useCase.attachMedia(actor, { expenseId: 'expense-1', attachmentId: 'slip', purpose: 'expense.payment.evidence' });
  assert.equal(await flow.clarificationSourceCurrent(media, actor, old), false, 'the pre-attachment proof remains stale; it is never weakened');
  const reply = await flow.currentSubstituteAttachmentReply(media, actor, 'expense-1', 'แนบแล้วค่ะ');
  await flow.replaceAttachedSubstituteClarification(media, actor, 'expense-1');
  assert.ok(markers.length > 0); assert.ok(waiting.some(item => item.id === 'other-work'));
  assert.ok(!waiting.some(item => item.id === old.id));
  const refreshed = waiting.find(item => item.id !== 'other-work')!;
  const selfEvent = { ...event, webhookEventId: 'self', messageText: 'ฉันเป็นผู้จ่าย' }; bind(selfEvent);
  assert.equal(await flow.waitingSourcesCurrent(selfEvent, actor, [refreshed]), true, 'own evidence does not trap the next payer answer behind LINE_DELIVERY_SOURCE_CHANGED');
  const current = flow.deliverySubstituteContinuations.get(media);
  const card: any = buildSubstituteReceiptFactsCard(current, reply);
  assert.deepEqual(card.contents.footer.contents.map((button: any) => button.action.label), ['ฉันเป็นผู้จ่าย', 'เลือกสมาชิกคนอื่น']);
  assert.equal(card.contents.footer.contents[0].action.text, 'ฉันเป็นผู้จ่าย');
  assert.equal(card.quickReply, undefined, 'the payer action appears once in the body, without a duplicate quick reply');
  assert.equal(card.contents.footer.contents[1].action.uri, current.webPath, 'other-person choice uses the existing guarded web member selector');
  assert.doesNotMatch(card.canonicalText, /ยืนยันผู้จ่ายเงินจริง|ตอบ “ฉันเป็นผู้จ่าย”/);
  const assertPlan = (message: any, token?: string) => {
    const createdAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 600_000).toISOString(), producerId = token ? 'prepare' : 'facts';
    const planId = lineDeliveryPlanId('WEBHOOK', producerId);
    const plan = buildLineDeliveryPlan({ producerKind: 'WEBHOOK', producerId, createdAt, readyAt: createdAt, expiresAt, firstDispatchDeadlineAt: expiresAt,
      authorization: { v: 2, kind: 'PRIVATE', issuedAt: createdAt, expiresAt, actor: { userId: actor.userId, companyId: actor.companyId, membershipId: actor.membershipId,
        requestId: actor.requestId, accessFingerprint: 'current-access', channelId: 'oa', channel: 'line', channelKind: 'USER', recipientHash: 'recipient', chatKeyHash: chat, conversationId: 'line-v2:conversation', ownerEpoch: 1 }, proofs: [] },
      businessResult: null, answer: { status: 'COMPLETE', pendingSubrequestIds: [], items: [{ kind: 'answer', text: message.canonicalText, required: true, sourceProofIds: [] }] },
      control: token ? { kind: 'EXPENSE_ACTION_CONFIRM', token, expiresAt, requiredItemIds: [`${planId}:item:0`] } : null,
      preferredMessages: [token ? null : message], ...(token ? { controlMessage: message } : {}) });
    assert.doesNotThrow(() => validateLineDeliveryPlan(plan)); assert.deepEqual(plan.batches[0]!.primary.messages.map(message => message.type), ['flex']);
  };
  assertPlan(card);
  const selected = await h.useCase.execute(actor, { messageText: card.contents.footer.contents[0].action.text, chatKeyHash: chat, recentCandidates: [] });
  assert.equal(selected.status, 'READY_FOR_WEB'); assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.payerUserId, actor.userId);
  const service = new LineSubstituteReceiptActionService({ aiGatewayInternalSecret: 'test-secret', webBaseUrl: 'https://app.example.com', isProduction: false } as any,
    { client: { aiConversation: { findFirst: async () => ({ id: 'conversation', lifecycleEpoch: 1 }) } } } as any,
    h.repo, h.useCase, {} as any);
  const next = await service.prepare(actor, chat, 'expense-1'); assert.equal(next.preview?.label, 'เตรียมใบรับรอง');
  assertPlan(buildSubstituteReceiptActionCard(next.preview!), next.preview!.token);
  await service.apply(actor, chat, { action: 'expense_action_confirm', token: next.preview!.token });
  await service.apply(actor, chat, { action: 'expense_action_confirm', token: next.preview!.token });
  assert.equal(h.prepares.length, 1, 'only the explicit prepare press creates a certificate, once');
  const handoff = (await service.prepare(actor, chat, 'expense-1')).preview!;
  assert.equal(handoff.webOnly, true);
  assertPlan(buildSubstituteReceiptActionCard(handoff));
});

it('U4 parsed substitute payee stays consistent across continuation, prepare and web-signing cards', async () => {
  const h = await actionHarness();
  const expense = h.getExpense();
  expense.vendorNameSnapshot = 'อินฟลู';
  expense.sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.payeeName = 'คุณเอ อินฟลู';
  expense.sourceChannelMetadataJson.lineSubstituteReceiptContinuation.pendingDecision = undefined;
  const continued = await h.useCase.execute(lineCtx(), { messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash', recentCandidates: [] });
  assert.match(continued.replyText, /คุณเอ อินฟลู/);
  assert.doesNotMatch(continued.replyText, /รายการ: [^\n]* · อินฟลู ·/);
  const preview = (await h.service.prepare(lineCtx(), 'chat-hash', 'expense-1')).preview!;
  assert.match(preview.summary, /ผู้รับเงิน: คุณเอ อินฟลู/);
  assert.doesNotMatch(preview.summary, /ผู้รับเงิน: อินฟลู/);
  await h.service.apply(lineCtx(), 'chat-hash', { action: 'expense_action_confirm', token: preview.token });
  assert.equal(h.prepares[0].payeeName, 'คุณเอ อินฟลู');
  const web = (await h.service.prepare(lineCtx(), 'chat-hash', 'expense-1')).preview!;
  assert.match(web.summary, /ผู้รับเงิน: คุณเอ อินฟลู/);
  assert.match(JSON.stringify(buildSubstituteReceiptActionCard(web)), /คุณเอ อินฟลู/);
});


it('R5 typed issue or form never prepares', async () => {
  const observations: any[] = [];
  for (const messageText of ['1', '2', 'ใช่']) {
    const h = await lineReadyHarness({ signature: { id: 'signature' } });
    const result = await h.useCase.execute(lineCtx(), { messageText, chatKeyHash: 'chat-hash', recentCandidates: [] });
    observations.push({ messageText, status: result.status, decision: (result as any).decisionOffered,
      prepares: h.prepares.length, reviewed: Boolean(h.getExpense().aiVerificationSummaryJson?.documentReview), numberAllocated: Boolean(h.getExpense().substituteReceiptEvidence?.documentNumber) });
  }
  console.log('R5 direct baseline', JSON.stringify(observations));
  assert.deepEqual(observations.map(row => [row.messageText, row.decision, row.prepares, Number(row.reviewed)]),
    [['1', 'ISSUE', 0, 0], ['2', 'FORM', 0, 0], ['ใช่', 'ISSUE', 0, 0]]);
});


it('R5 signed decisions bind the offer and FORM needs no saved signature', async () => {
  for (const decision of ['ISSUE', 'FORM'] as const) {
    const h = await actionHarness();
    if (decision === 'FORM') {
      h.signature(false);
      h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.signatureRequested = true;
    }
    const card = (await h.service.prepare(lineCtx(), 'chat-hash', 'expense-1', 'th', decision)).preview!;
    assert.equal(card.label, decision === 'FORM' ? 'เตรียมแบบไปเซ็น' : 'เตรียมใบรับรอง');
    const result = await h.service.apply(lineCtx(), 'chat-hash', { action: 'expense_action_confirm', token: card.token });
    assert.equal(result.expenseId, 'expense-1');
    assert.equal(h.prepares.length, 1);
    assert.equal(Boolean(h.prepares[0].lineContinuation?.formRequested), decision === 'FORM');
    await h.service.apply(lineCtx(), 'chat-hash', { action: 'expense_action_confirm', token: card.token });
    assert.equal(h.prepares.length, 1);
  }
  for (const legacy of [false, true]) {
    const h = await actionHarness();
    const card = (await h.service.prepare(lineCtx(), 'chat-hash', 'expense-1')).preview!;
    const store = (h.service as any).store;
    const entry = await store.load('company-1', 'substitute-action:chat-hash');
    if (legacy) delete entry.decision; else entry.decision = 'FORM';
    await store.save(entry);
    assert.equal((await h.service.apply(lineCtx(), 'chat-hash', { action: 'expense_action_confirm', token: card.token })).expenseId, undefined);
    assert.equal(h.prepares.length, 0);
  }
});
