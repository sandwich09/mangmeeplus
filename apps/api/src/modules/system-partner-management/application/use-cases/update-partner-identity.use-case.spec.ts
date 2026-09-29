import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { UpdatePartnerIdentityUseCase, type UpdatePartnerIdentityCommand } from './update-partner-identity.use-case';

function makeCmd(overrides: Partial<UpdatePartnerIdentityCommand> = {}): UpdatePartnerIdentityCommand {
  return {
    companyId: 'co-1',
    requestingAdminUserId: 'admin-1',
    requestId: 'req-1',
    reason: 'ลูกค้าแจ้งพิมพ์ชื่อผิด',
    body: { expectedLegalIdentityVersion: 3, changeKind: 'CORRECTION', registeredName: 'New Co Ltd', correctionReason: 'TYPO' },
    ...overrides,
  };
}

function makeDeps(opts: { companyFound?: boolean; status?: string; termDisabledAt?: Date | null; customerId?: string | null;
  patchImpl?: (ctx: unknown, companyId: string, body: unknown) => Promise<{ legalIdentityVersion: number; revisionId: string }> } = {}) {
  const companyFound = opts.companyFound ?? true;
  const status = opts.status ?? 'ACTIVE';
  const termDisabledAt = opts.termDisabledAt ?? null;
  const customerId = opts.customerId === undefined ? 'cus_1' : opts.customerId;
  const auditCalls: unknown[] = [];
  const syncCalls: unknown[] = [];
  let patchCall: { ctx: unknown; companyId: string; body: unknown; syncReason?: string } | undefined;

  const tx = {
    auditLog: { create: async (args: unknown) => { auditCalls.push(args); return {}; } },
    billingAccount: {
      findUnique: async () => (customerId ? { id: 'acct-1', companyId: 'co-1', stripeAccountId: 'acct_test', livemode: false, customerId, version: 3 } : null),
    },
    billingOperation: { create: async (args: unknown) => { syncCalls.push(args); return {}; } },
  };

  const prisma = {
    auditCalls: () => auditCalls,
    syncCalls: () => syncCalls,
    client: {
      company: {
        findUnique: async () => (companyFound ? { status, planTerm: { termDisabledAt } } : null),
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    },
  } as any;

  const identity = {
    patch: async (ctx: unknown, companyId: string, body: unknown, syncReason?: string) => {
      patchCall = { ctx, companyId, body, syncReason };
      if (opts.patchImpl) return opts.patchImpl(ctx, companyId, body);
      return { legalIdentityVersion: 4, revisionId: 'rev-1' };
    },
  } as any;

  const getDetail = { execute: async (companyId: string) => ({ id: companyId }) } as any;

  return { prisma, identity, getDetail, patchCall: () => patchCall };
}

describe('UpdatePartnerIdentityUseCase', () => {
  it('throws NotFoundException when the company does not exist', async () => {
    const d = makeDeps({ companyFound: false });
    const useCase = new UpdatePartnerIdentityUseCase(d.prisma, d.identity, d.getDetail);
    await assert.rejects(() => useCase.execute(makeCmd()), NotFoundException);
  });

  for (const lockedStatus of ['DISABLED', 'ARCHIVED']) {
    it(`throws UnprocessableEntityException when company is ${lockedStatus} admin hold`, async () => {
      const d = makeDeps({ status: lockedStatus });
      const useCase = new UpdatePartnerIdentityUseCase(d.prisma, d.identity, d.getDetail);
      await assert.rejects(() => useCase.execute(makeCmd()), UnprocessableEntityException);
      assert.equal(d.patchCall(), undefined, 'identity.patch must not run when locked');
    });
  }

  it('ARCHIVED stays locked even with a term row (no admin-hold exception for ARCHIVED)', async () => {
    const d = makeDeps({ status: 'ARCHIVED', termDisabledAt: new Date() });
    const useCase = new UpdatePartnerIdentityUseCase(d.prisma, d.identity, d.getDetail);
    await assert.rejects(() => useCase.execute(makeCmd()), UnprocessableEntityException);
  });

  it('DISABLED by a run-out term (termDisabledAt set) can still edit identity — R-E3/RV26', async () => {
    const d = makeDeps({ status: 'DISABLED', termDisabledAt: new Date() });
    const useCase = new UpdatePartnerIdentityUseCase(d.prisma, d.identity, d.getDetail);
    const result = await useCase.execute(makeCmd());
    assert.equal((result as any).id, 'co-1');
  });

  it('calls identity.patch with a minimal context carrying only userId/requestId', async () => {
    const d = makeDeps();
    const useCase = new UpdatePartnerIdentityUseCase(d.prisma, d.identity, d.getDetail);
    await useCase.execute(makeCmd());
    const call = d.patchCall()!;
    assert.deepEqual(call.ctx, { userId: 'admin-1', requestId: 'req-1' });
    assert.equal(call.companyId, 'co-1');
    assert.deepEqual(call.body, { expectedLegalIdentityVersion: 3, changeKind: 'CORRECTION', registeredName: 'New Co Ltd', correctionReason: 'TYPO' });
  });

  it('propagates a 409 (stale legalIdentityVersion) from identity.patch unchanged', async () => {
    const d = makeDeps({ patchImpl: async () => { throw new ConflictException('legalIdentityVersion is stale; reload and retry'); } });
    const useCase = new UpdatePartnerIdentityUseCase(d.prisma, d.identity, d.getDetail);
    await assert.rejects(() => useCase.execute(makeCmd()), ConflictException);
  });

  it('propagates a 422 (identity_change_kind_not_allowed) from identity.patch unchanged', async () => {
    const rejection = new UnprocessableEntityException({ code: 'identity_change_kind_not_allowed', message: 'x', details: { allowedChangeKinds: ['CORRECTION'] } });
    const d = makeDeps({ patchImpl: async () => { throw rejection; } });
    const useCase = new UpdatePartnerIdentityUseCase(d.prisma, d.identity, d.getDetail);
    await assert.rejects(() => useCase.execute(makeCmd()), (err: unknown) => err === rejection);
  });

  it('writes a CRITICAL audit with safe keys only — no registered name, tax id or address value', async () => {
    const d = makeDeps();
    const useCase = new UpdatePartnerIdentityUseCase(d.prisma, d.identity, d.getDetail);
    await useCase.execute(makeCmd({ reason: 'internal note', body: { expectedLegalIdentityVersion: 3, changeKind: 'CORRECTION', registeredName: 'Secret Co Ltd', taxId: '1234567890123', correctionReason: 'TYPO' } }));
    const [entry] = d.prisma.auditCalls() as any[];
    assert.equal(entry.data.action, 'system.partner_company.identity_update');
    assert.equal(entry.data.riskLevel, 'CRITICAL');
    assert.equal(entry.data.metadataJson.legalIdentityVersion, 4);
    assert.equal(entry.data.metadataJson.revisionId, 'rev-1');
    assert.deepEqual(entry.data.metadataJson.changedFields.sort(), ['registeredName', 'taxId']);
    const serialized = JSON.stringify(entry.data.metadataJson);
    assert.equal(serialized.includes('Secret Co Ltd'), false, 'audit metadata must not carry the registered name value');
    assert.equal(serialized.includes('1234567890123'), false, 'audit metadata must not carry the tax id value');
  });

  // The Customer sync is queued by identity.patch inside the identity transaction (the one writer the
  // shop's own edit shares). A second enqueue here would hit the same idempotency key inside this
  // audit transaction, and a unique violation aborts a Postgres transaction — losing this audit row.
  it('leaves CUSTOMER_PROFILE_SYNC to identity.patch and names the team as the reason', async () => {
    const d = makeDeps();
    const useCase = new UpdatePartnerIdentityUseCase(d.prisma, d.identity, d.getDetail);
    await useCase.execute(makeCmd());
    assert.equal(d.patchCall()!.syncReason, 'ปรับข้อมูลจดทะเบียนโดยทีมงาน');
    assert.equal(d.prisma.syncCalls().length, 0);
    assert.equal((d.prisma.auditCalls() as any[]).length, 1);
  });
});
