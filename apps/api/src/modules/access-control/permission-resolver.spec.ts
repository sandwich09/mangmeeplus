import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { TIER_FEATURE_PRESETS, hasAiSuggestionSourceAccess } from '@watchdog-bms/contracts';
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
          status: 'ACTIVE',
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
      company: { findUnique: async () => null },
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
  it('every sold tier reports no askable AI source while a CRM-enabled package can offer one', async () => {
    for (const [tier, features] of Object.entries(TIER_FEATURE_PRESETS)) {
      const { resolver } = makePrismaResolver(makeMembership(), [], features.map(featureKey => ({ featureKey, enabled: true })));
      const result = await resolver.resolveForUser({ userId: 'u', companyId: 'co' });
      assert.equal(hasAiSuggestionSourceAccess(result.availablePermissions ?? []), false, tier);
    }
    const { resolver } = makePrismaResolver(makeMembership(), [], [{ featureKey: 'crm', enabled: true }]);
    assert.equal(hasAiSuggestionSourceAccess((await resolver.resolveForUser({ userId: 'u', companyId: 'co' })).availablePermissions ?? []), true);
  });

  it('exposes package-available permissions independently of the reader role for refusal explanations', async () => {
    const { resolver } = makePrismaResolver(makeMembership(), [], [{ featureKey: 'expenses', enabled: true }]);
    const result = await resolver.resolveForUser({ userId: 'u', companyId: 'co' });
    assert.ok(result.availablePermissions?.includes('expense.read'));
    assert.ok(!result.permissions.includes('expense.read'));
    for (const key of ['bank.cash.read', 'crm.customer.read', 'inventory.report.read', 'tax.review_issue.read', 'workflow.task.read']) assert.ok(!result.availablePermissions?.includes(key), key);
  });

  it('distinguishes a disabled or suspended shop membership from missing access', async () => {
    for (const status of ['DISABLED', 'SUSPENDED']) {
      const prisma = { client: { companyMembership: { findFirst: async ({ where }: any) => {
        assert.equal(where.userId, 'u'); assert.equal(where.companyId, 'co');
        return where.status?.in?.includes(status) ? { id: 'm', status } : null;
      } } } } as any;
      await assert.rejects(() => new PrismaPermissionResolverRepository(prisma).resolveForUser({ userId: 'u', companyId: 'co' }),
        (error: any) => error.getResponse().code === 'company_membership_disabled');
    }
  });

  it('does not turn a platform role or an inactive/missing company membership into company access', async () => {
    const { resolver, prisma } = makePrismaResolver(null as any);
    await assert.rejects(() => resolver.resolveForUser({ userId: 'platform-user', companyId: 'other-company' }), /No active company membership/);
    assert.deepEqual(prisma.client.companyMembership.findFirst.mock.calls[0].arguments[0].where,
      { userId: 'platform-user', companyId: 'other-company', status: 'ACTIVE' });
    const suspended = makePrismaResolver(makeMembership({ company: { status: 'SUSPENDED' } }));
    await assert.rejects(() => suspended.resolver.resolveForUser({ userId: 'u-1', companyId: 'co-1' }), /Company is not active/);
  });

  it('names company_term_expired only for a company DISABLED by its own term, not a plain suspension', async () => {
    const termExpired = makePrismaResolver(makeMembership({
      company: { status: 'DISABLED', planTerm: { termDisabledAt: new Date() } },
    }));
    await assert.rejects(
      () => termExpired.resolver.resolveForUser({ userId: 'u-1', companyId: 'co-1' }),
      (error: unknown) => {
        assert.ok(error instanceof ForbiddenException);
        assert.equal((error.getResponse() as any).code, 'company_term_expired');
        return true;
      },
    );
    // DISABLED without a term hold (a manual admin suspension) is not this case: same plain
    // message as SUSPENDED above, no code for the web to redirect on.
    const disabledNoTerm = makePrismaResolver(makeMembership({
      company: { status: 'DISABLED', planTerm: null },
    }));
    await assert.rejects(() => disabledNoTerm.resolver.resolveForUser({ userId: 'u-1', companyId: 'co-1' }), /Company is not active/);
  });

  it('AX02 excludes disabled roles and their grants after a membership is reactivated', async () => {
    const membership = makeMembership({ roles: [
      { role: { key: 'STAFF', status: 'ACTIVE', permissions: [{ permission: { key: 'expense.read_own' } }] } },
      { role: { key: 'OLD_MANAGER', status: 'DISABLED', permissions: [{ permission: { key: 'expense.read' } }] } },
    ] });
    const { resolver } = makePrismaResolver(membership);
    const result = await resolver.resolveForUser({ userId: 'u-1', companyId: 'co-1' });
    assert.deepEqual(result.roles, ['STAFF']);
    assert.deepEqual(result.permissions, ['expense.read_own']);
    assert.deepEqual(result.entitlementDeniedPermissions, {}, 'disabled role is not a package denial');
  });

  it('AX02 an active membership with only a disabled role gains no effective authority', async () => {
    const { resolver } = makePrismaResolver(makeMembership({ roles: [
      { role: { key: 'STALE_OWNER', status: 'DISABLED', permissions: [{ permission: { key: 'system.partner.update' } }] } },
    ] }));
    const result = await resolver.resolveForUser({ userId: 'u-1', companyId: 'co-1' });
    assert.deepEqual(result.roles, []);
    assert.deepEqual(result.permissions, []);
  });

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
            status: 'ACTIVE',
            permissions: [{ permission: { key: 'system.partner_dashboard.read' } }],
          },
        },
      ],
    });
    const prisma = {
      client: {
        company: { findUnique: async () => null },
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
        company: { findUnique: async () => null },
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
          status: 'ACTIVE',
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


describe('free policy and platform recovery', () => {
  it('keeps SYSTEM_ADMIN console access independent from customer free-policy evidence', async () => {
    const { resolver, prisma } = makePrismaResolver(makeMembership({ roles: [{ role: { key: 'SYSTEM_ADMIN', status: 'ACTIVE',
      permissions: [{ permission: { key: 'system.partner_dashboard.read' } }] } }] }));
    prisma.client.company.findUnique = async () => { throw new Error('customer history unavailable'); };
    const result = await resolver.resolveForUser({ userId: 'admin', companyId: 'co-1' });
    assert.ok(result.permissions.includes('system.partner_dashboard.read'));
    assert.equal(result.freeExpenseDrafts, undefined);
  });
});

describe('free expense source access', () => {
  it('resolves term-disabled membership without broad recovery and intersects branch/grants', async () => {
    const term = { tierKey: 'FREE_TRIAL_15', termEndsAt: new Date(0), termDisabledAt: new Date(0), billingReceiptAccountId: null, capacityOverride: null };
    const membership = makeMembership({ company: { status: 'DISABLED', planTerm: term },
      branchScopeMode: 'SELECTED_BRANCHES', branchScopes: [{ branchId: 'branch-1' }],
      roles: [{ role: { key: 'OWNER', status: 'ACTIVE', permissions: ['account.session.read', 'expense.update', 'expense.confirm', 'expense.create', 'expense.review', 'expense.receipt.upload'].map(key => ({ permission: { key } })) } }],
    });
    const { resolver, prisma } = makePrismaResolver(membership, ['branch-1']);
    Object.assign(prisma.client, {
      company: { findUnique: async () => ({ status: 'DISABLED', disabledAt: new Date(0), archivedAt: null, planTerm: term }) },
      auditLog: { findFirst: async () => ({ actorUserId: null, metadataJson: { toStatus: 'DISABLED', reason: 'no_package' } }) },
      billingAccount: { findMany: async () => [] }, billingInvoice: { findFirst: async () => null },
      billingReceiptGrant: { findFirst: async () => null }, packageChangeRequest: { findFirst: async () => null }, salesAttribution: { findUnique: async () => null },
    });
    const access = await resolver.resolveForUser({ userId: 'u-1', companyId: 'co-1' });
    assert.equal(access.freeExpenseDrafts, true);
    assert.deepEqual(access.permissions, ['account.session.read', 'expense.update', 'expense.receipt.upload']);
    assert.deepEqual(access.scopes, { branchIds: ['branch-1'] });
    prisma.client.companyFeatureEntitlement.findMany = async () => [{ featureKey: 'expenses', enabled: false }];
    const denied = await resolver.resolveForUser({ userId: 'u-1', companyId: 'co-1' });
    assert.equal(denied.freeExpenseDrafts, true);
    assert.equal(denied.permissions.includes('expense.receipt.upload'), false, 'explicit feature deny remains authoritative');
  });
});

describe('DEMO request context projection', () => {
  it('resolves DEMO and its exact plan expiry, leaving CUSTOMER metadata absent', async () => {
    const expiresAt = new Date('2026-11-09T01:02:03.456Z');
    for (const classification of ['DEMO', 'CUSTOMER']) {
      const { resolver } = makePrismaResolver(makeMembership({ company: { status: 'ACTIVE', reportClassification: classification, planTerm: { termEndsAt: expiresAt } } }));
      const resolved = await resolver.resolveForUser({ userId: 'owner', companyId: 'co-1' });
      assert.equal(resolved.isDemo, classification === 'DEMO' ? true : undefined);
      assert.equal(resolved.demoExpiresAt, classification === 'DEMO' ? expiresAt.toISOString() : undefined);
    }
  });
});
