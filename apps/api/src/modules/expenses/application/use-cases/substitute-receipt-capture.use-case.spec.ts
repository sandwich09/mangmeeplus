/**
 * W06 — the certificate of ONE derived source: which facts admit it, what the document then says,
 * and how the group reports the shop that is still waiting.
 *
 * Spec §12.1–§12.4, §14.3, appendix §7 (D04 wording). Acceptance A17–A20, A23, A34, A40, A44.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expenseEvidenceFingerprint } from '@watchdog-bms/contracts';
import {
  ApproveSubstituteReceiptUseCase,
  CertifySubstituteReceiptUseCase,
  PrepareSubstituteReceiptUseCase,
  PreviewSubstituteReceiptUseCase,
} from './substitute-receipt.use-case';
import {
  captureCertificateGate,
  captureDerivedNextAction,
  captureFundingRouteRefusal,
} from '../../domain/logic/expense-capture-certificate.logic';
import { assembleCaptureFacts } from '../../domain/logic/expense-capture-facts.logic';
import { captureAllocationStatement, renderSubstituteReceiptSvg, type SubstituteReceiptSnapshot } from '../../domain/logic/substitute-receipt.logic';
import { captureAllocationSnapshot } from '../../infrastructure/prisma-expense.repository';

const now = new Date('2026-09-18T10:00:00.000Z');
const audit = { log: async () => undefined } as any;
const notification = { execute: async () => ({}) } as any;
const GROUP_ID = 'cap-group-11112222';
const ALLOCATION_ID = 'alloc-1';

function ctx(userId = 'finance-1') {
  return {
    requestId: 'req-1', authSubject: userId, sessionId: 's-1', userId, companyId: 'co-1',
    membershipId: `m-${userId}`, roles: [], permissions: ['expense.review'], scopes: {}, authProvider: 'watchdog',
  } as any;
}

/** The observation one marketplace order produces, with the knobs the matrix below turns. */
function observation(over: { paid?: boolean; kind?: string; total?: string; itemsTotal?: string } = {}) {
  const total = over.total ?? '810.00';
  return {
    id: 'obs-1', fileId: 'file-1', expenseId: null, version: 1, source: 'AI' as const, stale: false,
    payloadJson: {
      documents: [{
        ref: 'doc-1', pageIndexes: [0], kind: over.kind ?? 'MARKETPLACE_ORDER',
        family: 'ORDER', issuer: { name: 'ร้านเอ', taxId: '0105560012345' },
        documentNumber: 'A-1', documentDate: '2026-09-18', currency: 'THB',
        classification: { documentKind: over.kind ?? 'MARKETPLACE_ORDER', confidence: 0.9 },
      }],
      items: [{
        id: '0:1', documentRef: 'doc-1', description: 'กระดาษ', quantity: '1', unitPrice: over.itemsTotal ?? total,
        amount: over.itemsTotal ?? total, event: 'sale', evidenceSpan: 'กระดาษ',
      }],
      components: [],
      totals: [{ documentRef: 'doc-1', kind: 'document_total', amount: total, evidenceSpan: total }],
      payments: [{
        documentRef: 'doc-1', method: 'BANK_TRANSFER', status: over.paid === false ? 'pending' : 'paid',
        amount: total, occurredAt: '2026-09-18', evidenceSpan: 'จ่ายแล้ว',
      }],
      refunds: [],
      completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
    },
  };
}

