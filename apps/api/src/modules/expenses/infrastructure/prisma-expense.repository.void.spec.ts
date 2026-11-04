import { canonicalFingerprint } from '../../../common/security/canonical-fingerprint';
import { after, before, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { EXPENSE_VOID_CERTIFICATE_WORDS } from '@watchdog-bms/contracts';
import {
  PrismaExpenseRepository,
  SUBSTITUTE_RECEIPT_EXPENSE_VOIDED_REASON,
} from './prisma-expense.repository';
import { findClaimExpenseVoidBlocker } from './expense-void-blocker';
import { assertFundingMutation, lockExpenseFunding } from './substitute-funding.guard';
import { lockExpenseCorrection, readDisbursementReservations } from './expense-void-blocker';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { pgSpecUnreachableReason } from '../../../common/database/pg-spec-guard';
import { VoidExpenseUseCase } from '../application/use-cases/expense-draft.use-case';

// H-04 (expenses) closure evidence: void must be a true reversal — the status
// claim, payable zeroing, and reversing journal are one transaction, repeated
// or racing voids are rejected by the CAS claim, and locked accounting/tax
// periods block the whole void.

type Row = Record<string, any>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return cond.some((part: Row) => matches(row, part));
    if (cond instanceof Date && row[key] instanceof Date) return row[key].getTime() === cond.getTime();
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      if ('not' in cond) return row[key] !== cond.not;
      if ('in' in cond) return (cond.in as any[]).includes(row[key]);
      if ('array_contains' in cond) return cond.array_contains.every((value: any) => row[key]?.includes(value));
      return true;
    }
    return row[key] === cond;
  });
}

// Minimal in-memory stand-in for the Prisma client covering exactly the query
// shapes the void transaction uses. $transaction runs the callback against the
// same store; rollback semantics are covered by the live-DB verification run.
function fakeClient(seed: {
  handoffs?: Row[]; certificates?: Row[]; taxEvents?: Row[];
  expenses?: Row[]; expenseLines?: Row[];
  expensePayments?: Row[];
  journalEntries?: Row[]; journalLines?: Row[]; periods?: Row[]; taxPeriods?: Row[];
  substituteEvidence?: Row[];
  documentNumbers?: Row[];
  vouchers?: Row[]; voucherLines?: Row[]; users?: Row[];
}) {
  const s = {
    taxEvents: seed.taxEvents ?? [], handoffs: seed.handoffs ?? [], certificates: seed.certificates ?? [], history: [] as Row[], audits: [] as Row[],
    expenses: seed.expenses ?? [], expenseLines: seed.expenseLines ?? [],
    expensePayments: seed.expensePayments ?? [],
    journalEntries: seed.journalEntries ?? [], journalLines: seed.journalLines ?? [],
    periods: seed.periods ?? [], taxPeriods: seed.taxPeriods ?? [],
    substituteEvidence: seed.substituteEvidence ?? [],
    documentNumbers: seed.documentNumbers ?? [],
  };
  let idSeq = 0;
  const table = (rows: Row[]) => ({
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where.companyId_periodKey ?? where)) ?? null,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findFirstOrThrow: async ({ where }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('NotFoundError');
      return row;
    },
    findMany: async ({ where }: any) => rows.filter((r) => matches(r, where)),
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('RecordNotFound');
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const hits = rows.filter((r) => matches(r, where));
      hits.forEach((r) => { for (const [key, value] of Object.entries(data)) r[key] = value && typeof value === 'object' && 'increment' in value ? Number(r[key] ?? 0) + Number(value.increment) : value; });
      return { count: hits.length };
    },
  });
  const expenseRecord = {
    ...table(s.expenses),
    findFirstOrThrow: async ({ where }: any) => {
      const row = s.expenses.find((r) => matches(r, where));
      if (!row) throw new Error('NotFoundError');
      return { ...row, lines: s.expenseLines.filter((l) => l.expenseId === row.id) };
    },
  };
  const journalEntry = {
    ...table(s.journalEntries),
    findFirst: async ({ where }: any) => {
      const row = s.journalEntries.find((r) => matches(r, where));
      if (!row) return null;
      return { ...row, lines: s.journalLines.filter((l) => l.journalEntryId === row.id).sort((a, b) => a.lineNumber - b.lineNumber) };
    },
    create: async ({ data }: any) => {
      const { lines, ...entry } = data;
      const id = `je_new_${++idSeq}`;
      const dup = s.journalEntries.find((r) =>
        r.companyId === entry.companyId && r.sourceType === entry.sourceType
        && r.sourceId === entry.sourceId && r.entryType === entry.entryType);
      if (dup) throw new Error('P2002 unique constraint (companyId,sourceType,sourceId,entryType)');
      const row = { id, ...entry };
      s.journalEntries.push(row);
      (lines?.create ?? []).forEach((l: Row) => s.journalLines.push({ ...l, id: `jl_new_${++idSeq}`, journalEntryId: id }));
      return row;
    },
  };
  return {
    state: s,
    whtCertificateHandoff: table(s.handoffs), whtCertificate: table(s.certificates),
    whtCertificateHistory: { create: async ({ data }: any) => { assert.ok(s.handoffs[0].certificateId || s.handoffs[0].externalCertificateNumber, 'history precedes clearing'); s.history.push(data); return data; } },
    auditLog: { create: async ({ data }: any) => { s.audits.push(data); return data; } },
    taxEvent: table(s.taxEvents),
    taxReviewIssue: table([]),
    expenseRecord,
    disbursementVoucher: table(seed.vouchers ?? []),
    disbursementVoucherLine: table(seed.voucherLines ?? []),
    user: table(seed.users ?? []),
    expensePayment: table(s.expensePayments),
    accountingPeriod: table(s.periods),
    taxPeriod: table(s.taxPeriods),
    journalEntry,
    expenseSubstituteReceiptEvidence: table(s.substituteEvidence),
    attachmentLink: table([]),
    reimbursementLine: table([]),
    documentNumber: table(s.documentNumbers),
  };
}

function makeClient(seed: Parameters<typeof fakeClient>[0]) {
  const c: any = fakeClient(seed);
  c.$transaction = async (fn: any) => fn(c);
  c.$executeRaw = async () => 0;
  return c;
}

const CO = 'co_1';
const NOW = new Date('2026-07-18T00:00:00Z');

function confirmedExpenseSeed() {
  return {
    expenses: [{
      id: 'exp_1', companyId: CO, branchId: null, status: 'CONFIRMED', expenseDate: NOW, expenseNumber: 'EXP-1',
      currency: 'THB', vatMode: 'EXCLUDE_VAT', inputVatClaimStatus: 'CLAIMABLE',
      subtotalAmount: '100.00', discountAmount: '0.00', taxableAmount: '100.00', vatAmount: '7.00',
      whtAmount: '0.00', grandTotalAmount: '107.00', netPayableAmount: '107.00',
      paidAmount: '50.00', outstandingAmount: '57.00', paymentStatus: 'PARTIALLY_PAID',
      postingStatus: 'posted', journalEntryId: 'je_orig', createdByUserId: 'u1',
      createdAt: NOW, updatedAt: NOW,
    }],
    expenseLines: [{
      id: 'line_1', companyId: CO, expenseId: 'exp_1', lineNumber: 1, description: 'วัสดุสิ้นเปลือง',
      taxComponentsJson: [{ reportContributions: [{ formType: 'PP30' }] }],
    }],
    journalEntries: [{
      id: 'je_orig', companyId: CO, periodId: 'p_1', entryNumber: 'JV-1', entryType: 'GENERATED',
      sourceType: 'expense.record', sourceId: 'exp_1', status: 'POSTED', entryDate: NOW,
    }],
    journalLines: [
      { id: 'jl_1', journalEntryId: 'je_orig', companyId: CO, accountId: 'acc_expense', lineNumber: 1, description: 'expense', debitAmount: '100.0000', creditAmount: '0.0000', currency: 'THB', taxCode: null, branchId: null },
      { id: 'jl_2', journalEntryId: 'je_orig', companyId: CO, accountId: 'acc_input_vat', lineNumber: 2, description: 'input VAT', debitAmount: '7.0000', creditAmount: '0.0000', currency: 'THB', taxCode: 'I7', branchId: null },
      { id: 'jl_3', journalEntryId: 'je_orig', companyId: CO, accountId: 'acc_payable', lineNumber: 3, description: 'payable', debitAmount: '0.0000', creditAmount: '107.0000', currency: 'THB', taxCode: null, branchId: null },
    ],
    periods: [{ id: 'p_1', companyId: CO, periodKey: '2026-07', status: 'OPEN' }],
    taxPeriods: [] as Row[],
  };
}

