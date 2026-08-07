import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionSet } from './domain/models/resolved-access.model';
import { PermissionResolverService } from './application/permission-resolver.service';
import { PrismaPermissionResolverRepository } from './infrastructure/prisma-permission-resolver.repository';
import type { IPermissionResolverPort, ResolvedAccess } from './domain/ports/permission-resolver.port';

const mockResolved: ResolvedAccess = {
  membershipId: 'm1',
  companyId: 'c1',
  roles: ['OWNER'],
  permissions: ['account.session.read', 'admin.user.read'],
  scopes: {},
};

const mockPort: IPermissionResolverPort = {
  resolveForUser: async () => mockResolved,
};

describe('PermissionSet', () => {
  const ps = new PermissionSet(['account.session.read', 'admin.user.read']);

  it('has() returns true for known key', () => {
    assert.equal(ps.has('account.session.read'), true);
  });

  it('has() returns false for unknown key', () => {
    assert.equal(ps.has('unknown.perm'), false);
  });

  it('hasAll() returns false when one key is missing', () => {
    assert.equal(ps.hasAll(['account.session.read', 'missing.key']), false);
  });

  it('hasAll() returns true when all keys present', () => {
    assert.equal(ps.hasAll(['account.session.read', 'admin.user.read']), true);
  });

  it('toArray() returns deduped list', () => {
    const ps2 = new PermissionSet(['a', 'b', 'a']);
    assert.deepEqual(ps2.toArray(), ['a', 'b']);
  });
});

describe('PermissionResolverService', () => {
  it('delegates to port and returns resolved access with correct shape', async () => {
    const service = new PermissionResolverService(mockPort);
    const result = await service.resolveAccess('u1', 'c1');
    assert.equal(result.membershipId, 'm1');
    assert.equal(result.companyId, 'c1');
    assert.deepEqual(result.roles, ['OWNER']);
    assert.ok(result.permissions.includes('account.session.read'));
  });
});

function makeMembership(extra: Record<string, unknown> = {}) {
  return {
    id: 'mem-1',
    companyId: 'co-1',
    branchScopeMode: 'ALL_BRANCHES',
    defaultBranchId: null,
    roles: [
      {
        role: {
          key: 'MANAGER',
          permissions: [{ permission: { key: 'company.branch.read' } }],
        },
      },
    ],
    branchScopes: [],
    company: { status: 'ACTIVE' }, // required by company-status check (item 10A bug fix)
    ...extra,
  };
}

function makePrismaResolver(
  membership: Record<string, unknown>,
  activeBranchIds: string[] = [],
  entitlements: Array<{ featureKey: string; enabled: boolean }> = [],
) {
  const prisma = {
    client: {
      companyMembership: {
        findFirst: mock.fn(async () => membership),
      },
      branch: {
        findMany: mock.fn(async () => activeBranchIds.map((id) => ({ id }))),
      },
      companyFeatureEntitlement: {
        findMany: mock.fn(async () => entitlements),
      },
    },
  } as any;
  return { resolver: new PrismaPermissionResolverRepository(prisma), prisma };
}

