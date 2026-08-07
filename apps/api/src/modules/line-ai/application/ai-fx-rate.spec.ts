import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { __resetFxCache, resolveThbPerUsd } from './ai-fx-rate';

const config = { aiThbPerUsd: 33 } as any;

/** The single-row `AiFxRate` delegate, with the stored row and the writes both observable. */
function fxPrisma(stored?: { rate: unknown; fetchedAt: Date } | Error) {
  const upserts: any[] = [];
  const reads: number[] = [];
  const client = {
    aiFxRate: {
      findUnique: async () => {
        reads.push(Date.now());
        if (stored instanceof Error) throw stored;
        return stored ?? null;
      },
      upsert: async (args: any) => { upserts.push(args); return {}; },
    },
  };
  return { prisma: { client } as any, upserts, reads };
}

/** Never let a spec reach the network: every test installs its own stub. */
function stubFetch(impl: () => Promise<unknown>) {
  const calls: string[] = [];
  (globalThis as any).fetch = async (url: unknown) => {
    calls.push(String(url));
    return impl();
  };
  return calls;
}

const okResponse = (thb: unknown) => ({ ok: true, json: async () => ({ rates: { THB: thb } }) });

let warnings: any[];
const originalWarn = Logger.prototype.warn;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  warnings = [];
  (Logger.prototype as any).warn = (payload: any) => { warnings.push(payload); };
  __resetFxCache();
});
afterEach(() => {
  (Logger.prototype as any).warn = originalWarn;
  globalThis.fetch = originalFetch;
  mock.timers.reset();
});

describe('resolveThbPerUsd live fetch', () => {
  it('takes rates.THB, reports it as fetched, and upserts the operational row', async () => {
    const calls = stubFetch(async () => okResponse(35.4321));
    const { prisma, upserts } = fxPrisma();

    assert.deepEqual(await resolveThbPerUsd(prisma, config), { rate: 35.4321, source: 'fetched' });
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /open\.er-api\.com/);
    assert.equal(upserts.length, 1);
    assert.deepEqual(upserts[0].where, { id: 'THB_USD' });
    assert.equal(upserts[0].create.rate, 35.4321);
    assert.equal(upserts[0].update.rate, 35.4321);
    assert.equal(upserts[0].create.source, 'open.er-api.com');
  });

  it('serves the cached rate for the TTL window and re-fetches after it', async () => {
    const calls = stubFetch(async () => okResponse(34));
    const { prisma } = fxPrisma();
    mock.timers.enable({ apis: ['Date'] });

    assert.equal((await resolveThbPerUsd(prisma, config)).source, 'fetched');
    assert.deepEqual(await resolveThbPerUsd(prisma, config), { rate: 34, source: 'live-cache' });
    assert.equal(calls.length, 1, 'no outbound call per recording — one per TTL window');

    mock.timers.tick(6 * 60 * 60 * 1000 + 1);
    assert.equal((await resolveThbPerUsd(prisma, config)).source, 'fetched');
    assert.equal(calls.length, 2);
  });

  it('__resetFxCache brings the module back to cold', async () => {
    const calls = stubFetch(async () => okResponse(34));
    const { prisma } = fxPrisma();

    await resolveThbPerUsd(prisma, config);
    __resetFxCache();
    await resolveThbPerUsd(prisma, config);

    assert.equal(calls.length, 2);
  });

  it('still returns the good rate when storing it fails', async () => {
    stubFetch(async () => okResponse(34));
    const prisma = {
      client: {
        aiFxRate: {
          findUnique: async () => null,
          upsert: async () => { throw new Error('DB_DOWN'); },
        },
      },
    } as any;

    assert.deepEqual(await resolveThbPerUsd(prisma, config), { rate: 34, source: 'fetched' });
    assert.equal(warnings.filter((w) => w?.msg === 'ai.fx.store_failed').length, 1);
  });
});