describe('voidExpenseTrueReversal (H-04)', () => {
  let client: any;
  let repo: PrismaExpenseRepository;

  beforeEach(() => {
    client = makeClient(confirmedExpenseSeed());
    repo = new PrismaExpenseRepository({ client } as any);
  });

  it('voids the expense, zeroes the payable, and reverses the journal atomically', async () => {
    const result = await repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'บันทึกผิดรายการ', 'JV-REV-1');

    const expense = client.state.expenses[0];
    assert.equal(expense.status, 'VOIDED');
    assert.equal(expense.voidedByUserId, 'u2');
    assert.equal(expense.voidReason, 'บันทึกผิดรายการ');
    assert.equal(expense.paidAmount, '0.00');
    assert.equal(expense.outstandingAmount, '0.00');
    assert.equal(expense.paymentStatus, 'VOIDED');
    assert.equal(expense.postingStatus, 'reversed');
    assert.equal(result.expense.status, 'VOIDED');

    const reversal = client.state.journalEntries.find((e: any) => e.entryType === 'REVERSAL');
    assert.ok(reversal, 'reversal entry must exist');
    assert.equal(reversal.entryNumber, 'JV-REV-1');
    assert.equal(reversal.status, 'POSTED');
    assert.equal(reversal.sourceType, 'expense.record');
    assert.equal(reversal.reversalOfJournalEntryId, 'je_orig');
    assert.equal(result.reversalEntryId, reversal.id);

    const revLines = client.state.journalLines.filter((l: any) => l.journalEntryId === reversal.id);
    assert.equal(revLines.length, 3);
    const exp = revLines.find((l: any) => l.accountId === 'acc_expense');
    const vat = revLines.find((l: any) => l.accountId === 'acc_input_vat');
    const payable = revLines.find((l: any) => l.accountId === 'acc_payable');
    assert.equal(exp.creditAmount, 100);
    assert.equal(exp.debitAmount, 0);
    assert.equal(vat.creditAmount, 7);
    assert.equal(vat.taxCode, 'I7');
    assert.equal(payable.debitAmount, 107);
    // Prisma 7 rejects an explicit companyId scalar in the nested line create.
    assert.ok(!('companyId' in exp), 'nested line create must not carry companyId');

    // Original stays POSTED so POSTED-only report queries net to zero.
    const original = client.state.journalEntries.find((e: any) => e.id === 'je_orig');
    assert.equal(original.status, 'POSTED');
    const postedNet: Record<string, number> = {};
    for (const l of client.state.journalLines) {
      const entry = client.state.journalEntries.find((e: any) => e.id === l.journalEntryId);
      if (entry?.status !== 'POSTED') continue;
      postedNet[l.accountId] = (postedNet[l.accountId] ?? 0) + Number(l.debitAmount) - Number(l.creditAmount);
    }
    assert.ok(Object.values(postedNet).every((v) => Math.abs(v) < 0.0001), `net must be zero: ${JSON.stringify(postedNet)}`);
  });

  it('retires the issued substitute certificate and its running number with the expense', async () => {
    client.state.substituteEvidence.push({
      id: 'evidence_1', companyId: CO, expenseId: 'exp_1', status: 'ISSUED',
      documentNumber: 'SRC-202607-00001', artifactAttachmentId: 'artifact_1',
    });
    client.state.documentNumbers.push({
      id: 'number_1', companyId: CO, ownerType: 'expense_substitute_receipt', ownerId: 'evidence_1',
      documentNumber: 'SRC-202607-00001', status: 'COMMITTED',
    });

    await repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'บันทึกผิดรายการ', 'JV-REV-1');

    const evidence = client.state.substituteEvidence[0];
    assert.equal(evidence.status, 'SUPERSEDED');
    assert.equal(evidence.supersedeReason, SUBSTITUTE_RECEIPT_EXPENSE_VOIDED_REASON);
    assert.ok(evidence.supersededAt instanceof Date);
    const number = client.state.documentNumbers[0];
    assert.equal(number.status, 'VOIDED');
    assert.equal(number.voidedAt.getTime(), evidence.supersededAt.getTime());
  });

  it('reverses both the accrual and the settlement journals when the paid expense was fully posted', async () => {
    // GAP-07: a paid, fully-posted expense carries an accrual (expense.record) and
    // a settlement (expense.payment) journal; the void reverses both atomically.
    client.state.journalEntries.push({
      id: 'je_pay', companyId: CO, periodId: 'p_1', entryNumber: 'JV-PAY', entryType: 'GENERATED',
      sourceType: 'expense.payment', sourceId: 'exp_1', status: 'POSTED', entryDate: NOW,
    });
    client.state.journalLines.push(
      { id: 'jl_p1', journalEntryId: 'je_pay', companyId: CO, accountId: 'acc_payable', lineNumber: 1, description: 'จ่ายชำระเจ้าหนี้', debitAmount: '107.0000', creditAmount: '0.0000', currency: 'THB', taxCode: null, branchId: null },
      { id: 'jl_p2', journalEntryId: 'je_pay', companyId: CO, accountId: 'acc_cash', lineNumber: 2, description: 'จ่ายเงิน', debitAmount: '0.0000', creditAmount: '107.0000', currency: 'THB', taxCode: null, branchId: null },
    );

    const result = await repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'บันทึกผิดรายการ', 'JV-REV-1', 'JV-REV-2');

    assert.ok(result.reversalEntryId, 'accrual reversal must exist');
    assert.ok(result.paymentReversalEntryId, 'settlement reversal must exist');
    const reversals = client.state.journalEntries.filter((e: any) => e.entryType === 'REVERSAL');
    assert.equal(reversals.length, 2);
    const accrualRev = reversals.find((e: any) => e.sourceType === 'expense.record');
    const paymentRev = reversals.find((e: any) => e.sourceType === 'expense.payment');
    assert.equal(accrualRev.entryNumber, 'JV-REV-1');
    assert.equal(accrualRev.reversalOfJournalEntryId, 'je_orig');
    assert.equal(paymentRev.entryNumber, 'JV-REV-2');
    assert.equal(paymentRev.reversalOfJournalEntryId, 'je_pay');
    assert.equal(client.state.expenses[0].postingStatus, 'reversed');

    // Every POSTED account nets to zero once both legs are reversed.
    const postedNet: Record<string, number> = {};
    for (const l of client.state.journalLines) {
      const entry = client.state.journalEntries.find((e: any) => e.id === l.journalEntryId);
      if (entry?.status !== 'POSTED') continue;
      postedNet[l.accountId] = (postedNet[l.accountId] ?? 0) + Number(l.debitAmount) - Number(l.creditAmount);
    }
    assert.ok(Object.values(postedNet).every((v) => Math.abs(v) < 0.0001), `net must be zero: ${JSON.stringify(postedNet)}`);
  });

  it('reverses every partial-payment journal and voids the append-only payment history', async () => {
    client.state.expensePayments.push(
      { id: 'pay_1', companyId: CO, expenseId: 'exp_1', status: 'RECORDED', postingStatus: 'posted', paidAt: NOW, createdAt: NOW },
      { id: 'pay_2', companyId: CO, expenseId: 'exp_1', status: 'RECORDED', postingStatus: 'posted', paidAt: NOW, createdAt: new Date(NOW.getTime() + 1) },
    );
    for (const [id, amount] of [['pay_1', '20.0000'], ['pay_2', '30.0000']] as const) {
      client.state.journalEntries.push({
        id: `je_${id}`, companyId: CO, periodId: 'p_1', entryNumber: `JV-${id}`, entryType: 'GENERATED',
        sourceType: 'expense.payment', sourceId: id, status: 'POSTED', entryDate: NOW,
      });
      client.state.journalLines.push(
        { id: `jl_${id}_1`, journalEntryId: `je_${id}`, companyId: CO, accountId: 'acc_payable', lineNumber: 1, description: 'จ่ายชำระเจ้าหนี้', debitAmount: amount, creditAmount: '0.0000', currency: 'THB', taxCode: null, branchId: null },
        { id: `jl_${id}_2`, journalEntryId: `je_${id}`, companyId: CO, accountId: 'acc_cash', lineNumber: 2, description: 'จ่ายเงิน', debitAmount: '0.0000', creditAmount: amount, currency: 'THB', taxCode: null, branchId: null },
      );
    }

    const result = await repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'บันทึกผิดรายการ', 'JV-REV-1', [
      { paymentId: 'pay_1', reversalEntryNumber: 'JV-REV-2' },
      { paymentId: 'pay_2', reversalEntryNumber: 'JV-REV-3' },
    ]);

    assert.deepEqual(result.paymentReversalEntryIds.map((entry) => entry.paymentId), ['pay_1', 'pay_2']);
    assert.equal(client.state.journalEntries.filter((entry: any) => entry.entryType === 'REVERSAL').length, 3);
    assert.ok(client.state.expensePayments.every((payment: any) => payment.status === 'VOIDED' && payment.postingStatus === 'reversed'));
  });

  it('reverses only the accrual leg when the settlement was never posted', async () => {
    // Regression: unpaid/partially-paid expense has no settlement journal; the void
    // reverses just the accrual and returns a null settlement reversal id.
    const result = await repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'บันทึกผิดรายการ', 'JV-REV-1', 'JV-REV-2');
    assert.ok(result.reversalEntryId, 'accrual reversal must exist');
    assert.equal(result.paymentReversalEntryId, null);
    assert.equal(client.state.journalEntries.filter((e: any) => e.entryType === 'REVERSAL').length, 1);
  });

  it('skips creating a second reversal when one already exists for this source', async () => {
    client.state.journalEntries.push({
      id: 'je_rev_prior', companyId: CO, periodId: 'p_1', entryNumber: 'JV-R0', entryType: 'REVERSAL',
      sourceType: 'expense.record', sourceId: 'exp_1', status: 'POSTED', entryDate: NOW,
    });
    const result = await repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'เหตุผล', 'JV-REV-1');
    assert.equal(result.reversalEntryId, null);
    assert.equal(client.state.journalEntries.filter((e: any) => e.entryType === 'REVERSAL').length, 1);
    assert.equal(client.state.expenses[0].postingStatus, 'reversed');
  });

  it('rejects a second void via the conditional status claim', async () => {
    await repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'บันทึกผิดรายการ', 'JV-REV-1');
    await assert.rejects(
      () => repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'ซ้ำ', 'JV-REV-2'),
      ConflictException,
    );
  });

  it('rejects voiding an unpaid unconfirmed expense without financial activity', async () => {
    Object.assign(client.state.expenses[0], { status: 'READY_FOR_CONFIRMATION', paidAmount: '0', journalEntryId: null, postingStatus: 'not_required' });
    await assert.rejects(
      () => repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'เหตุผล', 'JV-REV-1'),
      ConflictException,
    );
  });

  it('fails closed when a posted journal exists but no reversal number was reserved', async () => {
    await assert.rejects(
      () => repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'เหตุผล'),
      ConflictException,
    );
  });

  it('fails closed when the accounting period is closed', async () => {
    client.state.periods[0].status = 'CLOSED';
    await assert.rejects(
      () => repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'เหตุผล', 'JV-REV-1'),
      ConflictException,
    );
  });

  it('fails closed when the period row is missing entirely', async () => {
    client.state.periods.length = 0;
    await assert.rejects(
      () => repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'เหตุผล', 'JV-REV-1'),
      UnprocessableEntityException,
    );
  });

  it('fails closed when the generated journal is not POSTED', async () => {
    client.state.journalEntries[0].status = 'DRAFT';
    await assert.rejects(
      () => repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'เหตุผล', 'JV-REV-1'),
      UnprocessableEntityException,
    );
  });

  it('blocks the void when the PP30 period covering the input VAT is filed', async () => {
    client.state.taxPeriods.push({ id: 'tp_1', companyId: CO, formType: 'PP30', periodKey: '2026-07', status: 'FILED' });
    await assert.rejects(
      () => repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'เหตุผล', 'JV-REV-1'),
      ConflictException,
    );
  });

  for (const inputVatClaimStatus of ['NEEDS_REVIEW', 'NON_CLAIMABLE']) it(`does not infer a filed tax record from the right ${inputVatClaimStatus}`, async () => {
    client.state.expenseLines[0].taxComponentsJson = null;
    client.state.expenses[0].inputVatClaimStatus = inputVatClaimStatus;
    client.state.taxPeriods.push({ id: 'tp_1', companyId: CO, formType: 'PP30', periodKey: '2026-07', status: 'FILED' });
    const result = await repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'เหตุผล', 'JV-REV-1');
    assert.ok(result.reversalEntryId);
  });

  it('fails closed for CLAIMABLE VAT without components in a filed PP30 month', async () => {
    client.state.expenseLines[0].taxComponentsJson = null;
    client.state.taxPeriods.push({ id: 'tp_1', companyId: CO, formType: 'PP30', periodKey: '2026-07', status: 'FILED' });
    await assert.rejects(() => repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'เหตุผล', 'JV-REV-1'), ConflictException);
  });

  it('ignores filed tax periods for a non-claimable, no-VAT expense', async () => {
    Object.assign(client.state.expenses[0], { inputVatClaimStatus: 'NON_CLAIMABLE', vatAmount: '0.00' });
    client.state.expenseLines[0].taxComponentsJson = null;
    client.state.taxPeriods.push({ id: 'tp_1', companyId: CO, formType: 'PP30', periodKey: '2026-07', status: 'FILED' });
    const result = await repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'เหตุผล', 'JV-REV-1');
    assert.ok(result.reversalEntryId, 'reversal must be created despite the filed PP30 period');
  });

  it('voids an unposted expense without touching the ledger', async () => {
    client.state.journalEntries.length = 0;
    client.state.journalLines.length = 0;
    client.state.expenses[0].postingStatus = 'pending';
    const result = await repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'เหตุผล');
    assert.equal(result.reversalEntryId, null);
    assert.equal(client.state.journalEntries.length, 0);
    const expense = client.state.expenses[0];
    assert.equal(expense.status, 'VOIDED');
    assert.equal(expense.postingStatus, 'not_required');
  });
});