/** A derived source exactly as the W05 handoff writes one (appendix §18.1). */
function derivedExpense(over: Record<string, unknown> = {}) {
  const result = {
    id: 'exp-a', companyId: 'co-1', branchId: null, expenseNumber: 'EXP-A', status: 'NEEDS_REVIEW',
    captureSource: 'WEB_UPLOAD', sourceDocumentType: 'MARKETPLACE_ORDER_SCREENSHOT',
    taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE',
    grandTotalAmount: '810.00', netPayableAmount: '810.00', whtAmount: '0.00', currency: 'THB',
    expenseDate: now, paidAmount: '0', paidAt: now, paymentMethod: 'BANK_TRANSFER', bankAccountRef: null,
    expenseCategoryId: 'cat-1', accountHintKey: null, vendorNameSnapshot: 'ร้านเอ', vendorTaxIdSnapshot: '0105560012345',
    updatedAt: now,
    captureGroupId: GROUP_ID, captureAllocationId: ALLOCATION_ID, captureScopeKey: 'issuer:0105560012345',
    payerUserId: 'payer-1',
    aiVerificationSummaryJson: {
      dateStatus: 'verified', captureGroupId: GROUP_ID, allocationId: ALLOCATION_ID,
      scopeKey: 'issuer:0105560012345', paidTotal: '1290.00', companyAmount: '810.00',
      personalAmount: '480.00', policyVersion: 'shared-discount-v1+shipping-by-eligible-item-v1',
    } as Record<string, unknown>,
    lines: [{ description: 'กระดาษ', quantity: '1', lineTotalAmount: '810.00', expenseCategoryId: 'cat-1', accountHintKey: null }],
    attachments: [
      { id: 'att-source', purpose: 'expense.receipt.primary', originalFileName: 'order.pdf', mimeType: 'application/pdf', checksumSha256: 'src' },
      { id: 'att-slip', purpose: 'expense.payment.evidence', originalFileName: 'slip.jpg', mimeType: 'image/jpeg', checksumSha256: 'slip' },
    ],
    ...over,
  } as any;
  const assessment = { route: 'SUBSTITUTE_RECEIPT' as const, receiptProblem: 'NOT_AVAILABLE' as const, attachmentIds: [], reason: 'ร้านไม่ออกใบเสร็จ' };
  result.aiVerificationSummaryJson = {
    ...result.aiVerificationSummaryJson,
    documentReview: {
      version: 2, reviewedByUserId: 'finance-1', reviewedAt: now.toISOString(), assessment,
      fingerprint: expenseEvidenceFingerprint(result, assessment),
    },
  };
  return result;
}

function repoFor(expense: any, context: any, over: Record<string, unknown> = {}) {
  return {
    findByIdWithRelations: async (companyId: string, id: string) => companyId === 'co-1' && id === expense.id ? expense : null,
    findCaptureCertificateContext: async () => context,
    findSubstituteCaptureAllocation: async (companyId: string, row: any) =>
      captureAllocationSnapshot(row, { groupRevision: 4, policyVersion: 'shared-discount-v1+shipping-by-eligible-item-v1' }),
    findActiveMemberIdentity: async () => ({ userId: 'payer-1', displayName: 'สมชาย' }),
    getSubstituteReceiptPolicy: async () => ({ approvalMode: 'OWNER_SELF', cashEvidencePolicy: 'ALLOW_SUPPORTING_EVIDENCE_ONLY' }),
    listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
    findSubstituteEvidenceAttachments: async (_companyId: string, _expenseId: string, ids: string[]) => [
      { id: 'att-source', purpose: 'expense.receipt.primary', originalFileName: 'order.pdf', mimeType: 'application/pdf', checksumSha256: 'src' },
      { id: 'att-slip', purpose: 'expense.payment.evidence', originalFileName: 'slip.jpg', mimeType: 'image/jpeg', checksumSha256: 'slip' },
    ].filter((row) => ids.includes(row.id)),
    getSubstituteCompanyContext: async () => ({ name: 'บริษัท ทดสอบ จำกัด', nameSource: 'REGISTERED', taxId: '0105512345678', branchName: null }),
    createPreparedSubstituteEvidence: async (input: any) => preparedRecord(input),
    ...over,
  } as any;
}

const context = (over: Record<string, unknown> = {}) => ({
  group: { handoffState: 'ACTIVE', acceptedAllocationId: ALLOCATION_ID, fundingRoute: 'EMPLOYEE' },
  allocation: { groupRevision: 4, policyVersion: 'shared-discount-v1+shipping-by-eligible-item-v1', fundingRoute: 'EMPLOYEE' },
  observations: [observation()],
  ...over,
});

