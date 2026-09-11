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
import { CreateExpenseDraftUseCase } from '../application/use-cases/expense-draft.use-case';
import { expenseTaxSourceChecksum } from '../domain/logic/expense-status.logic';
import { canNumberReviewedDraft } from './expense-number';
import { expenseEvidenceFingerprint } from '@watchdog-bms/contracts';

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
  async function ready(id: string) {
    const file = await client.attachmentObject.create({ data: { companyId, branchId, storageProvider: 'LOCAL', bucket: 'local',
      objectKey: `number-test/${id}`, originalFileName: 'receipt.png', mimeType: 'image/png', byteSize: 1,
      checksumSha256: 'a'.repeat(64), uploadedByUserId: userId, status: 'ACTIVE' } });
    await client.attachmentLink.create({ data: { companyId, attachmentId: file.id, targetType: 'expense.record', targetId: id,
      purpose: 'expense.receipt', linkedByUserId: userId } });
    await client.expenseRecord.update({ where: { id }, data: { status: 'READY_FOR_CONFIRMATION', sourceDocumentType: 'RECEIPT',
      taxEvidenceStatus: 'SUPPORTING_ONLY', primaryAttachmentId: file.id } });
    const reviewed = (await repo.findByIdWithRelations(companyId, id))!;
    const assessment = { route: 'SOURCE_DOCUMENT' as const, receiptProblem: 'NONE' as const, attachmentIds: [file.id], reason: '' };
    await client.expenseRecord.update({ where: { id }, data: { aiVerificationSummaryJson: { documentReview: { version: 2,
      reviewedAt: reviewed.updatedAt.toISOString(), reviewedByUserId: userId, assessment, fingerprint: expenseEvidenceFingerprint(reviewed, assessment) } } } });
    const source = (await repo.findByIdWithRelations(companyId, id))!;
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

});
