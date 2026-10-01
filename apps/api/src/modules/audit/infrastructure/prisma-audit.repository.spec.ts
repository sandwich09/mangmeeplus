import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { PrismaService } from '../../../common/database/prisma.service';
import { PLATFORM_TENANT_ID } from '../../sales-console/application/sales-context';
import { PLATFORM_AUDIT_ACTION_PREFIXES } from '../domain/models/audit-action';
import type { AuditTransactionClient } from '../domain/ports/audit-repository.port';
import { PrismaAuditRepository } from './prisma-audit.repository';

describe('PrismaAuditRepository', () => {
  it('preserves USER audits when the typed actor migration is not applied yet', async () => {
    const calls: unknown[] = [];
    const rawCalls: unknown[] = [];
    const create = async (args: unknown) => {
      calls.push(args);
      throw Object.assign(new Error('column actorType of relation AuditLog does not exist'), { code: 'P2022' });
    };
    const $executeRaw = async (...args: unknown[]) => { rawCalls.push(args); return 1; };
    const repo = new PrismaAuditRepository({ client: { auditLog: { create }, $executeRaw } } as unknown as PrismaService);

    await repo.log({ actorUserId: 'user-1', companyId: 'company-1', action: 'inventory.product.created', targetType: 'product', requestId: 'request-1', result: 'SUCCESS' });

    assert.equal(calls.length, 1);
    assert.equal(rawCalls.length, 1);
    assert.doesNotMatch(String((rawCalls[0] as unknown[][])[0]), /actorType|actorRefId/);
  });

  it('writes on the caller transaction client instead of the root client (L-10)', async () => {
    const rootCalls: unknown[] = [];
    const txCalls: unknown[] = [];
    const repo = new PrismaAuditRepository({
      client: { auditLog: { create: async (args: unknown) => { rootCalls.push(args); } } },
    } as unknown as PrismaService);
    const tx = { auditLog: { create: async (args: unknown) => { txCalls.push(args); } } } as unknown as AuditTransactionClient;

    await repo.log(
      { actorUserId: 'user-1', companyId: 'company-1', action: 'ledger.period.close', targetType: 'accounting_period', requestId: 'req-2', result: 'SUCCESS', riskLevel: 'CRITICAL' },
      tx,
    );

    assert.equal(rootCalls.length, 0);
    assert.equal(txCalls.length, 1);
    assert.equal((txCalls[0] as { data: { action: string } }).data.action, 'ledger.period.close');
  });

  it('propagates an in-transaction insert failure so the caller transaction rolls back (L-10)', async () => {
    const repo = new PrismaAuditRepository({
      client: { auditLog: { create: async () => {} } },
    } as unknown as PrismaService);
    const tx = { auditLog: { create: async () => { throw new Error('insert failed'); } } } as unknown as AuditTransactionClient;

    await assert.rejects(
      () => repo.log({ action: 'ledger.period.close', targetType: 'accounting_period', requestId: 'req-3', result: 'SUCCESS' }, tx),
      /insert failed/,
    );
  });
});

