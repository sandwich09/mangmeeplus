// 10D: branch scope assignment guards on UpdateEmployeeUseCase.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { UpdateEmployeeInput } from '@watchdog-bms/contracts';
import { UpdateEmployeeUseCase } from './update-employee.use-case';
import { PLATFORM_TENANT_ID } from '../../../sales-console/application/sales-context';

const KEY = Buffer.from('a'.repeat(64), 'hex');
const CONFIG = { credentialEncryptionKey: KEY } as any;
const PROFILE = { id: 'emp-1', companyId: 'company-1', userId: 'user-1', membershipId: 'mem-1', phoneNumber: '0812345678', identityType: 'THAI_NATIONAL_ID' };

type FakeRole = { id: string; key: string; isSystem?: boolean; permissions: Array<{ permission: { key: string } }> };

function makePrisma(opts: {
  validBranchCount?: number;
  existingScopeRows?: number;
  candidateRoles?: FakeRole[];
  targetRoleRows?: Array<{ roleId: string; role: { key: string; isSystem?: boolean } }>;
  duplicateIdentity?: boolean;
  otherCompanyMemberships?: number;
  membershipScopeMode?: string;
  membershipBranchIds?: string[];
} = {}) {
  const writes = { profileUpdate: undefined as any, userUpdate: undefined as any, membershipUpdate: undefined as any, scopeDeletes: 0, scopeCreates: undefined as any, auditArgs: undefined as any, assignedRoleIds: undefined as any, transactions: 0, contextInvalidations: [] as any[] };
  const tx = {
    $queryRaw: async () => [],
    aiConversation: { findMany: async () => [], deleteMany: async ({ where }: any) => { writes.contextInvalidations.push(where); return { count: 1 }; } },
    employeeAccessProfile: { update: async (args: any) => { writes.profileUpdate = args; return {}; } },
    user: { update: async (args: any) => { writes.userUpdate = args; return {}; } },
    membershipRole: {
      deleteMany: async () => ({}),
      createMany: async (args: any) => { writes.assignedRoleIds = args.data.map((d: any) => d.roleId); return {}; },
    },
    companyMembership: { update: async (args: any) => { writes.membershipUpdate = args; return {}; } },
    membershipBranchScope: {
      deleteMany: async () => { writes.scopeDeletes += 1; return {}; },
      createMany: async (args: any) => { writes.scopeCreates = args; return {}; },
    },
    auditLog: { create: async (args: any) => { writes.auditArgs = args; return {}; } },
  };
  const prisma = {
    client: {
      employeeAccessProfile: {
        findFirst: async (args: any) => args.where.identityHash ? (opts.duplicateIdentity ? { id: 'emp-2' } : null) : PROFILE,
        findFirstOrThrow: async () => ({
          ...PROFILE,
          displayName: 'Somchai', legalName: null, identityType: 'THAI_NATIONAL_ID', identityLast4: '0123',
          status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(),
          user: { credential: null, externalIdentities: [] },
          membership: { roles: [], branchScopeMode: 'SELECTED_BRANCHES', defaultBranchId: null, branchScopes: [{ branchId: 'b1' }] },
        }),
      },
      companyMembership: {
        findUniqueOrThrow: async () => ({ branchScopeMode: opts.membershipScopeMode ?? 'ALL_BRANCHES', defaultBranchId: null, branchScopes: (opts.membershipBranchIds ?? []).map((branchId) => ({ branchId })) }),
        count: async () => opts.otherCompanyMemberships ?? 0,
      },
      role: { findMany: async () => opts.candidateRoles ?? [] },
      membershipRole: { findMany: async () => opts.targetRoleRows ?? [] },
      auditLog: { create: tx.auditLog.create },
      branch: { count: async () => opts.validBranchCount ?? 0 },
      membershipBranchScope: { count: async () => opts.existingScopeRows ?? 0 },
      $transaction: async (fn: any) => { writes.transactions += 1; return fn(tx); },
    },
  } as any;
  return { prisma, writes };
}

const baseCmd = { companyId: 'company-1', employeeId: 'emp-1', requestingUserId: 'admin-1', requesterPermissions: ['access.employee.update', 'access.role.manage'], requestId: 'req-1' };

