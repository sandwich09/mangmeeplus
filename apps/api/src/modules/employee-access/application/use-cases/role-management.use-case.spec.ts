import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { NON_EDITABLE_ROLE_KEYS } from '@watchdog-bms/contracts';
import { CreateRoleUseCase } from './create-role.use-case';
import { ListRolesUseCase } from './list-roles.use-case';
import { UpdateRoleUseCase } from './update-role.use-case';
import { DisableRoleUseCase } from './disable-role.use-case';
import { compileRole } from '../../domain/logic/capability.logic';

const COMPANY_ID = 'company-1';
const REAL_PERMISSION = 'crm.customer.read';

function makePrisma(opts: {
  role?: any;
  rolePermissions?: Array<{ roleId: string; permissionId: string }>;
  membershipRoles?: Array<{ membershipId: string; roleId: string; companyId: string }>;
  activeAssignments?: number;
} = {}) {
  const initialRoles = opts.role ? [{ key: 'CUSTOM', name: 'Custom', description: null, status: 'ACTIVE', ...opts.role }] : [];
  const state = {
    roles: initialRoles as any[],
    rolePermissions: [...(opts.rolePermissions ?? [])],
    membershipRoles: (opts.membershipRoles ?? []).map(({ membershipId, roleId }) => ({ membershipId, roleId })),
    auditLogs: [] as any[],
  };
  const membershipCompanies = new Map((opts.membershipRoles ?? []).map((row) => [row.membershipId, row.companyId]));
  const tx = {
    role: {
      findUnique: async ({ where }: any) => {
        if (where.scopeKey_key) {
          return state.roles.find((row) =>
            row.scopeKey === where.scopeKey_key.scopeKey && row.key === where.scopeKey_key.key,
          ) ?? null;
        }
        return state.roles.find((row) => row.id === where.id) ?? null;
      },
      create: async ({ data }: any) => {
        const row = { id: `role-${state.roles.length + 1}`, status: 'ACTIVE', ...data };
        state.roles.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = state.roles.find((r) => r.id === where.id);
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) row[key] = value;
        }
        return row;
      },
    },
    rolePermission: {
      findMany: async ({ where }: any) => state.rolePermissions
        .filter((row) => row.roleId === where.roleId)
        .map(({ permissionId }) => ({ permissionId })),
      createMany: async ({ data, skipDuplicates }: any) => {
        let count = 0;
        for (const row of data) {
          if (skipDuplicates && state.rolePermissions.some((current) =>
            current.roleId === row.roleId && current.permissionId === row.permissionId,
          )) continue;
          state.rolePermissions.push(row);
          count += 1;
        }
        return { count };
      },
      deleteMany: async ({ where }: any) => {
        const before = state.rolePermissions.length;
        state.rolePermissions = state.rolePermissions.filter((row) => row.roleId !== where.roleId);
        return { count: before - state.rolePermissions.length };
      },
    },
    membershipRole: {
      findMany: async ({ where }: any) => state.membershipRoles
        .filter((row) => row.roleId === where.roleId && membershipCompanies.get(row.membershipId) === where.membership.companyId)
        .map(({ membershipId }) => ({ membershipId })),
      deleteMany: async ({ where }: any) => {
        const membershipIds = new Set(where.membershipId.in);
        const before = state.membershipRoles.length;
        state.membershipRoles = state.membershipRoles.filter((row) =>
          row.roleId !== where.roleId || !membershipIds.has(row.membershipId),
        );
        return { count: before - state.membershipRoles.length };
      },
      createMany: async ({ data, skipDuplicates }: any) => {
        let count = 0;
        for (const row of data) {
          if (skipDuplicates && state.membershipRoles.some((current) =>
            current.membershipId === row.membershipId && current.roleId === row.roleId,
          )) continue;
          state.membershipRoles.push(row);
          count += 1;
        }
        return { count };
      },
    },
    auditLog: { create: async ({ data }: any) => { state.auditLogs.push(data); } },
  };

  const prisma = {
    client: {
      permission: { findMany: async ({ where }: any) => where.key.in.map((key: string) => ({ id: `perm-${key}`, key })) },
      role: {
        // Mirrors the real Prisma where-clause: matches system-scoped OR company-scoped roles by id.
        findFirst: async ({ where }: any) => {
          const role = state.roles.find((row) => row.id === where.id);
          if (!role || role.id !== where.id) return null;
          const allowedScopes = (where.OR ?? [{ scopeKey: where.scopeKey }]).map((c: any) => c.scopeKey);
          return allowedScopes.includes(role.scopeKey) ? role : null;
        },
        findUniqueOrThrow: async ({ where }: any) => {
          const row = state.roles.find((r) => r.id === where.id);
          if (!row) throw new Error('Role not found');
          return {
            ...row,
            permissions: state.rolePermissions
              .filter((rp) => rp.roleId === row.id)
              .map((rp) => ({ permission: { key: rp.permissionId.replace('perm-', '') } })),
          };
        },
      },
      membershipRole: { count: async () => opts.activeAssignments ?? 0 },
      $transaction: async (fn: any) => fn(tx),
    },
  } as any;

  return { prisma, state };
}

