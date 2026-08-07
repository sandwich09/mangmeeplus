import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaCrmRepository } from './prisma-crm.repository';

describe('PrismaCrmRepository customer summary scope', () => {
  it('counts canonical non-merged customers inside company, owner, and branch scope', async () => {
    const calls: any[] = [];
    const values = [12, 9, 1, 2, 3];
    const repo = new PrismaCrmRepository({
      client: {
        crmCustomer: { count: async (args: any) => { calls.push(args.where); return values[calls.length - 1]; } },
        $transaction: async (queries: unknown[]) => Promise.all(queries),
      },
    } as any);
    const newSince = new Date('2026-06-30T17:00:00.000Z');

    assert.deepEqual(await repo.summarizeCustomers({ companyId: 'co-1', ownerUserId: 'u-1', branchIds: ['br-1'], newSince }), {
      total: 12, active: 9, inactive: 1, archived: 2, newCustomers: 3,
    });
    for (const where of calls) {
      assert.equal(where.companyId, 'co-1');
      assert.equal(where.ownerUserId, 'u-1');
      assert.deepEqual(where.AND, [{ OR: [{ branchId: { in: ['br-1'] } }, { branchId: null }] }]);
    }
    assert.deepEqual(calls[0].status, { not: 'MERGED' });
    assert.deepEqual(calls[4].createdAt, { gte: newSince });
  });
});

describe('PrismaCrmRepository booking reminder tombstone boundary', () => {
  it('excludes erased customers both when scanning and when claiming a stale scan result', async () => {
    const findMany = mock.fn(async () => []);
    const updateMany = mock.fn(async () => ({ count: 0 }));
    const repo = new PrismaCrmRepository({
      client: { crmBooking: { findMany, updateMany } },
    } as any);
    const now = new Date('2026-07-12T00:00:00.000Z');

    assert.deepEqual(await repo.findDueBookingReminders(now, 3_600_000, 50), []);
    assert.equal(await repo.claimBookingReminder('booking-erased', now, 120_000, 5), false);

    assert.deepEqual((findMany.mock.calls as any[])[0].arguments[0].where.customer, {
      status: 'ACTIVE', personalDataErasedAt: null,
    });
    assert.deepEqual((updateMany.mock.calls as any[])[0].arguments[0].where.customer, {
      status: 'ACTIVE', personalDataErasedAt: null,
    });
    assert.deepEqual((findMany.mock.calls as any[])[0].arguments[0].where.AND, [
      { OR: [{ reminderNextAttemptAt: null }, { reminderNextAttemptAt: { lte: now } }] },
      { OR: [{ reminderClaimedAt: null }, { reminderClaimedAt: { lt: new Date(now.getTime() - 120_000) } }] },
    ]);
    assert.deepEqual((updateMany.mock.calls as any[])[0].arguments[0].data, {
      reminderClaimedAt: now,
      reminderAttemptCount: { increment: 1 },
      reminderNextAttemptAt: null,
      reminderLastError: null,
    });
  });
});

describe('PrismaCrmRepository daily-brief customer scope', () => {
  it('pushes owner and branch scope into customer, booking, and deal aggregates', async () => {
    const customerCount = mock.fn(async () => 2);
    const bookingCount = mock.fn(async () => 3);
    const opportunityFindMany = mock.fn(async () => []);
    const repo = new PrismaCrmRepository({
      client: {
        crmCustomer: { count: customerCount },
        crmBooking: { count: bookingCount },
        crmOpportunity: { findMany: opportunityFindMany },
      },
    } as any);
    const start = new Date('2026-07-01T00:00:00.000Z');
    const end = new Date('2026-07-02T00:00:00.000Z');
    const scope = { ownerUserId: 'sales-1', branchIds: ['branch-1'] };

    assert.equal(await repo.countCustomersBetween('co-1', start, end, scope), 2);
    assert.equal(await repo.countBookingsBetween('co-1', start, end, scope), 3);
    assert.deepEqual(await repo.listOpportunities({ companyId: 'co-1', ownerUserId: 'sales-1', branchIds: ['branch-1'], status: 'OPEN' }), []);

    assert.deepEqual((customerCount.mock.calls as any[])[0].arguments[0].where, {
      companyId: 'co-1',
      ownerUserId: 'sales-1',
      OR: [{ branchId: { in: ['branch-1'] } }, { branchId: null }],
      createdAt: { gte: start, lt: end },
    });
    assert.deepEqual((bookingCount.mock.calls as any[])[0].arguments[0].where, {
      companyId: 'co-1',
      branchId: { in: ['branch-1'] },
      customer: { ownerUserId: 'sales-1' },
      status: 'BOOKED',
      startAt: { gte: start, lt: end },
    });
    assert.deepEqual((opportunityFindMany.mock.calls as any[])[0].arguments[0].where, {
      companyId: 'co-1',
      ownerUserId: 'sales-1',
      OR: [{ branchId: { in: ['branch-1'] } }, { branchId: null }],
      status: 'OPEN',
      stageId: undefined,
      customerId: undefined,
    });
  });
});

describe('PrismaCrmRepository branch and membership write boundaries', () => {
  it('rejects stale/cross-company branches before customer, lead, or opportunity creation', async () => {
    let writes = 0;
    const tx = {
      branch: { findFirst: async () => null },
      companyMembership: { findFirst: async () => ({ id: 'membership-1' }) },
      crmCustomer: { create: async () => { writes += 1; return {}; } },
      crmLead: { create: async () => { writes += 1; return {}; } },
      crmOpportunity: { create: async () => { writes += 1; return {}; } },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    await assert.rejects(
      () => repo.createCustomer({ companyId: 'co-1', branchId: 'branch-other', ownerUserId: 'owner-1', displayName: 'X' }),
      /branch_not_active_in_company/,
    );
    await assert.rejects(
      () => repo.createLead({ companyId: 'co-1', branchId: 'branch-other', assignedToUserId: 'owner-1', rawName: 'X' }),
      /branch_not_active_in_company/,
    );
    await assert.rejects(
      () => repo.createOpportunity(
        { companyId: 'co-1', branchId: 'branch-other', customerId: 'customer-1', ownerUserId: 'owner-1', title: 'X' },
        { actorUserId: 'owner-1', canManageAll: false },
      ),
      /branch_not_active_in_company/,
    );
    assert.equal(writes, 0);
  });

  it('rechecks current customer branch scope under the final customer lock', async () => {
    let writes = 0;
    const existing = {
      id: 'customer-1', companyId: 'co-1', branchId: 'branch-denied', ownerUserId: 'sales-1',
      status: 'ACTIVE', personalDataErasedAt: null,
    };
    const tx = {
      $queryRaw: async () => [],
      crmCustomer: {
        findFirst: async () => existing,
        updateMany: async () => { writes += 1; return { count: 1 }; },
      },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    await assert.rejects(
      () => repo.updateCustomer(
        'co-1',
        'customer-1',
        { notes: 'blocked' },
        undefined,
        { actorUserId: 'sales-1', canManageAll: false, branchIds: ['branch-allowed'] },
      ),
      /customer_out_of_scope/,
    );
    assert.equal(writes, 0);
  });
});
