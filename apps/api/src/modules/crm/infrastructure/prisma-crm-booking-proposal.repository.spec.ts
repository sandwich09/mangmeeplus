import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaCrmBookingProposalRepository } from './prisma-crm-booking-proposal.repository';

const now = new Date('2026-07-12T00:00:00.000Z');

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prop-1', companyId: 'co-1', conversationId: 'conv-1', customerId: 'cust-1',
    serviceItemId: null, staffUserId: null, branchId: null,
    slotStart: now, slotEnd: now, status: 'PROPOSED',
    sourceMessageId: null, confirmMessageId: null, questionSentAt: null, expiresAt: now,
    idempotencyKey: 'idem-1', bookingId: null, createdAt: now, updatedAt: now,
    ...overrides,
  };
}

describe('PrismaCrmBookingProposalRepository.create', () => {
  it('creates once by idempotencyKey (upsert with empty update) and maps the row', async () => {
    const upsert = mock.fn(async (args: any) => baseRow({ status: args.create.status }));
    const repo = new PrismaCrmBookingProposalRepository({ client: { crmBookingProposal: { upsert } } } as any);

    const result = await repo.create({
      companyId: 'co-1', conversationId: 'conv-1', customerId: 'cust-1',
      slotStart: now, slotEnd: now, expiresAt: now, idempotencyKey: 'idem-1',
    });

    const args = (upsert.mock.calls as any[])[0].arguments[0];
    assert.deepEqual(args.where, { idempotencyKey: 'idem-1' });
    assert.deepEqual(args.update, {});
    assert.equal(args.create.status, 'PROPOSED');
    assert.equal(args.create.companyId, 'co-1');
    assert.equal(result.id, 'prop-1');
    assert.equal(result.status, 'PROPOSED');
  });

  it('always persists PROPOSED even when a caller supplies a terminal status', async () => {
    const upsert = mock.fn(async (args: any) => baseRow({ status: args.create.status }));
    const repo = new PrismaCrmBookingProposalRepository({ client: { crmBookingProposal: { upsert } } } as any);

    const result = await repo.create({
      companyId: 'co-1', conversationId: 'conv-1', customerId: 'cust-1',
      slotStart: now, slotEnd: now, expiresAt: now, idempotencyKey: 'idem-1',
      status: 'BOOKED',
    });

    const args = (upsert.mock.calls as any[])[0].arguments[0];
    assert.equal(args.create.status, 'PROPOSED');
    assert.equal(result.status, 'PROPOSED');
  });
});

