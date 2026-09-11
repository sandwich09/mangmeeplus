/** Real PostgreSQL/production use cases. Only scheduling/failures and fixture query scope are injected. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../apps/api/src/generated/prisma/client';
import { RenewCompanyPlanTermUseCase, SetCompanyPlanTermUseCase } from '../../../apps/api/src/modules/system-partner-management/application/use-cases/company-plan-term.use-cases';
import { PartnerLifecycleTransitionUseCase } from '../../../apps/api/src/modules/system-partner-management/application/use-cases/partner-lifecycle-transition.use-case';
import { PlanTermSweepUseCase } from '../../../apps/api/src/modules/system-partner-management/application/use-cases/plan-term-sweep.use-case';
import { CreateOrUpdateNotificationEventUseCase } from '../../../apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases';

const DAY = 86_400_000;
type Command = { companyId: string; requestingAdminUserId: string; requestId: string; days: number };
type Hooks = { afterSelect?: () => Promise<void>; beforeDelivery?: () => void };

function services(db: PrismaClient, cmd: Command, hooks: Hooks = {}) {
  // Sweep/notification recipient SQL is restricted to this test's company. No real admin is notified.
  const prisma = { client: {
    companyPlanTerm: { findMany: async (args: any) => {
      const rows = await db.companyPlanTerm.findMany({ ...args, where: { ...args.where, companyId: cmd.companyId } });
      if (rows.length) await hooks.afterSelect?.();
      return rows;
    } },
    $transaction: (fn: any) => db.$transaction(async tx => fn(new Proxy(tx, {
      get(target, key) {
        if (key === 'companyMembership') return { findMany: (args: any) => tx.companyMembership.findMany({
          ...args, where: { ...args.where, companyId: cmd.companyId },
        }) };
        if (key === 'notificationDelivery') return new Proxy(tx.notificationDelivery, {
          get(delegate, method) {
            if (method === 'create') return (args: any) => { hooks.beforeDelivery?.(); return tx.notificationDelivery.create(args); };
            return Reflect.get(delegate, method);
          },
        });
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    })), { timeout: 10_000, maxWait: 10_000 }),
  } } as any;
  const real = { client: db } as any;
  const lifecycle = new PartnerLifecycleTransitionUseCase(real);
  const notification = new CreateOrUpdateNotificationEventUseCase(null as any, null as any, null as any, null as any, null as any, real);
  return { prisma, lifecycle, renew: new RenewCompanyPlanTermUseCase(real, lifecycle), sweep: new PlanTermSweepUseCase(prisma, lifecycle, notification), notification };
}

async function fixture(run: (db: PrismaClient, cmd: Command) => Promise<void>) {
  const url = process.env['DATABASE_URL'];
  assert.ok(url && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname), 'explicit local test DATABASE_URL required');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const companyId = `e2e-billing-proof-${randomUUID()}`;
  const userId = `${companyId}-owner`;
  try {
    const admin = await db.user.findFirstOrThrow({ where: { username: 'thawatchai.watchdog' } });
    const role = await db.role.findFirstOrThrow({ where: { key: 'OWNER' } });
    await db.user.create({ data: { id: userId, displayName: 'Disposable billing proof owner' } });
    await db.company.create({ data: { id: companyId, name: 'Disposable billing proof', businessCategory: 'RETAIL',
      memberships: { create: { userId, roles: { create: { roleId: role.id } } } },
    } });
    await db.companyPlanTerm.create({ data: {
      companyId, tierKey: 'BASIC_499', branchLimit: 2, employeeLimit: 5, monthlySlipLimit: 50,
      termStartAt: new Date(Date.now() - 31 * DAY), termEndsAt: new Date(Date.now() - DAY),
    } });
    await run(db, { companyId, requestingAdminUserId: admin.id, requestId: `proof-${randomUUID()}`, days: 30 });
  } finally {
    await db.notificationEvent.deleteMany({ where: { companyId } });
    await db.auditLog.deleteMany({ where: { OR: [{ companyId }, { targetId: companyId }] } });
    await db.company.deleteMany({ where: { id: companyId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
}

async function disableByTerm(db: PrismaClient, companyId: string) {
  await db.company.update({ where: { id: companyId }, data: { status: 'DISABLED' } });
  await db.companyPlanTerm.update({ where: { companyId }, data: { termDisabledAt: new Date() } });
}
const term = (db: PrismaClient, companyId: string) => db.companyPlanTerm.findUniqueOrThrow({ where: { companyId } });
const company = (db: PrismaClient, companyId: string) => db.company.findUniqueOrThrow({ where: { id: companyId } });

test('RG01 legacy recovery report is read-only and never treats a later admin hold as activation approval', () => fixture(async (db, cmd) => {
  const { renew, lifecycle } = services(db, cmd);
  await renew.execute(cmd);
  await lifecycle.execute({ ...cmd, targetStatus: 'DISABLED', reason: 'explicit hold after renewal' });
  const before = await company(db, cmd.companyId);
  const sql = readFileSync(new URL('./inspect-legacy-recovery.sql', import.meta.url), 'utf8')
    .split('BEGIN TRANSACTION READ ONLY;')[1]!.split('ROLLBACK;')[0]!;
  const rows = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.$queryRawUnsafe<Array<{ companyId: string; reviewReason: string }>>(sql);
  });
  assert.equal(rows.find(row => row.companyId === cmd.companyId)?.reviewReason, 'LATER_ADMIN_HOLD_REVIEW');
  assert.deepEqual(await company(db, cmd.companyId), before);
}));

test('PG00 ordinary renewal activates once and response-loss replay has no new mutation', () => fixture(async (db, cmd) => {
  await disableByTerm(db, cmd.companyId);
  const { renew } = services(db, cmd);
  await renew.execute(cmd);
  const first = await term(db, cmd.companyId);
  await renew.execute(cmd);
  assert.deepEqual(await term(db, cmd.companyId), first);
  assert.equal(first.renewCount, 1);
  assert.equal((await company(db, cmd.companyId)).status, 'ACTIVE');
  assert.equal(await db.auditLog.count({ where: { requestId: cmd.requestId, action: 'system.company_plan_term.renew' } }), 1);
}));

test('PG01/R01 activation exception rolls back term, lifecycle and audit; replay completes once', () => fixture(async (db, cmd) => {
  await disableByTerm(db, cmd.companyId);
  const before = await term(db, cmd.companyId);
  const { lifecycle } = services(db, cmd);
  let calls = 0;
  const renew = new RenewCompanyPlanTermUseCase({ client: db } as any, { execute: async (input: any, tx: any) => {
    const result = await lifecycle.execute(input, tx);
    if (++calls === 1) throw new Error('injected after lifecycle SQL');
    return result;
  } } as any);
  await assert.rejects(renew.execute(cmd), /injected after lifecycle SQL/);
  assert.deepEqual(await term(db, cmd.companyId), before);
  assert.equal((await company(db, cmd.companyId)).status, 'DISABLED');
  assert.equal(await db.auditLog.count({ where: { requestId: cmd.requestId } }), 0);
  await renew.execute(cmd);
  await renew.execute(cmd);
  assert.equal((await company(db, cmd.companyId)).status, 'ACTIVE');
  assert.equal((await term(db, cmd.companyId)).renewCount, 1);
}));

test('PG02/R05 eight concurrent requests with one key produce one renewal/audit', () => fixture(async (db, cmd) => {
  const { renew } = services(db, cmd);
  await Promise.all(Array.from({ length: 8 }, () => renew.execute(cmd)));
  assert.equal((await term(db, cmd.companyId)).renewCount, 1);
  assert.equal(await db.auditLog.count({ where: { requestId: cmd.requestId, action: 'system.company_plan_term.renew' } }), 1);
}));

test('PG03/R03 renewal committed after sweep selection must prevent stale disable and notice', () => fixture(async (db, cmd) => {
  const { renew } = services(db, cmd);
  let selected = false;
  const { sweep } = services(db, cmd, { afterSelect: async () => { if (!selected) { selected = true; await renew.execute(cmd); } } });
  const result = await sweep.execute();
  assert.ok(selected);
  assert.equal(result.failures, 0);
  assert.equal(result.expired, 0);
  assert.equal((await company(db, cmd.companyId)).status, 'ACTIVE');
  assert.ok((await term(db, cmd.companyId)).termEndsAt > new Date());
  assert.equal(await db.notificationEvent.count({ where: { companyId: cmd.companyId } }), 0);
}));

test('RG01 same key/different days conflicts; distinct concurrent commands do not lose days', () => fixture(async (db, cmd) => {
  const future = new Date(Date.now() + DAY);
  await db.companyPlanTerm.update({ where: { companyId: cmd.companyId }, data: { termEndsAt: future } });
  const { renew } = services(db, cmd);
  await Promise.all([renew.execute(cmd), renew.execute({ ...cmd, requestId: `${cmd.requestId}-second`, days: 7 })]);
  assert.equal((await term(db, cmd.companyId)).termEndsAt.getTime(), future.getTime() + 37 * DAY);
  await assert.rejects(renew.execute({ ...cmd, days: 7 }), /different days/);
  assert.equal((await term(db, cmd.companyId)).renewCount, 2);
}));

test('RG02 admin disable on an already term-disabled company survives renewal and replay', () => fixture(async (db, cmd) => {
  await disableByTerm(db, cmd.companyId);
  const { renew, lifecycle } = services(db, cmd);
  await lifecycle.execute({ ...cmd, targetStatus: 'DISABLED', reason: 'explicit administrator hold' });
  assert.equal((await term(db, cmd.companyId)).termDisabledAt, null);
  await renew.execute(cmd);
  await renew.execute(cmd);
  assert.equal((await company(db, cmd.companyId)).status, 'DISABLED');
}));

test('RG02 concurrent admin hold/renewal and duplicate sweeps preserve final hold', () => fixture(async (db, cmd) => {
  await disableByTerm(db, cmd.companyId);
  const { renew, lifecycle } = services(db, cmd);
  await Promise.all([renew.execute(cmd), lifecycle.execute({ ...cmd, targetStatus: 'DISABLED', reason: 'admin hold' })]);
  assert.equal((await company(db, cmd.companyId)).status, 'DISABLED');
  await db.company.update({ where: { id: cmd.companyId }, data: { status: 'ACTIVE' } });
  await db.companyPlanTerm.update({ where: { companyId: cmd.companyId }, data: { termEndsAt: new Date(Date.now() - DAY) } });
  const { sweep } = services(db, cmd);
  const results = await Promise.all([sweep.execute(), sweep.execute()]);
  assert.equal(results.reduce((n, result) => n + result.expired, 0), 1);
  assert.equal(results.reduce((n, result) => n + result.failures, 0), 0);
  assert.equal(await db.notificationEvent.count({ where: { companyId: cmd.companyId } }), 1);
  assert.equal(await db.notificationDelivery.count({ where: { companyId: cmd.companyId } }), 2);
}));

for (const status of ['SUSPENDED', 'ARCHIVED'] as const) {
  test(`RG02 ${status} committed after sweep SELECT is not overwritten`, () => fixture(async (db, cmd) => {
    let held = false;
    const { sweep } = services(db, cmd, { afterSelect: async () => {
      if (!held) { held = true; await db.company.update({ where: { id: cmd.companyId }, data: { status } }); }
    } });
    assert.equal((await sweep.execute()).failures, 0);
    assert.ok(held);
    assert.equal((await company(db, cmd.companyId)).status, status);
    await services(db, cmd).renew.execute(cmd);
    assert.equal((await company(db, cmd.companyId)).status, status);
  }));
}

for (const warning of [false, true]) {
  test(`RG03/R07 ${warning ? 'warning' : 'expiry'} failure after event creation rolls back claim and retries durable deliveries`, () => fixture(async (db, cmd) => {
    if (warning) await db.companyPlanTerm.update({ where: { companyId: cmd.companyId }, data: { termEndsAt: new Date(Date.now() + 3 * DAY) } });
    let attempts = 0;
    const { sweep } = services(db, cmd, { beforeDelivery: () => { if (++attempts === 1) throw new Error('injected delivery insert outage'); } });
    const failed = await sweep.execute();
    assert.equal(failed.failures, 1);
    assert.equal(await db.notificationEvent.count({ where: { companyId: cmd.companyId } }), 0);
    assert.equal(await db.notificationRecipient.count({ where: { companyId: cmd.companyId } }), 0);
    assert.equal((await term(db, cmd.companyId))[warning ? 'warn3SentAt' : 'expiredNotifiedAt'], null);
    assert.equal((await company(db, cmd.companyId)).status, 'ACTIVE');
    assert.equal((await sweep.execute()).failures, 0);
    await sweep.execute();
    assert.equal(await db.notificationEvent.count({ where: { companyId: cmd.companyId } }), 1);
    assert.equal(await db.notificationRecipient.count({ where: { companyId: cmd.companyId } }), 1);
    assert.equal(await db.notificationDelivery.count({ where: { companyId: cmd.companyId } }), 2);
  }));
}

test('RG03 renewed term does not receive a stale warning selected from its old period', () => fixture(async (db, cmd) => {
  await db.companyPlanTerm.update({ where: { companyId: cmd.companyId }, data: { termEndsAt: new Date(Date.now() + 3 * DAY) } });
  let renewed = false;
  const { renew } = services(db, cmd);
  const { sweep } = services(db, cmd, { afterSelect: async () => { if (!renewed) { renewed = true; await renew.execute(cmd); } } });
  assert.equal((await sweep.execute()).warned, 0);
  assert.ok(renewed);
  assert.equal(await db.notificationEvent.count({ where: { companyId: cmd.companyId } }), 0);
}));

test('RG03 replay repairs a missing delivery on an existing recipient during cooldown', () => fixture(async (db, cmd) => {
  const { sweep, notification } = services(db, cmd);
  await sweep.execute();
  const event = await db.notificationEvent.findFirstOrThrow({ where: { companyId: cmd.companyId } });
  await db.notificationDelivery.deleteMany({ where: { companyId: cmd.companyId, channel: 'LINE' } });
  const input = {
    companyId: cmd.companyId, triggerKey: event.triggerKey, sourceModule: event.sourceModule,
    sourceType: event.sourceType, sourceId: event.sourceId!, severity: 'critical', title: event.title, body: event.body,
    periodKey: `expired:${(await term(db, cmd.companyId)).termEndsAt.toISOString()}`, recipientUserIds: [`${cmd.companyId}-owner`],
  };
  await Promise.all([1, 2].map(() => db.$transaction(tx => notification.executeInTransaction(input, tx))));
  assert.equal(await db.notificationEvent.count({ where: { companyId: cmd.companyId } }), 1);
  assert.equal(await db.notificationRecipient.count({ where: { companyId: cmd.companyId } }), 1);
  assert.equal(await db.notificationDelivery.count({ where: { companyId: cmd.companyId } }), 2);
}));

test('RG01 set limits racing renewal preserves both changes and all existing days', () => fixture(async (db, cmd) => {
  const future = new Date(Date.now() + DAY);
  await db.companyPlanTerm.update({ where: { companyId: cmd.companyId }, data: { termEndsAt: future } });
  const { renew } = services(db, cmd);
  const set = new SetCompanyPlanTermUseCase({ client: db } as any);
  await Promise.all([renew.execute(cmd), set.execute({ ...cmd, tierKey: 'PRO_999', branchLimit: 5, employeeLimit: 10, monthlySlipLimit: 100 })]);
  const after = await term(db, cmd.companyId);
  assert.equal(after.termEndsAt.getTime(), future.getTime() + 30 * DAY);
  assert.equal(after.branchLimit, 5);
  assert.equal(after.renewCount, 1);
}));