describe('resolveThbPerUsd sanity bound', () => {
  for (const rate of [19.99, 60.01, 0, -33, 'thirty-three', null, undefined, Number.NaN]) {
    it(`treats ${String(rate)} as a failed fetch and never prices at it`, async () => {
      stubFetch(async () => okResponse(rate));
      const { prisma } = fxPrisma();

      const resolved = await resolveThbPerUsd(prisma, config);

      assert.deepEqual(resolved, { rate: 33, source: 'env-fallback' });
      assert.equal(warnings.filter((w) => w?.msg === 'ai.fx.rejected').length, 1);
    });
  }

  for (const rate of [20, 60]) {
    it(`accepts the boundary value ${rate}`, async () => {
      stubFetch(async () => okResponse(rate));
      const { prisma } = fxPrisma();
      assert.deepEqual(await resolveThbPerUsd(prisma, config), { rate, source: 'fetched' });
    });
  }

  it('refuses to trust an out-of-bounds stored row either', async () => {
    stubFetch(async () => { throw new Error('offline'); });
    const { prisma } = fxPrisma({ rate: 3300, fetchedAt: new Date() });

    assert.deepEqual(await resolveThbPerUsd(prisma, config), { rate: 33, source: 'env-fallback' });
    assert.equal(warnings.filter((w) => w?.msg === 'ai.fx.rejected_stored_rate').length, 1);
  });
});

describe('resolveThbPerUsd fallback chain', () => {
  it('falls back to the stored row when the fetch fails', async () => {
    stubFetch(async () => { throw new Error('ENOTFOUND'); });
    const { prisma } = fxPrisma({ rate: 36.5, fetchedAt: new Date() });

    assert.deepEqual(await resolveThbPerUsd(prisma, config), { rate: 36.5, source: 'stored' });
    assert.equal(warnings.filter((w) => w?.msg === 'ai.fx.fetch_failed').length, 1);
  });

  it('falls back to the stored row on a non-2xx response', async () => {
    stubFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const { prisma } = fxPrisma({ rate: 36.5, fetchedAt: new Date() });

    assert.equal((await resolveThbPerUsd(prisma, config)).source, 'stored');
  });

  it('uses a week-old stored row anyway, but says so loudly', async () => {
    stubFetch(async () => { throw new Error('offline'); });
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const { prisma } = fxPrisma({ rate: 31, fetchedAt: eightDaysAgo });

    assert.deepEqual(await resolveThbPerUsd(prisma, config), { rate: 31, source: 'stored' });
    assert.equal(warnings.filter((w) => w?.msg === 'ai.fx.stale_stored_rate').length, 1);
  });

  it('falls back to the env rate with one warn per TTL window, not per call', async () => {
    const calls = stubFetch(async () => { throw new Error('offline'); });
    const { prisma, reads } = fxPrisma();

    assert.deepEqual(await resolveThbPerUsd(prisma, config), { rate: 33, source: 'env-fallback' });
    assert.deepEqual(await resolveThbPerUsd(prisma, config), { rate: 33, source: 'env-fallback' });

    assert.equal(calls.length, 1, 'a dead source must not cost an outbound attempt per recording');
    assert.equal(reads.length, 2, 'the stored row is still consulted — it may appear at any time');
    assert.equal(warnings.filter((w) => w?.msg === 'ai.fx.env_fallback').length, 1);
  });

  it('degrades to the env rate without any outbound call when the delegate is missing', async () => {
    const calls = stubFetch(async () => okResponse(34));

    assert.deepEqual(await resolveThbPerUsd({ client: {} } as any, config), { rate: 33, source: 'env-fallback' });
    assert.equal(calls.length, 0, 'unit fakes predating the table must not reach the network');
  });

  it('never throws when the stored read throws', async () => {
    stubFetch(async () => { throw new Error('offline'); });
    const { prisma } = fxPrisma(new Error('DB_DOWN'));

    assert.deepEqual(await resolveThbPerUsd(prisma, config), { rate: 33, source: 'env-fallback' });
    assert.equal(warnings.filter((w) => w?.msg === 'ai.fx.read_failed').length, 1);
  });

  it('prices at 33 rather than NaN when even the env value is missing (stale config dist)', async () => {
    stubFetch(async () => { throw new Error('offline'); });
    const { prisma } = fxPrisma();

    assert.deepEqual(await resolveThbPerUsd(prisma, {} as any), { rate: 33, source: 'env-fallback' });
  });

  it('honours a configured env rate outside the live-source bound', async () => {
    stubFetch(async () => { throw new Error('offline'); });
    const { prisma } = fxPrisma();

    // The bound exists to distrust a remote payload, not to override the operator's own config.
    assert.deepEqual(await resolveThbPerUsd(prisma, { aiThbPerUsd: 80 } as any), { rate: 80, source: 'env-fallback' });
  });
});
