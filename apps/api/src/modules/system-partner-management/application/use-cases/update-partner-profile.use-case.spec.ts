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


// Company-team-note decision 2026-10-04: registered API suite, shared writer rules.
describe('CompanyTeamNoteService', () => {
  const context = (overrides: Record<string, unknown> = {}) => ({ requestId: 'note-request', userId: 'admin-1', companyId: PLATFORM_TENANT_ID,
    roles: ['SYSTEM_ADMIN'], permissions: [], authSubject: 'a', membershipId: 'm', scopes: {}, authProvider: 'watchdog', ...overrides } as any);
  async function fixture(options: { found?: boolean; status?: string; auditFails?: boolean; writeFails?: boolean } = {}) {
    const { CompanyTeamNoteService } = await import('../company-team-note.service');
    let row: any = null;
    const audits: any[] = [];
    let locks = 0;
    const tx: any = {
      $queryRaw: async () => { locks++; return []; },
      company: { findUnique: async () => options.found === false ? null : { id: 'co-1', status: options.status ?? 'ACTIVE' } },
      user: { findUnique: async () => ({ displayName: 'ผู้ดูแล' }) },
      companyTeamNote: {
        findUnique: async () => row,
        upsert: async ({ create, update }: any) => { if (options.writeFails) throw new Error('query text includes private note 1234567890'); row = row ? { ...row, ...update, version: row.version + 1 } : create; return row; },
      },
    };
    const client: any = { ...tx, $transaction: async (fn: any) => {
      const before = row;
      try { return await fn(tx); } catch (error) { row = before; throw error; }
    } };
    const audit = { log: async (entry: any, transaction: any) => {
      assert.equal(transaction, tx, 'audit must share the write transaction');
      if (options.auditFails) throw new Error('audit insert failed');
      audits.push(entry);
    } };
    return { service: new CompanyTeamNoteService({ client } as any, audit as any), audits, row: () => row, locks: () => locks };
  }
  it('trims text, records editor/time, and audits only lengths/versions with a platform action', async () => {
    const { PLATFORM_AUDIT_ACTION_PREFIXES } = await import('../../../audit/domain/models/audit-action');
    const f = await fixture();
    const empty = await f.service.get(context(), 'co-1');
    assert.deepEqual(empty, { companyId: 'co-1', text: '', version: 0, updatedAt: null, updatedBy: null, canManage: true });
    const saved = await f.service.put(context(), 'co-1', { text: '  ติดต่อแล้ว\nรอโทรกลับ  ', expectedVersion: 0 });
    assert.equal(saved.text, 'ติดต่อแล้ว\nรอโทรกลับ'); assert.equal(saved.version, 1);
    assert.deepEqual(saved.updatedBy, { userId: 'admin-1', displayName: 'ผู้ดูแล' });
    assert.ok(Number.isFinite(Date.parse(saved.updatedAt!))); assert.equal(f.locks(), 1);
    const entry = f.audits[0];
    assert.equal(entry.action, 'system.company_team_note.update');
    assert.ok(PLATFORM_AUDIT_ACTION_PREFIXES.some(prefix => entry.action.startsWith(prefix)));
    assert.equal(entry.actorUserId, 'admin-1'); assert.equal(entry.companyId, PLATFORM_TENANT_ID);
    assert.equal(entry.targetId, 'co-1');
    assert.deepEqual(entry.metadataJson, { beforeLength: 0, afterLength: saved.text.length, beforeVersion: 0, afterVersion: 1 });
    assert.ok(!JSON.stringify(entry).includes(saved.text));
    assert.equal((await f.service.get(context(), 'co-1')).text, saved.text);
  });
  it('accepts 1,000 trimmed characters, rejects longer/invalid input without a mutation', async () => {
    const f = await fixture();
    const valid = await f.service.put(context(), 'co-1', { text: '  ' + 'ก'.repeat(1000) + '  ', expectedVersion: 0 });
    assert.equal(valid.text.length, 1000);
    for (const body of [{ text: 'ก'.repeat(1001), expectedVersion: 1 }, { text: null, expectedVersion: 1 },
      { text: 'x', expectedVersion: -1 }, { text: 'x' }, { text: 'x', expectedVersion: 1.5 }]) {
      await assert.rejects(() => f.service.put(context(), 'co-1', body as any), (error: any) => error.getStatus() === 400);
    }
    assert.equal(f.row().version, 1); assert.equal(f.audits.length, 1);
  });
  it('empty clears without losing last editor/time or resetting version; unchanged is a no-op', async () => {
    const f = await fixture();
    await f.service.put(context(), 'co-1', { text: 'หมายเหตุ', expectedVersion: 0 });
    const clear = await f.service.put(context(), 'co-1', { text: ' \n ', expectedVersion: 1 });
    assert.equal(clear.text, ''); assert.equal(clear.version, 2); assert.ok(clear.updatedBy); assert.ok(clear.updatedAt);
    assert.deepEqual(await f.service.put(context(), 'co-1', { text: '', expectedVersion: 2 }), clear);
    assert.equal(f.audits.length, 2);
    assert.equal(f.audits[1].metadataJson.afterLength, 0);
  });
  it('rejects stale editors, including stale identical text, without overwrite or extra audit', async () => {
    const f = await fixture();
    await f.service.put(context(), 'co-1', { text: 'ล่าสุด', expectedVersion: 0 });
    for (const text of ['ร่างเก่า', 'ล่าสุด']) await assert.rejects(() => f.service.put(context(), 'co-1', { text, expectedVersion: 0 }),
      (error: any) => error.getStatus() === 409 && error.getResponse().code === 'company_team_note_version_conflict');
    assert.equal(f.row().text, 'ล่าสุด'); assert.equal(f.audits.length, 1);
  });
  it('refuses shop context even with forged platform permissions; executive read is read-only unless granted', async () => {
    const f = await fixture();
    const shop = context({ companyId: 'co-1', permissions: ['system.partner_dashboard.read', 'system.executive.read', 'system.executive.company_note.manage'] });
    await assert.rejects(() => f.service.get(shop, 'co-1'), (error: any) => error.getStatus() === 403);
    await assert.rejects(() => f.service.put(shop, 'co-1', { text: 'secret', expectedVersion: 0 }), (error: any) => error.getStatus() === 403);
    const executive = context({ roles: ['MANGMEE_EXECUTIVE'], permissions: ['system.executive.read'] });
    assert.equal((await f.service.get(executive, 'co-1')).canManage, false);
    await assert.rejects(() => f.service.put(executive, 'co-1', { text: 'secret', expectedVersion: 0 }), (error: any) => error.getStatus() === 403);
    const granted = { ...executive, permissions: [...executive.permissions, 'system.executive.company_note.manage'] };
    assert.equal((await f.service.put(granted, 'co-1', { text: 'ทีม', expectedVersion: 0 })).text, 'ทีม');
    await assert.rejects(() => f.service.get(context({ roles: [], permissions: [] }), 'co-1'), (error: any) => error.getStatus() === 403);
  });
  it('SYSTEM_ADMIN writes on every company lifecycle, and missing companies are 404', async () => {
    for (const status of ['ACTIVE', 'SUSPENDED', 'DISABLED', 'ARCHIVED']) {
      const f = await fixture({ status });
      assert.equal((await f.service.put(context(), 'co-1', { text: 'ติดตาม', expectedVersion: 0 })).text, 'ติดตาม');
    }
    const f = await fixture({ found: false });
    await assert.rejects(() => f.service.get(context(), 'missing'), (error: any) => error.getStatus() === 404);
    await assert.rejects(() => f.service.put(context(), 'missing', { text: 'x', expectedVersion: 0 }), (error: any) => error.getStatus() === 404);
    assert.equal(f.audits.length, 0);
  });
  it('rolls back the note if the mandatory transactional audit fails', async () => {
    const f = await fixture({ auditFails: true });
    await assert.rejects(() => f.service.put(context(), 'co-1', { text: 'เลขบัญชี 1234567890', expectedVersion: 0 }), (error: any) => error.getStatus() === 503);
    assert.equal(f.row(), null);
  });
  it('never propagates submitted note or account numbers in persistence errors that the global filter logs', async () => {
    const f = await fixture({ writeFails: true });
    await assert.rejects(() => f.service.put(context(), 'co-1', { text: 'เลขบัญชี 1234567890', expectedVersion: 0 }), (error: any) => {
      assert.equal(error.getStatus(), 503); assert.ok(!error.message.includes('1234567890'));
      assert.ok(!JSON.stringify(error).includes('1234567890')); assert.ok(!String(error.stack).includes('1234567890'));
      return true;
    });
    assert.equal(f.row(), null); assert.equal(f.audits.length, 0);
  });
  it('shop company identity read and audit list never expose a saved team note', async () => {
    const f = await fixture();
    await f.service.put(context(), 'co-1', { text: 'ข้อมูลลับของทีม 1234567890', expectedVersion: 0 });
    const { CompanyIdentityUseCase } = await import('../../../data-model-core/application/use-cases/company-identity.use-case');
    const { PrismaAuditRepository } = await import('../../../audit/infrastructure/prisma-audit.repository');
    let selected: any;
    const client: any = {
      company: { findUnique: async ({ select }: any) => { selected = select; return { id: 'co-1', name: 'ร้าน', timezone: 'Asia/Bangkok',
        teamNote: f.row(), taxId: null, legalIdentityVersion: 0 }; } },
      companyLegalIdentityRevision: { findMany: async () => [] }, branch: { findMany: async () => [] },
      companyVatRegistrationFact: { findMany: async () => [] }, vatRegistrationPrompt: { findFirst: async () => null },
      companyVatRegistrationState: { findUnique: async () => null },
      auditLog: {
        findMany: async ({ where }: any) => {
          assert.equal(where.companyId, 'co-1');
          assert.ok(where.AND[0].NOT.OR.some((item: any) => f.audits[0].action.startsWith(item.action.startsWith)));
          return [];
        }, count: async () => 0,
      },
    };
    const shop = context({ companyId: 'co-1', roles: ['OWNER'], permissions: ['company.legal_identity.read'] });
    const identity = await new CompanyIdentityUseCase({ client } as any, {} as any, {} as any).get(shop, 'co-1');
    assert.ok(!selected.teamNote); assert.ok(!JSON.stringify(identity).includes('1234567890'));
    assert.ok(!JSON.stringify(identity).includes('teamNote'));
    assert.deepEqual(await new PrismaAuditRepository({ client } as any).getCompanyLogs({ companyId: 'co-1', page: 1, pageSize: 20 }), { data: [], total: 0 });
  });

});


it('admin profile changes cannot create or remove the system-only DEMO classification', async () => {
  const normal = makePrisma();
  await assert.rejects(new UpdatePartnerProfileUseCase(normal, getDetailStub, configStub).execute(makeCmd({ name: undefined, reportClassification: 'DEMO' })), UnprocessableEntityException);
  assert.equal(normal.updateCalled(), false);
  for (const classification of ['CUSTOMER', 'TEST', null]) {
    const demo = makePrisma({ labels: { reportClassification: 'DEMO' } });
    await assert.rejects(new UpdatePartnerProfileUseCase(demo, getDetailStub, configStub).execute(makeCmd({ name: undefined, reportClassification: classification })), UnprocessableEntityException);
    assert.equal(demo.updateCalled(), false);
  }
});