describe('UpdateEmployeeUseCase branch scope', () => {
  for (const [name, scope] of [
    ['another active company branch', { branchScopeMode: 'SELECTED_BRANCHES', branchIds: ['b1', 'b2'] }],
    ['all branches', { branchScopeMode: 'ALL_BRANCHES', branchIds: [] }],
    ['an out-of-scope default', { branchScopeMode: 'DEFAULT_BRANCH_ONLY', defaultBranchId: 'b2' }],
    ['retained out-of-scope rows', { branchScopeMode: 'SELECTED_BRANCHES' }],
  ] as Array<[string, UpdateEmployeeInput]>) {
    it(`denies and audits a restricted manager granting ${name}, including to themselves`, async () => {
      const { prisma, writes } = makePrisma({ validBranchCount: 'defaultBranchId' in scope ? 1 : 2, existingScopeRows: 2, membershipBranchIds: ['b1', 'b2'] });
      await assert.rejects(
        () => new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, requestingUserId: PROFILE.userId, requesterBranchIds: ['b1'], ...scope }),
        /outside the requester's branch scope/,
      );
      assert.equal(writes.transactions, 0);
      assert.equal(writes.auditArgs.data.result, 'DENIED');
      assert.equal(writes.auditArgs.data.riskLevel, 'HIGH');
    });
  }

  it('preserves a restricted manager assigning only branches they hold', async () => {
    const { prisma, writes } = makePrisma({ validBranchCount: 1 });
    await new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, requesterBranchIds: ['b1'], branchScopeMode: 'SELECTED_BRANCHES', branchIds: ['b1'], defaultBranchId: 'b1' });
    assert.deepEqual(writes.scopeCreates.data, [{ membershipId: 'mem-1', branchId: 'b1' }]);
  });

  it('rejects branches that are not ACTIVE branches of this company', async () => {
    const { prisma } = makePrisma({ validBranchCount: 1 });
    await assert.rejects(
      () => new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, branchScopeMode: 'SELECTED_BRANCHES', branchIds: ['b1', 'b-other-company'] }),
      /invalid for this company/,
    );
  });

  it('rejects SELECTED_BRANCHES that would leave zero scope rows (employee lockout)', async () => {
    const { prisma } = makePrisma({ existingScopeRows: 0 });
    await assert.rejects(
      () => new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, branchScopeMode: 'SELECTED_BRANCHES' }),
      /at least one branch/,
    );
  });

  it('rejects DEFAULT_BRANCH_ONLY without a default branch', async () => {
    const { prisma } = makePrisma({});
    await assert.rejects(
      () => new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, branchScopeMode: 'DEFAULT_BRANCH_ONLY' }),
      /requires a default branch/,
    );
  });

  it('replaces the scope set atomically and audits at HIGH risk', async () => {
    const { prisma, writes } = makePrisma({ validBranchCount: 2 });
    const result = await new UpdateEmployeeUseCase(prisma, CONFIG).execute({
      ...baseCmd, branchScopeMode: 'SELECTED_BRANCHES', branchIds: ['b1', 'b2'],
    });
    assert.equal(writes.membershipUpdate.data.branchScopeMode, 'SELECTED_BRANCHES');
    assert.equal(writes.scopeDeletes, 1);
    assert.deepEqual(writes.scopeCreates.data.map((d: any) => d.branchId), ['b1', 'b2']);
    assert.equal(writes.auditArgs.data.riskLevel, 'HIGH');
    assert.deepEqual(writes.auditArgs.data.metadataJson.branchIds, ['b1', 'b2']);
    assert.deepEqual(writes.contextInvalidations, [{ companyId: 'company-1', userId: 'user-1', channelKind: null }]);
    assert.equal(writes.auditArgs.data.metadataJson.aiConversationsInvalidated, 1);
    assert.deepEqual(result.branchScopeBranchIds, ['b1']);
  });
});

