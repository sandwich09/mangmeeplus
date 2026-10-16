import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExpenseSourceAdapter } from './expense-source.adapter.js';

const paidFixture = (row: any) => ({ ...row, netPayableAmount: row.netPayableAmount ?? '100',
  payments: row.payments ?? [{ id: 'payment', amount: row.netPayableAmount ?? '100', paidAt: row.expenseDate, paidAtConfirmed: true, status: 'RECORDED', createdAt: row.expenseDate }],
  whtAmount: row.whtAmount ?? '3', taxableAmount: row.taxableAmount ?? '100' });
const companyFixture = { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) };

describe('ExpenseSourceAdapter VAT evidence', () => {
  it('carries tax evidence status into tax sync rows', async () => {
    let query: any;
    const prisma = {
      client: {
        expenseRecord: {
          findMany: async (input: any) => {
            query = input;
            return [{
              id: 'expense-1', companyId: 'company-1', expenseDate: new Date('2026-07-13T00:00:00.000Z'),
              vatAmount: '7', whtAmount: '0', taxableAmount: '100', grandTotalAmount: '107',
              inputVatClaimStatus: 'CLAIMABLE', taxEvidenceStatus: 'USABLE_FOR_TAX', vatMode: 'VAT_INCLUDED',
              vendorNameSnapshot: 'Vendor', vendorTaxIdSnapshot: '0100000000000', vendorBranchCodeSnapshot: '00003',
              currency: 'THB', updatedAt: new Date(),
            }];
          },
        },
      },
    } as any;

    const rows = await new ExpenseSourceAdapter(prisma).findConfirmedWithVatByCompany('company-1');

    assert.equal(query.where.companyId, 'company-1');
    assert.equal(query.where.status, 'CONFIRMED');
    assert.equal(rows[0]?.taxEvidenceStatus, 'USABLE_FOR_TAX');
    assert.equal(rows[0]?.vendorBranchCode, '00003');
  });
});

