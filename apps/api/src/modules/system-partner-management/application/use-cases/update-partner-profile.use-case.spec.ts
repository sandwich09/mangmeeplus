import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { UpdatePartnerProfileUseCase } from './update-partner-profile.use-case';

function makeCmd(overrides: Record<string, unknown> = {}) {
  return {
    companyId: 'co-1',
    name: 'New Name',
    requestingAdminUserId: 'admin-1',
    requestId: 'req-1',
    ...overrides,
  };
}

function makePrisma(opts: { companyFound?: boolean; status?: string; termDisabledAt?: Date | null; customerId?: string | null } = {}) {
  const companyFound = opts.companyFound ?? true;
  const status = opts.status ?? 'ACTIVE';
  const termDisabledAt = opts.termDisabledAt ?? null;
  const customerId = opts.customerId === undefined ? 'cus_1' : opts.customerId;
  let updateCalled = false;
  const syncCalls: unknown[] = [];

  const tx = {
    company: { update: async () => { updateCalled = true; return {}; } },
    auditLog: { create: async () => ({}) },
    billingAccount: {
      findUnique: async () => (customerId ? { id: 'acct-1', companyId: 'co-1', stripeAccountId: 'acct_test', livemode: false, customerId, version: 3 } : null),
    },
    billingOperation: {
      create: async (args: unknown) => { syncCalls.push(args); return {}; },
    },
  };

  const prisma = {
    updateCalled: () => updateCalled,
    syncCalls: () => syncCalls,
    client: {
      company: {
        findUnique: async () =>
          companyFound
            ? { id: 'co-1', status, name: 'Old Name', brandName: null, timezone: 'Asia/Bangkok', locale: 'th-TH', phone: null, email: null,
                planTerm: { termDisabledAt } }
            : null,
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    },
  } as any;

  return prisma;
}

const getDetailStub = { execute: async (companyId: string) => ({ id: companyId }) } as any;
const configStub = { stripeAccountId: 'acct_test', billingMode: 'test' } as any;

describe('UpdatePartnerProfileUseCase', () => {
  it('throws NotFoundException when company not found', async () => {
    const prisma = makePrisma({ companyFound: false });
    const useCase = new UpdatePartnerProfileUseCase(prisma, getDetailStub, configStub);
    await assert.rejects(
      () => useCase.execute(makeCmd()),
      (err: unknown) => { assert.ok(err instanceof NotFoundException); return true; },
    );
  });

  for (const lockedStatus of ['DISABLED', 'ARCHIVED']) {
    it(`throws UnprocessableEntityException when company is ${lockedStatus} admin hold — profile is read-only`, async () => {
      const prisma = makePrisma({ status: lockedStatus });
      const useCase = new UpdatePartnerProfileUseCase(prisma, getDetailStub, configStub);
      await assert.rejects(
        () => useCase.execute(makeCmd()),
        (err: unknown) => {
          assert.ok(err instanceof UnprocessableEntityException);
          assert.ok((err as Error).message.includes('lifecycle'));
          return true;
        },
      );
      assert.equal(prisma.updateCalled(), false, 'No update when company is locked');
    });
  }

  it('ARCHIVED stays locked even with a term row (no admin-hold exception for ARCHIVED)', async () => {
    const prisma = makePrisma({ status: 'ARCHIVED', termDisabledAt: new Date() });
    const useCase = new UpdatePartnerProfileUseCase(prisma, getDetailStub, configStub);
    await assert.rejects(() => useCase.execute(makeCmd()), UnprocessableEntityException);
  });

  it('DISABLED by a run-out term (termDisabledAt set) can still edit — R-E3/RV26', async () => {
    const prisma = makePrisma({ status: 'DISABLED', termDisabledAt: new Date() });
    const useCase = new UpdatePartnerProfileUseCase(prisma, getDetailStub, configStub);
    const result = await useCase.execute(makeCmd());
    assert.equal(prisma.updateCalled(), true);
    assert.equal((result as any).id, 'co-1');
  });

  it('updates profile and returns detail when company is ACTIVE', async () => {
    const prisma = makePrisma();
    const useCase = new UpdatePartnerProfileUseCase(prisma, getDetailStub, configStub);
    const result = await useCase.execute(makeCmd());
    assert.equal(prisma.updateCalled(), true);
    assert.equal((result as any).id, 'co-1');
  });

  it('enqueues CUSTOMER_PROFILE_SYNC when the name changes and the account has a Stripe Customer', async () => {
    const prisma = makePrisma();
    const useCase = new UpdatePartnerProfileUseCase(prisma, getDetailStub, configStub);
    await useCase.execute(makeCmd({ name: 'New Name' }));
    const calls = prisma.syncCalls();
    assert.equal(calls.length, 1);
    assert.equal((calls[0] as any).data.type, 'CUSTOMER_PROFILE_SYNC');
    assert.equal((calls[0] as any).data.companyId, 'co-1');
  });

  it('does not enqueue a sync when the name is unchanged', async () => {
    const prisma = makePrisma();
    const useCase = new UpdatePartnerProfileUseCase(prisma, getDetailStub, configStub);
    await useCase.execute(makeCmd({ name: undefined, phone: '0812345678' }));
    assert.equal(prisma.syncCalls().length, 0);
  });

  it('does not enqueue a sync when the company has no Stripe Customer yet', async () => {
    const prisma = makePrisma({ customerId: null });
    const useCase = new UpdatePartnerProfileUseCase(prisma, getDetailStub, configStub);
    await useCase.execute(makeCmd({ name: 'New Name' }));
    assert.equal(prisma.syncCalls().length, 0);
  });
});
