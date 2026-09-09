import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import {
  PrismaExpenseRepository,
  SUBSTITUTE_RECEIPT_EXPENSE_VOIDED_REASON,
} from './prisma-expense.repository';

// H-04 (expenses) closure evidence: void must be a true reversal — the status
// claim, payable zeroing, and reversing journal are one transaction, repeated
// or racing voids are rejected by the CAS claim, and locked accounting/tax
// periods block the whole void.

type Row = Record<string, any>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond instanceof Date && row[key] instanceof Date) return row[key].getTime() === cond.getTime();
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      if ('not' in cond) return row[key] !== cond.not;
      if ('in' in cond) return (cond.in as any[]).includes(row[key]);
      return true;
    }
    return row[key] === cond;
  });
}

// Minimal in-memory stand-in for the Prisma client covering exactly the query
// shapes the void transaction uses. $transaction runs the callback against the
// same store; rollback semantics are covered by the live-DB verification run.
function fakeClient(seed: {
  expenses?: Row[]; expenseLines?: Row[];
  expensePayments?: Row[];
  journalEntries?: Row[]; journalLines?: Row[]; periods?: Row[]; taxPeriods?: Row[];
  substituteEvidence?: Row[];
  documentNumbers?: Row[];
}) {
  const s = {
    expenses: seed.expenses ?? [], expenseLines: seed.expenseLines ?? [],
    expensePayments: seed.expensePayments ?? [],
    journalEntries: seed.journalEntries ?? [], journalLines: seed.journalLines ?? [],
    periods: seed.periods ?? [], taxPeriods: seed.taxPeriods ?? [],
    substituteEvidence: seed.substituteEvidence ?? [],
    documentNumbers: seed.documentNumbers ?? [],
  };
  let idSeq = 0;
  const table = (rows: Row[]) => ({
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
      hits.forEach((r) => Object.assign(r, data));
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
    expenseRecord,
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
      id: 'exp_1', companyId: CO, branchId: null, status: 'CONFIRMED', expenseNumber: 'EXP-1',
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

  it('rejects voiding an expense that is not CONFIRMED', async () => {
    client.state.expenses[0].status = 'READY_FOR_CONFIRMATION';
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

  it('still locks on PP30 via the claim-status fallback when lines carry no tax components', async () => {
    client.state.expenseLines[0].taxComponentsJson = null;
    client.state.taxPeriods.push({ id: 'tp_1', companyId: CO, formType: 'PP30', periodKey: '2026-07', status: 'FILED' });
    await assert.rejects(
      () => repo.voidExpenseTrueReversal(CO, 'exp_1', 'u2', 'เหตุผล', 'JV-REV-1'),
      ConflictException,
    );
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
