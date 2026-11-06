import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlanTermSweepUseCase } from './plan-term-sweep.use-case';
import { DAY_MS } from '../../domain/logic/plan-term.logic';

type Row = {
  companyId: string;
  companyName: string;
  companyStatus: string;
  reportClassification?: string;
  termEndsAt: Date;
  termStartAt?: Date;
  renewCount?: number;
  warningDays?: number;
  warn7SentAt?: Date | null;
  warn3SentAt?: Date | null;
  warn1SentAt?: Date | null;
  expiredNotifiedAt?: Date | null;
  termDisabledAt?: Date | null;
};

/**
 * The fake models the two things the sweep's correctness rests on: the `where` clauses actually
 * filter (so "skips non-ACTIVE" is a real result, not a stub), and `updateMany` behaves as a
 * compare-and-set (so exactly-once is a real result too).
 */
function makeWorld(rows: Row[], opts: { owners?: string[]; admins?: Array<{ companyId: string; userId: string }>; billingMode?: 'disabled' | 'test' | 'live' } = {}) {
  const state = rows.map((row) => ({
    // Epoch keeps termEndsAt > termStartAt for every existing fixture, so the default reads as a
    // real (trial_ended) term unless a test sets termStartAt itself to model a no-package term.
    termStartAt: new Date(0), renewCount: 0,
    warningDays: 7, warn7SentAt: null, warn3SentAt: null, warn1SentAt: null,
    expiredNotifiedAt: null, termDisabledAt: null, ...row,
  }));
  const owners = opts.owners ?? ['owner-1'];
  const admins = opts.admins ?? [{ companyId: 'sys-co', userId: 'admin-1' }];

  const matches = (row: typeof state[number], where: any, now: Date): boolean => {
    if (where.company?.status && row.companyStatus !== where.company.status) return false;
    if (where.company?.OR && row.reportClassification === 'DEMO') return false;
    if (where.company?.reportClassification && row.reportClassification !== where.company.reportClassification) return false;
    if (where.termEndsAt?.lte && row.termEndsAt > where.termEndsAt.lte) return false;
    if (where.termEndsAt?.gt && row.termEndsAt <= where.termEndsAt.gt) return false;
    void now;
    return true;
  };

  const prisma = {
    client: {
      $queryRaw: async () => [],
      company: { findUnique: async () => null },
      attachmentObject: { findMany: async () => [] },
      companyPlanTerm: {
        findUnique: async ({ where }: any) => {
          const row = state.find(item => item.companyId === where.companyId);
          return row ? { ...row, company: { name: row.companyName, status: row.companyStatus, reportClassification: row.reportClassification } } : null;
        },
        update: async ({ where, data }: any) => {
          const row = state.find(item => item.companyId === where.companyId)!;
          Object.assign(row, data); return row;
        },
        findMany: async ({ where, take }: any) =>
          state
            .filter((row) => matches(row, where, new Date()))
            .slice(0, take)
            .map((row) => ({ ...row, company: { name: row.companyName } })),
        updateMany: async ({ where, data }: any) => {
          const row = state.find((item) => item.companyId === where.companyId);
          if (!row) return { count: 0 };
          // CAS: every non-id key in `where` must still hold.
          for (const [key, value] of Object.entries(where)) {
            if (key === 'companyId') continue;
            if ((row as any)[key] !== value) return { count: 0 };
          }
          Object.assign(row, data);
          return { count: 1 };
        },
      },
      companyMembership: {
        findMany: async ({ where }: any) => {
          // R-C11: the recipient lookup now asks for the plan-manage PERMISSION, not the OWNER role key.
          const wantsManagers = JSON.stringify(where.roles ?? {}).includes('company.plan.manage');
          if (wantsManagers) return owners.map((userId) => ({ userId }));
          return admins.map((admin) => ({ companyId: admin.companyId, userId: admin.userId }));
        },
      },
    },
  } as any;

  prisma.client.$transaction = async (fn: any) => {
    const before = structuredClone(state);
    try { return await fn(prisma.client); } catch (error) {
      state.splice(0, state.length, ...before); throw error;
    }
  };

  const lifecycle = { calls: [] as any[], execute: async (cmd: any) => {
    lifecycle.calls.push(cmd);
    const row = state.find((item) => item.companyId === cmd.companyId);
    if (row) row.companyStatus = cmd.targetStatus;
    return { id: cmd.companyId, status: cmd.targetStatus };
  } } as any;

  const notifications = { calls: [] as any[], execute: async (input: any) => {
    notifications.calls.push(input);
    return { skipped: false };
  } } as any;

  notifications.executeInTransaction = notifications.execute;

  return { prisma, lifecycle, notifications, state, sweep: new PlanTermSweepUseCase(prisma, lifecycle, notifications, { billingMode: opts.billingMode ?? 'disabled' } as any) };
}

