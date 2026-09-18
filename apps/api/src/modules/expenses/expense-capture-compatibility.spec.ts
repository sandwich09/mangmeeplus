/**
 * W08 — compatibility, disable-intake and rollback (spec A01/A38/A39/A47, gap IG03/IG13).
 *
 * The claim under test is not "the new feature works". It is the opposite: that a binary, a client
 * or a raw HTTP caller that knows nothing about capture groups behaves EXACTLY as it did before the
 * feature existed, and that turning intake off stops new evidence without stranding the work that
 * is already in the system.
 *
 * Proven here, because each one needs only the decision it is about:
 * - the ONE intake gate, and the allowed-action list it changes (A47);
 * - a raw API call that points `confirm`, `record payment` or a reimbursement claim at a capture
 *   GROUP id (A38 "ไม่ลดรูปเป็น ordinary expense แล้ว confirm/pay/claim");
 * - the legacy consumers of a derived source — accountant export and ledger auto-post — producing
 *   exactly one row / one posting source each, with the group in none of them (A39/IG03).
 *
 * Proven NEXT TO ITS HARNESS, deliberately, rather than duplicating 200 lines of fakes here:
 * - the flag-off matrix over the real use cases (create / add file / convert refuse; read, complete,
 *   detach, close and read-status still answer) — `expense-capture-group.use-case.spec.ts`
 *   ("refuses a new file with the intake flag off but still completes, detaches and closes (A47)");
 * - handoff of a group that already holds its evidence, with intake off —
 *   `expense-capture-handoff.use-case.spec.ts` ("hands off with intake closed (A47)");
 * - the legacy `complete` call writing byte-for-byte what it wrote before §16.4 existed —
 *   `expense-upload.use-case.spec.ts` ("a completion with no intent writes exactly the legacy row");
 * - an image extraction never entering the capture lane — `expense-extraction.use-case.spec.ts`
 *   ("leaves the image lane on the synchronous path");
 * - list / dashboard count / LINE recent lane counting a derived source once and the group never,
 *   against real PostgreSQL — `expense-capture-handoff.pg.spec.ts`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExpenseCaptureAccessService } from './application/use-cases/expense-capture-group.use-case';
import { captureGroupAllowedActions } from './domain/logic/expense-capture.logic';
import { buildAccountantIndexRow, captureGroupRef, evidenceRef } from './domain/logic/expense-export.logic';
import { expenseAutoPostBlockers, nextExpensePostingSource } from './domain/logic/expense-auto-post.logic';
import { RecordExpensePaymentUseCase, ConfirmExpenseUseCase } from './application/use-cases/expense-draft.use-case';
import { readReimbursementSource } from '../reimbursements/infrastructure/reimbursement-source';

const GROUP_ID = 'capture-group-1';
const SOURCE_ID = 'derived-source-1';

const ctx = (permissions: string[]) => ({
  companyId: 'company-1', userId: 'user-1', requestId: 'req-1', permissions, scopes: {},
}) as never;

describe('A47 / IG13 — one intake gate, and what it does NOT close', () => {
  const access = (intakeEnabled: boolean) =>
    new ExpenseCaptureAccessService({} as never, { expenseCaptureGroupIntakeEnabled: intakeEnabled } as never);

  it('refuses new evidence with the shared entitlement code, and passes straight through when open', () => {
    assert.equal(access(true).assertIntakeOpen(), undefined);
    assert.throws(() => access(false).assertIntakeOpen(), (error: any) =>
      error.getStatus() === 403 && error.getResponse().code === 'feature_temporarily_unavailable');
  });

  /**
   * A47: "หยุด intake ตาม capability แต่ยังอ่าน/กู้คืน/ทำ correction ตามสิทธิ". The flag may remove
   * exactly one action from a group that already exists. Everything a customer needs to finish or
   * abandon the work in front of them survives it.
   */
  it('removes only `add_file` from a group that already holds evidence', () => {
    const state = {
      status: 'OPEN' as const, handoffState: 'NONE' as const, storedFiles: 2, readingFiles: 0,
      hasFacts: true, canMutate: true,
      allocation: { status: 'ACCEPTED' as const, outcome: 'READY' as const, blockers: [] },
    };
    const open = captureGroupAllowedActions({ ...state, intakeEnabled: true });
    const closed = captureGroupAllowedActions({ ...state, intakeEnabled: false });

    assert.deepEqual(open, ['add_file', 'detach_file', 'review', 'handoff', 'close']);
    assert.deepEqual(closed, ['detach_file', 'review', 'handoff', 'close'],
      'detach, review, handoff and close are how in-flight work ends; intake off must not strand it');
  });
});

