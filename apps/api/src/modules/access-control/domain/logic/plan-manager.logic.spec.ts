// Spec: docs/specs/mangmee-purchase-without-setup-spec-th.md §18.2 R-C11 (Owner D-PF-10).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_MANAGE_PERMISSION_KEY,
  canManagePlan,
  planManagerLineUserIds,
  planManagerRoleFilter,
  planManagersOf,
  type PlanManagerDb,
} from './plan-manager.logic';

describe('planManagerRoleFilter', () => {
  it('is the exact Prisma fragment assertOwner already enforces', () => {
    assert.deepEqual(planManagerRoleFilter(), {
      roles: { some: { role: { status: 'ACTIVE', permissions: { some: { permission: { key: PLAN_MANAGE_PERMISSION_KEY } } } } } },
    });
  });
});

describe('canManagePlan', () => {
  it('is false with no roles at all', () => {
    assert.equal(canManagePlan(undefined), false);
    assert.equal(canManagePlan(null), false);
    assert.equal(canManagePlan([]), false);
  });

  it('is false when the only role holding the permission is not ACTIVE', () => {
    const roles = [{ role: { status: 'INACTIVE', permissions: [{ permission: { key: 'company.plan.manage' } }] } }];
    assert.equal(canManagePlan(roles), false);
  });

  it('treats a missing status as ACTIVE, for callers that already filtered the query', () => {
    const roles = [{ role: { permissions: [{ permission: { key: 'company.plan.manage' } }] } }];
    assert.equal(canManagePlan(roles), true);
  });

  it('is false when the ACTIVE role holds a different permission', () => {
    const roles = [{ role: { status: 'ACTIVE', permissions: [{ permission: { key: 'company.expenses.manage' } }] } }];
    assert.equal(canManagePlan(roles), false);
  });

  it('is true for a custom-named role that carries the permission, same as OWNER', () => {
    const roles = [{ role: { status: 'ACTIVE', permissions: [{ permission: { key: 'company.expenses.manage' } }] } },
      { role: { status: 'ACTIVE', permissions: [{ permission: { key: 'company.plan.manage' } }] } }];
    assert.equal(canManagePlan(roles), true);
  });

  it('skips a null/undefined role entry rather than throwing', () => {
    assert.equal(canManagePlan([null, undefined, { role: null }]), false);
  });
});

function fakeDb(companyMembershipRows: Array<{ userId: string }>, externalIdentityRows?: Array<{ providerUserId: string }>) {
  const membershipQueries: any[] = [];
  const identityQueries: any[] = [];
  const db: PlanManagerDb = {
    companyMembership: {
      findMany: async (args: any) => { membershipQueries.push(args); return companyMembershipRows; },
    },
    ...(externalIdentityRows === undefined ? {} : {
      externalIdentity: {
        findMany: async (args: any) => { identityQueries.push(args); return externalIdentityRows; },
      },
    }),
  };
  return { db, membershipQueries, identityQueries };
}

describe('planManagersOf', () => {
  it('asks for ACTIVE members of an ACTIVE user, gated by the plan-manage permission — not the OWNER role key', async () => {
    const h = fakeDb([{ userId: 'user-1' }]);
    const result = await planManagersOf(h.db, 'co-1');

    assert.deepEqual(result, [{ userId: 'user-1' }]);
    assert.deepEqual(h.membershipQueries[0], {
      where: {
        companyId: 'co-1',
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        roles: { some: { role: { status: 'ACTIVE', permissions: { some: { permission: { key: 'company.plan.manage' } } } } } },
      },
      select: { userId: true },
    });
    assert.equal(JSON.stringify(h.membershipQueries[0].where).includes('OWNER'), false);
  });

  it('works on a plain prisma.client or a transaction client (structural, not a Nest provider)', async () => {
    // No decorator, no constructor injection to fake — just an object shaped like the delegate.
    const tx = fakeDb([]).db;
    assert.deepEqual(await planManagersOf(tx, 'co-1'), []);
  });
});

describe('planManagerLineUserIds', () => {
  it('dedupes a manager who holds more than one LINE identity row', async () => {
    const h = fakeDb(
      [{ userId: 'user-1' }, { userId: 'user-2' }],
      [{ providerUserId: 'Uabc' }, { providerUserId: 'Uabc' }, { providerUserId: 'Udef' }],
    );
    const result = await planManagerLineUserIds(h.db, 'co-1', 'channel-1');

    assert.deepEqual(result.sort(), ['Uabc', 'Udef']);
    assert.deepEqual(h.identityQueries[0].where, {
      userId: { in: ['user-1', 'user-2'] }, provider: 'LINE', providerChannelId: 'channel-1', status: 'ACTIVE',
    });
  });

  it('answers [] without ever asking for identities when nobody may manage the plan', async () => {
    const h = fakeDb([], []);
    const result = await planManagerLineUserIds(h.db, 'co-1', 'channel-1');

    assert.deepEqual(result, []);
    assert.equal(h.identityQueries.length, 0, 'no manager means nothing to look up');
  });

  it('answers [] when the delegate carries no externalIdentity model (sibling of ownerLineUserIds\' shape)', async () => {
    const h = fakeDb([{ userId: 'user-1' }], undefined);
    assert.deepEqual(await planManagerLineUserIds(h.db, 'co-1', 'channel-1'), []);
  });
});