// RB-38. The shop-facing list returned every row carrying the shop's id, and platform code writes
// rows with that id: a flag review of the shop's sales credit, a referral repair, a refund observed
// by billing. The shop's OWNER and read-only auditor could read them, platform staff ids included.
describe('PrismaAuditRepository.getCompanyLogs own-trail filter (RB-38)', () => {
  const SHOP = 'shop-1';
  const memberships = [
    { userId: 'owner-1', companyId: SHOP }, { userId: 'staff-1', companyId: SHOP },
    { userId: 'admin-1', companyId: PLATFORM_TENANT_ID }, { userId: 'agent-1', companyId: PLATFORM_TENANT_ID },
    // Platform staff who also work in this shop as a member.
    { userId: 'both-1', companyId: PLATFORM_TENANT_ID }, { userId: 'both-1', companyId: SHOP },
    // `merged-1` has no row: an account merge moved its membership to the surviving account.
  ];
  const row = (action: string, actorUserId: string | null, companyId = SHOP) => ({
    id: `${action}|${actorUserId ?? 'system'}`, createdAt: new Date('2026-10-01T00:00:00.000Z'), actorType: actorUserId ? 'USER' : 'SYSTEM',
    actorUserId, actorRefId: null, companyId, action, targetType: 't', targetId: null, requestId: 'r', result: 'SUCCESS', riskLevel: 'LOW', metadataJson: null,
  });
  const ownTrail = [
    row('expense.create', 'staff-1'),
    row('reimbursement.approval.auto_by_policy', null),
    row('document.number.commit', null),
    row('signup.line.support_requested', null),
    row('signup.line.package_change_requested', 'owner-1'),
    row('billing.portal.opened', 'owner-1'),
    row('billing.invoice.applied', 'owner-1'),
    row('expense.update', 'both-1'),
    row('expense.create', 'merged-1'),
  ];
  const platformSide = [
    row('sales.attribution.flag_reviewed', 'admin-1'),
    row('sales.referral.changed', 'admin-1'),
    row('sales.deal.approved', 'agent-1'),
    row('sales.deal.expired', null),
    row('billing.financial.observed', null),
    row('billing.invoice.applied', null),
    row('billing.plan_adjustment.approve', 'admin-1'),
    row('billing.plan_adjustment.approve', 'both-1'),
    row('system.partner_ai_model.update', 'admin-1'),
    row('system.company_plan_term.set', 'both-1'),
    row('system.entitlement.runoff_complete', null),
    row('auth.identity.repointed', 'admin-1'),
    row('ai.credit_hold.released', 'both-1'),
    row('signup.line.package_change_decided', 'admin-1'),
    row('signup.request.provisioned', 'admin-1'),
    // A tenant-namespace action, but done by platform staff who hold no membership in the shop.
    row('company.update', 'admin-1'),
  ];

  // The subset of Prisma `where` this repository builds, evaluated over rows held in memory.
  const userMatches = (where: any, userId: string): boolean => Object.entries(where).every(([key, cond]: [string, any]) => {
    if (key === 'OR') return cond.some((item: any) => userMatches(item, userId));
    assert.equal(key, 'memberships');
    const inCompany = (companyId: string) => memberships.some((m) => m.userId === userId && m.companyId === companyId);
    return (!cond.some || inCompany(cond.some.companyId)) && (!cond.none || !inCompany(cond.none.companyId));
  });
  const matches = (where: any, item: any): boolean => Object.entries(where).every(([key, cond]: [string, any]) => {
    if (key === 'AND') return cond.every((part: any) => matches(part, item));
    if (key === 'OR') return cond.some((part: any) => matches(part, item));
    if (key === 'NOT') return !matches(cond, item);
    if (key === 'actor') return item.actorUserId !== null && userMatches(cond.is, item.actorUserId);
    if (cond === null || typeof cond !== 'object') return item[key] === cond;
    if ('startsWith' in cond) return item[key].startsWith(cond.startsWith);
    assert.ok('not' in cond, `unsupported filter on ${key}`);
    return item[key] !== cond.not;
  });
  const repoOver = (rows: ReturnType<typeof row>[]) => new PrismaAuditRepository({ client: { auditLog: {
    findMany: async ({ where }: any) => rows.filter((item) => matches(where, item)),
    count: async ({ where }: any) => rows.filter((item) => matches(where, item)).length,
  } } } as unknown as PrismaService);

  it('shows a shop its own trail, leaves out what the platform did about it, and does not filter the platform company', async () => {
    const { data, total } = await repoOver([...platformSide, ...ownTrail]).getCompanyLogs({ companyId: SHOP, page: 1, pageSize: 100 });
    assert.deepEqual(data.map((item) => item.id), ownTrail.map((item) => item.id));
    assert.equal(total, ownTrail.length);
    assert.equal(data.some((item) => item.actorUserId === 'admin-1' || item.actorUserId === 'agent-1'), false, 'a platform staff id reached the shop');

    // The platform company keeps seeing everything written under its own id.
    const own = [row('sales.agent.suspended', 'admin-1', PLATFORM_TENANT_ID), row('billing.configuration.published', null, PLATFORM_TENANT_ID),
      row('sales.event.qr_issued', 'agent-1', PLATFORM_TENANT_ID)];
    const platform = await repoOver(own).getCompanyLogs({ companyId: PLATFORM_TENANT_ID, page: 1, pageSize: 100 });
    assert.deepEqual(platform.data.map((item) => item.id), own.map((item) => item.id));
    assert.equal(platform.total, own.length);
  });

  it('hides every action the platform-side modules write, so a new one cannot reach a shop unnoticed', () => {
    // The sales console and the system-* modules are the platform acting ON a company. A row they
    // write with no user (a sweep) is not stopped by who the actor is, only by its action name.
    const modules = join(__dirname, '../..');
    const sources = (readdirSync(modules, { recursive: true, encoding: 'utf8' }) as string[])
      .filter((file) => /^(sales-console|system-[a-z-]+)\//.test(file) && file.endsWith('.ts') && !file.endsWith('.spec.ts'));
    const actions = sources.flatMap((file) => [...readFileSync(join(modules, file), 'utf8')
      .matchAll(/\baction:\s*[^,\n]*?['`]([a-z_]+\.[a-z0-9_.]*)/g)].map((match) => match[1]!));
    assert.ok(actions.length >= 30, `expected the platform audit writes, found ${actions.length}`);
    assert.deepEqual([...new Set(actions.filter((action) => !PLATFORM_AUDIT_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix))))], []);
  });
});
