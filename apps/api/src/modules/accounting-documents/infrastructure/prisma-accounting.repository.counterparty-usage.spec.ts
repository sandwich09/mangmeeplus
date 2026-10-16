/**
 * §11.1/§12: the list row shows the same "เคยซื้อ N ใบ / เคยขาย N ใบ" badges the detail page already
 * has. `counterpartyUsage()` answers that for one row with two `count`s; this covers the list's own
 * `listCounterparties`, which must answer it for a whole page with two `groupBy`s — never one pair
 * of queries per row.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaAccountingRepository } from './prisma-accounting.repository';

const CO = 'co-1';
const VERSION = new Date('2026-01-01T00:00:00.000Z');

function counterpartyRow(id: string, displayName: string) {
  return {
    id, companyId: CO, type: 'VENDOR', displayName, legalName: null, taxId: null, branchCode: null,
    entityKind: null, vatStatus: null, email: null, phone: null, billingAddressJson: null, shippingAddressJson: null,
    status: 'ACTIVE', createdByUserId: 'u-1', updatedByUserId: null, createdAt: VERSION, updatedAt: VERSION,
  };
}

function harness(
  rows: ReturnType<typeof counterpartyRow>[],
  expenseRows: Array<{ vendorCounterpartyId: string | null }>,
  documentRows: Array<{ counterpartyId: string | null }>,
) {
  let expenseGroupByCalls = 0;
  let documentGroupByCalls = 0;
  const client: any = {
    $queryRaw: async () => [{ all: rows.length, bought: 0, sold: 0, addressMissing: rows.length }],
    accountingCounterparty: {
      findMany: async ({ where, skip, take }: any) => rows.filter((row) => row.companyId === where.companyId).slice(skip, skip + take),
      count: async ({ where }: any) => rows.filter((row) => row.companyId === where.companyId).length,
    },
    expenseRecord: {
      groupBy: async ({ where }: any) => {
        expenseGroupByCalls += 1;
        const ids: string[] = where.vendorCounterpartyId.in;
        const counts = new Map<string, number>();
        for (const row of expenseRows) {
          if (row.vendorCounterpartyId && ids.includes(row.vendorCounterpartyId)) {
            counts.set(row.vendorCounterpartyId, (counts.get(row.vendorCounterpartyId) ?? 0) + 1);
          }
        }
        return [...counts].map(([vendorCounterpartyId, count]) => ({ vendorCounterpartyId, _count: { _all: count } }));
      },
    },
    accountingDocument: {
      groupBy: async ({ where }: any) => {
        documentGroupByCalls += 1;
        const ids: string[] = where.counterpartyId.in;
        const counts = new Map<string, number>();
        for (const row of documentRows) {
          if (row.counterpartyId && ids.includes(row.counterpartyId)) {
            counts.set(row.counterpartyId, (counts.get(row.counterpartyId) ?? 0) + 1);
          }
        }
        return [...counts].map(([counterpartyId, count]) => ({ counterpartyId, _count: { _all: count } }));
      },
    },
  };
  return {
    repo: new PrismaAccountingRepository({ client } as any),
    calls: () => ({ expenseGroupByCalls, documentGroupByCalls }),
  };
}

describe('listCounterparties usage badges (§11.1/§12)', () => {
  it("attaches bought/sold per row, using counterpartyUsage()'s own definition of each", async () => {
    const rows = [counterpartyRow('cp-1', 'ร้านหนึ่ง'), counterpartyRow('cp-2', 'ร้านสอง'), counterpartyRow('cp-3', 'ร้านสาม')];
    const { repo } = harness(
      rows,
      [{ vendorCounterpartyId: 'cp-1' }, { vendorCounterpartyId: 'cp-1' }, { vendorCounterpartyId: 'cp-3' }],
      [{ counterpartyId: 'cp-2' }],
    );

    const { data } = await repo.listCounterparties(CO, 1, 20);

    assert.deepEqual(data.find((row) => row.id === 'cp-1')!.usageCounts, { bought: 2, sold: 0 });
    assert.deepEqual(data.find((row) => row.id === 'cp-2')!.usageCounts, { bought: 0, sold: 1 });
    assert.deepEqual(data.find((row) => row.id === 'cp-3')!.usageCounts, { bought: 1, sold: 0 });
  });

  it('never queries per row: exactly one groupBy per side for the whole page', async () => {
    const rows = [counterpartyRow('cp-1', 'ก'), counterpartyRow('cp-2', 'ข'), counterpartyRow('cp-3', 'ค'), counterpartyRow('cp-4', 'ง')];
    const { repo, calls } = harness(rows, [], []);

    await repo.listCounterparties(CO, 1, 20);

    assert.deepEqual(calls(), { expenseGroupByCalls: 1, documentGroupByCalls: 1 });
  });

  it('answers zero counts, and runs no usage query at all, for an empty page', async () => {
    const { repo, calls } = harness([], [{ vendorCounterpartyId: 'cp-1' }], []);

    const { data } = await repo.listCounterparties(CO, 1, 20);

    assert.deepEqual(data, []);
    assert.deepEqual(calls(), { expenseGroupByCalls: 0, documentGroupByCalls: 0 });
  });
});


it('COUNTERPARTY-1 tab counts use one company/search aggregate independent of the selected tab and page', async () => {
  const queries: any[] = [];
  const client: any = {
    accountingCounterparty: { findMany: async () => [], count: async () => 1 },
    $queryRaw: async (query: any) => { queries.push(query); return [{ all: 7, bought: 4, sold: 3, addressMissing: 2 }]; },
  };
  const repo = new PrismaAccountingRepository({ client } as any);
  for (const filter of [{ search: ' ร้าน ' }, { search: ' ร้าน ', usage: 'sold' as const }, { search: ' ร้าน ', addressMissing: true }]) {
    const result = await repo.listCounterparties(CO, 2, 10, filter);
    assert.deepEqual((result as any).counts, { all: 7, bought: 4, sold: 3, addressMissing: 2 });
  }
  assert.equal(queries.length, 3);
  for (const query of queries) {
    assert.deepEqual(query.values, [CO, '%ร้าน%', '%ร้าน%', '%ร้าน%']);
    assert.match(query.sql, /COUNT\(\*\) FILTER/g);
    assert.match(query.sql, /"ExpenseRecord"/);
    assert.match(query.sql, /"AccountingDocument"/);
    assert.match(query.sql, /"AccountingPayment"[\s\S]*'RECEIVED'/);
    assert.match(query.sql, /"billingAddressJson" IS NULL/);
    assert.doesNotMatch(query.sql, /LIMIT|OFFSET/);
  }
});

it('COUNTERPARTY-1 recent purchases expose the EXP number alongside the vendor number under the existing company scope', async () => {
  const client: any = {
    expenseRecord: { count: async () => 1, findMany: async (query: any) => {
      assert.deepEqual(query.where, { companyId: CO, vendorCounterpartyId: 'cp-1' });
      assert.equal(query.select.expenseNumber, true);
      return [{ id: 'e1', expenseNumber: 'EXP-202610-1', expenseDate: new Date('2026-10-16'), vendorDocumentNumber: 'INV-7', grandTotalAmount: '1000.00' }];
    } }, accountingDocument: { count: async () => 0 },
  };
  const result = await new PrismaAccountingRepository({ client } as any).counterpartyUsage(CO, 'cp-1');
  assert.deepEqual(result.recentExpenses, [{ id: 'e1', expenseNumber: 'EXP-202610-1', expenseDate: '2026-10-16', vendorDocumentNumber: 'INV-7', grandTotalAmount: '1000.00' }]);
});
