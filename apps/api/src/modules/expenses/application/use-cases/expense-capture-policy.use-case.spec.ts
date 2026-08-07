import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { UnprocessableEntityException } from '@nestjs/common';
import type { VatRegistrationStatus } from '@watchdog-bms/contracts';
import { GetExpenseCapturePolicyUseCase } from './expense-capture-policy.use-case';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

function ctxWith(permissions: string[]): RequestContext {
  return {
    requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
    membershipId: 'mem-1', roles: [], permissions, scopes: {}, authProvider: 'watchdog',
  } as RequestContext;
}

function makeUseCase(seed: {
  status: VatRegistrationStatus;
  entitlementRows?: Array<{ featureKey: string; enabled: boolean }> | null;
}) {
  const asOfSeen: Array<string | undefined> = [];
  const prisma = {
    client: {
      companyFeatureEntitlement: {
        findMany: async () => seed.entitlementRows ?? [],
      },
    },
  } as any;
  const vatRegistration = {
    get: async (_companyId: string, asOf?: string) => {
      asOfSeen.push(asOf);
      return { status: seed.status } as any;
    },
  } as any;
  return { useCase: new GetExpenseCapturePolicyUseCase(prisma, vatRegistration), asOfSeen };
}

const TAX_ON = [{ featureKey: 'thai_tax', enabled: true }];
const TAX_OFF = [{ featureKey: 'thai_tax', enabled: false }];

describe('GetExpenseCapturePolicyUseCase (spec §9)', () => {
  it('reports SIMPLE for an answered NOT_REGISTERED even while thai_tax is on', async () => {
    const { useCase } = makeUseCase({ status: 'NOT_REGISTERED', entitlementRows: TAX_ON });
    const view = await useCase.execute(ctxWith(['expense.read']));
    assert.equal(view.mode, 'SIMPLE');
  });

  it('keeps an UNKNOWN company on FULL while thai_tax is on', async () => {
    const { useCase } = makeUseCase({ status: 'UNKNOWN', entitlementRows: TAX_ON });
    assert.equal((await useCase.execute(ctxWith(['expense.read']))).mode, 'FULL');
  });

  it('reports SIMPLE for an UNKNOWN company without thai_tax', async () => {
    const { useCase } = makeUseCase({ status: 'UNKNOWN', entitlementRows: TAX_OFF });
    assert.equal((await useCase.execute(ctxWith(['expense.read']))).mode, 'SIMPLE');
  });

  // An unconfigured legacy company reads as the fail-open sentinel, the same way the permission
  // resolver reads it — it must not be downgraded to SIMPLE by the absence of config.
  it('treats a company with no entitlement rows as entitled', async () => {
    const { useCase } = makeUseCase({ status: 'UNKNOWN', entitlementRows: [] });
    assert.equal((await useCase.execute(ctxWith(['expense.read']))).mode, 'FULL');
  });

  it('masks the registration fact from a caller who may not read it', async () => {
    const { useCase } = makeUseCase({ status: 'NOT_REGISTERED', entitlementRows: TAX_ON });

    const clerk = await useCase.execute(ctxWith(['expense.read']));
    assert.equal(clerk.vatStatus, 'HIDDEN');
    assert.equal(clerk.canAnswerVatStatus, false);
    // Masked, but the form still renders correctly.
    assert.equal(clerk.mode, 'SIMPLE');

    const owner = await useCase.execute(ctxWith([
      'expense.read', 'company.vat_registration.read', 'company.vat_registration.manage',
    ]));
    assert.equal(owner.vatStatus, 'NOT_REGISTERED');
    assert.equal(owner.canAnswerVatStatus, true);
  });

  // The Tax Code empty state links to the setup wizard. Offering that link to someone who cannot
  // run it is the defect this answers, so the flag has to follow the permission, not the mode.
  it('reports whether the caller may run the tax setup wizard', async () => {
    const { useCase } = makeUseCase({ status: 'UNKNOWN', entitlementRows: TAX_ON });
    assert.equal((await useCase.execute(ctxWith(['expense.read']))).canConfigureTax, false);
    assert.equal((await useCase.execute(ctxWith(['expense.read', 'tax.config.manage']))).canConfigureTax, true);
  });

  // AC5 depends on the document date reaching the interval accessor as the day it names.
  it('passes the requested date through to the registration read', async () => {
    const { useCase, asOfSeen } = makeUseCase({ status: 'REGISTERED', entitlementRows: TAX_ON });
    await useCase.execute(ctxWith(['expense.read']), '2026-06-30');
    await useCase.execute(ctxWith(['expense.read']));
    assert.deepEqual(asOfSeen, ['2026-06-30', undefined]);
  });

  // BUG-5: the web passes `detail.expenseDate` through, and the API renders that column as an
  // instant. Refusing it 422'd every read and fell back to FULL without saying so.
  it('accepts the ISO datetime shipped clients send and reads it as that day', async () => {
    const { useCase, asOfSeen } = makeUseCase({ status: 'REGISTERED', entitlementRows: TAX_ON });
    await useCase.execute(ctxWith(['expense.read']), '2026-08-05T00:00:00.000Z');
    assert.deepEqual(asOfSeen, ['2026-08-05']);
  });

  it('still refuses a date it cannot read', async () => {
    const { useCase, asOfSeen } = makeUseCase({ status: 'REGISTERED', entitlementRows: TAX_ON });
    await assert.rejects(
      () => useCase.execute(ctxWith(['expense.read']), 'yesterday'),
      UnprocessableEntityException,
    );
    assert.deepEqual(asOfSeen, []);
  });
});