const prepareInput = (over: Record<string, unknown> = {}) => ({
  fundingSource: 'PERSONAL_ADVANCE' as const, paidInFullAcknowledged: true as const,
  reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'ร้านในมาร์เก็ตเพลสไม่ออกใบเสร็จ',
  businessPurpose: 'ซื้อของใช้สำนักงาน', payerUserId: 'payer-1', supportingAttachmentIds: ['att-source'],
  paymentEvidenceAttachmentIds: ['att-slip'],
  paymentMethod: 'BANK_TRANSFER', paymentDate: '2026-09-18', idempotencyKey: 'idem-a',
  expectedExpenseUpdatedAt: now.toISOString(),
  ...over,
} as any);

/** What the repository returns after a prepare — enough for `toSubstituteEvidenceSummary`. */
function preparedRecord(input: any) {
  return {
    ...input, id: 'sub-a', documentNumber: 'SRC-EXP-A-V1', version: 1, status: 'PREPARED',
    revisionOfEvidenceId: null, correctionOfEvidenceId: null, correctionReason: null,
    payerPosition: null, payerSignatureAttachmentId: null, payerSignatureChecksumSha256: null,
    certifiedArtifactAttachmentId: null, certifiedArtifactChecksumSha256: null, certifiedAt: null,
    approverUserId: null, approverName: null, approverPosition: null, approverSignatureAttachmentId: null,
    approvedAt: null, artifactAttachmentId: null, checksumSha256: null, issuedByUserId: null, issuedAt: null,
    supersededAt: null, supersedeReason: null, snapshotJson: null, snapshotChecksumSha256: null,
    wetSignedScanAttachmentId: null, wetSignedScanChecksumSha256: null, paperFormSnapshotJson: null,
    paperSubmissionJson: null, paperReviewedByUserId: null, payerName: 'สมชาย',
    preparedAt: now, createdAt: now, updatedAt: now, expenseUpdatedAtAtPreparation: now,
  };
}

const code = (error: any) => error?.response?.code ?? error?.getResponse?.()?.code;

