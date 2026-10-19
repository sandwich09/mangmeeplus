import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaExpenseRepository } from './prisma-expense.repository';

function makeRepo(
  journals: Array<{ id: string; sourceId: string; sourceType: string; entryNumber: string }>,
  payments: Array<{ id: string; status: string; postingStatus: string }> = [],
) {
  const prisma = {
    client: {
      expenseRecord: {
        findFirst: async () => ({
          id: 'expense-1',
          companyId: 'co-1',
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
          sourceReimbursementRequestId: null,
          journalEntryId: null,
          payments: payments.map((payment) => ({
            companyId: 'co-1', expenseId: 'expense-1', amount: '50.00', currency: 'THB', paymentMethod: 'BANK_TRANSFER',
            paidAt: new Date('2026-08-10T00:00:00.000Z'), bankAccountRef: null, journalEntryId: null, postingError: null,
            createdByUserId: 'finance-1', voidedByUserId: null, voidedAt: null,
            createdAt: new Date('2026-08-10T00:00:00.000Z'), updatedAt: new Date('2026-08-10T00:00:00.000Z'),
            ...payment,
          })),
          lines: [],
          duplicateCandidates: [],
        }),
      },
      journalEntry: {
        findMany: async () => journals,
      },
      attachmentLink: {
        findMany: async () => [],
      },
      expenseSubstituteReceiptEvidence: {
        findFirst: async () => null,
        findMany: async () => [],
      },
    },
  };
  return new PrismaExpenseRepository(prisma as any);
}

describe('PrismaExpenseRepository expense posting-source projection', () => {
  it('requests the accrual when no generated journal exists', async () => {
    const expense = await makeRepo([]).findByIdWithRelations('co-1', 'expense-1');
    assert.equal(expense?.pendingPostingSourceType, 'expense.record');
    assert.equal(expense?.pendingPostingSourceId, 'expense-1');
    assert.equal(expense?.journalEntryId, null);
  });

  it('requests the payment leg and repairs the readable JV reference from ledger truth', async () => {
    const expense = await makeRepo([
      { id: 'journal-accrual', sourceId: 'expense-1', sourceType: 'expense.record', entryNumber: 'JV-ACCRUAL' },
    ], [{ id: 'payment-1', status: 'RECORDED', postingStatus: 'pending' }]).findByIdWithRelations('co-1', 'expense-1');
    assert.equal(expense?.pendingPostingSourceType, 'expense.payment');
    assert.equal(expense?.pendingPostingSourceId, 'payment-1');
    assert.equal(expense?.journalEntryId, 'journal-accrual');
    assert.equal(expense?.journalEntryNumber, 'JV-ACCRUAL');
  });

  it('has no outstanding source after both generated journals exist', async () => {
    const expense = await makeRepo([
      { id: 'journal-accrual', sourceId: 'expense-1', sourceType: 'expense.record', entryNumber: 'JV-ACCRUAL' },
      { id: 'journal-payment', sourceId: 'payment-1', sourceType: 'expense.payment', entryNumber: 'JV-PAYMENT' },
    ], [{ id: 'payment-1', status: 'RECORDED', postingStatus: 'posted' }]).findByIdWithRelations('co-1', 'expense-1');
    assert.equal(expense?.pendingPostingSourceType, null);
    assert.equal(expense?.journalEntryId, 'journal-accrual');
    assert.equal(expense?.journalEntryNumber, 'JV-ACCRUAL');
  });
});

