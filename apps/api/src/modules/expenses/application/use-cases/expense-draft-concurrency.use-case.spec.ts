import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { expenseHistoryChanges, readExpenseHistoryChanges } from '../../domain/logic/expense-history.logic';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { UpdateExpenseDraftUseCase } from './expense-draft.use-case';

const VERSION = '2026-08-09T12:00:00.000Z';
const TX = Symbol('draft-update-tx');

const ctx = {
  requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
  membershipId: 'member-1', roles: [], permissions: ['expense.update'], scopes: {}, authProvider: 'watchdog',
} as any;

const record = {
  id: 'expense-1', companyId: 'company-1', branchId: null, createdByUserId: 'user-1', status: 'DRAFT',
  sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'NEEDS_REVIEW', inputVatClaimStatus: 'NEEDS_REVIEW',
  vatMode: 'NO_VAT', currency: 'THB', expenseDate: new Date('2026-08-09T00:00:00.000Z'),
  grandTotalAmount: '100.0000', aiVerificationSummaryJson: null, updatedAt: new Date(VERSION),
};

const audit = { log: async () => undefined } as any;

describe('UpdateExpenseDraftUseCase optimistic concurrency', () => {
  it('requires the loaded version on interactive routes before any mutation', async () => {
    let updated = false;
    const repo = {
      findById: async () => record,
      updateExpense: async () => { updated = true; return record; },
    } as any;
    const useCase = new UpdateExpenseDraftUseCase(repo, audit, { resolveLines: async () => [] } as any);

    await assert.rejects(
      () => useCase.execute(ctx, record.id, { note: 'stale save' }, { requireExpectedUpdatedAt: true }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal((error.getResponse() as any).code, 'EXPENSE_UPDATE_VERSION_REQUIRED');
        return true;
      },
    );
    assert.equal(updated, false);
  });

  it('persists replacement lines only inside the header CAS transaction', async () => {
    const events: string[] = [];
    const repo = {
      findById: async () => record,
      updateExpense: async (input: any, withinTx?: (tx: unknown) => Promise<void>) => {
        events.push('header.cas');
        assert.equal(input.expectedUpdatedAt.toISOString(), VERSION);
        await withinTx?.(TX);
        return { ...record, ...input };
      },
      // §5.1: an omitted chargeKind on a replacement PATCH keeps the stored one, so the
      // update path reads them back before it validates.
      listLineChargeKinds: async () => new Map<number, { chargeKind: string | null; description: string }>(),
      upsertLines: async (_companyId: string, _expenseId: string, lines: any[], db: unknown) => {
        events.push('lines.upsert');
        assert.equal(db, TX);
        assert.equal(lines.length, 1);
      },
    } as any;
    const transactionTax = { resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => lines } as any;
    const useCase = new UpdateExpenseDraftUseCase(repo, audit, transactionTax);

    await useCase.execute(ctx, record.id, {
      expectedUpdatedAt: VERSION,
      lines: [{ lineNumber: 1, description: 'ค่าใช้จ่าย', quantity: '1', unitPrice: '100' }],
    }, { requireExpectedUpdatedAt: true });

    assert.deepEqual(events, ['header.cas', 'lines.upsert']);
  });
});