// Audit B3 (reimbursement claims): cancelling a claim voids its expense records after the claim has
// committed to cancelling. The claim now asks first what the void would refuse, through the readers
// the void itself throws from, so the answer and the void cannot disagree.
describe('what a claim is told would stop the void is what the void refuses', () => {
  const blocked: Array<[string, (client: any) => void, Record<string, string>]> = [
    ['a closed accounting period', (client) => { client.state.periods[0].status = 'CLOSED'; }, { code: 'accounting_period_locked', periodKey: '2026-07' }],
    ['a period under closing review', (client) => { client.state.periods[0].status = 'CLOSING_REVIEW'; }, { code: 'accounting_period_locked', periodKey: '2026-07' }],
    ['a filed PP30 period', (client) => { client.state.taxPeriods.push({ id: 'tp_1', companyId: CO, formType: 'PP30', periodKey: '2026-07', status: 'FILED' }); },
      { code: 'tax_period_locked', periodKey: '2026-07', formType: 'PP30' }],
    ['a journal that is not posted', (client) => { client.state.journalEntries[0].status = 'DRAFT'; }, { code: 'posting_unresolved' }],
    ['a journal whose period row is missing', (client) => { client.state.periods.length = 0; }, { code: 'posting_unresolved' }],
    ['a claim-born record sent back to review', (client) => { Object.assign(client.state.expenses[0], { status: 'NEEDS_REVIEW', sourceReimbursementRequestId: 'rb_1' }); },
      { code: 'expense_not_voidable' }],
  ];
  const voidable: Array<[string, (client: any) => void]> = [
    ['an open period', () => undefined],
    ['a reopened period', (client) => { client.state.periods[0].status = 'REOPENED'; }],
    ['a record with no journal yet', (client) => { client.state.journalEntries.length = 0; client.state.journalLines.length = 0; }],
    ['a filed PP30 period on a record with no VAT', (client) => {
      Object.assign(client.state.expenses[0], { inputVatClaimStatus: 'NON_CLAIMABLE', vatAmount: '0.00' });
      client.state.expenseLines[0].taxComponentsJson = null;
      client.state.taxPeriods.push({ id: 'tp_1', companyId: CO, formType: 'PP30', periodKey: '2026-07', status: 'FILED' });
    }],
  ];
  const world = (arrange: (client: any) => void) => {
    const client = makeClient(confirmedExpenseSeed());
    // The fake hands a record its lines only through findFirstOrThrow; the reader asks findFirst with them included.
    client.expenseRecord.findFirst = async ({ where }: any) => client.expenseRecord.findFirstOrThrow({ where }).catch(() => null);
    arrange(client);
    return { client, repo: new PrismaExpenseRepository({ client } as any) };
  };

  for (const [name, arrange, expected] of blocked) {
    it(`${name}: reported, and the void refuses`, async () => {
      assert.deepEqual(await findClaimExpenseVoidBlocker(world(arrange).client, CO, 'exp_1'), expected);
      const { client, repo } = world(arrange);
      await assert.rejects(() => repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'เหตุผล', 'JV-REV-1'), (error: any) => {
        assert.equal(error.getResponse().code, expected.code === 'expense_not_voidable' ? 'expense_changed' : expected.code);
        const message = error.getResponse().message;
        assert.equal(message, expected.code === 'posting_unresolved' ? EXPENSE_VOID_CERTIFICATE_WORDS.postingUnresolved
          : expected.code === 'accounting_period_locked' ? EXPENSE_VOID_CERTIFICATE_WORDS.accountingPeriodLocked('2026-07')
          : expected.code === 'tax_period_locked' ? EXPENSE_VOID_CERTIFICATE_WORDS.taxPeriodLocked('2026-07')
          : EXPENSE_VOID_CERTIFICATE_WORDS.statusChanged);
        assert.match(message, /[ก-๙]/); return true;
      });
      assert.equal(client.state.journalEntries.some((entry: any) => entry.entryType === 'REVERSAL'), false);
    });
  }

  it('reports nothing where the void goes through, and nothing for a record there is nothing left to void', async () => {
    for (const [name, arrange] of voidable) {
      assert.equal(await findClaimExpenseVoidBlocker(world(arrange).client, CO, 'exp_1'), null, name);
      const { client, repo } = world(arrange);
      assert.equal((await repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'เหตุผล', 'JV-REV-1')).expense.status, 'VOIDED', name);
      // Voided: asked again (a retried cancellation), there is nothing to report.
      assert.equal(await findClaimExpenseVoidBlocker(client, CO, 'exp_1'), null, `${name}, once voided`);
    }
    // A claim's record that was never confirmed is closed without a journal, whatever its period.
    const unconfirmed = world((client) => { client.state.expenses[0].status = 'READY_FOR_CONFIRMATION'; client.state.periods[0].status = 'CLOSED'; });
    assert.equal(await findClaimExpenseVoidBlocker(unconfirmed.client, CO, 'exp_1'), null);
    assert.equal(await findClaimExpenseVoidBlocker(world(() => undefined).client, CO, 'exp_gone'), null);
  });

  it('runs the caller\'s fence first inside both void transactions, and a refusal there changes nothing', async () => {
    const { client, repo } = world(() => undefined);
    const fence = async (tx: any) => { assert.equal(tx, client, 'inside the transaction'); throw new ConflictException('reimbursement_cancellation_intent_changed'); };
    await assert.rejects(() => repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'เหตุผล', 'JV-REV-1', [], fence), /reimbursement_cancellation_intent_changed/);
    assert.deepEqual([client.state.expenses[0].status, client.state.journalEntries.length], ['CONFIRMED', 1]);

    Object.assign(client.state.expenses[0], { status: 'READY_FOR_CONFIRMATION', sourceReimbursementRequestId: 'rb_1', sourceReimbursementLineId: 'rbl_1' });
    const terminalize = (beforeVoid?: (tx: any) => Promise<void>) => repo.terminalizeUnconfirmedClaimProjection({
      companyId: CO, expenseId: 'exp_1', reimbursementRequestId: 'rb_1', reimbursementLineId: 'rbl_1', actorUserId: 'u2', reason: 'เหตุผล',
      eventKey: 'expense.voided:expense_record:exp_1:reimbursement-cancel', payloadJson: {}, beforeVoid,
    });
    await assert.rejects(() => terminalize(fence), /reimbursement_cancellation_intent_changed/);
    assert.equal(client.state.expenses[0].status, 'READY_FOR_CONFIRMATION');
    // A fence that passes lets the void through.
    let fenced = 0;
    client.outboxEvent = { createMany: async () => ({ count: 1 }) };
    assert.equal((await terminalize(async () => { fenced += 1; })).status, 'VOIDED');
    assert.equal(fenced, 1);
  });
});

