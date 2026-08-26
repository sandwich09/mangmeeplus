import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
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

  it('blocks a quotation bundle when the locked opportunity or customer moved outside branch scope', async () => {
    let writes = 0;
    const tx = {
      $queryRaw: async () => [],
      crmOpportunity: {
        findFirst: async () => ({
          id: 'opportunity-1', companyId: 'co-1', customerId: 'customer-1', ownerUserId: 'sales-1',
          branchId: 'branch-allowed', status: 'OPEN', currency: 'THB',
        }),
      },
      crmCustomer: {
        findFirst: async () => ({
          id: 'customer-1', companyId: 'co-1', branchId: 'branch-denied', ownerUserId: 'sales-1',
          status: 'ACTIVE', personalDataErasedAt: null,
        }),
      },
      crmQuotationLink: { findFirst: async () => { writes += 1; return null; } },
    };
    const repo = new PrismaCrmRepository({ client: { $transaction: async (run: any) => run(tx) } } as any);
    await assert.rejects(
      () => repo.createQuotationDraftBundle({
        companyId: 'co-1', opportunityId: 'opportunity-1', expectedCustomerId: 'customer-1',
        scope: { actorUserId: 'sales-1', canManageAll: false, branchIds: ['branch-allowed'] },
        userId: 'sales-1', requestId: 'request-1', requestKey: 'command-1', allowRevision: false,
      }),
      /customer_out_of_scope/,
    );
    assert.equal(writes, 0);
  });
});

function crmTestDatabaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const candidate of [join(process.cwd(), '.env'), join(process.cwd(), '../.env'), join(process.cwd(), '../../.env')]) {
    try {
      const match = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(candidate, 'utf8'));
      if (match?.[1]) return match[1];
    } catch {
      // Keep walking toward the workspace root.
    }
  }
  return null;
}

const requireP27Postgres = process.env.P27_REQUIRE_POSTGRES === 'true';

describe('PrismaCrmRepository Inbox quotation bundle (real PostgreSQL)', () => {
  const tag = randomUUID();
  const companyId = `crm-inbox-bundle-${tag}`;
  const userId = `crm-inbox-user-${tag}`;
  let client: PrismaClient | null = null;
  let repo: PrismaCrmRepository | null = null;
  let customerId = '';

  before(async () => {
    const url = crmTestDatabaseUrl();
    if (!url) {
      if (requireP27Postgres) throw new Error('P27 PostgreSQL is required but DATABASE_URL is unavailable');
      return;
    }
    try {
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      await client.company.create({ data: { id: companyId, name: 'CRM Inbox atomic bundle test' } });
      await client.user.create({ data: { id: userId, displayName: 'CRM Inbox test user' } });
      await client.companyMembership.create({ data: { companyId, userId } });
      const customer = await client.crmCustomer.create({ data: {
        companyId, displayName: 'ลูกค้าทดสอบ transaction', displayNameNormalized: 'ลูกค้าทดสอบ transaction',
        ownerUserId: userId, createdByUserId: userId,
      } });
      customerId = customer.id;
      repo = new PrismaCrmRepository({ client } as any);
    } catch (error) {
      repo = null;
      if (requireP27Postgres) throw error;
    }
  });

  after(async () => {
    if (!client) return;
    await client.company.deleteMany({ where: { id: companyId } }).catch(() => {});
    await client.user.deleteMany({ where: { id: userId } }).catch(() => {});
    await client.$disconnect();
  });

  it('writes zero rows on gate denial, then commits and replays one exact bundle', async (t) => {
    if (!client || !repo) return t.skip('local PostgreSQL is unavailable');
    const input = {
      companyId,
      opportunityId: `convq_${tag.replaceAll('-', '').slice(0, 32)}`,
      customerId,
      title: 'ใบเสนอราคาจาก Inbox',
      amountEstimate: '2500.0000',
      scope: { actorUserId: userId, canManageAll: false },
      userId,
      requestId: `request-${tag}`,
      requestKey: `command-${tag}`,
    };
    await assert.rejects(
      () => repo!.createConversationQuotationDraftBundle(input, async () => { throw new Error('gate_closed'); }),
      /gate_closed/,
    );
    assert.equal(await client.crmOpportunity.count({ where: { companyId } }), 0);
    assert.equal(await client.accountingDocument.count({ where: { companyId } }), 0);
    assert.equal(await client.crmQuotationLink.count({ where: { companyId } }), 0);

    const first = await repo.createConversationQuotationDraftBundle(input, async () => undefined);
    const replay = await repo.createConversationQuotationDraftBundle(input, async () => { throw new Error('replay_must_not_recheck_gate'); });
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.opportunity.id, first.opportunity.id);
    assert.equal(replay.quotation.id, first.quotation.id);
    await assert.rejects(
      () => repo!.createConversationQuotationDraftBundle({ ...input, title: 'เปลี่ยนรายละเอียดแต่ใช้ key เดิม' }, async () => undefined),
      /quotation_command_conflict/,
    );
    assert.equal(await client.crmOpportunity.count({ where: { companyId } }), 1);
    assert.equal(await client.accountingDocument.count({ where: { companyId, documentType: 'QUOTATION' } }), 1);
    assert.equal(await client.crmQuotationLink.count({ where: { companyId } }), 1);
  });
});