describe('PrismaPermissionResolverRepository branch scopes', () => {
  it('leaves branchIds undefined for ALL_BRANCHES', async () => {
    const { resolver } = makePrismaResolver(makeMembership());
    const result = await resolver.resolveForUser({ userId: 'u-1', companyId: 'co-1' });
    assert.deepEqual(result.scopes, {});
  });

  it('prefers SYSTEM_ADMIN membership when companyId is absent', async () => {
    const customerMembership = makeMembership({
      id: 'mem-customer',
      companyId: 'customer-co',
    });
    const systemMembership = makeMembership({
      id: 'mem-system',
      companyId: 'seed-watchdog-system-company',
      roles: [
        {
          role: {
            key: 'SYSTEM_ADMIN',
            permissions: [{ permission: { key: 'system.partner_dashboard.read' } }],
          },
        },
      ],
    });
    const prisma = {
      client: {
        companyMembership: {
          findFirst: mock.fn(async (args: any) =>
            args.where.roles?.some?.role?.key === 'SYSTEM_ADMIN' ? systemMembership : customerMembership,
          ),
        },
        branch: { findMany: mock.fn(async () => []) },
        companyFeatureEntitlement: { findMany: mock.fn(async () => []) },
      },
    } as any;
    const resolver = new PrismaPermissionResolverRepository(prisma);

    const result = await resolver.resolveForUser({ userId: 'u-1' });

    assert.equal(result.membershipId, 'mem-system');
    assert.deepEqual(result.roles, ['SYSTEM_ADMIN']);
    assert.ok(result.permissions.includes('system.partner_dashboard.read'));
  });

  it('only considers memberships in active companies when companyId is absent', async () => {
    const membership = makeMembership();
    const calls: any[] = [];
    const prisma = {
      client: {
        companyMembership: {
          findFirst: mock.fn(async (args: any) => {
            calls.push(args);
            return args.where.roles ? null : membership;
          }),
        },
        branch: { findMany: mock.fn(async () => []) },
        companyFeatureEntitlement: { findMany: mock.fn(async () => []) },
      },
    } as any;

    await new PrismaPermissionResolverRepository(prisma).resolveForUser({ userId: 'u-1' });

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].where.company, { status: 'ACTIVE' });
    assert.deepEqual(calls[1].where.company, { status: 'ACTIVE' });
  });

  it('returns active selected branch ids for SELECTED_BRANCHES', async () => {
    const { resolver } = makePrismaResolver(
      makeMembership({
        branchScopeMode: 'SELECTED_BRANCHES',
        branchScopes: [{ branchId: 'b-1' }, { branchId: 'b-2' }],
      }),
      ['b-1'],
    );
    const result = await resolver.resolveForUser({ userId: 'u-1', companyId: 'co-1' });
    assert.deepEqual(result.scopes, { branchIds: ['b-1'] });
  });

  it('returns default branch id for DEFAULT_BRANCH_ONLY', async () => {
    const { resolver } = makePrismaResolver(makeMembership({
      branchScopeMode: 'DEFAULT_BRANCH_ONLY',
      defaultBranchId: 'b-default',
    }));
    const result = await resolver.resolveForUser({ userId: 'u-1', companyId: 'co-1' });
    assert.deepEqual(result.scopes, { branchIds: ['b-default'] });
  });
});

describe('PrismaPermissionResolverRepository feature entitlement gating (item 10A AC-FE-2)', () => {
  // OWNER-style grant crossing several features + core + report catalog
  const wideMembership = () => makeMembership({
    roles: [
      {
        role: {
          key: 'OWNER',
          permissions: [
            { permission: { key: 'dashboard.read' } },          // dashboard_notifications feature
            { permission: { key: 'expense.read' } },            // expenses feature
            { permission: { key: 'inventory.product.read' } },  // inventory feature
            { permission: { key: 'report.catalog.read' } },     // reports feature (prefix rule)
          ],
        },
      },
    ],
  });

  it('keeps all permissions when the company has no entitlement rows (legacy fail-open)', async () => {
    const { resolver } = makePrismaResolver(wideMembership(), [], []);
    const result = await resolver.resolveForUser({ userId: 'u-1', companyId: 'co-1' });
    assert.deepEqual(result.permissions, ['dashboard.read', 'expense.read', 'inventory.product.read', 'report.catalog.read']);
    assert.deepEqual(result.entitlementDeniedPermissions, {});
  });

  it('strips disabled-feature permissions (including OWNER grants) once entitlements are configured', async () => {
    const { resolver } = makePrismaResolver(wideMembership(), [], [
      { featureKey: 'dashboard_notifications', enabled: false },
      { featureKey: 'expenses', enabled: true },
      { featureKey: 'inventory', enabled: false },
      { featureKey: 'reports', enabled: false },
    ]);
    const result = await resolver.resolveForUser({ userId: 'u-1', companyId: 'co-1' });
    assert.deepEqual(result.permissions, ['expense.read']);
    assert.deepEqual(result.entitlementDeniedPermissions, {
      'dashboard.read': 'dashboard_notifications',
      'inventory.product.read': 'product_catalog',
      'report.catalog.read': 'reports',
    });
  });

  it('restores permissions when the feature is toggled back on', async () => {
    const { resolver } = makePrismaResolver(wideMembership(), [], [
      { featureKey: 'dashboard_notifications', enabled: true },
      { featureKey: 'expenses', enabled: true },
      { featureKey: 'inventory', enabled: true },
      { featureKey: 'reports', enabled: true },
    ]);
    const result = await resolver.resolveForUser({ userId: 'u-1', companyId: 'co-1' });
    assert.deepEqual(result.permissions, ['dashboard.read', 'expense.read', 'inventory.product.read', 'report.catalog.read']);
    assert.deepEqual(result.entitlementDeniedPermissions, {});
  });
});