describe('updateExpense void bypass guard (H-04)', () => {
  it('refuses a VOIDED status through the generic updater', async () => {
    const repo = new PrismaExpenseRepository({ client: makeClient({}) } as any);
    await assert.rejects(
      () => repo.updateExpense({ id: 'exp_1', companyId: CO, status: 'VOIDED' } as any),
      UnprocessableEntityException,
    );
  });
});

// RA-18: the payee taxpayer class decides ภ.ง.ด.3 vs ภ.ง.ด.53 and is only writable before
// confirmation, so a silent drop in the field allowlist would strand every payee on ภ.ง.ด.53.
describe('updateExpense payee taxpayer class', () => {
  it('persists the class and keeps it writable while substitute evidence is signed', async () => {
    const seed = { expenses: [{ id: 'exp_1', companyId: CO, status: 'NEEDS_REVIEW' }] };
    const client = makeClient(seed);
    const repo = new PrismaExpenseRepository({ client } as any);

    await repo.updateExpense({ id: 'exp_1', companyId: CO, vendorEntityKindSnapshot: 'INDIVIDUAL' } as any);
    assert.equal(client.state.expenses[0].vendorEntityKindSnapshot, 'INDIVIDUAL');

    // The class must NOT join `materialFields`. Confirming a substitute-reliant expense requires the
    // evidence already ISSUED, and `validateConfirm` refuses to confirm a withholding expense without
    // the class — so locking it here would make that expense unconfirmable forever. The class is not
    // printed on the artifact, so leaving it writable costs no document integrity.
    client.state.substituteEvidence.push({ id: 'ev_1', companyId: CO, expenseId: 'exp_1', status: 'ISSUED' });
    await repo.updateExpense({ id: 'exp_1', companyId: CO, vendorEntityKindSnapshot: 'JURISTIC' } as any);
    assert.equal(client.state.expenses[0].vendorEntityKindSnapshot, 'JURISTIC');

    // A field that IS printed on the artifact still locks — proving the guard itself is intact.
    await assert.rejects(
      () => repo.updateExpense({ id: 'exp_1', companyId: CO, vendorNameSnapshot: 'ร้านใหม่' } as any),
      ConflictException,
    );
  });
});

describe('updateExpense optimistic concurrency', () => {
  it('updates only the version the reviewer loaded and runs dependent writes in the same transaction', async () => {
    const seed = { expenses: [{ id: 'exp_1', companyId: CO, status: 'DRAFT', updatedAt: NOW, note: 'old' }] };
    const client = makeClient(seed);
    const repo = new PrismaExpenseRepository({ client } as any);
    let callbackClient: unknown;

    await repo.updateExpense({
      id: 'exp_1', companyId: CO, updatedByUserId: 'u1', expectedUpdatedAt: new Date(NOW), note: 'new',
    } as any, async (tx) => { callbackClient = tx; });

    assert.equal(client.state.expenses[0].note, 'new');
    assert.equal(callbackClient, client);
  });

  it('returns a stable conflict and skips dependent writes when the loaded version is stale', async () => {
    const seed = { expenses: [{ id: 'exp_1', companyId: CO, status: 'DRAFT', updatedAt: NOW, note: 'current' }] };
    const client = makeClient(seed);
    const repo = new PrismaExpenseRepository({ client } as any);
    let callbackCalled = false;

    await assert.rejects(
      () => repo.updateExpense({
        id: 'exp_1', companyId: CO, updatedByUserId: 'u1',
        expectedUpdatedAt: new Date('2026-07-17T00:00:00.000Z'), note: 'stale overwrite',
      } as any, async () => { callbackCalled = true; }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal((error.getResponse() as any).code, 'EXPENSE_UPDATE_CONFLICT');
        return true;
      },
    );

    assert.equal(client.state.expenses[0].note, 'current');
    assert.equal(callbackCalled, false);
  });
});