describe('UpdateExpenseDraftUseCase LINE draft collection authority', () => {
  const continuation = {
    sourceChannelMetadataJson: { lineExpenseDraftContinuation: { status: 'COLLECTING' } },
    aiVerificationSummaryJson: { lineExpenseDraftConversation: { status: 'COLLECTING' } },
    nextUpdatedAt: new Date('2026-08-09T12:00:00.001Z'),
  };
  const lineRecord = { ...record, captureSource: 'LINE_UPLOAD' };
  const lineCtx = {
    ...ctx,
    authProvider: 'line',
    permissions: ['expense.receipt.line_upload'],
  } as any;

  it('lets the originating LINE user persist source facts and continuation state together', async () => {
    let persisted: any;
    const events: string[] = [];
    const repo = {
      findById: async () => lineRecord,
      updateExpense: async (input: any, withinTx?: (tx: unknown) => Promise<void>, _db?: unknown, afterUpdate?: any) => {
        persisted = input;
        events.push('header.cas');
        await withinTx?.(TX);
        await afterUpdate?.(TX, { ...lineRecord, note: null }, { ...lineRecord, ...input });
        return { ...lineRecord, ...input };
      },
    } as any;
    const transactionalAudit = {
      companyId: 'company-1', actorUserId: 'user-1', action: 'expense.line_draft.answer',
      targetType: 'expense_record', targetId: 'expense-1', requestId: 'req-1', result: 'SUCCESS',
    } as const;
    const useCase = new UpdateExpenseDraftUseCase(repo, {
      log: async (entry: any, tx: unknown) => {
        assert.equal(entry.action, transactionalAudit.action);
        assert.deepEqual(entry.metadataJson.expenseHistoryChanges, { note: { before: null, after: 'ใช้ในสำนักงาน' } });
        assert.equal(tx, TX);
        events.push('audit.insert');
      },
    } as any, { resolveLines: async () => [] } as any);

    await useCase.execute(lineCtx, lineRecord.id, {
      expectedUpdatedAt: VERSION,
      note: 'ใช้ในสำนักงาน',
    }, {
      requireExpectedUpdatedAt: true,
      suppressGenericAudit: true,
      lineDraftCollection: continuation,
      transactionalAudit,
    });

    assert.equal(persisted.note, 'ใช้ในสำนักงาน');
    assert.deepEqual(persisted.sourceChannelMetadataJson, continuation.sourceChannelMetadataJson);
    assert.deepEqual(persisted.aiVerificationSummaryJson, continuation.aiVerificationSummaryJson);
    assert.equal(persisted.updatedAt.toISOString(), continuation.nextUpdatedAt.toISOString());
    assert.deepEqual(events, ['header.cas', 'audit.insert']);
  });

  it('does not expose the internal authority to a watchdog-authenticated HTTP caller', async () => {
    const repo = { findById: async () => lineRecord } as any;
    const useCase = new UpdateExpenseDraftUseCase(repo, audit, { resolveLines: async () => [] } as any);

    await assert.rejects(
      () => useCase.execute(ctx, lineRecord.id, { note: 'x' }, { lineDraftCollection: continuation }),
      ForbiddenException,
    );
  });

  it('does not let a different LINE user update another user’s draft', async () => {
    const repo = { findById: async () => lineRecord } as any;
    const useCase = new UpdateExpenseDraftUseCase(repo, audit, { resolveLines: async () => [] } as any);

    await assert.rejects(
      () => useCase.execute(
        { ...lineCtx, userId: 'user-2' },
        lineRecord.id,
        { note: 'x' },
        { lineDraftCollection: continuation },
      ),
      ForbiddenException,
    );
  });

  it('does not let LINE mutate the record after it leaves DRAFT', async () => {
    const repo = { findById: async () => ({ ...lineRecord, status: 'READY_FOR_CONFIRMATION' }) } as any;
    const useCase = new UpdateExpenseDraftUseCase(repo, audit, { resolveLines: async () => [] } as any);

    await assert.rejects(
      () => useCase.execute(
        lineCtx,
        lineRecord.id,
        { note: 'late answer' },
        { lineDraftCollection: continuation },
      ),
      ForbiddenException,
    );
  });

  it('keeps reviewer-only tax fields closed during LINE collection', async () => {
    const repo = { findById: async () => lineRecord } as any;
    const useCase = new UpdateExpenseDraftUseCase(repo, audit, { resolveLines: async () => [] } as any);

    await assert.rejects(
      () => useCase.execute(
        lineCtx,
        lineRecord.id,
        { taxCategory: 'INPUT_VAT' } as any,
        { lineDraftCollection: continuation },
      ),
      /cannot update taxCategory/,
    );
  });
});


