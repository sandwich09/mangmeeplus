import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { CancelExpensePaymentUseCase, DecideExpenseInputVatUseCase, ReopenExpenseUseCase, CreateExpenseDraftUseCase, ConfirmExpenseUseCase, GetExpenseUseCase, MarkExpenseReadyUseCase, RecordExpensePaymentUseCase, RejectExpenseUseCase, UpdateExpenseDraftUseCase, VoidExpenseUseCase } from './expense-draft.use-case';

const ctx = { companyId: 'co', userId: 'u', membershipId: 'member', roles: [], authProvider: 'watchdog', requestId: 'req', scopes: {},
  permissions: ['expense.create', 'expense.update', 'expense.review', 'expense.confirm', 'expense.payment.record', 'expense.reject', 'expense.void', 'expense.receipt.upload'] } as any;
function fixture() {
  const state = { status: 'DISABLED', hold: false, active: true, writes: [] as any[] };
  const term = { tierKey: 'FREE_TRIAL_15', termEndsAt: new Date(0), termDisabledAt: new Date(0), billingReceiptAccountId: null, capacityOverride: null };
  const db = { company: { findUnique: async () => ({ status: state.status, disabledAt: new Date(0), archivedAt: null, planTerm: term }) },
    auditLog: { findFirst: async () => ({ actorUserId: state.hold ? 'admin' : null, metadataJson: { toStatus: 'DISABLED', reason: 'no_package' } }) },
    billingAccount: { findMany: async () => [] }, billingInvoice: { findFirst: async () => null }, billingReceiptGrant: { findFirst: async () => null },
    packageChangeRequest: { findFirst: async () => null }, salesAttribution: { findUnique: async () => null } } as any;
  const record = { id: 'ex', companyId: 'co', branchId: null, createdByUserId: 'u', status: 'DRAFT', captureSource: 'WEB_UPLOAD',
    sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'NEEDS_REVIEW', inputVatClaimStatus: 'NEEDS_REVIEW', vatMode: 'NO_VAT',
    currency: 'THB', expenseDate: new Date('2026-10-01'), updatedAt: new Date('2026-10-01T01:00:00Z'), grandTotalAmount: '0',
    aiVerificationSummaryJson: null, sourceChannelMetadataJson: null, vendorNameSnapshot: 'ร้านเดิม', note: null, lines: [] } as any;
  const repo = { commercialAccessDb: db, findById: async () => record, findByIdWithRelations: async () => record,
    findActiveMemberIdentity: async () => state.active ? { userId: 'u' } : null, listCategories: async () => [],
    updateExpense: async (input: any) => { state.writes.push(input); return { ...record, ...input }; } } as any;
  const audit = { log: async () => undefined } as any;
  return { state, repo, record, audit };
}