describe('expense void certificate cascade (A3)', () => {
  function setup(kind?: 'SYSTEM' | 'EXTERNAL' | 'REQUIRED') {
    const seed = confirmedExpenseSeed();
    seed.expenses[0].whtAmount = '3.00';
    const handoff = { payeeAddress: 'บ้านเลขที่ 99', id: 'handoff-1', companyId: CO, sourcePaymentType: 'expense.record', sourcePaymentId: 'exp_1',
      status: kind === 'SYSTEM' ? 'SYSTEM_ISSUED' : kind === 'EXTERNAL' ? 'EXTERNAL_LINKED' : 'REQUIRED', certificateRound: 0,
      certificateId: kind === 'SYSTEM' ? 'cert-1' : null, externalCertificateNumber: kind === 'EXTERNAL' ? 'PAPER-1' : null,
      externalIssuedDate: NOW, externalEvidenceRef: 'evidence', linkNote: 'note', linkCommandId: 'link-1',
      linkPayloadFingerprint: 'fingerprint', linkedAt: NOW, linkedByUserId: 'u1' };
    const client = makeClient({ ...seed, handoffs: kind ? [handoff] : [],
      certificates: kind === 'SYSTEM' ? [{ id: 'cert-1', companyId: CO, status: 'ISSUED', certificateNumber: 'WHT-1', issuedAt: NOW, issuedByUserId: 'issuer-1' }] : [] });
    const repo = new PrismaExpenseRepository({ client } as any);
    const options = { permissions: ['expense.void', 'wht.certificate.correct', 'wht.external_certificate.link'], taxFilingAttested: true, requestId: 'request-1' };
    const run = (patch = {}) => repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'บันทึกผิดรายการ', 'JV-REV-1', [], undefined, { ...options, ...patch });
    return { client, handoff, run };
  }
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) {
    it(`refuses ${kind} without certificate permission before changing anything`, async () => {
      const h = setup(kind);
      await assert.rejects(h.run({ permissions: ['expense.void'] }), (error: any) => error instanceof ForbiddenException && (error.getResponse() as any).code === 'certificate_permission_missing');
      assert.equal(h.client.state.expenses[0].status, 'CONFIRMED'); assert.equal(h.client.state.history.length, 0);
    });
    it(`requires attestation for ${kind}`, async () => {
      const h = setup(kind);
      await assert.rejects(h.run({ taxFilingAttested: false }), (error: any) => error instanceof BadRequestException && (error.getResponse() as any).code === 'expense_certificate_attestation_required');
      assert.equal(h.client.state.expenses[0].status, 'CONFIRMED');
    });
    it(`cancels ${kind} once with history before clearing all pointers`, async () => {
      const h = setup(kind); const result = await h.run();
      assert.deepEqual((result as any).cancelledCertificate, { issuerUserId: kind === 'SYSTEM' ? 'issuer-1' : 'u1', certificateNumber: kind === 'SYSTEM' ? 'WHT-1' : 'PAPER-1', isExternal: kind === 'EXTERNAL', certificateRound: 1 });
      assert.equal(h.handoff.status, 'CANCELLED'); assert.equal(h.handoff.certificateRound, 1); assert.equal(h.handoff.payeeAddress, 'บ้านเลขที่ 99');
      for (const key of ['certificateId', 'externalCertificateNumber', 'externalIssuedDate', 'externalEvidenceRef', 'linkNote', 'linkCommandId', 'linkPayloadFingerprint', 'linkedAt', 'linkedByUserId']) assert.equal((h.handoff as any)[key], null, key);
      assert.deepEqual(h.client.state.history[0], { companyId: CO, expenseId: 'exp_1', handoffId: 'handoff-1',
        eventType: kind === 'SYSTEM' ? 'CANCELLED_SOURCE_VOIDED' : 'EXTERNAL_RECORD_REMOVED', isExternal: kind === 'EXTERNAL',
        certificateId: kind === 'SYSTEM' ? 'cert-1' : null, certificateNumber: kind === 'SYSTEM' ? 'WHT-1' : 'PAPER-1',
        certificateDate: NOW, actorUserId: 'u2', reason: 'บันทึกผิดรายการ', taxFilingAttested: true,
        ...(kind === 'EXTERNAL' ? { detailsJson: { externalEvidenceRef: 'evidence', linkNote: 'note', linkedAt: NOW.toISOString(), linkedByUserId: 'u1' } } : {}) });
      if (kind === 'SYSTEM') { assert.equal(h.client.state.certificates[0].status, 'VOIDED'); assert.equal(h.client.state.certificates[0].voidReason, 'SOURCE_VOIDED'); }
      assert.equal(h.client.state.audits[0].metadataJson.source, 'expense_void');
      await assert.rejects(h.run()); assert.equal(h.client.state.history.length, 1);
    });
  }
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) {
    it(`gives the ${kind} permission sentence`, async () => {
      const h = setup(kind);
      await assert.rejects(h.run({ permissions: ['expense.void'] }), (error: any) => {
        assert.equal(error.getResponse().message, kind === 'SYSTEM'
          ? 'เอกสารนี้ออกหนังสือรับรอง 50 ทวิแล้ว (เลขที่ WHT-1) การยกเลิกเอกสารจะยกเลิกหนังสือรับรองด้วย ซึ่งต้องใช้สิทธิ์จัดการหนังสือรับรอง 50 ทวิ ให้เจ้าของกิจการหรือผู้ที่มีสิทธิ์นั้นเป็นผู้ยกเลิก'
          : 'เอกสารนี้บันทึกไว้ว่าออกหนังสือรับรอง 50 ทวินอกระบบแล้ว (เลขที่ PAPER-1) การยกเลิกเอกสารจะยกเลิกการบันทึกนั้นด้วย ซึ่งต้องใช้สิทธิ์บันทึกหนังสือรับรองที่ทำนอกระบบ ให้ผู้ที่มีสิทธิ์นั้นเป็นผู้ยกเลิก');
        return true;
      });
    });
    for (const status of ['FILED', 'PAID', 'CLOSED']) it(`cancels ${kind} in a ${status} withholding month and records certificate history`, async () => {
      const h = setup(kind); h.client.state.taxPeriods.push({ companyId: CO, formType: 'PND53', periodKey: '2026-07', status });
      await h.run();
      assert.equal(h.client.state.expenses[0].status, 'VOIDED');
      assert.equal(h.client.state.history.length, 1);
      assert.equal(h.client.state.history[0].actorUserId, 'u2');
      assert.equal(h.client.state.taxPeriods[0].status, status);
    });
  }
  it('cancels when the filed event month differs from the source date', async () => {
    const h = setup('EXTERNAL');
    h.client.state.taxEvents.push({ companyId: CO, sourceType: 'expense.record', sourceId: 'exp_1', status: 'ACTIVE', taxPeriodId: 'old-period' });
    h.client.state.taxPeriods.push({ id: 'old-period', companyId: CO, formType: 'PND3', periodKey: '2026-06', status: 'FILED' });
    await h.run();
    assert.equal(h.client.state.expenses[0].status, 'VOIDED');
    assert.equal(h.client.state.taxEvents[0].status, 'ACTIVE');
  });
  it('cancels a REQUIRED handoff without history or attestation and leaves confirmed tax events alone', async () => {
    const h = setup('REQUIRED');
    h.client.taxReviewIssue.updateMany = async ({ where }: any) => {
      assert.deepEqual(where.issueCode.in, ['WHT_PAYEE_KIND_UNKNOWN', 'MISSING_TAX_ID', 'FUNCTIONAL_CURRENCY_FX_MISSING', 'WHT_RATE_MISMATCH']);
      assert.deepEqual(where.taxPeriod.formType.in, ['PND2', 'PND3', 'PND53']); return { count: 0 };
    };
    h.client.taxEvent.updateMany = async ({ where, data }: any) => {
      assert.equal(where.status, 'EXCLUDED', 'ACTIVE events must stay on the tax-sync path');
      assert.equal(data.status, 'SUPERSEDED'); return { count: 0 };
    };
    await h.run({ permissions: [], taxFilingAttested: false });
    assert.equal(h.handoff.status, 'CANCELLED'); assert.equal(h.handoff.certificateRound, 0); assert.equal(h.client.state.history.length, 0);
  });
  it('keeps certificate-free void unchanged even with a filed withholding period', async () => {
    const h = setup(); h.client.state.taxPeriods.push({ companyId: CO, formType: 'PND53', periodKey: '2026-07', status: 'FILED' });
    await h.run({ permissions: [], taxFilingAttested: false }); assert.equal(h.client.state.expenses[0].status, 'VOIDED');
  });
  for (const match of ['issued certificate', 'SYSTEM_ISSUED', 'EXTERNAL_LINKED', 'certificate pointer', 'external date']) it(`refuses a tax-event-only ${match} before mutation`, async () => {
    const h = setup();
    h.client.state.taxEvents.push({ id: 'event-1', companyId: CO, sourceType: 'expense.record', sourceId: 'exp_1', status: 'ACTIVE' });
    if (match === 'issued certificate') h.client.state.certificates.push({ id: 'tax-cert', companyId: CO, status: 'ISSUED', taxEventIdsJson: ['event-1'] });
    else h.client.state.handoffs.push({ id: 'tax-handoff', companyId: CO, sourcePaymentType: 'tax.workspace', sourcePaymentId: 'other', taxEventIdsJson: ['event-1'],
      status: ['SYSTEM_ISSUED', 'EXTERNAL_LINKED'].includes(match) ? match : 'REQUIRED',
      certificateId: match === 'certificate pointer' ? 'tax-cert' : null, externalIssuedDate: match === 'external date' ? NOW : null });
    await assert.rejects(h.run(), (error: any) => {
      assert.equal(error.getResponse().code, 'certificate_issued');
      assert.equal(error.getResponse().message, 'รายจ่ายนี้มีหนังสือรับรอง 50 ทวิที่ออกจากหน้าภาษี จึงยกเลิกเอกสารจากหน้านี้ไม่ได้ แจ้งทีมงานมั่งมีเพื่อช่วยตรวจสอบ');
      return true;
    });
    assert.equal(h.client.state.expenses[0].status, 'CONFIRMED');
    assert.equal(h.client.state.history.length, 0);
    assert.equal(h.client.state.journalEntries.length, 1);
  });
  it('ignores a voided tax-event certificate and an unrelated issued certificate', async () => {
    const h = setup();
    h.client.state.taxEvents.push({ id: 'event-1', companyId: CO, sourceType: 'expense.record', sourceId: 'exp_1', status: 'ACTIVE' });
    h.client.state.certificates.push({ id: 'old', companyId: CO, status: 'VOIDED', taxEventIdsJson: ['event-1'] },
      { id: 'unrelated', companyId: CO, status: 'ISSUED', taxEventIdsJson: ['other-event'] });
    await h.run();
    assert.equal(h.client.state.expenses[0].status, 'VOIDED');
  });
  it('legacy month allows cancellation and claim preflight while retaining its filed state', async () => {
    for (const kind of ['SYSTEM', 'EXTERNAL'] as const) for (const formType of ['PND3', 'PND53']) {
      const h = setup(kind);
      h.client.taxPeriod.findMany = async ({ where }: any) => where.whtFilings ? [] : [{ formType, periodKey: '2026-07', status: 'FILED', whtFilings: [] }];
      assert.equal(await findClaimExpenseVoidBlocker(h.client, CO, 'exp_1'), null);
      await h.run();
      assert.equal(h.client.state.expenses[0].status, 'VOIDED');
    }
  });
  it('allows claim cancellation preflight with an own certificate in an open period', async () => {
    const h = setup('SYSTEM');
    assert.equal(await findClaimExpenseVoidBlocker(h.client, CO, 'exp_1'), null);
  });
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) it(`uses stored claim authorisation to cancel ${kind} without user certificate permissions`, async () => {
    const h = setup(kind);
    await h.run({ permissions: [], authorisedByClaimCancellation: true });
    assert.equal(h.handoff.status, 'CANCELLED');
    assert.equal(h.client.state.history.length, 1);
    assert.equal(h.client.state.history[0].taxFilingAttested, true);
  });
  it('keeps tax-workspace certificate blockers and ignores cancelled certificates', async () => {
    const h = setup('EXTERNAL');
    h.client.state.taxEvents.push({ id: 'event-1', companyId: CO, sourceType: 'expense.record', sourceId: 'exp_1', status: 'ACTIVE', taxPeriodId: 'locked' });
    h.client.state.certificates.push({ id: 'tax-cert', companyId: CO, status: 'ISSUED', taxEventIdsJson: ['event-1'] });
    h.client.state.taxPeriods.push({ id: 'locked', companyId: CO, formType: 'PND53', periodKey: '2026-06', status: 'FILED' });
    assert.deepEqual(await findClaimExpenseVoidBlocker(h.client, CO, 'exp_1'), { code: 'certificate_issued' });
    const readPeriods = h.client.taxPeriod.findMany;
    h.client.taxPeriod.findMany = async (query: any) => query.where.whtFilings ? [] : readPeriods(query);
    assert.deepEqual(await findClaimExpenseVoidBlocker(h.client, CO, 'exp_1'), { code: 'certificate_issued' });
    h.client.state.certificates[0].status = 'VOIDED';
    assert.equal(await findClaimExpenseVoidBlocker(h.client, CO, 'exp_1'), null);
  });
});


