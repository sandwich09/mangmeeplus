// Pinned before any Date is built. The API container runs UTC, so the local-midnight fault below
// is invisible there — but a developer machine (and this host) is +07, and that is exactly the
// configuration the fix protects. Pinning makes the test discriminate on any host.
process.env.TZ = 'Asia/Bangkok';

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { ReverseJournalUseCase } from './journal.use-case';
import { EnsurePeriodUseCase } from './period.use-case';

const ctx = {
  requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1', membershipId: 'member-1',
  roles: ['ACCOUNTANT'], permissions: ['journal.entry.reverse'], scopes: {}, authProvider: 'watchdog',
} as any;

// In-memory journal store whose balance query mirrors
// PrismaLedgerRepository.getAccountBalances: POSTED entries only.
function ledgerStore() {
  const now = new Date('2026-07-18T00:00:00.000Z');
  let seq = 0;
  const entries: any[] = [];

  const addEntry = (input: any, status: string) => {
    const id = input.id ?? `journal-${++seq}`;
    const entry = {
      id, companyId: input.companyId, periodId: input.periodId ?? 'period-1',
      entryNumber: input.entryNumber ?? `JV-${seq}`, entryType: input.entryType,
      sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null,
      reversalOfJournalEntryId: input.reversalOfJournalEntryId ?? null,
      status, entryDate: input.entryDate ?? now, postedAt: status === 'POSTED' ? now : null,
      postedByUserId: null, memo: input.memo ?? null, createdByUserId: input.createdByUserId ?? 'user-1',
      createdAt: now, updatedAt: now,
      lines: (input.lines ?? []).map((l: any, idx: number) => ({
        id: `${id}-line-${idx + 1}`, companyId: input.companyId, journalEntryId: id,
        accountId: l.accountId, branchId: l.branchId ?? null, lineNumber: idx + 1,
        description: l.description ?? null, debitAmount: l.debitAmount ?? '0', creditAmount: l.creditAmount ?? '0',
        currency: l.currency ?? 'THB', sourceType: null, sourceId: null, taxCode: l.taxCode ?? null, createdAt: now,
      })),
    };
    entries.push(entry);
    return entry;
  };

  return {
    entries,
    seedPosted: (input: any) => addEntry(input, 'POSTED'),
    accountBalances() {
      const net = new Map<string, number>();
      for (const entry of entries) {
        if (entry.status !== 'POSTED') continue;
        for (const line of entry.lines) {
          net.set(line.accountId, (net.get(line.accountId) ?? 0) + parseFloat(line.debitAmount) - parseFloat(line.creditAmount));
        }
      }
      return net;
    },
    repo: {
      findJournalById: async (companyId: string, id: string) => entries.find((e) => e.id === id && e.companyId === companyId) ?? null,
      findPeriodById: async () => ({ id: 'period-1', companyId: 'company-1', periodKey: '2026-07', status: 'OPEN' }),
      getJournalLines: async (companyId: string, journalEntryId: string) =>
        entries.find((e) => e.id === journalEntryId && e.companyId === companyId)?.lines ?? [],
      findReversalOfJournal: async (companyId: string, journalEntryId: string) =>
        entries.find((e) => e.companyId === companyId && e.entryType === 'REVERSAL' && e.reversalOfJournalEntryId === journalEntryId) ?? null,
      createJournalEntry: async (input: any) => addEntry(input, 'DRAFT'),
      postJournalEntry: async (id: string) => {
        const entry = entries.find((e) => e.id === id);
        entry.status = 'POSTED';
        entry.postedAt = now;
        return entry;
      },
      // Implemented so a regression that reinstates the status flip corrupts
      // the balances (and fails the net-zero assertion) instead of crashing.
      markJournalReversed: async (id: string) => {
        const entry = entries.find((e) => e.id === id);
        if (entry) entry.status = 'REVERSED';
      },
    } as any,
  };
}

const audit = { log: async () => undefined } as any;
const reserve = { execute: async () => ({ id: 'reservation-1', documentNumber: 'JV-R-1' }) } as any;
const commit = { execute: async () => undefined } as any;
const outbox = { append: async () => undefined } as any;

