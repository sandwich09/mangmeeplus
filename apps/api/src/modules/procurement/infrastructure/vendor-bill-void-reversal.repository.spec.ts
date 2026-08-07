import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaProcurementRepository } from './prisma-procurement.repository.js';

// H-04 closure evidence for vendor bills: void is a true reversal executed in
// one transaction — CAS status claim, journal-table-driven reversal decision,
// original entry kept POSTED, and fail-closed period/tax locks.

function fixture(options: {
  casFails?: boolean;
  journalStatus?: string;
  periodStatus?: string;
  pp30Locked?: boolean;
  vatAmount?: string;
  priorReversal?: boolean;
  noJournal?: boolean;
} = {}) {
  const bill: any = {
    id: 'bill-1', companyId: 'company-1', status: 'APPROVED', paidAmount: '0', outstandingAmount: '107',
    vatAmount: options.vatAmount ?? '7', vendorBillNumber: 'VB-1', supplierId: 'supplier-1',
    billDate: new Date('2026-07-01'), dueDate: new Date('2026-07-31'), currency: 'THB',
    postingStatus: 'posted', createdAt: new Date(), updatedAt: new Date(),
  };
  const journalLines = [
    { accountId: 'acc-expense', branchId: null, lineNumber: 1, description: 'expense', debitAmount: '100', creditAmount: '0', currency: 'THB', taxCode: null },
    { accountId: 'acc-input-vat', branchId: null, lineNumber: 2, description: 'input vat', debitAmount: '7', creditAmount: '0', currency: 'THB', taxCode: 'V7' },
    { accountId: 'acc-ap', branchId: null, lineNumber: 3, description: 'payable', debitAmount: '0', creditAmount: '107', currency: 'THB', taxCode: null },
  ];
  const journals = options.noJournal ? [] : [{
    id: 'journal-1', periodId: 'period-1', entryNumber: 'JV-1', status: options.journalStatus ?? 'POSTED',
    sourceType: 'procurement.vendor_bill', sourceId: 'bill-1', entryDate: new Date('2026-07-01'),
    period: { status: options.periodStatus ?? 'OPEN', periodKey: '2026-07' }, lines: journalLines,
  }];
  const reversalCreates: any[] = [];
  const journalUpdates: any[] = [];
  const billUpdates: any[] = [];
  let taxPeriodCalls = 0;
  const client: any = {
    $transaction: async (fn: (tx: any) => unknown) => fn(client),
    vendorBill: {
      updateMany: async ({ where, data }: any) => {
        if (options.casFails || where.status !== 'APPROVED') return { count: 0 };
        Object.assign(bill, data);
        return { count: 1 };
      },
      findFirstOrThrow: async ({ include }: any) => include?.lines ? { ...bill, lines: [] } : bill,
      update: async ({ data }: any) => { billUpdates.push(data); Object.assign(bill, data); return bill; },
    },
    journalEntry: {
      findMany: async ({ where }: any) => where.entryType === 'GENERATED' ? journals
        : options.priorReversal ? [{ reversalOfJournalEntryId: 'journal-1' }] : [],
      create: async ({ data }: any) => { reversalCreates.push(data); return { id: `reversal-${reversalCreates.length}` }; },
      update: async ({ where, data }: any) => { journalUpdates.push({ id: where.id, ...data }); return {}; },
    },
    taxPeriod: {
      findFirst: async () => { taxPeriodCalls += 1; return options.pp30Locked ? { id: 'tax-period-1' } : null; },
    },
  };
  return {
    repo: new PrismaProcurementRepository({ client } as any),
    bill,
    get reversalCreates() { return reversalCreates; },
    get journalUpdates() { return journalUpdates; },
    get billUpdates() { return billUpdates; },
    get taxPeriodCalls() { return taxPeriodCalls; },
  };
}

