import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaAccountingRepository } from './prisma-accounting.repository';

// H-04 closure evidence: void must be a true reversal — allocation release,
// paid/outstanding restore, reversing journal, and status claim are one
// transaction, and repeated/racing voids are rejected by the CAS claim.

type Row = Record<string, any>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
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
  payments?: Row[]; allocations?: Row[]; documents?: Row[];
  journalEntries?: Row[]; journalLines?: Row[]; periods?: Row[]; taxPeriods?: Row[];
}) {
  const s = {
    payments: seed.payments ?? [], allocations: seed.allocations ?? [], documents: seed.documents ?? [],
    journalEntries: seed.journalEntries ?? [], journalLines: seed.journalLines ?? [],
    periods: seed.periods ?? [], taxPeriods: seed.taxPeriods ?? [],
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
    deleteMany: async ({ where }: any) => {
      const keep = rows.filter((r) => !matches(r, where));
      const count = rows.length - keep.length;
      rows.length = 0;
      rows.push(...keep);
      return { count };
    },
  });
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
    accountingPayment: table(s.payments),
    accountingPaymentAllocation: table(s.allocations),
    accountingDocument: table(s.documents),
    accountingPeriod: table(s.periods),
    taxPeriod: table(s.taxPeriods),
    journalEntry,
  };
}

function makeClient(seed: Parameters<typeof fakeClient>[0]) {
  const c: any = fakeClient(seed);
  c.$executeRaw = async () => 0;
  c.$transaction = async (fn: any) => fn(c);
  return c;
}

const CO = 'co_1';
const NOW = new Date('2026-07-18T00:00:00Z');

function paidPaymentSeed() {
  return {
    payments: [{
      id: 'pay_1', companyId: CO, status: 'RECORDED', direction: 'RECEIVED', method: 'TRANSFER',
      amount: '400.00', allocatedAmount: '400.00', unappliedAmount: '0.00', currency: 'THB',
      paidAt: NOW, postingStatus: 'posted', journalEntryId: 'je_orig', createdByUserId: 'u1',
      createdAt: NOW, updatedAt: NOW,
    }],
    allocations: [{ id: 'alloc_1', companyId: CO, paymentId: 'pay_1', documentId: 'doc_1', amount: '400.00' }],
    documents: [{
      id: 'doc_1', companyId: CO, documentType: 'INVOICE', documentNumber: 'INV-1', status: 'ISSUED',
      documentDate: NOW, currency: 'THB', vatMode: 'NO_VAT',
      subtotalAmount: '1000.00', discountAmount: '0.00', taxableAmount: '1000.00', vatAmount: '0.00',
      whtAmount: '0.00', grandTotalAmount: '1000.00', paidAmount: '400.00', outstandingAmount: '600.00',
      paymentStatus: 'PARTIALLY_PAID', postingStatus: 'posted', journalEntryId: 'je_doc',
      createdByUserId: 'u1', createdAt: NOW, updatedAt: NOW,
    }],
    journalEntries: [{
      id: 'je_orig', companyId: CO, periodId: 'p_1', entryNumber: 'JV-1', entryType: 'GENERATED',
      sourceType: 'accounting.payment', sourceId: 'pay_1', status: 'POSTED', entryDate: NOW,
    }],
    journalLines: [
      { id: 'jl_1', journalEntryId: 'je_orig', companyId: CO, accountId: 'acc_cash', lineNumber: 1, description: 'cash', debitAmount: '400.0000', creditAmount: '0.0000', currency: 'THB', taxCode: null, branchId: null },
      { id: 'jl_2', journalEntryId: 'je_orig', companyId: CO, accountId: 'acc_ar', lineNumber: 2, description: 'AR', debitAmount: '0.0000', creditAmount: '400.0000', currency: 'THB', taxCode: null, branchId: null },
    ],
    periods: [{ id: 'p_1', companyId: CO, periodKey: '2026-07', status: 'OPEN' }],
  };
}

