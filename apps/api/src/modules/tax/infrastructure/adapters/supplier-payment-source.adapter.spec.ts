import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SupplierPaymentSourceAdapter } from './supplier-payment-source.adapter.js';

function adapter(rows: any[]) {
  const queries: any[] = [];
  const prisma = {
    client: {
      supplierPayment: {
        findMany: async (args: any) => { queries.push(args); return rows; },
      },
    },
  } as any;
  return { adapter: new SupplierPaymentSourceAdapter(prisma), queries };
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'payment-1', companyId: 'company-1', branchId: 'branch-1',
  paymentDate: new Date('2026-08-05'),
  // Settles 1,070 of debt (1,000 base + 70 VAT) with 30 withheld at 3%.
  grossAmount: '1070.0000', whtAmount: '30.0000', whtRate: '3.0000', whtCategoryCode: 'WHT_SERVICE_5',
  currency: 'THB', updatedAt: new Date('2026-08-05T10:00:00.000Z'),
  supplier: { legalNameSnapshot: 'บริษัท ผู้รับเงิน จำกัด', displayNameSnapshot: 'ผู้รับเงิน', taxId: '0100000000000', branchCode: '00003', supplierType: 'JURISTIC_PERSON' },
  ...overrides,
});

describe('SupplierPaymentSourceAdapter', () => {
  it('reports the income withheld on, not the VAT-inclusive settlement total', async () => {
    const { adapter: subject } = adapter([row()]);
    const [result] = await subject.findRecordedWithWhtByCompany('company-1');
    // 1,070 settles bills; only 1,000 of it is income to the payee. Reporting the gross would make
    // base x rate disagree with the 30 actually withheld on the ใบแนบ.
    assert.equal(result!.grossAmount, '1000.0000');
    assert.equal(result!.whtAmount, '30.0000');
    // Already a percent on this side — no fraction translation, unlike the expense adapter.
    assert.equal(result!.whtRate, '3.0000');
    assert.equal(result!.incomeCategoryCode, 'WHT_SERVICE_5');
    assert.equal(result!.supplierType, 'JURISTIC_PERSON');
    assert.equal(result!.payeeName, 'บริษัท ผู้รับเงิน จำกัด');
    assert.equal(result!.payeeTaxId, '0100000000000');
    assert.equal(result!.payeeBranchCode, '00003');
  });

  it('leaves the base unknown when a pre-feature row has no rate', async () => {
    const { adapter: subject } = adapter([row({ whtRate: null, whtCategoryCode: null })]);
    const [result] = await subject.findRecordedWithWhtByCompany('company-1');
    assert.equal(result!.grossAmount, null);
    assert.equal(result!.whtRate, null);
  });

  it('falls back to the display name when the payee has no registered legal name', async () => {
    const { adapter: subject } = adapter([row({ supplier: { legalNameSnapshot: null, displayNameSnapshot: 'ร้านค้า', taxId: '1', branchCode: null, supplierType: 'INDIVIDUAL' } })]);
    const [result] = await subject.findRecordedWithWhtByCompany('company-1');
    assert.equal(result!.payeeName, 'ร้านค้า');
  });

  it('reads only recorded payments that actually withheld, and honours the incremental cursor', async () => {
    const since = new Date('2026-08-01');
    const { adapter: subject, queries } = adapter([]);
    await subject.findRecordedWithWhtByCompany('company-1', since);
    assert.equal(queries[0].where.status, 'RECORDED');
    assert.deepEqual(queries[0].where.whtAmount, { gt: 0 });
    assert.deepEqual(queries[0].where.updatedAt, { gte: since });

    await subject.findRecordedWithWhtByCompany('company-1');
    assert.equal(queries[1].where.updatedAt, undefined);
  });
});
