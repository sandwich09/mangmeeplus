import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
      listLineChargeKinds: async () => new Map<number, string | null>(),
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
      updateExpense: async (input: any, withinTx?: (tx: unknown) => Promise<void>) => {
        persisted = input;
        events.push('header.cas');
        await withinTx?.(TX);
        return { ...lineRecord, ...input };
      },
    } as any;
    const transactionalAudit = {
      companyId: 'company-1', actorUserId: 'user-1', action: 'expense.line_draft.answer',
      targetType: 'expense_record', targetId: 'expense-1', requestId: 'req-1', result: 'SUCCESS',
    } as const;
    const useCase = new UpdateExpenseDraftUseCase(repo, {
      log: async (entry: any, tx: unknown) => {
        assert.equal(entry, transactionalAudit);
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