describe('free expense direct-usecase boundaries', () => {
  it('rejects manual/final/reimbursement-authority actions even with broad permissions and no context flag', async () => {
    const { repo, audit, state } = fixture();
    const tax = {} as any;
    const checks = [
      () => new CreateExpenseDraftUseCase(repo, audit, tax, {} as any).execute(ctx, {} as any),
      () => new MarkExpenseReadyUseCase(repo).execute(ctx, 'ex'),
      () => new ReopenExpenseUseCase(repo, audit).execute(ctx, 'ex', 'reason'),
      () => new CancelExpensePaymentUseCase(repo, audit).execute(ctx, 'ex', 'pay', 'reason'),
      () => new DecideExpenseInputVatUseCase(repo).execute(ctx, 'ex', {} as any),
      () => new RecordExpensePaymentUseCase(repo, audit).confirmDate(ctx, 'ex', 'pay', '2026-10-28'),
      () => new ConfirmExpenseUseCase(repo, audit, tax, {} as any).execute(ctx, 'ex'),
      () => new ConfirmExpenseUseCase(repo, audit, tax, {} as any).executeForReimbursement(ctx, 'ex', {} as any),
      () => new RejectExpenseUseCase(repo, audit).execute(ctx, 'ex', 'reason'),
      () => new VoidExpenseUseCase(repo, audit, {} as any, {} as any, {} as any, {} as any).execute(ctx, 'ex', 'reason'),
      () => new RecordExpensePaymentUseCase(repo, audit).execute(ctx, 'ex', {} as any),
    ];
    for (const check of checks) await assert.rejects(check, (error: any) => error instanceof ForbiddenException && (error.getResponse() as any).code === 'FREE_EXPENSE_DRAFTS_ONLY');
    assert.equal(state.writes.length, 0);
  });

  it('saves own source facts under CAS without vendor-master autosave or review authority', async () => {
    const { repo, audit, state, record } = fixture();
    const update = new UpdateExpenseDraftUseCase(repo, audit, {} as any, { execute: async () => { throw new Error('must not create a counterparty'); } } as any);
    await update.execute(ctx, 'ex', { note: 'ใช้ในร้าน', expectedUpdatedAt: record.updatedAt.toISOString() });
    assert.equal(state.writes.length, 1);
    assert.equal(state.writes[0].note, 'ใช้ในร้าน');
    assert.equal(state.writes[0].reviewedAt, undefined);
    assert.equal(state.writes[0].reviewedByUserId, undefined);
    assert.equal(state.writes[0].expectedUpdatedAt.toISOString(), record.updatedAt.toISOString());
    await assert.rejects(() => update.execute(ctx, 'ex', { vendorCounterpartyId: 'master', expectedUpdatedAt: record.updatedAt.toISOString() }), ForbiddenException);
    await assert.rejects(() => update.execute({ ...ctx, userId: 'other' }, 'ex', { note: 'foreign', expectedUpdatedAt: record.updatedAt.toISOString() }), ForbiddenException);
    assert.equal(state.writes.length, 1);
  });

  it('persists WEB sourceDraft through the shared source writer without granting review', async () => {
    const { repo, audit, state, record } = fixture();
    const update = new UpdateExpenseDraftUseCase(repo, audit, {} as any, { execute: async () => { throw new Error('must not create a counterparty'); } } as any);
    await update.execute(ctx, 'ex', { sourceDraft: { vendorName: 'ร้านใหม่' }, expectedUpdatedAt: record.updatedAt.toISOString() });
    assert.equal(state.writes.length, 1);
    assert.equal(state.writes[0].vendorNameSnapshot, 'ร้านใหม่');
    assert.equal(state.writes[0].sourceChannelMetadataJson.lineExpenseDraftContinuation.header.vendorName, 'ร้านใหม่');
    assert.equal(state.writes[0].reviewedAt, undefined);
  });

  it('does not restore broad stale paid access when an archive or term hold remains', async () => {
    for (const hold of ['archive', 'term']) {
      const { repo, audit, state, record } = fixture();
      repo.commercialAccessDb.company.findUnique = async () => ({ status: 'ACTIVE', archivedAt: hold === 'archive' ? new Date() : null,
        planTerm: { tierKey: 'STARTER_249', termEndsAt: new Date(Date.now() + 60000), termDisabledAt: hold === 'term' ? new Date() : null } });
      await assert.rejects(() => new UpdateExpenseDraftUseCase(repo, audit, {} as any).execute(ctx, 'ex',
        { note: 'stale', expectedUpdatedAt: record.updatedAt.toISOString() }), ForbiddenException);
      assert.equal(state.writes.length, 0);
    }
  });

  it('exposes editable shared WEB source projection only to active originating members', async () => {
    const { repo, record, state } = fixture();
    const get = new GetExpenseUseCase(repo);
    assert.equal((await get.sourceDraft(ctx, record))?.canEdit, true);
    state.active = false;
    assert.equal((await get.sourceDraft(ctx, record))?.canEdit, false);
    state.active = true; state.hold = true;
    await assert.rejects(() => get.sourceDraft(ctx, record), ForbiddenException);
  });
});