describe('PrismaExpenseRepository shared evidence posting state', () => {
  it('intersects selected export rows with tenant, branch and document filters', () => {
    const where = makeRepo([]).buildSharedEvidenceWhere('co-1', {
      expenseIds: ['selected-1', 'outside-scope'], status: 'CONFIRMED', branchId: 'branch-1',
    } as any, { branchIds: ['branch-1'] });
    assert.deepEqual(where.id, { in: ['selected-1', 'outside-scope'] });
    assert.equal(where.companyId, 'co-1');
    assert.equal(where.branchId, 'branch-1');
    assert.equal(where.status, 'CONFIRMED');
    assert.deepEqual(where.AND, [{ OR: [{ branchId: { in: ['branch-1'] } }, { branchId: null }] }]);
    assert.deepEqual(makeRepo([]).buildSharedEvidenceWhere('co-1', { expenseIds: [] } as any).id, { in: [] });
  });
  it('rejects malformed or oversized export selections rather than broadening the export', () => {
    for (const expenseIds of [null, 'selected-1', [null], [''], Array(10001).fill('id')]) {
      assert.throws(() => makeRepo([]).buildSharedEvidenceWhere('co-1', { expenseIds } as any), /รายการที่เลือก/);
    }
  });
  it('honors the 500-row export contract and uses stable pagination for tied dates', async () => {
    let query: any;
    const repo = new PrismaExpenseRepository({ client: { expenseRecord: {
      findMany: async (args: any) => { query = args; return []; }, count: async () => 0,
    } } } as any);
    const page = await repo.listSharedEvidence('co-1', { page: 2, pageSize: 500 });
    assert.equal(page.pageSize, 500);
    assert.equal(query.take, 500);
    assert.equal(query.skip, 500);
    assert.deepEqual(query.orderBy, [{ expenseDate: 'desc' }, { id: 'desc' }]);
  });
  it('uses the selected branch and includes the last civil day with the same date lens as the list', () => {
    const repo = makeRepo([]);
    const uploaded = repo.buildSharedEvidenceWhere('co-1', { branchId: 'b1', yearMonth: '2026-08', dateField: 'uploadedAt' });
    assert.equal(uploaded.branchId, 'b1');
    assert.deepEqual(uploaded.uploadedAt, { gte: new Date('2026-07-31T17:00:00Z'), lt: new Date('2026-08-31T17:00:00Z') });
    const document = repo.buildSharedEvidenceWhere('co-1', { fromDate: '2026-08-31', toDate: '2026-08-31', dateField: 'expenseDate' });
    assert.deepEqual((document.OR as any[])[0].expenseDate, { gte: new Date('2026-08-31T00:00:00Z'), lt: new Date('2026-09-01T00:00:00Z') });
    assert.deepEqual((document.OR as any[])[1].uploadedAt, { gte: new Date('2026-08-30T17:00:00Z'), lt: new Date('2026-08-31T17:00:00Z') });
    assert.match(JSON.stringify(document), /unverified/);
    assert.match(JSON.stringify(document), /implausible/);
    assert.match(JSON.stringify(document), /missingFields/);
  });
  it('keeps branch and actor scope when the list uses the missing-date fallback', async () => {
    let query: any;
    const repo = new PrismaExpenseRepository({ client: { expenseRecord: {
      findMany: async (args: any) => { query = args; return []; }, count: async () => 0,
    } } } as any);
    await repo.listExpenses({ companyId: 'co-1', fromDate: '2026-10-01', toDate: '2026-10-31' }, { branchIds: ['b1'] }, 'sender');
    assert.deepEqual(query.where.OR, [{ branchId: { in: ['b1'] } }, { branchId: null }]);
    assert.match(JSON.stringify(query.where.AND), /sender/);
    assert.match(JSON.stringify(query.where.AND), /unverified/);
  });

  it('keeps branch scope while filtering pending payment events', () => {
    const where = makeRepo([]).buildSharedEvidenceWhere('co-1', { postingStatus: 'pending' }, { branchIds: ['branch-1'] });
    assert.deepEqual(where['AND'], [
      { OR: [{ branchId: { in: ['branch-1'] } }, { branchId: null }] },
      { OR: [
        { postingStatus: 'pending' },
        { payments: { some: { status: 'RECORDED', postingStatus: 'pending' } } },
      ] },
    ]);
  });

  it('shows a payment posting error instead of the already-posted accrual state', async () => {
    const record: any = {
      id: 'expense-1', companyId: 'co-1', status: 'CONFIRMED', postingStatus: 'posted', postingError: null,
      sourceReimbursementRequestId: null, journalEntryId: 'journal-accrual', expenseCategory: null,
    };
    const repo = new PrismaExpenseRepository({ client: {
      expenseRecord: { findMany: async () => [record], count: async () => 1 },
      attachmentLink: { findMany: async () => [] },
      expenseSubstituteReceiptEvidence: { findMany: async () => [] },
      // §5.1: the export sums the charge rows so its row stays additive now that subtotal is goods only.
      expenseLine: { groupBy: async () => [] },
      expensePayment: { findMany: async () => [{ id: 'payment-1', expenseId: 'expense-1', postingStatus: 'posting_error', postingError: 'payment failed' }] },
      journalEntry: { findMany: async () => [{ id: 'journal-accrual', sourceId: 'expense-1', sourceType: 'expense.record', entryNumber: 'JV-1' }] },
    } } as any);

    const page = await repo.listSharedEvidence('co-1', {});
    assert.equal(page.rows[0]?.postingStatus, 'posting_error');
    assert.equal(page.rows[0]?.postingError, 'payment failed');
    assert.equal(page.rows[0]?.pendingPostingSourceId, 'payment-1');
  });
});

