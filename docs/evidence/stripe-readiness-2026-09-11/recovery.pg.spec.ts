/** Real PostgreSQL + production use cases, injected failure/interleaving only.
 * These assert required behavior. Known defects MUST fail; a repro is not PASS.
 * No Stripe, cloud, notification delivery or existing-company mutation.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../apps/api/src/generated/prisma/client';
import { RenewCompanyPlanTermUseCase } from '../../../apps/api/src/modules/system-partner-management/application/use-cases/company-plan-term.use-cases';
import { PartnerLifecycleTransitionUseCase } from '../../../apps/api/src/modules/system-partner-management/application/use-cases/partner-lifecycle-transition.use-case';
import { PlanTermSweepUseCase } from '../../../apps/api/src/modules/system-partner-management/application/use-cases/plan-term-sweep.use-case';

const DAY = 86_400_000;

async function fixture(run: (db: PrismaClient, command: {
  companyId: string; requestingAdminUserId: string; requestId: string; days: number;
}) => Promise<void>) {
  const url = process.env['DATABASE_URL'];
  assert.ok(url, 'DATABASE_URL must be explicitly set to local test PostgreSQL');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname), 'local database only');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const companyId = `e2e-billing-probe-${randomUUID()}`;
  try {
    const admin = await db.user.findFirstOrThrow({ where: { username: 'thawatchai.watchdog' }, select: { id: true } });
    await db.company.create({ data: { id: companyId, name: 'Disposable billing recovery probe', businessCategory: 'RETAIL' } });
    await db.companyPlanTerm.create({ data: {
      companyId, tierKey: 'BASIC_499', branchLimit: 2, employeeLimit: 5, monthlySlipLimit: 50,
      termStartAt: new Date(Date.now() - 31 * DAY), termEndsAt: new Date(Date.now() - DAY),
    } });
    await run(db, { companyId, requestingAdminUserId: admin.id, requestId: `probe-${randomUUID()}`, days: 30 });
  } finally {
    await db.auditLog.deleteMany({ where: { OR: [{ companyId }, { targetId: companyId }] } });
    await db.company.deleteMany({ where: { id: companyId } });
    await db.$disconnect();
  }
}

test('PG00 ordinary manual renewal really activates a term-disabled company', async () => fixture(async (db, cmd) => {
  await db.company.update({ where: { id: cmd.companyId }, data: { status: 'DISABLED' } });
  await db.companyPlanTerm.update({ where: { companyId: cmd.companyId }, data: { termDisabledAt: new Date() } });
  const prisma = { client: db } as any;
  const renew = new RenewCompanyPlanTermUseCase(prisma, new PartnerLifecycleTransitionUseCase(prisma));
  await renew.execute(cmd);
  await renew.execute(cmd);
  assert.equal((await db.company.findUniqueOrThrow({ where: { id: cmd.companyId } })).status, 'ACTIVE');
  assert.equal((await db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: cmd.companyId } })).renewCount, 1);
}));

test('PG01 R01 replay must finish activation after failure following the term commit', async () => fixture(async (db, cmd) => {
  await db.company.update({ where: { id: cmd.companyId }, data: { status: 'DISABLED' } });
  await db.companyPlanTerm.update({ where: { companyId: cmd.companyId }, data: { termDisabledAt: new Date() } });
  const prisma = { client: db } as any;
  const realLifecycle = new PartnerLifecycleTransitionUseCase(prisma);
  let calls = 0;
  const lifecycle = { execute: async (input: Parameters<typeof realLifecycle.execute>[0]) => {
    if (++calls === 1) throw new Error('injected lifecycle outage');
    return realLifecycle.execute(input);
  } };
  const renew = new RenewCompanyPlanTermUseCase(prisma, lifecycle as any);
  await assert.rejects(renew.execute(cmd), /injected lifecycle outage/);
  assert.equal((await db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: cmd.companyId } })).renewCount, 1);
  await renew.execute(cmd);
  const company = await db.company.findUniqueOrThrow({ where: { id: cmd.companyId } });
  assert.equal(company.status, 'ACTIVE', 'R01: committed renewal must not skip unfinished activation on replay');
}));

test('PG02 same requestId arriving concurrently must renew exactly once', { timeout: 20_000 }, async () => fixture(async (db, cmd) => {
  let arrived = 0;
  let release!: () => void;
  const bothRead = new Promise<void>(resolve => { release = resolve; });
  const prisma = { client: {
    company: db.company,
    companyPlanTerm: db.companyPlanTerm,
    $transaction: db.$transaction.bind(db),
    auditLog: { findFirst: async (args: Parameters<typeof db.auditLog.findFirst>[0]) => {
      const existing = await db.auditLog.findFirst(args);
      // Force the legitimate interleaving: both requests observe no SUCCESS audit.
      if (++arrived === 2) release();
      await bothRead;
      return existing;
    } },
  } } as any;
  const lifecycle = new PartnerLifecycleTransitionUseCase({ client: db } as any);
  const renew = new RenewCompanyPlanTermUseCase(prisma, lifecycle);
  await Promise.all([renew.execute(cmd), renew.execute(cmd)]);
  const term = await db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: cmd.companyId } });
  const audits = await db.auditLog.count({ where: { targetId: cmd.companyId, requestId: cmd.requestId, action: 'system.company_plan_term.renew' } });
  assert.deepEqual({ renewCount: term.renewCount, audits }, { renewCount: 1, audits: 1 }, 'concurrent replay must have one durable renewal');
}));

test('PG03 R03 a stale expiry batch must not disable a company renewed after selection', async () => fixture(async (db, cmd) => {
  const realPrisma = { client: db } as any;
  const lifecycle = new PartnerLifecycleTransitionUseCase(realPrisma);
  const renew = new RenewCompanyPlanTermUseCase(realPrisma, lifecycle);
  let renewed = false;
  const scopedPrisma = { client: {
    companyMembership: db.companyMembership,
    externalIdentity: db.externalIdentity,
    companyPlanTerm: {
      updateMany: db.companyPlanTerm.updateMany.bind(db.companyPlanTerm),
      findMany: async (args: any) => {
        // Keep the real SQL filters/updates, but the sweep may only select this fixture.
        const rows = await db.companyPlanTerm.findMany({ ...args, where: { ...args.where, companyId: cmd.companyId } });
        if (args.where.termEndsAt.lte && rows.length && !renewed) {
          renewed = true;
          await renew.execute(cmd);
        }
        return rows;
      },
    },
  } } as any;
  const sweep = new PlanTermSweepUseCase(scopedPrisma, lifecycle, { execute: async () => undefined } as any);
  const result = await sweep.execute(1);
  assert.equal(result.failures, 0, 'the simulated interleaving itself must not throw');
  assert.equal(renewed, true, 'a real renewal committed between SELECT and expiry transition');
  const term = await db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: cmd.companyId } });
  assert.ok(term.termEndsAt.getTime() > Date.now(), 'paid/manual renewed term is current');
  assert.equal((await db.company.findUniqueOrThrow({ where: { id: cmd.companyId } })).status, 'ACTIVE', 'R03: stale sweep disabled an already renewed company');
}));