const past = (days: number) => new Date(Date.now() - days * DAY_MS);
const future = (days: number) => new Date(Date.now() + days * DAY_MS);

describe('PlanTermSweepUseCase — expiry', () => {
  it('disables an ACTIVE company past its deadline through the lifecycle use-case', async () => {
    const world = makeWorld([{ companyId: 'co-1', companyName: 'ร้านหนึ่ง', companyStatus: 'ACTIVE', termEndsAt: past(1) }]);
    const result = await world.sweep.execute();

    assert.equal(result.expired, 1);
    assert.equal(result.failures, 0);
    assert.equal(world.lifecycle.calls.length, 1);
    assert.equal(world.lifecycle.calls[0].targetStatus, 'DISABLED');
    assert.equal(world.lifecycle.calls[0].reason, 'term_expired');
    assert.equal(world.lifecycle.calls[0].requestingAdminUserId, null, 'no human actor; FK would reject a synthetic id');
    assert.ok(world.state[0].termDisabledAt instanceof Date);
    assert.ok(world.state[0].expiredNotifiedAt instanceof Date);
  });

  it('disables a zero-day no-package term as "no_package" and sends no notification', async () => {
    const zeroDayEnd = past(0);
    const world = makeWorld([{
      companyId: 'co-nopkg', companyName: 'ร้านใหม่', companyStatus: 'ACTIVE',
      termEndsAt: zeroDayEnd, termStartAt: zeroDayEnd, renewCount: 0,
    }]);
    const result = await world.sweep.execute();

    assert.equal(result.expired, 1);
    assert.equal(world.lifecycle.calls.length, 1);
    assert.equal(world.lifecycle.calls[0].reason, 'no_package');
    assert.equal(world.state[0].companyStatus, 'DISABLED');
    assert.ok(world.state[0].termDisabledAt instanceof Date);
    assert.ok(world.state[0].expiredNotifiedAt instanceof Date);
    assert.equal(world.notifications.calls.length, 0, 'never had a package, so no "ครบกำหนด" notice');
  });

  it('is idempotent: a second pass finds nothing and notifies nobody again', async () => {
    const world = makeWorld([{ companyId: 'co-1', companyName: 'ร้านหนึ่ง', companyStatus: 'ACTIVE', termEndsAt: past(1) }]);
    await world.sweep.execute();
    const notifiedOnce = world.notifications.calls.length;

    const second = await world.sweep.execute();
    assert.equal(second.expired, 0);
    assert.equal(world.lifecycle.calls.length, 1);
    assert.equal(world.notifications.calls.length, notifiedOnce);
  });

  it('SKIPS a company that is not ACTIVE — admin-disabled, suspended and archived are untouched', async () => {
    const world = makeWorld([
      { companyId: 'co-disabled', companyName: 'a', companyStatus: 'DISABLED', termEndsAt: past(1) },
      { companyId: 'co-suspended', companyName: 'b', companyStatus: 'SUSPENDED', termEndsAt: past(1) },
      { companyId: 'co-archived', companyName: 'c', companyStatus: 'ARCHIVED', termEndsAt: past(1) },
    ]);
    const result = await world.sweep.execute();

    assert.equal(result.expired, 0);
    assert.equal(world.lifecycle.calls.length, 0);
    assert.equal(world.notifications.calls.length, 0);
    assert.deepEqual(world.state.map((row) => row.termDisabledAt ?? null), [null, null, null]);
  });

  it('finishes a legacy half-done expiry and reconciles its durable notice', async () => {
    const world = makeWorld([{
      companyId: 'co-1', companyName: 'ร้านหนึ่ง', companyStatus: 'ACTIVE',
      termEndsAt: past(1), expiredNotifiedAt: past(1),
    }]);
    const result = await world.sweep.execute();

    assert.equal(result.expired, 1);
    assert.equal(world.lifecycle.calls.length, 1, 'the interrupted transition is completed');
    assert.equal(world.notifications.calls.length, 2, 'reconcile owner/admin event; event dedupe belongs to the notification use case');
  });

  it('one company failing never aborts the batch', async () => {
    const world = makeWorld([
      { companyId: 'co-bad', companyName: 'a', companyStatus: 'ACTIVE', termEndsAt: past(2) },
      { companyId: 'co-good', companyName: 'b', companyStatus: 'ACTIVE', termEndsAt: past(1) },
    ]);
    world.lifecycle.execute = async (cmd: any) => {
      if (cmd.companyId === 'co-bad') throw new Error('boom');
      return { id: cmd.companyId, status: cmd.targetStatus };
    };
    const result = await world.sweep.execute();
    assert.equal(result.failures, 1);
    assert.equal(result.expired, 1);
  });

  it('notifies the plan managers on WEB and LINE plus the System Admin dashboard, with the Thai copy', async () => {
    const world = makeWorld([{ companyId: 'co-1', companyName: 'ร้านหนึ่ง', companyStatus: 'ACTIVE', termEndsAt: past(1) }]);
    await world.sweep.execute();

    assert.equal(world.notifications.calls.length, 2);
    const [ownerEvent, adminEvent] = world.notifications.calls;
    assert.equal(ownerEvent.companyId, 'co-1');
    assert.equal(ownerEvent.triggerKey, 'plan_term_expired');
    assert.equal(ownerEvent.severity, 'critical');
    assert.equal(ownerEvent.title, 'แพ็กเกจหมดอายุแล้ว');
    assert.deepEqual(ownerEvent.recipientUserIds, ['owner-1']);
    assert.match(ownerEvent.body, /ข้อมูลทั้งหมดยังอยู่ครบ/);
    assert.match(ownerEvent.body, /098-256-5628/);
    // The admin event belongs to the ADMIN's company but points at the affected one.
    assert.equal(adminEvent.companyId, 'sys-co');
    assert.equal(adminEvent.sourceId, 'co-1');
    assert.equal(adminEvent.deepLinkHref, '/system/partners/co-1');
  });

  // R-C11 (D-PF-10): a custom role granted company.plan.manage must get this notice exactly like
  // OWNER — proven here at the query shape, since the fake cannot otherwise distinguish "OWNER" from
  // "a role with the permission" once the code stops asking for the role key at all.
  it('asks for the plan-manage permission, not the OWNER role key, when finding who to notify', async () => {
    const world = makeWorld([{ companyId: 'co-1', companyName: 'ร้านหนึ่ง', companyStatus: 'ACTIVE', termEndsAt: past(1) }]);
    const queries: any[] = [];
    const original = world.prisma.client.companyMembership.findMany;
    world.prisma.client.companyMembership.findMany = async (args: any) => { queries.push(args); return original(args); };

    await world.sweep.execute();

    const managerQuery = queries.find((args) => JSON.stringify(args.where.roles ?? {}).includes('company.plan.manage'));
    assert.ok(managerQuery, 'the recipient lookup filters by the plan-manage permission');
    assert.equal(JSON.stringify(managerQuery.where.roles).includes('"OWNER"'), false, 'no longer gated on the OWNER role key');
  });
});

