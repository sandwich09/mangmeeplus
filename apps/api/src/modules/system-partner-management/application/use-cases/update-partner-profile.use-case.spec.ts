import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { UpdatePartnerProfileUseCase } from './update-partner-profile.use-case';

function makeCmd() {
  return {
    companyId: 'co-1',
    name: 'New Name',
    requestingAdminUserId: 'admin-1',
    requestId: 'req-1',
  };
}

function makePrisma(opts: { companyFound?: boolean; status?: string } = {}) {
  const companyFound = opts.companyFound ?? true;
  const status = opts.status ?? 'ACTIVE';
  let updateCalled = false;

  const prisma = {
    updateCalled: () => updateCalled,
    client: {
      company: {
        findUnique: async () =>
          companyFound
            ? { id: 'co-1', status, name: 'Old Name', brandName: null, timezone: 'Asia/Bangkok', locale: 'th-TH', phone: null, email: null }
            : null,
        update: async () => { updateCalled = true; return {}; },
      },
      auditLog: {
        create: async () => ({}),
      },
      $transaction: async (ops: any[]) => {
        for (const op of ops) {
          if (op && typeof op.then === 'function') await op;
        }
        return ops;
      },
    },
  } as any;

  return prisma;
}

const getDetailStub = { execute: async (companyId: string) => ({ id: companyId }) } as any;

describe('UpdatePartnerProfileUseCase', () => {
  it('throws NotFoundException when company not found', async () => {
    const prisma = makePrisma({ companyFound: false });
    const useCase = new UpdatePartnerProfileUseCase(prisma, getDetailStub);
    await assert.rejects(
      () => useCase.execute(makeCmd()),
      (err: unknown) => { assert.ok(err instanceof NotFoundException); return true; },
    );
  });

  for (const lockedStatus of ['DISABLED', 'ARCHIVED']) {
    it(`throws UnprocessableEntityException when company is ${lockedStatus} — profile is read-only`, async () => {
      const prisma = makePrisma({ status: lockedStatus });
      const useCase = new UpdatePartnerProfileUseCase(prisma, getDetailStub);
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

  it('updates profile and returns detail when company is ACTIVE', async () => {
    const prisma = makePrisma();
    const useCase = new UpdatePartnerProfileUseCase(prisma, getDetailStub);
    const result = await useCase.execute(makeCmd());
    assert.equal(prisma.updateCalled(), true);
    assert.equal((result as any).id, 'co-1');
  });
});
