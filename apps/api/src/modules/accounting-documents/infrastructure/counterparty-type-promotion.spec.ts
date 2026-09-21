/**
 * CON-1 / AC16. `AccountingCounterparty.type` looks like a label nobody reads — there is no picker
 * for it on any screen (A5) and `listCounterparties` never filters on it. It has exactly one real
 * reader, and that reader decides what a shop owner is told their revenue was:
 * `SalesGetSalesSummaryTool` sums RECORDED received payments whose counterparty is CUSTOMER or
 * BOTH. A counterparty created from a purchase receipt is VENDOR, so the first sale to that same
 * party would be dropped from the LINE answer with no error anywhere — the exact silent failure
 * spec D5 forbids.
 *
 * These tests therefore do not stop at "the helper writes BOTH". The last one runs the real AI tool
 * over a store that actually evaluates its relation filter, so the proof is that the money shows up.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promoteCounterpartyToBoth } from './prisma-accounting.repository';
import { SalesGetSalesSummaryTool } from '../../line-ai/application/use-cases/erp-tools.use-case';

type Row = { id: string; companyId: string; type: string };

/** A counterparty table that honours the conditional `updateMany` the promotion issues. */
function counterpartyStore(rows: Row[]) {
  return {
    accountingCounterparty: {
      updateMany: async ({ where, data }: any) => {
        const matched = rows.filter((row) => row.id === where.id && row.companyId === where.companyId && row.type === where.type);
        for (const row of matched) Object.assign(row, data);
        return { count: matched.length };
      },
    },
  };
}

describe('promoteCounterpartyToBoth', () => {
  it('turns a purchase-born VENDOR into BOTH', async () => {
    const rows: Row[] = [{ id: 'cp-1', companyId: 'co-1', type: 'VENDOR' }];

    await promoteCounterpartyToBoth(counterpartyStore(rows), 'co-1', 'cp-1');

    assert.equal(rows[0]!.type, 'BOTH');
  });

  it('never drags a CUSTOMER backwards, and is safe to run twice', async () => {
    const rows: Row[] = [{ id: 'cp-1', companyId: 'co-1', type: 'CUSTOMER' }, { id: 'cp-2', companyId: 'co-1', type: 'VENDOR' }];

    await promoteCounterpartyToBoth(counterpartyStore(rows), 'co-1', 'cp-1');
    await promoteCounterpartyToBoth(counterpartyStore(rows), 'co-1', 'cp-2');
    await promoteCounterpartyToBoth(counterpartyStore(rows), 'co-1', 'cp-2');

    assert.equal(rows[0]!.type, 'CUSTOMER', 'a CUSTOMER row is already visible to the revenue tool');
    assert.equal(rows[1]!.type, 'BOTH');
  });

  it('does nothing for a document with no counterparty, and stays inside its company', async () => {
    const rows: Row[] = [{ id: 'cp-1', companyId: 'co-1', type: 'VENDOR' }];
    const store = counterpartyStore(rows);

    await promoteCounterpartyToBoth(store, 'co-1', null);
    await promoteCounterpartyToBoth(store, 'co-1', undefined);
    await promoteCounterpartyToBoth(store, 'other-co', 'cp-1');

    assert.equal(rows[0]!.type, 'VENDOR');
  });
});

describe('the AI revenue summary after a promotion (CON-1, AC16)', () => {
  /**
   * Evaluates the tool's own `where` against the store instead of asserting the shape of it, so the
   * test fails if the filter is ever widened or narrowed, not only if this fixture is edited.
   */
  function prismaWith(counterparties: Row[], payments: Array<{ companyId: string; counterpartyId: string; direction: string; status: string; amount: string; paidAt: Date }>) {
    return {
      client: {
        accountingPayment: {
          groupBy: async ({ where }: any) => {
            const allowed: string[] = where.counterparty.is.type.in;
            const matched = payments.filter((payment) => {
              const counterparty = counterparties.find((row) => row.id === payment.counterpartyId);
              return payment.companyId === where.companyId
                && payment.direction === where.direction
                && payment.status === where.status
                && payment.paidAt >= where.paidAt.gte && payment.paidAt <= where.paidAt.lte
                && !!counterparty && allowed.includes(counterparty.type);
            });
            if (matched.length === 0) return [];
            return [{
              currency: 'THB',
              _sum: { amount: matched.reduce((total, payment) => total + Number(payment.amount), 0).toFixed(4) },
              _count: { _all: matched.length },
            }];
          },
        },
        company: { findUnique: async () => ({ baseCurrency: 'THB' }) },
      },
    } as any;
  }

  const period = { fromDate: '2026-09-01', toDate: '2026-09-30' };
  const ctx = { companyId: 'co-1', userId: 'u-1', permissions: ['crm.report.read'] } as any;
  const payment = { companyId: 'co-1', counterpartyId: 'cp-1', direction: 'RECEIVED', status: 'RECORDED', amount: '5000.0000', paidAt: new Date('2026-09-15T03:00:00.000Z') };

  it('drops the revenue while the counterparty is still VENDOR — the bug this rule exists for', async () => {
    const counterparties: Row[] = [{ id: 'cp-1', companyId: 'co-1', type: 'VENDOR' }];

    const result = await new SalesGetSalesSummaryTool(prismaWith(counterparties, [payment])).execute(ctx, period);

    assert.equal(result.status, 'ok', 'no error is raised — that is precisely why it is silent');
    assert.equal((result.data as any).totalSales, '0');
    assert.equal((result.data as any).transactionCount, 0);
  });

  it('counts it once the sales write promoted the counterparty to BOTH', async () => {
    const counterparties: Row[] = [{ id: 'cp-1', companyId: 'co-1', type: 'VENDOR' }];

    await promoteCounterpartyToBoth(counterpartyStore(counterparties), 'co-1', 'cp-1');
    const result = await new SalesGetSalesSummaryTool(prismaWith(counterparties, [payment])).execute(ctx, period);

    assert.equal((result.data as any).totalSales, '5000.0000');
    assert.equal((result.data as any).transactionCount, 1);
  });
});