describe('PlanTermSweepUseCase — owner self-service route', () => {
  for (const [state, termEndsAt] of [['warning', future(3)], ['expired', past(1)]] as const) {
    it(`links a ${state} owner directly to billing when self-service is enabled`, async () => {
      const world = makeWorld([{ companyId: 'co-1', companyName: 'ร้านหนึ่ง', companyStatus: 'ACTIVE', termEndsAt }], { billingMode: 'test' });
      await world.sweep.execute();
      const [owner, admin] = world.notifications.calls;
      assert.match(owner.body, /เลือกแพ็กเกจได้เองในเว็บแอปค่ะ/);
      assert.doesNotMatch(owner.body, /พิมพ์.*ขอเปลี่ยนแพ็กเกจ|ทีมงานจะติดต่อกลับ/);
      assert.equal(owner.deepLinkHref, '/companies/co-1/billing');
      assert.equal(admin.deepLinkHref, '/system/partners/co-1');
    });
  }

  it('keeps the contact route when billing is disabled', async () => {
    const world = makeWorld([{ companyId: 'co-1', companyName: 'ร้านหนึ่ง', companyStatus: 'ACTIVE', termEndsAt: future(3) }]);
    await world.sweep.execute();
    const owner = world.notifications.calls[0];
    assert.doesNotMatch(owner.body, /ได้เองในเว็บแอป/);
    assert.match(owner.body, /ติดต่อ 098-256-5628/);
    assert.equal(owner.deepLinkHref, '/companies/co-1/dashboard');
  });
});