it('list and evidence reads carry only the latest VAT decision and resolve its reviewer once per page', async () => {
  for (const reader of ['list', 'evidence']) {
    let query: any; let userQueries = 0;
    const latest = { reason: 'ตรวจเอกสารแล้ว', decidedByUserId: 'reviewer', decidedAt: new Date('2026-10-14T03:00:00Z') };
    const records = ['one', 'two'].map(id => ({ id, companyId: 'co-1', branchId: 'b1', status: 'CONFIRMED', inputVatClaimStatus: 'CLAIMABLE', inputVatDecisions: [latest] }));
    const repo = new PrismaExpenseRepository({ client: {
      expenseRecord: { findMany: async (args: any) => { query = args; return records; }, count: async () => 2 },
      user: { findMany: async (args: any) => { userQueries++; assert.deepEqual(args.where.id.in, ['reviewer']); return [{ id: 'reviewer', displayName: 'ผู้ตรวจภาษี' }]; } },
      attachmentLink: { findMany: async () => [] }, expenseSubstituteReceiptEvidence: { findMany: async () => [] },
      expenseLine: { groupBy: async () => [] }, expensePayment: { findMany: async () => [] }, journalEntry: { findMany: async () => [] },
    } } as any);
    const rows = reader === 'list'
      ? (await repo.listExpenses({ companyId: 'co-1', branchId: 'b1' }, { branchIds: ['b1'] })).data
      : (await repo.listSharedEvidence('co-1', { branchId: 'b1' }, { branchIds: ['b1'] })).rows;
    assert.equal(query.where.companyId, 'co-1'); assert.equal(query.where.branchId, 'b1');
    assert.equal(query.include.inputVatDecisions.take, 1);
    assert.deepEqual(query.include.inputVatDecisions.orderBy, { decidedAt: 'desc' });
    assert.equal(userQueries, 1);
    for (const row of rows) {
      assert.deepEqual(row.latestInputVatDecision, { reason: latest.reason, decidedByName: 'ผู้ตรวจภาษี', decidedAt: latest.decidedAt.toISOString() });
      assert.equal(row.inputVatRecordedBeforeReview, false);
    }
  }
});

it('UX6 list visibility uses registration on each document date and omits VAT-free rights', async () => {
  const dates = ['2026-09-01', '2026-10-01'];
  const records = dates.flatMap(date => ['0', '7'].map(vatAmount => ({ id: `${date}-${vatAmount}`, companyId: 'co', expenseDate: new Date(date), vatAmount, status: 'CONFIRMED' })));
  let reads = 0;
  const repo = new PrismaExpenseRepository({ client: {
    expenseRecord: { findMany: async () => records, count: async () => records.length },
    companyVatRegistrationFact: { findMany: async (query: any) => {
      reads++; assert.equal(query.where.companyId, 'co');
      return [
        { status: 'NOT_REGISTERED', effectiveFrom: new Date('2026-01-01'), effectiveTo: new Date('2026-10-01'), answeredAt: new Date('2026-01-01'), supersededAt: null },
        { status: 'REGISTERED', effectiveFrom: new Date('2026-10-01'), effectiveTo: null, answeredAt: new Date('2026-10-01'), supersededAt: null },
      ];
    } },
  } } as any);
  const result = await repo.listExpenses({ companyId: 'co' });
  assert.deepEqual(result.data.map(row => (row as any).inputVatRightVisible), [false, false, false, true]);
  assert.equal(reads, 1, 'one company fact read per list, not one per expense');
});

