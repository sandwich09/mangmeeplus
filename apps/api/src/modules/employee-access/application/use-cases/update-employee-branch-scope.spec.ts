// 10D: branch scope assignment guards on UpdateEmployeeUseCase.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UpdateEmployeeUseCase } from './update-employee.use-case';

const KEY = Buffer.from('a'.repeat(64), 'hex');
const CONFIG = { credentialEncryptionKey: KEY } as any;
const PROFILE = { id: 'emp-1', companyId: 'company-1', userId: 'user-1', membershipId: 'mem-1', phoneNumber: '0812345678', identityType: 'THAI_NATIONAL_ID' };

type FakeRole = { id: string; key: string; permissions: Array<{ permission: { key: string } }> };

function makePrisma(opts: {
  validBranchCount?: number;
  existingScopeRows?: number;
  candidateRoles?: FakeRole[];
  targetRoleRows?: Array<{ roleId: string; role: { key: string } }>;
  duplicateIdentity?: boolean;
  otherCompanyMemberships?: number;
  membershipScopeMode?: string;
} = {}) {
  const writes = { profileUpdate: undefined as any, userUpdate: undefined as any, membershipUpdate: undefined as any, scopeDeletes: 0, scopeCreates: undefined as any, auditArgs: undefined as any, assignedRoleIds: undefined as any, transactions: 0 };
  const tx = {
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
        findUniqueOrThrow: async () => ({ branchScopeMode: opts.membershipScopeMode ?? 'ALL_BRANCHES', defaultBranchId: null }),
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
    assert.deepEqual(result.branchScopeBranchIds, ['b1']);
  });
});

// Escalation guards: Manager holds access.employee.update but NOT access.role.manage.
const SALES_ROLE: FakeRole = { id: 'r-sales', key: 'SALES', permissions: [{ permission: { key: 'crm.customer.read' } }] };
const ADMIN_ROLE: FakeRole = { id: 'r-admin', key: 'ADMIN', permissions: [{ permission: { key: 'access.role.manage' } }, { permission: { key: 'admin.user.manage' } }] };
const FINANCE_ROLE: FakeRole = { id: 'r-finance', key: 'FINANCE', permissions: [{ permission: { key: 'accounting.payment.create' } }] };
const managerCmd = { ...baseCmd, requestingUserId: 'manager-1', requesterPermissions: ['access.employee.read', 'access.employee.update', 'access.employee.disable', 'access.role.read'] };

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
      /OWNER and SYSTEM_ADMIN role assignments/,
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
