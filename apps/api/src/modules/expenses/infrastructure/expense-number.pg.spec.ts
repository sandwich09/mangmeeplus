import { SyncTaxEventsUseCase } from '../../tax/application/use-cases/sync-tax-events.use-case';
import { PrismaTaxRepository } from '../../tax/infrastructure/repositories/prisma-tax.repository';
import { ExpenseSourceAdapter } from '../../tax/infrastructure/adapters/expense-source.adapter';
import { PrismaReimbursementRepository } from '../../reimbursements/infrastructure/prisma-reimbursement.repository';
import { MaterializeClaimExpensesService } from '../../reimbursements/application/services/materialize-claim-expenses.service';
import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { PrismaExpenseRepository } from './prisma-expense.repository';
import { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import { PrismaAuditRepository } from '../../audit/infrastructure/prisma-audit.repository';
import { CancelExpensePaymentUseCase, ReopenExpenseUseCase, RecordExpensePaymentUseCase, CreateExpenseDraftUseCase, UpdateExpenseDraftUseCase } from '../application/use-cases/expense-draft.use-case';
import { expenseTaxSourceChecksum } from '../domain/logic/expense-status.logic';
import { canNumberReviewedDraft } from './expense-number';
import { hasCurrentExpenseEvidenceReview } from '@watchdog-bms/contracts';

// Opt-in local PostgreSQL; every row is test-owned. Launch/tax services are isolated here;
// allocation, transactions, audit, lines, source constraints and uniqueness are real PostgreSQL.
const url = process.env.DATABASE_URL;
const enabled = process.env.EXPENSE_NUMBER_PG_TEST === '1';
describe('expense running identity (PostgreSQL)', { skip: !enabled }, () => {
  assert.ok(url && ['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Use a local isolated DB');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const prisma = { client } as any;
  const allocator = new PrismaDocumentSequenceRepository(prisma);
  const repo = new PrismaExpenseRepository(prisma, allocator);
  const audit = new PrismaAuditRepository(prisma);
  const tax = { resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => lines } as any;
  const launch = { assertLaunchRouteOpen: async () => {} } as any;
  const create = new CreateExpenseDraftUseCase(repo, audit as any, tax, launch);
  let companyId: string, branchId: string, otherBranchId: string, userId: string;
  const originalFlag = process.env.EXPENSE_DRAFT_NUMBERING_ENABLED;
  const ctx = () => ({ companyId, userId, requestId: randomUUID(), scopes: {}, permissions: ['expense.create'], authProvider: 'session' }) as any;
  const draft = (overrides: Record<string, unknown> = {}) => ({
    idempotencyKey: randomUUID(), branchId, captureSource: 'WEB_MANUAL', expenseDate: '2026-08-01', vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE',
    lines: [{ lineNumber: 1, description: 'Local numbering test', quantity: '1', unitPrice: '100', vatRate: '0' }], ...overrides,
  }) as any;
  before(async () => {
    delete process.env.EXPENSE_DRAFT_NUMBERING_ENABLED;
    companyId = (await client.company.create({ data: { name: `expense-number-${randomUUID()}` } })).id;
    branchId = (await client.branch.create({ data: { companyId, code: 'HO', name: 'Head Office' } })).id;
    otherBranchId = (await client.branch.create({ data: { companyId, code: 'B02', name: 'Branch two' } })).id;
    userId = (await client.user.create({ data: { displayName: 'Number test' } })).id;
  });
  after(async () => {
    if (originalFlag === undefined) delete process.env.EXPENSE_DRAFT_NUMBERING_ENABLED;
    else process.env.EXPENSE_DRAFT_NUMBERING_ENABLED = originalFlag;
    if (companyId) {
      await client.auditLog.deleteMany({ where: { companyId } });
      await client.expenseSubstituteReceiptEvidence.deleteMany({ where: { companyId } });
      await client.journalEntry.deleteMany({ where: { companyId, entryType: 'REVERSAL' } });
      await client.company.delete({ where: { id: companyId } });
    }
    if (userId) await client.user.delete({ where: { id: userId } });
    await client.$disconnect();
  });
  async function ready(id: string, expenseDate?: string, taxInvoice = false) {
    await client.expenseRecord.update({ where: { id }, data: { status: 'READY_FOR_CONFIRMATION', sourceDocumentType: taxInvoice ? 'TAX_INVOICE' : 'RECEIPT', taxEvidenceStatus: taxInvoice ? 'USABLE_FOR_TAX' : 'SUPPORTING_ONLY' } });
    const file = await client.attachmentObject.create({ data: {
      companyId, branchId, storageProvider: 'LOCAL', bucket: 'test', objectKey: `${companyId}/${id}/${randomUUID()}`,
      originalFileName: 'receipt.pdf', mimeType: 'application/pdf', byteSize: 1,
      checksumSha256: 'b'.repeat(64), uploadedByUserId: userId, status: 'ACTIVE',
    } });
    await client.attachmentLink.create({ data: { companyId, attachmentId: file.id, targetType: 'expense.record', targetId: id,
      purpose: 'expense.receipt.primary', linkedByUserId: userId } });
    const before = (await repo.findByIdWithRelations(companyId, id))!;
    await new UpdateExpenseDraftUseCase(repo, audit as any, tax).execute({ ...ctx(), permissions: ['expense.review'] }, id, {
      expectedUpdatedAt: before.updatedAt.toISOString(), ...(expenseDate && { expenseDate }), documentReviewAcknowledged: true,
      evidenceAssessment: { route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', attachmentIds: [file.id], reason: '' },
    }, { suppressGenericAudit: true });
    const source = (await repo.findByIdWithRelations(companyId, id))!;
    assert.equal(hasCurrentExpenseEvidenceReview(source), true);
    return { companyId, id, actorUserId: userId, confirmationAudit: { requestId: randomUUID() }, expectedUpdatedAt: source.updatedAt,
      expectedSourceChecksum: expenseTaxSourceChecksum(source), postingStatus: 'pending' as const, vendorSnapshotJson: null,
      outboxEvent: { eventKey: `number-test:${id}`, payloadJson: { data: { expenseId: id } } } };
  }
  it('without a flag, parallel retries save one header, lines, committed number and create audit', async () => {
    const input = draft();
    const rows = await Promise.all(Array.from({ length: 5 }, () => create.execute(ctx(), input)));
    assert.equal(new Set(rows.map(r => r.id)).size, 1);
    assert.match(rows[0]!.expenseNumber!, /^EXP-202608-\d+$/);
    const id = rows[0]!.id;
    assert.equal(await client.expenseLine.count({ where: { expenseId: id } }), 1);
    const numbers = await client.documentNumber.findMany({ where: { companyId, ownerId: id } });
    assert.equal(numbers.length, 1); assert.equal(numbers[0]!.status, 'COMMITTED');
    assert.equal(await client.auditLog.count({ where: { companyId, action: 'expense.create', targetId: id } }), 1);
    await assert.rejects(create.execute(ctx(), { ...input, expenseDate: '2026-09-01' }), /รายการที่บันทึก/);
    await assert.rejects(create.execute({ ...ctx(), scopes: { branchIds: [otherBranchId] } }, input), /scope/);
    // No explicit branch in payload: retry must check the OLD row's branch too.
    const implicit = draft({ branchId: undefined });
    await create.execute({ ...ctx(), scopes: { branchIds: [branchId] } }, implicit);
    await assert.rejects(create.execute({ ...ctx(), scopes: { branchIds: [otherBranchId] } }, implicit), /Access denied/);
  });
  it('allocates distinct numbers across concurrent branches and months', async () => {
    const rows = await Promise.all(Array.from({ length: 8 }, (_, i) => create.execute(ctx(), draft({ branchId: i % 2 ? branchId : otherBranchId, expenseDate: i < 4 ? '2026-08-31' : '2026-09-01' }))));
    assert.equal(new Set(rows.map(r => r.expenseNumber)).size, 8);
    rows.forEach((r, i) => assert.match(r.expenseNumber!, i < 4 ? /^EXP-202608-/ : /^EXP-202609-/));
  });
  it('rolls back header, lines, audit and sequence when number commitment fails', async () => {
    const input = draft({ expenseDate: '2026-03-05' });
    const failing = new PrismaExpenseRepository(prisma, {
      reserveNumberInTransaction: allocator.reserveNumberInTransaction.bind(allocator),
      commitNumberInTransaction: async () => { throw new Error('injected-number-commit'); },
    } as any);
    const failed = new CreateExpenseDraftUseCase(failing, audit as any, tax, launch);
    await assert.rejects(failed.execute(ctx(), input), /injected-number-commit/);
    assert.equal(await client.expenseRecord.count({ where: { companyId, draftIdempotencyKey: input.idempotencyKey } }), 0);
    assert.equal(await client.documentSequence.count({ where: { companyId, periodKey: '2026-03' } }), 0);
    const saved = await create.execute(ctx(), input);
    assert.equal(saved.expenseNumber, 'EXP-202603-00001');
  });
  it('staging and flag-off writes have no number; reviewed save assigns once and retains it across date edit', async () => {
    const staged = await create.execute(ctx(), draft({ captureSource: 'WEB_UPLOAD' }));
    assert.equal(staged.expenseNumber, null);
    const reviewed = await repo.updateExpense({ companyId, id: staged.id, updatedByUserId: userId, expenseDate: new Date('2026-07-31T00:00:00Z'), assignExpenseNumber: true });
    assert.match(reviewed.expenseNumber!, /^EXP-202607-/);
    process.env.EXPENSE_DRAFT_NUMBERING_ENABLED = 'false';
    const oldWriter = await create.execute(ctx(), draft());
    assert.equal(oldWriter.expenseNumber, null);
    const edited = await repo.updateExpense({ companyId, id: staged.id, updatedByUserId: userId, expenseDate: new Date('2026-06-01T00:00:00Z'), assignExpenseNumber: true });
    assert.equal(edited.expenseNumber, reviewed.expenseNumber);
    const confirmed = await repo.finalizeAndConfirmExpenseCas(await ready(staged.id), async () => []);
    assert.equal(confirmed.expense.expenseNumber, reviewed.expenseNumber);
    process.env.EXPENSE_DRAFT_NUMBERING_ENABLED = 'true';
  });
  it('date and evidence review save one current review with the new draft number', async () => {
    const staged = await create.execute(ctx(), draft({ captureSource: 'WEB_UPLOAD' }));
    assert.equal(staged.expenseNumber, null);
    const input = await ready(staged.id, '2026-07-31');
    const reviewed = (await repo.findByIdWithRelations(companyId, staged.id))!;
    assert.match(reviewed.expenseNumber!, /^EXP-202607-/);
    assert.equal(hasCurrentExpenseEvidenceReview(reviewed), true);
    const confirmed = await repo.finalizeAndConfirmExpenseCas(input, async () => []);
    assert.equal(confirmed.expense.expenseNumber, reviewed.expenseNumber);
    assert.equal(await client.documentNumber.count({ where: { companyId, ownerId: staged.id } }), 1);
    assert.equal(await client.auditLog.count({ where: { companyId, targetId: staged.id, action: 'expense.evidence.review' } }), 1);
  });
  it('concurrent confirmation keeps the draft number and creates exactly one outbox event', async () => {
    const saved = await create.execute(ctx(), draft());
    const input = await ready(saved.id);
    const results = await Promise.all([repo.finalizeAndConfirmExpenseCas(input, async () => []), repo.finalizeAndConfirmExpenseCas(input, async () => [])]);
    assert.ok(results.every(r => r.expense.expenseNumber === saved.expenseNumber && r.expense.status === 'CONFIRMED'));
    assert.equal(await client.outboxEvent.count({ where: { companyId, aggregateId: saved.id, eventType: 'expense.confirmed' } }), 1);
    assert.equal(await client.documentNumber.count({ where: { companyId, ownerId: saved.id } }), 1);
    assert.equal(await client.auditLog.count({ where: { companyId, targetId: saved.id, action: 'expense.confirm' } }), 1);
  });
  it('legacy confirm uses document month and rolls back a new number on outbox failure', async () => {
    const saved = await create.execute(ctx(), draft({ captureSource: 'WEB_UPLOAD', expenseDate: '2025-12-31' }));
    const input = await ready(saved.id);
    await client.outboxEvent.create({ data: { companyId, eventType: 'test', aggregateType: 'test', aggregateId: saved.id, eventKey: input.outboxEvent.eventKey, payloadJson: {} } });
    await assert.rejects(repo.finalizeAndConfirmExpenseCas(input, async () => []));
    assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id: saved.id } })).expenseNumber, null);
    assert.equal(await client.documentNumber.count({ where: { companyId, ownerId: saved.id } }), 0);
    await client.outboxEvent.deleteMany({ where: { companyId, eventKey: input.outboxEvent.eventKey } });
    const result = await repo.finalizeAndConfirmExpenseCas(input, async () => []);
    assert.equal(result.expense.expenseNumber, 'EXP-202512-00001');
    const event = await client.outboxEvent.findFirstOrThrow({ where: { companyId, eventKey: input.outboxEvent.eventKey } });
    assert.equal((event.payloadJson as any).data.expenseNumber, result.expense.expenseNumber);
  });
  it('closed period rejects confirmation without consuming a number', async () => {
    const saved = await create.execute(ctx(), draft({ captureSource: 'WEB_UPLOAD', expenseDate: '2026-02-01' }));
    const input = await ready(saved.id);
    await client.accountingPeriod.create({ data: { companyId, periodKey: '2026-02', status: 'CLOSED', startDate: new Date('2026-02-01'), endDate: new Date('2026-02-28') } as any });
    await assert.rejects(repo.finalizeAndConfirmExpenseCas(input, async () => []), /period/);
    assert.equal(await client.documentNumber.count({ where: { companyId, ownerId: saved.id } }), 0);
  });
  it('serializes a monthless custom template across different period counters', async () => {
    await client.documentSequence.create({ data: { companyId, branchScopeKey: 'GLOBAL', documentType: 'expense.record', periodKey: '2099-01',
      prefixTemplate: 'CUSTOM-EXP-{SEQ}', nextNumber: 1, padding: 5, resetPolicy: 'MONTHLY', status: 'ACTIVE', createdByUserId: userId, updatedByUserId: userId } });
    try {
      const rows = await Promise.all(['2021-10-31', '2021-11-01'].map(expenseDate => create.execute(ctx(), draft({ expenseDate }))));
      assert.deepEqual(rows.map(r => r.expenseNumber).sort(), ['CUSTOM-EXP-00001', 'CUSTOM-EXP-00002']);
    } finally {
      await client.documentSequence.deleteMany({ where: { companyId, periodKey: '2099-01' } });
    }
  });
  it('retains an imported EXP without registry and continues above it without filling earlier gaps', async () => {
    const old = await create.execute(ctx(), draft({ captureSource: 'WEB_UPLOAD', expenseDate: '2024-01-31' }));
    await client.expenseRecord.update({ where: { id: old.id }, data: { expenseNumber: 'EXP-202401-00100' } });
    const input = await ready(old.id);
    const confirmed = await repo.finalizeAndConfirmExpenseCas(input, async () => []);
    assert.equal(confirmed.expense.expenseNumber, 'EXP-202401-00100');
    const next = await create.execute(ctx(), draft({ expenseDate: '2024-01-01' }));
    assert.equal(next.expenseNumber, 'EXP-202401-00101');
  });
  it('deleting a numbered draft retains its number and rejects stale create replay', async () => {
    const input = draft({ expenseDate: '2024-02-01' });
    const saved = await create.execute(ctx(), input);
    await repo.deleteDraftExpense(companyId, saved.id);
    await assert.rejects(create.execute(ctx(), input), /ถูกลบแล้ว/);
    const next = await create.execute(ctx(), draft({ expenseDate: '2024-02-01' }));
    assert.equal(saved.expenseNumber, 'EXP-202402-00001'); assert.equal(next.expenseNumber, 'EXP-202402-00002');
  });
  it('does not add a number on save to legacy evidence or rewrite its frozen snapshot', async () => {
    const saved = await create.execute(ctx(), draft({ captureSource: 'WEB_UPLOAD' }));
    const frozen = { version: 1, expenseNumber: null, retained: 'historical signed facts' };
    const evidence = await client.expenseSubstituteReceiptEvidence.create({ data: {
      companyId, branchId, expenseId: saved.id, version: 1, status: 'SUPERSEDED', documentNumber: 'SRC-LEGACY', idempotencyKey: randomUUID(),
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', reasonCode: 'RECEIPT_UNAVAILABLE', missingReceiptReason: 'No receipt', businessPurpose: 'Office',
      paymentEvidenceAttachmentIds: [], supportingAttachmentIds: [], preparedByUserId: userId, preparedAt: new Date(), expenseUpdatedAtAtPreparation: saved.updatedAt,
      snapshotJson: frozen, payerName: 'Legacy payer', payerUserId: userId, supersededAt: new Date(), supersedeReason: 'Legacy cancellation',
    } as any });
    assert.equal(await client.$transaction(tx => canNumberReviewedDraft(tx, { ...saved, expenseNumber: null } as any)), false);
    await repo.updateExpense({ companyId, id: saved.id, updatedByUserId: userId, assignExpenseNumber: true });
    assert.equal((await repo.findById(companyId, saved.id))!.expenseNumber, null);
    assert.deepEqual((await client.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } })).snapshotJson, frozen);
  });
  it('numbers multi-month claim projections atomically and reuses each line on concurrent retry', async () => {
    const rb = new PrismaReimbursementRepository(prisma, allocator);
    // A claim's requester and creator must be active members of the company and branch (reimbursement-approval-spec.md §8.1 step 3).
    await client.companyMembership.create({ data: { companyId, userId } });
    let request = await rb.createRequest({ companyId, branchId, requesterUserId: userId, createdByUserId: userId,
      requesterDisplayNameSnapshot: 'Projection tester', reason: 'Two months', currency: 'THB', categoryKey: 'travel',
      amount: '200', incurredDate: new Date('2030-05-01'), receiptRequirementStatus: 'WAIVED_BY_POLICY',
      lines: ['2030-04-30', '2030-05-01'].map((date, i) => ({ lineNo: i + 1, incurredDate: new Date(date), description: date, categoryKey: 'travel', amount: '100' })) });
    await client.reimbursementRequest.update({ where: { id: request.id }, data: { status: 'FINANCE_REVIEW', financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByUserId: userId } });
    request = (await rb.findRequestById(companyId, request.id))!;
    const input = { companyId, requestId: request.id, decisionKind: 'FINANCE' as const, decisionActorUserId: userId,
      scopes: {}, items: new MaterializeClaimExpensesService().buildItems(request) };
    const counters = await client.documentSequence.findMany({ where: { companyId }, orderBy: { id: 'asc' } });
    const originalCommit = allocator.commitNumberInTransaction.bind(allocator);
    let commits = 0;
    allocator.commitNumberInTransaction = async (...args) => {
      if (++commits === 2) throw new Error('second projection number failed');
      return originalCommit(...args);
    };
    try { await assert.rejects(rb.prepareClaimProjections(input), /second projection/); }
    finally { allocator.commitNumberInTransaction = originalCommit; }
    assert.equal(await client.expenseRecord.count({ where: { sourceReimbursementRequestId: request.id } }), 0);
    assert.deepEqual(await client.documentSequence.findMany({ where: { companyId }, orderBy: { id: 'asc' } }), counters);
    const [first, retry] = await Promise.all([rb.prepareClaimProjections(input), rb.prepareClaimProjections(input)]);
    assert.deepEqual(first.map(r => r.expenseId), retry.map(r => r.expenseId));
    const rows = await client.expenseRecord.findMany({ where: { sourceReimbursementRequestId: request.id }, orderBy: { expenseDate: 'asc' } });
    assert.deepEqual(rows.map(r => r.expenseNumber), ['EXP-203004-00001', 'EXP-203005-00001']);
    assert.equal(await client.documentNumber.count({ where: { companyId, ownerId: { in: rows.map(r => r.id) }, status: 'COMMITTED' } }), 2);
    assert.deepEqual((await rb.findRequestById(companyId, request.id))!.lines, request.lines);
  });

  it('posted payout void is atomic, concurrent/idempotent and refuses a closed period', async () => {
    const rb = new PrismaReimbursementRepository(prisma, allocator);
    const at = new Date('2026-09-11T00:00:00Z');
    const request = await client.reimbursementRequest.create({ data: { companyId, branchId, requesterUserId: userId,
      requesterDisplayNameSnapshot: 'Test payer', reason: 'Posted void test', categoryKey: 'travel', amount: '100',
      incurredDate: at, createdByUserId: userId, status: 'PAID', paymentStatus: 'PAID', paymentTotalAmount: '100', outstandingAmount: '0' } });
    const payment = await client.reimbursementPayment.create({ data: { companyId, reimbursementRequestId: request.id,
      idempotencyKey: randomUUID(), paidAmount: '100', paymentMethod: 'CASH', paidAt: at, paidByUserId: userId, sourcePaymentRef: randomUUID() } });
    const period = await client.accountingPeriod.create({ data: { companyId, periodKey: '2026-09', startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30'), status: 'CLOSED' } });
    const debit = await client.chartOfAccount.create({ data: { companyId, code: '2130-01', nameTh: 'เจ้าหนี้พนักงาน', accountClass: 'LIABILITY', normalBalance: 'CREDIT' } });
    const credit = await client.chartOfAccount.create({ data: { companyId, code: '1110-01', nameTh: 'เงินสด', accountClass: 'ASSET', normalBalance: 'DEBIT' } });
    const original = await client.journalEntry.create({ data: { companyId, periodId: period.id, entryNumber: 'JV-ORIGINAL',
      entryType: 'GENERATED', sourceType: 'reimbursement.payment', sourceId: payment.id, status: 'POSTED', entryDate: at, postedAt: at,
      postedByUserId: userId, createdByUserId: userId, lines: { create: [
        { branchId, accountId: debit.id, lineNumber: 1, debitAmount: '100', creditAmount: '0' },
        { branchId, accountId: credit.id, lineNumber: 2, debitAmount: '0', creditAmount: '100' },
      ] } } });
    const act = () => rb.voidPaymentTrueReversal(companyId, request.id, payment.id, userId, 'Local void', undefined, randomUUID());
    await assert.rejects(act(), /period/);
    assert.equal((await client.reimbursementPayment.findUniqueOrThrow({ where: { id: payment.id } })).status, 'RECORDED');
    assert.equal(await client.documentNumber.count({ where: { companyId, documentType: 'ledger.journal' } }), 0);
    await client.accountingPeriod.update({ where: { id: period.id }, data: { status: 'OPEN' } });
    // Duplicate durable event forces a failure after reversal/number/audit writes: everything rolls back.
    const eventKey = `reimbursement.payment_voided:${payment.id}`;
    await client.outboxEvent.create({ data: { companyId, eventType: 'test', aggregateType: 'test', aggregateId: payment.id, eventKey, payloadJson: {} } });
    await assert.rejects(act());
    assert.equal((await client.reimbursementPayment.findUniqueOrThrow({ where: { id: payment.id } })).status, 'RECORDED');
    assert.equal(await client.journalEntry.count({ where: { companyId, reversalOfJournalEntryId: original.id } }), 0);
    assert.equal(await client.auditLog.count({ where: { companyId, targetId: payment.id } }), 0);
    await client.outboxEvent.deleteMany({ where: { companyId, eventKey } });
    const results = await Promise.all([act(), act(), act()]);
    assert.equal(results.filter(r => !r.alreadyVoided).length, 1);
    const reversal = await client.journalEntry.findFirstOrThrow({ where: { companyId, reversalOfJournalEntryId: original.id }, include: { lines: true } });
    const number = await client.documentNumber.findFirstOrThrow({ where: { companyId, ownerId: reversal.id } });
    assert.equal(number.status, 'COMMITTED'); assert.equal(number.documentNumber, reversal.entryNumber);
    assert.equal(reversal.status, 'POSTED');
    assert.equal(reversal.lines.find(l => l.accountId === debit.id)!.creditAmount.toString(), '100');
    assert.equal(reversal.lines.find(l => l.accountId === credit.id)!.debitAmount.toString(), '100');
    assert.equal(await client.outboxEvent.count({ where: { companyId, eventKey } }), 1);
    assert.equal(await client.auditLog.count({ where: { companyId, targetId: payment.id, action: 'reimbursement.payment.void' } }), 1);
    assert.equal((await client.reimbursementRequest.findUniqueOrThrow({ where: { id: request.id } })).paymentTotalAmount.toString(), '0');
  });


  it('rejects future paid dates at the Bangkok boundary without writing and still cancels a stored future payment', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T16:30:00Z').getTime() });
    const source = await create.execute(ctx(), draft());
    await repo.finalizeAndConfirmExpenseCas(await ready(source.id), async () => []);
    const finance = { ...ctx(), permissions: ['expense.payment.record'] };
    const payments = new RecordExpensePaymentUseCase(repo, audit as any);
    for (const paidAt of ['2026-10-03', '2026-10-04']) await payments.execute(finance, source.id, { paidAmount: '0010', paidAt, idempotencyKey: randomUUID() });
    await assert.rejects(payments.execute(finance, source.id, { paidAmount: '10', paidAt: '2026-10-05' }), (e: any) => e.getResponse?.().code === 'expense_payment_future_date');
    assert.equal(await client.expensePayment.count({ where: { expenseId: source.id } }), 2);
    t.mock.timers.setTime(new Date('2026-10-04T17:30:00Z').getTime());
    await payments.execute(finance, source.id, { paidAmount: '10', paidAt: '2026-10-05', idempotencyKey: randomUUID() });
    const stored = await client.expensePayment.create({ data: { companyId, expenseId: source.id, amount: '40', currency: 'THB',
      paidAt: new Date('2026-10-08T00:00:00Z'), paymentMethod: 'CASH', createdByUserId: userId } });
    await client.expenseRecord.update({ where: { id: source.id }, data: { paidAmount: '70', outstandingAmount: '30' } });
    const cancelled = await new CancelExpensePaymentUseCase(repo, audit as any).execute(finance, source.id, stored.id, 'แก้รายการเดิม');
    assert.equal(Number(cancelled.paidAmount), 30);
    const after = await client.expensePayment.findUniqueOrThrow({ where: { id: stored.id } });
    assert.equal(after.status, 'VOIDED'); assert.equal(after.paidAt.toISOString(), stored.paidAt.toISOString());
  });

  it('corrects confirmed payments and document without changing the number, and checks the retained paid total at re-confirmation', async () => {
    const source = await create.execute(ctx(), draft());
    const confirmed = (await repo.finalizeAndConfirmExpenseCas(await ready(source.id), async () => [])).expense;
    const finance = { ...ctx(), permissions: ['expense.confirm', 'expense.payment.record'] };
    const payments = new RecordExpensePaymentUseCase(repo, audit as any);
    await payments.execute(finance, source.id, { paidAmount: '40', paidAt: '2026-10-04', idempotencyKey: randomUUID() });
    await payments.execute(finance, source.id, { paidAmount: '60', paidAt: '2026-10-04', idempotencyKey: randomUUID() });
    const history = await client.expensePayment.findMany({ where: { companyId, expenseId: source.id }, orderBy: { createdAt: 'asc' } });
    const cancel = new CancelExpensePaymentUseCase(repo, audit as any);
    const corrected = await cancel.execute(finance, source.id, history[0]!.id, 'กรอกยอดจ่ายผิด');
    assert.equal(Number(corrected.paidAmount), 60); assert.equal(Number(corrected.outstandingAmount), 40);
    const reopened = await new ReopenExpenseUseCase(repo, audit as any).execute(finance, source.id, 'แก้ยอดเอกสาร');
    assert.equal(reopened.expenseNumber, confirmed.expenseNumber); assert.equal(Number(reopened.paidAmount), 60); assert.equal(reopened.confirmedAt, null);
    assert.equal((await client.expensePayment.findUniqueOrThrow({ where: { id: history[0]!.id } })).status, 'VOIDED');
    const correctionHistory = await repo.findCorrectionHistory(companyId, source.id, [history[0]!.id]);
    assert.ok(correctionHistory.reopenedAt); assert.equal(correctionHistory.cancellationReasons.get(history[0]!.id), 'กรอกยอดจ่ายผิด');
    await client.expenseRecord.update({ where: { id: source.id }, data: { netPayableAmount: '50', status: 'READY_FOR_CONFIRMATION' } });
    await assert.rejects(repo.finalizeAndConfirmExpenseCas({ companyId, id: source.id } as any, async () => []), (error: any) => error.getResponse?.().code === 'expense_paid_exceeds_payable');
    await client.expenseRecord.update({ where: { id: source.id }, data: { netPayableAmount: '100', status: 'NEEDS_REVIEW' } });
    const reconfirm = await ready(source.id);
    reconfirm.outboxEvent.eventKey = `correction-reconfirm:${source.id}`;
    const result = await repo.finalizeAndConfirmExpenseCas(reconfirm, async () => []);
    assert.equal(result.expense.expenseNumber, confirmed.expenseNumber); assert.equal(Number(result.expense.paidAmount), 60);
    assert.equal(await client.documentNumber.count({ where: { companyId, ownerId: source.id } }), 1);
    for (const action of ['expense.reopen', 'expense.payment.cancel']) {
      const entry = await client.auditLog.findFirstOrThrow({ where: { companyId, action } });
      assert.equal(entry.actorUserId, userId); assert.ok((entry.metadataJson as any).reason);
    }
  });

  it('refuses cancellation from the posted journal even when the payment pointer still says pending', async () => {
    const source = await create.execute(ctx(), draft());
    await repo.finalizeAndConfirmExpenseCas(await ready(source.id), async () => []);
    await new RecordExpensePaymentUseCase(repo, audit as any).execute({ ...ctx(), permissions: ['expense.payment.record'] }, source.id, { paidAmount: '40', idempotencyKey: randomUUID() });
    const payment = await client.expensePayment.findFirstOrThrow({ where: { companyId, expenseId: source.id } });
    const period = await client.accountingPeriod.upsert({ where: { companyId_periodKey: { companyId, periodKey: '2026-10' } }, create: { companyId, periodKey: '2026-10', status: 'OPEN', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31') }, update: {} });
    await client.journalEntry.create({ data: { companyId, periodId: period.id, entryNumber: `posted-${randomUUID()}`, entryType: 'GENERATED', sourceType: 'expense.payment', sourceId: payment.id, status: 'POSTED', entryDate: new Date(), createdByUserId: userId } });
    await assert.rejects(repo.cancelPaymentAtomic({ companyId, expenseId: source.id, paymentId: payment.id, actorUserId: userId, scopes: {}, reason: 'แก้ยอดจ่าย' }), (error: any) => error.getResponse?.().blocker === 'ledger_posted');
    assert.equal((await client.expensePayment.findUniqueOrThrow({ where: { id: payment.id } })).status, 'RECORDED');
    assert.equal((await repo.expenseCorrectionCapabilities(companyId, source.id, ['expense.confirm', 'expense.payment.record'])).canReopen, false);
  });


  const taxRepo = new PrismaTaxRepository(prisma);
  const expenseSource = new ExpenseSourceAdapter(prisma);
  const sync = new SyncTaxEventsUseCase(taxRepo, { findIssuedWithVatByCompany: async () => [] } as any,
    expenseSource, { findRecordedWithWhtByCompany: async () => [] } as any);
  const correction = (id: string) => ({ companyId, expenseId: id, actorUserId: userId, scopes: {}, reason: 'แก้ข้อมูลภาษี' });
  const activeEvents = (id: string) => client.taxEvent.findMany({ where: { companyId, sourceType: 'expense.record', sourceId: id, status: 'ACTIVE' } });
  async function assertRetired(id: string) {
    assert.equal((await activeEvents(id)).length, 0);
    assert.equal(await client.whtCertificateHandoff.count({ where: { companyId, sourcePaymentType: 'expense.record', sourcePaymentId: id, status: 'REQUIRED' } }), 0);
  }
  // Real expense/tax repositories and source adapter; only catalog resolution is isolated.
  async function editTaxDocument(id: string, date: string, base: number, withholding: number, individual: boolean, component: boolean) {
    const vat = Number((base * 0.07).toFixed(2));
    const source = (await repo.findByIdWithRelations(companyId, id))!;
    const snapshot: any = { taxCodeDefinitionId: null, externalTaxCode: 'I7', taxProfileKey: 'SAP_TH', taxProfileVersion: 1,
      roundingMode: 'HALF_UP', roundingScale: 2, taxAmountTolerance: '0.01', taxRegime: 'VAT', taxDirection: 'INPUT',
      taxTreatment: 'STANDARD', taxContext: 'DOMESTIC_PURCHASE', taxRate: '7', sourceCurrency: 'THB', taxCurrency: 'THB',
      exchangeRate: '1', exchangeRateSource: 'FUNCTIONAL_CURRENCY', exchangeRateDate: date,
      taxBaseAmount: String(base), taxAmount: String(vat), claimability: 'CLAIMABLE', evidenceStatus: 'VERIFIED',
      accountRuleVersion: 1, reportRuleVersion: 1, recognitionDate: date, evidenceRefs: [] };
    const taxComponents: any = [{ componentKey: 'VAT', snapshot, accountAssignments: [],
      reportContributions: [{ formType: 'PP30', boxKey: 'box_6_eligible_purchases', amount: String(base), amountSource: 'TAX_BASE' },
        { formType: 'PP30', boxKey: 'box_7_input_tax', amount: String(vat), amountSource: 'TAX_AMOUNT' }] }];
    await repo.updateExpense({ companyId, id, updatedByUserId: userId, expectedUpdatedAt: source.updatedAt, expenseDate: new Date(date),
      vendorNameSnapshot: 'ผู้รับเงินทดสอบ', vendorTaxIdSnapshot: '0105557000001', vendorEntityKindSnapshot: individual ? 'INDIVIDUAL' : 'JURISTIC',
      vendorDocumentNumber: `INV-${id}`, vatMode: 'VAT_EXCLUDED', inputVatClaimStatus: 'CLAIMABLE',
      taxableAmount: String(base), subtotalAmount: String(base), vatAmount: String(vat), whtAmount: String(withholding),
      grandTotalAmount: String(base + vat), netPayableAmount: String(base + vat - withholding),
      outstandingAmount: String(base + vat - withholding - Number(source.paidAmount)),
      whtRate: withholding ? '3' : '0', taxCategory: withholding ? 'SERVICE' : '',
    }, async tx => {
      await repo.upsertLines(companyId, id, [{ companyId, expenseId: id, expenseCategoryId: null, accountHintKey: null, taxCategory: withholding ? 'SERVICE' : null, lineNumber: 1, description: 'รายการแก้ไข', quantity: '1', unitPrice: String(base),
        discountAmount: '0', taxableAmount: String(base), vatRate: '0.07', vatAmount: String(vat), whtRate: withholding ? '0.03' : null,
        whtAmount: String(withholding), lineSubtotalAmount: String(base), lineTotalAmount: String(base + vat),
        ...(component && { taxSnapshot: snapshot, taxComponents }),
      }], tx, true); // Replaces the line with a new id, like deleting/replacing a reviewed line.
    });
    const input = await ready(id, undefined, true);
    input.outboxEvent.eventKey = `tax-correction:${randomUUID()}`;
    await repo.finalizeAndConfirmExpenseCas(input, async ({ expense }) => component ? expense.lines.map(line => ({ ...line,
      companyId, expenseId: id, sourceLineId: line.id, taxSnapshot: snapshot, taxComponents,
    })) : []);
  }

  it('retires header VAT and WHT while open; new ids, VAT, date and payee produce exactly one current active set', async () => {
    const source = await create.execute(ctx(), draft({ expenseDate: '2026-05-01' }));
    await editTaxDocument(source.id, '2026-05-01', 100, 3, false, false);
    await sync.execute(companyId);
    const old = await activeEvents(source.id);
    assert.deepEqual(old.map(e => e.eventType).sort(), ['VAT_INPUT', 'WHT_PND53']);
    const oldLine = await client.expenseLine.findFirstOrThrow({ where: { companyId, expenseId: source.id } });
    await repo.reopenExpenseAtomic(correction(source.id));
    await assertRetired(source.id);
    await sync.execute(companyId); await assertRetired(source.id);
    await editTaxDocument(source.id, '2026-06-01', 200, 6, true, true);
    await sync.execute(companyId); await sync.execute(companyId);
    const current = await activeEvents(source.id);
    assert.equal(current.length, 2);
    assert.deepEqual(current.map(e => e.eventType).sort(), ['VAT_INPUT', 'WHT_PND3']);
    assert.ok(current.every(e => e.periodKey === '2026-06'));
    assert.equal(Number(current.find(e => e.eventType === 'VAT_INPUT')!.taxAmount), 14);
    const currentLine = current.find(e => e.eventType === 'VAT_INPUT')!.sourceLineId;
    assert.ok(currentLine); assert.notEqual(currentLine, oldLine.id);
    assert.ok(old.every(e => !current.some(now => now.id === e.id)));
    // Removing withholding retires both the old form and its REQUIRED handoff.
    await repo.reopenExpenseAtomic(correction(source.id)); await assertRetired(source.id);
    await editTaxDocument(source.id, '2026-07-01', 300, 0, true, true);
    await sync.execute(companyId); await sync.execute(companyId);
    const noWht = await activeEvents(source.id);
    assert.equal(noWht.length, 1); assert.equal(noWht[0]!.periodKey, '2026-07');
    assert.equal(Number(noWht[0]!.taxAmount), 21); assert.notEqual(noWht[0]!.sourceLineId, currentLine);
    assert.equal(await client.whtCertificateHandoff.count({ where: { companyId, sourcePaymentId: source.id, status: 'REQUIRED' } }), 0);
    // Adding withholding after another correction creates only the newly applicable form.
    await repo.reopenExpenseAtomic(correction(source.id)); await assertRetired(source.id);
    await editTaxDocument(source.id, '2026-07-02', 400, 12, false, true);
    await sync.execute(companyId); await sync.execute(companyId);
    const added = await activeEvents(source.id);
    assert.equal(added.length, 2); assert.deepEqual(added.map(e => e.eventType).sort(), ['VAT_INPUT', 'WHT_PND53']);
    assert.equal(Number(added.find(e => e.eventType === 'VAT_INPUT')!.taxAmount), 28);
  });

  for (const finish of ['reject', 'void'] as const) it(`reopen then ${finish} leaves no active tax fact or required handoff, and no stranded payment`, async () => {
    const source = await create.execute(ctx(), draft({ expenseDate: '2026-05-02' }));
    await editTaxDocument(source.id, '2026-05-02', 100, 3, true, true);
    await sync.execute(companyId);
    await new RecordExpensePaymentUseCase(repo, audit as any).execute({ ...ctx(), permissions: ['expense.payment.record'] }, source.id, { paidAmount: '40', idempotencyKey: randomUUID() });
    await repo.reopenExpenseAtomic(correction(source.id)); await assertRetired(source.id);
    if (finish === 'reject') {
      await assert.rejects(repo.updateExpense({ companyId, id: source.id, status: 'REJECTED', updatedByUserId: userId }), (e: any) => e.getResponse?.().code === 'expense_rejection_payments_recorded');
      const payment = await client.expensePayment.findFirstOrThrow({ where: { companyId, expenseId: source.id } });
      await repo.cancelPaymentAtomic({ ...correction(source.id), paymentId: payment.id });
      await repo.updateExpense({ companyId, id: source.id, status: 'REJECTED', updatedByUserId: userId });
    } else await repo.voidExpenseTrueReversal(companyId, source.id, userId, 'ยกเลิกหลังเปิดแก้ไข');
    await sync.execute(companyId); await assertRetired(source.id);
    assert.equal(await client.expensePayment.count({ where: { companyId, expenseId: source.id, status: 'RECORDED' } }), 0);
  });

  it('stale tax sync cannot resurrect reporting facts after reopen or after a new confirmation', async () => {
    const source = await create.execute(ctx(), draft({ expenseDate: '2026-05-03' }));
    await editTaxDocument(source.id, '2026-05-03', 100, 3, false, false);
    const before = (await repo.findById(companyId, source.id))!;
    await sync.execute(companyId);
    const old = (await activeEvents(source.id))[0]!;
    const stale: any = { ...old, expectedExpenseConfirmedAt: before.confirmedAt, idempotencyKey: `stale:${randomUUID()}` };
    await repo.reopenExpenseAtomic(correction(source.id));
    await assert.rejects(taxRepo.upsertEvent(stale), (e: any) => e.getResponse?.().code === 'expense_tax_source_changed');
    await assertRetired(source.id);
    await editTaxDocument(source.id, '2026-06-03', 200, 0, true, true);
    await assert.rejects(taxRepo.upsertEvent(stale), (e: any) => e.getResponse?.().code === 'expense_tax_source_changed');
    await sync.execute(companyId);
    const active = await activeEvents(source.id); assert.equal(active.length, 1); assert.equal(active[0]!.periodKey, '2026-06');
  });


  it('capability and locked reopen refuse accounting and each applicable tax form, then an open document edits and confirms again', async () => {
    const source = await create.execute(ctx(), draft({ expenseDate: '2026-04-01' }));
    await repo.finalizeAndConfirmExpenseCas(await ready(source.id), async () => []);
    const month = await client.accountingPeriod.upsert({ where: { companyId_periodKey: { companyId, periodKey: '2026-04' } },
      create: { companyId, periodKey: '2026-04', startDate: new Date('2026-04-01'), endDate: new Date('2026-04-30'), status: 'CLOSED' }, update: { status: 'CLOSED' } });
    const cap = await repo.expenseCorrectionCapabilities(companyId, source.id, ['expense.confirm']);
    assert.equal(cap.canReopen, false); assert.equal(cap.lockedAccountingPeriodKey, '2026-04');
    await assert.rejects(repo.reopenExpenseAtomic(correction(source.id)), (e: any) => e.getResponse?.().blockers?.includes('accounting_period_locked'));
    await client.accountingPeriod.update({ where: { id: month.id }, data: { status: 'REOPENED' } });
    for (const formType of ['PP30', 'PP36', 'CUSTOMS_SUPPORT', 'PND3', 'PND53'] as const) {
      const withholding = formType.startsWith('PND');
      await client.expenseRecord.update({ where: { id: source.id }, data: { whtAmount: withholding ? '3' : '0', vendorEntityKindSnapshot: formType === 'PND3' ? 'INDIVIDUAL' : 'JURISTIC' } });
      await client.expenseLine.updateMany({ where: { companyId, expenseId: source.id }, data: { taxComponentsJson: withholding ? [] : [{ reportContributions: [{ formType }] }] } });
      const period = await client.taxPeriod.upsert({ where: { companyId_formType_periodKey: { companyId, formType, periodKey: '2026-04' } },
        create: { companyId, formType, taxType: withholding ? 'WHT' : formType === 'CUSTOMS_SUPPORT' ? 'CUSTOMS' : 'VAT', periodKey: '2026-04', status: 'FILED' }, update: { status: 'FILED' } });
      const current = await repo.expenseCorrectionCapabilities(companyId, source.id, ['expense.confirm']);
      assert.deepEqual(current.lockedTaxPeriods, [{ formType, periodKey: '2026-04' }]); assert.equal(current.canReopen, false);
      await assert.rejects(repo.reopenExpenseAtomic(correction(source.id)), (e: any) => e.getResponse?.().lockedTaxPeriods?.[0]?.formType === formType);
      await client.taxPeriod.update({ where: { id: period.id }, data: { status: 'OPEN' } });
    }
    await repo.reopenExpenseAtomic(correction(source.id));
    await editTaxDocument(source.id, '2026-04-02', 200, 6, true, true);
    assert.equal((await repo.findById(companyId, source.id))!.status, 'CONFIRMED');
  });

});