describe('ExpenseSourceAdapter WHT source facts', () => {
  type WhtLine = { whtRate: string | null; taxableAmount: string };
  const whtRow = (lines: WhtLine[], entityKind: string | null) => ({
    id: 'expense-1', companyId: 'company-1', expenseDate: new Date('2026-07-13T00:00:00.000Z'),
    whtAmount: '30', taxableAmount: '1500', taxCategory: 'SERVICE_FEE', whtCategoryCode: 'WHT_SERVICE_5',
    vendorNameSnapshot: 'ผู้รับเงิน', vendorTaxIdSnapshot: '0100000000000', vendorBranchCodeSnapshot: '00003',
    vendorEntityKindSnapshot: entityKind, currency: 'THB', updatedAt: new Date(), lines,
  });
  const queries: any[] = [];
  const adapter = (row: unknown) => new ExpenseSourceAdapter({
    client: { company: companyFixture, whtFilingLine: { findMany: async () => [] }, expenseRecord: { findMany: async (input: any) => { queries.push(input); return [paidFixture(row)]; } } },
  } as any);

  it('uses the withholding category rather than the unrelated expense tax category', async () => {
    const [source] = await adapter(whtRow([], 'JURISTIC')).findConfirmedWithWhtByCompany('company-1');
    assert.equal(source.incomeCategoryCode, 'WHT_SERVICE_5');
  });
  it('retains whole-bill base and no fabricated rate for explicit amount-only WHT', async () => {
    const row = { ...whtRow([{ whtRate: null, taxableAmount: '1000' }], 'JURISTIC'),
      whtInputJson: { inputType: 'AMOUNT', value: '0.01', origin: 'REVIEWER' }, whtAmount: '0.01' };
    const [source] = await adapter(row).findConfirmedWithWhtByCompany('company-1');
    assert.equal(source?.grossAmount, '1500', 'zero-satang allocated lines still belong to the whole-bill base');
    assert.equal(source?.whtRate, null);
    assert.equal(source?.whtAmount, '0.01');
  });

  it('keeps the entire explicit RATE base even when small lines withhold zero satang', async () => {
    const row = { ...whtRow([{ whtRate: '0.0300', taxableAmount: '100' }], 'JURISTIC'),
      taxableAmount: '100.10', whtInputJson: { inputType: 'RATE', value: '3', origin: 'REVIEWER' }, whtAmount: '3' };
    const [source] = await adapter(row).findConfirmedWithWhtByCompany('company-1');
    assert.equal(source?.grossAmount, '100.1');
    assert.equal(source?.whtRate, '3.0000');
    assert.equal(source?.whtAmount, '3');
  });
  it('projects the explicit base without back-solving the rounded withholding amount', async () => {
    for (const inputType of ['RATE', 'AMOUNT']) {
      const [source] = await adapter({ ...whtRow([], 'JURISTIC'), taxableAmount: '70.50', whtAmount: '2.71',
        whtInputJson: { inputType, value: inputType === 'RATE' ? '1' : '2.71', baseAmount: '270.50', origin: 'REVIEWER' },
      }).findConfirmedWithWhtByCompany('company-1');
      assert.equal(source?.grossAmount, '270.5');
      assert.equal(source?.whtRate, inputType === 'RATE' ? '1.0000' : null);
    }
  });

  it('carries the payee class and branch code, scales the line rate to a percent, and bases gross on the withholding lines only', async () => {
    const row = whtRow([{ whtRate: '0.0300', taxableAmount: '1000' }], 'INDIVIDUAL');

    const rows = await adapter(row).findConfirmedWithWhtByCompany('company-1');

    assert.equal(rows[0]?.payeeEntityKind, 'INDIVIDUAL');
    assert.equal(rows[0]?.vendorBranchCode, '00003');
    // ExpenseLine.whtRate is a fraction; TaxEvent.whtRate is a percent.
    assert.equal(rows[0]?.whtRate, '3.0000');
    // Header taxableAmount is 1500 (a non-WHT line rides along); only the 1000 the rate applies to counts.
    assert.equal(rows[0]?.grossAmount, '1000');
    // Only withholding lines may supply the rate and the base.
    assert.deepEqual(queries.at(-1).include.lines.where, { whtAmount: { gt: 0 } });
  });

  it('allocates each mixed-rate income line separately with its own remainder', async () => {
    const source = { ...whtRow([], 'INDIVIDUAL'), netPayableAmount: '291', whtAmount: '9',
      lines: [{ id: 'rent', whtCategoryCode: 'RENT', whtRate: '0.05', taxableAmount: '100', whtAmount: '5' },
        { id: 'service', whtCategoryCode: 'SERVICE', whtRate: '0.02', taxableAmount: '200', whtAmount: '4' }],
      payments: ['97', '194'].map((amount, i) => ({ id: `p${i}`, amount, paidAt: new Date(`2026-${10+i}-05`), createdAt: new Date(i), status: 'RECORDED', paidAtConfirmed: true })) };
    const rows = await adapter(source).findConfirmedWithWhtByCompany('company-1');
    assert.deepEqual(rows.map(r => [r.paymentId, r.incomeCategoryCode, r.whtRate, r.grossAmount, r.whtAmount]), [
      ['p0', 'RENT', '5.0000', '33.33', '1.67'], ['p1', 'RENT', '5.0000', '66.67', '3.33'],
      ['p0', 'SERVICE', '2.0000', '66.67', '1.33'], ['p1', 'SERVICE', '2.0000', '133.33', '2.67']]);
    assert.equal(new Set(rows.map(r => r.sourceLineKey)).size, 4);
  });

  it('leaves the rate null and falls back to the header base when no line carries a rate', async () => {
    const rows = await adapter(whtRow([{ whtRate: null, taxableAmount: '0' }], 'JURISTIC')).findConfirmedWithWhtByCompany('company-1');

    assert.equal(rows[0]?.whtRate, null);
    assert.equal(rows[0]?.grossAmount, '1500');
  });
});