describe('ListRolesUseCase', () => {
  it('keeps raw permissions while counting only company-entitled permissions', async () => {
    const prisma = {
      client: {
        role: {
          findMany: async () => [{
            id: 'role-admin',
            scopeKey: 'system',
            key: 'ADMIN',
            name: 'Admin',
            description: null,
            isSystem: true,
            status: 'ACTIVE',
            permissions: [
              { permission: { key: 'crm.customer.read' } },
              { permission: { key: 'dashboard.read' } },
            ],
          }],
        },
        companyFeatureEntitlement: {
          findMany: async () => [
            { featureKey: 'expenses', enabled: true },
            { featureKey: 'dashboard_notifications', enabled: true },
          ],
        },
      },
    } as any;

    const result = await new ListRolesUseCase(prisma).execute(COMPANY_ID);

    assert.deepEqual(result[0].permissionKeys, ['crm.customer.read', 'dashboard.read']);
    assert.equal(result[0].effectivePermissionCount, 1);
  });

  it('hides a system role when the company has an override with the same key', async () => {
    const prisma = {
      client: {
        role: {
          findMany: async () => [
            { id: 'system-admin', scopeKey: 'system', key: 'ADMIN', name: 'Admin', description: null, isSystem: true, status: 'ACTIVE', permissions: [] },
            { id: 'company-admin', scopeKey: COMPANY_ID, key: 'ADMIN', name: 'Admin (local)', description: null, isSystem: false, status: 'ACTIVE', permissions: [] },
            { id: 'system-sales', scopeKey: 'system', key: 'SALES', name: 'Sales', description: null, isSystem: true, status: 'ACTIVE', permissions: [] },
          ],
        },
        companyFeatureEntitlement: { findMany: async () => [] },
      },
    } as any;

    const result = await new ListRolesUseCase(prisma).execute(COMPANY_ID);

    assert.equal(result.filter((role) => role.key === 'ADMIN').length, 1);
    assert.equal(result.find((role) => role.key === 'ADMIN')?.id, 'company-admin');
    assert.ok(result.some((role) => role.id === 'system-sales'));
  });
});

