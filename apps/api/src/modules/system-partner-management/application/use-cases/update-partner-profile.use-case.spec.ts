import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { UpdatePartnerProfileUseCase } from './update-partner-profile.use-case';
import { PLATFORM_TENANT_ID } from '../../../sales-console/application/sales-context';

function makeCmd(overrides: Record<string, unknown> = {}) {
  return {
    companyId: 'co-1',
    name: 'New Name',
    requestingAdminUserId: 'admin-1',
    requestId: 'req-1',
    ...overrides,
  };
}

function makePrisma(opts: { companyFound?: boolean; status?: string; termDisabledAt?: Date | null; customerId?: string | null;
  companyId?: string; labels?: { reportClassification?: string | null; reportIndustryGroup?: string | null } } = {}) {
  const companyFound = opts.companyFound ?? true;
  const status = opts.status ?? 'ACTIVE';
  const termDisabledAt = opts.termDisabledAt ?? null;
  const customerId = opts.customerId === undefined ? 'cus_1' : opts.customerId;
  let updateCalled = false;
  const syncCalls: unknown[] = [];
  const updates: any[] = [];
  const audits: any[] = [];

  const tx = {
    company: { update: async (args: any) => { updateCalled = true; updates.push(args); return {}; } },
    auditLog: { create: async (args: any) => { audits.push(args); return {}; } },
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
    updates: () => updates,
    audits: () => audits,
    client: {
      company: {
        findUnique: async () =>
          companyFound
            ? { id: opts.companyId ?? 'co-1', status, name: 'Old Name', brandName: null, timezone: 'Asia/Bangkok', locale: 'th-TH', phone: null, email: null,
                reportClassification: null, reportIndustryGroup: null, ...opts.labels, planTerm: { termDisabledAt } }
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

  // Executive spec §12.2, §15, §16.1: the two report labels.
  it('writes both labels with who and when, and audits each before and after', async () => {
    const prisma = makePrisma({ labels: { reportIndustryGroup: 'RETAIL_WHOLESALE' } });
    const before = Date.now();
    await new UpdatePartnerProfileUseCase(prisma, getDetailStub, configStub)
      .execute(makeCmd({ name: undefined, reportClassification: 'TEST', reportIndustryGroup: 'MANUFACTURING' }));
    const data = prisma.updates()[0].data;
    assert.equal(data.reportClassification, 'TEST');
    assert.equal(data.reportClassifiedByUserId, 'admin-1');
    assert.ok(data.reportClassifiedAt instanceof Date && data.reportClassifiedAt.getTime() >= before);
    assert.equal(data.reportIndustryGroup, 'MANUFACTURING');
    assert.deepEqual(prisma.audits()[0].data.metadataJson, {
      changedFields: ['reportClassification', 'reportIndustryGroup'],
      reportClassification: { from: null, to: 'TEST' },
      reportIndustryGroup: { from: 'RETAIL_WHOLESALE', to: 'MANUFACTURING' },
    });
    assert.equal(prisma.audits()[0].data.action, 'system.partner_company.update');
  });

  it('null clears a label; an unchanged label writes nothing and keeps who/when', async () => {
    const prisma = makePrisma({ labels: { reportClassification: 'CUSTOMER', reportIndustryGroup: 'FINANCE' } });
    await new UpdatePartnerProfileUseCase(prisma, getDetailStub, configStub)
      .execute(makeCmd({ name: undefined, reportClassification: 'CUSTOMER', reportIndustryGroup: null }));
    assert.deepEqual(prisma.updates()[0].data, { reportIndustryGroup: null });
    assert.deepEqual(prisma.audits()[0].data.metadataJson, {
      changedFields: ['reportIndustryGroup'], reportIndustryGroup: { from: 'FINANCE', to: null },
    });
  });

  it('labels a held or archived company (every company is counted), but still refuses its profile fields', async () => {
    for (const status of ['DISABLED', 'ARCHIVED']) {
      const labelled = makePrisma({ status });
      await new UpdatePartnerProfileUseCase(labelled, getDetailStub, configStub)
        .execute(makeCmd({ name: undefined, reportClassification: 'CUSTOMER', reportIndustryGroup: 'OTHER_INDUSTRY' }));
      assert.equal(labelled.updates()[0].data.reportClassification, 'CUSTOMER', status);
      assert.equal(labelled.updates()[0].data.reportIndustryGroup, 'OTHER_INDUSTRY', status);

      const mixed = makePrisma({ status });
      await assert.rejects(() => new UpdatePartnerProfileUseCase(mixed, getDetailStub, configStub)
        .execute(makeCmd({ reportClassification: 'CUSTOMER' })), UnprocessableEntityException);
      assert.equal(mixed.updateCalled(), false, status);
    }
  });

  it('keeps the platform company INTERNAL and refuses values outside the lists', async () => {
    for (const reportClassification of ['CUSTOMER', 'TEST', null]) {
      const prisma = makePrisma({ companyId: PLATFORM_TENANT_ID });
      await assert.rejects(() => new UpdatePartnerProfileUseCase(prisma, getDetailStub, configStub)
        .execute(makeCmd({ companyId: PLATFORM_TENANT_ID, name: undefined, reportClassification })), UnprocessableEntityException);
      assert.equal(prisma.updateCalled(), false, String(reportClassification));
    }
    const platform = makePrisma({ companyId: PLATFORM_TENANT_ID });
    await new UpdatePartnerProfileUseCase(platform, getDetailStub, configStub)
      .execute(makeCmd({ companyId: PLATFORM_TENANT_ID, name: undefined, reportClassification: 'INTERNAL' }));
    assert.equal(platform.updates()[0].data.reportClassification, 'INTERNAL', 'the row is brought in line with the fixed rule');

    for (const bad of [{ reportClassification: 'VIP' }, { reportIndustryGroup: 'RESTAURANTS' }]) {
      const prisma = makePrisma();
      await assert.rejects(() => new UpdatePartnerProfileUseCase(prisma, getDetailStub, configStub)
        .execute(makeCmd({ name: undefined, ...bad })), UnprocessableEntityException);
      assert.equal(prisma.updateCalled(), false, JSON.stringify(bad));
    }
  });
});