it('UX7 certificate-created payments expose only their own readable payment proof', async () => {
  const payments = [
    { id: 'paid-by-certificate', idempotencyKey: 'substitute-receipt:certificate-1', amount: '100', status: 'RECORDED' },
    { id: 'other-payment', idempotencyKey: 'ordinary-payment', amount: '100', status: 'RECORDED' },
  ];
  const certificate = { id: 'certificate-1', expenseId: 'expense-1', version: 1, status: 'ISSUED', paymentEvidenceAttachmentIds: ['unreadable', 'proof'], artifactAttachmentId: null, wetSignedScanAttachmentId: null };
  const repo = new PrismaExpenseRepository({ client: {
    expenseRecord: { findFirst: async () => ({ id: 'expense-1', companyId: 'co', branchId: 'b1', status: 'CONFIRMED', lines: [], payments, duplicateCandidates: [] }) },
    journalEntry: { findMany: async () => [] },
    expenseSubstituteReceiptEvidence: { findMany: async (q: any) => {
      assert.equal(q.where.companyId, 'co'); assert.deepEqual(q.where.expenseId.in, ['expense-1']);
      assert.equal(q.select.paymentEvidenceAttachmentIds, true); return [certificate];
    }, findFirst: async () => null },
    attachmentLink: { findMany: async (q: any) => {
      assert.equal(q.where.companyId, 'co'); assert.equal(q.where.attachment.status, 'ACTIVE');
      if (q.where.targetType === 'expense.payment') return [];
      return [{ targetId: 'expense-1', purpose: 'expense.payment.evidence', attachment: { id: 'proof', branchId: 'b1', status: 'ACTIVE', originalFileName: 'proof.png', createdAt: new Date('2026-10-14') } }];
    } },
  } } as any);
  const detail = await repo.findByIdWithRelations('co', 'expense-1', undefined, { branchIds: ['b1'] });
  assert.equal(detail?.payments[0]?.slipAttachmentId, 'proof');
  assert.equal(detail?.payments[1]?.slipAttachmentId, null);
  (certificate as any).paymentEvidenceAttachmentIds = null;
  const withoutProof = await repo.findByIdWithRelations('co', 'expense-1', undefined, { branchIds: ['b1'] });
  assert.equal(withoutProof?.payments[0]?.slipAttachmentId, null);
});

it('detail carries the same category and unavailable-source facts as the accounting evidence list without exposing source files', async () => {
  const repo = makeRepo([]);
  const db = (repo as any).prisma.client;
  const original = db.expenseRecord.findFirst;
  db.expenseRecord.findFirst = async (query: any) => {
    assert.equal(query.where.companyId, 'co-1');
    assert.ok(query.where.OR, 'existing branch scope is kept');
    assert.equal(query.include.expenseCategory.select.name, true);
    return { ...await original(), branchId: 'b1', expenseCategory: { name: 'สำนักงาน', defaultInputTaxCode: null },
      sourceReimbursementRequestId: 'claim', sourceReimbursementLineId: 'line' };
  };
  db.reimbursementLine = { findMany: async () => [] };
  const detail = await repo.findByIdWithRelations('co-1', 'expense-1', undefined, { branchIds: ['b1'] });
  assert.equal((detail as any).categoryName, 'สำนักงาน');
  assert.equal((detail as any).sourceEvidenceUnavailable, true);
  assert.deepEqual(detail?.attachments, []);
});


it('UAT-T1 evidence reads recognise categories on every goods line without inventing a document category', async () => {
  for (const categorised of [true, false]) {
    let query: any;
    const record = { id: 'expense-1', companyId: 'co-1', status: 'CONFIRMED', expenseCategoryId: null, expenseCategory: null,
      lines: [{ expenseCategoryId: 'food', chargeKind: null }, { expenseCategoryId: categorised ? 'food' : null, chargeKind: null }, { expenseCategoryId: null, chargeKind: 'ROUNDING' }] };
    const repo = new PrismaExpenseRepository({ client: {
      expenseRecord: { findMany: async (args: any) => { query = args; return [record]; }, count: async () => 1 },
      attachmentLink: { findMany: async () => [] }, expenseSubstituteReceiptEvidence: { findMany: async () => [] },
      expenseLine: { groupBy: async () => [] }, expensePayment: { findMany: async () => [] }, journalEntry: { findMany: async () => [] },
    } } as any);
    const result = await repo.listSharedEvidence('co-1', {});
    assert.deepEqual(query.include.lines, { select: { expenseCategoryId: true, chargeKind: true } });
    assert.equal(result.rows[0]!.categoryName, categorised ? 'ตามรายการ' : null);
    assert.equal(result.rows[0]!.expenseCategoryId, null);
  }
});