describe('disbursement reservation expense boundaries (B5b)', () => {
  function setup(name: string | null = 'สมใจ') {
    const seed = confirmedExpenseSeed();
    Object.assign(seed.expenses[0]!, { branchId: 'branch-1', postingStatus: 'not_required', journalEntryId: null, reservedByDisbursementVoucherId: 'voucher-1' });
    seed.journalEntries = [];
    const client = makeClient({ ...seed, vouchers: [{ id: 'voucher-1', companyId: CO, documentNumber: 'DV-1', preparedByUserId: 'preparer-1' }], users: name ? [{ id: 'preparer-1', displayName: name }] : [] });
    return { client, repo: new PrismaExpenseRepository({ client } as any) };
  }
  for (const name of ['สมใจ', null]) {
    const prefix = `รายการนี้อยู่ในใบเตรียมจ่ายเลขที่ DV-1${name ? ` จัดทำโดย ${name}` : ''} `;
    for (const operation of ['payment', 'reopen', 'void'] as const) it(`refuses reserved ${operation} with ${name ? 'a preparer' : 'no preparer'} before writes`, async () => {
      const { client, repo } = setup(name);
      const run = operation === 'payment' ? () => repo.recordPaymentAtomic({ companyId: CO, expenseId: 'exp_1', actorUserId: 'u1', scopes: {}, idempotencyKey: 'pay-1', amount: '10' })
        : operation === 'reopen' ? () => repo.reopenExpenseAtomic({ companyId: CO, expenseId: 'exp_1', actorUserId: 'u1', scopes: {}, reason: 'ข้อมูลผิด' })
        : () => repo.voidExpenseTrueReversal(CO, 'exp_1', 'u1', 'ข้อมูลผิด');
      const remedy = 'ให้ติดต่อผู้จัดทำใบนั้นเพื่อนำรายการนี้ออกจากใบหรือยกเลิกใบก่อน';
      await assert.rejects(run, (error: any) => { assert.equal(error.getResponse().message, prefix + remedy); return true; });
      assert.equal(client.state.expenses[0].status, 'CONFIRMED');
      assert.equal(client.state.expensePayments.length, 0);
    });
  }
  it('chooses reservation remedies from the viewer complete document scope and lifecycle rights', async () => {
    for (const viewerMay of ['act', 'open', 'none'] as const) {
      for (const operation of ['payment', 'reopen', 'void'] as const) {
        const { client, repo } = setup(); await client.disbursementVoucher.update({ where: { id: 'voucher-1' }, data: { status: 'PENDING_APPROVAL' } });
        const permissions = ['expense.read', 'expense.confirm', 'expense.payment.record', ...(viewerMay !== 'none' ? ['expense.disbursement.read'] : []), ...(viewerMay === 'act' ? ['expense.disbursement.prepare'] : [])];
        const original = client.disbursementVoucher.findMany;
        client.disbursementVoucher.findMany = async (args: any) => args.where.lines ? viewerMay === 'none' ? [] : [{ id: 'voucher-1' }] : original(args);
        const caller = { companyId: CO, scopes: {} };
        const cap = await repo.expenseCorrectionCapabilities(CO, 'exp_1', permissions, caller);
        assert.equal(cap.disbursementReservation?.viewerMay, viewerMay);
        const run = operation === 'payment' ? () => repo.recordPaymentAtomic({ companyId: CO, expenseId: 'exp_1', actorUserId: 'u1', scopes: {}, permissions, viewerReadScope: caller, idempotencyKey: 'pay', amount: '10' } as any)
          : operation === 'reopen' ? () => repo.reopenExpenseAtomic({ companyId: CO, expenseId: 'exp_1', actorUserId: 'u1', scopes: {}, permissions, viewerReadScope: caller, reason: 'ข้อมูลผิด' })
          : () => repo.voidExpenseTrueReversal(CO, 'exp_1', 'u1', 'ข้อมูลผิด', undefined, [], undefined, { permissions, viewerReadScope: caller } as any);
        await assert.rejects(run, (e: any) => {
          const message = e.getResponse().message;
          if (viewerMay === 'open') assert.match(message, /ให้ผู้จัดทำหรือผู้อนุมัติของใบนั้นกด "กลับไปแก้" หรือยกเลิกใบก่อน/);
          if (viewerMay === 'none') { assert.match(message, /ให้ติดต่อผู้จัดทำใบนั้นเพื่อนำรายการนี้ออกจากใบหรือยกเลิกใบก่อน/); assert.doesNotMatch(message, /กลับไปแก้/); }
          if (viewerMay === 'act') assert.doesNotMatch(message, /ให้ติดต่อ|ให้ผู้จัดทำหรือผู้อนุมัติ/);
          return true;
        });
      }
    }
  });

  it('offers payment from a reserved document only to a viewer holding its pay right', async () => {
    for (const mayPay of [false, true]) {
      const { client, repo } = setup(); await client.disbursementVoucher.update({ where: { id: 'voucher-1' }, data: { status: 'APPROVED' } });
      const permissions = ['expense.read', 'expense.payment.record', 'expense.disbursement.read', 'expense.disbursement.prepare', ...(mayPay ? ['expense.disbursement.pay'] : [])];
      const caller = { companyId: CO, scopes: {} };
      const cap = await repo.expenseCorrectionCapabilities(CO, 'exp_1', permissions, caller);
      assert.equal(cap.disbursementReservation?.viewerCanPay, mayPay);
      await assert.rejects(() => repo.recordPaymentAtomic({ companyId: CO, expenseId: 'exp_1', actorUserId: 'u1', scopes: {}, permissions, viewerReadScope: caller, idempotencyKey: 'pay', amount: '10' }), (e: any) => {
        assert.match(e.getResponse().message, mayPay ? /ให้บันทึกจ่ายจากใบนั้น หรือยกเลิกใบนั้นก่อนถ้าจะจ่ายแยก/ : /ให้ผู้มีสิทธิ์บันทึกจ่ายบันทึกจากใบนั้น หรือยกเลิกใบนั้นก่อนถ้าจะจ่ายแยก/); return true;
      });
    }
  });

  it('capabilities reveal the voucher link only with read permission and its complete read scope', async () => {
    const { client, repo } = setup();
    let readWhere: any;
    const original = client.disbursementVoucher.findMany;
    client.disbursementVoucher.findMany = async (args: any) => {
      if (args.where.lines) { readWhere = args.where; return args.where.branchId?.in?.includes('branch-1') ? [{ id: 'voucher-1' }] : []; }
      return original(args);
    };
    const permissions = ['expense.confirm', 'expense.payment.record'];
    for (const [allowed, scope] of [[false, { permissions, scopes: {} }], [true, { permissions: [...permissions, 'expense.disbursement.read'], scopes: { branchIds: ['branch-1'] }, createdByUserId: 'u1' }], [false, { permissions: [...permissions, 'expense.disbursement.read'], scopes: { branchIds: ['other'] } }]] as const) {
      const cap = await (repo.expenseCorrectionCapabilities as any)(CO, 'exp_1', scope.permissions, scope);
      assert.deepEqual(cap.disbursementReservation, { voucherId: allowed ? 'voucher-1' : null, documentNumber: 'DV-1', preparerName: 'สมใจ', viewerMay: allowed ? 'open' : 'none', viewerCanPay: false });
      assert.equal(cap.recordPaymentBlocker, 'disbursement_reserved');
      assert.deepEqual(cap.reopenBlockers, ['disbursement_reserved']);
      assert.equal(cap.canRecordPayment, false); assert.equal(cap.canReopen, false);
      if (allowed) assert.equal(readWhere.lines.every.expense.is.createdByUserId, 'u1');
    }
  });
  it('only the matching document may use the internal payment escape', async () => {
    const { client, repo } = setup();
    client.expensePayment.create = async ({ data }: any) => {
      const row = { ...data, id: 'payment-1', createdAt: NOW, updatedAt: NOW };
      client.state.expensePayments.push(row); return row;
    };
    const input = { companyId: CO, expenseId: 'exp_1', actorUserId: 'u1', scopes: {}, idempotencyKey: 'pay-1', amount: '10' };
    await assert.rejects(repo.recordPaymentAtomic({ ...input, payingThroughDisbursementVoucherId: 'another-voucher' }), /ใบเตรียมจ่ายเลขที่ DV-1/);
    const result = await repo.recordPaymentAtomic({ ...input, payingThroughDisbursementVoucherId: 'voucher-1' });
    assert.equal(result.payment.amount, '10.0000'); assert.equal(client.state.expensePayments.length, 1);
  });
  it('the batch reader excludes unreserved rows and retains a dangling pointer as a blocker', async () => {
    const { client } = setup();
    client.state.expenses.push({ id: 'unreserved', companyId: CO, reservedByDisbursementVoucherId: null },
      { id: 'missing', companyId: CO, reservedByDisbursementVoucherId: 'missing-voucher' },
      { id: 'foreign', companyId: 'other-company', reservedByDisbursementVoucherId: 'voucher-1' });
    const findUsers = client.user.findMany;
    client.user.findMany = (args: any) => { assert.deepEqual(args.where.memberships, { some: { companyId: CO } }); return findUsers(args); };
    const reservations = await readDisbursementReservations(client, CO, ['exp_1', 'unreserved', 'missing', 'foreign']);
    assert.deepEqual([...reservations.keys()], ['exp_1', 'missing']);
    assert.deepEqual(reservations.get('missing'), { voucherId: 'missing-voucher', documentNumber: null, preparerName: null, canOpen: false, viewerMay: 'none', viewerCanPay: false });
  });
  it('E4 ignores a cancelled personal receipt for confirmation, payment and detail capabilities', async () => {
    const { client, repo } = setup();
    client.state.expenses[0].reservedByDisbursementVoucherId = null;
    const evidence = { companyId: CO, expenseId: 'exp_1', status: 'PREPARED', fundingSource: 'PERSONAL_ADVANCE', version: 1 };
    client.state.substituteEvidence.push(evidence);
    for (const kind of ['confirm', 'payment'] as const) await assert.rejects(assertFundingMutation(client, CO, 'exp_1', kind), /พนักงานจ่ายร้านแล้ว/);
    assert.equal((await repo.expenseCorrectionCapabilities(CO, 'exp_1', ['expense.payment.record'])).recordPaymentBlocker, 'personal_advance');
    evidence.status = 'SUPERSEDED';
    for (const kind of ['confirm', 'payment'] as const) await assertFundingMutation(client, CO, 'exp_1', kind);
    const cap = await repo.expenseCorrectionCapabilities(CO, 'exp_1', ['expense.confirm', 'expense.payment.record']);
    assert.equal(cap.recordPaymentBlocker, null); assert.equal(cap.canReopen, true);
    assert.equal((cap as any).disbursementReservation, null);
  });
});


