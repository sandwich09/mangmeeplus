import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import {
  claimReceiptQuotaNotice,
  consumeReceiptQuota,
  releaseReceiptQuota,
  reserveReceiptQuota,
} from './prisma-company-receipt-usage.repository';

type Entry = { companyId: string; monthKey: string; requestId: string; status: string };

/**
 * In-memory Prisma stand-in shaped like `fakeOcrPrisma` in `company-ai-usage-meter.spec.ts`:
 * `$transaction` runs callbacks through one promise queue, which is what makes the CAS race below
 * mean something — it emulates the row lock the real `UPDATE ... WHERE count < limit` takes.
 */
function fakeReceiptUsagePrisma(input: { used?: number; noticeSentMonthKey?: string | null; term?: boolean } = {}) {
  const counts = new Map<string, number>();
  const entries = new Map<string, Entry>();
  let noticeSentMonthKey = input.noticeSentMonthKey ?? null;
  let queue = Promise.resolve();
  const key = (companyId: string, monthKey: string) => `${companyId}|${monthKey}`;
  if (input.used !== undefined) counts.set(key('co-1', '2026-09'), input.used);

  const tx = {
    companyReceiptUsageEntry: {
      findUnique: async ({ where }: any) => entries.get(where.requestId) ?? null,
      create: async ({ data }: any) => { entries.set(data.requestId, { ...data }); return data; },
      update: async ({ where, data }: any) => {
        entries.set(where.requestId, { ...entries.get(where.requestId)!, ...data });
        return entries.get(where.requestId)!;
      },
    },
    companyReceiptUsage: {
      findUnique: async ({ where }: any) => {
        const k = key(where.companyId_monthKey.companyId, where.companyId_monthKey.monthKey);
        return counts.has(k) ? { count: counts.get(k)! } : null;
      },
      upsert: async ({ where }: any) => {
        const k = key(where.companyId_monthKey.companyId, where.companyId_monthKey.monthKey);
        if (!counts.has(k)) counts.set(k, 0);
        return { count: counts.get(k)! };
      },
      updateMany: async ({ where }: any) => {
        const k = key(where.companyId, where.monthKey);
        const current = counts.get(k) ?? 0;
        if (where.count?.lt !== undefined && current >= where.count.lt) return { count: 0 };
        if (where.count?.gt !== undefined) {
          if (current <= where.count.gt) return { count: 0 };
          counts.set(k, current - 1);
          return { count: 1 };
        }
        counts.set(k, current + 1);
        return { count: 1 };
      },
    },
  };

  const prisma = {
    client: {
      $transaction: <T>(fn: (value: typeof tx) => Promise<T>): Promise<T> => {
        const result = queue.then(() => fn(tx));
        queue = result.then(() => undefined, () => undefined);
        return result;
      },
      companyReceiptUsageEntry: {
        updateMany: async ({ where, data }: any) => {
          const entry = entries.get(where.requestId);
          if (!entry || entry.status !== where.status) return { count: 0 };
          entries.set(where.requestId, { ...entry, ...data });
          return { count: 1 };
        },
      },
      companyPlanTerm: {
        updateMany: async ({ where, data }: any) => {
          if (!input.term) return { count: 0 };
          const matches = where.OR.some((clause: any) => (
            'quotaNoticeSentMonthKey' in clause && clause.quotaNoticeSentMonthKey === null
              ? noticeSentMonthKey === null
              : noticeSentMonthKey !== null && noticeSentMonthKey !== clause.quotaNoticeSentMonthKey.not
          ));
          if (!matches) return { count: 0 };
          noticeSentMonthKey = data.quotaNoticeSentMonthKey;
          return { count: 1 };
        },
      },
    },
  } as any;

  return { prisma, entries, count: () => counts.get(key('co-1', '2026-09')) ?? 0, notice: () => noticeSentMonthKey };
}

const base = { companyId: 'co-1', monthKey: '2026-09', limit: 15, enforce: true };

