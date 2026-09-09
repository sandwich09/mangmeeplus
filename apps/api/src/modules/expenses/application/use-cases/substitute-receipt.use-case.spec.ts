import assert from 'node:assert/strict';
import { SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS } from '@watchdog-bms/contracts';
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
  return {
    id: 'exp-1', companyId: 'co-1', branchId: null, expenseNumber: 'EXP-1', status: 'NEEDS_REVIEW',
    captureSource: 'WEB_UPLOAD', sourceDocumentType: 'EXPENSE_NOTE_TEXT', taxEvidenceStatus: 'SUPPORTING_ONLY',
    inputVatClaimStatus: 'NON_CLAIMABLE', grandTotalAmount: '65.00', currency: 'THB', expenseDate: now,
    paidAt: now, paymentMethod: 'CASH', bankAccountRef: null, expenseCategoryId: 'cat-1', accountHintKey: null,
    vendorNameSnapshot: 'ผู้ขายในตลาด',
    updatedAt: now, aiVerificationSummaryJson: null,
    lines: [{ description: 'ผักสด', quantity: '1', lineTotalAmount: '65.00', expenseCategoryId: 'cat-1', accountHintKey: null }],
    attachments: [{ id: 'att-source', purpose: 'expense.receipt.primary', originalFileName: 'bill.jpg', mimeType: 'image/jpeg', checksumSha256: 'src' }],
    ...overrides,
  } as any;
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
        sourceDocumentType: 'NEEDS_REVIEW',
        taxEvidenceStatus: 'NEEDS_REVIEW',
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
    assert.equal(captured.originalSourceDocumentType, 'NEEDS_REVIEW');

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
    for (const signatureMode of ['DIGITAL', 'PAPER']) {
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
      const previewCase = new PreviewSubstituteReceiptUseCase(repo);
      const certifyCase = new CertifySubstituteReceiptUseCase(repo, storage, audit, notification, cleanup);
      const approveCase = new ApproveSubstituteReceiptUseCase(repo, storage, audit, cleanup);
      const preview = await previewCase.execute(ctx(), 'exp-1', 'sub-1', {});
      for (const position of [123, 'ก'.repeat(121)]) {
        await assert.rejects(previewCase.execute(ctx(), 'exp-1', 'sub-1', { payerPosition: position } as any), /payerPosition/);
        await assert.rejects(certifyCase.execute(ctx(), 'exp-1', 'sub-1', { certificationAcknowledged: true, payerPosition: position } as any), /payerPosition/);
        await assert.rejects(approveCase.execute(ctx('approver-1', ['expense.confirm']), 'exp-1', 'sub-1', { approvalAcknowledged: true, approverPosition: position } as any), /approverPosition/);
      }
      const certifyInput = { certificationAcknowledged: true as const, signatureAttachmentId: 'sig', previewChecksumSha256: preview.previewChecksumSha256, expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString() };
      await assert.rejects(certifyCase.execute(ctx(), 'exp-1', 'sub-1', { ...certifyInput, payerPosition: 'เปลี่ยนหลังตรวจ' }), /preview no longer matches/);
      await certifyCase.execute(ctx(), 'exp-1', 'sub-1', certifyInput);
      assert.equal(evidence.payerPosition, '');
      assert.equal(evidence.snapshotJson.payer.position, '');
      assert.doesNotMatch(evidence.snapshotJson.certificationText, /ตำแหน่ง/);
      await approveCase.execute(ctx('approver-1', ['expense.confirm']), 'exp-1', 'sub-1', { approvalAcknowledged: true, signatureAttachmentId: 'sig', certifiedArtifactChecksumSha256: evidence.certifiedArtifactChecksumSha256, expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString() });
      assert.equal(issuedInput.approverPosition, '');
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

describe('R7 — LINE may prepare; LINE may not sign, approve, or download', () => {
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

  it('keeps certify, approve, preview, and artifact download web-only', async () => {
    const repo = { findSubstituteEvidence: async () => prepared() } as any;
    const web = /authenticated web only/;
    await assert.rejects(
      () => new CertifySubstituteReceiptUseCase(repo, {} as any, audit, notification, cleanup)
        .execute(line() as any, 'exp-1', 'sub-1', { certificationAcknowledged: true } as any),
      web,
    );
    await assert.rejects(
      () => new ApproveSubstituteReceiptUseCase(repo, {} as any, audit, cleanup)
        .execute(line('payer-1', ['expense.confirm']) as any, 'exp-1', 'sub-1', { approvalAcknowledged: true } as any),
      web,
    );
    await assert.rejects(
      () => new PreviewSubstituteReceiptUseCase(repo).execute(line() as any, 'exp-1', 'sub-1', { payerPosition: 'พนักงาน' }),
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
    const attachment = { id: 'scan', branchId: null, status: 'ACTIVE', bucket: 'b', objectKey: 'scan', mimeType: 'image/png', checksumSha256: checksum, byteSize: bytes.length };
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
    await assert.rejects(useCase.submit(ctx(), 'exp-1', 'sub-1', input), /ชื่อผู้ลงนามตรงกัน/);
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
