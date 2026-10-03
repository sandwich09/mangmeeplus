import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { NON_EDITABLE_ROLE_KEYS, SALES_ROLE_KEYS } from '@watchdog-bms/contracts';
import { CreateRoleUseCase } from './create-role.use-case';
import { GetRoleUseCase } from './get-role.use-case';
import { ListRolesUseCase } from './list-roles.use-case';
import { PreviewRoleUseCase } from './preview-role.use-case';
import { UpdateRoleUseCase } from './update-role.use-case';
import { DisableRoleUseCase } from './disable-role.use-case';
import { compileRole } from '../../domain/logic/capability.logic';
import { SYSTEM_ROLES } from '../../../auth/permission-registry';
import { PLATFORM_TENANT_ID } from '../../../sales-console/application/sales-context';

const COMPANY_ID = 'company-1';
const REAL_PERMISSION = 'crm.customer.read';

/**
 * What a second role with a key already taken in the company gets from the database: P2002 in the
 * shape `@prisma/adapter-pg` gives it, with no `meta.target` (see `uniqueConstraintFields`). Copied
 * from a real violation of the index; `create-employee-username.pg.spec.ts` runs the same creations
 * against PostgreSQL.
 */
const roleKeyTaken = () => Object.assign(new Error('Unique constraint failed on the fields: (`"scopeKey"`, `key`)'), {
  code: 'P2002',
  meta: { modelName: 'Role', driverAdapterError: { cause: { originalCode: '23505', kind: 'UniqueConstraintViolation', constraint: { fields: ['"scopeKey"', 'key'] } } } },
});

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
    contextInvalidations: [] as any[],
  };
  const membershipCompanies = new Map((opts.membershipRoles ?? []).map((row) => [row.membershipId, row.companyId]));
  const tx = {
    $queryRaw: async () => [],
    aiConversation: { findMany: async () => [], deleteMany: async ({ where }: any) => { state.contextInvalidations.push(where); return { count: 1 }; } },
    companyMembership: { findMany: async ({ where }: any) => state.membershipRoles
      .filter(row => membershipCompanies.get(row.membershipId) === where.companyId && row.roleId === where.roles.some.roleId)
      .map(row => ({ userId: `user-${row.membershipId}` })) },
    role: {
      findUnique: async ({ where }: any) => {
        if (where.scopeKey_key) {
          return state.roles.find((row) =>
            row.scopeKey === where.scopeKey_key.scopeKey && row.key === where.scopeKey_key.key,
          ) ?? null;
        }
        return state.roles.find((row) => row.id === where.id) ?? null;
      },
      findMany: async ({ where }: any) => state.roles
        .filter((row) => row.scopeKey === where.scopeKey && row.key.startsWith(where.key.startsWith))
        .map(({ key }) => ({ key })),
      create: async ({ data }: any) => {
        // The unique index on (scopeKey, key), as the database enforces it.
        if (state.roles.some((row) => row.scopeKey === data.scopeKey && row.key === data.key)) throw roleKeyTaken();
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
      updateMany: async ({ where, data }: any) => {
        const matches = state.membershipRoles.filter((row) => row.roleId === where.roleId && membershipCompanies.get(row.membershipId) === where.membership.companyId);
        for (const row of matches) Object.assign(row, data);
        return { count: matches.length };
      },
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
      companyFeatureEntitlement: { findMany: async () => [] },
      permission: { findMany: async ({ where }: any) => where.key.in.map((key: string) => ({ id: `perm-${key}`, key })) },
      role: {
        // Mirrors the real Prisma where-clause: matches system-scoped OR company-scoped roles by id.
        findFirst: async ({ where }: any) => {
          const role = state.roles.find((row) => row.id === where.id);
          if (!role || role.id !== where.id) return null;
          const allowedScopes = (where.OR ?? [{ scopeKey: where.scopeKey }]).map((c: any) => c.scopeKey);
          return allowedScopes.includes(role.scopeKey) ? {
            ...role,
            permissions: state.rolePermissions
              .filter((rp) => rp.roleId === role.id)
              .map((rp) => ({ permission: { key: rp.permissionId.replace('perm-', '') } })),
          } : null;
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

  return { prisma, state, tx };
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

  // Owner report 2026-10-02: the role page printed "Accounting access" under the role's title. The
  // standard descriptions are Thai now, but a company that edited a standard role earlier owns a copy
  // that stored the English one; a description the company wrote itself is left exactly as written.
  it('reads the English description an old company copy stored as the standard role’s description of today', async () => {
    const standard = (key: string) => SYSTEM_ROLES.find((role) => role.key === key)!.description;
    const prisma = {
      client: {
        role: {
          findMany: async () => [
            { id: 'copy-accountant', scopeKey: COMPANY_ID, key: 'ACCOUNTANT', name: 'Accountant', description: 'Accounting access', isSystem: false, status: 'ACTIVE', permissions: [] },
            { id: 'copy-manager', scopeKey: COMPANY_ID, key: 'MANAGER', name: 'Manager', description: 'หัวหน้าสาขา ดูแลหน้าร้าน', isSystem: false, status: 'ACTIVE', permissions: [] },
            { id: 'custom', scopeKey: COMPANY_ID, key: 'ROLE', name: 'ผู้ช่วย', description: 'Sales access', isSystem: false, status: 'ACTIVE', permissions: [] },
            { id: 'system-staff', scopeKey: 'system', key: 'STAFF', name: 'Staff', description: 'General staff access', isSystem: true, status: 'ACTIVE', permissions: [] },
          ],
        },
        companyFeatureEntitlement: { findMany: async () => [] },
      },
    } as any;

    const byId = new Map((await new ListRolesUseCase(prisma).execute(COMPANY_ID)).map((role) => [role.id, role.description]));

    assert.equal(byId.get('copy-accountant'), standard('ACCOUNTANT'));
    assert.equal(byId.get('system-staff'), standard('STAFF'));
    assert.equal(byId.get('copy-manager'), 'หัวหน้าสาขา ดูแลหน้าร้าน');
    assert.equal(byId.get('custom'), 'Sales access', 'another role’s old text on a custom role is the company’s own wording');
    for (const key of ['ACCOUNTANT', 'STAFF']) assert.doesNotMatch(standard(key), /[A-Za-z]/);
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
      OWNER: false, ADMIN: true, MANAGER: true, FINANCE: true, SALES: true, ARCHIVED: false,
    });
  });

  it('hides financial and people-manager roles from a default admin', async () => {
    assert.deepEqual(
      await flagsFor({ permissions: ['crm.customer.read', 'ledger.account.manage', 'access.employee.update'], isOwner: false }),
      { OWNER: false, ADMIN: true, MANAGER: false, FINANCE: false, SALES: true, ARCHIVED: false },
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
      { OWNER: false, ADMIN: true, MANAGER: true, FINANCE: false, SALES: true, ARCHIVED: false },
    );
  });

  it('drops roles whose permissions exceed a manager’s own', async () => {
    assert.deepEqual(await flagsFor({ permissions: ['crm.customer.read'], isOwner: false }), {
      OWNER: false, ADMIN: false, MANAGER: false, FINANCE: false, SALES: true, ARCHIVED: false,
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

  it('does not show a shop the Mangmee sales roles, and still offers them inside the platform company (RB-34)', async () => {
    const fixture = [
      { key: 'SALES', permissionKeys: ['crm.customer.read'] },
      { key: 'MANGMEE_SALES_LEAD', permissionKeys: ['sales.console.read', 'sales.deal.approve'] },
      { key: 'MANGMEE_SALES', permissionKeys: ['sales.console.read'] },
    ];
    const owner = { permissions: [], isOwner: true };
    const listed = async (companyId: string, requester?: typeof owner) => Object.fromEntries(
      (await new ListRolesUseCase(grantFixturePrisma(fixture)).execute(companyId, requester)).map((role) => [role.key, role.assignableByCurrentUser]));

    assert.deepEqual(await listed(COMPANY_ID, owner), { SALES: true });
    // The access matrix reads the same list without a requester.
    assert.deepEqual(Object.keys(await listed(COMPANY_ID)), ['SALES']);
    assert.deepEqual(await listed(PLATFORM_TENANT_ID, owner), { SALES: true, MANGMEE_SALES_LEAD: true, MANGMEE_SALES: true });
  });

  it('does not list a copy of a platform-only role a shop made before the by-id routes refused it (RB-34)', async () => {
    // PATCH roles/:id used to fork one into a company role with the same key. That copy is scoped to
    // the shop, so a filter that drops only the system row put it straight back in the role list.
    for (const key of SALES_ROLE_KEYS) {
      const rows = (scope: string) => [
        { id: 'system-sales', scopeKey: 'system', key: 'SALES', name: 'Sales', description: null, isSystem: true, status: 'ACTIVE', permissions: [] },
        { id: 'system-platform-only', scopeKey: 'system', key, name: key, description: null, isSystem: true, status: 'ACTIVE', permissions: [] },
        { id: 'copy-platform-only', scopeKey: scope, key, name: `${key} (copy)`, description: null, isSystem: false, status: 'ACTIVE', permissions: [] },
      ];
      const list = (companyId: string) => new ListRolesUseCase({ client: {
        role: { findMany: async () => rows(companyId) },
        companyFeatureEntitlement: { findMany: async () => [] },
      } } as any).execute(companyId, { permissions: [], isOwner: true });

      assert.deepEqual((await list(COMPANY_ID)).map((role) => role.id), ['system-sales'], key);
      // Inside the platform company the copy is an ordinary override of the system row.
      assert.deepEqual((await list(PLATFORM_TENANT_ID)).map((role) => role.id), ['system-sales', 'copy-platform-only'], key);
    }
  });
});

describe('a platform-only role reached by its id (RB-34)', () => {
  // The first RB-34 fix took these roles out of a shop's role LIST and refused to ASSIGN them. The
  // three routes that take a role id still answered: a shop that knew the id could read the role,
  // preview it and fork it into a company role carrying the same key.
  const SYSTEM_ID = 'role-system-platform-only';
  const COPY_ID = 'role-copy-platform-only';
  const SOURCE_PERMISSIONS = [
    { roleId: SYSTEM_ID, permissionId: 'perm-sales.console.read' },
    { roleId: SYSTEM_ID, permissionId: 'perm-sales.deal.create' },
  ];
  const fixture = (key: string, companyId = COMPANY_ID) => {
    const made = makePrisma({
      role: { id: SYSTEM_ID, companyId: null, scopeKey: 'system', key, name: key, isSystem: true },
      rolePermissions: SOURCE_PERMISSIONS.map((row) => ({ ...row })),
      membershipRoles: [{ membershipId: 'membership-1', roleId: SYSTEM_ID, companyId }],
    });
    made.prisma.client.companyFeatureEntitlement = { findMany: async () => [] };
    return made;
  };
  /** The same company with the copy an earlier PATCH left behind. */
  const fixtureWithCopy = (key: string) => {
    const made = fixture(key);
    made.state.roles.push({ id: COPY_ID, companyId: COMPANY_ID, scopeKey: COMPANY_ID, key, name: `${key} (copy)`, description: null, status: 'ACTIVE', isSystem: false });
    made.state.rolePermissions.push({ roleId: COPY_ID, permissionId: `perm-${REAL_PERMISSION}` });
    return made;
  };
  const notFound = (error: unknown) => error instanceof NotFoundException && error.message === 'Role not found';

  it('answers "not found" to a shop that reads one, and still reads it inside the platform company', async () => {
    for (const key of ['SYSTEM_ADMIN', ...SALES_ROLE_KEYS]) {
      await assert.rejects(() => new GetRoleUseCase(fixture(key).prisma).execute(COMPANY_ID, SYSTEM_ID), notFound, key);
      await assert.rejects(() => new GetRoleUseCase(fixtureWithCopy(key).prisma).execute(COMPANY_ID, COPY_ID), notFound, `${key} copy`);
      const read = await new GetRoleUseCase(fixture(key, PLATFORM_TENANT_ID).prisma).execute(PLATFORM_TENANT_ID, SYSTEM_ID);
      assert.deepEqual([read.key, read.permissionKeys], [key, ['sales.console.read', 'sales.deal.create']], key);
    }
    // Every other role is read as before.
    const sales = makePrisma({ role: { id: 'role-sales', scopeKey: 'system', key: 'SALES', name: 'Sales', isSystem: true } });
    assert.equal((await new GetRoleUseCase(sales.prisma).execute(COMPANY_ID, 'role-sales')).key, 'SALES');
  });

  it('does not preview one for a shop: the diff would hand over its permission set', async () => {
    const preview = (prisma: any, companyId: string, roleId: string) => new PreviewRoleUseCase(prisma).execute({
      companyId, roleId, permissionKeys: [REAL_PERMISSION], granterPermissionKeys: [], isOwner: true,
    });
    for (const key of SALES_ROLE_KEYS) {
      await assert.rejects(() => preview(fixture(key).prisma, COMPANY_ID, SYSTEM_ID), notFound, key);
      await assert.rejects(() => preview(fixtureWithCopy(key).prisma, COMPANY_ID, COPY_ID), notFound, `${key} copy`);
      const inPlatform = await preview(fixture(key, PLATFORM_TENANT_ID).prisma, PLATFORM_TENANT_ID, SYSTEM_ID);
      assert.deepEqual(inPlatform.removedVsCurrent, ['sales.console.read', 'sales.deal.create'], key);
    }
  });

  it('does not let a shop copy one into its own roles, or edit a copy it already has', async () => {
    const rename = (prisma: any, companyId: string, roleId: string) => new UpdateRoleUseCase(prisma).execute({
      companyId, roleId, name: 'ทีมขายของร้าน', requestingUserId: 'owner-1', requestId: 'req-fork', isOwner: true,
    });
    for (const key of SALES_ROLE_KEYS) {
      const shop = fixture(key);
      await assert.rejects(() => rename(shop.prisma, COMPANY_ID, SYSTEM_ID), notFound, key);
      assert.deepEqual(shop.state.roles.map((role) => role.id), [SYSTEM_ID], `${key}: nothing was copied`);
      assert.deepEqual(shop.state.membershipRoles, [{ membershipId: 'membership-1', roleId: SYSTEM_ID }], `${key}: no holder was moved`);
      assert.deepEqual(shop.state.auditLogs, [], key);

      const withCopy = fixtureWithCopy(key);
      await assert.rejects(() => rename(withCopy.prisma, COMPANY_ID, COPY_ID), notFound, `${key} copy`);
      assert.equal(withCopy.state.roles.find((role) => role.id === COPY_ID)?.name, `${key} (copy)`);

      // The platform company manages its own roles as before.
      const platform = fixture(key, PLATFORM_TENANT_ID);
      const forked = await rename(platform.prisma, PLATFORM_TENANT_ID, SYSTEM_ID);
      assert.deepEqual([forked.key, forked.isSystem, forked.name], [key, false, 'ทีมขายของร้าน'], key);
    }
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

  it('lets OWNER grant package management to a custom role regardless of its name', async () => {
    const { prisma, state } = makePrisma();
    const result = await new CreateRoleUseCase(prisma).execute({
      companyId: COMPANY_ID, name: 'Chief Operating Officer', permissionKeys: ['company.plan.manage'],
      requestingUserId: 'owner-1', requestId: 'req-plan-manager', isOwner: true,
    });
    assert.equal(result.key, 'CHIEF_OPERATING_OFFICER');
    assert.ok(state.rolePermissions.some((rp) => rp.roleId === result.id && rp.permissionId === 'perm-company.plan.manage'));
  });

  it('does not let a delegated package manager grant that permission to another role', async () => {
    const { prisma } = makePrisma();
    await assert.rejects(() => new CreateRoleUseCase(prisma).execute({
      companyId: COMPANY_ID, name: 'Another package manager', permissionKeys: ['company.plan.manage'],
      requestingUserId: 'manager-1', requestId: 'req-plan-manager',
      granterPermissionKeys: ['company.plan.manage', 'access.role.manage'], isOwner: false,
    }), /requires the company owner/);
  });

  it('refuses a name that would give a custom role the key of a system or platform role', async () => {
    const create = (prisma: any, companyId: string, name: string, roleTemplateKey?: string) => new CreateRoleUseCase(prisma).execute({
      companyId, name, roleTemplateKey, permissionKeys: [REAL_PERMISSION], requestingUserId: 'owner-1', requestId: 'req-name', isOwner: true,
    });
    const reserved = (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.deepEqual(error.getResponse(), { code: 'role_name_reserved', message: 'ชื่อนี้ซ้ำกับบทบาทมาตรฐานของระบบ กรุณาใช้ชื่ออื่น' });
      return true;
    };
    // Every system role, spelled the way a person would type it, plus the reported cases.
    const names = [...SYSTEM_ROLES.map((role) => role.key.replaceAll('_', ' ').toLowerCase()), 'System Admin', 'OWNER', ' company-view ', 'Mangmee Sales'];
    for (const companyId of [COMPANY_ID, PLATFORM_TENANT_ID]) {
      for (const name of names) {
        const { prisma, state } = makePrisma();
        await assert.rejects(() => create(prisma, companyId, name), reserved, `${companyId}: ${name}`);
        assert.deepEqual([state.roles, state.auditLogs], [[], []], `${name}: nothing was written`);
      }
    }
    // A Thai name takes its key from the preset it names, and the preset key is free text.
    for (const roleTemplateKey of ['tpl.x.system_admin', 'anything.owner', 'x.company_view', 'x.mangmee_sales_lead']) {
      await assert.rejects(() => create(makePrisma().prisma, COMPANY_ID, 'ผู้ดูแล', roleTemplateKey), reserved, roleTemplateKey);
    }

    // What stays possible: the audit H-19 lookup for a catalogue preset, and any other name.
    assert.equal((await create(makePrisma().prisma, COMPANY_ID, 'ผู้จัดการ', 'tpl.x.manager')).key, 'MANAGER');
    assert.equal((await create(makePrisma().prisma, COMPANY_ID, 'Store Manager')).key, 'STORE_MANAGER');
    assert.equal((await create(makePrisma().prisma, COMPANY_ID, 'Owner assistant')).key, 'OWNER_ASSISTANT');
  });

  // Seen on a local stack on 2026-10-02: the numbering stopped at `_4`, so a company's sixth role with
  // a Thai name was refused, and the role page called it a duplicate of something.
  const createRole = (prisma: any, name: string, roleTemplateKey?: string) => new CreateRoleUseCase(prisma).execute({
    companyId: COMPANY_ID, name, roleTemplateKey, permissionKeys: [REAL_PERMISSION], requestingUserId: 'owner-1', requestId: 'req-key', isOwner: true,
  });

  it('numbers the roles whose Thai names give the same key, with no cap', async () => {
    const { prisma, state } = makePrisma();
    // What the role page sends: a name and no example key. A name with no Latin letter gives `ROLE`.
    const names = ['ผู้จัดการ', 'หัวหน้า', 'พนักงาน', 'ผู้ช่วย'].flatMap((rank) => ['ขาย', 'คลัง', 'บัญชี', 'จัดซื้อ', 'หน้าร้าน'].map((team) => `${rank}${team}`));
    const keys: string[] = [];
    for (const name of names) keys.push((await createRole(prisma, name)).key);

    assert.deepEqual(keys, ['ROLE', ...Array.from({ length: 19 }, (_, index) => `ROLE_${index + 1}`)]);
    // The first five are the keys they had before; the seventh and the twentieth are new ground.
    assert.deepEqual([keys[6], keys[19]], ['ROLE_6', 'ROLE_19']);
    assert.deepEqual(state.roles.map((role) => role.name), names);
    assert.equal(state.auditLogs.length, 20);
  });

  it('numbers several roles made from one example, around a key the company already uses', async () => {
    const { prisma, state } = makePrisma();
    // A role the company named itself holds one of the numbers. It keeps its key.
    assert.equal((await createRole(prisma, 'Manager 2')).key, 'MANAGER_2');

    const keys: string[] = [];
    for (const branch of ['ลาดพร้าว', 'บางนา', 'รังสิต', 'ศรีราชา', 'หาดใหญ่', 'เชียงใหม่', 'ขอนแก่น']) {
      keys.push((await createRole(prisma, `ผู้จัดการสาขา${branch}`, 'tpl.x.manager')).key);
    }
    // The first is the key approval routing compares (audit H-19), as before.
    assert.deepEqual(keys, ['MANAGER', 'MANAGER_1', 'MANAGER_3', 'MANAGER_4', 'MANAGER_5', 'MANAGER_6', 'MANAGER_7']);
    assert.equal(state.roles[0].key, 'MANAGER_2');
    // Another example has its own numbering.
    assert.equal((await createRole(prisma, 'แคชเชียร์', 'tpl.retail.cashier')).key, 'CASHIER');
  });

  it('gives roles created at the same moment different keys', async () => {
    const { prisma, state } = makePrisma();
    // All three read the keys before any of them writes, so all three first try `ROLE`.
    const created = await Promise.all(['ผู้จัดการสาขา', 'หัวหน้ากะ', 'พนักงานเสิร์ฟ'].map((name) => createRole(prisma, name)));

    assert.deepEqual(created.map((role) => role.key).sort(), ['ROLE', 'ROLE_1', 'ROLE_2']);
    assert.deepEqual(state.roles.map((role) => role.key).sort(), ['ROLE', 'ROLE_1', 'ROLE_2']);
    // One audit row per role: a refused round wrote nothing.
    assert.deepEqual(state.auditLogs.map((log) => log.metadataJson.key).sort(), ['ROLE', 'ROLE_1', 'ROLE_2']);
  });

  it('answers with a code of its own when every round loses its key, and retries nothing else', async () => {
    const { prisma, state, tx } = makePrisma();
    let rounds = 0;
    tx.role.create = async () => { rounds += 1; throw roleKeyTaken(); };
    await assert.rejects(() => createRole(prisma, 'ผู้จัดการสาขา'), (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.deepEqual(error.getResponse(), {
        code: 'role_key_allocation_failed',
        message: 'ยังไม่ได้สร้างบทบาทนี้ เพราะมีการบันทึกบทบาทอื่นในเวลาเดียวกัน กรุณากดบันทึกอีกครั้ง',
      });
      return true;
    });
    assert.equal(rounds, 5, 'a bounded number of rounds');
    assert.deepEqual([state.roles, state.rolePermissions, state.auditLogs], [[], [], []], 'nothing was written');

    // Any other failure is thrown as it came, after one round: another table's unique index, and a plain error.
    for (const failure of [
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { driverAdapterError: { cause: { constraint: { fields: ['"roleId"', '"permissionId"'] } } } } }),
      new Error('connection lost'),
    ]) {
      rounds = 0;
      tx.role.create = async () => { rounds += 1; throw failure; };
      await assert.rejects(() => createRole(prisma, 'ผู้จัดการสาขา'), (error: unknown) => error === failure);
      assert.equal(rounds, 1);
    }
  });
});

describe('UpdateRoleUseCase', () => {
  it('never appends a role when an employee assignment changes before the company role fork', async () => {
    const { prisma, state, tx } = makePrisma({
      role: { id: 'system-sales', scopeKey: 'system', key: 'SALES', name: 'Sales', isSystem: true },
      membershipRoles: [{ membershipId: 'membership-1', roleId: 'system-sales', companyId: COMPANY_ID }],
    });
    const updateMany = tx.membershipRole.updateMany;
    tx.membershipRole.updateMany = async (args: any) => {
      state.membershipRoles[0].roleId = 'staff';
      return updateMany(args);
    };
    await new UpdateRoleUseCase(prisma).execute({
      companyId: COMPANY_ID, roleId: 'system-sales', name: 'Sales local',
      requestingUserId: 'owner-1', requestId: 'req-1', isOwner: true,
    });
    assert.deepEqual(state.membershipRoles, [{ membershipId: 'membership-1', roleId: 'staff' }]);
    assert.equal(state.auditLogs.find((row) => row.action === 'access.role.create')?.metadataJson.movedMemberships, 0);
  });

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
    assert.deepEqual(state.contextInvalidations, [{ companyId: COMPANY_ID, userId: 'user-membership-1', channelKind: null }]);
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

  it('forks STAFF with reimbursement review while keeping payment authority out', async () => {
    const systemRole = {
      id: 'role-system-staff', companyId: null, scopeKey: 'system', key: 'STAFF', name: 'Staff',
      description: null, isSystem: true, status: 'ACTIVE',
    };
    const { prisma, state } = makePrisma({
      role: systemRole,
      membershipRoles: [{ membershipId: 'membership-1', roleId: systemRole.id, companyId: COMPANY_ID }],
    });

    const result = await new UpdateRoleUseCase(prisma).execute({
      companyId: COMPANY_ID,
      roleId: systemRole.id,
      name: 'Staff ตรวจเบิก',
      capabilityPackKeys: ['pack.reimbursement.review'],
      requestingUserId: 'owner-1',
      requestId: 'req-staff-review',
      isOwner: true,
    });

    assert.equal(result.key, 'STAFF');
    assert.ok(result.permissionKeys.includes('reimbursement.finance_review'));
    for (const key of ['reimbursement.payment.record', 'reimbursement.payment.void', 'reimbursement.duplicate.resolve']) {
      assert.ok(!result.permissionKeys.includes(key), `STAFF review fork must not hold ${key}`);
    }
    assert.deepEqual(state.membershipRoles.filter((row) => row.membershipId === 'membership-1'), [
      { membershipId: 'membership-1', roleId: result.id },
    ]);
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

  it('preserves an existing hidden grant when a non-owner edits a custom role', async () => {
    const hiddenExistingKey = 'crm.customer.export';
    const { prisma } = makePrisma({
      role: { id: 'role-1', isSystem: false, scopeKey: COMPANY_ID },
      rolePermissions: [
        { roleId: 'role-1', permissionId: `perm-${REAL_PERMISSION}` },
        { roleId: 'role-1', permissionId: `perm-${hiddenExistingKey}` },
      ],
    });

    const result = await new UpdateRoleUseCase(prisma).execute({
      companyId: COMPANY_ID,
      roleId: 'role-1',
      name: 'Customer support',
      permissionKeys: [REAL_PERMISSION, hiddenExistingKey],
      granterPermissionKeys: [REAL_PERMISSION, 'access.role.manage'],
      requestingUserId: 'admin-1',
      requestId: 'req-preserve-hidden',
      isOwner: false,
    });

    assert.ok(result.permissionKeys.includes(hiddenExistingKey));
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

it('shops never list SYSTEM_ADMIN, including a historical company copy; platform keeps it', async () => {
  const rows = [
    { id: 'system-admin', key: 'SYSTEM_ADMIN', scopeKey: 'system', isSystem: true },
    { id: 'copy-admin', key: 'SYSTEM_ADMIN', scopeKey: COMPANY_ID, isSystem: false },
  ].map(row => ({ ...row, name: 'System Admin', description: null, status: 'ACTIVE', permissions: [] }));
  const prisma = { client: { role: { findMany: async () => rows }, companyFeatureEntitlement: { findMany: async () => [] } } } as any;
  assert.deepEqual(await new ListRolesUseCase(prisma).execute(COMPANY_ID), []);
  assert.ok((await new ListRolesUseCase(prisma).execute(PLATFORM_TENANT_ID)).length > 0);
});

it('standard role descriptions do not promise work the package does not sell', async () => {
  const { TIER_FEATURE_PRESETS, ALL_FEATURE_ENTITLEMENT_KEYS } = await import('@watchdog-bms/contracts');
  const keys: readonly string[] = TIER_FEATURE_PRESETS.STARTER_249;
  const rows = ['ACCOUNTANT', 'FINANCE', 'SALES', 'INVENTORY', 'MANAGER'].map(key => ({
    id: key, key, name: key, scopeKey: 'system', isSystem: true, status: 'ACTIVE',
    description: SYSTEM_ROLES.find(role => role.key === key)!.description,
    permissions: [{ permission: { key: 'expense.read' } }, { permission: { key: 'ledger.journal.read' } }],
  }));
  const prisma = { client: { role: { findMany: async () => rows }, companyFeatureEntitlement: { findMany: async () =>
    ALL_FEATURE_ENTITLEMENT_KEYS.map(featureKey => ({ featureKey, enabled: keys.includes(featureKey) })) } } } as any;
  for (const role of await new ListRolesUseCase(prisma).execute(COMPANY_ID)) {
    assert.match(role.description!, /ค่าใช้จ่าย/);
    assert.doesNotMatch(role.description!, /ลงบัญชี|ปิดงวด|ทำภาษี|ธนาคาร|ใบเสนอราคา|รับ-จ่ายสินค้า|ใบขอซื้อ/);
  }
});
