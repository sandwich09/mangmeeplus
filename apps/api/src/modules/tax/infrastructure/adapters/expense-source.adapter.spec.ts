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