// Escalation guards: Manager holds access.employee.update but NOT access.role.manage.
const SALES_ROLE: FakeRole = { id: 'r-sales', key: 'SALES', permissions: [{ permission: { key: 'crm.customer.read' } }] };
const ADMIN_ROLE: FakeRole = { id: 'r-admin', key: 'ADMIN', permissions: [{ permission: { key: 'access.role.manage' } }, { permission: { key: 'admin.user.manage' } }] };
const FINANCE_ROLE: FakeRole = { id: 'r-finance', key: 'FINANCE', permissions: [{ permission: { key: 'accounting.payment.create' } }] };
const ENTITLEMENT_FILTERED_ROLE: FakeRole = {
  id: 'r-filtered',
  key: 'CUSTOM',
  permissions: [
    { permission: { key: 'access.employee.read' } },
    { permission: { key: 'crm.customer.read' } },
  ],
};
const STAFF_ROLE: FakeRole = { id: 'r-staff', key: 'STAFF', isSystem: true, permissions: [] };
const managerCmd = { ...baseCmd, requestingUserId: 'manager-1', requesterPermissions: ['access.employee.read', 'access.employee.update', 'access.employee.disable', 'access.role.read'] };
const hrCmd = { ...baseCmd, requestingUserId: 'hr-1', requesterPermissions: ['access.employee.update', 'access.role.operational.assign'] };

