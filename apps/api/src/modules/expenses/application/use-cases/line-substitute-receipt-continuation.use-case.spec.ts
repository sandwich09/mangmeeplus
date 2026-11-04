import { UpdateExpenseDraftUseCase } from './expense-draft.use-case';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RequestContext } from '@watchdog-bms/contracts';
import {
  SUBSTITUTE_PHOTO_ASK_WINDOW_MS,
  substituteAwaitsCaptionlessPhoto,
  classifySubstituteMedia,
  isCanonicalSubstituteStart,
  isSubstituteCancelControl,
  isSubstitutePauseControl,
  isSubstituteQueueQuestion,
  isSubstituteReceiptConversationText,
  LineSubstituteReceiptContinuationUseCase,
  parseSubstituteMediaQuestion,
  SCAN_NOT_LINKABLE,
  substituteMediaAnswer,
  substituteMediaChoices,
  substituteMediaQuestion,
  substituteReceiptBadge,
  substituteRequestExpenseText,
  substituteScanConfirmAnswer,
  substituteScanConfirmQuestion,
  substituteScanPickQuestion,
} from './line-substitute-receipt-continuation.use-case';
import { PrepareSubstituteReceiptUseCase } from './substitute-receipt.use-case';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { CreateSignatureAssetUseCase } from './signature-asset.use-case';
import { toSubstituteEvidenceSummary } from '../../infrastructure/prisma-expense.repository';

const WEB_BASE = 'https://app.example.com';

export function ctx(permissions = ['expense.review', 'expense.confirm']): RequestContext {
  return {
    requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
    membershipId: 'mem-1', roles: ['OWNER'], permissions,
    scopes: { branchIds: ['branch-1'] }, authProvider: 'line',
  };
}

/** Keeping a signature is authorised by the acts of signing (owner decision 2026-08-20), so the
 *  default ctx above already qualifies. This adds the legacy self-access key on top, to show the two
 *  personas now get the identical script — the F8 dead end had no one left to strand. */
const SIGNER = ['expense.review', 'expense.confirm', 'expense.signature.manage'];

export function expense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'expense-1', companyId: 'company-1', branchId: 'branch-1', expenseNumber: 'EXP-001',
    status: 'NEEDS_REVIEW', sourceDocumentType: 'EXPENSE_NOTE_TEXT', currency: 'THB', grandTotalAmount: '200.0000',
    expenseCategoryId: 'cat-travel', accountHintKey: null, taxEvidenceStatus: 'SUPPORTING_ONLY',
    aiVerificationSummaryJson: null, missingReceiptReason: null, note: null,
    vendorNameSnapshot: null, paymentMethod: null, paidAt: null, paidAmount: '0.0000', netPayableAmount: '200.0000',
    sourceChannelMetadataJson: { channel: 'LINE', kind: 'text_note', chatKeyHash: 'chat-hash' },
    substituteReceiptEvidence: null,
    lines: [{ description: 'ค่าเดินทาง', expenseCategoryId: 'cat-travel', accountHintKey: null }],
    attachments: [],
    updatedAt: new Date('2026-08-16T09:00:00.000Z'),
    ...overrides,
  } as any;
}

/** A minimal, real PDF: the link gate loads the bytes, so a stub string cannot stand in. */
async function onePagePdf(pages = 1): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) pdf.addPage([200, 300]);
  return Buffer.from(await pdf.save());
}

export function harness(overrides: {
  expense?: any; policy?: any; approvers?: any[]; candidates?: any[]; categories?: Array<{ id: string; name: string }>;
  /** Bytes the stored scan attachment resolves to, for the R11 composability gate. */
  scanObject?: { bytes: Buffer; mimeType: string } | null;
  /** R13 choice 1 asks this before it prepares: an ACTIVE personal signature or nothing. */
  signature?: { id: string } | null;
  prepareError?: Error;
} = {}) {
  let current = overrides.expense ?? expense();
  const saves: any[] = [];
  const prepares: any[] = [];
  const audits: any[] = [];
  const links: any[] = [];
  const scanLinks: any[] = [];
  // Journey A writes through the REAL CreateSignatureAssetUseCase, so the store has to behave like
  // the table: what that use case creates is what the very next turn's lookup finds.
  const signatureAssets: any[] = [];
  const repo = {
    findById: async () => current,
    updateExpense: async (input: any, withinTx?: any) => {
      if (input.expectedUpdatedAt && input.expectedUpdatedAt.getTime() !== current.updatedAt.getTime()) throw new ConflictException('stale revision');
      current = { ...current, ...input, updatedAt: input.updatedAt ?? new Date(current.updatedAt.getTime() + 1) };
      if (typeof withinTx === 'function') await withinTx({ transaction: true });
      return current;
    },
    findReusableSignatureAsset: async (_companyId: string, _userId: string, attachmentId?: string) =>
      attachmentId ? null : signatureAssets.find((asset) => asset.status === 'ACTIVE') ?? overrides.signature ?? null,
    findSignatureAssetByLineMessageId: async (_companyId: string, lineMessageId: string) =>
      signatureAssets.find((asset) => asset.lineMessageId === lineMessageId) ?? null,
    createSignatureAsset: async (input: any) => {
      const asset = { id: `signature-${signatureAssets.length + 1}`, ...input };
      signatureAssets.unshift(asset);
      return asset;
    },
    linkAttachmentToTarget: async () => undefined,
    updateSignatureAsset: async (_companyId: string, id: string, data: any) => {
      const index = signatureAssets.findIndex((asset) => asset.id === id);
      signatureAssets[index] = { ...signatureAssets[index], ...data };
      return signatureAssets[index];
    },
    findSubstituteEvidenceAttachments: async (_companyId: string, _expenseId: string, ids: string[]) =>
      (current.attachments ?? [])
        .filter((item: any) => ids.includes(item.id))
        .map((item: any) => ({ ...item, originalFileName: `${item.id}.jpg`, mimeType: 'image/jpeg' })),
    createPreparedSubstituteEvidence: async (input: any) => {
      prepares.push(input);
      if (overrides.prepareError) throw overrides.prepareError;
      // Mirrors the real transaction: the evidence row appears on the expense, the expense revision
      // moves, and the continuation that fed it is CONSUMED (never deleted — it holds the provenance).
      const at = new Date(current.updatedAt.getTime() + 1000);
      const state = current.sourceChannelMetadataJson?.lineSubstituteReceiptContinuation;
      current = {
        ...current,
        updatedAt: at,
        substituteReceiptEvidence: {
          id: 'evidence-1', documentNumber: 'SUB-202608-00007', status: 'PREPARED',
          signatureMode: 'DIGITAL', wetSignedScanAttachmentId: null, preparedAt: at.toISOString(),
        },
        sourceChannelMetadataJson: {
          ...current.sourceChannelMetadataJson,
          ...(state ? {
            lineSubstituteReceiptContinuation: {
              ...state, status: 'CONSUMED', targetRevision: at.toISOString(), lastActivityAt: at.toISOString(),
              ...(input.lineContinuation?.formRequested ? { formRequested: true } : {}),
            },
          } : {}),
        },
      };
      const created = {
        ...input, id: 'evidence-1', version: 1, status: 'PREPARED', documentNumber: 'SUB-202608-00007',
        preparedAt: at, expenseUpdatedAtAtPreparation: at, updatedAt: at,
        payerPosition: null, certifiedArtifactAttachmentId: null, certifiedArtifactChecksumSha256: null, certifiedAt: null,
        approverUserId: null, approverName: null, approverPosition: null, approvedAt: null,
        artifactAttachmentId: null, checksumSha256: null, issuedAt: null, supersedeReason: null,
      };
      current = { ...current, substituteReceiptEvidence: toSubstituteEvidenceSummary(created) };
      return created;
    },
    listLineSubstituteContinuationRows: async () => {
      const state = current.sourceChannelMetadataJson?.lineSubstituteReceiptContinuation;
      return state ? [{ id: current.id, updatedAt: current.updatedAt, sourceChannelMetadataJson: current.sourceChannelMetadataJson }] : [];
    },
    findByIdWithRelations: async (_companyId: string, id: string) => id === current.id ? current : null,
    listCategories: async () => overrides.categories ?? [{ id: 'cat-travel', name: 'ค่าเดินทาง' }],
    findCategoryById: async (companyId: string, id: string) => {
      const category = (await repo.listCategories(companyId)).find((item: any) => item.id === id);
      return category ? { companyId, status: 'ACTIVE', ...category } : null;
    },
    getSubstituteReceiptPolicy: async () => overrides.policy ?? null,
    listEligibleSubstituteReceiptApprovers: async () => overrides.approvers ?? [{ userId: 'user-1', displayName: 'เจ้าของ' }],
    findActiveMemberIdentity: async (_companyId: string, userId: string) => userId === 'user-1' ? { userId, displayName: 'เจ้าของ' } : null,
    findActiveAttachmentObject: async () => overrides.scanObject === null
      ? null
      : { bucket: 'b', objectKey: 'scan', mimeType: overrides.scanObject?.mimeType ?? 'application/pdf', checksumSha256: 'scan-checksum' },
    linkAttachment: async (expenseId: string, attachmentId: string, purpose: string) => {
      links.push({ expenseId, attachmentId, purpose });
      current = { ...current, attachments: [...(current.attachments ?? []), { id: attachmentId, status: 'ACTIVE', purpose, mimeType: 'image/jpeg' }] };
    },
    linkSubstituteWetSignedScan: async (input: any) => {
      const evidence = current.substituteReceiptEvidence;
      if (evidence?.wetSignedScanAttachmentId === input.attachmentId) {
        return { documentNumber: evidence.documentNumber, linked: false };
      }
      if (!evidence || evidence.status !== 'PREPARED' || evidence.wetSignedScanAttachmentId) {
        throw new ConflictException('not linkable');
      }
      scanLinks.push(input);
      current = {
        ...current,
        substituteReceiptEvidence: { ...evidence, signatureMode: 'PAPER', wetSignedScanAttachmentId: input.attachmentId },
      };
      return { documentNumber: evidence.documentNumber, linked: true };
    },
    saveLineSubstituteContinuation: async (input: any) => {
      assert.equal(input.expectedUpdatedAt.toISOString(), current.updatedAt.toISOString(), 'CAS uses the current expense revision');
      const now = new Date(current.updatedAt.getTime() + 1000);
      const continuation = { ...input.continuation, targetRevision: now.toISOString(), lastActivityAt: now.toISOString() };
      current = {
        ...current,
        updatedAt: now,
        // Mirrors the repository: only signed confirmation supplies a category to this CAS.
        ...(input.expenseCategoryId ? { expenseCategoryId: input.expenseCategoryId } : {}),
        sourceChannelMetadataJson: { ...current.sourceChannelMetadataJson, lineSubstituteReceiptContinuation: continuation },
      };
      saves.push({ ...input, continuation });
      return { updatedAt: now, continuation };
    },
  } as any;
  // The real prepare use case, not a stub: R7's channel gate, its validation, and the audit fields
  // are exactly what these cases have to prove.
  const prepare = new PrepareSubstituteReceiptUseCase(
    repo,
    { log: async (entry: any) => { audits.push(entry); } } as any,
    { execute: async () => ({}) } as any,
  );
  return {
    useCase: new LineSubstituteReceiptContinuationUseCase(
      repo, prepare,
      { log: async (entry: any) => { audits.push(entry); } } as any,
      { getObject: async () => overrides.scanObject ?? { bytes: await onePagePdf(), mimeType: 'application/pdf' } } as any,
      new UpdateExpenseDraftUseCase(repo, { log: async (entry: any) => { audits.push(entry); } } as any,
        { resolveLines: async (_ctx: any, _header: any, lines: any[]) => lines } as any),
    ),
    repo, saves, prepares, audits, links, scanLinks, getExpense: () => current,
    /** The state a LINE-prepared expense is in once the web approval issued it: an evidence row plus
     *  the CONSUMED continuation the prepare left behind, which still holds the provenance. */
    issue: (patch: Record<string, unknown> = {}) => {
      current = {
        ...current,
        substituteReceiptEvidence: {
          id: 'evidence-1', documentNumber: 'SUB-202608-00007', status: 'ISSUED',
          signatureMode: 'DIGITAL', wetSignedScanAttachmentId: null, preparedAt: current.updatedAt.toISOString(),
          ...patch,
        },
        sourceChannelMetadataJson: {
          ...current.sourceChannelMetadataJson,
          lineSubstituteReceiptContinuation: {
            workflowId: 'wf-1', kind: 'SUBSTITUTE_RECEIPT', companyId: 'company-1', userId: 'user-1',
            expenseId: current.id, chatKeyHash: 'chat-hash', status: 'CONSUMED', acceptedValues: {}, provenance: {},
            resolvedFields: [], missingFields: [], attachmentRefs: [], pendingQuestion: null,
            targetRevision: current.updatedAt.toISOString(), lastActivityAt: current.updatedAt.toISOString(),
          },
        },
      };
    },
  };
}

/** Drives a fresh workflow to the R13 question: every blocker answered in one message. */
export async function readyHarness(overrides: Parameters<typeof harness>[0] = {}) {
  const h = harness({
    expense: expense({
      vendorNameSnapshot: 'วินมอเตอร์ไซค์', paymentMethod: 'CASH', paidAt: new Date('2026-08-15T00:00:00.000Z'),
      missingReceiptReason: 'วินไม่ออกใบเสร็จ',
      attachments: [{ id: 'att-1', status: 'ACTIVE', purpose: 'expense.receipt.supporting' }],
    }),
    ...overrides,
  });
  const asked = await h.useCase.execute(ctx(), {
    messageText: 'ไม่มีใบเสร็จ\nวัตถุประสงค์: ไปพบลูกค้า\nฉันเป็นผู้จ่าย บริษัทจ่ายเต็มจำนวน', chatKeyHash: 'chat-hash',
    recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }], webBaseUrl: WEB_BASE,
  });
  return { ...h, asked };
}