describe('expense activity persisted changes', () => {
  it('normalizes equal decimals and dates, ignores private fields and snapshots absent in legacy rows', () => {
    const before = { expenseDate: new Date('2026-10-30'), grandTotalAmount: '100.0000', note: 'before',
      sourceChannelMetadataJson: { secret: 'old' }, lines: [{ lineNumber: 1, description: 'old item', quantity: '1.0000', unitPrice: '100.0000' }] };
    const after = { ...before, grandTotalAmount: '100', note: 'after', vendorNameSnapshot: 'unknown old name',
      sourceChannelMetadataJson: { secret: 'new' }, lines: [{ lineNumber: 1, description: 'new item', quantity: '1', unitPrice: '100' }] };
    assert.deepEqual(expenseHistoryChanges(before, after), {
      note: { before: 'before', after: 'after' }, 'lines.1.description': { before: 'old item', after: 'new item' },
    });
    assert.deepEqual(readExpenseHistoryChanges({ changedFields: ['note'], before, after }), []);
    assert.deepEqual(readExpenseHistoryChanges({ expenseHistoryChanges: {
      note: { before: null, after: 'safe' }, actorUserId: { before: null, after: 'private' },
      'lines.1.description': { before: 'old', after: 'new' },
      'lines.1.sourceLineText': { before: null, after: 'raw OCR' },
      internalMemo: { before: {}, after: 'bad type' }, currency: { before: 'THB', after: 'THB' },
    } }), [
      { field: 'note', before: null, after: 'safe' }, { field: 'lines.1.description', before: 'old', after: 'new' },
    ]);
  });

  it('records added and removed line values without inventing an old value', () => {
    assert.deepEqual(expenseHistoryChanges({ lines: [{ lineNumber: 1, description: 'removed' }] },
      { lines: [{ lineNumber: 2, description: 'added' }] }), {
      'lines.1.description': { before: 'removed', after: null },
      'lines.2.description': { before: null, after: 'added' },
    });
  });

  it('captures persisted values after the header lock and replacement lines in the same transaction', async () => {
    const events: string[] = [];
    let stored: any = { ...record, note: 'locked old', lines: [{ lineNumber: 1, description: 'old' }] };
    const tx: any = {
      $executeRaw: async () => { events.push('lock'); },
      attachmentLink: { findMany: async () => [] },
      expenseSubstituteReceiptEvidence: { findFirst: async () => null },
      reimbursementLine: { findFirst: async () => null },
      expenseRecord: {
        findFirst: async () => stored,
        findFirstOrThrow: async () => { events.push('read'); return structuredClone(stored); },
        updateMany: async ({ data }: any) => { events.push('write'); stored = { ...stored, ...data }; return { count: 1 }; },
      },
    };
    const repo = new PrismaExpenseRepository({ client: { $transaction: async (work: any) => work(tx) } } as any);
    await repo.updateExpense({ companyId: ctx.companyId, id: record.id, updatedByUserId: ctx.userId, note: 'persisted new' },
      async (activeTx) => { assert.equal(activeTx, tx); events.push('replace.lines'); stored.lines = [{ lineNumber: 1, description: 'saved new line' }]; },
      undefined, async (activeTx, before, after) => {
        assert.equal(activeTx, tx);
        events.push('history');
        assert.deepEqual(expenseHistoryChanges(before, after), {
          note: { before: 'locked old', after: 'persisted new' },
          'lines.1.description': { before: 'old', after: 'saved new line' },
        });
      });
    assert.ok(events.indexOf('lock') < events.indexOf('read'));
    assert.ok(events.indexOf('write') < events.indexOf('replace.lines'));
    assert.ok(events.indexOf('replace.lines') < events.lastIndexOf('read'));
    assert.equal(events.at(-1), 'history');
  });

  it('includes printed vendor identity and resolved names, and ignores renames of unchanged references', () => {
    const before = { vendorTaxIdSnapshot: 'old tax', vendorBranchCodeSnapshot: '00000', vendorEntityKindSnapshot: 'INDIVIDUAL',
      vendorAddressSnapshot: 'old address', branchId: 'branch-1', branchName: 'Old branch', expenseCategoryId: 'cat-1', expenseCategoryName: 'Old category',
      lines: [{ lineNumber: 1, expenseCategoryId: 'cat-1', expenseCategoryName: 'Old category' }] };
    const after = { ...before, vendorTaxIdSnapshot: 'new tax', vendorBranchCodeSnapshot: '00001', vendorEntityKindSnapshot: 'JURISTIC',
      vendorAddressSnapshot: 'new address', branchId: 'branch-2', branchName: 'New branch', expenseCategoryId: 'cat-2', expenseCategoryName: 'New category',
      lines: [{ lineNumber: 1, expenseCategoryId: 'cat-2', expenseCategoryName: 'New category' }] };
    assert.deepEqual(expenseHistoryChanges(before, after), {
      vendorTaxIdSnapshot: { before: 'old tax', after: 'new tax' }, vendorBranchCodeSnapshot: { before: '00000', after: '00001' },
      vendorEntityKindSnapshot: { before: 'INDIVIDUAL', after: 'JURISTIC' }, vendorAddressSnapshot: { before: 'old address', after: 'new address' },
      branchName: { before: 'Old branch', after: 'New branch' }, expenseCategoryName: { before: 'Old category', after: 'New category' },
      'lines.1.expenseCategoryName': { before: 'Old category', after: 'New category' },
    });
    assert.deepEqual(expenseHistoryChanges(before, { ...before, branchName: 'Renamed', expenseCategoryName: 'Renamed',
      lines: [{ ...before.lines[0], expenseCategoryName: 'Renamed' }] }), {});
  });

  it('keeps suppressed preview writes free of generic audit and history callbacks', async () => {
    let logs = 0;
    const repo = { findById: async () => record, updateExpense: async (_input: any, _withinTx: any, _db: any, afterUpdate: any) => {
      assert.equal(afterUpdate, undefined); return record;
    } } as any;
    await new UpdateExpenseDraftUseCase(repo, { log: async () => { logs++; } } as any, {} as any)
      .execute(ctx, record.id, { note: 'preview' }, { db: TX, suppressGenericAudit: true });
    assert.equal(logs, 0);
  });

  it('passes persisted changes to the caller-owned LINE audit without writing a generic duplicate', async () => {
    let captured: unknown;
    let logs = 0;
    const repo = { findById: async () => record, updateExpense: async (_input: any, _withinTx: any, _db: any, afterUpdate: any) => {
      await afterUpdate(TX, { ...record, note: 'before' }, { ...record, note: 'persisted' }); return record;
    } } as any;
    await new UpdateExpenseDraftUseCase(repo, { log: async () => { logs++; } } as any, {} as any)
      .execute(ctx, record.id, { note: 'requested' }, { db: TX, suppressGenericAudit: true, onHistoryChanges: (changes) => { captured = changes; } });
    assert.deepEqual(captured, { note: { before: 'before', after: 'persisted' } });
    assert.equal(logs, 0);
  });

  it('propagates transactional audit failure through the write transaction', async () => {
    let rolledBack = false;
    const repo = { findById: async () => lineRecordForAuditFailure,
      updateExpense: async (_input: any, withinTx: any, _db: any, afterUpdate: any) => {
        try {
          await withinTx?.(TX);
          await afterUpdate(TX, { ...lineRecordForAuditFailure, note: null }, { ...lineRecordForAuditFailure, note: 'saved' });
          return record;
        } catch (error) { rolledBack = true; throw error; }
      },
    } as any;
    const auditFailure = new Error('audit unavailable');
    const useCase = new UpdateExpenseDraftUseCase(repo, { log: async (_entry: any, tx: unknown) => {
      assert.equal(tx, TX); throw auditFailure;
    } } as any, {} as any);
    await assert.rejects(() => useCase.execute({ ...ctx, authProvider: 'line', permissions: ['expense.receipt.line_upload'] }, record.id,
      { note: 'saved' }, { suppressGenericAudit: true,
        lineDraftCollection: { sourceChannelMetadataJson: { lineExpenseDraftContinuation: { status: 'COLLECTING' } }, aiVerificationSummaryJson: {}, nextUpdatedAt: new Date() },
        transactionalAudit: { companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.line_draft.answer',
          targetType: 'expense_record', targetId: record.id, requestId: 'req-1', result: 'SUCCESS' },
      }), (error) => error === auditFailure);
    assert.equal(rolledBack, true);
  });

  it('includes actual persisted generic update changes without moving the audit into the transaction', async () => {
    let logged: any;
    const repo = {
      findById: async () => ({ ...record, note: 'loaded snapshot' }),
      updateExpense: async (_input: any, _withinTx: any, _db: any, afterUpdate: any) => {
        await afterUpdate(TX, { ...record, note: 'locked snapshot' }, { ...record, note: 'persisted value' });
        return { ...record, note: 'persisted value' };
      },
    } as any;
    const useCase = new UpdateExpenseDraftUseCase(repo, { log: async (entry: any, tx: unknown) => {
      assert.equal(tx, undefined); logged = entry;
    } } as any, {} as any);
    await useCase.execute(ctx, record.id, { note: 'requested value' });
    assert.deepEqual(logged.metadataJson.expenseHistoryChanges, { note: { before: 'locked snapshot', after: 'persisted value' } });
  });
});

const lineRecordForAuditFailure = { ...record, captureSource: 'LINE_UPLOAD' };
