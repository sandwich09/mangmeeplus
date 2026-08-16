import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { PrismaExpenseRepository } from './prisma-expense.repository';

describe('PrismaExpenseRepository delivered LINE receipt continuation', () => {
  it('stores only bounded references and advances an active substitute workflow in one revision', async () => {
    const updatedAt = new Date('2026-08-16T01:00:00.000Z');
    const tx: any = {
      $executeRaw: mock.fn(async () => undefined),
      expenseRecord: {
        findFirst: mock.fn(async () => ({
          status: 'NEEDS_REVIEW', substituteReceiptEvidences: [],
          updatedAt,
          aiVerificationSummaryJson: { status: 'OCR_EXTRACTED_NEEDS_REVIEW', rawText: 'must-not-copy' },
          sourceChannelMetadataJson: {
            channel: 'LINE', chatKeyHash: 'chat-hash',
            lineSubstituteReceiptContinuation: {
              kind: 'SUBSTITUTE_RECEIPT', workflowId: 'workflow-1', expenseId: 'expense-1',
              userId: 'user-1', status: 'OPEN', targetRevision: updatedAt.toISOString(),
            },
          },
        })),
        updateMany: mock.fn(async () => ({ count: 1 })),
      },
    };
    const repo = new PrismaExpenseRepository(
      { client: { $transaction: async (run: (db: any) => unknown) => run(tx) } } as any,
      {} as any,
    );

    await repo.recordDeliveredLineReceiptContinuation({
      companyId: 'company-1', expenseId: 'expense-1', userId: 'user-1',
      chatKeyHash: 'chat-hash', deliveredOutcomeId: 'hashed-outcome', scopes: { branchIds: ['branch-1'] },
    });

    const find = tx.expenseRecord.findFirst.mock.calls[0]?.arguments[0];
    assert.match(JSON.stringify(find.where), /branch-1/);
    const update = tx.expenseRecord.updateMany.mock.calls[0]?.arguments[0];
    const metadata = update.data.sourceChannelMetadataJson;
    assert.deepEqual(metadata.lineReceiptContinuation, {
      kind: 'CAPTURED_EXPENSE', expenseId: 'expense-1', userId: 'user-1', chatKeyHash: 'chat-hash',
      deliveredOutcomeId: 'hashed-outcome', sourceRevision: updatedAt.toISOString(),
      lastActivityAt: update.data.updatedAt.toISOString(), verificationSummaryPresent: true,
    });
    assert.equal(JSON.stringify(metadata).includes('must-not-copy'), false);
    assert.equal(metadata.lineSubstituteReceiptContinuation.targetRevision, update.data.updatedAt.toISOString());

    const writesBeforeRedelivery = tx.expenseRecord.updateMany.mock.callCount();
    tx.expenseRecord.findFirst.mock.mockImplementation(async () => ({
      status: 'NEEDS_REVIEW', updatedAt: update.data.updatedAt,
      sourceChannelMetadataJson: metadata, aiVerificationSummaryJson: {},
      substituteReceiptEvidences: [{ id: 'prepared-evidence-1' }],
    }));
    await repo.recordDeliveredLineReceiptContinuation({
      companyId: 'company-1', expenseId: 'expense-1', userId: 'user-1',
      chatKeyHash: 'chat-hash', deliveredOutcomeId: 'redelivered', scopes: { branchIds: ['branch-1'] },
    });
    assert.equal(tx.expenseRecord.updateMany.mock.callCount(), writesBeforeRedelivery,
      'a media redelivery must not stale an existing PREPARED/certified substitute receipt');
  });
});