describe('LineSubstituteReceiptContinuationUseCase', () => {
  it('starts a paid check-bill route on the same expense and removes only its classification blockers', async () => {
    const h = harness({
      expense: expense({
        sourceDocumentType: 'NEEDS_REVIEW',
        taxEvidenceStatus: 'NEEDS_REVIEW',
        aiVerificationSummaryJson: {
          status: 'NOT_EXPENSE_DOCUMENT',
          classification: { documentKind: 'ORDER_OR_CHECK_BILL' },
        },
        vendorNameSnapshot: 'ร้านอาหารทดสอบ',
        attachments: [{ id: 'att-check', status: 'ACTIVE', purpose: 'expense.receipt.primary' }],
      }),
    });
    const started = await h.useCase.startFromCheckBill(ctx(), {
      expenseId: 'expense-1', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
    });
    assert.equal(started.pendingQuestion?.includes('จ่ายเงิน'), true);
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.routeCheckBill, true);

    const next = await h.useCase.execute(ctx(), {
      messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });
    const codes = next.blockers.map((item) => item.code);
    assert.equal(codes.includes('source_type_ineligible'), false);
    assert.equal(codes.includes('classification_ineligible'), false);
    assert.equal(codes.includes('document_kind_ineligible'), false);
    assert.equal(codes.includes('tax_evidence_review_required'), false);
    assert.equal(codes.includes('payment_evidence_required'), true, 'check-bill cash also needs separate actual proof');
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.reasonCode, 'RECEIPT_UNAVAILABLE');

    const prefill = await h.useCase.loadForWeb({ ...ctx(), authProvider: 'watchdog' }, 'expense-1', started.workflowId!);
    assert.equal(prefill.routeCheckBill, true);
  });

  it('blocks cash check bills without separate active image/PDF proof under permissive and absent policies', async () => {
    for (const policy of [null, { approvalMode: 'OWNER_SELF', cashEvidencePolicy: 'ALLOW_SUPPORTING_EVIDENCE_ONLY' }]) {
      for (const proof of [null,
        { id: 'source', status: 'ACTIVE', purpose: 'expense.payment.evidence', mimeType: 'image/jpeg' },
        { id: 'proof', status: 'DELETED', purpose: 'expense.payment.evidence', mimeType: 'image/jpeg' },
        { id: 'proof', status: 'ACTIVE', purpose: 'expense.payment.evidence', mimeType: 'text/plain' },
        { id: 'proof', status: 'ACTIVE', purpose: 'expense.payment.evidence', mimeType: 'application/pdf' }]) {
        const h = harness({ policy, expense: expense({
          primaryAttachmentId: 'source', paymentMethod: 'CASH',
          aiVerificationSummaryJson: { status: 'NOT_EXPENSE_DOCUMENT', classification: { documentKind: 'ORDER_OR_CHECK_BILL' } },
          attachments: [{ id: 'source', status: 'ACTIVE', purpose: 'expense.receipt.primary', mimeType: 'image/jpeg' }, ...(proof ? [proof] : [])],
        }) });
        await h.useCase.startFromCheckBill(ctx(), { expenseId: 'expense-1', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE });
        const result = await h.useCase.execute(ctx(), { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
        assert.equal(result.blockers.some((item) => item.code === 'payment_evidence_required'), proof?.mimeType !== 'application/pdf');
        assert.equal(h.prepares.length, 0);
        assert.equal(h.getExpense().id, 'expense-1');
      }
    }
  });

  it('returns every knowable blocker together and keeps absent policy as ready OWNER_SELF semantics', async () => {
    const h = harness();
    // Canonical explicit start (a paraphrase like "ทำใบทดแทน" would instead ask to confirm first).
    const result = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });

    assert.equal(result.status, 'BLOCKED');
    const codes = result.blockers.map((item) => item.code);
    assert.ok(codes.includes('reason_code_required'));
    assert.ok(codes.includes('missing_receipt_reason_required'));
    assert.ok(codes.includes('business_purpose_required'));
    assert.ok(codes.includes('payer_required'));
    assert.ok(codes.includes('payee_required'));
    assert.ok(codes.includes('payment_method_required'));
    assert.ok(codes.includes('payment_date_required'));
    assert.ok(codes.includes('supporting_evidence_required'));
    assert.equal(codes.includes('payment_evidence_required'), false,
      'R6: with no policy row and no stated non-cash method, separate payment evidence is not demanded');
    assert.equal(codes.some((code) => code.includes('policy') || code.includes('designated')), false,
      'no policy row is the ready OWNER_SELF default, not feature-disabled');
    assert.deepEqual(result.policy, { configured: false, ready: true, approvalMode: 'OWNER_SELF' });
    assert.match(result.replyText, /เจ้าของอนุมัติเองได้ · ใช้ค่าเริ่มต้นของระบบ · พร้อม/);
    assert.match(result.replyText, /สิ่งที่ยังต้องทำทั้งหมด/);
    assert.match(result.replyText, /ลงนามและอนุมัติทำในเว็บค่ะ เตรียมใบรับรองเสร็จแล้วน้องจะส่งลิงก์ให้/);
    assert.equal(h.saves.length, 1);
  });

  it('returns forbidden with no link at all before any target is discovered when review permission is missing', async () => {
    const h = harness();
    const result = await h.useCase.execute({ ...ctx(), permissions: ['expense.receipt.line_upload'] }, {
      messageText: 'ทำใบทดแทนใบเสร็จ', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.equal(result.status, 'FORBIDDEN');
    assert.equal(result.webPath, undefined);
    assert.equal(result.replyText.includes('/expenses/expense-1'), false);
    assert.match(result.replyText, /expense\.review|สิทธิ์ตรวจทานค่าใช้จ่าย/);
    assert.equal(result.replyText.includes('/companies/'), false, 'a forbidden reply carries no tenant path');
    assert.equal(result.replyText.includes('http'), false, 'a forbidden reply carries no link');
    assert.equal(h.saves.length, 0);
  });

  it('still demands payment evidence for a non-cash method and under an explicit strict policy', async () => {
    const nonCash = await harness().useCase.execute(ctx(), {
      messageText: 'ทำใบทดแทนใบเสร็จ\nชำระด้วยโอน', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.ok(nonCash.blockers.some((item) => item.code === 'payment_evidence_required'),
      'a transfer slip exists by nature, so non-cash still requires it');

    const strict = await harness({
      policy: { approvalMode: 'OWNER_SELF', approverUserIds: [], cashEvidencePolicy: 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE' },
    }).useCase.execute(ctx(), {
      messageText: 'ทำใบทดแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.ok(strict.blockers.some((item) => item.code === 'payment_evidence_required'),
      'a company that deliberately chose the strict rule keeps it');
  });

  it('asks about evidence once and clears the blocker when the sender states there is none', async () => {
    const h = harness({
      expense: expense({
        vendorNameSnapshot: 'ร้านน้ำแข็ง', paymentMethod: 'CASH', paidAt: new Date('2026-08-15T00:00:00.000Z'),
        missingReceiptReason: 'ร้านไม่ออกใบเสร็จ',
      }),
    });
    const asked = await h.useCase.execute(ctx(), {
      messageText: 'ไม่มีใบเสร็จ\nวัตถุประสงค์: ไปพบลูกค้า\nฉันเป็นผู้จ่าย บริษัทจ่ายเต็มจำนวน', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }], webBaseUrl: WEB_BASE,
    });
    assert.equal(asked.status, 'BLOCKED');
    assert.deepEqual(asked.blockers.map((item) => item.code), ['supporting_evidence_required']);
    assert.match(asked.pendingQuestion ?? '', /มีสลิปหรือรูปถ่ายประกอบไหมคะ/);

    const declared = await h.useCase.execute(ctx(), {
      messageText: 'ไม่มีหลักฐาน', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });
    assert.equal(declared.status, 'READY_FOR_WEB');
    assert.deepEqual(declared.blockers, []);
    assert.ok(declared.acceptedFields.includes('evidenceNone'));
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.evidenceNone, true,
      'the declaration is persisted, so the question is never asked twice');
    assert.equal(declared.replyText.includes('true'), false, 'the echo shows readable Thai, not a raw boolean');
  });

  it('accepts the bare “ไม่มี” people actually answer, while the combined evidence question is pending', async () => {
    const h = harness({
      expense: expense({
        vendorNameSnapshot: 'ร้านน้ำแข็ง', paymentMethod: 'CASH', paidAt: new Date('2026-08-15T00:00:00.000Z'),
        missingReceiptReason: 'ร้านไม่ออกใบเสร็จ',
      }),
    });
    const asked = await h.useCase.execute(ctx(), {
      messageText: 'ไม่มีใบเสร็จ\nวัตถุประสงค์: ไปพบลูกค้า\nฉันเป็นผู้จ่าย บริษัทจ่ายเต็มจำนวน', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.deepEqual(asked.blockers.map((item) => item.code), ['supporting_evidence_required']);

    const answered = await h.useCase.execute(ctx(), {
      messageText: 'ไม่มีค่ะ', chatKeyHash: 'chat-hash', recentCandidates: [],
    });
    assert.equal(answered.status, 'READY_FOR_WEB', 'the question does not loop on its own natural answer');
    assert.ok(answered.acceptedFields.includes('evidenceNone'));

    // The combined ask includes evidence even when another missing field is listed first.
    const other = harness();
    await other.useCase.execute(ctx(), {
      messageText: 'ทำใบทดแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    const stray = await other.useCase.execute(ctx(), {
      messageText: 'ไม่มีค่ะ', chatKeyHash: 'chat-hash', recentCandidates: [],
    });
    assert.equal(stray.acceptedFields.includes('evidenceNone'), true);
  });

  it('reads a label mid-line and never invents one out of ordinary prose', async () => {
    const h = harness();
    // The dispatcher collapses newlines to spaces before this use case ever sees the message.
    const collapsed = await h.useCase.execute(ctx(), {
      messageText: 'สร้างใบทดแทนใบเสร็จ ผู้รับเงิน: ร้านน้ำแข็ง วัตถุประสงค์: เลี้ยงลูกค้า',
      chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });
    assert.match(collapsed.replyText, /• ผู้รับเงิน\/ผู้ขาย: ร้านน้ำแข็ง$/mu, 'the first value stops at the next label');
    assert.match(collapsed.replyText, /• วัตถุประสงค์ทางธุรกิจ: เลี้ยงลูกค้า$/mu, 'the second label is not swallowed');

    const question = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบทดแทนใบเสร็จ สอบถามยอดขาย', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });
    assert.equal(/• ยอดเงิน/u.test(question.replyText), false, 'a label inside a word is not a label');
  });

  it('never lets mid-line prose write a certified field: only an explicit “:” marks a label there', async () => {
    // คือ/เป็น stay valid at the start of a line (unchanged); mid-line they are ordinary Thai words.
    const prose: Array<[string, RegExp]> = [
      ['ทำใบทดแทนใบเสร็จ ค่าส่งของวันนี้ ผู้ขายเป็นคนจัดส่งเอง', /• ผู้รับเงิน\/ผู้ขาย/u],
      ['ทำใบทดแทนใบเสร็จ ค่าเดินทาง ยอดเป็น 50 บาทหรือเปล่า', /• ยอดเงิน/u],
      ['ทำใบทดแทนใบเสร็จ สรุปแล้ว หมวดเป็นค่าเดินทาง', /• หมวดค่าใช้จ่าย/u],
      ['ทำใบทดแทนใบเสร็จ ตอนนี้ รายการคือเรื่องที่ต้องคุยกันก่อน', /• รายการ/u],
    ];
    for (const [messageText, forbidden] of prose) {
      const result = await harness().useCase.execute(ctx(), {
        messageText, chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
      });
      assert.equal(forbidden.test(result.replyText), false, `${messageText} must not populate ${forbidden}`);
    }
  });

  it('hands the capture gate one contiguous slice of the message, and nothing when only an amount is left', () => {
    assert.equal(substituteRequestExpenseText('สร้างใบทดแทนใบเสร็จ ค่าวินมอไซต์ไปพบลูกค้า 50 บาท'), 'ค่าวินมอไซต์ไปพบลูกค้า 50 บาท');
    // The phrase can trail the fact. `ขอใบแทน` is itself entry vocabulary and matches first, so the
    // slice is the fact alone — still verbatim source text, which is all the capture gate requires.
    assert.equal(substituteRequestExpenseText('ค่าวินมอไซต์ไปพบลูกค้า 50 บาท ขอใบแทนใบเสร็จ'), 'ค่าวินมอไซต์ไปพบลูกค้า 50 บาท');
    assert.equal(substituteRequestExpenseText('ทำใบทดแทนใบเสร็จ 50 บาท'), undefined, 'an amount alone is not a purpose');
    assert.equal(substituteRequestExpenseText('ทำใบทดแทนใบเสร็จ'), undefined, 'a leftover request verb is not a purpose');
    assert.equal(substituteRequestExpenseText('ขอใบแทนใบเสร็จ ค่าแท็กซี่ 120 บาท'), 'ค่าแท็กซี่ 120 บาท');
    assert.equal(substituteRequestExpenseText('ค่ากาแฟ 65 บาท'), undefined, 'not a substitute request at all');
  });

  it('drops the preposition a standalone document word leaves in front of the expense text', () => {
    // The UAT sentence. Splitting on `ใบทดแทน` alone would have titled the draft “ของค่าวินมอไซค์…”.
    assert.equal(
      substituteRequestExpenseText('ทำรายการใบทดแทนของค่าวินมอไซค์ไปพบลูกค้า 50 บาท'),
      'ค่าวินมอไซค์ไปพบลูกค้า 50 บาท',
    );
    assert.equal(substituteRequestExpenseText('อยากได้ใบแทนสำหรับค่าที่จอดรถ 40 บาท'), 'ค่าที่จอดรถ 40 บาท');
    // `ของ` is only a preposition in front of a cost/act noun — `ของขวัญ` is a word of its own.
    assert.equal(substituteRequestExpenseText('ทำใบทดแทนของขวัญลูกค้า 500 บาท'), 'ของขวัญลูกค้า 500 บาท');
    // Whatever survives is still ONE contiguous slice of the source, which is the capture gate's rule.
    for (const message of [
      'ทำรายการใบทดแทนของค่าวินมอไซค์ไปพบลูกค้า 50 บาท',
      'อยากได้ใบแทนสำหรับค่าที่จอดรถ 40 บาท',
      'ทำใบทดแทนของขวัญลูกค้า 500 บาท',
    ]) {
      assert.equal(message.includes(substituteRequestExpenseText(message)!), true, message);
    }
  });

  it('matches the composed-ำ vocabulary the formatter itself tells users to type', () => {
    assert.equal(isSubstituteReceiptConversationText('ทำใบรับรองต่อ'), true);
    assert.equal(isSubstituteReceiptConversationText('ขอใบแทนใบเสร็จหน่อย'), true);
    assert.equal(isSubstituteReceiptConversationText('ยอดขายเดือนนี้เท่าไหร่'), false);
  });

  it('echoes every understood value in readable Thai, byte-identical, with one absolute wizard link and no target', async () => {
    const h = harness();
    const result = await h.useCase.execute(ctx(), {
      messageText: [
        'สร้างใบทดแทนใบเสร็จ',
        'ผู้รับเงิน: ร้านน้ำแข็ง',
        'ยอด: 50 บาท',
        'หมวด: ค่าเดินทาง',
        'ชำระด้วยเงินสด',
        'วันที่จ่าย: 15 สิงหาคม 2569',
        'ฉันเป็นผู้จ่าย บริษัทจ่ายเต็มจำนวน',
        'ไม่มีใบเสร็จ',
      ].join('\n'),
      chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });
    assert.equal(result.status, 'TARGET_REQUIRED');
    assert.match(result.replyText, /ยังไม่บันทึก/);
    assert.ok(result.replyText.includes('• ผู้รับเงิน/ผู้ขาย: ร้านน้ำแข็ง'), 'ำ survives the round trip byte-identically');
    assert.match(result.replyText, /• ยอดเงิน: 50/);
    assert.match(result.replyText, /• หมวดค่าใช้จ่าย: ค่าเดินทาง/, 'a typed category is resolved to its name, not dropped');
    assert.match(result.replyText, /• วิธีชำระเงิน: เงินสด/);
    assert.match(result.replyText, /• ผู้ดำเนินการจ่ายและรับรอง: คุณ \(ผู้ส่งข้อความ\)/);
    assert.match(result.replyText, /• กรณีที่ใช้ใบเสร็จเดิมไม่ได้: ไม่มีใบเสร็จ\/ใบเสร็จหาย/);
    assert.match(result.replyText, /• วันที่ชำระเงินจริง: 15 ส\.ค\. 2569/);
    assert.equal(/^• .*: *$/mu.test(result.replyText), false, 'no echoed bullet is left dangling without a value');
    assert.equal(result.replyText.includes('RECEIPT_UNAVAILABLE') || result.replyText.includes('CASH')
      || result.replyText.includes('user-1') || result.replyText.includes('2026-08-15'), false, 'no raw ids, enums or ISO dates');
    assert.equal(h.saves.length, 0, 'nothing is persisted without a target');
    assert.equal(result.pendingQuestion, undefined, 'with no candidate the web link is the exit, so nothing stays pending');
    assert.match(result.replyText, /https:\/\/app\.example\.com\/companies\/company-1\/expenses\/substitute-receipts\/new/);
    assert.equal((result.replyText.match(/https?:\/\//gu) ?? []).length, 1, 'exactly one link');
    assert.equal((result.replyText.match(/\/companies\//gu) ?? []).length, 1, 'no bare relative tenant path remains');
    assert.equal((result.replyText.match(/ทำต่อ: /gu) ?? []).length, 1, 'exactly one next question');
  });

  it('answers out-of-scope targets with the formatter and the expense list, never hand-written copy', async () => {
    const h = harness();
    const unknown = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบทดแทนใบเสร็จ', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [{ id: 'expense-out-of-scope', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.equal(unknown.status, 'TARGET_REQUIRED');
    assert.match(unknown.replyText, /^📄 ใบรับรองแทนใบเสร็จรับเงิน/);
    assert.match(unknown.replyText, /สิทธิ์หรือสาขาปัจจุบัน/);
    assert.match(unknown.replyText, /เปิดในเว็บ: https:\/\/app\.example\.com\/companies\/company-1\/expenses$/mu);
    assert.equal((unknown.replyText.match(/\/companies\//gu) ?? []).length, 1, 'no bare relative tenant path remains');
    assert.equal(unknown.pendingQuestion, undefined, 'nothing here is answerable in chat');

    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    (h.useCase as any).repo.findByIdWithRelations = async () => null;
    const lostTarget = await h.useCase.execute(ctx(), {
      messageText: 'วัตถุประสงค์: ไปพบลูกค้า', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE, recentCandidates: [],
    });
    assert.equal(lostTarget.status, 'TARGET_REQUIRED');
    assert.match(lostTarget.replyText, /เปิดในเว็บ: https:\/\/app\.example\.com\/companies\/company-1\/expenses$/mu);
    assert.equal((lostTarget.replyText.match(/\/companies\//gu) ?? []).length, 1);
  });

  it('lists numbered candidates when the target is ambiguous and still resolves the chosen number', async () => {
    const h = harness(), read = h.repo.findByIdWithRelations;
    h.repo.findByIdWithRelations = async (companyId: string, id: string) => id === 'expense-9'
      ? expense({ id, expenseNumber: 'EXP-009', grandTotalAmount: '90' }) : read(companyId, id);
    const listed = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบทดแทนใบเสร็จ', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [
        { id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' },
        { id: 'expense-9', label: 'โน้ตค่าใช้จ่าย · 90.00' },
      ],
    });
    assert.equal(listed.status, 'TARGET_REQUIRED');
    assert.match(listed.replyText, /•.*200\.00[\s\S]*•.*90\.00/);
    assert.equal(listed.pendingQuestion, listed.replyText.split('ทำต่อ: ')[1],
      'the offered choice stays pending so the dispatcher routes the next “1” back here');

    const chosen = await h.useCase.execute(ctx(), {
      messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [
        { id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' },
        { id: 'expense-9', label: 'โน้ตค่าใช้จ่าย · 90.00' },
      ],
    });
    assert.equal(chosen.expenseId, 'expense-1');
    assert.equal(chosen.status, 'BLOCKED');
  });

  it('emits absolute links in the reply, resume capsule and webPath when a web base url is configured', async () => {
    const h = harness();
    const result = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.webPath?.startsWith(`${WEB_BASE}/companies/company-1/expenses/substitute-receipts/new?`));
    assert.match(result.replyText, /เปิดตรวจสอบในเว็บ: https:\/\/app\.example\.com\/companies\//);
    assert.match(result.resumeCapsule ?? '', /เปิดในเว็บ: https:\/\/app\.example\.com\/companies\//);
    assert.equal(result.replyText.replace(/https:\/\/app\.example\.com\S*/gu, '').includes('/companies/'), false,
      'no bare relative tenant path survives once the absolute links are stripped');

    const withoutBase = harness();
    const savedWebBase = process.env.WEB_BASE_URL;
    delete process.env.WEB_BASE_URL;
    const relative = await withoutBase.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    if (savedWebBase !== undefined) process.env.WEB_BASE_URL = savedWebBase;
    assert.ok(relative.webPath?.startsWith('/companies/company-1/'), 'an unset base degrades to the relative path');
    assert.equal(relative.replyText.includes('http'), false);
  });

  it('accepts several labeled fields in one message, preserves them across a later partial answer, and never creates PREPARED evidence', async () => {
    const h = harness();
    const first = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.ok(first.pendingQuestion);

    const second = await h.useCase.execute(ctx(), {
      messageText: [
        'ไม่มีใบเสร็จ ร้านไม่ออกให้',
        'เหตุผล: ร้านค้าไม่สามารถออกใบเสร็จได้',
        'วัตถุประสงค์: เดินทางไปพบลูกค้า',
        'ผู้รับเงิน: ร้านรถเช่า เอ',
        'ฉันเป็นผู้จ่าย บริษัทจ่ายเต็มจำนวน',
        'วันที่จ่าย: 15 สิงหาคม 2569',
        'ชำระด้วยเงินสด',
      ].join('\n'),
      chatKeyHash: 'chat-hash', recentCandidates: [],
    });
    assert.ok(second.acceptedFields.includes('businessPurpose'));
    assert.ok(second.acceptedFields.includes('payerUserId'));
    assert.ok(second.acceptedFields.includes('paymentDate'));
    assert.ok(second.acceptedFields.includes('paymentMethod'));
    const state = h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation;
    assert.equal(state.acceptedValues.businessPurpose, 'เดินทางไปพบลูกค้า');
    assert.equal(state.acceptedValues.payerUserId, 'user-1');
    assert.equal(state.status, 'OPEN');
    assert.equal(h.getExpense().substituteReceiptEvidence, null, 'LINE staging never creates PREPARED evidence');

    const third = await h.useCase.execute(ctx(), {
      messageText: 'เหตุผล: ผู้ขายรายย่อยไม่ออกเอกสาร', chatKeyHash: 'chat-hash', recentCandidates: [],
    });
    assert.ok(third.acceptedFields.includes('missingReceiptReason'));
    const after = h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues;
    assert.equal(after.businessPurpose, 'เดินทางไปพบลูกค้า', 'a partial answer does not erase earlier accepted fields');
    assert.equal(after.payeeName, 'ร้านรถเช่า เอ');
  });

  it('maps a short unlabeled answer only to the exact pending field', async () => {
    const h = harness();
    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    const result = await h.useCase.execute(ctx(), {
      messageText: 'ร้านทำใบเสร็จหาย', chatKeyHash: 'chat-hash', recentCandidates: [],
    });
    assert.equal(result.acceptedFields.includes('reasonCode'), true);
    assert.equal(result.acceptedFields.includes('missingReceiptReason'), false,
      'a phrase already parsed as reason type is not guessed into another slot');
  });

  it('never captures a taught control phrase as the pending certified field (F2)', async () => {
    // Drive to where missingReceiptReason is the pending field: open, then answer the reason CODE so
    // reason_code_required clears and missingReceiptReason becomes the first missing field.
    const openToMissingReason = async () => {
      const h = harness();
      await h.useCase.execute(ctx(), {
        messageText: 'ทำใบรับรองแทนใบเสร็จ บริษัทจ่ายเต็มจำนวน', chatKeyHash: 'chat-hash',
        recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
      });
      await h.useCase.execute(ctx(), { messageText: 'ใบเสร็จหาย', chatKeyHash: 'chat-hash', recentCandidates: [] });
      assert.equal(
        h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.missingFields[0],
        'missingReceiptReason', 'setup: missingReceiptReason should be the pending field',
      );
      return h;
    };

    for (const phrase of ['ทำต่อ', 'ทำใบรับรองต่อ', '1', 'ใช่']) {
      const h = await openToMissingReason();
      const result = await h.useCase.execute(ctx(), { messageText: phrase, chatKeyHash: 'chat-hash', recentCandidates: [] });
      assert.equal(result.acceptedFields.includes('missingReceiptReason'), false, `“${phrase}” must not become the reason`);
      assert.equal(
        h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.missingReceiptReason,
        undefined, `“${phrase}” must stay a blocker, not a saved legal value`,
      );
    }

    const genuine = await openToMissingReason();
    const saved = await genuine.useCase.execute(ctx(), { messageText: 'ลืมขอใบเสร็จจากร้าน', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(saved.acceptedFields.includes('missingReceiptReason'), true, 'a genuine short reason still saves');
    assert.equal(
      genuine.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.missingReceiptReason,
      'ลืมขอใบเสร็จจากร้าน',
    );
  });

  it('answers an intervening VAT question from current source state and resumes without consuming a field', async () => {
    const h = harness();
    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    const before = h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.missingFields;
    const result = await h.useCase.execute(ctx(), {
      messageText: 'ใบนี้เคลม VAT ได้ไหม', chatKeyHash: 'chat-hash', recentCandidates: [],
    });
    assert.deepEqual(result.acceptedFields, []);
    assert.match(result.replyText, /SUPPORTING_ONLY/);
    assert.match(result.replyText, /ไม่ใช่ใบกำกับภาษี/);
    assert.match(result.replyText, /งานเดิมยังอยู่/);
    assert.deepEqual(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.missingFields, before);
  });

  it('handles accepted fields and a grounded question as separate outcomes in one message', async () => {
    const h = harness();
    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    const result = await h.useCase.execute(ctx(), {
      messageText: 'วัตถุประสงค์: ไปส่งสินค้า\nใบนี้เคลม VAT ได้ไหม', chatKeyHash: 'chat-hash', recentCandidates: [],
    });
    assert.ok(result.acceptedFields.includes('businessPurpose'));
    assert.match(result.replyText, /รับข้อมูลเข้าร่างแล้ว.*วัตถุประสงค์ทางธุรกิจ/);
    assert.match(result.replyText, /คำถามแทรก — VAT/);
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.businessPurpose, 'ไปส่งสินค้า');
  });

  it('does not infer payment method or reason code from a hypothetical question', async () => {
    const h = harness();
    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    const result = await h.useCase.execute(ctx(), {
      messageText: 'วัตถุประสงค์ต้องกรอกอะไรบ้าง? ถ้าร้านไม่ออกใบเสร็จและจ่ายเงินสด เคลม VAT ได้ไหม?', chatKeyHash: 'chat-hash', recentCandidates: [],
    });
    assert.equal(result.acceptedFields.includes('reasonCode'), false);
    assert.equal(result.acceptedFields.includes('paymentMethod'), false);
    assert.equal(result.acceptedFields.includes('businessPurpose'), false);
  });

  it('requires target selection when several open workflows exist', async () => {
    const h = harness();
    const current = h.getExpense();
    const state = {
      workflowId: 'wf-1', kind: 'SUBSTITUTE_RECEIPT', companyId: 'company-1', userId: 'user-1',
      expenseId: 'expense-1', chatKeyHash: 'chat-hash', status: 'OPEN', acceptedValues: {}, provenance: {},
      resolvedFields: [], missingFields: [], attachmentRefs: [], pendingQuestion: null,
      targetRevision: current.updatedAt.toISOString(), lastActivityAt: current.updatedAt.toISOString(),
    };
    const repo = (h.useCase as any).repo;
    repo.listLineSubstituteContinuationRows = async () => [
      { id: 'expense-1', updatedAt: current.updatedAt, sourceChannelMetadataJson: { lineSubstituteReceiptContinuation: state } },
      { id: 'expense-2', updatedAt: current.updatedAt, sourceChannelMetadataJson: { lineSubstituteReceiptContinuation: { ...state, workflowId: 'wf-2', expenseId: 'expense-2' } } },
    ];
    const read = repo.findByIdWithRelations;
    repo.findByIdWithRelations = async (companyId: string, id: string) => id === 'expense-2'
      ? expense({ id, expenseNumber: 'EXP-002' }) : read(companyId, id);
    const result = await h.useCase.execute(ctx(), { messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(result.status, 'TARGET_REQUIRED');
    assert.match(result.replyText, /•.*EXP-001[\s\S]*•.*EXP-002/);
    assert.deepEqual(result.source?.records.map(item => item.id), ['expense-1', 'expense-2']);
    assert.equal(result.pendingQuestion, result.replyText.split('ทำต่อ: ')[1], 'the numbered choice stays pending');
    assert.equal(result.replyText.includes('/companies/'), false, 'an ambiguous target offers no link at all');
  });

  it('pauses and cancels only conversation state without deleting the expense or evidence', async () => {
    const h = harness();
    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    const paused = await h.useCase.execute(ctx(), { messageText: 'ไว้ทำทีหลัง', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(paused.status, 'PAUSED', 'the composed-ำ pause phrase matches');
    assert.equal(h.getExpense().id, 'expense-1');
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.status, 'PAUSED');
    assert.ok(paused.webPath?.startsWith(`${WEB_BASE}/companies/company-1/`));
    assert.equal(paused.replyText.includes('/companies/'), false);
    const cancelled = await h.useCase.execute(ctx(), { messageText: 'ไม่ทำแล้ว', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(cancelled.status, 'CANCELLED', 'the composed-ำ cancel phrase matches');
    assert.equal(h.getExpense().id, 'expense-1');
    assert.ok(cancelled.webPath?.startsWith(`${WEB_BASE}/companies/company-1/`));
    assert.equal(cancelled.replyText.includes('/companies/'), false);
    const afterCancel = await h.useCase.execute(ctx(), { messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(afterCancel.status, 'TARGET_REQUIRED', 'closed values are not resurrected as active conversation state');
  });

  it('clears the issue decision on pause so a resume re-derives it instead of preparing (F6)', async () => {
    const h = await readyHarness();
    assert.equal(
      h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.pendingDecision,
      'ISSUE_CONFIRM', 'setup: ready means the decision is pending',
    );
    const paused = await h.useCase.execute(ctx(), { messageText: 'พัก', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(paused.status, 'PAUSED');
    assert.equal(
      h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.pendingDecision,
      undefined, 'pause clears the pending decision',
    );

    const preparesBefore = h.prepares.length;
    // The taught resume phrase re-opens the workflow and re-offers the decision — it neither prepares
    // nor lands in the “ยังไม่แน่ใจว่าจะให้ทำอะไรต่อ” non-answer branch that left the workflow PAUSED.
    const resumed = await h.useCase.execute(ctx(), { messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.status, 'OPEN', 'resume writes status OPEN');
    assert.equal(resumed.replyText.includes('ยังไม่แน่ใจว่าจะให้ทำอะไรต่อ'), false);
    assert.match(resumed.replyText, /ให้ออกเอกสารเลยไหมคะ/);
    assert.equal(h.prepares.length, preparesBefore, 'resuming never prepares');
  });

  it('routes a valid receipt to normal review unless unavailability/incompleteness is proven', async () => {
    const h = harness({ expense: expense({ sourceDocumentType: 'RECEIPT', vendorNameSnapshot: 'Royal Pizza' }) });
    const result = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [{ id: 'expense-1', label: 'ใบเสร็จ · 2,890.00' }],
    });
    assert.equal(result.status, 'INELIGIBLE');
    assert.ok(result.blockers.some((item) => item.code === 'valid_receipt_normal_path'));
    assert.equal(result.webPath, `${WEB_BASE}/companies/company-1/expenses/expense-1`);
    assert.match(result.replyText, /เปิดตรวจสอบในเว็บ: https:\/\/app\.example\.com\/companies\//);
    assert.equal(result.replyText.replace(/https:\/\/app\.example\.com\S*/gu, '').includes('/companies/'), false);
  });

  it('reaches READY_FOR_WEB with absolute links once every blocker is answered', async () => {
    const h = harness({
      expense: expense({
        vendorNameSnapshot: 'ร้านน้ำแข็ง', paymentMethod: 'CASH', paidAt: new Date('2026-08-15T00:00:00.000Z'),
        missingReceiptReason: 'ร้านไม่ออกใบเสร็จ',
        attachments: [
          { id: 'att-1', status: 'ACTIVE', purpose: 'expense.source.document' },
          { id: 'att-2', status: 'ACTIVE', purpose: 'expense.payment.evidence', mimeType: 'image/jpeg' },
        ],
      }),
    });
    const result = await h.useCase.execute(ctx(), {
      messageText: 'ไม่มีใบเสร็จ\nวัตถุประสงค์: ไปพบลูกค้า\nฉันเป็นผู้จ่าย บริษัทจ่ายเต็มจำนวน',
      chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.equal(result.status, 'READY_FOR_WEB');
    assert.deepEqual(result.blockers, []);
    assert.ok(result.webPath?.startsWith(`${WEB_BASE}/companies/company-1/expenses/substitute-receipts/new?`));
    assert.match(result.replyText, /เปิดตรวจสอบในเว็บ: https:\/\/app\.example\.com\/companies\//);
    assert.match(result.resumeCapsule ?? '', /เปิดในเว็บ: https:\/\/app\.example\.com\/companies\//);
    assert.equal(result.replyText.replace(/https:\/\/app\.example\.com\S*/gu, '').includes('/companies/'), false);
  });

  it('reviews an explicitly accepted paid check-bill before preparing without an unresolved-type loop', async () => {
    const h = await readyHarness();
    // Reproduce the persisted paid-check-bill continuation at the final explicit decision.
    const current = h.getExpense();
    current.sourceDocumentType = 'NEEDS_REVIEW';
    current.taxEvidenceStatus = 'NEEDS_REVIEW';
    current.aiVerificationSummaryJson = { classification: { documentKind: 'ORDER_OR_CHECK_BILL' } };
    current.attachments.push({ id: 'paid-proof', status: 'ACTIVE', purpose: 'expense.payment.evidence', mimeType: 'image/png' });
    current.sourceChannelMetadataJson.lineSubstituteReceiptContinuation.routeCheckBill = true;
    const result = await h.useCase.execute(ctx(), { messageText: '2', confirmedDecision: 'FORM', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(result.status, 'READY_FOR_WEB');
    assert.equal(h.prepares.length, 1);
    assert.equal(h.getExpense().sourceDocumentType, 'OTHER_EXPENSE_DOCUMENT');
    assert.equal(h.getExpense().aiVerificationSummaryJson.documentReview.version, 2);
  });

  it('refuses to overwrite a newer web revision with a plain continuation answer', async () => {
    const h = harness();
    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    h.getExpense().updatedAt = new Date(h.getExpense().updatedAt.getTime() + 5000);
    const before = h.saves.length;
    const result = await h.useCase.execute(ctx(), { messageText: 'เป็นค่าเดินทาง', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(result.status, 'STALE');
    assert.match(result.replyText, /ตรวจสอบสถานะปัจจุบันในเว็บ: https:\/\/app\.example\.com\/companies\//);
    assert.equal(h.saves.length, before, 'stale text performs no write');
    const explicitResume = await h.useCase.execute(ctx(), { messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(explicitResume.status, 'STALE');
    assert.equal(h.saves.length, before, 'explicit resume also reloads/fails closed instead of rebasing staged values over a web edit');
  });

  it('reloads opaque prefill only for the same authenticated web user, scope, workflow, and revision', async () => {
    const h = harness();
    const opened = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ\nวัตถุประสงค์: ไปพบลูกค้า', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    const webCtx = { ...ctx(), authProvider: 'watchdog' as const };
    const prefill = await h.useCase.loadForWeb(webCtx, 'expense-1', opened.workflowId!);
    assert.equal(prefill.acceptedValues.businessPurpose, 'ไปพบลูกค้า');
    assert.equal(prefill.targetRevision, h.getExpense().updatedAt.toISOString());

    await assert.rejects(
      () => h.useCase.loadForWeb(ctx(), 'expense-1', opened.workflowId!),
      /authenticated web app/,
    );
    await assert.rejects(
      () => h.useCase.loadForWeb({ ...webCtx, userId: 'other-user' }, 'expense-1', opened.workflowId!),
      /not found/i,
    );
    h.getExpense().updatedAt = new Date(h.getExpense().updatedAt.getTime() + 1000);
    await assert.rejects(
      () => h.useCase.loadForWeb(webCtx, 'expense-1', opened.workflowId!),
      /Expense changed/,
    );
  });
});

describe('R13 — the assistant asks before producing the document', () => {
  it('asks one question with three numbered choices once the preflight is clean', async () => {
    const { asked, getExpense } = await readyHarness();

    assert.equal(asked.status, 'READY_FOR_WEB');
    assert.deepEqual(asked.blockers, []);
    assert.equal(asked.pendingQuestion, 'ให้ออกเอกสารเลยไหมคะ', 'pendingQuestion is what routes the answer back here');
    assert.match(asked.replyText, /ทำต่อ: ให้ออกเอกสารเลยไหมคะ/);
    // Choice 1 describes what taking it actually does. With no saved signature that is TWO steps, and
    // the old unconditional “ใช้ลายเซ็นที่บันทึกไว้” promised one — an option offered as ready when it
    // was not.
    assert.match(asked.replyText, /• ออกเอกสาร \(ยังไม่มีลายเซ็นที่บันทึกไว้ ระบบจะขอรูปลายเซ็นก่อน 1 ครั้ง/);
    assert.match(asked.replyText, /• ขอฟอร์มไปเซ็นเอง/);
    assert.match(asked.replyText, /• แก้ข้อมูลก่อน/);
    assert.match(asked.replyText, /ลงนามและอนุมัติทำในเว็บค่ะ เตรียมใบรับรองเสร็จแล้วน้องจะส่งลิงก์ให้/, 'nothing is produced unasked');
    assert.equal(
      getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.pendingDecision,
      'ISSUE_CONFIRM',
    );
  });

  it('promises the one-step route only when a saved signature really exists', async () => {
    const { asked } = await readyHarness({ signature: { id: 'signature-1' } });

    assert.match(asked.replyText, /• ออกเอกสาร \(ใช้ลายเซ็นที่บันทึกไว้\)/);
    assert.equal(/ระบบจะขอรูปลายเซ็น/u.test(asked.replyText), false);
  });

  // The whole table, both directions, in the words a Thai shop owner actually types. Reserving a
  // document number is irreversible, so every row here has to be unambiguous — and everything that is
  // NOT on the table has to land on the friendly re-ask below, never on a document.
  const ACCEPTED: Array<[string, 'ISSUE' | 'FORM' | 'EDIT']> = [
    ['1', 'ISSUE'], ['1.', 'ISSUE'], ['1)', 'ISSUE'],
    ['ออกเอกสาร', 'ISSUE'], ['ออกเอกสารเลย', 'ISSUE'], ['ออกเอกสารเลยค่ะ', 'ISSUE'],
    ['ออกเอกสาร (ใช้ลายเซ็นที่บันทึกไว้)', 'ISSUE'], ['ใช้ลายเซ็นที่บันทึกไว้', 'ISSUE'],
    ['ออกใบให้เลย', 'ISSUE'], ['ออกให้เลยครับ', 'ISSUE'], ['ออกได้เลย', 'ISSUE'],
    ['ทำเลย', 'ISSUE'], ['ทำเลยค่ะ', 'ISSUE'], ['จัดไป', 'ISSUE'], ['จัดการเลยนะ', 'ISSUE'],
    ['สร้างเอกสารเลย', 'ISSUE'], ['พิมพ์เอกสารเลยค่ะ', 'ISSUE'], ['ดำเนินการต่อ', 'ISSUE'],
    // The plain yes/no answers to “ให้ออกเอกสารเลยไหมคะ”, which name no action at all.
    ['ใช่', 'ISSUE'], ['ใช่ค่ะ', 'ISSUE'], ['ตกลง', 'ISSUE'], ['ตกลงครับ', 'ISSUE'],
    ['เอาเลย', 'ISSUE'], ['เอาสิ', 'ISSUE'], ['โอเคเลยค่ะ', 'ISSUE'], ['ได้เลย', 'ISSUE'], ['ยืนยัน', 'ISSUE'],
    ['เอาสิ ออกเลย', 'ISSUE'],
    ['2', 'FORM'], ['ขอฟอร์มไปเซ็นเอง', 'FORM'], ['ขอฟอร์ม', 'FORM'], ['ขอฟอร์มไปเซ็นเองค่ะ', 'FORM'],
    ['เอาฟอร์ม', 'FORM'], ['ขอแบบฟอร์มค่ะ', 'FORM'], ['พิมพ์ฟอร์มมาให้หน่อย', 'FORM'],
    ['เซ็นเอง', 'FORM'], ['จะเซ็นเองครับ', 'FORM'], ['ขอกระดาษไปเซ็น', 'FORM'], ['ลงนามเองนะคะ', 'FORM'],
    ['3', 'EDIT'], ['แก้ข้อมูลก่อน', 'EDIT'], ['ขอแก้ข้อมูล', 'EDIT'],
    ['แก้ไขก่อน', 'EDIT'], ['ขอแก้ก่อนค่ะ', 'EDIT'], ['แก้หน่อย', 'EDIT'],
    ['ขอเปลี่ยนหน่อย', 'EDIT'], ['เปลี่ยนข้อมูลก่อน', 'EDIT'], ['ข้อมูลผิด', 'EDIT'],
  ];
  const DECLINED = [
    'ขอบคุณค่ะ ไม่ต้องออกเอกสาร',
    'ตอนนี้ยังไม่ต้องออกเอกสารนะคะ',
    'ห้ามออกเอกสาร',
    'ไว้ค่อยออกเอกสารทีหลัง',
    'ขอฟอร์มไปเซ็นเอง ไม่ต้องออกเอกสาร',
    'เดี๋ยวก่อน อย่าเพิ่งออกเอกสาร',
    // A refusal that names no action at all still has to land on DECLINE, not on the re-ask.
    'ยังไม่ต้องออก',
    'ยังไม่เอา',
    'ไว้ทีหลังนะคะ',
    'ภายหลังค่อยว่ากัน',
    // normalizeLineText collapses newlines before this use case ever sees them, so the refusal on
    // line 2 arrives mid-line and must still be read.
    'ออกเอกสารเลย\nไม่ ๆ เดี๋ยวก่อน',
  ];
  // Everything the deterministic table cannot claim. No word list is ever complete, so the contract
  // for this column is not "reject" — it is "re-ask with the three choices in view".
  const NOT_A_CHOICE = [
    'ออกเอกสารได้ไหม', 'ออกเอกสารยังไง', 'ขอฟอร์มยังไงคะ', 'ต่างกันยังไง',
    'ทำต่อ', 'ครับ', 'ค่ะ', 'อืม', 'ส่งไปทางไลน์ได้ป่ะ', 'เอกสารนี้เก็บไว้กี่ปี',
  ];

  for (const [messageText, expected] of ACCEPTED) {
    it(`accepts “${messageText}” as ${expected}`, async () => {
      const h = await readyHarness({ signature: { id: 'signature-1' } });
      const result = await h.useCase.execute(ctx(), { messageText, chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
      if (expected === 'EDIT') {
        assert.equal(h.prepares.length, 0);
        assert.match(result.replyText, /แก้ได้เลยค่ะ/);
        return;
      }
      assert.equal(h.prepares.length, 0);
      assert.equal(result.decisionOffered, expected);
      const applied = await h.useCase.execute(ctx(), { messageText, confirmedDecision: expected,
        chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
      assert.equal(h.prepares.length, 1);
      assert.match(applied.replyText, expected === 'ISSUE' ? /เตรียมใบรับรองแล้วค่ะ เปิดเว็บเพื่อเซ็น/ : /เตรียมแบบแล้วค่ะ เปิดเว็บเพื่อดาวน์โหลดไปเซ็น/);
    });
  }

  for (const messageText of DECLINED) {
    it(`declines “${messageText.replace('\n', ' ⏎ ')}” without reserving anything`, async () => {
      const h = await readyHarness({ signature: { id: 'signature-1' } });
      const result = await h.useCase.execute(ctx(), { messageText, chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });

      assert.equal(h.prepares.length, 0, 'no document number is reserved');
      assert.match(result.replyText, /ยังไม่ออกเอกสารและยังไม่ได้จองเลขที่ งานนี้ยังเปิดอยู่/);
      assert.equal(
        h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.pendingDecision,
        'ISSUE_CONFIRM',
        'M5: “บอกได้ตลอดเมื่อพร้อม” only holds while the decision is still listening',
      );
      assert.equal(
        h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.businessPurpose,
        'ไปพบลูกค้า',
        'declining loses nothing',
      );
    });
  }

  // S2: Thai is unspaced, so a refusal cannot be recognised from a bare particle. Every phrase below
  // carries ไม่ / ยัง / อย่า / ค่อย somewhere and refuses NOTHING — “อย่า” sits inside “อย่างอื่น”,
  // “ค่อย” inside “ค่อยๆ”, and the rest are ordinary status reports. Read as refusals, each one told
  // the sender their document had been declined and re-opened the decision they never touched.
  const MUST_NOT_DECLINE = [
    'ยังไม่ได้ถ่ายรูปเลย',
    'อย่างอื่นไม่มีแล้ว',
    'ค่อยๆ ทำนะ',
    'ร้านยังไม่เปิด',
    'ผมยังอยู่ที่ออฟฟิศ',
    'อย่าลืมนะครับ',
    'วันนี้ไม่ว่างเลย',
    'ยอดนี้ยังไม่รวม vat',
    'ยังไม่ได้จ่ายเลย',
    'ไม่เป็นไรค่ะ',
  ];
  for (const messageText of MUST_NOT_DECLINE) {
    it(`does not read “${messageText}” as a refusal of the document`, async () => {
      const h = await readyHarness({ signature: { id: 'signature-1' } });
      const result = await h.useCase.execute(ctx(), { messageText, chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });

      assert.equal(h.prepares.length, 0, 'a non-answer still reserves nothing');
      assert.equal(
        /ยังไม่ออกเอกสารและยังไม่ได้จองเลขที่/.test(result.replyText),
        false,
        'the sender refused nothing, so the assistant must not report a refusal back to them',
      );
    });
  }

  // S1: the decline deliberately leaves the decision listening, which also leaves this chat's
  // clarification open — and that clarification re-enters the continuation on EVERY later message.
  // A question was already handed back to the router; a declarative sentence was not, so the sender
  // could not record another expense until they finished this document.
  it('S1: hands back a declarative message the open decision cannot read, so the chat is not captured', async () => {
    const h = await readyHarness({ signature: { id: 'signature-1' } });

    const declined = await h.useCase.execute(ctx(), { messageText: 'ยังไม่ต้องออก', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(declined.decisionUnread, undefined, 'a decline IS an answer to the decision');

    const capture = await h.useCase.execute(ctx(), { messageText: 'ค่าแท็กซี่ 200 บาท', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(h.prepares.length, 0);
    assert.equal(capture.decisionUnread, true, 'the dispatcher must be free to route this to the intake router');
    assert.match(capture.resumeCapsule ?? '', /ยังอยู่/, 'and the waiting decision still travels with that turn');

    const later = await h.useCase.execute(ctx(), { messageText: 'ออกเอกสารเลย', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(h.prepares.length, 1, 'the invitation is still true after an unrelated message');
    assert.match(later.replyText, /เตรียมใบรับรองแล้วค่ะ เปิดเว็บเพื่อเซ็น/);
  });

  it('S1: the “พัก” escape stays visible in the re-ask, not only in the first decline reply', async () => {
    const h = await readyHarness({ signature: { id: 'signature-1' } });

    await h.useCase.execute(ctx(), { messageText: 'ยังไม่ต้องออก', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    const reAsked = await h.useCase.execute(ctx(), { messageText: 'อ่ะ', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });

    assert.match(reAsked.replyText, /พิมพ์ “พัก” เพื่อพักงานนี้ไว้/);
  });

  it('M5: the invitation after a decline is true — a later “ออกเอกสารเลย” still issues', async () => {
    const h = await readyHarness({ signature: { id: 'signature-1' } });

    const declined = await h.useCase.execute(ctx(), { messageText: 'ยังไม่ต้องออก', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(h.prepares.length, 0);
    assert.ok(declined.pendingQuestion, 'the pending question is what keeps this chat listening');

    const later = await h.useCase.execute(ctx(), { messageText: 'ออกเอกสารเลย', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(h.prepares.length, 1, 'the answer the invitation asked for is received');
    assert.match(later.replyText, /เตรียมใบรับรองแล้วค่ะ เปิดเว็บเพื่อเซ็น/);
  });

  for (const messageText of NOT_A_CHOICE) {
    it(`re-asks with the three choices for “${messageText}”`, async () => {
      const h = await readyHarness({ signature: { id: 'signature-1' } });
      const result = await h.useCase.execute(ctx(), { messageText, chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });

      assert.equal(h.prepares.length, 0, 'an unrecognised answer never produces a document');
      assert.equal(result.pendingQuestion, 'ให้ออกเอกสารเลยไหมคะ');
      // The point of the unmatched path: the options are visible again, so the next turn works.
      assert.match(result.replyText, /• ออกเอกสาร/);
      assert.match(result.replyText, /• ขอฟอร์มไปเซ็นเอง/);
      assert.match(result.replyText, /• แก้ข้อมูลก่อน/);
    });
  }

  // Two states, not four (owner decision 2026-08-20): you have a signature, or you send one. The
  // photo becomes usable on arrival, so nothing here may promise a wait.
  it('choice 1 without any signature asks for the photo and keeps the decision pending', async () => {
    for (const permissions of [SIGNER, undefined]) {
      const h = await readyHarness();

      const answered = await h.useCase.execute(ctx(permissions), { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });

      assert.equal(h.prepares.length, 0, 'no signature means nothing is prepared');
      assert.match(answered.replyText, /เซ็นบนกระดาษขาว ถ่ายให้เห็นเต็มลายเซ็น/);
      assert.match(answered.replyText, /ส่งรูปเข้ามาในแชทนี้/);
      assert.match(answered.replyText, /ใช้ได้ทันที/);
      // The standing “LINE ยังไม่ได้ลงนาม อนุมัติ หรือออกเอกสาร” footer stays; what must never come
      // back is a signature that waits on somebody.
      assert.equal(/อนุมัติ(ลายเซ็น|ก่อนใช้)|รอเจ้าของ|ไม่ผ่านการอนุมัติ/u.test(answered.replyText), false);
      assert.equal(answered.pendingQuestion, 'ส่งรูปลายเซ็นเข้ามาในแชทนี้ได้เลยค่ะ');
      assert.equal(answered.blockers[0]?.code, 'reusable_signature_required');
      assert.equal(
        h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.pendingDecision,
        'ISSUE_CONFIRM',
        'the workflow stays open with the decision still pending, so “1” after the photo lands here again',
      );
    }
  });

  // F8 is gone at its root: the permission that used to strand a payer here is no longer the one
  // this action needs. Both personas get the same script, and the paper escape still works.
  it('keeps the paper escape open from the ask, for a payer with or without the legacy signature key', async () => {
    for (const permissions of [SIGNER, undefined]) {
      const h = await readyHarness();
      await h.useCase.execute(ctx(permissions), { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });

      const form = await h.useCase.execute(ctx(permissions), { messageText: '2', confirmedDecision: 'FORM', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
      assert.equal(h.prepares.length, 1);
      assert.match(form.replyText, /เตรียมแบบแล้วค่ะ เปิดเว็บเพื่อดาวน์โหลดไปเซ็น/);
    }
  });

  /**
   * Journey A with the approval step removed (owner decision 2026-08-20, superseding D10/D11).
   * Both sides of the photo are the real use cases: the continuation asks, the real
   * CreateSignatureAssetUseCase saves, and the SAME sender's next “1” prepares. Nobody opens the web
   * in between, and no approval is ever recorded — which is the whole claim of the decision.
   */
  it('completes Journey A with no approval wait: ask → photo → 1 → prepared', async () => {
    const h = await readyHarness();

    const asked = await h.useCase.execute(ctx(SIGNER), { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(h.prepares.length, 0, 'nothing is prepared without a signature');
    assert.equal(asked.pendingQuestion, 'ส่งรูปลายเซ็นเข้ามาในแชทนี้ได้เลยค่ะ');

    // The photo arrives with a numbered choice that can become a signature…
    const media = await h.useCase.loadOpenMediaContext(ctx(SIGNER), 'chat-hash');
    assert.ok(substituteMediaChoices(media!).includes('SIGNATURE'));
    // …because the chat was JUST asked for it: the ask time rides along, and only a recent ask claims a bare photo.
    assert.ok(media!.signatureRequestedAt);
    assert.equal(substituteAwaitsCaptionlessPhoto(media!, new Date(Date.parse(media!.signatureRequestedAt!) + 60_000)), true);
    assert.equal(substituteAwaitsCaptionlessPhoto(media!, new Date(Date.parse(media!.signatureRequestedAt!) + SUBSTITUTE_PHOTO_ASK_WINDOW_MS + 1)), false);

    // …and answering it stores an asset that is usable immediately.
    const asset = await new CreateSignatureAssetUseCase(
      h.repo,
      { execute: async () => undefined } as any,
      { log: async (entry: any) => { h.audits.push(entry); } } as any,
      { getObject: async () => ({ bytes: Buffer.alloc(0) }) } as any,
      {resolveAccess: async () => ctx(SIGNER)} as any,
    ).execute(ctx(SIGNER), {
      attachmentId: 'att-signature', submittedFromChannel: 'LINE', lineMessageId: 'line-msg-signature',
    });
    assert.equal(asset.status, 'ACTIVE', 'saved and signable, with nothing in between');

    const issued = await h.useCase.execute(ctx(SIGNER), { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(h.prepares.length, 1, 'the very next turn prepares');
    assert.equal(issued.status, 'READY_FOR_WEB');
    assert.match(issued.replyText, /SUB-202608-00007/);
    assert.deepEqual(
      h.audits.filter((entry) => /signature\.(approve|reject)/u.test(entry.action ?? '')),
      [],
      'no approval or rejection is recorded anywhere in the journey',
    );
  });

  // …and the numbered media question offers the choice to whoever the ask was written for.
  it('offers the signature choice to a payer on either signing act', async () => {
    const h = await readyHarness();
    await h.useCase.execute(ctx(SIGNER), { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });

    for (const permissions of [SIGNER, undefined, ['expense.review']]) {
      const context = await h.useCase.loadOpenMediaContext(ctx(permissions), 'chat-hash');
      assert.equal(context?.signatureRequested, true, String(permissions));
      assert.ok(substituteMediaChoices(context!).includes('SIGNATURE'));
    }
  });

  it('choice 1 with a saved signature prepares from LINE and points at the signing page', async () => {
    const h = await readyHarness({ signature: { id: 'signature-1' } });
    const before = h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation;

    const issued = await h.useCase.execute(ctx(), { messageText: 'ออกเอกสาร', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });

    assert.equal(h.prepares.length, 1);
    const prepared = h.prepares[0];
    assert.equal(prepared.preparedFromChannel, 'LINE');
    assert.equal(prepared.businessPurpose, 'ไปพบลูกค้า');
    assert.equal(prepared.payerUserId, 'user-1');
    assert.equal(prepared.paymentMethod, 'CASH', 'unstated values fall back to the expense');
    assert.deepEqual(prepared.supportingAttachmentIds, ['att-1']);
    assert.equal(prepared.idempotencyKey, before.workflowId, 'one prepare per continuation');
    assert.deepEqual(prepared.lineContinuation, { workflowId: before.workflowId, userId: 'user-1', formRequested: false });
    assert.equal(prepared.expectedExpenseUpdatedAt.toISOString(), h.saves.at(-1).continuation.targetRevision);
    assert(h.audits.some(entry => entry.action === 'expense.evidence.review'), 'explicit LINE decision records the same human review');

    assert.equal(issued.status, 'READY_FOR_WEB');
    assert.equal(issued.webPath, `${WEB_BASE}/companies/company-1/expenses/substitute-receipts/evidence-1`);
    assert.match(issued.replyText, /เตรียมใบรับรองแล้วค่ะ เปิดเว็บเพื่อเซ็น/);
    assert.match(issued.replyText, /SUB-202608-00007/);
    assert.equal(h.getExpense().substituteReceiptEvidence.status, 'PREPARED');
    assert.equal(h.getExpense().substituteReceiptEvidence.certifiedAt, null);
    assert.equal(h.getExpense().substituteReceiptEvidence.approvedAt, null);
    assert.equal(h.getExpense().substituteReceiptEvidence.issuedAt, null);
    assert.equal(issued.replyText.includes('ออกเอกสารแล้ว'), false, 'a prepared document is never described as issued');
    assert.equal(issued.replyText.replace(/https:\/\/app\.example\.com\S*/gu, '').includes('/companies/'), false);

    const audit = h.audits.find((entry) => entry.action === 'expense.substitute_receipt.prepare');
    assert.equal(audit.metadataJson.preparedFromChannel, 'LINE');
    assert.equal(audit.metadataJson.source, 'LINE');
  });

  it('never links the system’s own review artifacts back in as supporting evidence', async () => {
    const h = await readyHarness({
      signature: { id: 'signature-1' },
      expense: expense({
        vendorNameSnapshot: 'วินมอเตอร์ไซค์', paymentMethod: 'CASH', paidAt: new Date('2026-08-15T00:00:00.000Z'),
        missingReceiptReason: 'วินไม่ออกใบเสร็จ',
        attachments: [
          { id: 'att-photo', status: 'ACTIVE', purpose: 'expense.receipt.supporting' },
          { id: 'att-slip', status: 'ACTIVE', purpose: 'expense.payment.evidence', mimeType: 'image/jpeg' },
          // A superseded version left these behind: its certified SVG and its signature render.
          { id: 'att-old-certificate', status: 'ACTIVE', purpose: 'expense.review.evidence' },
          { id: 'att-old-signature', status: 'ACTIVE', purpose: 'expense.review.evidence' },
        ],
      }),
    });

    await h.useCase.execute(ctx(), { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });

    assert.deepEqual(h.prepares[0].supportingAttachmentIds, ['att-photo'], 'same split the web wizard uses');
    assert.deepEqual(h.prepares[0].paymentEvidenceAttachmentIds, ['att-slip']);
  });

  it('choice 2 prepares the same way and points at the unsigned form instead', async () => {
    const h = await readyHarness({ signature: null });

    const form = await h.useCase.execute(ctx(), { messageText: '2', confirmedDecision: 'FORM', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });

    assert.equal(h.prepares.length, 1, 'the paper route needs no stored signature');
    assert.equal(h.prepares[0].preparedFromChannel, 'LINE');
    assert.equal(form.webPath, `${WEB_BASE}/companies/company-1/expenses/substitute-receipts/evidence-1`);
    assert.match(form.replyText, /เตรียมแบบแล้วค่ะ เปิดเว็บเพื่อดาวน์โหลดไปเซ็น/);
    assert.equal(h.prepares[0].lineContinuation.formRequested, true, 'paper preparation stays unsigned');
    assert.equal(h.getExpense().substituteReceiptEvidence.status, 'PREPARED');
    assert.equal(h.getExpense().substituteReceiptEvidence.certifiedAt, null);
    assert.equal(h.getExpense().substituteReceiptEvidence.approvedAt, null);
    assert.equal(h.getExpense().substituteReceiptEvidence.issuedAt, null);
  });

  it('M3: choice 3 lists the editable fields UNNUMBERED, with an example, and never numbers a dead option', async () => {
    const h = await readyHarness();

    const editing = await h.useCase.execute(ctx(), { messageText: '3', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });

    assert.equal(h.prepares.length, 0);
    assert.match(editing.replyText, /• วัตถุประสงค์ทางธุรกิจ — เช่น “วัตถุประสงค์: ไปพบลูกค้า”/);
    assert.match(editing.replyText, /• วิธีชำระเงิน/);
    assert.match(editing.replyText, /• หมวดค่าใช้จ่าย/);
    // The numbers used to be printed and did nothing: “3” bounced straight back to the issue ask.
    assert.equal(/^1\) วัตถุประสงค์/mu.test(editing.replyText), false, 'the field list is not numbered');
    // “ไม่มีหลักฐาน” is only read while the evidence question is pending, so listing it as editable
    // here would offer an edit that silently does nothing.
    assert.equal(editing.replyText.includes('• หลักฐานประกอบ'), false, 'no option that cannot be taken now');
    assert.equal(
      h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.pendingDecision,
      'ISSUE_CONFIRM',
      'the numbered escape stays open while the sender edits',
    );

    const edited = await h.useCase.execute(ctx(), {
      messageText: 'วัตถุประสงค์: ไปส่งของให้ลูกค้า', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });
    assert.ok(edited.acceptedFields.includes('businessPurpose'), 'a labelled answer merges exactly as before');
    assert.equal(edited.pendingQuestion, 'ให้ออกเอกสารเลยไหมคะ', 'and the question comes back because nothing is missing');
  });

  it('re-asks the one question when the answer is neither a choice nor a value, and still reminds', async () => {
    const h = await readyHarness();

    const confused = await h.useCase.execute(ctx(), { messageText: 'อ่ะ', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });

    assert.equal(h.prepares.length, 0);
    assert.match(confused.replyText, /เลือกจาก 3 ข้อนี้ ตอบเลขข้อได้เลย/);
    assert.equal(confused.pendingQuestion, 'ให้ออกเอกสารเลยไหมคะ');
    assert.equal(confused.replyText.includes('สิ่งที่ยังต้องทำทั้งหมด'), false, 'the full status card is not replayed');
    assert.match(confused.resumeCapsule ?? '', /งานใบรับรองแทนใบเสร็จรับเงินของรายการ EXP-001 ยังอยู่/);
  });

  it('answers a side question asked while the decision is open, from source state, and keeps the capsule', async () => {
    const h = await readyHarness();

    const asked = await h.useCase.execute(ctx(), {
      messageText: 'ใบนี้เคลมภาษีซื้อได้ไหมคะ', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });

    assert.equal(h.prepares.length, 0);
    assert.match(asked.replyText, /คำถามแทรก — VAT/);
    assert.match(asked.replyText, /ไม่ใช่ใบกำกับภาษีจากผู้ขาย/);
    assert.equal(asked.sideQuestionAnswered, true, 'answered here, so the dispatcher must not deflect it');
    assert.match(asked.resumeCapsule ?? '', /ทำต่อ: ให้ออกเอกสารเลยไหมคะ/);
    assert.equal(asked.pendingQuestion, 'ให้ออกเอกสารเลยไหมคะ');
  });

  it('reports the existing document instead of restarting the conversation over it', async () => {
    const h = await readyHarness({ signature: { id: 'signature-1' } });
    await h.useCase.execute(ctx(), { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    const consumed = h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation;
    assert.equal(consumed.status, 'CONSUMED');
    const provenanceBefore = JSON.stringify(consumed.provenance);
    const savesBefore = h.saves.length;

    const followUp = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }], webBaseUrl: WEB_BASE,
    });

    assert.match(followUp.replyText, /SUB-202608-00007/);
    assert.match(followUp.replyText, /รอยืนยัน/);
    assert.equal(followUp.webPath, `${WEB_BASE}/companies/company-1/expenses/substitute-receipts/evidence-1`);
    assert.equal(followUp.replyText.includes('สิ่งที่ยังต้องทำทั้งหมด'), false, 'no already-answered blockers');
    assert.equal(h.saves.length, savesBefore, 'the consumed continuation is not overwritten');
    assert.equal(
      JSON.stringify(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.provenance),
      provenanceBefore,
      'provenance survives byte-identical',
    );
  });

  it('degrades a stale expense between the ask and the answer into the STALE reply, never a raw error', async () => {
    const h = await readyHarness({
      signature: { id: 'signature-1' },
      prepareError: new ConflictException({ code: 'expense_stale_reload', message: 'Expense changed after review.' }),
    });

    const stale = await h.useCase.execute(ctx(), { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });

    assert.equal(stale.status, 'STALE');
    assert.match(stale.replyText, /รายการถูกแก้ไขจากเว็บหรือผู้ใช้อื่น/);
    assert.match(stale.replyText, /ตรวจสอบสถานะปัจจุบันในเว็บ: https:\/\/app\.example\.com\/companies\//);
  });

  it('degrades a prepare that the preflight cannot see coming into the blocked card, not an exception', async () => {
    // The LINE preflight counts attachments but does not apply the renderability cap, so more
    // linked files than a certificate can print is the one refusal a clean preflight still hits.
    const h = await readyHarness({
      signature: { id: 'signature-1' },
      expense: expense({
        vendorNameSnapshot: 'วินมอเตอร์ไซค์', paymentMethod: 'CASH', paidAt: new Date('2026-08-15T00:00:00.000Z'),
        missingReceiptReason: 'วินไม่ออกใบเสร็จ',
        attachments: Array.from({ length: 9 }, (_item, index) => ({
          id: `att-${index}`, status: 'ACTIVE', purpose: 'expense.receipt.supporting',
        })),
      }),
    });
    assert.equal(h.asked.status, 'READY_FOR_WEB');

    const refused = await h.useCase.execute(ctx(), { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });

    assert.equal(h.prepares.length, 0, 'prepare refused before it reached the repository');
    assert.equal(refused.status, 'BLOCKED');
    assert.deepEqual(refused.blockers.map((item) => item.code), ['substitute_prepare_failed']);
    assert.match(refused.replyText, /ยังเตรียมเอกสารไม่ได้ในตอนนี้/u);
    // F12: no raw English exception, and a structural failure is not re-offered as a one-tap “1” retry.
    assert.equal(/at most|Error|Exception/i.test(refused.replyText), false, 'no raw exception reaches the chat');
    assert.equal(refused.replyText.includes('1) ออกเอกสาร'), false, 'a failed prepare is not re-offered as “1) ออกเอกสาร”');
  });
});

describe('R15 — wrong-document detection', () => {
  const TRIGGERS = [
    'ผู้รับเงินเซ็นให้ได้',
    'ให้ร้านเซ็นแล้ว',
    'เขายอมเซ็นให้',
    'มีสำเนาบัตรประชาชนของผู้รับเงินด้วย',
  ];
  // The refusal is the case ใบรับรองแทนใบเสร็จรับเงิน exists FOR. Explaining a different document
  // here would be exactly backwards.
  const NOT_TRIGGERS = [
    'ผู้ขายไม่ยอมเซ็น',
    'ร้านไม่ยอมเซ็นให้',
    'เขาไม่เซ็นให้ได้',
    'ผู้รับเงินปฏิเสธไม่ยอมเซ็น',
    'ไม่มีสำเนาบัตรประชาชนของผู้รับเงิน',
    'ทำใบทดแทนใบเสร็จ ค่าวินมอไซต์ไปพบลูกค้า 50 บาท',
  ];

  for (const phrase of TRIGGERS) {
    it(`explains ใบสำคัญรับเงิน and asks exactly one question: “${phrase}”`, async () => {
      const h = harness();
      const result = await h.useCase.execute(ctx(), {
        messageText: `ทำใบทดแทนใบเสร็จ ${phrase}`, chatKeyHash: 'chat-hash',
        recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }], webBaseUrl: WEB_BASE,
      });
      assert.match(result.replyText, /ใบสำคัญรับเงิน/);
      assert.match(result.replyText, /สำเนาบัตรประชาชน/);
      assert.match(result.replyText, /ระบบยังไม่รองรับการออกใบสำคัญรับเงิน/);
      assert.equal(result.pendingQuestion, 'จะทำใบรับรองแทนใบเสร็จรับเงินต่อไหมคะ');
      assert.equal((result.replyText.match(/ไหมคะ/gu) ?? []).length, 1, 'exactly one question in the reply');
      assert.equal(result.replyText.replace(/https:\/\/app\.example\.com\S*/gu, '').includes('?'), false,
        'the only “?” in the reply belongs to the link query string');
      assert.equal(h.saves.length, 0, 'state is completely untouched');
    });
  }

  for (const messageText of NOT_TRIGGERS) {
    it(`stays silent on “${messageText}”`, async () => {
      const h = harness();
      const result = await h.useCase.execute(ctx(), {
        messageText, chatKeyHash: 'chat-hash',
        recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }], webBaseUrl: WEB_BASE,
      });
      assert.equal(result.replyText.includes('ใบสำคัญรับเงิน'), false);
    });
  }

  it('short-circuits the turn: it never prepares, never merges, and never stacks a second question', async () => {
    const h = await readyHarness({ signature: { id: 'signature-1' } });
    const before = JSON.stringify(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation);
    const savesBefore = h.saves.length;

    const notice = await h.useCase.execute(ctx(), {
      messageText: 'ออกเอกสารเลย เขาเซ็นแล้ว', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });

    assert.equal(h.prepares.length, 0, 'the wrong-document question comes before any document number');
    assert.equal(h.saves.length, savesBefore);
    assert.equal(JSON.stringify(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation), before);
    assert.equal((notice.replyText.match(/ไหมคะ/gu) ?? []).length, 1);
    assert.equal(notice.replyText.includes('ให้ออกเอกสารเลยไหมคะ'), false, 'the decision question does not stack on top');

    // “ทำต่อ” resumes: the decision was never cleared, so it re-fires on its own.
    const resumed = await h.useCase.execute(ctx(), { messageText: 'ทำต่อ', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(resumed.pendingQuestion, 'ให้ออกเอกสารเลยไหมคะ');
    assert.equal(h.prepares.length, 0, 'resuming is not consenting');
  });

  it('pauses the workflow when the sender declines to continue with this document', async () => {
    const h = await readyHarness();
    await h.useCase.execute(ctx(), {
      messageText: 'ผู้รับเงินเซ็นให้ได้', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });

    const declined = await h.useCase.execute(ctx(), { messageText: 'ไม่ทำต่อ', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });

    assert.equal(declined.status, 'PAUSED');
    assert.match(declined.replyText, /พักงานนี้ไว้แล้ว ข้อมูลที่รับไว้ยังอยู่/);
  });

  it('never rides on a reply that already reports a decision the system made', async () => {
    // FORBIDDEN returns before any of this, and a prepared expense answers with its document card.
    const forbidden = await harness().useCase.execute({ ...ctx(), permissions: ['expense.receipt.line_upload'] }, {
      messageText: 'ทำใบทดแทนใบเสร็จ ผู้รับเงินเซ็นให้ได้', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }], webBaseUrl: WEB_BASE,
    });
    assert.equal(forbidden.status, 'FORBIDDEN');
    assert.equal(forbidden.replyText.includes('ใบสำคัญรับเงิน'), false);

    const h = await readyHarness({ signature: { id: 'signature-1' } });
    await h.useCase.execute(ctx(), { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    const afterPrepare = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองต่อ เขาเซ็นแล้ว', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }], webBaseUrl: WEB_BASE,
    });
    assert.match(afterPrepare.replyText, /SUB-202608-00007/);
    assert.equal(afterPrepare.replyText.includes('ใบสำคัญรับเงิน'), false, 'never above a reserved document number');
  });
});

/** A chat whose form was already prepared: the continuation is CONSUMED and the evidence row is
 *  what still decides whether a photo could be the signed sheet. */
function scanHarness(
  state: Record<string, unknown> = {},
  evidence: Record<string, unknown> | null = {},
  extra: Parameters<typeof harness>[0] = {},
) {
  return harness({
    expense: expense({
      sourceChannelMetadataJson: {
        channel: 'LINE', kind: 'text_note', chatKeyHash: 'chat-hash',
        lineSubstituteReceiptContinuation: {
          workflowId: 'wf-1', kind: 'SUBSTITUTE_RECEIPT', companyId: 'company-1', userId: 'user-1',
          expenseId: 'expense-1', chatKeyHash: 'chat-hash', status: 'CONSUMED', acceptedValues: {},
          provenance: {}, resolvedFields: [], missingFields: [], attachmentRefs: [], pendingQuestion: null,
          targetRevision: '2026-08-16T09:00:00.000Z', lastActivityAt: '2026-08-16T09:00:00.000Z',
          formRequested: true, ...state,
        },
      },
      substituteReceiptEvidence: evidence && {
        id: 'evidence-1', documentNumber: 'SUB-202608-00007', status: 'PREPARED',
        signatureMode: 'DIGITAL', wetSignedScanAttachmentId: null, preparedAt: '2026-08-16T09:05:00.000Z',
        ...evidence,
      },
    }),
    ...extra,
  });
}

const SCAN = {
  expenseId: 'expense-1', evidenceId: 'evidence-1', documentNumber: 'SUB-202608-00007',
  amountLabel: '200.00 บาท', preparedAt: '2026-08-16T09:05:00.000Z',
};

describe('LINE substitute-receipt incoming media (spec §11, R10)', () => {
  it('reads the caption before the awaiting-scan state, because the caption is the stated intent', () => {
    // A form is awaiting its scan in every one of these, and the caption still decides.
    assert.equal(classifySubstituteMedia('ลายเซ็นค่ะ', true), 'SIGNATURE');
    assert.equal(classifySubstituteMedia('อัปโหลดลายมือชื่อ', true), 'SIGNATURE');
    assert.equal(classifySubstituteMedia('สลิปโอนค่ะ', true), 'PAYMENT_EVIDENCE');
    assert.equal(classifySubstituteMedia('จ่ายแล้วนะ', true), 'PAYMENT_EVIDENCE');
    assert.equal(classifySubstituteMedia('หลักฐานค่าที่จอดรถ', true), 'SUPPORTING_EVIDENCE');
    assert.equal(classifySubstituteMedia('', true), 'AWAITING_SCAN_CONFIRM', 'only a silent caption becomes D9');
    assert.equal(classifySubstituteMedia('อันนี้อะไรนะ', true), 'AWAITING_SCAN_CONFIRM');

    assert.equal(classifySubstituteMedia('สลิปโอนค่ะ', false), 'PAYMENT_EVIDENCE');
    assert.equal(classifySubstituteMedia('รูปประกอบของรายการนี้', false), 'SUPPORTING_EVIDENCE');
    assert.equal(classifySubstituteMedia('', false), 'ASK');
  });

  it('asks D9 by document number and amount, and reads back only its own answers', () => {
    const question = substituteScanConfirmQuestion(SCAN);
    assert.match(question, /SUB-202608-00007/);
    assert.match(question, /200\.00 บาท/);
    assert.match(question, /• ใช่/);
    assert.match(question, /• ไม่ใช่ เป็นหลักฐานอื่น/);
    assert.equal(substituteScanConfirmAnswer('1'), 'YES');
    assert.equal(substituteScanConfirmAnswer('ใช่'), 'YES');
    assert.equal(substituteScanConfirmAnswer('2'), 'NO');
    assert.equal(substituteScanConfirmAnswer('ไม่ใช่ ใบอื่น'), 'NO');
    assert.equal(substituteScanConfirmAnswer('ใบไหนนะ'), undefined);
  });

  it('offers the signed-form choice only while a form awaits, always keeps the do-not-record escape', () => {
    const awaiting = substituteMediaChoices({ expenseId: 'expense-1', awaitingScans: [SCAN], signatureRequested: false });
    assert.deepEqual(awaiting, ['WET_SIGNED_SCAN', 'PAYMENT_EVIDENCE', 'SUPPORTING_EVIDENCE', 'NEW_EXPENSE', 'NO_RECORD']);
    assert.equal(substituteMediaAnswer('1', awaiting), 'WET_SIGNED_SCAN');
    assert.equal(substituteMediaAnswer('5', awaiting), 'NO_RECORD');

    // A3: a photo sent right after “ส่งรูปลายเซ็นเข้ามาได้เลย” had no answer on this list that could
    // become a signature, so the only honest choices were “new expense” or “do not record”.
    const blocked = substituteMediaChoices({ expenseId: 'expense-1', awaitingScans: [], signatureRequested: true });
    assert.deepEqual(blocked, ['SIGNATURE', 'PAYMENT_EVIDENCE', 'SUPPORTING_EVIDENCE', 'NEW_EXPENSE', 'NO_RECORD']);
    assert.equal(substituteMediaAnswer('1', blocked), 'SIGNATURE');
    assert.match(substituteMediaQuestion(blocked), /• ลายเซ็นของฉัน/);
    // Offered only while the work is blocked on one.
    assert.equal(substituteMediaChoices({ expenseId: 'expense-1', awaitingScans: [SCAN], signatureRequested: false }).includes('SIGNATURE'), false);

    const plain = substituteMediaChoices({ expenseId: 'expense-1', awaitingScans: [], signatureRequested: false });
    assert.deepEqual(plain, ['PAYMENT_EVIDENCE', 'SUPPORTING_EVIDENCE', 'NEW_EXPENSE', 'NO_RECORD']);
    assert.equal(substituteMediaQuestion(plain).includes('ฟอร์มที่เซ็นแล้ว'), false);
    assert.match(substituteMediaQuestion(plain), /• ภาพประกอบคำถาม ไม่ต้องบันทึก/);
    assert.equal(substituteMediaAnswer('1', plain), 'PAYMENT_EVIDENCE');
    assert.equal(substituteMediaAnswer('5', plain), undefined, 'a number past the offered list answers nothing');
    assert.equal(substituteMediaAnswer('ยอดเท่าไร', plain), undefined);
  });

  it('resolves a recorded question only when it is ours AND from this chat', () => {
    const asked = { kind: 'SUBSTITUTE_MEDIA_CLASS', chatKeyHash: 'chat-hash', choices: ['PAYMENT_EVIDENCE', 'NO_RECORD'] };
    assert.deepEqual(parseSubstituteMediaQuestion(asked, 'chat-hash'), asked);
    assert.equal(parseSubstituteMediaQuestion(asked, 'other-chat'), undefined, 'the pending row is per user, the work is per chat');
    // The receipt clarify's own rows, and rows written before questions were recorded, are not ours.
    assert.equal(parseSubstituteMediaQuestion({ kind: 'RECEIPT_CLARIFY', chatKeyHash: 'chat-hash' }, 'chat-hash'), undefined);
    assert.equal(parseSubstituteMediaQuestion(null, 'chat-hash'), undefined);
    assert.equal(parseSubstituteMediaQuestion({ kind: 'SUBSTITUTE_MEDIA_CLASS', chatKeyHash: 'chat-hash', choices: ['NOPE'] }, 'chat-hash'), undefined);
    assert.deepEqual(
      parseSubstituteMediaQuestion({ kind: 'SUBSTITUTE_SCAN_CONFIRM', chatKeyHash: 'chat-hash', evidenceId: 'evidence-1' }, 'chat-hash'),
      { kind: 'SUBSTITUTE_SCAN_CONFIRM', chatKeyHash: 'chat-hash', evidenceId: 'evidence-1' },
    );
  });

  // UAT round 10 (2026-09-30): a week-old OPEN state with no ask turned every caption-less receipt photo into the
  // numbered "ยังไม่แน่ใจว่าเป็นอะไร" question; the Owner's rule is "ถ้าอ่านรูปได้แล้วต้องสร้างเลย".
  it('claims a caption-less photo only right after asking for exactly that picture', () => {
    const now = new Date('2026-09-30T00:03:00.000Z');
    const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
    const open = { expenseId: 'expense-old', awaitingScans: [], signatureRequested: false, finalReceiptExpected: false };
    assert.equal(substituteAwaitsCaptionlessPhoto(open, now), false, 'an OPEN state with no ask never claims a bare photo');
    const scan = { expenseId: 'expense-1', evidenceId: 'evidence-1', documentNumber: 'SR-1', amountLabel: '120.00 บาท' };
    assert.equal(substituteAwaitsCaptionlessPhoto({ ...open, awaitingScans: [{ ...scan, preparedAt: ago(5) }] }, now), true, 'a form printed 5 minutes ago');
    assert.equal(substituteAwaitsCaptionlessPhoto({ ...open, awaitingScans: [{ ...scan, preparedAt: ago(120) }] }, now), false, 'a form printed 2 hours ago');
    assert.equal(substituteAwaitsCaptionlessPhoto({ ...open, signatureRequested: true, signatureRequestedAt: ago(10) }, now), true);
    assert.equal(substituteAwaitsCaptionlessPhoto({ ...open, signatureRequested: true, signatureRequestedAt: ago(45) }, now), false);
    assert.equal(substituteAwaitsCaptionlessPhoto({ ...open, signatureRequested: true }, now), false, 'an ask with no time never claims');
    assert.equal(substituteAwaitsCaptionlessPhoto({ ...open, finalReceiptExpected: true, finalReceiptRequestedAt: ago(1) }, now), true);
    assert.equal(substituteAwaitsCaptionlessPhoto({ ...open, finalReceiptExpected: true, finalReceiptRequestedAt: ago(31) }, now), false);
    // A caption still speaks for itself, exactly as before: its own signals pick the class.
    assert.equal(classifySubstituteMedia('สลิปโอนค่ะ', false), 'PAYMENT_EVIDENCE');
    assert.equal(classifySubstituteMedia('ฟอร์มที่เซ็นแล้ว ลายเซ็นอยู่ด้านล่าง', true), 'SIGNATURE');
  });

  it('reads awaiting-scan from the consumed state plus the live evidence row', async () => {
    const context = await scanHarness().useCase.loadOpenMediaContext(ctx(), 'chat-hash');
    assert.equal(context?.expenseId, 'expense-1');
    assert.deepEqual(context?.awaitingScans, [SCAN]);

    const notAwaiting = [
      // The chat asked for a document, not a form: nothing is waiting for a photo of a signed sheet.
      await scanHarness({ formRequested: undefined }).useCase.loadOpenMediaContext(ctx(), 'chat-hash'),
      // Already certified — the sheet's moment has passed.
      await scanHarness({}, { status: 'PAYER_CERTIFIED' }).useCase.loadOpenMediaContext(ctx(), 'chat-hash'),
      // A scan is already linked, so a second photo is not that scan.
      await scanHarness({}, { signatureMode: 'PAPER', wetSignedScanAttachmentId: 'att-scan' }).useCase.loadOpenMediaContext(ctx(), 'chat-hash'),
    ];
    for (const item of notAwaiting) assert.deepEqual(item?.awaitingScans ?? [], []);

    assert.equal(await scanHarness({}, null).useCase.loadOpenMediaContext(ctx(), 'chat-hash'), undefined);
    assert.equal(await harness().useCase.loadOpenMediaContext(ctx(), 'chat-hash'), undefined, 'no continuation in this chat');
    assert.equal(
      await scanHarness().useCase.loadOpenMediaContext({ ...ctx(), permissions: ['expense.receipt.upload'] }, 'chat-hash'),
      undefined,
      'without expense.review there is no substitute work to classify against',
    );
  });

  it('collects every form still awaiting a scan, newest first, so §15 can list the others', async () => {
    const second = {
      id: 'expense-2', updatedAt: new Date('2026-08-16T10:00:00.000Z'),
      sourceChannelMetadataJson: {
        chatKeyHash: 'chat-hash',
        lineSubstituteReceiptContinuation: {
          workflowId: 'wf-2', kind: 'SUBSTITUTE_RECEIPT', companyId: 'company-1', userId: 'user-1',
          expenseId: 'expense-2', chatKeyHash: 'chat-hash', status: 'CONSUMED', acceptedValues: {}, provenance: {},
          resolvedFields: [], missingFields: [], attachmentRefs: [], pendingQuestion: null, formRequested: true,
          targetRevision: '2026-08-16T10:00:00.000Z', lastActivityAt: '2026-08-16T10:00:00.000Z',
        },
      },
    };
    const h = scanHarness();
    const repo = (h.useCase as any).repo;
    const baseRows = repo.listLineSubstituteContinuationRows;
    repo.listLineSubstituteContinuationRows = async (input: any) => [...await baseRows(input), second];
    const baseFind = repo.findByIdWithRelations;
    repo.findByIdWithRelations = async (companyId: string, id: string, ...rest: any[]) => id === 'expense-2'
      ? {
        id: 'expense-2', grandTotalAmount: '99.0000', currency: 'THB',
        substituteReceiptEvidence: {
          id: 'evidence-2', documentNumber: 'SUB-202608-00009', status: 'PREPARED',
          signatureMode: 'DIGITAL', wetSignedScanAttachmentId: null, preparedAt: '2026-08-16T10:05:00.000Z',
        },
      }
      : baseFind(companyId, id, ...rest);

    const context = await h.useCase.loadOpenMediaContext(ctx(), 'chat-hash');

    assert.deepEqual(context?.awaitingScans.map((item) => item.documentNumber), ['SUB-202608-00009', 'SUB-202608-00007']);
    assert.match(substituteScanPickQuestion(context!.awaitingScans), /• SUB-202608-00009 ยอด 99\.00 บาท/);
    assert.match(substituteScanPickQuestion(context!.awaitingScans), /• SUB-202608-00007/);
  });

  it('keeps an open workflow as the target for evidence even when nothing awaits a scan', async () => {
    const h = await readyHarness();
    const context = await h.useCase.loadOpenMediaContext(ctx(), 'chat-hash');
    assert.equal(context?.expenseId, 'expense-1');
    assert.deepEqual(context?.awaitingScans, []);
  });

  it('marks the paper route on the state the prepare consumes, so the next photo can be the scan', async () => {
    const h = await readyHarness();
    await h.useCase.execute(ctx(), { messageText: '2', confirmedDecision: 'FORM', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(h.prepares[0].lineContinuation.formRequested, true);
    const context = await h.useCase.loadOpenMediaContext(ctx(), 'chat-hash');
    assert.equal(context?.awaitingScans[0]?.documentNumber, 'SUB-202608-00007');

    const digital = await readyHarness({ signature: { id: 'signature-1' } });
    await digital.useCase.execute(ctx(), { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(digital.prepares[0].lineContinuation.formRequested, false);
    // Consumed, nothing awaiting: this chat has no open substitute work for a photo to belong to.
    assert.equal(await digital.useCase.loadOpenMediaContext(ctx(), 'chat-hash'), undefined);
  });

  it('links the confirmed scan once, replies รอยืนยัน with the evidence link, and audits it HIGH', async () => {
    const h = scanHarness();
    const linked = await h.useCase.linkWetSignedScan(ctx(), {
      expenseId: 'expense-1', evidenceId: 'evidence-1', attachmentId: 'att-scan', checksumSha256: 'scan-checksum', webBaseUrl: WEB_BASE,
    });

    assert.equal(h.scanLinks.length, 1);
    assert.equal(h.scanLinks[0].checksumSha256, 'scan-checksum');
    assert.match(linked.replyText, /รอยืนยัน/);
    assert.match(linked.replyText, /SUB-202608-00007/);
    assert.match(linked.replyText, new RegExp(`${WEB_BASE}/companies/company-1/expenses/substitute-receipts/evidence-1`));
    assert.match(linked.replyText, /ยังไม่ได้ลงนาม อนุมัติ หรือออกเอกสาร/, '§16: a photo alone issues nothing');
    const audit = h.audits.find((entry) => entry.action === 'expense.substitute_receipt.wet_signed_scan.link');
    assert.equal(audit.riskLevel, 'HIGH');
    assert.equal(audit.metadataJson.source, 'LINE');
    assert.equal(audit.metadataJson.signatureMode, 'PAPER');

    // Redelivery of the same confirmation: the evidence already points at these bytes.
    const again = await h.useCase.linkWetSignedScan(ctx(), {
      expenseId: 'expense-1', evidenceId: 'evidence-1', attachmentId: 'att-scan', checksumSha256: 'scan-checksum', webBaseUrl: WEB_BASE,
    });
    assert.equal(h.scanLinks.length, 1, 'idempotent: no second link');
    assert.equal(h.audits.filter((entry) => entry.action === 'expense.substitute_receipt.wet_signed_scan.link').length, 1);
    assert.match(again.replyText, /SUB-202608-00007/);

    await assert.rejects(
      () => h.useCase.linkWetSignedScan({ ...ctx(), permissions: ['expense.receipt.upload'] }, {
        expenseId: 'expense-1', evidenceId: 'evidence-1', attachmentId: 'att-other', checksumSha256: 'x',
      }),
      ForbiddenException,
    );
  });

  it('refuses a scan that could never be composed into the issued document', async () => {
    // R11: linking it would certify and issue cleanly, and then every download would fail forever.
    const cases: Array<[string, { bytes: Buffer; mimeType: string } | null, RegExp]> = [
      ['a scan with more pages than the artifact may hold', { bytes: await onePagePdf(6), mimeType: 'application/pdf' }, /6-page safety limit/],
      ['bytes that are not a document at all', { bytes: Buffer.from('not a pdf'), mimeType: 'application/pdf' }, /cannot be read as a printable document/],
      ['an image type the composer cannot reproduce', { bytes: Buffer.from('x'), mimeType: 'image/heic' }, /must be a JPEG, PNG, or PDF/],
      ['an attachment that is no longer ACTIVE', null, /not ACTIVE/],
    ];
    for (const [name, scanObject, expected] of cases) {
      const h = scanHarness({}, {}, { scanObject });
      await assert.rejects(
        () => h.useCase.linkWetSignedScan(ctx(), {
          expenseId: 'expense-1', evidenceId: 'evidence-1', attachmentId: 'att-scan', checksumSha256: 'c', webBaseUrl: WEB_BASE,
        }),
        (error: unknown) => {
          const body = (error as ConflictException).getResponse() as { code: string; message: string };
          assert.equal(body.code, SCAN_NOT_LINKABLE, name);
          assert.match(body.message, expected, name);
          return true;
        },
        name,
      );
      assert.equal(h.scanLinks.length, 0, `${name}: nothing is linked`);
    }
    // A five-page scan still fits: five scan pages plus the attestation is exactly the ceiling.
    const ok = scanHarness({}, {}, { scanObject: { bytes: await onePagePdf(5), mimeType: 'application/pdf' } });
    await ok.useCase.linkWetSignedScan(ctx(), {
      expenseId: 'expense-1', evidenceId: 'evidence-1', attachmentId: 'att-scan', checksumSha256: 'c', webBaseUrl: WEB_BASE,
    });
    assert.equal(ok.scanLinks.length, 1);
  });

  it('attaches evidence under the chosen purpose with permission, audits the source, and refuses without it', async () => {
    const h = await readyHarness();
    const attached = await h.useCase.attachMedia({ ...ctx(), permissions: ['expense.review', 'expense.receipt.upload'] }, {
      expenseId: 'expense-1', attachmentId: 'att-slip', purpose: 'expense.payment.evidence', webBaseUrl: WEB_BASE,
    });
    assert.deepEqual(h.links, [{ expenseId: 'expense-1', attachmentId: 'att-slip', purpose: 'expense.payment.evidence' }]);
    assert.match(attached.replyText, /หลักฐานการจ่ายเงิน/);
    const audit = h.audits.find((entry) => entry.action === 'attachment.upload');
    assert.equal(audit.metadataJson.source, 'LINE');
    assert.equal(audit.metadataJson.purpose, 'expense.payment.evidence');
    assert.equal(audit.riskLevel, 'MEDIUM');

    // MANAGER holds expense.review and not expense.receipt.upload: §14 keeps the attach gate.
    await assert.rejects(
      () => h.useCase.attachMedia({ ...ctx(), permissions: ['expense.review'] }, {
        expenseId: 'expense-1', attachmentId: 'att-2', purpose: 'expense.receipt.supporting',
      }),
      ForbiddenException,
    );
    assert.equal(h.links.length, 1, 'a refused upload links nothing');
  });

  it('clears the evidence ask on the next turn once a file is attached (Journey C)', async () => {
    const h = harness({
      expense: expense({
        vendorNameSnapshot: 'วินมอเตอร์ไซค์', paymentMethod: 'CASH', paidAt: new Date('2026-08-15T00:00:00.000Z'),
        missingReceiptReason: 'วินไม่ออกใบเสร็จ',
      }),
    });
    const asked = await h.useCase.execute(ctx(), {
      messageText: 'ไม่มีใบเสร็จ\nวัตถุประสงค์: ไปพบลูกค้า\nฉันเป็นผู้จ่าย บริษัทจ่ายเต็มจำนวน', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }], webBaseUrl: WEB_BASE,
    });
    assert.ok(asked.blockers.some((item) => item.code === 'supporting_evidence_required'));

    await h.useCase.attachMedia({ ...ctx(), permissions: ['expense.review', 'expense.receipt.upload'] }, {
      expenseId: 'expense-1', attachmentId: 'att-slip', purpose: 'expense.payment.evidence', webBaseUrl: WEB_BASE,
    });
    const next = await h.useCase.execute(ctx(), { messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });

    assert.equal(next.blockers.some((item) => item.code === 'supporting_evidence_required'), false);
    assert.equal(next.replyText.includes('มีสลิปหรือรูปถ่ายประกอบไหมคะ'), false);
    assert.match(next.replyText, /ข้อมูลครบแล้ว พร้อมออกเอกสาร/);
  });
});

// ─── Phase 5: spec §13 badges ─────────────────────────────────────────────────

describe('spec §13 — the state badge', () => {
  it('maps every state in the table, refusals first', () => {
    const collectable = [{ code: 'a', message: 'a', collectableInLine: true }, { code: 'b', message: 'b', collectableInLine: true }];
    const fileOnly = [{ code: 'payment_evidence_required', message: 'x', collectableInLine: false }];

    assert.equal(substituteReceiptBadge({ status: 'FORBIDDEN' }), '🔒 ไม่มีสิทธิ์');
    assert.equal(substituteReceiptBadge({ status: 'INELIGIBLE' }), '⛔ ทำไม่ได้');
    assert.equal(substituteReceiptBadge({ status: 'BLOCKED', blockers: collectable }), '🟡 ยังขาดข้อมูล 2 อย่าง');
    assert.equal(substituteReceiptBadge({ status: 'BLOCKED', blockers: fileOnly }), '🟠 รอไฟล์หลักฐาน');
    assert.equal(substituteReceiptBadge({ status: 'READY_FOR_WEB', blockers: [] }), '🟢 ข้อมูลครบ');
    assert.equal(substituteReceiptBadge({ status: 'READY_FOR_WEB', evidenceStatus: 'PREPARED' }), '🔵 รอยืนยัน');
    assert.equal(substituteReceiptBadge({ status: 'READY_FOR_WEB', evidenceStatus: 'PREPARED', awaitingPaperSignature: true }), '🖊️ รอลงนาม');
    assert.equal(substituteReceiptBadge({ status: 'READY_FOR_WEB', evidenceStatus: 'PAYER_CERTIFIED' }), '🔵 รอยืนยัน');
    assert.equal(substituteReceiptBadge({ status: 'READY_FOR_WEB', evidenceStatus: 'ISSUED' }), '✅ ออกเอกสารแล้ว');
    assert.equal(substituteReceiptBadge({ status: 'READY_FOR_WEB', evidenceStatus: 'SUPERSEDED' }), '✅ ออกเอกสารแล้ว');
  });

  it('outranks progress with a refusal, and states nothing for the states §13 does not name', () => {
    // An INELIGIBLE turn that happens to carry a document must not read as "ออกเอกสารแล้ว".
    assert.equal(substituteReceiptBadge({ status: 'INELIGIBLE', evidenceStatus: 'ISSUED' }), '⛔ ทำไม่ได้');
    for (const status of ['PAUSED', 'CANCELLED', 'STALE', 'TARGET_REQUIRED'] as const) {
      assert.equal(substituteReceiptBadge({ status, blockers: [] }), undefined, status);
    }
  });

  it('rides the reply out of the use case, so the card can render a row above the body', async () => {
    const forbidden = await harness().useCase.execute(
      { ...ctx(), permissions: [] },
      { messageText: 'ทำใบทดแทนใบเสร็จ', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE },
    );
    assert.equal(forbidden.badge, '🔒 ไม่มีสิทธิ์');

    const blocked = await harness().useCase.execute(ctx(), {
      messageText: 'ทำใบทดแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }], webBaseUrl: WEB_BASE,
    });
    assert.match(blocked.badge ?? '', /^🟡 ยังขาดข้อมูล \d+ อย่าง$/);

    const ready = await readyHarness();
    assert.equal(ready.asked.badge, '🟢 ข้อมูลครบ');
  });
});

describe('spec §12 removed — the document is downloaded from the web, never pushed into LINE', () => {
  it('reports an ISSUED document with its number and amount, and points at the web page to download', async () => {
    const h = harness();
    h.issue();

    const result = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบทดแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }], webBaseUrl: WEB_BASE,
    });

    assert.equal(result.badge, '✅ ออกเอกสารแล้ว');
    assert.match(result.replyText, /SUB-202608-00007/);
    assert.match(result.replyText, /200\.00 บาท/);
    assert.match(result.replyText, /ดาวน์โหลดเอกสารที่ออกแล้ว/);
    assert.equal(result.webPath, `${WEB_BASE}/companies/company-1/expenses/substitute-receipts/evidence-1`);
    assert.match(result.replyText, /เปิดในเว็บ:/);
    assert.doesNotMatch(result.replyText, /\/d\//, 'no delivery link is pushed into the chat');
    assert.deepEqual(h.saves, [], 'reporting an issued document writes no continuation state');
  });

  it('reports a PREPARED paper-route form as awaiting ink and points at the web form (F5)', async () => {
    const h = harness();
    h.issue({ status: 'PREPARED', signatureMode: 'PAPER', wetSignedScanAttachmentId: null });

    const resumed = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'x' }], webBaseUrl: WEB_BASE,
    });

    assert.equal(resumed.badge, '🖊️ รอลงนาม', 'paper route waits for ink, not a web sign-off');
    assert.match(resumed.replyText, /แบบฟอร์มรอลงนาม/);
    assert.match(resumed.replyText, /พิมพ์แล้วเซ็นด้วยมือ/);
    assert.doesNotMatch(resumed.replyText, /เหลือลงนามรับรองและอนุมัติในเว็บ/, 'a paper user is not sent to sign digitally');
    assert.doesNotMatch(resumed.replyText, /\/d\//, 'the form is on the web page, not a pushed link');
  });

  it('the taught resend phrase is no longer special — it falls through to normal handling, minting nothing', async () => {
    const h = await readyHarness();

    const result = await h.useCase.execute(ctx(), {
      messageText: 'ขอลิงก์ใหม่', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });

    assert.equal(result.status, 'READY_FOR_WEB');
    assert.match(result.replyText, /ให้ออกเอกสารเลยไหมคะ/);
    assert.doesNotMatch(result.replyText, /\/d\//);
  });
});

// ── QA round 9 defects ────────────────────────────────────────────────────────────────────────────
// Everything below was found by driving the real DI graph against a seeded database, not by reading
// the code. Each block names the journey that broke.

describe('B1 — the expense category is a collectable field, asked in Thai', () => {
  const CATEGORIES = [
    { id: 'cat-travel', name: 'ค่าเดินทาง' },
    { id: 'cat-food', name: 'ค่าอาหาร' },
    { id: 'cat-office', name: 'ค่าอุปกรณ์สำนักงาน' },
  ];

  /** Exactly the shape a LINE text capture leaves behind: no category anywhere, and the capture-time
   *  missing-receipt marker on the row. */
  function uncategorised(overrides: Record<string, unknown> = {}) {
    return expense({
      expenseCategoryId: null, accountHintKey: null,
      lines: [{ description: 'ค่าวินมอไซต์ไปพบลูกค้า', expenseCategoryId: null, accountHintKey: null }],
      vendorNameSnapshot: 'วินมอเตอร์ไซค์', paymentMethod: 'CASH', paidAt: new Date('2026-08-15T00:00:00.000Z'),
      missingReceiptReason: 'LINE text-only expense note; evidence file not attached',
      attachments: [{ id: 'att-1', status: 'ACTIVE', purpose: 'expense.receipt.supporting' }],
      ...overrides,
    });
  }

  it('asks for the category in Thai with the company list, instead of the old English dead end', async () => {
    const h = harness({ expense: uncategorised(), categories: CATEGORIES });

    const result = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จรับเงิน', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }], webBaseUrl: WEB_BASE,
    });

    const category = result.blockers.find((item) => item.code === 'reviewed_category_required');
    assert.ok(category, 'the machine code is unchanged — the web resolves its own Thai from it');
    assert.equal(category.collectableInLine, true, 'and it is now answerable in chat');
    assert.equal(/[A-Za-z]{4,}/u.test(category.message), false, `still English: ${category.message}`);
    assert.match(result.replyText, /ค่าใช้จ่ายนี้อยู่หมวดไหนคะ/);
    assert.match(result.replyText, /• ค่าเดินทาง/);
    assert.match(result.replyText, /• ค่าอาหาร/);
    assert.match(result.pendingQuestion ?? '', /ตอบข้อมูลที่ยังขาดรวม.*\n• ค่าใช้จ่ายนี้อยู่หมวดไหนคะ/);
  });

  for (const [label, answer] of [['a typed name', 'ค่าอาหาร'], ['a numbered choice', '2'], ['a labelled name', 'หมวด: ค่าอาหาร']] as const) {
    it(`accepts ${label} and clears the blocker on the same turn`, async () => {
      const h = harness({ expense: uncategorised(), categories: CATEGORIES });
      await h.useCase.execute(ctx(), {
        messageText: 'ทำใบรับรองแทนใบเสร็จรับเงิน', chatKeyHash: 'chat-hash',
        recentCandidates: [{ id: 'expense-1', label: 'x' }], webBaseUrl: WEB_BASE,
      });

      const answered = await h.useCase.execute(ctx(), {
        messageText: answer, chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
      });

      assert.ok(answered.acceptedFields.includes('expenseCategoryId'), answered.replyText);
      assert.equal(
        answered.blockers.some((item) => item.code === 'reviewed_category_required'), false,
        'the answer the user gave actually clears the blocker it was asked for',
      );
      assert.equal(h.getExpense().expenseCategoryId, null, 'collection keeps the category proposed');
      assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.expenseCategoryId, 'cat-food');
      assert.match(answered.replyText, /หมวดค่าใช้จ่าย/);
      assert.match(answered.replyText, /หมวดในรายการค่าใช้จ่ายยังไม่เปลี่ยน/);
      assert.match(answered.replyText, /เก็บหมวดไว้ในร่างแล้วค่ะ ตรวจข้อมูลก่อนกดเตรียมใบรับรอง/);
    });
  }

  it('does not read a category out of long prose that merely contains one of the names', async () => {
    const h = harness({ expense: uncategorised(), categories: CATEGORIES });
    await h.useCase.execute(ctx(), {
      messageText: '\u0e17\u0e33\u0e43\u0e1a\u0e23\u0e31\u0e1a\u0e23\u0e2d\u0e07\u0e41\u0e17\u0e19\u0e43\u0e1a\u0e40\u0e2a\u0e23\u0e47\u0e08\u0e23\u0e31\u0e1a\u0e40\u0e07\u0e34\u0e19', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'x' }], webBaseUrl: WEB_BASE,
    });

    const prose = await h.useCase.execute(ctx(), {
      // Long, and it happens to contain \u201c\u0e04\u0e48\u0e32\u0e40\u0e14\u0e34\u0e19\u0e17\u0e32\u0e07\u201d. A certified field is never read out of prose.
      messageText: '\u0e1e\u0e2d\u0e14\u0e35\u0e40\u0e14\u0e37\u0e2d\u0e19\u0e19\u0e35\u0e49\u0e21\u0e35\u0e04\u0e48\u0e32\u0e40\u0e14\u0e34\u0e19\u0e17\u0e32\u0e07\u0e2b\u0e25\u0e32\u0e22\u0e23\u0e2d\u0e1a\u0e21\u0e32\u0e01 \u0e40\u0e14\u0e35\u0e4b\u0e22\u0e27\u0e08\u0e30\u0e2a\u0e48\u0e07\u0e2a\u0e23\u0e38\u0e1b\u0e43\u0e2b\u0e49\u0e17\u0e35\u0e2b\u0e25\u0e31\u0e07\u0e19\u0e30\u0e04\u0e30',
      chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });

    assert.equal(prose.acceptedFields.includes('expenseCategoryId'), false, prose.replyText);
    assert.equal(h.getExpense().expenseCategoryId, null);
  });

  it('offers one row per name when the global defaults duplicate the company\u2019s own', async () => {
    const h = harness({
      expense: uncategorised(),
      categories: [
        { id: 'global-travel', name: '\u0e04\u0e48\u0e32\u0e40\u0e14\u0e34\u0e19\u0e17\u0e32\u0e07', companyId: null },
        { id: 'cat-travel', name: '\u0e04\u0e48\u0e32\u0e40\u0e14\u0e34\u0e19\u0e17\u0e32\u0e07', companyId: 'company-1' },
        { id: 'cat-food', name: '\u0e04\u0e48\u0e32\u0e2d\u0e32\u0e2b\u0e32\u0e23', companyId: 'company-1' },
      ] as any,
    });

    const asked = await h.useCase.execute(ctx(), {
      messageText: '\u0e17\u0e33\u0e43\u0e1a\u0e23\u0e31\u0e1a\u0e23\u0e2d\u0e07\u0e41\u0e17\u0e19\u0e43\u0e1a\u0e40\u0e2a\u0e23\u0e47\u0e08\u0e23\u0e31\u0e1a\u0e40\u0e07\u0e34\u0e19', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'x' }], webBaseUrl: WEB_BASE,
    });

    const numbered = asked.replyText.split('\n').filter((line) => /^• (?:ค่าเดินทาง|ค่าอาหาร)$/u.test(line));
    assert.deepEqual(numbered, ['• \u0e04\u0e48\u0e32\u0e40\u0e14\u0e34\u0e19\u0e17\u0e32\u0e07', '• \u0e04\u0e48\u0e32\u0e2d\u0e32\u0e2b\u0e32\u0e23'], 'no label appears twice under two numbers');

    const answered = await h.useCase.execute(ctx(), {
      messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.expenseCategoryId, 'cat-travel', 'the company\u2019s own row wins over the global default');
    assert.equal(h.getExpense().expenseCategoryId, null);
  });

  it('runs the whole journey to a clean preflight and the R13 ask, then prepares', async () => {
    const h = harness({ expense: uncategorised(), categories: CATEGORIES, signature: { id: 'signature-1' } });

    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จรับเงิน ค่าวินมอไซต์ไปพบลูกค้า', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'x' }], webBaseUrl: WEB_BASE,
    });
    for (const messageText of [
      '1',
      'ไม่มีใบเสร็จ',
      'เหตุผล: วินมอเตอร์ไซค์ไม่ออกใบเสร็จให้',
      'วัตถุประสงค์: ไปพบลูกค้า',
      'ฉันเป็นผู้จ่าย บริษัทจ่ายเต็มจำนวน',
    ]) {
      await h.useCase.execute(ctx(), { messageText, chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    }
    const ready = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });

    assert.deepEqual(ready.blockers, [], `still blocked: ${ready.replyText}`);
    assert.equal(ready.pendingQuestion, 'ให้ออกเอกสารเลยไหมคะ');

    const issued = await h.useCase.execute(ctx(), {
      messageText: 'ออกเอกสารเลย', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });
    assert.equal(h.prepares.length, 1, issued.replyText);
  });

  it('states every eligibility blocker in Thai, whatever the reason', async () => {
    const h = harness({
      expense: expense({ status: 'CONFIRMED', currency: 'USD', grandTotalAmount: '0', taxEvidenceStatus: 'NEEDS_REVIEW' }),
    });

    const result = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จรับเงิน', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'x' }], webBaseUrl: WEB_BASE,
    });

    const english = result.blockers.filter((item) => /[A-Za-z]{4,}/u.test(item.message.replace(/\((?:สถานะตอนนี้: )?[A-Z_]+\)|\(THB\)/gu, '')));
    assert.deepEqual(english.map((item) => item.code), [], `English reached a Thai chat: ${JSON.stringify(english)}`);
  });
});

describe('B2 — the capture-time missing-receipt marker is never an answer and never a document field', () => {
  function captured(marker: string) {
    return expense({
      vendorNameSnapshot: 'วินมอเตอร์ไซค์', paymentMethod: 'CASH', paidAt: new Date('2026-08-15T00:00:00.000Z'),
      missingReceiptReason: marker,
      attachments: [{ id: 'att-1', status: 'ACTIVE', purpose: 'expense.receipt.supporting' }],
    });
  }

  for (const marker of [
    'LINE text-only expense note; evidence file not attached',
    'บันทึกค่าใช้จ่ายจากข้อความใน LINE ยังไม่ได้แนบไฟล์หลักฐาน',
  ]) {
    it(`asks the real reason question even though the row already carries “${marker.slice(0, 24)}…”`, async () => {
      const h = harness({ expense: captured(marker), signature: { id: 'signature-1' } });

      const started = await h.useCase.execute(ctx(), {
        messageText: 'ทำใบรับรองแทนใบเสร็จรับเงิน\nไม่มีใบเสร็จ\nวัตถุประสงค์: ไปพบลูกค้า\nฉันเป็นผู้จ่าย บริษัทจ่ายเต็มจำนวน',
        chatKeyHash: 'chat-hash', recentCandidates: [{ id: 'expense-1', label: 'x' }], webBaseUrl: WEB_BASE,
      });

      assert.ok(
        started.blockers.some((item) => item.code === 'missing_receipt_reason_required'),
        'a machine marker is not the payer certifying why there is no receipt',
      );
      assert.equal(started.pendingQuestion, 'เหตุผลที่ไม่มีใบเสร็จคืออะไรคะ?');

      await h.useCase.execute(ctx(), {
        messageText: 'วินมอเตอร์ไซค์ไม่ออกใบเสร็จให้ค่ะ', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
      });
      await h.useCase.execute(ctx(), {
        messageText: 'ออกเอกสารเลย', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
      });

      assert.equal(h.prepares.length, 1);
      assert.equal(
        h.prepares[0].missingReceiptReason, 'วินมอเตอร์ไซค์ไม่ออกใบเสร็จให้ค่ะ',
        'the certificate prints what the payer wrote, never the capture marker',
      );
    });
  }

  it('still treats a reason a person actually wrote as answered', async () => {
    const h = harness({ expense: captured('ผู้ขายรายย่อยไม่ออกใบเสร็จ') });

    const result = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จรับเงิน', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'x' }], webBaseUrl: WEB_BASE,
    });

    assert.equal(result.blockers.some((item) => item.code === 'missing_receipt_reason_required'), false);
  });
});

describe('B5 — the paper choice survives the next turn', () => {
  it('turn 1 asks, turn 2 prints the form, turn 3 still says “waiting for ink”', async () => {
    const h = await readyHarness({ signature: { id: 'signature-1' } });

    const form = await h.useCase.execute(ctx(), {
      messageText: '2', confirmedDecision: 'FORM', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });
    assert.equal(form.badge, '🖊️ รอลงนาม');
    assert.match(form.replyText, /เตรียมแบบแล้วค่ะ เปิดเว็บเพื่อดาวน์โหลดไปเซ็น/);
    // The prepare records the paper choice on the consumed state; `signatureMode` stays DIGITAL
    // until the wet-signed scan arrives, which is exactly the window this bug lived in.
    assert.equal(h.getExpense().substituteReceiptEvidence.signatureMode, 'DIGITAL');

    const resumed = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'x' }], webBaseUrl: WEB_BASE,
    });

    assert.equal(resumed.badge, '🖊️ รอลงนาม', 'a paper-route sender is never told to sign in the web');
    assert.match(resumed.replyText, /พิมพ์แล้วเซ็นด้วยมือ/);
    assert.doesNotMatch(resumed.replyText, /เหลือลงนามรับรองและอนุมัติในเว็บ/);
  });
});

describe('M1/M4/M6 — the cheap ones a shop owner hits every day', () => {
  it('M1: cancelling keeps the collected answers, exactly as the reply promises', async () => {
    const h = await readyHarness();

    const cancelled = await h.useCase.execute(ctx(), {
      messageText: 'ยกเลิก', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.match(cancelled.replyText, /ข้อมูลที่ตอบไว้ยังเก็บอยู่กับรายการนี้/);

    const resumed = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'x' }], webBaseUrl: WEB_BASE,
    });

    const state = h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation;
    assert.equal(state.acceptedValues.businessPurpose, 'ไปพบลูกค้า', 'the answers survive the cancel');
    assert.equal(state.acceptedValues.payerUserId, 'user-1');
    assert.deepEqual(resumed.blockers, [], 'so the sender is not asked all eight questions again');
  });

  it('M4: the card names the expense by something a person can match, never a raw id', async () => {
    const h = harness({
      expense: expense({
        expenseNumber: null, expenseDate: new Date('2026-08-15T00:00:00.000Z'), vendorNameSnapshot: 'วินมอเตอร์ไซค์',
      }),
    });

    const result = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จรับเงิน', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'x' }], webBaseUrl: WEB_BASE,
    });

    // The id may still ride inside the web link — that is a URL, not something a person reads. What
    // must not happen is a cuid printed as the NAME of the expense.
    const prose = result.replyText.split('\n').filter((line) => !line.includes('http'));
    assert.equal(prose.some((line) => line.includes('expense-1')), false, `raw id in the customer’s face:\n${prose.join('\n')}`);
    assert.equal((result.resumeCapsule ?? '').split('\n').filter((line) => !line.includes('http')).some((line) => line.includes('expense-1')), false);
    assert.match(result.replyText, /รายการ: 15 ส\.ค\. · วินมอเตอร์ไซค์ · 200\.00 บาท/);
  });

  it('M6: the file badge is only shown when a file is what is missing', async () => {
    assert.equal(
      substituteReceiptBadge({ status: 'BLOCKED', blockers: [{ code: 'payment_evidence_required', message: 'x', collectableInLine: false }] }),
      '🟠 รอไฟล์หลักฐาน',
    );
    assert.equal(
      substituteReceiptBadge({ status: 'BLOCKED', blockers: [{ code: 'owner_self_approver_not_ready', message: 'x', collectableInLine: false }] }),
      '🌐 ต้องจัดการในเว็บ',
      'no file will ever clear an approver-policy gap',
    );
  });
});

describe('entry vocabulary — the words a customer uses to ask for this document', () => {
  const ENTERS = [
    'ทำใบรับรองแทนใบเสร็จรับเงิน', 'ขอใบรับรองแทนใบเสร็จ', 'ทำใบทดแทนใบเสร็จ', 'ขอใบแทนใบเสร็จ',
    'ทำใบรับรองต่อ', 'ขอใบแทนหน่อยค่ะ', 'ทำเอกสารแทนใบเสร็จให้หน่อย', 'ขอใบรับรองแทนเงินสด',
    'ไม่มีใบเสร็จทำยังไงคะ', 'ไม่มีบิลทำไงดี', 'ไม่มีใบกำกับภาษี ต้องทำอะไร',
    // The document word standing alone. The UAT turn that fell through to plain expense capture is
    // the first of these: “ใบทดแทน**ของ**ค่าวินมอไซค์” is ordinary Thai, not a missing keyword.
    'ทำรายการใบทดแทนของค่าวินมอไซค์ไปพบลูกค้า', 'ขอใบทดแทนหน่อย',
    'อยากได้ใบแทนสำหรับค่าที่จอดรถ 40 บาท', 'ขอใบรับรองแทนของค่าทางด่วน 80 บาท',
  ];
  const STAYS_OUT = [
    // The stronger document R15 explains — it must never be routed here.
    'ขอใบสำคัญรับเงิน', 'ทำใบสำคัญรับเงินให้หน่อย', 'ออกใบสำคัญรับเงิน 500 บาท',
    // Ordinary expense capture that merely mentions a missing receipt.
    'ค่ากาแฟ 65 บาท ไม่มีใบเสร็จ', 'ค่าแท็กซี่ 120 บาท ไม่มีบิล', 'ยอดขายเดือนนี้เท่าไหร่', 'ขอใบเสนอราคา',
    // The follow-up turn of the same UAT journey: the fact alone carries no document word, which is
    // why the dispatcher has to carry the request rather than this list having to guess.
    'ค่าวินมอไซค์ 50 บาท', 'ต้องทำยังไงต่อ', 'ใบกำกับภาษีเต็มรูป',
  ];

  for (const text of ENTERS) {
    it(`treats “${text}” as a substitute-receipt request`, () => {
      assert.equal(isSubstituteReceiptConversationText(text), true);
    });
  }
  for (const text of STAYS_OUT) {
    it(`leaves “${text}” alone`, () => {
      assert.equal(isSubstituteReceiptConversationText(text), false);
    });
  }
});

describe('persistence seam: exact save & revision counts (real zero-write proof)', () => {
  // Opens a real OPEN workflow through a canonical explicit start (exactly one save), then positions the
  // harness on it so control/question/negation turns can be measured against a live workflow.
  async function opened() {
    const h = harness();
    const start = await h.useCase.execute(ctx(), { messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash', recentCandidates: [{ id: 'expense-1', label: 'โน้ต · 200' }] });
    assert.equal(h.saves.length, 1, 'canonical start writes exactly once');
    assert.equal(start.status, 'BLOCKED');
    return h;
  }

  it('a canonical explicit start writes exactly once and advances the revision', async () => {
    const h = harness();
    const rev0 = h.getExpense().updatedAt.toISOString();
    await h.useCase.execute(ctx(), { messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash', recentCandidates: [{ id: 'expense-1', label: 'โน้ต · 200' }] });
    assert.equal(h.saves.length, 1);
    assert.notEqual(h.getExpense().updatedAt.toISOString(), rev0, 'the none→OPEN transition advances the revision');
  });

  it('a MODEL-ONLY start (requireStartConfirmation, no deterministic entry) asks to confirm and writes NOTHING', async () => {
    const h = harness();
    const rev0 = h.getExpense().updatedAt.toISOString();
    // A message the PRIMARY router mapped to substitute but that matches NO deterministic entry phrase
    // (not canonical, not develop's vocabulary): it must confirm before writing. A canonical/vocabulary
    // phrase would open directly — develop's start-on-entry behavior, tested throughout the suite above.
    const r = await h.useCase.execute(ctx(), { messageText: 'เรื่องค่าวินเมื่อกี้', chatKeyHash: 'chat-hash', recentCandidates: [{ id: 'expense-1', label: 'โน้ต · 200' }], requireStartConfirmation: true });
    assert.ok(r.pendingQuestion, 'a model-only paraphrase asks to confirm first');
    assert.deepEqual(r.candidateExpenseIds, ['expense-1'], 'the confirm is pinned to the exact expense id');
    assert.equal(h.saves.length, 0, 'no workflow write before confirmation');
    assert.equal(h.getExpense().updatedAt.toISOString(), rev0, 'revision unchanged');
  });

  // Advisor S1 (#926 interplay): a question about receipts ALREADY waiting for a signature names the
  // document, so the broad vocabulary matches it — but it asks to read the queue, never to make one.
  it('a question about the signature queue misrouted here is never an explicit start and writes NOTHING', async () => {
    for (const messageText of ['มีใบรับรองแทนใบเสร็จรอฉันเซ็นกี่ใบ', 'ใบรับรองแทนใบเสร็จที่ฉันต้องเซ็นมีกี่ใบ', 'ใบแทนใบเสร็จรออนุมัติกี่ใบคะ']) {
      assert.equal(isSubstituteReceiptConversationText(messageText), true, messageText);
      assert.equal(isSubstituteQueueQuestion(messageText), true, messageText);
      const h = harness();
      const rev0 = h.getExpense().updatedAt.toISOString();
      const r = await h.useCase.execute(ctx(), { messageText, chatKeyHash: 'chat-hash', recentCandidates: [{ id: 'expense-1', label: 'โน้ต · 200' }], requireStartConfirmation: true });
      assert.ok(r.pendingQuestion, `${messageText}: asks before anything opens`);
      assert.equal(h.saves.length, 0, `${messageText}: no workflow write`);
      assert.equal(h.getExpense().updatedAt.toISOString(), rev0, `${messageText}: revision unchanged`);
    }
  });

  it('a real start request is still an explicit start, never a queue question', () => {
    for (const messageText of ['ขอใบรับรองแทนใบเสร็จค่าแท็กซี่', 'ทำใบทดแทนของค่าวิน', 'ออกใบรับรองแทนใบเสร็จค่าวินมอไซต์ 50 บาท', 'ทำใบรับรองเซ็นเองค่าแท็กซี่']) {
      assert.equal(isSubstituteQueueQuestion(messageText), false, messageText);
    }
  });

  it('a confirmedStart overrides requireStartConfirmation and writes exactly once', async () => {
    const h = harness();
    await h.useCase.execute(ctx(), { messageText: 'เรื่องค่าวินเมื่อกี้', chatKeyHash: 'chat-hash', recentCandidates: [{ id: 'expense-1', label: 'โน้ต · 200' }], requireStartConfirmation: true, confirmedStart: true });
    assert.equal(h.saves.length, 1, 'the confirmed start opens the workflow exactly once even under requireStartConfirmation');
  });

  it('forbidden (missing expense.review) writes NOTHING', async () => {
    const h = harness();
    const r = await h.useCase.execute({ ...ctx(), permissions: ['expense.receipt.line_upload'] }, { messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash', recentCandidates: [{ id: 'expense-1', label: 'โน้ต · 200' }] });
    assert.equal(r.status, 'FORBIDDEN');
    assert.equal(h.saves.length, 0);
  });

  it('an ineligible expense (valid receipt → normal path) writes NOTHING on a start attempt', async () => {
    const h = harness({ expense: expense({ sourceDocumentType: 'RECEIPT', vendorNameSnapshot: 'ร้าน' }) });
    const r = await h.useCase.execute(ctx(), { messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash', recentCandidates: [{ id: 'expense-1', label: 'ใบเสร็จ' }] });
    assert.equal(r.status, 'INELIGIBLE');
    assert.equal(h.saves.length, 0);
  });

  it('an ineligible expense cannot be paused/cancelled from LINE — the control writes NOTHING', async () => {
    // Seed a live OPEN workflow directly on a valid-receipt (ineligible) expense, then a pause control must
    // reject at the authoritative eligibility gate BEFORE any save (a stateful control cannot bypass it).
    const h = harness({ expense: expense({ sourceDocumentType: 'RECEIPT', vendorNameSnapshot: 'ร้าน' }) });
    const current = h.getExpense();
    (h.useCase as any).repo.listLineSubstituteContinuationRows = async () => [{
      id: 'expense-1', updatedAt: current.updatedAt,
      sourceChannelMetadataJson: { lineSubstituteReceiptContinuation: {
        workflowId: 'wf-x', kind: 'SUBSTITUTE_RECEIPT', companyId: 'company-1', userId: 'user-1',
        expenseId: 'expense-1', chatKeyHash: 'chat-hash', status: 'OPEN', acceptedValues: {}, provenance: {},
        resolvedFields: [], missingFields: [], attachmentRefs: [], pendingQuestion: null,
        targetRevision: current.updatedAt.toISOString(), lastActivityAt: current.updatedAt.toISOString(),
      } },
    }];
    const r = await h.useCase.execute(ctx(), { messageText: 'ยกเลิกใบรับรองแทนใบเสร็จอันนี้', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(r.status, 'INELIGIBLE');
    assert.equal(h.saves.length, 0, 'the control never bypasses the eligibility gate');
  });

  it('a VAT/definition question on an OPEN workflow writes NOTHING and does not move the revision', async () => {
    const h = await opened();
    const before = h.saves.length; const rev = h.getExpense().updatedAt.toISOString();
    const r = await h.useCase.execute(ctx(), { messageText: 'ใบนี้เคลม VAT ได้ไหม', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.deepEqual(r.acceptedFields, []);
    assert.equal(h.saves.length, before, 'a question writes nothing');
    assert.equal(h.getExpense().updatedAt.toISOString(), rev, 'revision unchanged');
  });

  it('a negation on an OPEN workflow writes NOTHING (and never silently cancels)', async () => {
    const h = await opened();
    const before = h.saves.length;
    for (const msg of ['ยังไม่ทำ', 'ไม่เอาแล้ว']) {
      await h.useCase.execute(ctx(), { messageText: msg, chatKeyHash: 'chat-hash', recentCandidates: [] });
    }
    assert.equal(h.saves.length, before, 'a negation is neither a field nor a control — zero writes');
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.status, 'OPEN', 'still OPEN (cancel is an explicit control only)');
  });

  it('a bare acknowledgement (no field, not a control) on an OPEN workflow writes NOTHING', async () => {
    const h = await opened();
    const before = h.saves.length; const rev = h.getExpense().updatedAt.toISOString();
    await h.useCase.execute(ctx(), { messageText: 'รับทราบครับ', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(h.saves.length, before, 'a no-op turn leaves state untouched');
    assert.equal(h.getExpense().updatedAt.toISOString(), rev, 'revision unchanged');
  });

  it('pause writes exactly once (PAUSED) and advances the revision', async () => {
    const h = await opened();
    const before = h.saves.length; const rev = h.getExpense().updatedAt.toISOString();
    const r = await h.useCase.execute(ctx(), { messageText: 'พักใบรับรองแทนใบเสร็จไว้ก่อน', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(r.status, 'PAUSED');
    assert.equal(h.saves.length, before + 1, 'pause writes exactly once');
    assert.notEqual(h.getExpense().updatedAt.toISOString(), rev, 'the PAUSED transition advances the revision');
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.status, 'PAUSED');
  });

  it('cancel writes exactly once (CANCELLED)', async () => {
    const h = await opened();
    const before = h.saves.length;
    const r = await h.useCase.execute(ctx(), { messageText: 'ยกเลิกใบรับรองแทนใบเสร็จอันนี้', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(r.status, 'CANCELLED');
    assert.equal(h.saves.length, before + 1, 'cancel writes exactly once');
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.status, 'CANCELLED');
  });

  it('a pendingDecision transition persists in EXACTLY ONE CAS write, no field / no status change (P2)', async () => {
    const h = await readyHarness();
    const before = h.saves.length;
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.pendingDecision, 'ISSUE_CONFIRM', 'setup: ready workflow, decision on the table');
    // A persisted state whose decision is stale (cleared) though its fields are complete: the next turn
    // must RE-DERIVE and persist ISSUE_CONFIRM even with no accepted field and no status change — the
    // pendingDecision transition alone participates in the save gate (one CAS write, one revision).
    h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.pendingDecision = undefined;
    const rev = h.getExpense().updatedAt.toISOString();
    await h.useCase.execute(ctx(), { messageText: 'เข้าใจแล้วครับ', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(h.saves.length, before + 1, 'the decision transition is written in exactly one CAS save');
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.pendingDecision, 'ISSUE_CONFIRM', 'the decision is back on the table');
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.status, 'OPEN', 'status unchanged by the decision-only write');
    assert.notEqual(h.getExpense().updatedAt.toISOString(), rev, 'exactly one revision advance');
  });

  it('a no-op on a ready workflow (decision unchanged, no field, no status change) writes NOTHING (P2)', async () => {
    const h = await readyHarness();
    const before = h.saves.length;
    const rev = h.getExpense().updatedAt.toISOString();
    await h.useCase.execute(ctx(), { messageText: 'เข้าใจแล้วครับ', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(h.saves.length, before, 'nothing changed → zero save (reject-before-save preserved)');
    assert.equal(h.getExpense().updatedAt.toISOString(), rev, 'revision unchanged');
  });
});

describe('anchored pause/cancel controls (NFC-safe) — protected corpus phrases + safety negatives', () => {
  it('recognizes the four protected corpus phrases exactly as the runtime controls (Thai + English)', () => {
    assert.equal(isSubstitutePauseControl('พักใบรับรองแทนใบเสร็จไว้ก่อน'), true);
    assert.equal(isSubstitutePauseControl('pause the substitute receipt for now'), true);
    assert.equal(isSubstituteCancelControl('ยกเลิกใบรับรองแทนใบเสร็จอันนี้'), true);
    assert.equal(isSubstituteCancelControl('cancel this substitute receipt'), true);
  });

  it('keeps the exact legacy short controls (no regression)', () => {
    for (const s of ['พัก', 'พักไว้ก่อน', 'ไว้ทำทีหลัง']) assert.equal(isSubstitutePauseControl(s), true, s);
    for (const s of ['ยกเลิก', 'ยกเลิกงานนี้', 'ไม่ทำแล้ว']) assert.equal(isSubstituteCancelControl(s), true, s);
  });

  it('never fires a control on a question, a field answer, or a passing mention', () => {
    for (const s of ['พักผ่อนประจำปี', 'พักงานนี้ได้ไหม', 'ค่าเดินทางไปพักโรงแรม']) assert.equal(isSubstitutePauseControl(s), false, s);
    for (const s of ['ยกเลิกการเดินทาง', 'ยกเลิกได้ไหม', 'เหตุผล: ร้านยกเลิกออเดอร์']) assert.equal(isSubstituteCancelControl(s), false, s);
  });
});

describe('isCanonicalSubstituteStart – anchored explicit-start predicate (NFC-safe)', () => {
  it('accepts canonical explicit-start commands (precomposed Thai ทำ survives normalization)', () => {
    for (const s of ['ทำใบรับรองแทนใบเสร็จ', 'ทำใบรับรองแทนใบเสร็จรับเงิน', 'ขอออกใบรับรองแทนใบเสร็จรับเงิน', 'จัดทำใบรับรองแทนใบเสร็จ', 'ใบรับรองแทนใบเสร็จ']) {
      assert.equal(isCanonicalSubstituteStart(s), true, s);
    }
  });
  it('rejects a paraphrase, a passing mention, a definition question, and a negation', () => {
    for (const s of ['ทำใบทดแทนของค่าวิน', 'ค่าวินไม่มีบิล อยากออกใบรับรองแทน', 'ใบรับรองแทนใบเสร็จคืออะไร', 'ใบรับรองแทนใบเสร็จมี VAT ไหม', 'ยังไม่ทำใบรับรองแทน', 'ไม่เอาใบรับรองแทนใบเสร็จแล้ว']) {
      assert.equal(isCanonicalSubstituteStart(s), false, s);
    }
  });
});

describe('full funding declarations', () => {
  it('a human payer alone never implies the funding source', async () => {
    const h = harness();
    const result = await h.useCase.execute(ctx(), { messageText: 'ทำใบรับรองแทนใบเสร็จ ฉันเป็นผู้จ่าย', chatKeyHash: 'chat-hash', recentCandidates: [{ id: 'expense-1', label: 'ค่าใช้จ่าย' }] });
    assert.ok(result.blockers.some(b => b.code === 'funding_source_required'));
    assert.equal(h.prepares.length, 0);
  });
  for (const text of ['ฉันสำรองจ่ายเต็มจำนวน', 'บริษัทจ่ายเต็มจำนวน']) {
    it(`accepts an explicit full source: ${text}`, async () => {
      const h = harness();
      const result = await h.useCase.execute(ctx(), { messageText: `ทำใบรับรองแทนใบเสร็จ ${text}`, chatKeyHash: 'chat-hash', recentCandidates: [{ id: 'expense-1', label: 'ค่าใช้จ่าย' }] });
      assert.equal(result.blockers.some(b => b.code === 'funding_source_required'), false);
      assert.doesNotMatch(result.replyText, /COMPANY|PERSONAL_ADVANCE|: true/);
    });
  }
  for (const text of ['จ่ายบางส่วน', 'พนักงานสองคนหารจ่าย', 'บริษัทจ่ายเต็มจำนวน ฉันจ่ายเต็มจำนวน']) {
    it(`revokes a prior full declaration when the user corrects it: ${text}`, async () => {
      const h = await readyHarness();
      const result = await h.useCase.execute(ctx(), { messageText: text, chatKeyHash: 'chat-hash', recentCandidates: [] });
      assert.ok(result.blockers.some(b => b.code === 'funding_source_required'));
      assert.equal(h.prepares.length, 0);
    });
  }
});

describe('Fix-up 8A — legal facts boundaries', () => {
  const variants = [
    'ผู้จ่าย บริษัท ผู้รับเงิน คุณเอ อินฟลู เหตุผล ผู้รับเงินไม่ออกใบเสร็จ วัตถุประสงค์ ค่าโปรโมทร้าน จ่ายโอน วันที่ 10 ต.ค. 2569',
    'ผู้จ่าย: บริษัท ผู้รับเงิน: คุณเอ อินฟลู เหตุผล: ผู้รับเงินไม่ออกใบเสร็จ วัตถุประสงค์: ค่าโปรโมทร้าน วิธีจ่าย: โอน วันที่จ่าย: 10 ต.ค. 2569',
    'ผู้จ่าย บริษัท\nผู้รับเงิน คุณเอ อินฟลู\nเหตุผล ผู้รับเงินไม่ออกใบเสร็จ\nวัตถุประสงค์ ค่าโปรโมทร้าน\nจ่ายโอน\nวันที่ 10 ต.ค. 2569',
    'ผู้จ่าย: บริษัท ผู้รับเงิน คุณเอ อินฟลู\nเหตุผล: ผู้รับเงินไม่ออกใบเสร็จ วัตถุประสงค์ ค่าโปรโมทร้าน โอน 10 ต.ค. 2569',
  ];
  for (const [index, messageText] of variants.entries()) {
    it(`parses live facts variant ${index + 1}, echoes the legal text, and asks only for the human certifier`, async () => {
      const h = harness({ expense: expense({ attachments: [{ id: 'slip', purpose: 'expense.payment.evidence', status: 'ACTIVE', mimeType: 'image/jpeg' }] }) });
      await h.useCase.execute(ctx(), { messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash', recentCandidates: [{ id: 'expense-1', label: 'รายการนี้' }] });
      const result = await h.useCase.execute(ctx(), { messageText, chatKeyHash: 'chat-hash', recentCandidates: [] });
      const facts = h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues;
      assert.deepEqual(facts, { fundingSource: 'COMPANY', paidInFullAcknowledged: true, reasonCode: 'PAYEE_CANNOT_ISSUE',
        payeeName: 'คุณเอ อินฟลู', missingReceiptReason: 'ผู้รับเงินไม่ออกใบเสร็จ', businessPurpose: 'ค่าโปรโมทร้าน',
        paymentMethod: 'BANK_TRANSFER', paymentDate: '2026-10-10' });
      assert.deepEqual(result.blockers.map(item => item.code), ['payer_required']);
      assert.match(result.pendingQuestion!, /เลือกผู้รับรองการจ่ายจากปุ่ม/);
      for (const fact of ['คุณเอ อินฟลู', 'ผู้รับเงินไม่ออกใบเสร็จ', 'ค่าโปรโมทร้าน', 'โอนเงิน', '10 ต.ค. 2569', 'บริษัทจ่ายเต็มจำนวน']) assert.ok(result.replyText.includes(fact), fact);
      assert.equal(h.prepares.length, 0, 'facts never prepare or sign');
    });
  }

  it('ends free text at unlabelled date, amount, funding and payment tokens', async () => {
    for (const tail of ['10 ต.ค. 2569 จ่ายโอน', '500 บาท เงินสด', 'บริษัทจ่ายเต็มจำนวน', 'โอน วันที่ 10 ต.ค. 2569']) {
      const h = await readyHarness();
      await h.useCase.execute(ctx(), { messageText: `วัตถุประสงค์ ค่าโปรโมทร้าน ${tail}`, chatKeyHash: 'chat-hash', recentCandidates: [] });
      assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.businessPurpose, 'ค่าโปรโมทร้าน', tail);
    }
  });

  it('reopens only an empty or conflicting legal field instead of signing the old value', async () => {
    for (const messageText of ['วัตถุประสงค์ จ่ายโอน วันที่ 10 ต.ค. 2569', 'วัตถุประสงค์ ค่าโปรโมทร้าน วัตถุประสงค์ ซื้อของ']) {
      const h = await readyHarness();
      const result = await h.useCase.execute(ctx(), { messageText, chatKeyHash: 'chat-hash', recentCandidates: [] });
      assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.businessPurpose, '');
      assert.deepEqual(result.blockers.filter(item => item.collectableInLine).map(item => item.code), ['business_purpose_required']);
      assert.match(result.pendingQuestion!, /ธุรกิจเรื่องอะไร/);
      assert.equal(h.prepares.length, 0);
    }
  });

  it('keeps ambiguous corrections missing across resume, even when old expense facts exist', async () => {
    for (const [messageText, code] of [
      ['ผู้รับเงิน คุณเอ ผู้รับเงิน คุณบี', 'payee_required'],
      ['เหตุผล ร้านไม่ออกใบเสร็จ เหตุผล ใบเสร็จหาย', 'missing_receipt_reason_required'],
      ['วิธีจ่าย เงินสด โอน', 'payment_method_required'],
      ['วันที่จ่าย 10 ต.ค. 2569 หรือ 11 ต.ค. 2569', 'payment_date_required'],
    ]) {
      const h = await readyHarness();
      for (const text of [messageText, 'ทำใบรับรองต่อ']) {
        const result = await h.useCase.execute(ctx(), { messageText: text, chatKeyHash: 'chat-hash', recentCandidates: [] });
        assert.deepEqual(result.blockers.filter(item => item.collectableInLine).map(item => item.code), [code], text);
        assert.equal(h.prepares.length, 0);
      }
    }
  });

  it('requires a fresh facts review before preparing an old continuation with swallowed payment text', async () => {
    const h = await readyHarness();
    h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.businessPurpose = 'ค่าโปรโมทร้าน จ่ายโอน วันที่ 10 ต.ค. 2569 500 บาท';
    const result = await h.useCase.execute(ctx(), { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(h.prepares.length, 0, 'the old decision cannot sign newly split legal text');
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.businessPurpose, 'ค่าโปรโมทร้าน');
    assert.match(result.replyText, /• วัตถุประสงค์ทางธุรกิจ: ค่าโปรโมทร้าน$/mu);
    assert.doesNotMatch(result.replyText, /ค่าโปรโมทร้าน จ่ายโอน/);
  });
});

describe('substitute reply source facts', () => {
  for (const fault of ['unchanged', 'revision', 'evidence', 'attachment', 'categories', 'policy', 'approvers', 'payer', 'signature', 'permission']) {
    it(`retains the producing revision and validates ${fault} without saving or preparing again`, async () => {
      const h = await readyHarness(); const source = h.asked.source;
      assert.ok(source); assert.equal(source.records[0]!.revision, h.getExpense().updatedAt.toISOString());
      assert.equal(await h.useCase.replySourcesCurrent(ctx(), source), true);
      const savedCount = h.saves.length, preparedCount = h.prepares.length;
      if (fault === 'revision') h.getExpense().updatedAt = new Date(h.getExpense().updatedAt.getTime() + 1);
      if (fault === 'evidence') h.issue();
      if (fault === 'attachment') h.getExpense().attachments[0].status = 'DELETED';
      if (fault === 'categories') h.repo.listCategories = async () => [{ id: 'cat-travel', name: 'ชื่อใหม่' }];
      if (fault === 'policy') h.repo.getSubstituteReceiptPolicy = async () => ({ approvalMode: 'DESIGNATED_APPROVERS' });
      if (fault === 'approvers') h.repo.listEligibleSubstituteReceiptApprovers = async () => [];
      if (fault === 'payer') { assert.equal(source.policy!.payerUserId, 'user-1'); h.repo.findActiveMemberIdentity = async () => null; }
      if (fault === 'signature') { assert.equal(source.signatureAvailable, false); h.repo.findReusableSignatureAsset = async () => ({ id: 'new-signature' }); }
      assert.equal(await h.useCase.replySourcesCurrent(fault === 'permission' ? ctx([]) : ctx(), source), fault === 'unchanged');
      assert.equal(h.saves.length, savedCount); assert.equal(h.prepares.length, preparedCount);
    });
  }
  it('binds a prepared document to its returned expense and evidence revisions', async () => {
    const h = await readyHarness({ signature: { id: 'sig-1' } });
    const result = await h.useCase.execute(ctx(), { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(result.status, 'READY_FOR_WEB'); assert.ok(result.source);
    assert.equal(await h.useCase.replySourcesCurrent(ctx(), result.source), true);
    const original = JSON.stringify(result.source); h.issue();
    assert.equal(await h.useCase.replySourcesCurrent(ctx(), result.source), false);
    assert.equal(JSON.stringify(result.source), original); assert.equal(h.prepares.length, 1);
  });
});

describe('Original offered choices take precedence over reordered active workflows', () => {
  for (const firstAlreadyOpen of [true, false]) {
    it(`ordinal one keeps the first original expense when it is ${firstAlreadyOpen ? 'open' : 'fresh'}`, async () => {
      const first = harness(), second = harness({ expense: expense({ id: 'expense-2', expenseNumber: 'EXP-002' }) });
      const start = (h: ReturnType<typeof harness>, id: string) => h.useCase.execute(ctx(), {
        messageText: 'ทำใบรับรองแทนใบเสร็จรับเงิน', chatKeyHash: 'chat-hash', recentCandidates: [{ id, label: id }],
      });
      if (firstAlreadyOpen) await start(first, 'expense-1');
      await start(second, 'expense-2');
      const records = () => [second.getExpense(), first.getExpense()];
      first.repo.listLineSubstituteContinuationRows = async () => records().filter(row => row.sourceChannelMetadataJson.lineSubstituteReceiptContinuation);
      first.repo.findByIdWithRelations = async (_companyId: string, id: string) => records().find(row => row.id === id) ?? null;
      const result = await first.useCase.execute(ctx(), { messageText: '1', confirmedDecision: 'ISSUE', chatKeyHash: 'chat-hash',
        recentCandidates: [{ id: 'expense-1', label: 'รายการแรก' }, { id: 'expense-2', label: 'รายการที่สอง' }],
        boundCandidateExpenseIds: ['expense-1', 'expense-2'] });
      assert.equal(result.expenseId, 'expense-1');
      assert.ok(first.saves.every(row => row.expenseId === 'expense-1'));
      assert.equal(second.saves.length, 1, 'the other workflow is unchanged');
    });
  }
});


describe('exam A: legacy substitute replies preserve current language', () => {
  for (const [messageText, language] of [['Please prepare a substitute receipt', 'en'], ['ทำใบรับรองค่ะ', 'th'], ['ช่วย prepare ใบรับรองค่ะ', 'th']] as const) {
    it(`localizes blocked, target, forbidden, stale and paused replies for ${language}: ${messageText}`, async () => {
      const h = harness({ expense: expense({ vendorNameSnapshot: 'ABC', lines: [{ description: 'Travel', expenseCategoryId: 'cat-travel' }] }), categories: [{ id: 'cat-travel', name: 'Travel' }] });
      const input = { language, messageText, chatKeyHash: 'chat-hash', recentCandidates: [{ id: 'expense-1', label: 'Travel' }], webBaseUrl: WEB_BASE };
      const replies = [await h.useCase.execute(ctx([]), input), await h.useCase.execute(ctx(), { ...input, recentCandidates: [] }), await h.useCase.execute(ctx(), input)];
      const paused = await h.useCase.execute(ctx(), { ...input, recentCandidates: [], messageText: language === 'en' ? 'pause substitute receipt' : 'พัก' });
      replies.push(paused);
      for (const result of replies) {
        const visible = [result.replyText, result.badge, result.pendingQuestion, result.resumeCapsule].filter(Boolean).join('\n');
        if (language === 'en') assert.doesNotMatch(visible, /[\u0E00-\u0E7F]/u); else assert.match(visible, /[\u0E00-\u0E7F]/u);
      }
    });
  }
  it('accepts English labels without asking again for already supplied facts', async () => {
    const h = harness({ expense: expense({ vendorNameSnapshot: 'ABC', attachments: [{ id: 'proof', status: 'ACTIVE', purpose: 'expense.receipt.supporting' }] }), categories: [{ id: 'cat-travel', name: 'Travel' }] });
    const result = await h.useCase.execute(ctx(), { language: 'en', messageText: 'No receipt\nreason: seller cannot issue a receipt\npurpose: customer visit\npayee: ABC\nI am the payer\ncompany paid full amount\npayment method: cash\npayment date: 16 October 2026', chatKeyHash: 'chat-hash', recentCandidates: [{ id: 'expense-1', label: 'Travel' }], webBaseUrl: WEB_BASE });
    assert.ok(result.acceptedFields.includes('businessPurpose'));
    assert.ok(result.acceptedFields.includes('payeeName'));
    assert.doesNotMatch(result.replyText, /[\u0E00-\u0E7F]/u);
    assert.equal(result.blockers.some(item => ['payer_required', 'business_purpose_required', 'payee_required'].includes(item.code)), false);
  });
});
