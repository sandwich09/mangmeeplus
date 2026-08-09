import assert from 'node:assert/strict';
import { SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS } from '@watchdog-bms/contracts';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import {
  ApproveSubstituteReceiptUseCase,
  CertifySubstituteReceiptUseCase,
  InitSubstituteSignatureUploadUseCase,
  PrepareSubstituteReceiptUseCase,
  PreviewSubstituteReceiptUseCase,
} from './substitute-receipt.use-case';
import { buildSubstituteCertificationText, canonicalSnapshotHash, type SubstituteReceiptSnapshot } from '../../domain/logic/substitute-receipt.logic';

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
    originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', reasonCode: 'PAYEE_CANNOT_ISSUE',
    missingReceiptReason: 'ผู้ขายในตลาดไม่ออกใบเสร็จ', businessPurpose: 'ซื้อวัตถุดิบ',
    paymentEvidenceAttachmentIds: [], supportingAttachmentIds: ['att-source'], paymentDate: now, paymentMethod: 'CASH', note: null,
    preparedByUserId: 'finance-1', preparedAt: now, expenseUpdatedAtAtPreparation: now,
    payerUserId: 'payer-1', payerName: 'สมชาย', payerPosition: null, payerSignatureAttachmentId: null, payerSignatureChecksumSha256: null,
    payeeName: 'ผู้ขายในตลาด', payeeAddress: null, payeeTaxId: null,
    certifiedArtifactAttachmentId: null, certifiedArtifactChecksumSha256: null, certifiedAt: null,
    approverUserId: null, approverName: null, approverPosition: null, approverSignatureAttachmentId: null, approvedAt: null,
    artifactAttachmentId: null, checksumSha256: null, issuedByUserId: null, issuedAt: null, supersededAt: null, supersedeReason: null,
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
      reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'ผู้ขายในตลาดไม่ออกใบเสร็จ',
      businessPurpose: 'ซื้อวัตถุดิบ', payerUserId: 'payer-1', supportingAttachmentIds: ['att-source'],
      payeeAddress: '  1 ถนนทดสอบ  ', payeeTaxId: '1-2345-67890-12-3',
      paymentMethod: 'CASH', idempotencyKey: 'idem-1', expectedExpenseUpdatedAt: now.toISOString(),
    });
    assert.equal(captured.originalSourceDocumentType, 'EXPENSE_NOTE_TEXT');
    assert.equal(captured.payerUserId, 'payer-1');
    assert.equal(captured.payeeName, 'ผู้ขายในตลาด');
    assert.equal(captured.payeeAddress, '1 ถนนทดสอบ');
    assert.equal(captured.payeeTaxId, '1234567890123');
    assert.equal(captured.paymentEvidenceAttachmentIds.length, 0);
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
      reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'ผู้ขายในตลาดไม่ออกใบเสร็จ',
      businessPurpose: 'ซื้อวัตถุดิบ', payerUserId: 'payer-1', supportingAttachmentIds: ['att-source'],
      paymentMethod: 'CASH', idempotencyKey: 'idem-1', expectedExpenseUpdatedAt: now.toISOString(),
    });
    assert.equal(notificationCount, 0);
  });

  it('requires a payee name without a vendor snapshot and requires 13 tax-ID digits', async () => {
    const input = {
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
      reasonCode: 'OTHER' as const, missingReceiptReason: 'x', businessPurpose: 'y', payerUserId: 'payer-1',
      supportingAttachmentIds: ['att-source'], idempotencyKey: 'idem-1', expectedExpenseUpdatedAt: now.toISOString(),
    };
    await assert.rejects(() => make(expense({ sourceDocumentType: 'RECEIPT' })).execute(ctx('finance-1'), 'exp-1', input), /eligible only/);
    await assert.rejects(() => make(expense({ grandTotalAmount: '0' })).execute(ctx('finance-1'), 'exp-1', input), /positive reviewed total/);
  });

  it('rejects certificate layouts beyond the shared line bounds before preparation', async () => {
    const make = (row: any) => new PrepareSubstituteReceiptUseCase({ findByIdWithRelations: async () => row } as any, audit, notification);
    const input = {
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
      reasonCode: 'OTHER', missingReceiptReason: 'ไม่มีใบเสร็จ', businessPurpose: 'ใช้ในกิจการ', payerUserId: 'payer-1',
      supportingAttachmentIds: Array.from({ length: limits.maxEvidenceAttachments }, (_, index) => `att-${index}`),
      paymentMethod: 'CASH', idempotencyKey: 'idem-boundary', expectedExpenseUpdatedAt: now.toISOString(),
    });
    assert.equal(persisted, true);
  });

  it('prepares without a policy row and retains the strict cash-evidence default', async () => {
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
    await assert.rejects(() => new PrepareSubstituteReceiptUseCase({
      ...baseRepo, getSubstituteReceiptPolicy: async () => null,
    } as any, audit, notification).execute(ctx('finance-1'), 'exp-1', input), /requires separate payment evidence/);
  });
});

describe('substitute receipt signing lifecycle', () => {
  it('allows only the selected payer and stores a signed immutable snapshot', async () => {
    const evidence = prepared();
    const storageWrites: any[] = [];
    let certifiedInput: any;
    const notifications: any[] = [];
    const repo = {
      findSubstituteEvidence: async () => evidence,
      findByIdWithRelations: async () => expense(),
      findPersonalSignatureAttachment: async () => ({ id: 'sig-payer', bucket: 'b', objectKey: 'sig', mimeType: 'image/png', byteSize: png.length, checksumSha256: null }),
      findSubstituteEvidenceAttachments: async () => [{ id: 'att-source', purpose: 'expense.receipt.primary', originalFileName: 'bill.jpg', mimeType: 'image/jpeg', checksumSha256: 'src' }],
      getSubstituteCompanyContext: async () => ({ name: 'บริษัท ทดสอบ จำกัด', taxId: '0101', branchName: null }),
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
    assert.equal(notifications[0].triggerKey, 'expense.substitute_receipt_signature_pending');
    assert.equal(notifications[0].sourceId, 'sub-1');
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
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'ผู้ขายไม่ออกใบเสร็จ',
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
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'ผู้ขายไม่ออกใบเสร็จ',
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
    }), /Only the company owner/);
    approvalMode = 'OWNER_SELF';
    await assert.rejects(() => useCase.execute(ctx('payer-1', ['expense.confirm']), 'exp-1', 'sub-1', {
      approverPosition: 'เจ้าของกิจการ', approvalAcknowledged: true, signatureAttachmentId: 'sig-approver',
      certifiedArtifactChecksumSha256: 'certified-checksum',
      expectedVersion: 1, expectedEvidenceUpdatedAt: now.toISOString(),
    }), /Only the company owner/);
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
