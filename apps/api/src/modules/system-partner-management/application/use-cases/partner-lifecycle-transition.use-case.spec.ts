import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PartnerLifecycleTransitionUseCase } from './partner-lifecycle-transition.use-case';

function makeCmd(target: string, companyStatus = 'ACTIVE') {
  return {
    companyId: 'co-1',
    targetStatus: target as any,
    requestingAdminUserId: 'admin-1',
    requestId: 'req-1',
    _currentStatus: companyStatus,
  };
}

function makePrisma(opts: { companyFound?: boolean; currentStatus?: string } = {}) {
  const found = opts.companyFound ?? true;
  const status = opts.currentStatus ?? 'ACTIVE';
  let auditArgs: any = null;
  let updateArgs: any = null;

  const prisma = {
    auditArgs: () => auditArgs,
    updateArgs: () => updateArgs,
    client: {
      company: {
        findUnique: async () => found ? { id: 'co-1', status, activatedAt: null, disabledAt: null, archivedAt: null } : null,
        update: async (args: any) => {
          updateArgs = args;
          return { id: 'co-1', status: args.data.status, activatedAt: args.data.activatedAt ?? null, disabledAt: args.data.disabledAt ?? null, archivedAt: args.data.archivedAt ?? null };
        },
      },
      auditLog: {
        create: async (args: any) => { auditArgs = args; return {}; },
      },
      $transaction: async (fn: (tx: any) => Promise<any>) => {
        const tx = {
          company: prisma.client.company,
          auditLog: prisma.client.auditLog,
        };
        return fn(tx);
      },
    },
  } as any;

  return prisma;
}

describe('PartnerLifecycleTransitionUseCase', () => {
  it('throws NotFoundException when company not found', async () => {
    const prisma = makePrisma({ companyFound: false });
    const uc = new PartnerLifecycleTransitionUseCase(prisma);
    await assert.rejects(
      () => uc.execute(makeCmd('DISABLED')),
      (err: unknown) => { assert.ok(err instanceof NotFoundException); return true; },
    );
  });

  it('throws UnprocessableEntityException for SUSPENDED targetStatus', async () => {
    const prisma = makePrisma();
    const uc = new PartnerLifecycleTransitionUseCase(prisma);
    await assert.rejects(
      () => uc.execute(makeCmd('SUSPENDED')),
      (err: unknown) => { assert.ok(err instanceof UnprocessableEntityException); return true; },
    );
  });

  const validTransitions: Array<[string, string]> = [
    ['ACTIVE', 'DISABLED'],
    ['ACTIVE', 'ARCHIVED'],
    ['DISABLED', 'ACTIVE'],
    ['DISABLED', 'ARCHIVED'],
    ['ARCHIVED', 'DISABLED'],
    ['ARCHIVED', 'ACTIVE'],
  ];

  for (const [from, to] of validTransitions) {
    it(`allows transition ${from} → ${to}`, async () => {
      const prisma = makePrisma({ currentStatus: from });
      const uc = new PartnerLifecycleTransitionUseCase(prisma);
      const result = await uc.execute({ companyId: 'co-1', targetStatus: to as any, requestingAdminUserId: 'admin-1', requestId: 'req-1' });
      assert.equal(result.status, to);
    });
  }

  it('writes audit event on every transition', async () => {
    const prisma = makePrisma({ currentStatus: 'ACTIVE' });
    const uc = new PartnerLifecycleTransitionUseCase(prisma);
    await uc.execute({ companyId: 'co-1', targetStatus: 'DISABLED', requestingAdminUserId: 'admin-1', requestId: 'req-1', reason: 'test-reason' });
    const audit = prisma.auditArgs();
    assert.ok(audit, 'audit must be written');
    assert.equal(audit.data.action, 'system.partner_company.lifecycle.transition');
    assert.equal(audit.data.metadataJson.fromStatus, 'ACTIVE');
    assert.equal(audit.data.metadataJson.toStatus, 'DISABLED');
    assert.equal(audit.data.metadataJson.reason, 'test-reason');
  });

  it('→ ACTIVE clears disabledAt and archivedAt', async () => {
    const prisma = makePrisma({ currentStatus: 'DISABLED' });
    const uc = new PartnerLifecycleTransitionUseCase(prisma);
    await uc.execute({ companyId: 'co-1', targetStatus: 'ACTIVE', requestingAdminUserId: 'admin-1', requestId: 'req-1' });
    const args = prisma.updateArgs();
    assert.ok(args.data.activatedAt instanceof Date);
    assert.equal(args.data.disabledAt, null);
    assert.equal(args.data.archivedAt, null);
  });

  it('→ DISABLED sets disabledAt and clears archivedAt', async () => {
    const prisma = makePrisma({ currentStatus: 'ACTIVE' });
    const uc = new PartnerLifecycleTransitionUseCase(prisma);
    await uc.execute({ companyId: 'co-1', targetStatus: 'DISABLED', requestingAdminUserId: 'admin-1', requestId: 'req-1' });
    const args = prisma.updateArgs();
    assert.ok(args.data.disabledAt instanceof Date);
    assert.equal(args.data.archivedAt, null);
  });

  it('→ ARCHIVED sets archivedAt', async () => {
    const prisma = makePrisma({ currentStatus: 'DISABLED' });
    const uc = new PartnerLifecycleTransitionUseCase(prisma);
    await uc.execute({ companyId: 'co-1', targetStatus: 'ARCHIVED', requestingAdminUserId: 'admin-1', requestId: 'req-1' });
    const args = prisma.updateArgs();
    assert.ok(args.data.archivedAt instanceof Date);
  });
});