// §10 fallback (Phase 1 gap): `ExpenseRecord` has no Prisma relation to the counterparty, only the
// scalar `vendorCounterpartyId`, so a missing snapshot is filled from ONE batched registry read.
describe('ExpenseSourceAdapter vendor address registry fallback', () => {
  function harness(rows: unknown[], counterpartyRows: Array<{ id: string; billingAddressJson: unknown }> = []) {
    const counterpartyQueries: any[] = [];
    const prisma = {
      client: {
        company: companyFixture, whtFilingLine: { findMany: async () => [] },
        expenseRecord: { findMany: async () => rows.map(paidFixture) },
        accountingCounterparty: {
          findMany: async (args: any) => { counterpartyQueries.push(args); return counterpartyRows; },
        },
      },
    } as any;
    return { adapter: new ExpenseSourceAdapter(prisma), counterpartyQueries };
  }

  const vatRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'expense-1', companyId: 'company-1', expenseDate: new Date('2026-07-13T00:00:00.000Z'),
    vatAmount: '7', whtAmount: '0', taxableAmount: '100', grandTotalAmount: '107',
    inputVatClaimStatus: 'CLAIMABLE', taxEvidenceStatus: 'USABLE_FOR_TAX', vatMode: 'VAT_INCLUDED',
    vendorNameSnapshot: 'Vendor', vendorTaxIdSnapshot: '0100000000000', vendorBranchCodeSnapshot: '00003',
    vendorAddressSnapshot: null, vendorCounterpartyId: null,
    currency: 'THB', updatedAt: new Date(),
    ...overrides,
  });

  it('keeps the document\'s own snapshot and never queries the registry when one exists', async () => {
    const { adapter: subject, counterpartyQueries } = harness(
      [vatRow({ vendorAddressSnapshot: 'ที่อยู่บนใบ', vendorCounterpartyId: 'cp-1' })],
      [{ id: 'cp-1', billingAddressJson: { addressText: 'ที่อยู่ทะเบียน' } }],
    );
    const [result] = await subject.findConfirmedWithVatByCompany('company-1');
    assert.equal(result?.vendorAddress, 'ที่อยู่บนใบ');
    assert.equal(counterpartyQueries.length, 0, 'a row with its own snapshot never needs the registry');
  });

  it('falls back to the registry address when the expense snapshot is empty', async () => {
    const { adapter: subject, counterpartyQueries } = harness(
      [vatRow({ vendorAddressSnapshot: null, vendorCounterpartyId: 'cp-1' })],
      [{ id: 'cp-1', billingAddressJson: { addressText: 'ที่อยู่ทะเบียน' } }],
    );
    const [result] = await subject.findConfirmedWithVatByCompany('company-1');
    assert.equal(result?.vendorAddress, 'ที่อยู่ทะเบียน');
    assert.equal(counterpartyQueries[0]?.where.companyId, 'company-1');
    assert.deepEqual(counterpartyQueries[0]?.where.id, { in: ['cp-1'] });
    assert.deepEqual(counterpartyQueries[0]?.select, { id: true, billingAddressJson: true });
  });

  it('returns null when neither the expense nor a linked counterparty has an address', async () => {
    const { adapter: subject, counterpartyQueries } = harness([vatRow({ vendorAddressSnapshot: null, vendorCounterpartyId: null })]);
    const [result] = await subject.findConfirmedWithVatByCompany('company-1');
    assert.equal(result?.vendorAddress, null);
    assert.equal(counterpartyQueries.length, 0, 'no linked counterparty means nothing to batch');
  });

  it('returns null when the linked counterparty is missing or its address is unusable', async () => {
    const missing = harness([vatRow({ vendorAddressSnapshot: null, vendorCounterpartyId: 'cp-deleted' })], []);
    assert.equal((await missing.adapter.findConfirmedWithVatByCompany('company-1'))[0]?.vendorAddress, null);

    const unusable = harness(
      [vatRow({ vendorAddressSnapshot: null, vendorCounterpartyId: 'cp-1' })],
      [{ id: 'cp-1', billingAddressJson: { locked: true } }],
    );
    assert.equal((await unusable.adapter.findConfirmedWithVatByCompany('company-1'))[0]?.vendorAddress, null);
  });

  it('batches every row needing a fallback into one registry query, never one per row', async () => {
    const { adapter: subject, counterpartyQueries } = harness(
      [
        vatRow({ id: 'expense-1', vendorAddressSnapshot: null, vendorCounterpartyId: 'cp-1' }),
        vatRow({ id: 'expense-2', vendorAddressSnapshot: null, vendorCounterpartyId: 'cp-2' }),
      ],
      [
        { id: 'cp-1', billingAddressJson: { addressText: 'ที่อยู่ 1' } },
        { id: 'cp-2', billingAddressJson: { addressText: 'ที่อยู่ 2' } },
      ],
    );
    const rows = await subject.findConfirmedWithVatByCompany('company-1');
    assert.equal(counterpartyQueries.length, 1);
    assert.deepEqual([...counterpartyQueries[0]?.where.id.in].sort(), ['cp-1', 'cp-2']);
    assert.equal(rows[0]?.vendorAddress, 'ที่อยู่ 1');
    assert.equal(rows[1]?.vendorAddress, 'ที่อยู่ 2');
  });

  it('falls back to the registry on the WHT source too (same helper, second call site)', async () => {
    const { adapter: subject } = harness(
      [{
        id: 'expense-2', companyId: 'company-1', expenseDate: new Date('2026-07-13T00:00:00.000Z'),
        whtAmount: '30', taxableAmount: '1500', taxCategory: 'SERVICE_FEE', whtCategoryCode: 'WHT_SERVICE_5',
        vendorNameSnapshot: 'ผู้รับเงิน', vendorTaxIdSnapshot: '0100000000000', vendorBranchCodeSnapshot: '00003',
        vendorEntityKindSnapshot: 'JURISTIC', currency: 'THB', updatedAt: new Date(), lines: [],
        vendorAddressSnapshot: null, vendorCounterpartyId: 'cp-1',
      }],
      [{ id: 'cp-1', billingAddressJson: { addressText: 'ที่อยู่ทะเบียน' } }],
    );
    const [result] = await subject.findConfirmedWithWhtByCompany('company-1');
    assert.equal(result?.vendorAddress, 'ที่อยู่ทะเบียน');
  });
});

