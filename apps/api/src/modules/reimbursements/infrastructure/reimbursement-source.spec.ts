import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readReimbursementSource, resolveReimbursementSourceLines } from './reimbursement-source';

/**
 * The two capture-lineage rules of appendix §5 that this file owns:
 *   1. payer order — certificate → `expense.payerUserId` → uploader;
 *   2. ambiguity — siblings of the capture group the claim NAMED are not rival readings of the
 *      shared file, while anything outside that group still is (A09/A16).
 *
 * Both stop the fixture at the next gate on purpose (`missing_receipt`, `reimbursement_source_
 * unavailable`): reaching that gate is the proof that the rule under test let the line through,
 * without building a fully claimable expense in a unit spec.
 */
const code = (error: any) => error?.getResponse?.()?.code ?? error?.response?.code;

const expenseRow = (over: Record<string, unknown> = {}) => ({
  id: 'e-1', companyId: 'c1', branchId: 'b1', currency: 'THB', status: 'NEEDS_REVIEW',
  sourceReimbursementRequestId: null, postingStatus: 'not_required', paidAmount: '0', whtAmount: '0',
  inputVatClaimStatus: 'NON_CLAIMABLE', vatMode: 'NO_VAT', taxEvidenceStatus: 'VERIFIED',
  createdByUserId: 'uploader', payerUserId: null, updatedAt: new Date('2026-09-18T00:00:00.000Z'),
  lines: [], ...over,
});

const sourceTx = (expense: Record<string, unknown>) => ({
  expenseRecord: { findFirst: async () => expense },
  expenseSubstituteReceiptEvidence: { findFirst: async () => null },
  attachmentLink: { findMany: async () => [] },
  attachmentObject: { findMany: async () => [] },
});

describe('reimbursement source payer resolution (§5)', () => {
  it('accepts the server-recorded payer even when somebody else uploaded the expense', async () => {
    const tx = sourceTx(expenseRow({ payerUserId: 'payer', createdByUserId: 'uploader' }));
    await assert.rejects(
      () => readReimbursementSource(tx as any, 'c1', 'payer', 'b1', 'THB', 'e-1'),
      (error: any) => code(error) === 'missing_receipt',
    );
  });

  it('still refuses a third party who neither uploaded nor paid', async () => {
    const tx = sourceTx(expenseRow({ payerUserId: 'payer' }));
    await assert.rejects(
      () => readReimbursementSource(tx as any, 'c1', 'someone-else', 'b1', 'THB', 'e-1'),
      (error: any) => code(error) === 'reimbursement_source_wrong_payer',
    );
  });

  it('keeps the uploader claiming their own expense when no payer was recorded', async () => {
    const tx = sourceTx(expenseRow());
    await assert.rejects(
      () => readReimbursementSource(tx as any, 'c1', 'uploader', 'b1', 'THB', 'e-1'),
      (error: any) => code(error) === 'missing_receipt',
    );
  });

  it('lets the certificate keep the last word: its payer is checked before payerUserId', async () => {
    const tx = {
      ...sourceTx(expenseRow({ payerUserId: 'payer' })),
      expenseSubstituteReceiptEvidence: {
        findFirst: async () => ({ fundingSource: 'PERSONAL_ADVANCE', status: 'ISSUED', payerUserId: 'certified-payer' }),
      },
    };
    await assert.rejects(
      () => readReimbursementSource(tx as any, 'c1', 'payer', 'b1', 'THB', 'e-1'),
      (error: any) => code(error) === 'reimbursement_source_wrong_payer',
    );
  });
});

describe('shared-file ambiguity with capture groups (§5)', () => {
  const linesTx = (sources: Array<{ id: string; captureGroupId: string | null }>) => ({
    attachmentObject: { findFirst: async () => ({ id: 'att-1', branchId: 'b1', uploadedByUserId: 'uploader', checksumSha256: 'sha', originalFileName: 'bill.pdf' }) },
    attachmentLink: { findMany: async () => sources.map((source) => ({ targetId: source.id })) },
    expenseRecord: { findMany: async () => sources, findFirst: async () => null },
  });

  const line = (over: Record<string, unknown> = {}) => [{
    lineNo: 1, incurredDate: '2026-09-18', amount: '100', attachmentId: 'att-1', ...over,
  }];

  it('accepts a named derived source whose siblings share the file by design', async () => {
    const tx = linesTx([
      { id: 'e-1', captureGroupId: 'g-1' },
      { id: 'e-2', captureGroupId: 'g-1' },
    ]);
    await assert.rejects(
      () => resolveReimbursementSourceLines(tx as any, 'c1', 'uploader', 'b1', 'THB', line({ linkedExpenseId: 'e-1' })),
      // Past the ambiguity gate: the next stop is reading the named expense itself.
      (error: any) => code(error) === 'reimbursement_source_unavailable',
    );
  });

  it('still refuses when an expense OUTSIDE the named group shares the same file', async () => {
    const tx = linesTx([
      { id: 'e-1', captureGroupId: 'g-1' },
      { id: 'e-9', captureGroupId: null },
    ]);
    await assert.rejects(
      () => resolveReimbursementSourceLines(tx as any, 'c1', 'uploader', 'b1', 'THB', line({ linkedExpenseId: 'e-1' })),
      (error: any) => code(error) === 'reimbursement_source_ambiguous',
    );
  });

  it('still refuses when a second capture group reuses the same file', async () => {
    const tx = linesTx([
      { id: 'e-1', captureGroupId: 'g-1' },
      { id: 'e-2', captureGroupId: 'g-2' },
    ]);
    await assert.rejects(
      () => resolveReimbursementSourceLines(tx as any, 'c1', 'uploader', 'b1', 'THB', line({ linkedExpenseId: 'e-1' })),
      (error: any) => code(error) === 'reimbursement_source_ambiguous',
    );
  });

  it('leaves the no-linkedExpenseId behaviour exactly as it was: two sources are ambiguous', async () => {
    const tx = linesTx([
      { id: 'e-1', captureGroupId: 'g-1' },
      { id: 'e-2', captureGroupId: 'g-1' },
    ]);
    await assert.rejects(
      () => resolveReimbursementSourceLines(tx as any, 'c1', 'uploader', 'b1', 'THB', line()),
      (error: any) => code(error) === 'reimbursement_source_ambiguous',
    );
  });

  it('resolves a single source without a link, as before', async () => {
    const tx = linesTx([{ id: 'e-1', captureGroupId: null }]);
    await assert.rejects(
      () => resolveReimbursementSourceLines(tx as any, 'c1', 'uploader', 'b1', 'THB', line()),
      (error: any) => code(error) === 'reimbursement_source_unavailable',
    );
  });
});