describe('receipt quota reservation (P10-L §15.1, review G-01)', () => {
  it('creates the counter row on first use and returns this receipt’s own position', async () => {
    const state = fakeReceiptUsagePrisma();
    assert.deepEqual(
      await reserveReceiptQuota(state.prisma, { ...base, requestId: 'line:m1' }),
      { allowed: true, count: 1, limit: 15 },
    );
    assert.equal(state.entries.get('line:m1')?.status, 'RESERVED');
  });

  it('refuses the receipt past the ceiling, and reports the numbers the reply needs', async () => {
    const state = fakeReceiptUsagePrisma({ used: 15 });
    assert.deepEqual(
      await reserveReceiptQuota(state.prisma, { ...base, requestId: 'line:m16' }),
      { allowed: false, count: 15, limit: 15 },
    );
    // A refusal must not leave a fence behind: the same photo after an upgrade has to be readable.
    assert.equal(state.entries.size, 0);
  });

  it('is idempotent per requestId — a LINE redelivery of one photo buys ONE slip', async () => {
    const state = fakeReceiptUsagePrisma();
    const first = await reserveReceiptQuota(state.prisma, { ...base, requestId: 'line:m1' });
    const redelivered = await reserveReceiptQuota(state.prisma, { ...base, requestId: 'line:m1' });
    assert.deepEqual(first, { allowed: true, count: 1, limit: 15 });
    assert.deepEqual(redelivered, { allowed: true, count: 1, limit: 15 });
    assert.equal(state.count(), 1);
  });

  it('still answers a replay of an already-CONSUMED request without charging again', async () => {
    const state = fakeReceiptUsagePrisma();
    await reserveReceiptQuota(state.prisma, { ...base, requestId: 'web:r1' });
    await consumeReceiptQuota(state.prisma, 'web:r1');
    assert.deepEqual(
      await reserveReceiptQuota(state.prisma, { ...base, requestId: 'web:r1' }),
      { allowed: true, count: 1, limit: 15 },
    );
    assert.equal(state.count(), 1);
  });

  it('serializes two concurrent reserves at limit-1 so exactly one is allowed', async () => {
    const state = fakeReceiptUsagePrisma({ used: 14 });
    const results = await Promise.all([
      reserveReceiptQuota(state.prisma, { ...base, requestId: 'line:a' }),
      reserveReceiptQuota(state.prisma, { ...base, requestId: 'line:b' }),
    ]);
    assert.equal(results.filter((result) => result.allowed).length, 1);
    assert.equal(state.count(), 15);
    assert.equal(state.entries.size, 1);
  });

  it('counts but never blocks while RECEIPT_QUOTA_ENFORCED is off (the production rollout)', async () => {
    const state = fakeReceiptUsagePrisma({ used: 15 });
    const result = await reserveReceiptQuota(state.prisma, { ...base, requestId: 'web:r1', enforce: false });
    assert.deepEqual(result, { allowed: true, count: 16, limit: 15 });
    assert.equal(state.count(), 16, 'the count must keep rising so prod can see the real numbers first');
  });

  it('never blocks a company with no plan term row, even with enforcement on', async () => {
    const state = fakeReceiptUsagePrisma({ used: 999 });
    const result = await reserveReceiptQuota(state.prisma, { ...base, requestId: 'web:r1', limit: null });
    assert.deepEqual(result, { allowed: true, count: 1000, limit: null });
  });

  it('fails OPEN when the store is unavailable — a counter outage is not a refusal', async () => {
    const broken = { client: { $transaction: async () => { throw new Error('DB_DOWN'); } } } as any;
    assert.deepEqual(
      await reserveReceiptQuota(broken, { ...base, requestId: 'web:r1' }),
      { allowed: true, count: 0, limit: 15 },
    );
  });
});