it('resolves an unknown expense payee from its linked counterparty on the next sync and carries the paying branch', async () => {
  const source: any = { id: 'e', companyId: 'c', branchId: 'b', vendorEntityKindSnapshot: null, vendorCounterpartyId: 'cp',
    vendorAddressSnapshot: 'ที่อยู่', lines: [], expenseDate: new Date('2026-09-01') };
  let kind: string | null = null;
  const adapter = new ExpenseSourceAdapter({ client: { company: companyFixture, whtFilingLine: { findMany: async () => [] }, expenseRecord: { findMany: async () => [paidFixture(source)] },
    accountingCounterparty: { findMany: async ({ where }: any) => { assert.equal(where.companyId, 'c'); assert.deepEqual(where.id.in, ['cp']); return [{ id: 'cp', entityKind: kind }]; } },
  } } as any);
  assert.equal((await adapter.findConfirmedWithWhtByCompany('c'))[0].payeeEntityKind, null);
  kind = 'INDIVIDUAL';
  const [resolved] = await adapter.findConfirmedWithWhtByCompany('c');
  assert.equal(resolved.payeeEntityKind, 'INDIVIDUAL'); assert.equal(resolved.branchId, 'b');
  source.vendorEntityKindSnapshot = 'JURISTIC';
  assert.equal((await adapter.findConfirmedWithWhtByCompany('c'))[0].payeeEntityKind, 'JURISTIC');
});