describe('UpdateEmployeeUseCase role assignment guards', () => {
  it('blocks a requester from assigning a permission they do not hold', async () => {
    const { prisma } = makePrisma({ candidateRoles: [ADMIN_ROLE] });
    await assert.rejects(
      () => new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...managerCmd, roleIds: ['r-admin'] }),
      /does not hold/,
    );
  });

  it('lets the same requester assign a non-privileged role (Sales)', async () => {
    const { prisma, writes } = makePrisma({ candidateRoles: [SALES_ROLE] });
    await new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...managerCmd, requesterPermissions: [...managerCmd.requesterPermissions, 'crm.customer.read'], roleIds: ['r-sales'] });
    assert.deepEqual(writes.assignedRoleIds, ['r-sales']);
    assert.equal(writes.contextInvalidations.length, 1);
  });

  it('rejects empty, multiple, repeated and null roles without mutating access', async () => {
    const { prisma, writes } = makePrisma();
    for (const roleIds of [[], ['r-sales', 'r-staff'], ['r-sales', 'r-sales'], null]) {
      await assert.rejects(
        () => new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, roleIds: roleIds as any }),
        /Exactly one employee role/,
      );
    }
    assert.equal(writes.transactions, 0);
    assert.equal(writes.assignedRoleIds, undefined);
  });

  it('replaces legacy multiple roles with the one explicitly selected and audits the removed role', async () => {
    const { prisma, writes } = makePrisma({ candidateRoles: [SALES_ROLE], targetRoleRows: [
      { roleId: 'r-sales', role: { key: 'SALES', isSystem: true } },
      { roleId: 'r-staff', role: { key: 'STAFF', isSystem: true } },
    ] });
    await new UpdateEmployeeUseCase(prisma, CONFIG).execute({
      ...baseCmd, requesterPermissions: [...baseCmd.requesterPermissions, 'crm.customer.read'], roleIds: ['r-sales'],
    });
    assert.deepEqual(writes.assignedRoleIds, ['r-sales']);
    assert.deepEqual(writes.auditArgs.data.metadataJson.roleDiff, { addedRoleIds: [], removedRoleIds: ['r-staff'] });
    assert.equal(writes.profileUpdate.data.jobTitle, undefined);
  });

  it('does not rewrite legacy roles on a profile-only edit', async () => {
    const { prisma, writes } = makePrisma({ targetRoleRows: [
      { roleId: 'r-sales', role: { key: 'SALES', isSystem: true } },
      { roleId: 'r-staff', role: { key: 'STAFF', isSystem: true } },
    ] });
    await new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, jobTitle: 'พนักงานขาย' });
    assert.equal(writes.assignedRoleIds, undefined);
    assert.equal(writes.profileUpdate.data.jobTitle, 'พนักงานขาย');
    assert.deepEqual(writes.contextInvalidations, []);
  });

  it('allows an update when the resolver proves the disabled-feature role permission belongs to the requester', async () => {
    const { prisma, writes } = makePrisma({
      candidateRoles: [ENTITLEMENT_FILTERED_ROLE],
    });

    await new UpdateEmployeeUseCase(prisma, CONFIG).execute({
      ...managerCmd,
      requesterEntitlementDeniedPermissions: { 'crm.customer.read': 'crm' },
      roleIds: ['r-filtered'],
    });

    assert.deepEqual(writes.assignedRoleIds, ['r-filtered']);
  });

  it('lets an access.role.manage holder (Admin) assign the ADMIN role', async () => {
    const { prisma, writes } = makePrisma({ candidateRoles: [ADMIN_ROLE] });
    await new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, requesterPermissions: [...baseCmd.requesterPermissions, 'admin.user.manage'], roleIds: ['r-admin'] });
    assert.deepEqual(writes.assignedRoleIds, ['r-admin']);
  });

  it('never lets anyone change the role assignment of an OWNER target', async () => {
    const { prisma } = makePrisma({ candidateRoles: [SALES_ROLE], targetRoleRows: [{ roleId: 'r-owner', role: { key: 'OWNER' } }] });
    await assert.rejects(
      () => new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, requesterPermissions: [...baseCmd.requesterPermissions, 'crm.customer.read'], roleIds: ['r-sales'] }),
      /Owner and platform role assignments/,
    );
  });

  it('blocks every self role mutation', async () => {
    const { prisma, writes } = makePrisma({ candidateRoles: [SALES_ROLE] });
    await assert.rejects(
      () => new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, requestingUserId: PROFILE.userId, roleIds: ['r-sales'] }),
      /own role assignment/,
    );
    assert.equal(writes.auditArgs.data.result, 'DENIED');
  });

  it('allows self profile edits when submitted role IDs are unchanged and skips role writes', async () => {
    const { prisma, writes } = makePrisma({ targetRoleRows: [{ roleId: 'r-sales', role: { key: 'SALES' } }] });
    await new UpdateEmployeeUseCase(prisma, CONFIG).execute({
      ...baseCmd,
      requestingUserId: PROFILE.userId,
      roleIds: ['r-sales'],
      displayName: 'Updated name',
    });
    assert.equal(writes.profileUpdate.data.displayName, 'Updated name');
    assert.equal(writes.assignedRoleIds, undefined);
  });

  it('lets HR reassign an operational target to another operational role', async () => {
    const { prisma, writes } = makePrisma({
      candidateRoles: [STAFF_ROLE],
      targetRoleRows: [{ roleId: 'r-manager', role: { key: 'MANAGER', isSystem: true } }],
    });
    await new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...hrCmd, roleIds: ['r-staff'] });
    assert.deepEqual(writes.assignedRoleIds, ['r-staff']);
  });

  it('blocks HR from changing an employee who currently holds a privileged role', async () => {
    const { prisma, writes } = makePrisma({
      candidateRoles: [STAFF_ROLE],
      targetRoleRows: [{ roleId: 'r-admin', role: { key: 'ADMIN', isSystem: true } }],
    });
    await assert.rejects(
      () => new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...hrCmd, roleIds: ['r-staff'] }),
      /HR cannot change employees who currently hold/,
    );
    assert.equal(writes.auditArgs.data.result, 'DENIED');
  });

  it('still lets HR edit a privileged employee profile when the role is unchanged', async () => {
    const { prisma, writes } = makePrisma({ targetRoleRows: [{ roleId: 'r-admin', role: { key: 'ADMIN', isSystem: true } }] });
    await new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...hrCmd, roleIds: ['r-admin'], jobTitle: 'ผู้อำนวยการฝ่ายปฏิบัติการ' });
    assert.equal(writes.profileUpdate.data.jobTitle, 'ผู้อำนวยการฝ่ายปฏิบัติการ');
    assert.equal(writes.assignedRoleIds, undefined);
  });

  it('blocks a company-custom role even when it reuses an operational system key', async () => {
    const customStaff = { ...STAFF_ROLE, id: 'r-custom-staff', isSystem: false };
    const { prisma } = makePrisma({
      candidateRoles: [customStaff],
      targetRoleRows: [{ roleId: 'r-staff', role: { key: 'STAFF', isSystem: true } }],
    });
    await assert.rejects(
      () => new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...hrCmd, roleIds: [customStaff.id] }),
      /HR may assign only operational roles/,
    );
  });

  it('refuses a shop owner who moves staff onto a Mangmee sales role, and leaves existing ones and the platform company alone (RB-34)', async () => {
    const mangmeeSales = { id: 'r-mangmee', key: 'MANGMEE_SALES', isSystem: true, permissions: [{ permission: { key: 'sales.console.read' } }] };
    const owner = { ...baseCmd, requesterRoles: ['OWNER'] };

    const shop = makePrisma({ candidateRoles: [mangmeeSales] });
    await assert.rejects(() => new UpdateEmployeeUseCase(shop.prisma, CONFIG).execute({ ...owner, roleIds: ['r-mangmee'] }), /platform company/);
    assert.equal(shop.writes.auditArgs.data.result, 'DENIED');
    assert.equal(shop.writes.assignedRoleIds, undefined);

    // An assignment made before the rule is not taken away by an edit that leaves the role as it is.
    const held = makePrisma({ targetRoleRows: [{ roleId: 'r-mangmee', role: { key: 'MANGMEE_SALES', isSystem: true } }] });
    await new UpdateEmployeeUseCase(held.prisma, CONFIG).execute({ ...owner, roleIds: ['r-mangmee'], jobTitle: 'พนักงานขาย' });
    assert.equal(held.writes.assignedRoleIds, undefined);
    assert.equal(held.writes.profileUpdate.data.jobTitle, 'พนักงานขาย');

    const platform = makePrisma({ candidateRoles: [mangmeeSales] });
    await new UpdateEmployeeUseCase(platform.prisma, CONFIG).execute({ ...owner, companyId: PLATFORM_TENANT_ID, roleIds: ['r-mangmee'] });
    assert.deepEqual(platform.writes.assignedRoleIds, ['r-mangmee']);
  });

  it('requires owner approval for FINANCE update even when the requester holds its permissions', async () => {
    const { prisma, writes } = makePrisma({ candidateRoles: [FINANCE_ROLE] });
    await assert.rejects(
      () => new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, requesterPermissions: [...baseCmd.requesterPermissions, 'accounting.payment.create'], roleIds: ['r-finance'] }),
      /owner approval/,
    );
    assert.equal(writes.auditArgs.data.result, 'DENIED');
  });

  it('audits granter, grantee, and the exact role diff', async () => {
    const { prisma, writes } = makePrisma({ candidateRoles: [SALES_ROLE], targetRoleRows: [{ roleId: 'r-old', role: { key: 'STAFF' } }] });
    await new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, requesterPermissions: [...baseCmd.requesterPermissions, 'crm.customer.read'], roleIds: ['r-sales'] });
    assert.equal(writes.auditArgs.data.metadataJson.granterUserId, 'admin-1');
    assert.equal(writes.auditArgs.data.metadataJson.granteeUserId, PROFILE.userId);
    assert.deepEqual(writes.auditArgs.data.metadataJson.roleDiff, { addedRoleIds: ['r-sales'], removedRoleIds: ['r-old'] });
  });
});