describe('voidPaymentTrueReversal (H-04)', () => {
  let client: any;
  let repo: PrismaAccountingRepository;

  beforeEach(() => {
    client = makeClient(paidPaymentSeed());
    repo = new PrismaAccountingRepository({ client } as any);
  });

  it('restores document balances, releases the allocation, reverses the journal, and voids atomically', async () => {
    const result = await repo.voidPaymentTrueReversal(CO, 'pay_1', 'u2', 'บันทึกผิดรายการ', 'JV-REV-1');

    const payment = client.state.payments[0];
    assert.equal(payment.status, 'VOIDED');
    assert.equal(payment.allocatedAmount, '0.00');
    assert.equal(payment.unappliedAmount, '0.00');
    assert.equal(payment.postingStatus, 'reversed');

    const doc = client.state.documents[0];
    assert.equal(doc.paidAmount, '0.00');
    assert.equal(doc.outstandingAmount, '1000.00');
    assert.equal(doc.paymentStatus, 'UNPAID');

    assert.equal(client.state.allocations.length, 0);
    assert.equal(result.releasedAllocations.length, 1);
    assert.equal(result.releasedAllocations[0].amount, '400.00');

    const reversal = client.state.journalEntries.find((e: any) => e.entryType === 'REVERSAL');
    assert.ok(reversal, 'reversal entry must exist');
    assert.equal(reversal.entryNumber, 'JV-REV-1');
    assert.equal(reversal.status, 'POSTED');
    assert.equal(reversal.reversalOfJournalEntryId, 'je_orig');
    assert.equal(result.reversalEntryId, reversal.id);

    const revLines = client.state.journalLines.filter((l: any) => l.journalEntryId === reversal.id);
    const cash = revLines.find((l: any) => l.accountId === 'acc_cash');
    const ar = revLines.find((l: any) => l.accountId === 'acc_ar');
    assert.equal(cash.creditAmount, 400);
    assert.equal(cash.debitAmount, 0);
    assert.equal(ar.debitAmount, 400);
    assert.equal(ar.creditAmount, 0);

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

  it('skips creating a second reversal when one already exists for this source', async () => {
    client.state.journalEntries.push({
      id: 'je_rev_prior', companyId: CO, periodId: 'p_1', entryNumber: 'JV-R0', entryType: 'REVERSAL',
      sourceType: 'accounting.payment', sourceId: 'pay_1', status: 'POSTED', entryDate: NOW,
    });
    const result = await repo.voidPaymentTrueReversal(CO, 'pay_1', 'u2', 'เหตุผล', 'JV-REV-1');
    assert.equal(result.reversalEntryId, null);
    assert.equal(client.state.journalEntries.filter((e: any) => e.entryType === 'REVERSAL').length, 1);
    assert.equal(client.state.payments[0].postingStatus, 'reversed');
  });

  it('rejects a second void via the conditional status claim', async () => {
    await repo.voidPaymentTrueReversal(CO, 'pay_1', 'u2', 'บันทึกผิดรายการ', 'JV-REV-1');
    await assert.rejects(
      () => repo.voidPaymentTrueReversal(CO, 'pay_1', 'u2', 'ซ้ำ', 'JV-REV-2'),
      ConflictException,
    );
  });

  it('keeps a paid invoice and payment intact until its active receipt is voided', async () => {
    client.state.documents.push({
      id: 'receipt_1', companyId: CO, documentType: 'RECEIPT', documentNumber: 'RC-1', status: 'ISSUED',
      sourceDocumentId: 'doc_1', paidAmount: '0.00', outstandingAmount: '0.00',
    });

    await assert.rejects(
      () => repo.voidPaymentTrueReversal(CO, 'pay_1', 'u2', 'บันทึกผิดรายการ', 'JV-REV-1'),
      (error: unknown) => error instanceof UnprocessableEntityException
        && (error.getResponse() as any).code === 'accounting_active_receipt_must_be_voided',
    );
    assert.equal(client.state.payments[0].status, 'RECORDED');
    assert.equal(client.state.documents[0].paidAmount, '400.00');
    assert.equal(client.state.allocations.length, 1);
  });

  it('fails closed when a posted journal exists but no reversal number was reserved', async () => {
    await assert.rejects(
      () => repo.voidPaymentTrueReversal(CO, 'pay_1', 'u2', 'เหตุผล'),
      ConflictException,
    );
  });

  it('fails closed when the accounting period is closed', async () => {
    client.state.periods[0].status = 'CLOSED';
    await assert.rejects(
      () => repo.voidPaymentTrueReversal(CO, 'pay_1', 'u2', 'เหตุผล', 'JV-REV-1'),
      ConflictException,
    );
  });

  it('fails closed when the period row is missing entirely', async () => {
    client.state.periods.length = 0;
    await assert.rejects(
      () => repo.voidPaymentTrueReversal(CO, 'pay_1', 'u2', 'เหตุผล', 'JV-REV-1'),
      UnprocessableEntityException,
    );
  });

  it('voids an unposted payment without touching the ledger', async () => {
    client.state.journalEntries.length = 0;
    client.state.journalLines.length = 0;
    client.state.payments[0].postingStatus = 'pending';
    client.state.payments[0].journalEntryId = null;

    const result = await repo.voidPaymentTrueReversal(CO, 'pay_1', 'u2', 'เหตุผล');
    assert.equal(result.reversalEntryId, null);
    assert.equal(client.state.journalEntries.length, 0);
    assert.equal(client.state.payments[0].status, 'VOIDED');
    assert.equal(client.state.payments[0].postingStatus, 'pending');
  });
});

function issuedDocumentSeed() {
  return {
    documents: [{
      id: 'doc_1', companyId: CO, documentType: 'TAX_INVOICE', documentNumber: 'TI-1', status: 'ISSUED',
      documentDate: NOW, currency: 'THB', vatMode: 'VAT_EXCLUDED',
      subtotalAmount: '1000.00', discountAmount: '0.00', taxableAmount: '1000.00', vatAmount: '70.00',
      whtAmount: '0.00', grandTotalAmount: '1070.00', paidAmount: '500.00', outstandingAmount: '570.00',
      paymentStatus: 'PARTIALLY_PAID', postingStatus: 'posted', journalEntryId: 'je_doc',
      createdByUserId: 'u1', createdAt: NOW, updatedAt: NOW,
    }],
    payments: [{
      id: 'pay_1', companyId: CO, status: 'RECORDED', direction: 'RECEIVED', method: 'TRANSFER',
      amount: '500.00', allocatedAmount: '500.00', unappliedAmount: '0.00', currency: 'THB',
      paidAt: NOW, postingStatus: 'posted', journalEntryId: 'je_pay', createdByUserId: 'u1',
      createdAt: NOW, updatedAt: NOW,
    }],
    allocations: [{ id: 'alloc_1', companyId: CO, paymentId: 'pay_1', documentId: 'doc_1', amount: '500.00' }],
    journalEntries: [{
      id: 'je_doc', companyId: CO, periodId: 'p_1', entryNumber: 'JV-2', entryType: 'GENERATED',
      sourceType: 'accounting.document', sourceId: 'doc_1', status: 'POSTED', entryDate: NOW,
    }],
    journalLines: [
      { id: 'jl_1', journalEntryId: 'je_doc', companyId: CO, accountId: 'acc_ar', lineNumber: 1, description: 'AR', debitAmount: '1070.0000', creditAmount: '0.0000', currency: 'THB', taxCode: null, branchId: null },
      { id: 'jl_2', journalEntryId: 'je_doc', companyId: CO, accountId: 'acc_rev', lineNumber: 2, description: 'revenue', debitAmount: '0.0000', creditAmount: '1000.0000', currency: 'THB', taxCode: null, branchId: null },
      { id: 'jl_3', journalEntryId: 'je_doc', companyId: CO, accountId: 'acc_vat', lineNumber: 3, description: 'output VAT', debitAmount: '0.0000', creditAmount: '70.0000', currency: 'THB', taxCode: 'O7', branchId: null },
    ],
    periods: [{ id: 'p_1', companyId: CO, periodKey: '2026-07', status: 'OPEN' }],
  };
}

describe('voidDocumentTrueReversal (H-04)', () => {
  let client: any;
  let repo: PrismaAccountingRepository;

  beforeEach(() => {
    client = makeClient(issuedDocumentSeed());
    repo = new PrismaAccountingRepository({ client } as any);
  });

  it('releases allocations to unapplied credit, zeroes balances, and reverses the GL entry', async () => {
    const result = await repo.voidDocumentTrueReversal(CO, 'doc_1', 'u2', 'ออกเอกสารผิด', 'ISSUED', 'JV-REV-9');

    const doc = client.state.documents[0];
    assert.equal(doc.status, 'VOIDED');
    assert.equal(doc.paymentStatus, 'VOIDED');
    assert.equal(doc.paidAmount, '0.00');
    assert.equal(doc.outstandingAmount, '0.00');
    assert.equal(doc.postingStatus, 'reversed');

    const payment = client.state.payments[0];
    assert.equal(payment.allocatedAmount, '0.00');
    assert.equal(payment.unappliedAmount, '500.00');
    assert.deepEqual(result.unappliedCredits, [{ paymentId: 'pay_1', unappliedAmount: '500.00', currency: 'THB' }]);
    assert.equal(client.state.allocations.length, 0);

    const reversal = client.state.journalEntries.find((e: any) => e.entryType === 'REVERSAL');
    assert.ok(reversal);
    const revLines = client.state.journalLines.filter((l: any) => l.journalEntryId === reversal.id);
    assert.equal(revLines.find((l: any) => l.accountId === 'acc_ar').creditAmount, 1070);
    assert.equal(revLines.find((l: any) => l.accountId === 'acc_rev').debitAmount, 1000);
    assert.equal(revLines.find((l: any) => l.accountId === 'acc_vat').debitAmount, 70);
    assert.equal(client.state.journalEntries.find((e: any) => e.id === 'je_doc').status, 'POSTED');
  });

  it('rejects the void when the CAS expected status no longer matches', async () => {
    client.state.documents[0].status = 'CLOSED';
    await assert.rejects(
      () => repo.voidDocumentTrueReversal(CO, 'doc_1', 'u2', 'เหตุผล', 'ISSUED', 'JV-REV-9'),
      ConflictException,
    );
  });

  it('blocks voiding a tax invoice that still has an issued credit note', async () => {
    client.state.documents.push({
      id: 'cn_1', companyId: CO, documentType: 'CREDIT_NOTE', documentNumber: 'CN-1', status: 'ISSUED',
      sourceDocumentId: 'doc_1', paidAmount: '0.00', outstandingAmount: '0.00',
    });
    await assert.rejects(
      () => repo.voidDocumentTrueReversal(CO, 'doc_1', 'u2', 'เหตุผล', 'ISSUED', 'JV-REV-9'),
      UnprocessableEntityException,
    );
  });

  it('blocks source void while an active receipt or tax-invoice child remains', async () => {
    client.state.documents.push({
      id: 'receipt_1', companyId: CO, documentType: 'RECEIPT', documentNumber: 'RC-1', status: 'ISSUED',
      sourceDocumentId: 'doc_1', paidAmount: '0.00', outstandingAmount: '0.00',
    });
    await assert.rejects(
      () => repo.voidDocumentTrueReversal(CO, 'doc_1', 'u2', 'เหตุผล', 'ISSUED', 'JV-REV-9'),
      (error: unknown) => error instanceof UnprocessableEntityException
        && (error.getResponse() as any).code === 'accounting_active_child_document_must_be_voided',
    );
    assert.equal(client.state.documents[0].status, 'ISSUED');
  });

  it('blocks a tax-relevant void when the PP30 period is filed', async () => {
    client.state.taxPeriods.push({ id: 'tp_1', companyId: CO, formType: 'PP30', periodKey: '2026-07', status: 'FILED' });
    await assert.rejects(
      () => repo.voidDocumentTrueReversal(CO, 'doc_1', 'u2', 'เหตุผล', 'ISSUED', 'JV-REV-9'),
      ConflictException,
    );
  });

  it('keeps postingStatus truthful when nothing was ever posted', async () => {
    client.state.journalEntries.length = 0;
    client.state.journalLines.length = 0;
    client.state.documents[0].postingStatus = 'pending';
    client.state.documents[0].journalEntryId = null;

    const result = await repo.voidDocumentTrueReversal(CO, 'doc_1', 'u2', 'เหตุผล', 'ISSUED');
    assert.equal(result.reversalEntryId, null);
    assert.equal(client.state.documents[0].status, 'VOIDED');
    assert.equal(client.state.documents[0].postingStatus, 'pending');
    assert.equal(client.state.journalEntries.length, 0);
  });
});

describe('voiding a receipt where the customer withheld tax', () => {
  it('restores both the cash and the withheld share to the document', () => {
    // 1,070 invoice settled by 1,040 cash + 30 withheld. Restoring only the cash would leave the
    // document looking part-paid by tax that no longer applies.
    const seed = paidPaymentSeed();
    seed.payments[0]!.amount = '1040.00';
    (seed.payments[0] as any).whtAmount = '30.00';
    seed.payments[0]!.allocatedAmount = '1040.00';
    seed.allocations[0]!.amount = '1040.00';
    (seed.allocations[0] as any).whtAmount = '30.00';
    Object.assign(seed.documents[0]!, {
      subtotalAmount: '1070.00', taxableAmount: '1070.00', grandTotalAmount: '1070.00',
      paidAmount: '1070.00', outstandingAmount: '0.00', paymentStatus: 'PAID',
    });
    const client = makeClient(seed);
    const repo = new PrismaAccountingRepository({ client } as any);

    return repo.voidPaymentTrueReversal(CO, 'pay_1', 'u2', 'ลูกค้าโอนผิด', 'JV-REV-1').then(() => {
      const doc = client.state.documents[0];
      assert.equal(doc.paidAmount, '0.00');
      assert.equal(doc.outstandingAmount, '1070.00');
      assert.equal(doc.paymentStatus, 'UNPAID');
    });
  });
});
