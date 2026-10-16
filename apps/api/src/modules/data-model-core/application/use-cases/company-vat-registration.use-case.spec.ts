import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

import { CompanyVatRegistrationUseCase } from './company-vat-registration.use-case';

type Row = Record<string, any>;

function makePrisma(seed: { facts?: Row[]; version?: number; commands?: Row[]; periods?: Row[] } = {}) {
  const state = {
    company: { id: 'co-1', timezone: 'Asia/Bangkok', vatRegistered: false } as Row,
    facts: seed.facts ?? [],
    vatState: { companyId: 'co-1', version: seed.version ?? 0 } as Row | null,
    commands: seed.commands ?? [],
    periods: seed.periods ?? [],
  };
  const writes: string[] = [];
  let nextFactId = state.facts.length + 1;

  const tx: any = {
    expenseRecord: { findMany: async () => [] },
    $executeRaw: async () => 1,
    company: {
      findUnique: async () => state.company,
      update: async ({ data }: any) => {
        writes.push('company.update');
        Object.assign(state.company, data);
        return state.company;
      },
    },
    companyVatRegistrationState: {
      findUnique: async () => state.vatState,
      upsert: async ({ create, update }: any) => {
        writes.push('state.upsert');
        state.vatState = { ...(state.vatState ?? create), ...update };
        return state.vatState;
      },
    },
    companyVatRegistrationCommand: {
      findFirst: async ({ where }: any) => state.commands.find((c) => c.commandId === where.commandId) ?? null,
      create: async ({ data }: any) => {
        writes.push('command.create');
        state.commands.push(data);
        return data;
      },
    },
    companyVatRegistrationFact: {
      findMany: async () => state.facts,
      create: async ({ data }: any) => {
        writes.push('fact.create');
        const row = { id: `fact-${nextFactId++}`, supersededAt: null, effectiveTo: null, ...data };
        state.facts.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        writes.push('fact.update');
        const row = state.facts.find((f) => f.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    taxPeriod: { findMany: async () => state.periods },
  };

  const client: any = { ...tx, $transaction: async (fn: (t: any) => Promise<any>) => fn(tx) };
  return { prisma: { client } as any, state, writes };
}

const audit = { log: async () => undefined } as any;
const ctx = { userId: 'u-1', requestId: 'req-1', companyId: 'co-1', permissions: [] } as any;

function fact(id: string, from: string, overrides: Row = {}): Row {
  return { id, status: 'REGISTERED', effectiveFrom: new Date(`${from}T00:00:00Z`), effectiveTo: null, supersededAt: null, ...overrides };
}

const UPSERT = {
  commandId: 'cmd-1',
  expectedVersion: 0,
  command: { kind: 'UPSERT_FACT' as const, status: 'REGISTERED' as const, effectiveFrom: '2020-01-15' },
};

describe('CompanyVatRegistrationUseCase.get', () => {
  it('answers UNKNOWN with no facts and the stored version', async () => {
    const { prisma } = makePrisma({ version: 3 });
    const view = await new CompanyVatRegistrationUseCase(prisma, audit).get('co-1');

    assert.equal(view.status, 'UNKNOWN');
    assert.equal(view.version, 3);
    assert.equal(view.vatRegistered, false);
    assert.equal(view.vatEffectiveDate, null);
  });

  it('answers as of a past date when asked', async () => {
    const { prisma } = makePrisma({ facts: [fact('f1', '2026-01-01')] });
    const useCase = new CompanyVatRegistrationUseCase(prisma, audit);

    assert.equal((await useCase.get('co-1', '2025-12-31')).status, 'UNKNOWN');
    assert.equal((await useCase.get('co-1', '2026-01-01')).status, 'REGISTERED');
  });

  it('rejects a malformed asOf', async () => {
    const { prisma } = makePrisma({});
    await assert.rejects(() => new CompanyVatRegistrationUseCase(prisma, audit).get('co-1', '2026-1-1'), UnprocessableEntityException);
  });
});

describe('CompanyVatRegistrationUseCase.put', () => {
  it('creates the first fact, bumps the version and records the command', async () => {
    const { prisma, state } = makePrisma({});
    const result = await new CompanyVatRegistrationUseCase(prisma, audit).put(ctx, 'co-1', UPSERT);

    assert.deepEqual(result, { version: 1, resultKind: 'UPSERT_FACT', replayed: false });
    assert.equal(state.facts.length, 1);
    assert.equal(state.facts[0].source, 'USER_ANSWER');
    assert.equal(state.vatState!.version, 1);
    assert.equal(state.commands[0].resultFactId, 'fact-1');
  });

  // Lookup happens BEFORE the version check: a caller whose response was lost retries with the
  // same commandId and must get the original answer, not a conflict against its own work.
  it('replays the original answer before checking the version', async () => {
    const { prisma, writes } = makePrisma({ version: 5 });
    const useCase = new CompanyVatRegistrationUseCase(prisma, audit);
    await useCase.put(ctx, 'co-1', { ...UPSERT, expectedVersion: 5 });
    writes.length = 0;

    const replay = await useCase.put(ctx, 'co-1', { ...UPSERT, expectedVersion: 5 });
    assert.deepEqual(replay, { version: 6, resultKind: 'UPSERT_FACT', replayed: true });
    assert.deepEqual(writes, []);
  });

  // Otherwise the same commandId could carry a different payload and replay an answer nobody
  // gave — which is precisely why the fingerprint is computed here and never accepted.
  it('conflicts when the same command id carries a different payload', async () => {
    const { prisma } = makePrisma({});
    const useCase = new CompanyVatRegistrationUseCase(prisma, audit);
    await useCase.put(ctx, 'co-1', UPSERT);

    await assert.rejects(
      () =>
        useCase.put(ctx, 'co-1', {
          ...UPSERT,
          expectedVersion: 1,
          command: { kind: 'UPSERT_FACT', status: 'NOT_REGISTERED', effectiveFrom: '2020-01-15' },
        }),
      ConflictException,
    );
  });

  it('refuses a stale expectedVersion', async () => {
    const { prisma, writes } = makePrisma({ version: 4 });
    await assert.rejects(
      () => new CompanyVatRegistrationUseCase(prisma, audit).put(ctx, 'co-1', { ...UPSERT, expectedVersion: 1 }),
      ConflictException,
    );
    assert.deepEqual(writes, []);
  });

  it('closes the open interval when a later fact starts', async () => {
    const { prisma, state } = makePrisma({ facts: [fact('f1', '2020-01-15')], version: 1 });
    await new CompanyVatRegistrationUseCase(prisma, audit).put(ctx, 'co-1', {
      commandId: 'cmd-2',
      expectedVersion: 1,
      command: { kind: 'UPSERT_FACT', status: 'NOT_REGISTERED', effectiveFrom: '2026-08-01' },
    });

    assert.equal((state.facts[0].effectiveTo as Date).toISOString(), '2026-08-01T00:00:00.000Z');
    assert.equal(state.facts[1].status, 'NOT_REGISTERED');
  });

  // Superseding the future fact alone would leave the earlier interval ending at a date that no
  // longer means anything, so the accessor would answer UNKNOWN from that day on.
  it('cancelling a future fact restores the previous one to open-ended', async (t) => {
    // "Future" is measured from the company's today, which the use case reads from the clock.
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-15T05:00:00.000Z') });
    const { prisma, state } = makePrisma({
      facts: [
        fact('f1', '2020-01-15', { effectiveTo: new Date('2027-01-01T00:00:00Z') }),
        fact('f2', '2027-01-01', { status: 'NOT_REGISTERED' }),
      ],
      version: 2,
    });
    await new CompanyVatRegistrationUseCase(prisma, audit).put(ctx, 'co-1', {
      commandId: 'cmd-3',
      expectedVersion: 2,
      command: { kind: 'CANCEL_FUTURE', replaceFactId: 'f2' },
    });

    assert.equal(state.facts[0].effectiveTo, null);
    assert.ok(state.facts[1].supersededAt instanceof Date);
    assert.equal(state.company.vatRegistered, true);
  });

  it('surfaces the interval rules as coded 422s', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-15T05:00:00.000Z') }); // f2 is still a future fact
    const { prisma } = makePrisma({
      facts: [fact('f1', '2020-01-15'), fact('f2', '2027-01-01', { status: 'NOT_REGISTERED' })],
      version: 2,
    });
    await assert.rejects(
      () =>
        new CompanyVatRegistrationUseCase(prisma, audit).put(ctx, 'co-1', {
          commandId: 'cmd-4',
          expectedVersion: 2,
          command: { kind: 'UPSERT_FACT', status: 'NOT_REGISTERED', effectiveFrom: '2027-06-01' },
        }),
      (error: any) => {
        assert.equal(error.getResponse().code, 'vat_registration_future_fact_conflict');
        return true;
      },
    );
  });

  it('blocks a backdated change that would rewrite a filed period', async () => {
    const { prisma } = makePrisma({
      facts: [fact('f1', '2020-01-15')],
      version: 1,
      periods: [{ periodKey: '2026-01', status: 'FILED' }],
    });
    await assert.rejects(
      () =>
        new CompanyVatRegistrationUseCase(prisma, audit).put(ctx, 'co-1', {
          commandId: 'cmd-5',
          expectedVersion: 1,
          command: { kind: 'UPSERT_FACT', status: 'NOT_REGISTERED', effectiveFrom: '2026-01-10' },
        }),
      (error: any) => {
        assert.equal(error.getResponse().code, 'vat_registration_backdated_crosses_filed_period');
        return true;
      },
    );
  });

  // AMENDED is not locked by the tax module's own helper, and this reads that helper rather
  // than keeping a second copy of the list.
  it('allows the same backdated change when the period is only AMENDED', async () => {
    const { prisma, state } = makePrisma({
      facts: [fact('f1', '2020-01-15')],
      version: 1,
      periods: [{ periodKey: '2026-01', status: 'AMENDED' }],
    });
    await new CompanyVatRegistrationUseCase(prisma, audit).put(ctx, 'co-1', {
      commandId: 'cmd-6',
      expectedVersion: 1,
      command: { kind: 'UPSERT_FACT', status: 'NOT_REGISTERED', effectiveFrom: '2026-01-10' },
    });
    assert.equal(state.facts.length, 2);
  });

  it('records a no-op as a command without writing a fact', async () => {
    const { prisma, state, writes } = makePrisma({ facts: [fact('f1', '2020-01-15')], version: 1 });
    const result = await new CompanyVatRegistrationUseCase(prisma, audit).put(ctx, 'co-1', {
      commandId: 'cmd-7',
      expectedVersion: 1,
      command: { kind: 'UPSERT_FACT', status: 'REGISTERED', effectiveFrom: '2026-08-01' },
    });

    assert.equal(result.resultKind, 'NO_OP');
    assert.equal(state.facts.length, 1);
    assert.equal(writes.includes('fact.create'), false);
    assert.equal(state.vatState!.version, 2);
  });
});