describe('ListRolesUseCase assignableByCurrentUser', () => {
  // MANAGER carries access.role.manage, so the subset rule alone keeps it away from an admin
  // without that key; ADMIN needs ledger.account.manage; FINANCE is owner-gated by role key.
  const GRANT_FIXTURE_ROLES = [
    { key: 'OWNER', permissionKeys: [] },
    { key: 'SYSTEM_ADMIN', permissionKeys: [] },
    { key: 'ADMIN', permissionKeys: ['crm.customer.read', 'ledger.account.manage'] },
    { key: 'MANAGER', permissionKeys: ['crm.customer.read', 'access.role.manage'] },
    { key: 'FINANCE', permissionKeys: ['crm.customer.read'] },
    { key: 'SALES', permissionKeys: ['crm.customer.read'] },
    { key: 'ARCHIVED', permissionKeys: [], status: 'DISABLED' },
  ];

  function grantFixturePrisma(fixtureRoles: Array<{ key: string; permissionKeys: string[]; status?: string }> = GRANT_FIXTURE_ROLES) {
    return {
      client: {
        role: {
          findMany: async () => fixtureRoles.map((role, index) => ({
            id: `role-${index}`,
            scopeKey: 'system',
            name: role.key,
            description: null,
            isSystem: true,
            status: role.status ?? 'ACTIVE',
            ...role,
            permissions: role.permissionKeys.map((key) => ({ permission: { key } })),
          })),
        },
        companyFeatureEntitlement: { findMany: async () => [] },
      },
    } as any;
  }

  async function flagsFor(requester?: { permissions: string[]; entitlementDeniedPermissions?: Record<string, string>; isOwner: boolean }) {
    const result = await new ListRolesUseCase(grantFixturePrisma()).execute(COMPANY_ID, requester);
    return Object.fromEntries(result.map((role) => [role.key, role.assignableByCurrentUser]));
  }

  it('offers the owner every assignable role except OWNER/SYSTEM_ADMIN and disabled ones', async () => {
    assert.deepEqual(await flagsFor({ permissions: [], isOwner: true }), {
      OWNER: false, SYSTEM_ADMIN: false, ADMIN: true, MANAGER: true, FINANCE: true, SALES: true, ARCHIVED: false,
    });
  });

  it('hides financial and people-manager roles from a default admin', async () => {
    assert.deepEqual(
      await flagsFor({ permissions: ['crm.customer.read', 'ledger.account.manage', 'access.employee.update'], isOwner: false }),
      { OWNER: false, SYSTEM_ADMIN: false, ADMIN: true, MANAGER: false, FINANCE: false, SALES: true, ARCHIVED: false },
    );
  });

  it('accepts a role whose disabled-feature permission is a resolver-proven raw grant', async () => {
    const prisma = {
      client: {
        role: {
          findMany: async () => [{
            id: 'role-admin', scopeKey: 'system', key: 'ADMIN', name: 'Admin', description: null,
            isSystem: true, status: 'ACTIVE',
            permissions: [
              { permission: { key: 'access.role.manage' } },
              { permission: { key: 'crm.customer.read' } },
            ],
          }],
        },
        companyFeatureEntitlement: { findMany: async () => [{ featureKey: 'crm', enabled: false }] },
      },
    } as any;

    const [role] = await new ListRolesUseCase(prisma).execute(COMPANY_ID, {
      permissions: ['access.role.manage'],
      entitlementDeniedPermissions: { 'crm.customer.read': 'crm' },
      isOwner: false,
    });

    assert.equal(role.assignableByCurrentUser, true);
    assert.equal(role.effectivePermissionCount, 1);
  });

  it('adds people-manager roles once the admin holds access.role.manage, financial still owner-gated', async () => {
    assert.deepEqual(
      await flagsFor({ permissions: ['crm.customer.read', 'ledger.account.manage', 'access.role.manage'], isOwner: false }),
      { OWNER: false, SYSTEM_ADMIN: false, ADMIN: true, MANAGER: true, FINANCE: false, SALES: true, ARCHIVED: false },
    );
  });

  it('drops roles whose permissions exceed a manager’s own', async () => {
    assert.deepEqual(await flagsFor({ permissions: ['crm.customer.read'], isOwner: false }), {
      OWNER: false, SYSTEM_ADMIN: false, ADMIN: false, MANAGER: false, FINANCE: false, SALES: true, ARCHIVED: false,
    });
  });

  it('offers HR only the server-approved operational roles', async () => {
    const fixture = ['MANAGER', 'SALES', 'INVENTORY', 'MARKETING', 'STAFF', 'ADMIN', 'HR', 'FINANCE', 'ACCOUNTANT', 'AUDITOR_READONLY', 'CUSTOM']
      .map((key) => ({ key, permissionKeys: [`permission.${key.toLowerCase()}`] }));
    const result = await new ListRolesUseCase(grantFixturePrisma(fixture)).execute(COMPANY_ID, {
      permissions: ['access.role.operational.assign'],
      isOwner: false,
    });
    const assignable = result.filter((role) => role.assignableByCurrentUser).map((role) => role.key);

    assert.deepEqual(assignable, ['MANAGER', 'SALES', 'INVENTORY', 'MARKETING', 'STAFF']);
  });

  it('omits the flag entirely without requester context (access matrix read)', async () => {
    const result = await new ListRolesUseCase(grantFixturePrisma()).execute(COMPANY_ID);
    assert.ok(result.every((role) => !('assignableByCurrentUser' in role)));
  });
});

