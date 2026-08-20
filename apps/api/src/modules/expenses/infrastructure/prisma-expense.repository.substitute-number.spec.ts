import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { civilDate, civilPeriodKey } from '@watchdog-bms/contracts';
import { PrismaExpenseRepository } from './prisma-expense.repository';

const UPDATED_AT = new Date('2026-08-10T01:00:00.000Z');

function preparedInput() {
  return {
    companyId: 'company-1',
    expenseId: 'expense-secret-cuid',
    branchId: null,
    expectedExpenseUpdatedAt: UPDATED_AT,
    originalSourceDocumentType: 'EXPENSE_NOTE_TEXT',
    reasonCode: 'RECEIPT_UNAVAILABLE',
    missingReceiptReason: 'ผู้ขายไม่ออกใบเสร็จ',
    businessPurpose: 'ค่าเดินทาง',
    paymentEvidenceAttachmentIds: [],
    supportingAttachmentIds: [],
    paymentDate: null,
    paymentMethod: 'CASH',
    note: null,
    payerUserId: 'payer-1',
    payerName: 'ผู้จ่าย',
    payeeName: 'ผู้รับเงิน',
    payeeAddress: null,
    payeeTaxId: null,
    preparedByUserId: 'preparer-1',
    preparedFromChannel: 'WEB' as const,
    idempotencyKey: 'prepare-1',
  };
}

function makeRepo(existing: Record<string, any> | null = null, sourceChannelMetadataJson: Record<string, unknown> | null = null) {
  const tx: any = {
    $executeRaw: mock.fn(async () => undefined),
    expenseRecord: {
      findFirst: mock.fn(async () => ({
        id: 'expense-secret-cuid', companyId: 'company-1', expenseNumber: null,
        status: 'NEEDS_REVIEW', updatedAt: UPDATED_AT,
        sourceChannelMetadataJson,
      })),
      updateMany: mock.fn(async () => ({ count: 1 })),
      findFirstOrThrow: mock.fn(async () => ({ id: 'expense-secret-cuid', updatedAt: UPDATED_AT })),
    },
    expenseSubstituteReceiptEvidence: {
      findFirst: mock.fn(async (args: any) => {
        if (args.where.idempotencyKey) return existing;
        return null;
      }),
      updateMany: mock.fn(async () => ({ count: 0 })),
      create: mock.fn(async (args: any) => ({
        id: 'evidence-1', status: 'PREPARED', createdAt: UPDATED_AT, updatedAt: UPDATED_AT,
        ...args.data,
      })),
    },
  };
  const client = { $transaction: mock.fn(async (fn: (db: any) => unknown) => fn(tx)) };
  const reserveNumberInTransaction = mock.fn(async () => ({
    id: 'number-1', documentNumber: 'SRC-202608-00001', status: 'RESERVED',
  }));
  const commitNumberInTransaction = mock.fn(async () => ({
    id: 'number-1', documentNumber: 'SRC-202608-00001', status: 'COMMITTED',
  }));
  const repo = new PrismaExpenseRepository(
    { client } as any,
    { reserveNumberInTransaction, commitNumberInTransaction } as any,
  );
  return { repo, tx, reserveNumberInTransaction, commitNumberInTransaction };
}

describe('PrismaExpenseRepository substitute-receipt numbers', () => {
  it('reserves and commits a company running number in the evidence transaction', async () => {
    const { repo, tx, reserveNumberInTransaction, commitNumberInTransaction } = makeRepo();

    const result = await repo.createPreparedSubstituteEvidence(preparedInput());

    assert.equal(result.documentNumber, 'SRC-202608-00001');
    assert.doesNotMatch(result.documentNumber, /expense-secret-cuid/);
    assert.deepEqual(reserveNumberInTransaction.mock.calls[0]?.arguments, [tx, {
      companyId: 'company-1',
      branchId: undefined,
      documentType: 'expense.substitute_receipt',
      periodKey: civilPeriodKey(civilDate(new Date())),
      idempotencyKey: 'expense-secret-cuid:prepare-1',
      reservedByUserId: 'preparer-1',
    }]);
    assert.deepEqual(commitNumberInTransaction.mock.calls[0]?.arguments, [tx, {
      id: 'number-1',
      companyId: 'company-1',
      ownerType: 'expense_substitute_receipt',
      ownerId: 'evidence-1',
    }]);
  });

  it('returns an idempotent retry without consuming another number', async () => {
    const input = preparedInput();
    const existing = {
      id: 'evidence-1', status: 'PREPARED', version: 1, documentNumber: 'SRC-202608-00001',
      companyId: input.companyId, expenseId: input.expenseId, branchId: input.branchId,
      reasonCode: input.reasonCode, missingReceiptReason: input.missingReceiptReason,
      businessPurpose: input.businessPurpose, payerUserId: input.payerUserId,
      payerName: input.payerName, payeeName: input.payeeName, payeeAddress: input.payeeAddress,
      payeeTaxId: input.payeeTaxId, originalSourceDocumentType: input.originalSourceDocumentType,
      paymentDate: input.paymentDate, paymentMethod: input.paymentMethod, note: input.note,
      paymentEvidenceAttachmentIds: [], supportingAttachmentIds: [], updatedAt: UPDATED_AT,
    };
    const { repo, reserveNumberInTransaction, commitNumberInTransaction } = makeRepo(existing);

    const result = await repo.createPreparedSubstituteEvidence(input);

    assert.equal(result.documentNumber, 'SRC-202608-00001');
    assert.equal(reserveNumberInTransaction.mock.callCount(), 0);
    assert.equal(commitNumberInTransaction.mock.callCount(), 0);
  });

  it('consumes a matching LINE continuation in the same expense revision used by PREPARED evidence', async () => {
    const state = {
      workflowId: 'workflow-1', kind: 'SUBSTITUTE_RECEIPT', companyId: 'company-1',
      userId: 'preparer-1', expenseId: 'expense-secret-cuid', status: 'OPEN',
      targetRevision: UPDATED_AT.toISOString(),
    };
    const { repo, tx } = makeRepo(null, { lineSubstituteReceiptContinuation: state, keep: 'safe' });

    await repo.createPreparedSubstituteEvidence({
      ...preparedInput(),
      lineContinuation: { workflowId: 'workflow-1', userId: 'preparer-1' },
    });

    const update = tx.expenseRecord.updateMany.mock.calls[0]?.arguments[0];
    assert.equal(update.data.sourceChannelMetadataJson.keep, 'safe');
    assert.equal(update.data.sourceChannelMetadataJson.lineSubstituteReceiptContinuation.status, 'CONSUMED');
    assert.equal(update.data.sourceChannelMetadataJson.lineSubstituteReceiptContinuation.targetRevision, update.data.updatedAt.toISOString());
  });
});