describe('W1–W4 payment-date withholding', () => {
  const payment = (id: string, amount: string, paidAt: string, extra = {}) => ({ id, amount, paidAt: new Date(paidAt), paidAtConfirmed: true, status: 'RECORDED', createdAt: new Date(paidAt), updatedAt: new Date(paidAt), ...extra });
  const read = async (payments: unknown[]) => new ExpenseSourceAdapter({ client: {
    company: { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) }, whtFilingLine: { findMany: async () => [] },
    expenseRecord: { findMany: async () => [{ id: 'e', companyId: 'c', expenseDate: new Date('2026-10-28'),
      netPayableAmount: '97', whtAmount: '3', taxableAmount: '100', currency: 'THB', updatedAt: new Date('2026-10-28'),
      vendorEntityKindSnapshot: 'INDIVIDUAL', vendorAddressSnapshot: 'กทม.', whtInputJson: { inputType: 'RATE', value: '3' }, payments }] },
  } } as any).findConfirmedWithWhtByCompany('c');
  it('recognizes 28 October invoice paid 5 November in November on 5 November', async () => {
    const [row] = await read([payment('p', '97', '2026-11-04T18:00:00Z')]);
    assert.equal(row.expenseDate.toISOString().slice(0, 10), '2026-11-05');
    assert.equal(row.paymentId, 'p');
  });
  it('confirmed unpaid, voided and unconfirmed-date payments make no paper rows', async () => {
    assert.deepEqual(await read([]), []);
    assert.deepEqual(await read([payment('p', '97', '2026-11-05', { status: 'VOIDED' })]), []);
    assert.deepEqual(await read([payment('p', '97', '2026-11-05', { paidAtConfirmed: false })]), []);
  });
  it('allocates net cash shares to two months with the completion taking the exact remainder', async () => {
    const rows = await read([payment('a', '32.33', '2026-10-29'), payment('b', '64.67', '2026-11-05')]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(r => [r.grossAmount, r.whtAmount]), [['33.33', '1'], ['66.67', '2']]);
  });
});

it('W3 tiny partial shares never over-allocate withholding before the final remainder', async () => {
  const { allocateExpenseWithholding } = await import('../../domain/logic/expense-payment-withholding.logic');
  const rows = allocateExpenseWithholding(Array.from({ length: 3 }, (_, i) => ({ id: String(i), amount: '1', status: 'RECORDED', createdAt: new Date(i) })), '3', '3.01', '0.02');
  assert.deepEqual(rows.map(r => r.whtAmount), ['0.01', '0', '0.01']);
  assert.deepEqual(rows.map(r => r.grossAmount), ['1', '1.01', '1']);
});
it('W3 preserves the share already filed when an earlier payment is voided, and gives the replacement the remainder', async () => {
  const { allocateExpenseWithholding } = await import('../../domain/logic/expense-payment-withholding.logic');
  const payments = [{ id: 'p2', amount: '1', status: 'RECORDED', createdAt: new Date(2) }, { id: 'replacement', amount: '2', status: 'RECORDED', createdAt: new Date(3) }];
  const frozen = new Map([['p2', { grossAmount: '1.01', whtAmount: '0' }]]);
  const rows = allocateExpenseWithholding(payments, '3', '3.01', '0.02', frozen);
  assert.deepEqual(rows.map(r => [r.grossAmount, r.whtAmount]), [['1.01', '0'], ['2', '0.02']]);
});

it('W7 gross cash still carries the full income and tax duty, never an extra or missing share', async () => {
  const { allocateExpenseWithholding } = await import('../../domain/logic/expense-payment-withholding.logic');
  const payments = ['500', '500'].map((amount, i) => ({ id: String(i), amount, status: 'RECORDED', createdAt: new Date(i) }));
  const rows = allocateExpenseWithholding(payments, '970', '1000', '30');
  assert.deepEqual(rows.map(r => [r.grossAmount, r.whtAmount]), [['500', '15'], ['500', '15']]);
});