describe('receipt quota release / consume transitions', () => {
  it('release gives the slip back once, marks RELEASED, and is a no-op the second time', async () => {
    const state = fakeReceiptUsagePrisma();
    await reserveReceiptQuota(state.prisma, { ...base, requestId: 'line:m1' });
    await releaseReceiptQuota(state.prisma, 'line:m1');
    assert.equal(state.count(), 0);
    assert.equal(state.entries.get('line:m1')?.status, 'RELEASED');
    await releaseReceiptQuota(state.prisma, 'line:m1');
    assert.equal(state.count(), 0, 'a repeated release must not drive the counter negative');
  });

  it('a RELEASED request re-reserves — a failed read must stay retryable', async () => {
    const state = fakeReceiptUsagePrisma();
    await reserveReceiptQuota(state.prisma, { ...base, requestId: 'line:m1' });
    await releaseReceiptQuota(state.prisma, 'line:m1');
    const retried = await reserveReceiptQuota(state.prisma, { ...base, requestId: 'line:m1' });
    assert.deepEqual(retried, { allowed: true, count: 1, limit: 15 });
    assert.equal(state.entries.get('line:m1')?.status, 'RESERVED');
  });

  it('consume settles the slip so a later release cannot claw it back', async () => {
    const state = fakeReceiptUsagePrisma();
    await reserveReceiptQuota(state.prisma, { ...base, requestId: 'web:r1' });
    await consumeReceiptQuota(state.prisma, 'web:r1');
    assert.equal(state.entries.get('web:r1')?.status, 'CONSUMED');
    await releaseReceiptQuota(state.prisma, 'web:r1');
    assert.equal(state.count(), 1, 'a read that happened stays paid for');
    assert.equal(state.entries.get('web:r1')?.status, 'CONSUMED');
  });

  it('release of an unknown request is silent', async () => {
    const state = fakeReceiptUsagePrisma();
    await releaseReceiptQuota(state.prisma, 'line:never-reserved');
    assert.equal(state.count(), 0);
  });
});

describe('quota notice claim (spec §3.7 — once per month, not a daily nag)', () => {
  it('the first receipt that hits the wall claims the month; the next ones do not', async () => {
    const state = fakeReceiptUsagePrisma({ term: true });
    assert.equal(await claimReceiptQuotaNotice(state.prisma, 'co-1', '2026-09'), true);
    assert.equal(await claimReceiptQuotaNotice(state.prisma, 'co-1', '2026-09'), false);
    assert.equal(state.notice(), '2026-09');
  });

  it('a new month claims again', async () => {
    const state = fakeReceiptUsagePrisma({ term: true, noticeSentMonthKey: '2026-08' });
    assert.equal(await claimReceiptQuotaNotice(state.prisma, 'co-1', '2026-09'), true);
  });

  it('a company with no plan term row has no notice column to claim', async () => {
    const state = fakeReceiptUsagePrisma({ term: false });
    assert.equal(await claimReceiptQuotaNotice(state.prisma, 'co-1', '2026-09'), false);
  });
});

describe('real PostgreSQL CAS', () => {
  it('admits only one of two concurrent reserves at limit-1, from separate connections', async (t) => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) return t.skip('DATABASE_URL is not set');

    const clients = [
      new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) }),
      new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) }),
    ];
    let companyId = '';
    const monthKey = '2099-09';
    try {
      await Promise.all(clients.map((client) => client.$queryRaw`SELECT 1`));
      companyId = (await clients[0]!.company.create({
        data: { name: `receipt-quota-race-${process.pid}-${randomUUID()}`, status: 'ACTIVE' },
        select: { id: true },
      })).id;
      await clients[0]!.companyReceiptUsage.create({ data: { companyId, monthKey, count: 14 } });

      const requestIds = clients.map((_client, index) => `race-${index}-${randomUUID()}`);
      const results = await Promise.all(clients.map((client, index) => reserveReceiptQuota(
        { client } as any,
        { companyId, monthKey, requestId: requestIds[index]!, limit: 15, enforce: true },
      )));

      assert.equal(results.filter((result) => result.allowed).length, 1);
      assert.equal((await clients[0]!.companyReceiptUsage.findUniqueOrThrow({
        where: { companyId_monthKey: { companyId, monthKey } },
        select: { count: true },
      })).count, 15);
      assert.equal(await clients[0]!.companyReceiptUsageEntry.count({ where: { companyId, monthKey } }), 1);

      // The winner's slip is released and the loser can then buy it — the retry path OCR failures use.
      const winner = requestIds[results.findIndex((result) => result.allowed)]!;
      await releaseReceiptQuota({ client: clients[0] } as any, winner);
      assert.equal((await clients[0]!.companyReceiptUsage.findUniqueOrThrow({
        where: { companyId_monthKey: { companyId, monthKey } },
        select: { count: true },
      })).count, 14);
      const loser = requestIds[results.findIndex((result) => !result.allowed)]!;
      assert.equal((await reserveReceiptQuota(
        { client: clients[0] } as any,
        { companyId, monthKey, requestId: loser, limit: 15, enforce: true },
      )).allowed, true);
    } finally {
      if (companyId) await clients[0]!.company.deleteMany({ where: { id: companyId } });
      await Promise.all(clients.map((client) => client.$disconnect().catch(() => undefined)));
    }
  });
});