describe('PrismaCrmBookingProposalRepository.findActiveByConversation', () => {
  it('scopes by company and filters to non-terminal statuses, newest first', async () => {
    const findFirst = mock.fn(async () => baseRow({ status: 'AWAITING_CONFIRMATION' }));
    const repo = new PrismaCrmBookingProposalRepository({ client: { crmBookingProposal: { findFirst } } } as any);

    const result = await repo.findActiveByConversation('co-1', 'conv-1');

    const args = (findFirst.mock.calls as any[])[0].arguments[0];
    assert.equal(args.where.companyId, 'co-1');
    assert.equal(args.where.conversationId, 'conv-1');
    assert.deepEqual(args.where.status, { in: ['PROPOSED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'COMMITTING'] });
    assert.deepEqual(args.orderBy, { createdAt: 'desc' });
    assert.equal(result?.status, 'AWAITING_CONFIRMATION');
  });

  it('returns null when no active proposal exists', async () => {
    const repo = new PrismaCrmBookingProposalRepository({
      client: { crmBookingProposal: { findFirst: async () => null } },
    } as any);
    assert.equal(await repo.findActiveByConversation('co-1', 'conv-1'), null);
  });
});

describe('PrismaCrmBookingProposalRepository.markStatus CAS', () => {
  it('returns true only when the compare-and-set updates exactly one row', async () => {
    const updateMany = mock.fn(async () => ({ count: 1 }));
    const repo = new PrismaCrmBookingProposalRepository({ client: { crmBookingProposal: { updateMany } } } as any);

    const won = await repo.markStatus('co-1', 'prop-1', 'AWAITING_CONFIRMATION', 'CONFIRMED');

    const args = (updateMany.mock.calls as any[])[0].arguments[0];
    assert.deepEqual(args.where, { id: 'prop-1', companyId: 'co-1', status: 'AWAITING_CONFIRMATION' });
    assert.deepEqual(args.data, { status: 'CONFIRMED' });
    assert.equal(won, true);
  });

  it('throws on an illegal transition before touching the row', async () => {
    const updateMany = mock.fn(async () => ({ count: 1 }));
    const repo = new PrismaCrmBookingProposalRepository({ client: { crmBookingProposal: { updateMany } } } as any);

    await assert.rejects(
      repo.markStatus('co-1', 'prop-1', 'EXPIRED', 'BOOKED'),
      /illegal_booking_proposal_transition:EXPIRED->BOOKED/,
    );
    assert.equal(updateMany.mock.calls.length, 0);
  });

  it('returns false when another racer already moved the proposal (count 0)', async () => {
    const repo = new PrismaCrmBookingProposalRepository({
      client: { crmBookingProposal: { updateMany: async () => ({ count: 0 }) } },
    } as any);
    assert.equal(await repo.markStatus('co-1', 'prop-1', 'AWAITING_CONFIRMATION', 'CONFIRMED'), false);
  });

  it('atomically attaches booking evidence on the winning hop', async () => {
    const updateMany = mock.fn(async () => ({ count: 1 }));
    const repo = new PrismaCrmBookingProposalRepository({ client: { crmBookingProposal: { updateMany } } } as any);

    await repo.markStatus('co-1', 'prop-1', 'COMMITTING', 'BOOKED', { bookingId: 'bk-9' });

    const args = (updateMany.mock.calls as any[])[0].arguments[0];
    assert.deepEqual(args.data, { status: 'BOOKED', bookingId: 'bk-9' });
  });

  it('runs the CAS on a passed client (the ask-lock tx) instead of the outer client when provided', async () => {
    // The confirm path claims AWAITING→CONFIRMED ON the ask-lock tx so a holder death
    // rolls the claim back; the repo must route the updateMany to that client, not the outer.
    const outer = mock.fn(async () => ({ count: 0 }));
    const txUpdateMany = mock.fn(async () => ({ count: 1 }));
    const repo = new PrismaCrmBookingProposalRepository({ client: { crmBookingProposal: { updateMany: outer } } } as any);
    const tx = { crmBookingProposal: { updateMany: txUpdateMany } };

    const won = await repo.markStatus('co-1', 'prop-1', 'AWAITING_CONFIRMATION', 'CONFIRMED', undefined, tx as any);

    assert.equal(won, true);
    assert.equal(txUpdateMany.mock.calls.length, 1); // ran on the tx
    assert.equal(outer.mock.calls.length, 0); // never touched the outer client
  });

  it('lets exactly one of two concurrent confirmations win', async () => {
    // Fake enforces the WHERE status = from guard against shared state.
    let status = 'AWAITING_CONFIRMATION';
    const client = {
      crmBookingProposal: {
        updateMany: async ({ where, data }: any) => {
          if (status !== where.status) return { count: 0 };
          status = data.status;
          return { count: 1 };
        },
      },
    };
    const repo = new PrismaCrmBookingProposalRepository({ client } as any);
    const results = await Promise.all([
      repo.markStatus('co-1', 'prop-1', 'AWAITING_CONFIRMATION', 'CONFIRMED'),
      repo.markStatus('co-1', 'prop-1', 'AWAITING_CONFIRMATION', 'CONFIRMED'),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(status, 'CONFIRMED');
  });
});

describe('PrismaCrmBookingProposalRepository.createSuperseding', () => {
  // Mimic Postgres 25P02: once any statement errors inside a transaction, the txn is
  // aborted and every subsequent statement fails. Wrapping the tx fake this way means a
  // create-then-catch-P2002-then-keep-querying pattern (the G1 regression) can no longer
  // hide behind a forgiving in-memory double — the caught path would reject here too.
  const abortableTx = (tx: any) => {
    let aborted = false;
    const wrap = (fn: any) => async (...args: any[]) => {
      if (aborted) throw new Error('current transaction is aborted (25P02)');
      try {
        return await fn(...args);
      } catch (error) {
        aborted = true;
        throw error;
      }
    };
    const proxied: any = { $queryRaw: wrap(tx.$queryRaw), crmBookingProposal: {} };
    for (const [key, fn] of Object.entries(tx.crmBookingProposal)) proxied.crmBookingProposal[key] = wrap(fn);
    return proxied;
  };
  const makeRepo = (tx: any) =>
    new PrismaCrmBookingProposalRepository({ client: { $transaction: async (fn: any) => fn(abortableTx(tx)) } } as any);

  it('takes the advisory lock, finds nothing, inserts (query-first), then supersedes when fresh', async () => {
    const order: string[] = [];
    const rawCalls: any[][] = [];
    let superseded: any;
    const tx = {
      $queryRaw: async (...args: any[]) => { rawCalls.push(args); order.push('lock'); return []; },
      crmBookingProposal: {
        findUnique: async () => { order.push('find'); return null; },
        create: async (args: any) => { order.push('create'); return baseRow({ id: 'prop-new', status: args.data.status }); },
        update: async () => { order.push('update'); return baseRow(); },
        updateMany: async (args: any) => { order.push('supersede'); superseded = args; return { count: 2 }; },
      },
    };
    const repo = makeRepo(tx);

    const { proposal, fresh } = await repo.createSuperseding({
      companyId: 'co-1', conversationId: 'conv-1', customerId: 'cust-1',
      slotStart: now, slotEnd: now, expiresAt: now, idempotencyKey: 'idem-1',
    });

    assert.deepEqual(order, ['lock', 'find', 'create', 'supersede']); // find BEFORE create — never create-then-catch
    assert.match(rawCalls[0][0].join('?'), /pg_advisory_xact_lock\(hashtext/);
    assert.deepEqual(rawCalls[0].slice(1), ['co-1', 'conv-1']);
    assert.equal(fresh, true);
    assert.equal(proposal.id, 'prop-new');
    assert.deepEqual(superseded.where.id, { not: 'prop-new' });
    assert.deepEqual(superseded.where.status, { in: ['PROPOSED', 'AWAITING_CONFIRMATION'] });
    assert.deepEqual(superseded.data, { status: 'CANCELLED' });
  });

  it('leaves an existing OPEN (AWAITING) row intact and skips create + supersede (fresh=false)', async () => {
    const order: string[] = [];
    const tx = {
      $queryRaw: async () => { order.push('lock'); return []; },
      crmBookingProposal: {
        findUnique: async () => { order.push('find'); return baseRow({ status: 'AWAITING_CONFIRMATION' }); },
        create: async () => { order.push('create'); return baseRow(); },
        update: async () => { order.push('update'); return baseRow(); },
        updateMany: async () => { order.push('supersede'); return { count: 0 }; },
      },
    };
    const repo = makeRepo(tx);

    const { proposal, fresh } = await repo.createSuperseding({
      companyId: 'co-1', conversationId: 'conv-1', customerId: 'cust-1',
      slotStart: now, slotEnd: now, expiresAt: now, idempotencyKey: 'idem-1',
    });

    assert.equal(fresh, false);
    assert.equal(proposal.status, 'AWAITING_CONFIRMATION');
    assert.deepEqual(order, ['lock', 'find']); // no create, no rotate, no supersede
  });

  it('F6: refreshes an existing PROPOSED-but-undelivered row expiry+source and re-asks (fresh=true)', async () => {
    const order: string[] = [];
    let updateArgs: any;
    let superseded: any;
    const newExpiry = new Date('2026-07-12T03:00:00.000Z');
    const tx = {
      $queryRaw: async () => [],
      crmBookingProposal: {
        findUnique: async () => { order.push('find'); return baseRow({ id: 'prop-old', status: 'PROPOSED', expiresAt: now }); },
        create: async () => { order.push('create'); return baseRow(); },
        update: async (args: any) => { order.push('update'); updateArgs = args; return baseRow({ id: 'prop-old', status: 'PROPOSED', ...args.data }); },
        updateMany: async (args: any) => { order.push('supersede'); superseded = args; return { count: 1 }; },
      },
    };
    const repo = makeRepo(tx);

    const { proposal, fresh } = await repo.createSuperseding({
      companyId: 'co-1', conversationId: 'conv-1', customerId: 'cust-1',
      slotStart: now, slotEnd: now, expiresAt: newExpiry, sourceMessageId: 'msg-9', idempotencyKey: 'idem-1',
    });

    assert.equal(fresh, true);
    assert.equal(proposal.id, 'prop-old');
    assert.deepEqual(updateArgs.where, { id: 'prop-old' });
    assert.deepEqual(updateArgs.data, { expiresAt: newExpiry, sourceMessageId: 'msg-9' });
    assert.deepEqual(superseded.where.id, { not: 'prop-old' }); // still supersedes siblings
    assert.deepEqual(order, ['find', 'update', 'supersede']); // no create
  });

  it('F7: rotates a TERMINAL (e.g. EXPIRED) fingerprint aside and inserts a fresh proposal (fresh=true)', async () => {
    const order: string[] = [];
    let rotateArgs: any;
    const tx = {
      $queryRaw: async () => [],
      crmBookingProposal: {
        findUnique: async () => { order.push('find'); return baseRow({ id: 'prop-old', status: 'EXPIRED' }); },
        create: async (args: any) => { order.push('create'); return baseRow({ id: 'prop-new', status: args.data.status }); },
        update: async (args: any) => { order.push('rotate'); rotateArgs = args; return baseRow({ id: 'prop-old' }); },
        updateMany: async () => { order.push('supersede'); return { count: 0 }; },
      },
    };
    const repo = makeRepo(tx);

    const { proposal, fresh } = await repo.createSuperseding({
      companyId: 'co-1', conversationId: 'conv-1', customerId: 'cust-1',
      slotStart: now, slotEnd: now, expiresAt: now, idempotencyKey: 'idem-1',
    });

    assert.equal(fresh, true);
    assert.equal(proposal.id, 'prop-new');
    // The terminal row's key is rotated aside so its fingerprint is freed, audit row kept.
    assert.deepEqual(rotateArgs.where, { id: 'prop-old' });
    assert.equal(rotateArgs.data.idempotencyKey, 'idem-1:s:prop-old');
    assert.deepEqual(order, ['find', 'rotate', 'create', 'supersede']); // find-first, no create-then-catch
  });

  it('does not swallow a create failure inside the txn: a thrown insert aborts (25P02), no in-txn recovery', async () => {
    // G1 regression guard: if the insert throws (e.g. a concurrent P2002), there is no
    // catch that re-queries — the whole createSuperseding rejects, exactly as a real
    // aborted Postgres transaction would. A single query-first read, then the abort.
    const P2002 = Object.assign(new Error('unique violation'), { code: 'P2002' });
    let findCalls = 0;
    const tx = {
      $queryRaw: async () => [],
      crmBookingProposal: {
        findUnique: async () => { findCalls += 1; return null; },
        create: async () => { throw P2002; },
        update: async () => baseRow(),
        updateMany: async () => ({ count: 0 }),
      },
    };
    const repo = makeRepo(tx);

    await assert.rejects(repo.createSuperseding({
      companyId: 'co-1', conversationId: 'conv-1', customerId: 'cust-1',
      slotStart: now, slotEnd: now, expiresAt: now, idempotencyKey: 'idem-1',
    }), /unique violation/);
    assert.equal(findCalls, 1); // one query-first read, no post-abort re-query
  });
});

describe('PrismaCrmBookingProposalRepository.withAskLock', () => {
  it('takes the :bookask: advisory lock inside a $transaction before running fn; passes the tx into fn; result propagates', async () => {
    const order: string[] = [];
    const rawCalls: any[][] = [];
    let txOptions: any;
    let receivedTx: any;
    const tx = { $queryRaw: async (...args: any[]) => { rawCalls.push(args); order.push('lock'); return []; } };
    const repo = new PrismaCrmBookingProposalRepository({
      client: { $transaction: async (fn: any, options: any) => { txOptions = options; return fn(tx); } },
    } as any);

    const result = await repo.withAskLock('co-1', 'conv-1', async (t) => { receivedTx = t; order.push('fn'); return 'ok'; });

    assert.deepEqual(order, ['lock', 'fn']); // lock BEFORE fn
    assert.equal(receivedTx, tx); // fn receives the lock tx so the confirm path can claim ON it
    assert.match(rawCalls[0][0].join('?'), /pg_advisory_xact_lock\(hashtext/);
    assert.match(rawCalls[0][0].join('?'), /:bookask:/);
    assert.deepEqual(rawCalls[0].slice(1), ['co-1', 'conv-1']);
    // Timeout raised to 120s: a section can hold a LINE push + the send helper's inner 35s tx.
    assert.deepEqual(txOptions, { maxWait: 15_000, timeout: 120_000 });
    assert.equal(result, 'ok');
  });

  it('propagates a throw from fn', async () => {
    const repo = new PrismaCrmBookingProposalRepository({
      client: { $transaction: async (fn: any) => fn({ $queryRaw: async () => [] }) },
    } as any);
    await assert.rejects(repo.withAskLock('co-1', 'conv-1', async () => { throw new Error('boom'); }), /boom/);
  });
});

describe('PrismaCrmBookingProposalRepository.finalizeBookedWithinTx', () => {
  it('sets BOOKED+bookingId on the COMMITTING row and passes when exactly one row updates', async () => {
    let sql: any;
    const tx = { $executeRaw: async (strings: any, ...values: any[]) => { sql = { strings, values }; return 1; } };
    const repo = new PrismaCrmBookingProposalRepository({} as any);

    await repo.finalizeBookedWithinTx(tx, 'co-1', 'prop-1', 'bk-9');

    assert.deepEqual(sql.values, ['bk-9', 'prop-1', 'co-1']);
    assert.match(sql.strings.join('?'), /UPDATE "CrmBookingProposal"/);
    assert.match(sql.strings.join('?'), /"status" = 'BOOKED'/);
    assert.match(sql.strings.join('?'), /"status" = 'COMMITTING'/);
  });

  it('throws when the COMMITTING row is gone (a lost confirm race) so the booking rolls back', async () => {
    const tx = { $executeRaw: async () => 0 };
    const repo = new PrismaCrmBookingProposalRepository({} as any);
    await assert.rejects(repo.finalizeBookedWithinTx(tx, 'co-1', 'prop-1', 'bk-9'), /booking_proposal_finalize_lost_race/);
  });
});

describe('PrismaCrmBookingProposalRepository.expireStale', () => {
  it('moves only pre-confirmation, past-expiry proposals to EXPIRED and returns the count', async () => {
    const updateMany = mock.fn(async () => ({ count: 3 }));
    const repo = new PrismaCrmBookingProposalRepository({ client: { crmBookingProposal: { updateMany } } } as any);

    const expired = await repo.expireStale('co-1', now);

    const args = (updateMany.mock.calls as any[])[0].arguments[0];
    assert.equal(args.where.companyId, 'co-1');
    assert.deepEqual(args.where.status, { in: ['PROPOSED', 'AWAITING_CONFIRMATION'] });
    assert.deepEqual(args.where.expiresAt, { lte: now });
    assert.deepEqual(args.data, { status: 'EXPIRED' });
    assert.equal(expired, 3);
  });
});

describe('PrismaCrmBookingProposalRepository.sweepStuckCommitting', () => {
  it('recovers both stale CONFIRMED and COMMITTING rows older than the threshold to HANDED_TO_STAFF', async () => {
    // F1: a crash between the two commit CAS hops strands CONFIRMED forever (no EXPIRED
    // edge); the `updatedAt < olderThan` guard leaves a fresh CONFIRMED (still being
    // processed) untouched, so both stale states recover together.
    const updateMany = mock.fn(async () => ({ count: 4 }));
    const repo = new PrismaCrmBookingProposalRepository({ client: { crmBookingProposal: { updateMany } } } as any);
    const olderThan = new Date('2026-07-11T23:50:00.000Z');

    const recovered = await repo.sweepStuckCommitting('co-1', olderThan);

    const args = (updateMany.mock.calls as any[])[0].arguments[0];
    assert.equal(args.where.companyId, 'co-1');
    assert.deepEqual(args.where.status, { in: ['CONFIRMED', 'COMMITTING'] });
    assert.deepEqual(args.where.updatedAt, { lt: olderThan });
    assert.deepEqual(args.data, { status: 'HANDED_TO_STAFF' });
    assert.equal(recovered, 4);
  });
});

describe('PrismaCrmBookingProposalRepository.findCompanyIdsWithSweepableProposals', () => {
  it('returns distinct companyIds with an expirable-past or stuck-finalizing (CONFIRMED/COMMITTING) proposal', async () => {
    const findMany = mock.fn(async () => [{ companyId: 'co-1' }, { companyId: 'co-2' }]);
    const repo = new PrismaCrmBookingProposalRepository({ client: { crmBookingProposal: { findMany } } } as any);
    const finalizingBefore = new Date('2026-07-11T23:50:00.000Z');

    const ids = await repo.findCompanyIdsWithSweepableProposals(now, finalizingBefore);

    const args = (findMany.mock.calls as any[])[0].arguments[0];
    assert.deepEqual(args.distinct, ['companyId']);
    assert.deepEqual(args.select, { companyId: true });
    assert.deepEqual(args.where.OR[0], { status: { in: ['PROPOSED', 'AWAITING_CONFIRMATION'] }, expiresAt: { lte: now } });
    assert.deepEqual(args.where.OR[1], { status: { in: ['CONFIRMED', 'COMMITTING'] }, updatedAt: { lt: finalizingBefore } });
    assert.deepEqual(ids, ['co-1', 'co-2']);
  });
});

describe('PrismaCrmBookingProposalRepository.recordQuestionSent + findLatestQuestionSentAt', () => {
  it('stamps questionSentAt = NOW() (DB clock) by id+company via executeRaw, no status change', async () => {
    let sql: any;
    const executeRaw = mock.fn(async (strings: any, ...values: any[]) => { sql = { strings, values }; return 1; });
    const repo = new PrismaCrmBookingProposalRepository({ client: { $executeRaw: executeRaw } } as any);

    await repo.recordQuestionSent('co-1', 'prop-1');

    assert.deepEqual(sql.values, ['prop-1', 'co-1']);
    assert.match(sql.strings.join('?'), /"questionSentAt" = NOW\(\)/);
    assert.match(sql.strings.join('?'), /"id" =/);
    assert.match(sql.strings.join('?'), /"companyId" =/);
  });

  it('returns the newest delivered-question timestamp among OTHER proposals, or null', async () => {
    const at = new Date('2026-07-12T02:00:00.000Z');
    const findFirst = mock.fn(async () => ({ questionSentAt: at }));
    const repo = new PrismaCrmBookingProposalRepository({ client: { crmBookingProposal: { findFirst } } } as any);

    const latest = await repo.findLatestQuestionSentAt('co-1', 'conv-1', 'prop-active');

    const args = (findFirst.mock.calls as any[])[0].arguments[0];
    assert.deepEqual(args.where, { companyId: 'co-1', conversationId: 'conv-1', id: { not: 'prop-active' }, questionSentAt: { not: null } });
    assert.deepEqual(args.orderBy, { questionSentAt: 'desc' });
    assert.deepEqual(args.select, { questionSentAt: true });
    assert.equal(latest, at);

    const empty = new PrismaCrmBookingProposalRepository({ client: { crmBookingProposal: { findFirst: async () => null } } } as any);
    assert.equal(await empty.findLatestQuestionSentAt('co-1', 'conv-1', 'prop-active'), null);
  });

  it('reads the provenance on a passed client (the ask-lock tx) instead of the outer client when provided', async () => {
    const at = new Date('2026-07-12T02:00:00.000Z');
    const outer = mock.fn(async () => ({ questionSentAt: new Date('2000-01-01T00:00:00.000Z') }));
    const txFindFirst = mock.fn(async () => ({ questionSentAt: at }));
    const repo = new PrismaCrmBookingProposalRepository({ client: { crmBookingProposal: { findFirst: outer } } } as any);
    const tx = { crmBookingProposal: { findFirst: txFindFirst } };

    const latest = await repo.findLatestQuestionSentAt('co-1', 'conv-1', 'prop-active', tx as any);

    assert.equal(latest, at); // read from the tx so it is atomic with the CONFIRMED claim
    assert.equal(txFindFirst.mock.calls.length, 1);
    assert.equal(outer.mock.calls.length, 0);
  });
});

describe('PrismaCrmBookingProposalRepository.restoreQuestionSentAt', () => {
  it('sets an explicit questionSentAt (including null) by id+company, no status change', async () => {
    const updateMany = mock.fn(async () => ({ count: 1 }));
    const repo = new PrismaCrmBookingProposalRepository({ client: { crmBookingProposal: { updateMany } } } as any);
    const at = new Date('2026-07-12T02:00:00.000Z');

    await repo.restoreQuestionSentAt('co-1', 'prop-1', at);
    const first = (updateMany.mock.calls as any[])[0].arguments[0];
    assert.deepEqual(first.where, { id: 'prop-1', companyId: 'co-1' });
    assert.deepEqual(first.data, { questionSentAt: at });

    // The revert of an undelivered re-ask restores a never-asked row to null just as faithfully.
    await repo.restoreQuestionSentAt('co-1', 'prop-1', null);
    const second = (updateMany.mock.calls as any[])[1].arguments[0];
    assert.deepEqual(second.data, { questionSentAt: null });
  });
});

describe('PrismaCrmBookingProposalRepository.assertAskLockAlive', () => {
  it('runs a trivial query on the PASSED tx (throws to the caller when the holder tx is dead)', async () => {
    const queryRaw = mock.fn(async () => [{ '?column?': 1 }]);
    const repo = new PrismaCrmBookingProposalRepository({} as any);

    await repo.assertAskLockAlive({ $queryRaw: queryRaw } as any);
    assert.equal(queryRaw.mock.calls.length, 1);

    const dead = { $queryRaw: async () => { throw new Error('server closed the connection unexpectedly'); } };
    await assert.rejects(repo.assertAskLockAlive(dead as any), /server closed the connection/);
  });
});