describe('A38 — a raw caller cannot reduce a capture group to an ordinary expense', () => {
  /** Only `ExpenseRecord` ids exist in this table. A group id is simply not one of them. */
  const found = (expenseId: string) => expenseId === SOURCE_ID
    ? { id: SOURCE_ID, companyId: 'company-1', branchId: null, status: 'NEEDS_REVIEW', updatedAt: new Date() }
    : null;
  const repo = {
    findById: async (_companyId: string, expenseId: string) => found(expenseId),
    findByIdWithRelations: async (_companyId: string, expenseId: string) => found(expenseId),
  } as never;
  const audit = { log: async () => undefined } as never;

  it('answers 404 when a payment is recorded against a group id', async () => {
    const useCase = new RecordExpensePaymentUseCase(repo, audit);
    await assert.rejects(
      () => useCase.execute(ctx(['expense.payment.record']), GROUP_ID, { amount: '100', paidAt: '2026-09-19' } as never),
      (error: any) => error.getStatus() === 404,
    );
    // …and the derived source it produced is an ordinary expense that gets past the same lookup.
    await assert.rejects(
      () => useCase.execute(ctx(['expense.payment.record']), SOURCE_ID, { amount: '100', paidAt: '2026-09-19' } as never),
      (error: any) => error.getStatus() !== 404, 'the derived source is found, and refused on its own merits',
    );
  });

  it('answers 404 when a confirmation is pointed at a group id', async () => {
    const useCase = new ConfirmExpenseUseCase(repo, audit, {} as never, {} as never);
    await assert.rejects(
      () => useCase.execute(ctx(['expense.confirm', 'expense.review']), GROUP_ID),
      (error: any) => error.getStatus() === 404,
    );
  });

  it('refuses a reimbursement claim that names a group id as its source', async () => {
    const tx = { expenseRecord: { findFirst: async ({ where }: any) => where.id === SOURCE_ID ? { id: SOURCE_ID } : null } } as never;
    await assert.rejects(
      () => readReimbursementSource(tx, 'company-1', 'user-1', 'branch-1', 'THB', GROUP_ID),
      (error: any) => error.getResponse().code === 'reimbursement_source_unavailable',
    );
  });
});

describe('A39 / IG03 — legacy consumers see one derived source and never the group', () => {
  const source = {
    companyName: 'บริษัททดสอบ', companyTaxId: null, branchCode: null,
    expenseId: SOURCE_ID, expenseNumber: 'EXP-0001', status: 'CONFIRMED', captureSource: 'LINE_UPLOAD',
    sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'SUPPORTING_ONLY', taxEvidenceReasonCode: null,
    postingStatus: 'pending', postingError: null, journalEntryNumber: null,
    uploadedAt: '2026-09-19T00:00:00.000Z', expenseDate: '2026-09-18',
    requesterName: null, uploaderName: null, reviewerName: null,
    vendorNameSnapshot: 'ร้านค้า', vendorTaxIdSnapshot: null, vendorBranchCodeSnapshot: null, vendorDocumentNumber: null,
    categoryName: null, accountHintKey: null, description: null, quantity: null,
    subtotalAmount: '810.0000', additionalChargesAmount: '0.0000', discountAmount: '0.0000',
    taxableAmount: '810.0000', vatAmount: '0.0000', whtAmount: '0.0000',
    grandTotalAmount: '810.0000', netPayableAmount: '810.0000', paidAmount: '0.0000', outstandingAmount: '810.0000',
    currency: 'THB', primaryAttachmentId: 'att-0000000012345678', webUrl: '/x', notes: null,
    attachments: [{ id: 'att-0000000012345678', purpose: 'expense.receipt.primary' }],
    aiVerificationSummaryJson: null,
  } as never;

  it('builds exactly one accountant index row, whose evidence ref names the group instead of adding a row', () => {
    const derived = buildAccountantIndexRow({ ...(source as object), captureGroupId: GROUP_ID } as never);
    const ordinary = buildAccountantIndexRow({ ...(source as object), captureGroupId: null } as never);

    assert.equal(typeof derived, 'object', 'one source, one row');
    assert.equal(derived.primary_evidence_ref, evidenceRef('EXP-0001', SOURCE_ID, 'att-0000000012345678', GROUP_ID));
    assert.ok(derived.primary_evidence_ref.endsWith(`-${captureGroupRef(GROUP_ID)}`), 'the group rides IN the ref');
    assert.equal(derived.supporting_evidence_refs, '', 'one file, one ref — no second row for the group');
    // The column values an accounting office reconciles are byte-identical: the lineage adds a
    // suffix to one key and changes nothing else (A01 — "ไม่มีหน้าหรือคำถามเพิ่มที่ไม่จำเป็น").
    const { primary_evidence_ref: _derivedRef, ...derivedRest } = derived as Record<string, unknown>;
    const { primary_evidence_ref: _ordinaryRef, ...ordinaryRest } = ordinary as Record<string, unknown>;
    assert.deepEqual(derivedRest, ordinaryRest);
  });

  it('gives a derived source exactly one posting source, decided by the same rules as any expense', () => {
    const derived = { expenseId: SOURCE_ID, sourceReimbursementRequestId: null, accrualPosted: false };
    assert.deepEqual(nextExpensePostingSource(derived), { sourceType: 'expense.record', sourceId: SOURCE_ID });
    // Posted once, nothing further to post: the group is never a second source for the same money.
    assert.equal(nextExpensePostingSource({ ...derived, accrualPosted: true }), null);
    assert.deepEqual(
      expenseAutoPostBlockers({ activeEvidenceCount: 1, taxEvidenceStatus: 'SUPPORTING_ONLY', vendorNameSnapshot: 'ร้านค้า' }),
      [], 'a derived source auto-posts on the same three conditions as an ordinary one',
    );
  });
});