describe('substitute receipt on a derived capture source', () => {
  it('prepares when the reviewed facts show the shop was paid', async () => {
    let captured: any;
    const repo = repoFor(derivedExpense(), context(), {
      createPreparedSubstituteEvidence: async (input: any) => { captured = input; return preparedRecord(input); },
    });
    await new PrepareSubstituteReceiptUseCase(repo, audit, notification).execute(ctx(), 'exp-a', prepareInput());

    assert.equal(captured.fundingSource, 'PERSONAL_ADVANCE');
    assert.equal(captured.payerUserId, 'payer-1');
    // A17: the certificate is for the company portion the derived source already carries.
    assert.equal(captured.payeeName, 'ร้านเอ');
  });

  it('refuses an order that is only waiting to be paid (A23)', async () => {
    const repo = repoFor(derivedExpense(), context({ observations: [observation({ paid: false })] }));
    await assert.rejects(
      () => new PrepareSubstituteReceiptUseCase(repo, audit, notification).execute(ctx(), 'exp-a', prepareInput()),
      (error: any) => error.getStatus() === 422 && code(error) === 'substitute_capture_unpaid_evidence',
    );
  });

  it('refuses a checkout whose totals do not reconcile (A34)', async () => {
    const repo = repoFor(derivedExpense(), context({ observations: [observation({ itemsTotal: '600.00' })] }));
    await assert.rejects(
      () => new PrepareSubstituteReceiptUseCase(repo, audit, notification).execute(ctx(), 'exp-a', prepareInput()),
      (error: any) => error.getStatus() === 422 && code(error) === 'substitute_capture_document_mismatch',
    );
  });

  it('refuses a share a newer allocation has replaced, and one whose group is no longer handed off (§14.3)', async () => {
    const superseded = repoFor(derivedExpense(), context({
      group: { handoffState: 'ACTIVE', acceptedAllocationId: 'alloc-2', fundingRoute: 'EMPLOYEE' },
    }));
    await assert.rejects(
      () => new PrepareSubstituteReceiptUseCase(superseded, audit, notification).execute(ctx(), 'exp-a', prepareInput()),
      (error: any) => error.getStatus() === 409 && code(error) === 'substitute_capture_allocation_superseded'
        && /การจัดส่วนเปลี่ยนไปแล้ว/.test(error.getResponse().message),
    );
    const released = repoFor(derivedExpense(), context({
      group: { handoffState: 'NONE', acceptedAllocationId: ALLOCATION_ID, fundingRoute: 'EMPLOYEE' },
    }));
    await assert.rejects(
      () => new PrepareSubstituteReceiptUseCase(released, audit, notification).execute(ctx(), 'exp-a', prepareInput()),
      (error: any) => error.getStatus() === 409 && code(error) === 'substitute_capture_allocation_superseded',
    );
  });

  it('refuses a funding source the group did not review (§12.4)', async () => {
    const repo = repoFor(derivedExpense(), context());
    await assert.rejects(
      () => new PrepareSubstituteReceiptUseCase(repo, audit, notification).execute(ctx(), 'exp-a', prepareInput({ fundingSource: 'COMPANY' })),
      (error: any) => error.getStatus() === 422 && code(error) === 'substitute_capture_funding_route_mismatch',
    );
  });

  it('judges the funding source against the allocation that derived the source, not a re-review in progress', async () => {
    // Someone is re-answering "who paid" on the group; the accepted allocation still says EMPLOYEE.
    const repo = repoFor(derivedExpense(), context({
      group: { handoffState: 'ACTIVE', acceptedAllocationId: ALLOCATION_ID, fundingRoute: 'COMPANY' },
    }));
    await new PrepareSubstituteReceiptUseCase(repo, audit, notification).execute(ctx(), 'exp-a', prepareInput());
  });

  it('keeps the "มีใบเสร็จใช้ได้" outcome for a shop that issued a receipt (A18/A19)', async () => {
    // The scope's document is a receipt, so the derived source carries RECEIPT and the unchanged
    // rule answers first — the capture gate only decides that the group must not OFFER one.
    const repo = repoFor(derivedExpense({ sourceDocumentType: 'RECEIPT' }), context({
      observations: [observation({ kind: 'RECEIPT' })],
    }));
    await assert.rejects(
      () => new PrepareSubstituteReceiptUseCase(repo, audit, notification).execute(ctx(), 'exp-a', prepareInput()),
      (error: any) => code(error) === 'valid_receipt_normal_path',
    );
    assert.equal(captureCertificateGate({
      group: { handoffState: 'ACTIVE', acceptedAllocationId: ALLOCATION_ID },
      source: { captureAllocationId: ALLOCATION_ID, captureScopeKey: 'issuer:0105560012345' },
      facts: assembleCaptureFacts([observation({ kind: 'RECEIPT' })] as never),
    }).outcome, 'receipt_present');
  });

  it('never certifies a capture group: a group id is not an expense', async () => {
    const repo = repoFor(derivedExpense(), context());
    await assert.rejects(
      () => new PrepareSubstituteReceiptUseCase(repo, audit, notification).execute(ctx(), GROUP_ID, prepareInput()),
      (error: any) => error.getStatus() === 404,
    );
  });

  it('leaves an ordinary expense and a §3.2 auto-handoff source on the unchanged path', async () => {
    let contextReads = 0;
    const ordinary = derivedExpense({ captureGroupId: null, captureAllocationId: null, captureScopeKey: null, payerUserId: null, sourceDocumentType: 'EXPENSE_NOTE_TEXT' });
    const repo = repoFor(ordinary, context(), { findCaptureCertificateContext: async () => { contextReads += 1; return context(); } });
    await new PrepareSubstituteReceiptUseCase(repo, audit, notification).execute(ctx(), 'exp-a', prepareInput());
    assert.equal(contextReads, 0, 'an ordinary expense costs no capture read');

    // Auto-handoff (§3.2): one LINE document, no allocation — nothing to reserve, nothing to divide.
    assert.equal(captureCertificateGate({
      group: { handoffState: 'ACTIVE', acceptedAllocationId: null },
      source: { captureAllocationId: null, captureScopeKey: 'issuer:0105560012345' },
      facts: assembleCaptureFacts([observation({ paid: false })] as never),
    }).outcome, 'available');
  });

  it('prints the company share against the amount actually paid, and nothing when there is no share (D04)', async () => {
    const repo = repoFor(derivedExpense(), context());
    const evidence = {
      id: 'sub-a', companyId: 'co-1', expenseId: 'exp-a', branchId: null, version: 1, status: 'PREPARED',
      documentNumber: 'SRC-EXP-A-V1', snapshotJson: null, fundingSource: 'PERSONAL_ADVANCE',
      originalSourceDocumentType: 'MARKETPLACE_ORDER_SCREENSHOT', reasonCode: 'PAYEE_CANNOT_ISSUE',
      missingReceiptReason: 'ร้านไม่ออกใบเสร็จ', businessPurpose: 'ซื้อของใช้สำนักงาน',
      paymentEvidenceAttachmentIds: ['att-slip'], supportingAttachmentIds: ['att-source'],
      paymentDate: now, paymentMethod: 'BANK_TRANSFER', note: null, payerUserId: 'payer-1', payerName: 'สมชาย',
      payeeName: 'ร้านเอ', payeeAddress: null, payeeTaxId: null, expenseUpdatedAtAtPreparation: now,
      correctionOfEvidenceId: null, signatureMode: 'DIGITAL', updatedAt: now,
    } as any;
    const preview = await new PreviewSubstituteReceiptUseCase({
      ...repo, findSubstituteEvidence: async () => evidence,
    } as any).execute({ ...ctx('payer-1'), userId: 'payer-1' }, 'exp-a', 'sub-a', {});
    const svg = Buffer.from(preview.svgDataUrl.split('base64,')[1]!, 'base64').toString('utf8');

    const expected = 'ใบรับรองนี้รับรองส่วนของกิจการ 810.00 บาท จากยอดที่จ่ายจริง 1,290.00 บาท'
      + ' ตามการจัดส่วนที่ตรวจแล้ว (กลุ่มหลักฐาน g11112222 ครั้งที่ 4)';
    assert.equal(svg.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').includes(expected.replace(/\s+/g, ' ')), true, svg.slice(0, 400));

    const wholePurchase = captureAllocationSnapshot(
      derivedExpense({ aiVerificationSummaryJson: { captureGroupId: GROUP_ID, allocationId: ALLOCATION_ID, paidTotal: '810.00', companyAmount: '810.00', personalAmount: '0.00' } }),
      { groupRevision: 4, policyVersion: 'shared-discount-v1+shipping-by-eligible-item-v1' },
    )!;
    assert.equal(captureAllocationStatement({ captureAllocation: wholePurchase }), null, 'no personal portion, no extra sentence');
    const wholeSheet = renderSubstituteReceiptSvg(snapshotWith(wholePurchase)).toString('utf8');
    assert.equal(wholeSheet.includes('ตามการจัดส่วนที่ตรวจแล้ว'), false);
    // The share statement never claims the payment evidence shows the company amount (§12.2/A17).
    assert.equal(/สลิป|หลักฐานธนาคาร/.test(captureAllocationStatement({ captureAllocation: snapshotWith().captureAllocation! })!), false);
  });

  /**
   * W07-int: prepare was the only place the capture gate ran. Everything after it checked that the
   * EXPENSE had not moved (`assertPreparedExpenseUnchanged`), which cannot see the GROUP accept a
   * different allocation — so a certificate could still be previewed, signed and approved stating a
   * division the group no longer records.
   */
  describe('the gate runs again at every step after prepare', () => {
    const preparedEvidence = (over: Record<string, unknown> = {}) => ({
      id: 'sub-a', companyId: 'co-1', expenseId: 'exp-a', branchId: null, version: 1, status: 'PREPARED',
      documentNumber: 'SRC-EXP-A-V1', snapshotJson: null, fundingSource: 'PERSONAL_ADVANCE',
      originalSourceDocumentType: 'MARKETPLACE_ORDER_SCREENSHOT', reasonCode: 'PAYEE_CANNOT_ISSUE',
      missingReceiptReason: 'ร้านไม่ออกใบเสร็จ', businessPurpose: 'ซื้อของใช้สำนักงาน',
      paymentEvidenceAttachmentIds: ['att-slip'], supportingAttachmentIds: ['att-source'],
      paymentDate: now, paymentMethod: 'BANK_TRANSFER', note: null, payerUserId: 'payer-1', payerName: 'สมชาย',
      payeeName: 'ร้านเอ', payeeAddress: null, payeeTaxId: null, expenseUpdatedAtAtPreparation: now,
      correctionOfEvidenceId: null, signatureMode: 'DIGITAL', updatedAt: now,
      certifiedArtifactChecksumSha256: 'certified-artifact', payerSignatureAttachmentId: 'sig-1',
      payerSignatureChecksumSha256: 'sig-checksum',
      ...over,
    } as any);
    /** The group has accepted a DIFFERENT allocation since the certificate was prepared. */
    const supersededRepo = (evidence: any) => ({
      ...repoFor(derivedExpense(), context({
        group: { handoffState: 'ACTIVE', acceptedAllocationId: 'alloc-2', fundingRoute: 'EMPLOYEE' },
      })),
      findSubstituteEvidence: async () => evidence,
    });
    const superseded = (error: any) => error.getStatus() === 409
      && code(error) === 'substitute_capture_allocation_superseded';

    it('refuses the preview', async () => {
      await assert.rejects(
        () => new PreviewSubstituteReceiptUseCase(supersededRepo(preparedEvidence()) as any)
          .execute({ ...ctx('payer-1'), userId: 'payer-1' }, 'exp-a', 'sub-a', {}),
        superseded,
      );
    });

    it('refuses the signature', async () => {
      await assert.rejects(
        () => new CertifySubstituteReceiptUseCase(
          supersededRepo(preparedEvidence()) as any, {} as any, audit, notification, { enqueue: async () => true } as any,
        ).execute({ ...ctx('payer-1'), userId: 'payer-1' }, 'exp-a', 'sub-a', {
          certificationAcknowledged: true, previewChecksumSha256: 'whatever',
          expectedEvidenceUpdatedAt: now.toISOString(),
        } as any),
        superseded,
      );
    });

    it('refuses the approval — the last gate before the document is real', async () => {
      const evidence = preparedEvidence({ status: 'PAYER_CERTIFIED', snapshotJson: { schemaVersion: 2 } });
      await assert.rejects(
        () => new ApproveSubstituteReceiptUseCase(
          supersededRepo(evidence) as any, {} as any, audit, { enqueue: async () => true } as any,
        ).execute({ ...ctx('approver-1'), permissions: ['expense.review', 'expense.confirm'] }, 'exp-a', 'sub-a', {
          approvalAcknowledged: true, certifiedArtifactChecksumSha256: 'certified-artifact',
          expectedEvidenceUpdatedAt: now.toISOString(),
        } as any),
        superseded,
      );
    });

    it('still lets an unchanged allocation through all three', async () => {
      const repo = (evidence: any) => ({ ...repoFor(derivedExpense(), context()), findSubstituteEvidence: async () => evidence });
      // Preview is the one that completes without any signature machinery.
      const preview = await new PreviewSubstituteReceiptUseCase(repo(preparedEvidence()) as any)
        .execute({ ...ctx('payer-1'), userId: 'payer-1' }, 'exp-a', 'sub-a', {});
      assert.ok(preview.previewChecksumSha256);
      // Certify and approve get past the gate and stop at their own next check, not at this one.
      await assert.rejects(
        () => new CertifySubstituteReceiptUseCase(
          repo(preparedEvidence()) as any, {} as any, audit, notification, { enqueue: async () => true } as any,
        ).execute({ ...ctx('payer-1'), userId: 'payer-1' }, 'exp-a', 'sub-a', {
          certificationAcknowledged: true, previewChecksumSha256: 'a-stale-preview',
          expectedEvidenceUpdatedAt: now.toISOString(),
        } as any),
        (error: any) => code(error) !== 'substitute_capture_allocation_superseded'
          && /preview no longer matches/.test(error.message),
      );
    });
  });

  it('reports what each shop is waiting for, so a retry continues with B only (A40)', () => {
    const gate = captureCertificateGate({
      group: { handoffState: 'ACTIVE', acceptedAllocationId: ALLOCATION_ID },
      source: { captureAllocationId: ALLOCATION_ID, captureScopeKey: 'issuer:0105560012345' },
      facts: assembleCaptureFacts([observation()] as never),
    });
    assert.equal(gate.outcome, 'available');
    assert.equal(captureDerivedNextAction(gate, null), 'certificate_available');
    assert.equal(captureDerivedNextAction(gate, { status: 'PREPARED' }), 'certificate_prepared');
    assert.equal(captureDerivedNextAction(gate, { status: 'PAYER_CERTIFIED' }), 'certificate_certified');
    assert.equal(captureDerivedNextAction(gate, { status: 'ISSUED' }), 'certificate_issued');
    assert.equal(captureDerivedNextAction({ outcome: 'receipt_present' }, null), 'receipt_present');
    assert.equal(captureDerivedNextAction({
      outcome: 'refused', code: 'substitute_capture_unpaid_evidence', status: 422, message: 'x',
    }, null), 'blocked');
    // A40: an issued shop keeps its own state even while a sibling is refused.
    assert.equal(captureDerivedNextAction({
      outcome: 'refused', code: 'substitute_capture_document_mismatch', status: 422, message: 'x',
    }, { status: 'ISSUED' }), 'certificate_issued');
  });

  it('matches the certificate funding source to the reviewed route (§12.4)', () => {
    assert.equal(captureFundingRouteRefusal('EMPLOYEE', 'PERSONAL_ADVANCE'), null);
    assert.equal(captureFundingRouteRefusal('COMPANY', 'COMPANY'), null);
    assert.equal(captureFundingRouteRefusal('UNKNOWN', 'COMPANY'), null, 'a route nobody reviewed cannot contradict one');
    assert.equal(captureFundingRouteRefusal('EMPLOYEE', 'COMPANY')?.code, 'substitute_capture_funding_route_mismatch');
    assert.equal(captureFundingRouteRefusal('COMPANY', 'PERSONAL_ADVANCE')?.code, 'substitute_capture_funding_route_mismatch');
  });
});

/** A minimal certified snapshot, for the two render assertions that do not need the use case. */
function snapshotWith(
  captureAllocation: NonNullable<SubstituteReceiptSnapshot['captureAllocation']> = {
    groupId: GROUP_ID, groupRef: 'g11112222', allocationId: ALLOCATION_ID, allocationRevision: 4,
    scopeKey: 'issuer:0105560012345', paidTotal: '1290.00', companyAmount: '810.00',
    personalAmount: '480.00', policyVersion: 'shared-discount-v1+shipping-by-eligible-item-v1',
  },
): SubstituteReceiptSnapshot {
  return {
    schemaVersion: 2, captureAllocation, documentNumber: 'SRC-EXP-A-V1', version: 1,
    company: { name: 'บริษัท ทดสอบ จำกัด', branchName: null, taxId: '0105512345678' },
    expense: {
      id: 'exp-a', expenseNumber: 'EXP-A', expenseDate: now.toISOString(), paymentDate: now.toISOString(),
      currency: 'THB', grandTotalAmount: '810.00', netPayableAmount: '810.00', whtAmount: '0.00',
      paymentMethod: 'BANK_TRANSFER', paymentReference: null, category: 'cat-1',
      businessPurpose: 'ซื้อของใช้สำนักงาน', lines: [{ description: 'กระดาษ', quantity: '1', amount: '810.00' }],
    },
    originalSourceDocumentType: 'MARKETPLACE_ORDER_SCREENSHOT', reasonCode: 'PAYEE_CANNOT_ISSUE',
    missingReceiptReason: 'ร้านไม่ออกใบเสร็จ', payee: { name: 'ร้านเอ', address: null, taxId: null },
    payer: { userId: 'payer-1', name: 'สมชาย', position: '', certifiedAt: now.toISOString() },
    certificationText: 'ข้าพเจ้า สมชาย ขอรับรอง', evidence: [], note: null,
  };
}
