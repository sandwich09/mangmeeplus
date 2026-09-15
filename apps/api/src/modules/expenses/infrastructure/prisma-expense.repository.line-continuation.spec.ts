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
          status: 'DRAFT', substituteReceiptEvidences: [],
          updatedAt,
          aiVerificationSummaryJson: { status: 'OCR_EXTRACTED_NEEDS_REVIEW', rawText: 'must-not-copy' },
          sourceChannelMetadataJson: {
            channel: 'LINE', chatKeyHash: 'chat-hash',
            lineSubstituteReceiptContinuation: {
              kind: 'SUBSTITUTE_RECEIPT', workflowId: 'workflow-1', expenseId: 'expense-1',
              userId: 'user-1', status: 'OPEN', targetRevision: updatedAt.toISOString(),
            },
            lineExpenseDraftContinuation: {
              schemaVersion: 1, kind: 'EXPENSE_DRAFT_COLLECTION', workflowId: 'expense-workflow-1',
              expenseId: 'expense-1', userId: 'user-1', chatKeyHash: 'chat-hash', status: 'OPEN',
              targetRevision: updatedAt.toISOString(),
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
    assert.equal(metadata.lineExpenseDraftContinuation.targetRevision, update.data.updatedAt.toISOString());

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

  it('does not rebase an expense draft whose target revision was already stale', async () => {
    const updatedAt = new Date('2026-08-16T02:00:00.000Z');
    const staleRevision = '2026-08-16T01:00:00.000Z';
    const tx: any = {
      $executeRaw: mock.fn(async () => undefined),
      expenseRecord: {
        findFirst: mock.fn(async () => ({
          status: 'DRAFT', updatedAt, substituteReceiptEvidences: [], aiVerificationSummaryJson: {},
          sourceChannelMetadataJson: {
            channel: 'LINE', chatKeyHash: 'chat-hash',
            lineExpenseDraftContinuation: {
              kind: 'EXPENSE_DRAFT_COLLECTION', expenseId: 'expense-1', userId: 'user-1',
              chatKeyHash: 'chat-hash', status: 'OPEN', targetRevision: staleRevision,
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
      chatKeyHash: 'chat-hash', deliveredOutcomeId: 'hashed-outcome', scopes: {},
    });

    const metadata = tx.expenseRecord.updateMany.mock.calls[0]?.arguments[0].data.sourceChannelMetadataJson;
    assert.equal(metadata.lineExpenseDraftContinuation.targetRevision, staleRevision);
  });
});

/** B3: `listLineSubstituteContinuationRows` used to filter the chat in JS AFTER `take`, so a user
 *  holding more than `take` substitute drafts company-wide lost older CHATS out of the window
 *  entirely. The caller reads an empty result as "no workflow here" and mints a fresh, empty state
 *  over the one that still held every collected answer. This fake applies the `where` first, exactly
 *  as Postgres does, so the test fails the moment the chat filter leaves SQL again. */
describe('PrismaExpenseRepository line substitute continuation window', () => {
  function jsonPath(row: any, path: string[]): unknown {
    return path.reduce<any>((value, key) => (value == null ? value : value[key]), row.sourceChannelMetadataJson);
  }

  function matches(row: any, where: any): boolean {
    return (where.AND ?? []).every((clause: any) => {
      const filter = clause.sourceChannelMetadataJson;
      return jsonPath(row, filter.path) === filter.equals;
    }) && (!where.companyId || row.companyId === where.companyId);
  }

  function repoWith(rows: any[]) {
    const calls: any[] = [];
    const client = {
      expenseRecord: {
        findMany: async (args: any) => {
          calls.push(args);
          return rows
            .filter((row) => matches(row, args.where))
            .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
            .slice(0, args.take);
        },
      },
    };
    return { repo: new PrismaExpenseRepository({ client } as any, {} as any), calls };
  }

  function draft(id: string, chatKeyHash: string, minute: number, acceptedValues: Record<string, unknown> = {}) {
    return {
      id, companyId: 'company-1', updatedAt: new Date(Date.UTC(2026, 7, 16, 1, minute)),
      sourceChannelMetadataJson: {
        channel: 'LINE', chatKeyHash,
        lineSubstituteReceiptContinuation: {
          kind: 'SUBSTITUTE_RECEIPT', workflowId: `workflow-${id}`, expenseId: id, companyId: 'company-1',
          userId: 'user-1', chatKeyHash, status: 'OPEN', acceptedValues, provenance: {},
          targetRevision: new Date(Date.UTC(2026, 7, 16, 1, minute)).toISOString(),
        },
      },
    };
  }

  it('keeps an older chat’s workflow — with its values — inside the window past `take`', async () => {
    const older = draft('expense-old', 'chat-b', 1, { businessPurpose: 'ไปพบลูกค้า', payerUserId: 'user-1' });
    const rows = [
      // Six newer drafts in a DIFFERENT chat: more than the default take of 5.
      ...[10, 11, 12, 13, 14, 15].map((minute, index) => draft(`expense-new-${index}`, 'chat-a', minute)),
      older,
    ];
    const { repo, calls } = repoWith(rows);

    const found = await repo.listLineSubstituteContinuationRows({
      companyId: 'company-1', userId: 'user-1', chatKeyHash: 'chat-b', scopes: {},
    });

    assert.deepEqual(found.map((row) => row.id), ['expense-old'], 'the older chat is still resumable');
    assert.deepEqual(
      (found[0]!.sourceChannelMetadataJson as any).lineSubstituteReceiptContinuation.acceptedValues,
      { businessPurpose: 'ไปพบลูกค้า', payerUserId: 'user-1' },
      'and it still carries what the sender already answered',
    );
    assert.match(
      JSON.stringify(calls[0].where),
      /lineSubstituteReceiptContinuation","chatKeyHash"\],"equals":"chat-b"/,
      'the chat filter runs in SQL, so `take` bounds the right set',
    );
  });

  it('still returns the busy chat’s own newest drafts, bounded by take', async () => {
    const rows = [10, 11, 12, 13, 14, 15].map((minute, index) => draft(`expense-new-${index}`, 'chat-a', minute));
    const { repo } = repoWith(rows);

    const found = await repo.listLineSubstituteContinuationRows({
      companyId: 'company-1', userId: 'user-1', chatKeyHash: 'chat-a', scopes: {},
    });

    assert.equal(found.length, 5);
    assert.equal(found[0]!.id, 'expense-new-5', 'newest first, unchanged');
  });
});

describe('recent LINE receipt status discovery', () => {
  it('includes finalized states only for read-only status and keeps actor/chat/tenant/branch filters in SQL', async () => {
    const queries: any[] = [];
    const repo = new PrismaExpenseRepository({ client: { expenseRecord: { findMany: async (query: any) => { queries.push(query); return []; } } } } as any);
    const input = { companyId: 'co-1', createdByUserId: 'user-1', chatKeyHash: 'chat-1', since: new Date(), scopes: { branchIds: ['branch-1'] }, take: 5 };
    await repo.listRecentLineCaptures(input);
    await repo.listRecentLineCaptures({ ...input, includeAllStatuses: true });
    assert.deepEqual(queries[0].where.status.in, ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION']);
    assert.equal(queries[1].where.status, undefined);
    const { status: _status, ...correctionWhere } = queries[0].where;
    assert.deepEqual(queries[1].where, correctionWhere);
    assert.equal(correctionWhere.companyId, 'co-1');
    assert.equal(correctionWhere.createdByUserId, 'user-1');
    assert.deepEqual(correctionWhere.sourceChannelMetadataJson, { path: ['chatKeyHash'], equals: 'chat-1' });
    assert.match(JSON.stringify(correctionWhere), /branch-1/);
    assert.equal(queries[1].take, 5);
    assert.deepEqual(queries[0].orderBy, [{ createdAt: 'desc' }, { id: 'desc' }], 'same-timestamp receipts keep a stable offered order');
    await repo.listRecentLineCaptures({ ...input, includeAllStatuses: true, scopes: { branchIds: [] } });
    assert.deepEqual(queries[2].where.OR, [{ branchId: { in: [] } }, { branchId: null }], 'empty scope retains only existing company-central visibility');
  });
});