describe('voidVendorBillTrueReversal (H-04)', () => {
  it('claims the status and creates a POSTED reversal that nets the generated journal to zero', async () => {
    const f = fixture();
    const result = await f.repo.voidVendorBillTrueReversal('company-1', 'bill-1', 'voider-1', 'duplicate bill', { 'journal-1': 'JV-R-1' });
    assert.equal(result.bill.status, 'VOIDED');
    assert.deepEqual(result.reversalJournals, [{ originalJournalId: 'journal-1', reversalJournalId: 'reversal-1' }]);
    assert.equal(f.reversalCreates.length, 1);
    const created = f.reversalCreates[0];
    assert.equal(created.entryType, 'REVERSAL');
    assert.equal(created.status, 'POSTED');
    assert.equal(created.entryNumber, 'JV-R-1');
    assert.equal(created.reversalOfJournalEntryId, 'journal-1');
    assert.equal(created.sourceType, 'procurement.vendor_bill');
    const lines = created.lines.create;
    assert.deepEqual(lines.map((line: any) => [String(line.debitAmount), String(line.creditAmount)]), [['0', '100'], ['0', '7'], ['107', '0']]);
    // Prisma 7 regression guard: companyId is inherited through the compound
    // journalEntry relation and must not appear in the nested line create.
    assert.ok(lines.every((line: any) => !('companyId' in line)));
    // Originals keep status POSTED so POSTED-only report queries net them
    // against the reversal entries — a status flip here double-subtracts.
    assert.deepEqual(f.journalUpdates, []);
    assert.equal(f.billUpdates.at(-1)?.postingStatus, 'reversed');
  });

  it('rejects with a conflict when the CAS claim loses (already voided, paid, or changed)', async () => {
    const f = fixture({ casFails: true });
    await assert.rejects(() => f.repo.voidVendorBillTrueReversal('company-1', 'bill-1', 'voider-1', 'reason', {}), ConflictException);
    assert.equal(f.reversalCreates.length, 0);
  });

  it('fails closed on an unresolved DRAFT generated journal', async () => {
    const f = fixture({ journalStatus: 'DRAFT' });
    await assert.rejects(() => f.repo.voidVendorBillTrueReversal('company-1', 'bill-1', 'voider-1', 'reason', { 'journal-1': 'JV-R-1' }), UnprocessableEntityException);
  });

  it('demands a retry when a posted journal has no reserved reversal number', async () => {
    const f = fixture();
    await assert.rejects(
      () => f.repo.voidVendorBillTrueReversal('company-1', 'bill-1', 'voider-1', 'reason', {}),
      (err: any) => err instanceof ConflictException && (err.getResponse() as any).code === 'posting_state_changed',
    );
  });

  it('fails closed when the accounting period is not open', async () => {
    const f = fixture({ periodStatus: 'CLOSED' });
    await assert.rejects(
      () => f.repo.voidVendorBillTrueReversal('company-1', 'bill-1', 'voider-1', 'reason', { 'journal-1': 'JV-R-1' }),
      (err: any) => err instanceof ConflictException && (err.getResponse() as any).code === 'accounting_period_locked',
    );
    assert.equal(f.reversalCreates.length, 0);
  });

  it('fails closed when the bill has VAT and PP30 for the journal period is filed', async () => {
    const f = fixture({ pp30Locked: true });
    await assert.rejects(
      () => f.repo.voidVendorBillTrueReversal('company-1', 'bill-1', 'voider-1', 'reason', { 'journal-1': 'JV-R-1' }),
      (err: any) => err instanceof ConflictException && (err.getResponse() as any).code === 'tax_period_locked',
    );
  });

  it('skips the PP30 lock for a bill without VAT', async () => {
    const f = fixture({ pp30Locked: true, vatAmount: '0' });
    const result = await f.repo.voidVendorBillTrueReversal('company-1', 'bill-1', 'voider-1', 'reason', { 'journal-1': 'JV-R-1' });
    assert.equal(f.taxPeriodCalls, 0);
    assert.equal(result.reversalJournals.length, 1);
  });

  it('treats an existing REVERSAL row as already reversed without creating another', async () => {
    const f = fixture({ priorReversal: true });
    const result = await f.repo.voidVendorBillTrueReversal('company-1', 'bill-1', 'voider-1', 'reason', {});
    assert.equal(result.bill.status, 'VOIDED');
    assert.deepEqual(result.reversalJournals, []);
    assert.equal(f.reversalCreates.length, 0);
    assert.equal(f.billUpdates.at(-1)?.postingStatus, 'reversed');
  });

  it('voids a never-posted bill without touching postingStatus or requiring a number', async () => {
    const f = fixture({ noJournal: true });
    const result = await f.repo.voidVendorBillTrueReversal('company-1', 'bill-1', 'voider-1', 'reason', {});
    assert.equal(result.bill.status, 'VOIDED');
    assert.deepEqual(result.reversalJournals, []);
    assert.deepEqual(f.billUpdates, []);
  });
});

describe('updateVendorBillStatus (H-04 guard)', () => {
  it('rejects VOIDED so voids cannot bypass the true-reversal path', async () => {
    const f = fixture();
    await assert.rejects(() => f.repo.updateVendorBillStatus('company-1', 'bill-1', 'VOIDED'), UnprocessableEntityException);
  });
});
