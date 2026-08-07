import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';

import { GenerateIdentityReconciliationUseCase } from './generate-identity-reconciliation.use-case';
import { ResolveIdentityReconciliationUseCase } from './resolve-identity-reconciliation.use-case';

type Row = Record<string, any>;

/**
 * A hand-rolled Prisma double. Deliberately records every write: the property that matters most
 * about the generator is not what it returns, it is what it does NOT write.
 */
function makePrisma(seed: {
  company?: Row;
  profile?: Row | null;
  branches?: Row[];
  liveFacts?: number;
  items?: Row[];
  revisions?: Row[];
}) {
  const state = {
    company: seed.company ?? { id: 'co-1', taxId: null, vatRegistered: false, registeredName: 'บริษัท ก', addressJson: null, legalIdentityVersion: 3 },
    profile: seed.profile === undefined ? { companyId: 'co-1', taxId: null, vatRegistered: false, vatEffectiveDate: null } : seed.profile,
    branches: seed.branches ?? [],
    items: seed.items ?? [],
    revisions: seed.revisions ?? [],
    vatFacts: [] as Row[],
    vatState: { companyId: 'co-1', version: 0 } as Row | null,
    vatCommands: [] as Row[],
  };
  const writes: string[] = [];

  const itemDelegate = {
    findMany: async ({ where }: any) =>
      state.items.filter((item) => (!where?.status || item.status === where.status) && (!where?.companyId || item.companyId === where.companyId)),
    findUnique: async ({ where }: any) => state.items.find((item) => item.id === where.id) ?? null,
    findUniqueOrThrow: async ({ where }: any) => {
      const found = state.items.find((item) => item.id === where.id);
      if (!found) throw new Error('item not found');
      return found;
    },
    create: async ({ data }: any) => {
      writes.push('item.create');
      const row = { id: `item-${state.items.length + 1}`, status: 'PENDING', ...data };
      state.items.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      writes.push('item.update');
      const row = state.items.find((item) => item.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
    groupBy: async () => [],
  };

  const tx: any = {
    $executeRaw: async () => 1,
    companyIdentityReconciliationItem: itemDelegate,
    company: {
      findUnique: async () => state.company,
      findUniqueOrThrow: async () => state.company,
      update: async ({ data }: any) => {
        writes.push('company.update');
        Object.assign(state.company, data);
        return state.company;
      },
    },
    companyTaxProfile: {
      findUnique: async () => state.profile,
      upsert: async ({ create, update }: any) => {
        writes.push('profile.upsert');
        state.profile = { ...(state.profile ?? create), ...update };
        return state.profile;
      },
    },
    branch: {
      findMany: async () => state.branches,
      findFirst: async ({ where }: any) => state.branches.find((b) => b.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        writes.push('branch.update');
        const row = state.branches.find((b) => b.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      count: async ({ where }: any) =>
        state.branches.filter(
          (b) =>
            b.status === 'ACTIVE' &&
            (where.taxBranchCode ? b.taxBranchCode === where.taxBranchCode : true) &&
            (where.type ? b.type === where.type : true),
        ).length,
    },
    companyVatRegistrationFact: {
      count: async () => seed.liveFacts ?? 0,
      create: async ({ data }: any) => {
        writes.push('fact.create');
        const row = { id: `fact-${state.vatFacts.length + 1}`, ...data };
        state.vatFacts.push(row);
        return row;
      },
    },
    companyVatRegistrationState: {
      findUnique: async () => state.vatState,
      upsert: async ({ update }: any) => {
        writes.push('vatState.upsert');
        state.vatState = { ...state.vatState, ...update } as Row;
        return state.vatState;
      },
    },
    companyVatRegistrationCommand: {
      create: async ({ data }: any) => {
        writes.push('vatCommand.create');
        state.vatCommands.push(data);
        return data;
      },
    },
    companyLegalIdentityRevision: {
      findFirst: async ({ where }: any) =>
        state.revisions.find((r) => r.companyId === where.companyId && r.repairCommandId === where.repairCommandId) ?? null,
      findMany: async () => state.revisions,
      create: async ({ data }: any) => {
        writes.push('revision.create');
        state.revisions.push(data);
        return data;
      },
    },
  };

  const client: any = { ...tx, $transaction: async (fn: (t: any) => Promise<any>) => fn(tx) };
  return { prisma: { client } as any, state, writes };
}

const audit = { log: async () => undefined } as any;
const ctx = { userId: 'u-1', requestId: 'req-1', companyId: 'co-1' } as any;

describe('GenerateIdentityReconciliationUseCase', () => {
  // The invariant the whole reconciliation design rests on: finding drift never fixes it.
  it('writes items and nothing else', async () => {
    const { prisma, writes } = makePrisma({
      company: { id: 'co-1', taxId: '0105556000001', vatRegistered: false },
      profile: { taxId: null, vatRegistered: false, vatEffectiveDate: null },
    });
    const result = await new GenerateIdentityReconciliationUseCase(prisma).execute('co-1');

    assert.equal(result.created, 1);
    assert.equal(result.pending, 1);
    assert.deepEqual(writes, ['item.create']);
  });

  it('is re-runnable: a second pass over unchanged data creates nothing', async () => {
    const { prisma, writes } = makePrisma({
      company: { id: 'co-1', taxId: '0105556000001', vatRegistered: false },
      profile: { taxId: null, vatRegistered: false, vatEffectiveDate: null },
    });
    const useCase = new GenerateIdentityReconciliationUseCase(prisma);
    await useCase.execute('co-1');
    writes.length = 0;
    const second = await useCase.execute('co-1');

    assert.equal(second.created, 0);
    assert.equal(second.updated, 0);
    assert.deepEqual(writes, []);
  });

  // Reaching "pending = 0" is the precondition for the Release B1 constraints, so drift fixed
  // outside the resolver has to be able to close its own item.
  it('closes an item whose drift has disappeared', async () => {
    const { prisma, state } = makePrisma({
      company: { id: 'co-1', taxId: '0105556000001', vatRegistered: false },
      profile: { taxId: '0105556000001', vatRegistered: false, vatEffectiveDate: null },
      items: [{ id: 'item-1', companyId: 'co-1', kind: 'TAX_ID', discriminator: 'TAX_ID', status: 'PENDING', sourceFingerprint: 'old' }],
    });
    const result = await new GenerateIdentityReconciliationUseCase(prisma).execute('co-1');

    assert.equal(result.closed, 1);
    assert.equal(state.items[0].status, 'RESOLVED');
    assert.equal(state.items[0].sourceState, 'ALIGNED');
  });

  // Reopening a resolved row would overwrite the record of a decision a human made.
  it('opens a NEW item when drift returns after a resolve', async () => {
    const { prisma, state } = makePrisma({
      company: { id: 'co-1', taxId: '0105556000002', vatRegistered: false },
      profile: { taxId: null, vatRegistered: false, vatEffectiveDate: null },
      items: [{ id: 'item-1', companyId: 'co-1', kind: 'TAX_ID', discriminator: 'TAX_ID', status: 'RESOLVED', sourceFingerprint: 'old' }],
    });
    const result = await new GenerateIdentityReconciliationUseCase(prisma).execute('co-1');

    assert.equal(result.created, 1);
    assert.equal(state.items.length, 2);
    assert.equal(state.items[0].status, 'RESOLVED');
  });
});

describe('ResolveIdentityReconciliationUseCase — tax id', () => {
  function taxIdFixture(itemOverrides: Row = {}) {
    return makePrisma({
      company: { id: 'co-1', taxId: '0105556000001', registeredName: 'บริษัท ก', addressJson: null, legalIdentityVersion: 3, vatRegistered: false },
      profile: { companyId: 'co-1', taxId: '0994000165676', vatRegistered: false, vatEffectiveDate: null },
      items: [
        {
          id: 'item-1',
          companyId: 'co-1',
          kind: 'TAX_ID',
          discriminator: 'TAX_ID',
          status: 'PENDING',
          sourceFingerprint: 'fp-1',
          resolutionCommandId: null,
          ...itemOverrides,
        },
      ],
    });
  }

  const baseCommand = {
    commandId: 'cmd-1',
    expectedSourceFingerprint: 'fp-1',
    chosen: 'COMPANY' as const,
    resolutionKind: 'DATA_RECONCILIATION' as const,
    note: 'พิมพ์ผิดในโปรไฟล์เก่า',
  };

  it('writes the winner to both sides and closes the item', async () => {
    const { prisma, state } = taxIdFixture();
    const result = await new ResolveIdentityReconciliationUseCase(prisma, audit).resolveTaxId(ctx, 'item-1', baseCommand);

    assert.deepEqual(result, { itemId: 'item-1', status: 'RESOLVED', replayed: false });
    assert.equal(state.company.taxId, '0105556000001');
    assert.equal(state.profile!.taxId, '0105556000001');
    assert.equal(state.items[0].status, 'RESOLVED');
    assert.equal(state.company.legalIdentityVersion, 4);
  });

  // The distinction the whole resolver exists for: the number never changed in law, only the
  // record of it, so fencing every earlier document behind a typo fix would be wrong.
  it('does not move the legal fence date for a data reconciliation', async () => {
    const { prisma, state } = taxIdFixture();
    await new ResolveIdentityReconciliationUseCase(prisma, audit).resolveTaxId(ctx, 'item-1', baseCommand);

    assert.equal(state.company.lastLegalChangeEffectiveDate, undefined);
    assert.equal(state.revisions[0].changeKind, 'RECONCILIATION_CORRECTION');
    assert.equal(state.revisions[0].effectiveFrom, null);
    assert.equal(state.revisions[0].reconciliationItemId, 'item-1');
  });

  it('moves the fence date for a legal change and records the date', async () => {
    const { prisma, state } = taxIdFixture();
    await new ResolveIdentityReconciliationUseCase(prisma, audit).resolveTaxId(ctx, 'item-1', {
      ...baseCommand,
      resolutionKind: 'LEGAL_CHANGE',
      effectiveFrom: '2026-06-01',
    });

    assert.equal(state.revisions[0].changeKind, 'LEGAL_CHANGE');
    assert.equal((state.company.lastLegalChangeEffectiveDate as Date).toISOString(), '2026-06-01T00:00:00.000Z');
  });

  it('replays the original answer for the same command id', async () => {
    const { prisma, writes } = taxIdFixture({ status: 'RESOLVED', resolutionCommandId: 'cmd-1' });
    const result = await new ResolveIdentityReconciliationUseCase(prisma, audit).resolveTaxId(ctx, 'item-1', baseCommand);

    assert.deepEqual(result, { itemId: 'item-1', status: 'RESOLVED', replayed: true });
    assert.deepEqual(writes, []);
  });

  it('conflicts on a different command id against an already resolved item', async () => {
    const { prisma } = taxIdFixture({ status: 'RESOLVED', resolutionCommandId: 'cmd-other' });
    await assert.rejects(
      () => new ResolveIdentityReconciliationUseCase(prisma, audit).resolveTaxId(ctx, 'item-1', baseCommand),
      ConflictException,
    );
  });

  // Applying a decision to data that has moved since it was made is how a resolver silently
  // overwrites somebody else's fix.
  it('refuses a stale source fingerprint', async () => {
    const { prisma, writes } = taxIdFixture();
    await assert.rejects(
      () =>
        new ResolveIdentityReconciliationUseCase(prisma, audit).resolveTaxId(ctx, 'item-1', {
          ...baseCommand,
          expectedSourceFingerprint: 'fp-stale',
        }),
      ConflictException,
    );
    assert.deepEqual(writes, []);
  });
});

describe('ResolveIdentityReconciliationUseCase — repair-tax-id', () => {
  function repairFixture(revisions: Row[] = []) {
    return makePrisma({
      company: { id: 'co-1', taxId: '0105556000009', registeredName: 'บริษัท ก', addressJson: null, legalIdentityVersion: 7, vatRegistered: false },
      revisions,
    });
  }

  it('appends a reconciliation correction without a fence', async () => {
    const { prisma, state } = repairFixture();
    const result = await new ResolveIdentityReconciliationUseCase(prisma, audit).repairTaxId(ctx, 'co-1', {
      commandId: 'repair-1',
      manualValue: '0105556000001',
      note: 'สลับเลขสองตัวตอนกรอก',
      expectedLegalIdentityVersion: 7,
    });

    assert.deepEqual(result, { legalIdentityVersion: 8, replayed: false });
    assert.equal(state.company.taxId, '0105556000001');
    assert.equal(state.company.lastLegalChangeEffectiveDate, undefined);
    assert.equal(state.revisions[0].changeKind, 'RECONCILIATION_CORRECTION');
    assert.equal(state.revisions[0].repairCommandId, 'repair-1');
  });

  it('replays by command id without appending a second revision', async () => {
    const { prisma, state } = repairFixture([{ companyId: 'co-1', repairCommandId: 'repair-1', legalIdentityVersion: 8 }]);
    const result = await new ResolveIdentityReconciliationUseCase(prisma, audit).repairTaxId(ctx, 'co-1', {
      commandId: 'repair-1',
      manualValue: '0105556000001',
      note: 'retry',
      expectedLegalIdentityVersion: 7,
    });

    assert.deepEqual(result, { legalIdentityVersion: 8, replayed: true });
    assert.equal(state.revisions.length, 1);
  });

  it('refuses a stale identity version', async () => {
    const { prisma } = repairFixture();
    await assert.rejects(
      () =>
        new ResolveIdentityReconciliationUseCase(prisma, audit).repairTaxId(ctx, 'co-1', {
          commandId: 'repair-2',
          manualValue: '0105556000001',
          note: 'n',
          expectedLegalIdentityVersion: 6,
        }),
      ConflictException,
    );
  });
});

describe('ResolveIdentityReconciliationUseCase — vat hint', () => {
  function hintFixture() {
    return makePrisma({
      company: { id: 'co-1', taxId: '0105556000001', vatRegistered: false, registeredName: 'บริษัท ก', addressJson: null, legalIdentityVersion: 1 },
      items: [
        {
          id: 'item-1',
          companyId: 'co-1',
          kind: 'VAT_HINT',
          discriminator: 'VAT_HINT',
          status: 'PENDING',
          sourceFingerprint: 'fp-1',
          resolutionCommandId: null,
        },
      ],
    });
  }

  it('confirming creates a dated fact, bumps the state and updates the mirror', async () => {
    const { prisma, state } = hintFixture();
    await new ResolveIdentityReconciliationUseCase(prisma, audit).resolveVatHint(ctx, 'item-1', {
      commandId: 'cmd-1',
      expectedSourceFingerprint: 'fp-1',
      action: 'CONFIRM_FACT',
      effectiveFrom: '2020-01-15',
    });

    assert.equal(state.vatFacts.length, 1);
    assert.equal(state.vatFacts[0].source, 'RECONCILIATION');
    assert.equal((state.vatFacts[0].effectiveFrom as Date).toISOString(), '2020-01-15T00:00:00.000Z');
    assert.equal(state.vatState!.version, 1);
    assert.equal(state.company.vatRegistered, true);
  });

  // Recording NOT_REGISTERED here would invent the very answer the hint failed to supply.
  it('dismissing writes no fact and leaves the status unknown', async () => {
    const { prisma, state, writes } = hintFixture();
    await new ResolveIdentityReconciliationUseCase(prisma, audit).resolveVatHint(ctx, 'item-1', {
      commandId: 'cmd-1',
      expectedSourceFingerprint: 'fp-1',
      action: 'DISMISS_UNKNOWN',
    });

    assert.equal(state.vatFacts.length, 0);
    assert.equal(state.company.vatRegistered, false);
    assert.deepEqual(writes, ['item.update']);
  });
});