describe('ReverseJournalUseCase net-zero regression', () => {
  it('nets every account to zero under POSTED-only report queries and keeps the original POSTED', async () => {
    const store = ledgerStore();
    const original = store.seedPosted({
      id: 'journal-original', companyId: 'company-1', entryType: 'GENERATED',
      sourceType: 'accounting.document', sourceId: 'doc-1',
      lines: [
        { accountId: 'cash', debitAmount: '250.00' },
        { accountId: 'revenue', creditAmount: '250.00' },
      ],
    });

    const useCase = new ReverseJournalUseCase(store.repo, audit, reserve, commit, outbox);
    const summary = await useCase.execute(ctx, original.id, 'void test');

    const balances = store.accountBalances();
    for (const [accountId, net] of balances) {
      assert.equal(net, 0, `account ${accountId} must net to zero after reversal, got ${net}`);
    }
    assert.equal(balances.size, 2);

    assert.equal(original.status, 'POSTED', 'original must stay POSTED so reports net it against the reversal');
    const reversal = store.entries.find((e) => e.id === summary.id);
    assert.equal(reversal.entryType, 'REVERSAL');
    assert.equal(reversal.status, 'POSTED');
    assert.equal(reversal.reversalOfJournalEntryId, original.id);
  });

  it('rejects a second reversal of the same journal without creating another entry', async () => {
    const store = ledgerStore();
    const original = store.seedPosted({
      id: 'journal-original', companyId: 'company-1', entryType: 'MANUAL',
      lines: [
        { accountId: 'cash', debitAmount: '100.00' },
        { accountId: 'revenue', creditAmount: '100.00' },
      ],
    });

    const useCase = new ReverseJournalUseCase(store.repo, audit, reserve, commit, outbox);
    await useCase.execute(ctx, original.id);
    assert.equal(store.entries.length, 2);

    await assert.rejects(() => useCase.execute(ctx, original.id), BadRequestException);
    assert.equal(store.entries.length, 2, 'a rejected re-reversal must not create another entry');
    for (const [accountId, net] of store.accountBalances()) {
      assert.equal(net, 0, `account ${accountId} must still net to zero, got ${net}`);
    }
  });
});

// §5.3 — a reversal used to stamp `entryDate: new Date()` into JournalEntry.entryDate, a
// @db.Date column. Postgres truncates a timestamp to a date in UTC, so a reversal posted
// between 00:00 and 07:00 Bangkok was dated YESTERDAY. Simulated rather than waited for:
// node:test mock timers move the clock to 02:00 Bangkok, which is 19:00 the previous day in UTC.
describe('ReverseJournalUseCase entry date', () => {
  it('dates a 02:00 Bangkok reversal today, as a pure date', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-05T19:00:00.000Z') });

    const store = ledgerStore();
    const original = store.seedPosted({
      id: 'journal-tz', companyId: 'company-1', entryType: 'GENERATED',
      lines: [{ accountId: 'cash', debitAmount: '10.00' }, { accountId: 'revenue', creditAmount: '10.00' }],
    });

    const useCase = new ReverseJournalUseCase(store.repo, audit, reserve, commit, outbox);
    const summary = await useCase.execute(ctx, original.id, 'tz test');
    const reversal = store.entries.find((e) => e.id === summary.id);

    // The old code produced 2026-08-05T19:00:00.000Z: previous day, and carrying a time.
    assert.equal(
      reversal.entryDate.toISOString(),
      '2026-08-06T00:00:00.000Z',
      'a reversal at 02:00 Bangkok belongs to that day, at midnight, not to the UTC day before',
    );
  });
});

// §5.4 — AccountingPeriod.startDate/endDate are @db.Date, and the bounds were built with
// `new Date(y, m - 1, 1)`, which is LOCAL midnight. On the UTC container that happens to equal
// UTC midnight, which is why this fault is invisible in production and needs the pinned TZ above.
describe('EnsurePeriodUseCase bounds', () => {
  it('builds period bounds at UTC midnight even when the host is not UTC', async () => {
    // Guard the premise: if this host were UTC the test could not tell the two apart.
    assert.notEqual(
      new Date(2026, 4, 1).toISOString(),
      '2026-05-01T00:00:00.000Z',
      'TZ pin failed — local and UTC midnight coincide, so this test proves nothing',
    );

    let captured: { start?: Date; end?: Date } = {};
    const repo = {
      upsertPeriod: async (companyId: string, periodKey: string, start: Date, end: Date) => {
        captured = { start, end };
        return { id: 'period-1', companyId, periodKey, startDate: start, endDate: end, status: 'OPEN', closedAt: null, closedByUserId: null };
      },
    } as any;

    await new EnsurePeriodUseCase(repo).execute(
      { ...ctx, permissions: ['ledger.period.read'] } as any,
      '2026-05',
    );

    // Old code on a +07 host: 2026-04-30T17:00:00.000Z — the period starts in the wrong month.
    assert.equal(captured.start?.toISOString(), '2026-05-01T00:00:00.000Z');
    assert.equal(captured.end?.toISOString(), '2026-05-31T00:00:00.000Z');
  });

  it('rejects a malformed or out-of-range month instead of rolling it into another period', async () => {
    const repo = { upsertPeriod: mock.fn(async () => ({})) } as any;
    const useCase = new EnsurePeriodUseCase(repo);

    for (const invalid of ['2026-00', '2026-13', '2026-1', 'not-a-period']) {
      await assert.rejects(
        () => useCase.execute({ ...ctx, permissions: ['ledger.period.read'] } as any, invalid),
        BadRequestException,
      );
    }
    assert.equal(repo.upsertPeriod.mock.callCount(), 0);
  });
});