describe('disbursement expense reservation boundaries (real PostgreSQL, B5b)', () => {
  const companyId = `disbursement-boundary-${randomUUID()}`;
  const userId = `${companyId}-user`;
  let branchId: string; let clients: PrismaClient[] = []; let ready = false; let created = false; let unreachable: string | null = null;
  before(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) { assert.notEqual(process.env.EXPENSE_PAYMENT_REQUIRE_POSTGRES, 'true', 'PostgreSQL is required'); return; }
    clients = [0, 1].map(() => new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }));
    unreachable = await pgSpecUnreachableReason(() => clients[0]!.$queryRaw`SELECT "reservedByDisbursementVoucherId" FROM "ExpenseRecord" LIMIT 0`, 'EXPENSE_PAYMENT_REQUIRE_POSTGRES');
    if (unreachable) return;
    await clients[0]!.company.create({ data: { id: companyId, name: 'Disbursement reservation tests' } }); created = true;
    await clients[0]!.user.create({ data: { id: userId, displayName: 'สมใจ' } });
    await clients[0]!.companyMembership.create({ data: { companyId, userId } });
    branchId = (await clients[0]!.branch.create({ data: { companyId, code: 'HO', name: 'สำนักงานใหญ่' } })).id;
    ready = true;
  });
  after(async () => {
    try {
      if (created) {
        await clients[0]!.disbursementVoucher.deleteMany({ where: { companyId } });
        await clients[0]!.expensePayment.deleteMany({ where: { companyId } });
        await clients[0]!.expenseRecord.deleteMany({ where: { companyId } });
        await clients[0]!.company.delete({ where: { id: companyId } });
        await clients[0]!.user.deleteMany({ where: { id: userId } });
      }
    } finally { await Promise.all(clients.map(client => client.$disconnect())); }
  });
  async function source() {
    const client = clients[0]!;
    const expense = await client.expenseRecord.create({ data: { companyId, branchId, createdByUserId: userId, expenseDate: NOW,
      status: 'CONFIRMED', postingStatus: 'not_required', subtotalAmount: '100', taxableAmount: '100', grandTotalAmount: '100', netPayableAmount: '100', outstandingAmount: '100' } });
    const voucher = await client.disbursementVoucher.create({ data: { companyId, branchId, origin: 'PREPARED', status: 'APPROVED',
      documentNumber: `DV-${randomUUID()}`, payeeName: 'ผู้ขาย', payeeBasis: 'SINGLE', totalAmount: '100', preparedByUserId: userId,
      lines: { create: { expenseId: expense.id, position: 1, amount: '100' } } } });
    return { expense, voucher };
  }
  for (const operation of ['payment', 'reopen', 'void'] as const) it(`refuses a reserved ${operation} using the committed column`, async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { expense, voucher } = await source(); const client = clients[0]!;
    await client.$executeRaw`UPDATE "ExpenseRecord" SET "reservedByDisbursementVoucherId" = ${voucher.id} WHERE id = ${expense.id}`;
    const repo = new PrismaExpenseRepository({ client } as any);
    const input = { companyId, expenseId: expense.id, actorUserId: userId, scopes: {}, idempotencyKey: randomUUID(), amount: '10' };
    const run = operation === 'payment' ? () => repo.recordPaymentAtomic(input) : operation === 'reopen'
      ? () => repo.reopenExpenseAtomic({ ...input, reason: 'ข้อมูลผิด' }) : () => repo.voidExpenseTrueReversal(companyId, expense.id, userId, 'ข้อมูลผิด');
    // These callers pass no rights on the document, so the sentence names no button of it.
    const remedy = 'ให้ติดต่อผู้จัดทำใบนั้นเพื่อนำรายการนี้ออกจากใบหรือยกเลิกใบก่อน';
    await assert.rejects(run, (error: any) => { assert.equal(error.getResponse().message, `รายการนี้อยู่ในใบเตรียมจ่ายเลขที่ ${voucher.documentNumber} จัดทำโดย สมใจ ${remedy}`); return true; });
    assert.equal(await client.expensePayment.count({ where: { expenseId: expense.id } }), 0);
    assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).status, 'CONFIRMED');
    assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).updatedAt.getTime(), expense.updatedAt.getTime());
  });
  it('a reservation committed after the void snapshot rolls back once and reaches the user as expense_changed_retry', { timeout: 20_000 }, async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { expense, voucher } = await source(); const client = clients[0]!;
    let snapshotRead!: () => void; const snapshot = new Promise<void>(resolve => { snapshotRead = resolve; });
    let locked!: () => void; const lockReady = new Promise<void>(resolve => { locked = resolve; });
    let attempts = 0; let rawError: any;
    const reserve = clients[1]!.$transaction(async (tx) => {
      await lockExpenseFunding(tx, companyId, expense.id); await lockExpenseCorrection(tx, companyId, expense.id);
      locked(); await snapshot;
      await tx.$executeRaw`UPDATE "ExpenseRecord" SET "reservedByDisbursementVoucherId" = ${voucher.id} WHERE id = ${expense.id}`;
    }, { timeout: 15_000 });
    await lockReady;
    const racingClient = new Proxy(client, { get(target, field) {
      if (field === '$transaction') return (work: any, options: any) => target.$transaction(async (tx) => {
        attempts++;
        return work(new Proxy(tx, { get(transaction, key) {
          if (key === 'attachmentLink') return new Proxy(transaction.attachmentLink, { get(model, method) {
            if (method === 'findMany') return async (args: any) => {
              const rows = await model.findMany(args); snapshotRead(); await reserve; return rows;
            };
            return Reflect.get(model, method);
          } });
          if (key === 'expenseRecord') return new Proxy(transaction.expenseRecord, { get(model, method) {
            if (method === 'updateMany') return async (args: any) => {
              try { return await model.updateMany(args); } catch (error) { rawError = error; throw error; }
            };
            return Reflect.get(model, method);
          } });
          return Reflect.get(transaction, key);
        } }));
      }, { ...options, timeout: 15_000 });
      return Reflect.get(target, field);
    } });
    const useCase = new VoidExpenseUseCase(new PrismaExpenseRepository({ client: racingClient } as any),
      { log: async () => undefined } as any, { append: async () => undefined } as any, {} as any, {} as any, {} as any);
    try {
      await assert.rejects(useCase.execute({ companyId, userId, scopes: {}, permissions: ['expense.void'] } as any, expense.id, 'ข้อมูลผิด'), (error: any) => {
        assert.equal(error.getResponse().code, 'expense_changed_retry');
        assert.equal(error.getResponse().message, 'มีคนทำรายการกับเอกสารนี้พร้อมกัน ระบบยังไม่ได้บันทึกการยกเลิก เปิดหน้านี้ใหม่แล้วลองอีกครั้ง'); return true;
      });
      assert.equal(rawError?.code, 'P2034'); assert.equal(attempts, 1);
      const current = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
      assert.equal(current.status, 'CONFIRMED'); assert.equal(current.reservedByDisbursementVoucherId, voucher.id);
      assert.equal(current.updatedAt.getTime(), expense.updatedAt.getTime());
      assert.equal(await client.journalEntry.count({ where: { companyId } }), 0);
    } finally { snapshotRead(); await reserve; }
  });
});