describe('CreateRoleUseCase', () => {
  it('creates a company-scoped custom role with valid permission keys', async () => {
    const { prisma, state } = makePrisma();
    const useCase = new CreateRoleUseCase(prisma);
    const result = await useCase.execute({
      companyId: COMPANY_ID,
      name: 'Cashier',
      permissionKeys: [REAL_PERMISSION],
      requestingUserId: 'admin-1',
      requestId: 'req-1',
    });

    assert.equal(result.name, 'Cashier');
    assert.equal(result.isSystem, false);
    assert.equal(state.roles[0].scopeKey, COMPANY_ID);
    assert.equal(state.auditLogs[0].action, 'access.role.create');
  });

  it('rejects unknown permission keys', async () => {
    const { prisma } = makePrisma();
    const useCase = new CreateRoleUseCase(prisma);
    await assert.rejects(
      () => useCase.execute({ companyId: COMPANY_ID, name: 'Bad', permissionKeys: ['not.a.real.key'], requestingUserId: 'admin-1', requestId: 'req-1' }),
      /Unknown permission keys/,
    );
  });

  it('rejects an empty permission list', async () => {
    const { prisma } = makePrisma();
    const useCase = new CreateRoleUseCase(prisma);
    await assert.rejects(
      () => useCase.execute({ companyId: COMPANY_ID, name: 'Empty', permissionKeys: [], requestingUserId: 'admin-1', requestId: 'req-1' }),
      /at least one permission/i,
    );
  });

  // Team decision 2026-07-28: company-wide reimbursement visibility is owner-granted only.
  it('blocks a non-owner from granting reimbursement.read through a custom role', async () => {
    const { prisma } = makePrisma();
    const useCase = new CreateRoleUseCase(prisma);
    await assert.rejects(
      () => useCase.execute({
        companyId: COMPANY_ID, name: 'Payout watcher', permissionKeys: ['reimbursement.read'],
        requestingUserId: 'admin-1', requestId: 'req-1',
        granterPermissionKeys: ['reimbursement.read', 'access.role.manage'], isOwner: false,
      }),
      /requires the company owner/,
    );
  });

  it('lets the owner grant reimbursement.read through a custom role', async () => {
    const { prisma, state } = makePrisma();
    const useCase = new CreateRoleUseCase(prisma);
    const result = await useCase.execute({
      companyId: COMPANY_ID, name: 'Payout watcher', permissionKeys: ['reimbursement.read'],
      requestingUserId: 'owner-1', requestId: 'req-1', isOwner: true,
    });
    assert.equal(result.name, 'Payout watcher');
    assert.ok(state.rolePermissions.some((rp) => rp.permissionId === 'perm-reimbursement.read'));
  });
});