describe('UpdateEmployeeUseCase display name', () => {
  it('syncs the renamed employee onto User so /auth/me (sidebar, header) is not stale', async () => {
    const { prisma, writes } = makePrisma();
    await new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, displayName: 'นางสาวมีนา ใจงาม' });
    assert.equal(writes.profileUpdate.data.displayName, 'นางสาวมีนา ใจงาม');
    assert.equal(writes.userUpdate.data.displayName, 'นางสาวมีนา ใจงาม');
  });

  it('stores a corrected คำนำหน้า in its own column, not glued onto the name', async () => {
    const { prisma, writes } = makePrisma();
    await new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, displayName: 'มีนา ใจงาม', titlePrefix: 'นางสาว' });
    assert.equal(writes.profileUpdate.data.titlePrefix, 'นางสาว');
    assert.equal(writes.profileUpdate.data.displayName, 'มีนา ใจงาม');
    // The account name is the person; the title is a profile field and never reaches User.
    assert.equal(writes.userUpdate.data.displayName, 'มีนา ใจงาม');
    assert.equal(writes.userUpdate.data.titlePrefix, undefined);
  });

  it('leaves a cross-company shared login with its own account name', async () => {
    const { prisma, writes } = makePrisma({ otherCompanyMemberships: 1 });
    await new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, displayName: 'นางสาวมีนา ใจงาม' });
    assert.equal(writes.profileUpdate.data.displayName, 'นางสาวมีนา ใจงาม');
    assert.equal(writes.userUpdate, undefined);
  });
});