describe('PlanTermSweepUseCase — warning ladder', () => {
  it('fires 7, then 3, then 1 — each exactly once', async () => {
    const endsAt = future(7);
    const world = makeWorld([{ companyId: 'co-1', companyName: 'ร้านหนึ่ง', companyStatus: 'ACTIVE', termEndsAt: endsAt }]);

    assert.equal((await world.sweep.execute()).warned, 1);
    assert.ok(world.state[0].warn7SentAt);
    // Same window again: nothing more to say.
    assert.equal((await world.sweep.execute()).warned, 0);
    assert.equal(world.notifications.calls.length, 2); // owner + admin, once

    world.state[0].termEndsAt = future(3);
    assert.equal((await world.sweep.execute()).warned, 1);
    assert.ok(world.state[0].warn3SentAt);
    assert.equal((await world.sweep.execute()).warned, 0);

    world.state[0].termEndsAt = future(1);
    assert.equal((await world.sweep.execute()).warned, 1);
    assert.ok(world.state[0].warn1SentAt);
    assert.equal((await world.sweep.execute()).warned, 0);

    assert.equal(world.notifications.calls.length, 6); // 3 points x (owner + admin)
  });

  it('a renew that clears the flags lets the next term warn again', async () => {
    const world = makeWorld([{ companyId: 'co-1', companyName: 'ร้านหนึ่ง', companyStatus: 'ACTIVE', termEndsAt: future(3) }]);
    await world.sweep.execute();
    assert.ok(world.state[0].warn3SentAt);

    // What RenewCompanyPlanTermUseCase writes.
    Object.assign(world.state[0], { termEndsAt: future(3), warn7SentAt: null, warn3SentAt: null, warn1SentAt: null });
    assert.equal((await world.sweep.execute()).warned, 1);
  });

  it('does not warn outside the 7-day window, and never warns a non-ACTIVE company', async () => {
    const world = makeWorld([
      { companyId: 'co-far', companyName: 'a', companyStatus: 'ACTIVE', termEndsAt: future(30) },
      { companyId: 'co-off', companyName: 'b', companyStatus: 'DISABLED', termEndsAt: future(2) },
    ]);
    assert.equal((await world.sweep.execute()).warned, 0);
    assert.equal(world.notifications.calls.length, 0);
  });

  it('warning copy carries the deadline and the days left', async () => {
    const world = makeWorld([{ companyId: 'co-1', companyName: 'ร้านหนึ่ง', companyStatus: 'ACTIVE', termEndsAt: future(3) }]);
    await world.sweep.execute();
    const ownerEvent = world.notifications.calls[0];
    assert.equal(ownerEvent.triggerKey, 'plan_term_expiring');
    assert.equal(ownerEvent.severity, 'action');
    assert.equal(ownerEvent.title, 'แพ็กเกจใกล้หมดอายุ');
    assert.match(ownerEvent.body, /^แพ็กเกจของร้านหนึ่ง จะหมดอายุวันที่ /);
    assert.match(ownerEvent.body, /\(อีก 3 วัน\)/);
  });

  it('a company with an owner-less membership set still stamps, and only tells the admin', async () => {
    const world = makeWorld(
      [{ companyId: 'co-1', companyName: 'a', companyStatus: 'ACTIVE', termEndsAt: future(1) }],
      { owners: [] },
    );
    assert.equal((await world.sweep.execute()).warned, 1);
    assert.equal(world.notifications.calls.length, 1);
    assert.equal(world.notifications.calls[0].companyId, 'sys-co');
  });
});

describe('PlanTermSweepUseCase — grandfathered companies', () => {
  it('a company with no CompanyPlanTerm row is never selected by either pass', async () => {
    // No rows at all is exactly how a company without a term reads through both queries.
    const world = makeWorld([]);
    const result = await world.sweep.execute();
    assert.deepEqual(result, { expired: 0, warned: 0, purged: 0, failures: 0 });
    assert.equal(world.lifecycle.calls.length, 0);
    assert.equal(world.notifications.calls.length, 0);
  });
});


describe('DEMO plan term sweep', () => {
  it('sends no 7/3/1-day warnings and disables the demo at expiry without outbound notices', async () => {
    const now = new Date();
    const world = makeWorld([1, 3, 7].map(days => ({ companyId: `demo-${days}`, companyName: 'ร้านตัวอย่าง', companyStatus: 'ACTIVE',
      reportClassification: 'DEMO', termEndsAt: new Date(now.getTime() + days * DAY_MS) })));
    assert.deepEqual(await world.sweep.execute(), { expired: 0, warned: 0, purged: 0, failures: 0 });
    assert.equal(world.notifications.calls.length, 0);
    for (const row of world.state) row.termEndsAt = new Date(Date.now() - 1);
    const expired = await world.sweep.execute();
    assert.deepEqual(expired, { expired: 3, warned: 0, purged: 0, failures: 0 });
    assert.ok(world.state.every(row => row.companyStatus === 'DISABLED'));
    assert.equal(world.notifications.calls.length, 0);
  });
});