describe('UpdateRoleUseCase', () => {
  it('forks an editable system role, replaces requested permissions, and moves only this company', async () => {
    const systemRole = {
      id: 'role-system-admin', companyId: null, scopeKey: 'system', key: 'ADMIN', name: 'Admin',
      description: 'System admin role', isSystem: true, status: 'ACTIVE',
    };
    const sourcePermissions = [
      { roleId: systemRole.id, permissionId: 'perm-dashboard.read' },
      { roleId: systemRole.id, permissionId: 'perm-crm.customer.create' },
    ];
    const { prisma, state } = makePrisma({
      role: systemRole,
      rolePermissions: sourcePermissions,
      membershipRoles: [
        { membershipId: 'membership-1', roleId: systemRole.id, companyId: COMPANY_ID },
        { membershipId: 'membership-2', roleId: systemRole.id, companyId: 'company-2' },
      ],
    });
    const sourceSnapshot = sourcePermissions.map((row) => ({ ...row }));
    const useCase = new UpdateRoleUseCase(prisma);

    const result = await useCase.execute({
      companyId: COMPANY_ID,
      roleId: systemRole.id,
      name: 'Admin (local)',
      permissionKeys: [REAL_PERMISSION],
      requestingUserId: 'owner-1',
      requestId: 'req-1',
      isOwner: true,
    });

    const fork = state.roles.find((role) => role.scopeKey === COMPANY_ID && role.key === systemRole.key);
    const expectedKeys = compileRole({
      permissionKeys: [REAL_PERMISSION],
      entitledFeatureKeys: null,
      granterPermissionKeys: null,
    }).permissionKeys;
    assert.ok(fork);
    assert.equal(fork.companyId, COMPANY_ID);
    assert.equal(fork.isSystem, false);
    assert.equal(result.id, fork.id);
    assert.deepEqual(result.permissionKeys.sort(), expectedKeys);
    assert.deepEqual(
      state.rolePermissions.filter((row) => row.roleId === fork.id).map((row) => row.permissionId).sort(),
      expectedKeys.map((key) => `perm-${key}`),
    );
    assert.deepEqual(state.rolePermissions.filter((row) => row.roleId === systemRole.id), sourceSnapshot);
    assert.deepEqual(state.membershipRoles.filter((row) => row.membershipId === 'membership-1'), [
      { membershipId: 'membership-1', roleId: fork.id },
    ]);
    assert.deepEqual(state.membershipRoles.filter((row) => row.membershipId === 'membership-2'), [
      { membershipId: 'membership-2', roleId: systemRole.id },
    ]);

    const createAudit = state.auditLogs.find((row) => row.action === 'access.role.create');
    assert.deepEqual(createAudit?.metadataJson, {
      forkedFromRoleId: systemRole.id,
      key: systemRole.key,
      movedMemberships: 1,
    });
    assert.equal(createAudit?.riskLevel, 'HIGH');
    assert.equal(createAudit?.targetId, fork.id);
    assert.ok(state.auditLogs.some((row) => row.action === 'access.role.update' && row.targetId === fork.id));

    await useCase.execute({
      companyId: COMPANY_ID,
      roleId: systemRole.id,
      name: 'Admin (local v2)',
      requestingUserId: 'owner-1',
      requestId: 'req-2',
      isOwner: true,
    });

    assert.equal(state.roles.filter((role) => role.scopeKey === COMPANY_ID && role.key === systemRole.key).length, 1);
    assert.equal(fork.name, 'Admin (local v2)');
    assert.equal(state.auditLogs.filter((row) => row.action === 'access.role.create').length, 1);
  });

  it('copies the system permission set when a name-only edit creates the fork', async () => {
    const systemRole = {
      id: 'role-system-sales', companyId: null, scopeKey: 'system', key: 'SALES', name: 'Sales',
      description: null, isSystem: true, status: 'ACTIVE',
    };
    const sourcePermissions = [
      { roleId: systemRole.id, permissionId: 'perm-dashboard.read' },
      { roleId: systemRole.id, permissionId: 'perm-crm.customer.read' },
    ];
    const { prisma, state } = makePrisma({ role: systemRole, rolePermissions: sourcePermissions });

    const result = await new UpdateRoleUseCase(prisma).execute({
      companyId: COMPANY_ID,
      roleId: systemRole.id,
      name: 'Sales (local)',
      requestingUserId: 'owner-1',
      requestId: 'req-copy',
      isOwner: true,
    });

    assert.deepEqual(result.permissionKeys.sort(), ['crm.customer.read', 'dashboard.read']);
    assert.deepEqual(state.rolePermissions.filter((row) => row.roleId === systemRole.id), sourcePermissions);
  });

  it('blocks every platform-managed system role', async () => {
    for (const key of NON_EDITABLE_ROLE_KEYS) {
      const roleId = `role-${key.toLowerCase()}`;
      const { prisma } = makePrisma({
        role: { id: roleId, key, name: key, isSystem: true, scopeKey: 'system' },
      });

      await assert.rejects(
        () => new UpdateRoleUseCase(prisma).execute({
          companyId: COMPANY_ID,
          roleId,
          name: 'Hacked',
          requestingUserId: 'admin-1',
          requestId: 'req-protected',
        }),
        (error) => error instanceof ForbiddenException
          && error.message === 'This role is managed by MangmeePlus and cannot be edited.',
      );
    }
  });

  it('allows editing a custom role permission set', async () => {
    const { prisma, state } = makePrisma({ role: { id: 'role-1', isSystem: false, scopeKey: COMPANY_ID } });
    const useCase = new UpdateRoleUseCase(prisma);
    await useCase.execute({ companyId: COMPANY_ID, roleId: 'role-1', permissionKeys: [REAL_PERMISSION], requestingUserId: 'admin-1', requestId: 'req-1' });
    assert.equal(state.auditLogs[0].action, 'access.role.update');
  });

  it('blocks a non-owner from sneaking reimbursement.read into an existing role', async () => {
    const { prisma } = makePrisma({ role: { id: 'role-1', isSystem: false, scopeKey: COMPANY_ID } });
    const useCase = new UpdateRoleUseCase(prisma);
    await assert.rejects(
      () => useCase.execute({
        companyId: COMPANY_ID, roleId: 'role-1', permissionKeys: [REAL_PERMISSION, 'reimbursement.read'],
        requestingUserId: 'admin-1', requestId: 'req-1',
        granterPermissionKeys: [REAL_PERMISSION, 'reimbursement.read', 'access.role.manage'], isOwner: false,
      }),
      /requires the company owner/,
    );
  });
});