describe('UpdateEmployeeUseCase identity editing', () => {
  it('encrypts a changed identity and never stores the raw value', async () => {
    const { prisma, writes } = makePrisma();
    await new UpdateEmployeeUseCase(prisma, CONFIG).execute({
      ...baseCmd,
      identityType: 'THAI_NATIONAL_ID',
      identityNumber: '1234567890123',
    });
    assert.equal(writes.profileUpdate.data.identityLast4, '0123');
    assert.notEqual(writes.profileUpdate.data.identityEncryptedRef, '1234567890123');
    assert.ok(writes.profileUpdate.data.identityHash);
  });

  it('rejects an identity already used by another employee in the company', async () => {
    const { prisma } = makePrisma({ duplicateIdentity: true });
    await assert.rejects(
      () => new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, identityNumber: '1234567890123' }),
      /ID\/passport already exists/,
    );
  });
});

// R8 (spec branch-scope-visibility): oversight roles are guaranteed all-branch by a write-path
// guardrail, never by overriding the permission resolver.
const ACCOUNTANT_ROLE_ROW = { roleId: 'r-acct', role: { key: 'ACCOUNTANT' } };
const FINANCIAL_ASSIGN = 'access.role.financial.assign';

describe('UpdateEmployeeUseCase all-branch role guardrail', () => {
  it('rejects narrowing the scope of a membership that already holds an all-branch role', async () => {
    const { prisma } = makePrisma({ validBranchCount: 2, targetRoleRows: [ACCOUNTANT_ROLE_ROW] });
    await assert.rejects(
      () => new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, branchScopeMode: 'SELECTED_BRANCHES', branchIds: ['b1', 'b2'] }),
      /Role ACCOUNTANT requires access to all branches/,
    );
  });

  it('rejects narrowing in the same write that assigns the all-branch role', async () => {
    const { prisma } = makePrisma({ validBranchCount: 1, candidateRoles: [FINANCE_ROLE] });
    await assert.rejects(
      () => new UpdateEmployeeUseCase(prisma, CONFIG).execute({
        ...baseCmd,
        requesterPermissions: [...baseCmd.requesterPermissions, 'accounting.payment.create', FINANCIAL_ASSIGN],
        roleIds: ['r-finance'],
        branchScopeMode: 'SELECTED_BRANCHES',
        branchIds: ['b1'],
      }),
      /Role FINANCE requires access to all branches/,
    );
  });

  it('widens a narrowed membership on role assignment, in the same transaction as the role write', async () => {
    const { prisma, writes } = makePrisma({
      candidateRoles: [FINANCE_ROLE],
      targetRoleRows: [{ roleId: 'r-sales', role: { key: 'SALES' } }],
      membershipScopeMode: 'SELECTED_BRANCHES',
    });
    await new UpdateEmployeeUseCase(prisma, CONFIG).execute({
      ...baseCmd,
      requesterPermissions: [...baseCmd.requesterPermissions, 'accounting.payment.create', FINANCIAL_ASSIGN],
      roleIds: ['r-finance'],
    });
    assert.deepEqual(writes.assignedRoleIds, ['r-finance']);
    assert.deepEqual(writes.membershipUpdate.data, { branchScopeMode: 'ALL_BRANCHES', defaultBranchId: null });
    assert.equal(writes.scopeDeletes, 1);
    // Split across two transactions, a failure between them strands FINANCE on one branch.
    assert.equal(writes.transactions, 1);
    assert.equal(writes.auditArgs.data.riskLevel, 'HIGH');
    assert.equal(writes.auditArgs.data.metadataJson.branchScopeWidenedForRole, 'FINANCE');
  });

  it('leaves the five branch-scopable roles free to be narrowed', async () => {
    const { prisma, writes } = makePrisma({ validBranchCount: 2, targetRoleRows: [{ roleId: 'r-sales', role: { key: 'SALES' } }] });
    await new UpdateEmployeeUseCase(prisma, CONFIG).execute({ ...baseCmd, branchScopeMode: 'SELECTED_BRANCHES', branchIds: ['b1', 'b2'] });
    assert.equal(writes.membershipUpdate.data.branchScopeMode, 'SELECTED_BRANCHES');
    assert.deepEqual(writes.scopeCreates.data.map((d: any) => d.branchId), ['b1', 'b2']);
  });
});