it('voids a covered payment and cancels its paid document without taking the document lifecycle lock', async () => {
  const seed = confirmedExpenseSeed();
  const voucher = { id: 'dv_1', companyId: CO, status: 'PAID', version: 2, documentNumber: 'PV-1', paidSnapshotJson: { frozen: true } };
  const line = { companyId: CO, voucherId: voucher.id, expensePaymentId: 'pay_1', coversPaymentId: 'pay_1' };
  const client = makeClient({ ...seed, expensePayments: [{ id: 'pay_1', companyId: CO, expenseId: 'exp_1', status: 'RECORDED', amount: '50' }], vouchers: [voucher], voucherLines: [line] });
  const locks: string[] = []; client.$executeRaw = async (_parts: any, value: string) => { if (value) locks.push(value); return 0; };
  await new PrismaExpenseRepository({ client } as any).voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'รายการผิด', 'JV-VOID');
  assert.equal(voucher.status, 'CANCELLED'); assert.equal((voucher as any).cancelledAfterPaid, true); assert.equal((voucher as any).cancelReason, 'เอกสาร EXP-1 ถูกยกเลิก'); assert.equal((voucher as any).cancelSourceReason, 'รายการผิด');
  assert.equal(line.coversPaymentId, null); assert.equal(line.expensePaymentId, 'pay_1'); assert.deepEqual(voucher.paidSnapshotJson, { frozen: true });
  assert.ok(locks.every(key => !key.includes('disbursement-voucher-lifecycle')));
});

describe('R6 e-WHT void/reopen lifecycle (real PostgreSQL, owned paid tenant)', () => {
  const companyId = `ewht-lifecycle-${randomUUID()}`, userId = `${companyId}-actor`;
  let client: PrismaClient | undefined, branchId: string, ready = false, created = false, unavailable: string | null = null;
  before(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) { assert.notEqual(process.env.EXPENSE_PAYMENT_REQUIRE_POSTGRES, 'true', 'PostgreSQL required'); return; }
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    unavailable = await pgSpecUnreachableReason(() => client!.$queryRaw`SELECT "whtRemittance" FROM "ExpenseRecord" LIMIT 0`, 'EXPENSE_PAYMENT_REQUIRE_POSTGRES');
    if (unavailable) return;
    await client.company.create({ data: { id: companyId, name: 'e-WHT lifecycle fixture' } }); created = true;
    await client.user.create({ data: { id: userId, displayName: 'ผู้ตรวจทดสอบ' } });
    branchId = (await client.branch.create({ data: { companyId, code: 'HO', name: 'สำนักงานใหญ่' } })).id; ready = true;
  });
  after(async () => {
    if (!client) return;
    try { if (created) {
      await client.whtFilingLine.deleteMany({ where: { filing: { companyId } } });
      await client.whtFiling.deleteMany({ where: { companyId } });
      await client.taxReviewIssue.deleteMany({ where: { companyId } });
      await client.taxEvent.deleteMany({ where: { companyId } });
      await client.expensePayment.deleteMany({ where: { companyId } });
      await client.expenseRecord.deleteMany({ where: { companyId } });
      await client.taxPeriod.deleteMany({ where: { companyId } });
      await client.company.delete({ where: { id: companyId } });
      await client.user.delete({ where: { id: userId } });
    } } finally { await client.$disconnect(); }
  });
  async function source(remittance: 'E_WHT' | 'PAYER_FILES' = 'E_WHT', locked = false) {
    const period = await client!.taxPeriod.upsert({ where: { companyId_formType_periodKey: { companyId, formType: 'PND3', periodKey: '2026-09' } },
      create: { companyId, taxType: 'WHT', formType: 'PND3', periodKey: '2026-09', status: locked ? 'FILED' : 'OPEN' }, update: { status: locked ? 'FILED' : 'OPEN' } });
    const expense = await client!.expenseRecord.create({ data: { companyId, branchId, createdByUserId: userId, expenseDate: new Date('2026-09-10'),
      status: 'CONFIRMED', postingStatus: 'not_required', vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE', whtRemittance: remittance,
      vendorEntityKindSnapshot: 'INDIVIDUAL', subtotalAmount: '100', taxableAmount: '100', grandTotalAmount: '100', whtAmount: '1', netPayableAmount: '99', paidAmount: '99', outstandingAmount: '0', paymentStatus: 'PAID' } });
    const payment = await client!.expensePayment.create({ data: { companyId, expenseId: expense.id, amount: '99', currency: 'THB', paymentMethod: 'BANK_TRANSFER', paidAt: new Date('2026-09-10'),
      paidAtConfirmed: true, status: 'RECORDED', postingStatus: 'not_required', createdByUserId: userId,
      idempotencyKey: randomUUID(), payloadFingerprint: canonicalFingerprint({ expenseId: expense.id, amount: '99', paymentMethod: 'BANK_TRANSFER' }) } });
    const event = await client!.taxEvent.create({ data: { companyId, branchId, taxPeriodId: period.id, eventType: 'WHT_PND3', status: remittance === 'E_WHT' ? 'EXCLUDED' : 'ACTIVE',
      sourceType: 'expense.record', sourceId: expense.id, sourceLineKey: `payment:${payment.id}`, sourceEventType: remittance === 'E_WHT' ? 'expense.wht.e_wht' : 'expense.wht',
      idempotencyKey: randomUUID(), periodKey: '2026-09', eventDate: new Date('2026-09-10'), taxableBase: '100', taxAmount: '1', currency: 'THB', whtFormType: 'PND3' } });
    const issue = await client!.taxReviewIssue.create({ data: { companyId, taxPeriodId: period.id, sourceType: 'expense.record', sourceId: expense.id, issueCode: 'WHT_RATE_MISMATCH', severity: 'WARNING', description: 'ตรวจอัตรา' } });
    return { expense, payment, period, event, issue, repo: new PrismaExpenseRepository({ client } as any) };
  }
  for (const action of ['void', 'reopen'] as const) it(`supersedes EXCLUDED and resolves its warning inside ${action}, before sync`, async t => {
    if (!ready) return t.skip(unavailable ?? 'DATABASE_URL is not set');
    const h = await source();
    if (action === 'void') await h.repo.voidExpenseTrueReversal(companyId, h.expense.id, userId, 'ยกเลิกรายการทดสอบ');
    else await h.repo.reopenExpenseAtomic({ companyId, expenseId: h.expense.id, actorUserId: userId, scopes: {}, reason: 'แก้ข้อมูลทดสอบ', permissions: ['expense.confirm'] });
    assert.equal((await client!.taxEvent.findUniqueOrThrow({ where: { id: h.event.id } })).status, 'SUPERSEDED');
    assert.equal((await client!.taxReviewIssue.findUniqueOrThrow({ where: { id: h.issue.id } })).status, 'RESOLVED');
  });
  it('bypasses a legacy month lock only for e-WHT; payer-files remains blocked', async t => {
    if (!ready) return t.skip(unavailable ?? 'DATABASE_URL is not set');
    const bank = await source('E_WHT', true), payer = await source('PAYER_FILES', true);
    await bank.repo.reopenExpenseAtomic({ companyId, expenseId: bank.expense.id, actorUserId: userId, scopes: {}, reason: 'แก้ข้อมูลทดสอบ', permissions: ['expense.confirm'] });
    await assert.rejects(() => payer.repo.reopenExpenseAtomic({ companyId, expenseId: payer.expense.id, actorUserId: userId, scopes: {}, reason: 'แก้ข้อมูลทดสอบ', permissions: ['expense.confirm'] }),
      (e: any) => e.getResponse().blockers.includes('tax_period_filed'));
  });
  it('still blocks e-WHT when an actual FILED line covers its current payment', async t => {
    if (!ready) return t.skip(unavailable ?? 'DATABASE_URL is not set');
    const h = await source('E_WHT', true);
    const paper = await client!.whtFiling.create({ data: { companyId, taxPeriodId: h.period.id, formType: 'PND3', periodKey: '2026-09', establishmentCode: '00000',
      preparedBy: userId, payerSnapshotJson: {}, rowsChecksum: 'fixture', status: 'FILED', rowsCertain: true, filedAt: new Date(), filedByUserId: userId } });
    await client!.whtFilingLine.create({ data: { whtFilingId: paper.id, rowNumber: 1, taxEventId: h.event.id, sourceType: 'expense.record', sourceId: h.expense.id,
      lineJson: { payment: [...Array(13).fill(null), `payment:${h.payment.id}`] } } });
    await assert.rejects(() => h.repo.reopenExpenseAtomic({ companyId, expenseId: h.expense.id, actorUserId: userId, scopes: {}, reason: 'แก้ข้อมูลทดสอบ', permissions: ['expense.confirm'] }),
      (e: any) => e.getResponse().blockers.includes('tax_period_filed'));
  });
});