describe('DisableRoleUseCase', () => {
  it('blocks disabling a protected system role', async () => {
    const { prisma } = makePrisma({ role: { id: 'role-owner', isSystem: true, scopeKey: 'system' } });
    const useCase = new DisableRoleUseCase(prisma);
    await assert.rejects(
      () => useCase.execute({ companyId: COMPANY_ID, roleId: 'role-owner', requestingUserId: 'admin-1', requestId: 'req-1' }),
      /Protected system roles cannot be disabled/,
    );
  });

  it('blocks disabling a role that still has active assignments', async () => {
    const { prisma } = makePrisma({ role: { id: 'role-1', isSystem: false, scopeKey: COMPANY_ID }, activeAssignments: 2 });
    const useCase = new DisableRoleUseCase(prisma);
    await assert.rejects(
      () => useCase.execute({ companyId: COMPANY_ID, roleId: 'role-1', requestingUserId: 'admin-1', requestId: 'req-1' }),
      /still assigned to active employees/,
    );
  });

  it('disables a custom role with no active assignments', async () => {
    const { prisma, state } = makePrisma({ role: { id: 'role-1', isSystem: false, scopeKey: COMPANY_ID }, activeAssignments: 0 });
    const useCase = new DisableRoleUseCase(prisma);
    await useCase.execute({ companyId: COMPANY_ID, roleId: 'role-1', requestingUserId: 'admin-1', requestId: 'req-1' });
    assert.equal(state.auditLogs[0].action, 'access.role.disable');
  });
});
