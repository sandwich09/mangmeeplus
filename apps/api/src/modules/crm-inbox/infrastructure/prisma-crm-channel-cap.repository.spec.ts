import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaCrmChannelCapRepository } from './prisma-crm-channel-cap.repository';

// In-memory fake that mimics the real WHERE semantics the CAS relies on:
//   increment lands only while count < cap; decrement only while count > 0.
function makeFakePrisma() {
  const rows = new Map<string, { companyId: string; channelId: string; dayKey: string; count: number }>();
  const key = (channelId: string, dayKey: string) => `${channelId}::${dayKey}`;
  return {
    rows,
    client: {
      crmChannelAutoReplyUsage: {
        upsert: async ({ where, create }: any) => {
          const k = key(where.channelId_dayKey.channelId, where.channelId_dayKey.dayKey);
          if (!rows.has(k)) rows.set(k, { ...create });
          return rows.get(k);
        },
        updateMany: async ({ where, data }: any) => {
          const row = rows.get(key(where.channelId, where.dayKey));
          if (!row) return { count: 0 };
          if (where.companyId && row.companyId !== where.companyId) return { count: 0 };
          if (where.count?.lt !== undefined && !(row.count < where.count.lt)) return { count: 0 };
          if (where.count?.gt !== undefined && !(row.count > where.count.gt)) return { count: 0 };
          if (data.count?.increment) row.count += data.count.increment;
          if (data.count?.decrement) row.count -= data.count.decrement;
          return { count: 1 };
        },
      },
    },
  };
}

describe('PrismaCrmChannelCapRepository.tryReserve', () => {
  it('N reservations against cap K yield exactly K trues', async () => {
    const fake = makeFakePrisma();
    const repo = new PrismaCrmChannelCapRepository(fake as any);
    const cap = 3;
    const attempts = 10;

    const results: boolean[] = [];
    for (let i = 0; i < attempts; i++) {
      results.push(await repo.tryReserve('co-1', 'ch-1', '2026-07-12', cap));
    }

    assert.equal(results.filter(Boolean).length, cap);
    assert.equal(fake.rows.get('ch-1::2026-07-12')?.count, cap);
  });

  it('returns false immediately when cap <= 0 and never touches the row', async () => {
    const upsert = mock.fn(async () => ({}));
    const repo = new PrismaCrmChannelCapRepository({
      client: { crmChannelAutoReplyUsage: { upsert } },
    } as any);
    assert.equal(await repo.tryReserve('co-1', 'ch-1', '2026-07-12', 0), false);
    assert.equal(upsert.mock.calls.length, 0);
  });

  it('scopes the CAS increment by company and channel/day', async () => {
    const upsert = mock.fn(async () => ({}));
    const updateMany = mock.fn(async () => ({ count: 1 }));
    const repo = new PrismaCrmChannelCapRepository({
      client: { crmChannelAutoReplyUsage: { upsert, updateMany } },
    } as any);
    await repo.tryReserve('co-1', 'ch-1', '2026-07-12', 5);
    const args = (updateMany.mock.calls as any[])[0].arguments[0];
    assert.deepEqual(args.where, { companyId: 'co-1', channelId: 'ch-1', dayKey: '2026-07-12', count: { lt: 5 } });
    assert.deepEqual(args.data, { count: { increment: 1 } });
  });
});

describe('PrismaCrmChannelCapRepository.release', () => {
  it('decrements a reservation and floors at 0', async () => {
    const fake = makeFakePrisma();
    const repo = new PrismaCrmChannelCapRepository(fake as any);
    await repo.tryReserve('co-1', 'ch-1', '2026-07-12', 5); // count -> 1
    await repo.release('co-1', 'ch-1', '2026-07-12'); // count -> 0
    assert.equal(fake.rows.get('ch-1::2026-07-12')?.count, 0);
    // Already at 0: release is a no-op (WHERE count > 0 does not match).
    await repo.release('co-1', 'ch-1', '2026-07-12');
    assert.equal(fake.rows.get('ch-1::2026-07-12')?.count, 0);
  });

  it('frees capacity so a capped channel can reserve again', async () => {
    const fake = makeFakePrisma();
    const repo = new PrismaCrmChannelCapRepository(fake as any);
    assert.equal(await repo.tryReserve('co-1', 'ch-1', '2026-07-12', 1), true); // count 1, at cap
    assert.equal(await repo.tryReserve('co-1', 'ch-1', '2026-07-12', 1), false); // full
    await repo.release('co-1', 'ch-1', '2026-07-12'); // count 0
    assert.equal(await repo.tryReserve('co-1', 'ch-1', '2026-07-12', 1), true); // reusable
  });
});
