import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExpenseSourceAdapter } from './expense-source.adapter.js';

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
    whtAmount: '30', taxableAmount: '1500', taxCategory: 'SERVICE_FEE',
    vendorNameSnapshot: 'ผู้รับเงิน', vendorTaxIdSnapshot: '0100000000000', vendorBranchCodeSnapshot: '00003',
    vendorEntityKindSnapshot: entityKind, currency: 'THB', updatedAt: new Date(), lines,
  });
  const queries: any[] = [];
  const adapter = (row: unknown) => new ExpenseSourceAdapter({
    client: { expenseRecord: { findMany: async (input: any) => { queries.push(input); return [row]; } } },
  } as any);

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
    assert.equal(source?.grossAmount, '100.10');
    assert.equal(source?.whtRate, '3.0000');
    assert.equal(source?.whtAmount, '3');
  });
  it('projects the explicit base without back-solving the rounded withholding amount', async () => {
    for (const inputType of ['RATE', 'AMOUNT']) {
      const [source] = await adapter({ ...whtRow([], 'JURISTIC'), taxableAmount: '70.50', whtAmount: '2.71',
        whtInputJson: { inputType, value: inputType === 'RATE' ? '1' : '2.71', baseAmount: '270.50', origin: 'REVIEWER' },
      }).findConfirmedWithWhtByCompany('company-1');
      assert.equal(source?.grossAmount, '270.50');
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
    assert.equal(rows[0]?.grossAmount, '1000.0000');
    // Only withholding lines may supply the rate and the base.
    assert.deepEqual(queries.at(-1).include.lines.where, { whtAmount: { gt: 0 } });
  });

  it('leaves the header rate null for a mixed-rate document and an unclassified payee', async () => {
    const rows = await adapter(whtRow([{ whtRate: '0.0300', taxableAmount: '1000' }, { whtRate: '0.0500', taxableAmount: '500' }], null)).findConfirmedWithWhtByCompany('company-1');

    assert.equal(rows[0]?.whtRate, null);
    assert.equal(rows[0]?.payeeEntityKind, null);
    assert.equal(rows[0]?.grossAmount, '1500.0000');
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
        expenseRecord: { findMany: async () => rows },
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
        whtAmount: '30', taxableAmount: '1500', taxCategory: 'SERVICE_FEE',
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
