import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreateEmployeeUseCase } from './create-employee.use-case';
import { verifyPassword } from '../../../auth/domain/logic/password-credential.logic';

const KEY = Buffer.from('a'.repeat(64), 'hex');
const COMPANY_ID = 'company-1';

function makeUseCase(opts: { roles?: Array<{ id: string; key: string; permissions?: Array<{ permission: { key: string } }> }>; existingIdentity?: boolean; existingPhone?: boolean; existingUsers?: Array<{ id: string; username: string; status?: string; email?: string }> } = {}) {
  const roles = (opts.roles ?? [{ id: 'role-sales', key: 'SALES' }]).map((role) => ({ ...role, permissions: role.permissions ?? [] }));
  const state = { users: [] as any[], credentials: [] as any[], memberships: [] as any[], membershipRoles: [] as any[], profiles: [] as any[], auditLogs: [] as any[], lineLinkTokens: [] as any[], branchScopes: [] as any[] };
  for (const u of opts.existingUsers ?? []) state.users.push({ status: 'ACTIVE', ...u });

  const tx = {
    user: {
      create: async ({ data }: any) => {
        const row = { id: `user-${state.users.length + 1}`, ...data };
        state.users.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = state.users.find((item) => item.id === where.id);
        if (row) Object.assign(row, data);
        return row ?? { id: where.id, ...data };
      },
    },
    userCredential: {
      create: async ({ data }: any) => { state.credentials.push(data); return data; },
      update: async ({ where, data }: any) => {
        const row = state.credentials.find((item) => item.userId === where.userId);
        if (row) Object.assign(row, data);
        return row ?? { userId: where.userId, ...data };
      },
    },
    companyMembership: {
      create: async ({ data }: any) => {
        const row = { id: `membership-${state.memberships.length + 1}`, ...data };
        state.memberships.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = state.memberships.find((item) => item.id === where.id);
        if (row) Object.assign(row, data);
        return row ?? { id: where.id, ...data };
      },
    },
    membershipRole: {
      createMany: async ({ data }: any) => { state.membershipRoles.push(...data); return { count: data.length }; },
      deleteMany: async ({ where }: any) => {
        state.membershipRoles = state.membershipRoles.filter((item) => item.membershipId !== where.membershipId);
        return { count: 1 };
      },
    },
    membershipBranchScope: {
      deleteMany: async ({ where }: any) => {
        state.branchScopes = state.branchScopes.filter((item) => item.membershipId !== where.membershipId);
        return { count: 1 };
      },
    },
    employeeAccessProfile: {
      create: async ({ data }: any) => {
        const row = { id: `profile-${state.profiles.length + 1}`, ...data };
        state.profiles.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = state.profiles.find((item) => item.id === where.id);
        if (row) Object.assign(row, data);
        return row ?? { id: where.id, ...data };
      },
    },
    auditLog: { create: async ({ data }: any) => { state.auditLogs.push(data); return data; } },
    employeeLineLinkToken: {
      create: async ({ data }: any) => { state.lineLinkTokens.push(data); return data; },
      updateMany: async ({ where, data }: any) => {
        for (const row of state.lineLinkTokens) {
          if (row.membershipId === where.membershipId && row.status === where.status) Object.assign(row, data);
        }
        return { count: 1 };
      },
    },
  };

  const prisma = {
    client: {
      role: { findMany: async () => roles },
      membershipRole: { findMany: async ({ where }: any) => state.membershipRoles.filter((row) => row.membershipId === where.membershipId) },
      auditLog: { create: tx.auditLog.create },
      user: {
        findFirst: async ({ where }: any) => {
          const uname = where?.username?.equals ?? where?.username;
          if (!uname) return null;
          return state.users.find((u) => (u.username ?? '').toLowerCase() === String(uname).toLowerCase()) ?? null;
        },
      },
      companyMembership: {
        count: async ({ where }: any) =>
          state.memberships.filter(
            (m) => m.userId === where.userId && (where.companyId?.not ? m.companyId !== where.companyId.not : true),
          ).length,
      },
      employeeAccessProfile: {
        findFirst: async ({ where }: any) => {
          if (where.id) return state.profiles.find((row) => row.id === where.id) ?? null;
          if (where.identityHash) {
            const row = state.profiles.find((item) => item.companyId === where.companyId && item.identityHash === where.identityHash);
            if (row) return { ...row, user: { username: state.users.find((user) => user.id === row.userId)?.username } };
          }
          if (where.phoneNumber) {
            const row = state.profiles.find((item) => item.companyId === where.companyId && item.phoneNumber === where.phoneNumber);
            if (row) return row;
          }
          if (where.identityHash && opts.existingIdentity) return { id: 'existing', status: 'ACTIVE' };
          if (where.phoneNumber && opts.existingPhone) return { id: 'existing' };
          return null;
        },
      },
      $transaction: async (fn: any) => fn(tx),
    },
  } as any;

  const config = { credentialEncryptionKey: KEY } as any;
  const useCase = new CreateEmployeeUseCase(prisma, config);
  return { useCase, state };
}

const baseCommand = {
  companyId: COMPANY_ID,
  displayName: 'Somchai Jaidee',
  username: 'Somchai.J',
  dateOfBirth: '1998-09-28',
  identityType: 'THAI_NATIONAL_ID' as const,
  identityNumber: '1-2345-67890-12-3',
  phoneNumber: '0812345678',
  roleIds: ['role-sales'],
  requestingUserId: 'admin-1',
  requesterPermissions: [],
  requestId: 'req-1',
  apiBaseUrl: 'https://api.example.com/v1',
};

describe('CreateEmployeeUseCase', () => {
  it('creates user, membership, role assignment, and access profile as a draft', async () => {
    const { useCase, state } = makeUseCase();
    const result = await useCase.execute(baseCommand);

    assert.equal(state.users.length, 1);
    assert.equal(state.users[0].username, 'somchai.j');
    assert.equal(state.memberships.length, 1);
    assert.equal(state.memberships[0].status, 'DRAFT');
    assert.equal(state.membershipRoles.length, 1);
    assert.equal(state.profiles.length, 1);
    assert.equal(state.profiles[0].status, 'DRAFT');
    assert.equal(result.temporaryPassword, '28091998');
    assert.equal(result.mustChangePassword, true);
    assert.equal(state.credentials[0].mustChangePassword, true);
    assert.equal(state.credentials[0].status, 'ACTIVE');
    assert.equal(state.credentials[0].expiresAt, null);
    assert.equal(state.credentials[0].tempPasswordEncrypted, null);
    assert.equal(verifyPassword('28091998', state.credentials[0].passwordHash), true);
  });

  it('issues a single-use LINE link QR package bound to the new user', async () => {
    const { useCase, state } = makeUseCase();
    const result = await useCase.execute(baseCommand);

    assert.equal(state.lineLinkTokens.length, 1);
    assert.equal(state.lineLinkTokens[0].userId, result.userId);
    assert.equal(state.lineLinkTokens[0].membershipId, state.memberships[0].id);
    assert.ok(result.lineLink, 'lineLink package must be returned');
    assert.ok(result.lineLink!.linkUrl.startsWith('https://api.example.com/v1/auth/line/link-page/employee?token='));
    const rawToken = new URL(result.lineLink!.linkUrl).searchParams.get('token')!;
    // raw token never persisted — only its hash
    assert.notEqual(state.lineLinkTokens[0].tokenHash, rawToken);
  });

  it('never persists the plaintext identity number', async () => {
    const { useCase, state } = makeUseCase();
    await useCase.execute(baseCommand);

    const profile = state.profiles[0];
    assert.notEqual(profile.identityEncryptedRef, baseCommand.identityNumber);
    assert.ok(!JSON.stringify(profile).includes('1234567890123'));
    assert.equal(profile.identityLast4, '0123');
  });

  it('writes an audit log without the password or identity number', async () => {
    const { useCase, state } = makeUseCase();
    const result = await useCase.execute(baseCommand);

    const log = state.auditLogs[0];
    const logStr = JSON.stringify(log);
    assert.ok(!logStr.includes(result.temporaryPassword));
    assert.ok(!logStr.includes('1234567890123'));
    assert.equal(log.action, 'access.employee.create');
    assert.equal(log.result, 'SUCCESS');
    assert.equal(log.metadataJson.granterUserId, 'admin-1');
    assert.equal(log.metadataJson.granteeUserId, result.userId);
    assert.deepEqual(log.metadataJson.roleDiff, { addedRoleIds: ['role-sales'], removedRoleIds: [] });
  });

  it('rejects when a role id is unknown', async () => {
    const { useCase } = makeUseCase({ roles: [] });
    await assert.rejects(() => useCase.execute(baseCommand), /invalid/i);
  });

  it('rejects granting OWNER through employee provisioning', async () => {
    const { useCase } = makeUseCase({ roles: [{ id: 'role-owner', key: 'OWNER' }] });
    await assert.rejects(
      () => useCase.execute({ ...baseCommand, roleIds: ['role-owner'] }),
      /cannot be granted/,
    );
  });

  it('rejects granting SYSTEM_ADMIN through employee provisioning', async () => {
    const { useCase } = makeUseCase({ roles: [{ id: 'role-sysadmin', key: 'SYSTEM_ADMIN' }] });
    await assert.rejects(
      () => useCase.execute({ ...baseCommand, roleIds: ['role-sysadmin'] }),
      /cannot be granted/,
    );
  });

  it('rejects granting permissions the requester does not hold', async () => {
    const { useCase } = makeUseCase({ roles: [{ id: 'role-custom', key: 'CUSTOM', permissions: [{ permission: { key: 'accounting.payment.create' } }] }] });
    await assert.rejects(
      () => useCase.execute({ ...baseCommand, roleIds: ['role-custom'] }),
      /does not hold/,
    );
  });

  it('allows a role when the resolver proves its disabled-feature permission belongs to the requester', async () => {
    const permissions = [
      { permission: { key: 'access.employee.read' } },
      { permission: { key: 'crm.customer.read' } },
    ];
    const { useCase, state } = makeUseCase({
      roles: [{ id: 'role-custom', key: 'CUSTOM', permissions }],
    });

    await useCase.execute({
      ...baseCommand,
      roleIds: ['role-custom'],
      requesterPermissions: ['access.employee.read'],
      requesterEntitlementDeniedPermissions: { 'crm.customer.read': 'crm' },
    });

    assert.equal(state.membershipRoles[0].roleId, 'role-custom');
  });

  it('requires owner approval to grant FINANCE even when the requester holds its permissions', async () => {
    const permissions = [{ permission: { key: 'accounting.payment.create' } }];
    const { useCase } = makeUseCase({ roles: [{ id: 'role-finance', key: 'FINANCE', permissions }] });
    await assert.rejects(
      () => useCase.execute({ ...baseCommand, roleIds: ['role-finance'], requesterPermissions: ['accounting.payment.create'] }),
      /owner approval/,
    );
  });

  it('rejects duplicate identity number within the company', async () => {
    const { useCase } = makeUseCase({ existingIdentity: true });
    await assert.rejects(
      () => useCase.execute(baseCommand),
      (err: Error & { getResponse?: () => { code?: string } }) => {
        assert.match(err.message, /ID\/passport already exists/);
        assert.equal(err.getResponse?.().code, 'employee_identity_conflict');
        return true;
      },
    );
  });

  it('rejects duplicate phone number within the company', async () => {
    const { useCase } = makeUseCase({ existingPhone: true });
    await assert.rejects(
      () => useCase.execute(baseCommand),
      (err: Error & { getResponse?: () => { code?: string } }) => {
        assert.match(err.message, /phone number already exists/);
        assert.equal(err.getResponse?.().code, 'employee_phone_conflict');
        return true;
      },
    );
  });

  it('resumes the same draft identity instead of creating a duplicate employee', async () => {
    const { useCase, state } = makeUseCase();
    const first = await useCase.execute(baseCommand);
    const resumed = await useCase.execute({ ...baseCommand, displayName: 'Somchai Updated', nickname: 'ชัย' });

    assert.equal(resumed.employeeId, first.employeeId);
    assert.equal(state.users.length, 1);
    assert.equal(state.profiles.length, 1);
    assert.equal(state.profiles[0].displayName, 'Somchai Updated');
    assert.equal(state.profiles[0].nickname, 'ชัย');
    assert.equal(state.profiles[0].status, 'DRAFT');
    assert.equal(resumed.mustChangePassword, true);
    assert.equal(state.credentials[0].mustChangePassword, true);
    assert.equal(state.auditLogs.at(-1).metadataJson.resumedDraft, true);
  });

  // R8 (spec branch-scope-visibility): the create path never carries a branch scope of its own, but
  // resuming a draft rewrites roles on a membership the wizard's follow-up update may have narrowed.
  it('widens a narrowed draft membership when the resumed draft carries an all-branch role', async () => {
    const { useCase, state } = makeUseCase({ roles: [{ id: 'role-accountant', key: 'ACCOUNTANT' }] });
    const cmd = { ...baseCommand, roleIds: ['role-accountant'], requesterPermissions: ['access.role.financial.assign'] };
    await useCase.execute(cmd);
    // what the wizard's follow-up updateEmployee call would have written on the first pass
    Object.assign(state.memberships[0], { branchScopeMode: 'SELECTED_BRANCHES', defaultBranchId: 'branch-1' });
    state.branchScopes.push({ membershipId: state.memberships[0].id, branchId: 'branch-1' });

    await useCase.execute(cmd);

    assert.equal(state.memberships[0].branchScopeMode, 'ALL_BRANCHES');
    assert.equal(state.memberships[0].defaultBranchId, null);
    assert.equal(state.branchScopes.length, 0);
    assert.equal(state.auditLogs.at(-1).metadataJson.branchScopeWidenedForRole, 'ACCOUNTANT');
  });

  it('leaves a resumed draft with a branch-scopable role narrowed as it was', async () => {
    const { useCase, state } = makeUseCase();
    await useCase.execute(baseCommand);
    Object.assign(state.memberships[0], { branchScopeMode: 'SELECTED_BRANCHES', defaultBranchId: 'branch-1' });
    state.branchScopes.push({ membershipId: state.memberships[0].id, branchId: 'branch-1' });

    await useCase.execute(baseCommand);

    assert.equal(state.memberships[0].branchScopeMode, 'SELECTED_BRANCHES');
    assert.equal(state.branchScopes.length, 1);
  });

  it('activates both the employee profile and membership only when the draft is completed', async () => {
    const { useCase, state } = makeUseCase();
    const created = await useCase.execute(baseCommand);

    const completed = await useCase.completeDraft({
      companyId: COMPANY_ID,
      employeeId: created.employeeId,
      requestingUserId: 'admin-1',
      requestId: 'req-complete',
    });

    assert.equal(completed.status, 'ACTIVE');
    assert.equal(state.profiles[0].status, 'ACTIVE');
    assert.equal(state.memberships[0].status, 'ACTIVE');
    assert.equal(state.auditLogs.at(-1).metadataJson.transition, 'DRAFT_TO_ACTIVE');
  });

  it('still rejects the identity after its draft has been completed', async () => {
    const { useCase } = makeUseCase();
    const created = await useCase.execute(baseCommand);
    await useCase.completeDraft({
      companyId: COMPANY_ID,
      employeeId: created.employeeId,
      requestingUserId: 'admin-1',
      requestId: 'req-complete',
    });

    await assert.rejects(() => useCase.execute(baseCommand), /ID\/passport already exists/);
  });

  it('rejects when no roles are provided', async () => {
    const { useCase } = makeUseCase();
    await assert.rejects(() => useCase.execute({ ...baseCommand, roleIds: [] }), /at least one role/i);
  });

  it('prompts to confirm (employee_existing_user) when the username matches an existing account and linkExistingUser is not set', async () => {
    const { useCase, state } = makeUseCase({ existingUsers: [{ id: 'owner-a', username: 'somchai.j' }] });
    await assert.rejects(
      () => useCase.execute(baseCommand),
      (err: Error & { getResponse?: () => { code?: string } }) => {
        assert.equal(err.getResponse?.().code, 'employee_existing_user');
        return true;
      },
    );
    // nothing is created until the owner confirms
    assert.equal(state.memberships.length, 0);
    assert.equal(state.profiles.length, 0);
    assert.equal(state.users.length, 1);
  });

  it('attaches an existing user as a second-company draft without a new login or credential reset', async () => {
    const { useCase, state } = makeUseCase({ existingUsers: [{ id: 'owner-a', username: 'somchai.j', email: 'owner@a.co.th' }] });
    const result = await useCase.execute({ ...baseCommand, linkExistingUser: true, email: 'somchai.b@work.co.th' });

    // reuses the existing user; no new user row and no credential written/reset
    assert.equal(state.users.length, 1);
    assert.equal(state.users[0].id, 'owner-a');
    assert.equal(state.credentials.length, 0);
    // a second company membership + roles + access profile, all as a draft
    assert.equal(state.memberships.length, 1);
    assert.equal(state.memberships[0].userId, 'owner-a');
    assert.equal(state.memberships[0].status, 'DRAFT');
    assert.equal(state.membershipRoles.length, 1);
    assert.equal(state.profiles.length, 1);
    assert.equal(state.profiles[0].userId, 'owner-a');
    assert.equal(state.profiles[0].status, 'DRAFT');
    // the company-scoped email is stored on the profile, never on the shared user
    assert.equal(state.profiles[0].email, 'somchai.b@work.co.th');
    assert.equal(state.users[0].email, 'owner@a.co.th');
    // handoff signals an existing account and issues no temporary password
    assert.equal(result.reusedExistingAccount, true);
    assert.equal(result.temporaryPassword, '');
    assert.equal(result.userId, 'owner-a');
    assert.ok(result.lineLink, 'lineLink package must be returned');
    assert.equal(state.auditLogs.at(-1).metadataJson.reusedExistingUser, true);
  });

  it('requires a company email that differs from the existing account when attaching', async () => {
    const { useCase } = makeUseCase({ existingUsers: [{ id: 'owner-a', username: 'somchai.j', email: 'owner@a.co.th' }] });
    const expectMustDiffer = (err: Error & { getResponse?: () => { code?: string } }) => {
      assert.equal(err.getResponse?.().code, 'employee_email_must_differ');
      return true;
    };
    // same as the existing account's login email → rejected (case-insensitive)
    await assert.rejects(() => useCase.execute({ ...baseCommand, linkExistingUser: true, email: 'OWNER@a.co.th' }), expectMustDiffer);
    // no company email provided → rejected
    await assert.rejects(() => useCase.execute({ ...baseCommand, linkExistingUser: true, email: undefined }), expectMustDiffer);
  });

  it('resumes an attached user draft without resetting the shared login', async () => {
    const { useCase, state } = makeUseCase({ existingUsers: [{ id: 'owner-a', username: 'somchai.j' }] });
    state.users[0].displayName = 'Original Owner A';
    // owner-a already belongs to another company
    state.memberships.push({ id: 'm-a', userId: 'owner-a', companyId: 'company-a', status: 'ACTIVE' });
    await useCase.execute({ ...baseCommand, linkExistingUser: true, email: 'somchai.b@work.co.th' });

    // re-submitting the same identity resumes the draft instead of creating a duplicate
    const resumed = await useCase.execute(baseCommand);

    assert.equal(resumed.reusedExistingAccount, true);
    assert.equal(resumed.temporaryPassword, '');
    // the shared user row and credential are never touched
    assert.equal(state.credentials.length, 0);
    assert.equal(state.users[0].displayName, 'Original Owner A');
    assert.equal(state.auditLogs.at(-1).metadataJson.reusedExistingUser, true);
  });

  it('persists the additive wizard fields (email on the user, the rest on the profile)', async () => {
    const { useCase, state } = makeUseCase();
    await useCase.execute({
      ...baseCommand,
      email: 'somchai@example.com',
      firstName: 'Somchai',
      lastName: 'Jaidee',
      nickname: 'มีน',
      jobTitle: '  เจ้าหน้าที่ฝ่ายขาย  ',
      dateOfBirth: '1998-09-28',
      addressLine: '45/1 Sukhumvit Soi 1',
      postalCode: '10110',
    });

    assert.equal(state.users[0].email, 'somchai@example.com');
    assert.equal(state.profiles[0].firstName, 'Somchai');
    assert.equal(state.profiles[0].lastName, 'Jaidee');
    assert.equal(state.profiles[0].nickname, 'มีน');
    assert.equal(state.profiles[0].jobTitle, 'เจ้าหน้าที่ฝ่ายขาย');
    assert.equal(state.profiles[0].dateOfBirth.toISOString().slice(0, 10), '1998-09-28');
    assert.equal(state.profiles[0].addressLine, '45/1 Sukhumvit Soi 1');
    assert.equal(state.profiles[0].postalCode, '10110');
  });
});

// UAT 2026-08-15: คำนำหน้า is now its own column instead of being concatenated into displayName.
describe('CreateEmployeeUseCase title prefix', () => {
  it('stores the title beside the name, leaving displayName free of it', async () => {
    const { useCase, state } = makeUseCase();
    await useCase.execute({ ...baseCommand, displayName: 'มีนา ใจงาม', titlePrefix: 'นางสาว' });

    assert.equal(state.profiles[0].titlePrefix, 'นางสาว');
    assert.equal(state.profiles[0].displayName, 'มีนา ใจงาม');
    // The account name is the person's name; the title is a profile field and never reaches User.
    assert.equal(state.users[0].displayName, 'มีนา ใจงาม');
  });

  it('carries a corrected title through a resumed draft', async () => {
    const { useCase, state } = makeUseCase();
    await useCase.execute({ ...baseCommand, displayName: 'มีนา ใจงาม', titlePrefix: 'นาย' });
    await useCase.execute({ ...baseCommand, displayName: 'มีนา ใจงาม', titlePrefix: 'นางสาว' });

    assert.equal(state.profiles.length, 1);
    assert.equal(state.profiles[0].titlePrefix, 'นางสาว');
  });

  it('leaves the column empty when no title is sent, rather than inventing one', async () => {
    const { useCase, state } = makeUseCase();
    await useCase.execute(baseCommand);
    assert.equal(state.profiles[0].titlePrefix, undefined);
  });
});

describe('CreateEmployeeUseCase job title', () => {
  it('updates a descriptive job title without changing the assigned role', async () => {
    const { useCase, state } = makeUseCase();
    await useCase.execute({ ...baseCommand, jobTitle: 'พนักงานขาย' });
    await useCase.execute({ ...baseCommand, jobTitle: 'หัวหน้าฝ่ายขาย' });

    assert.equal(state.profiles.length, 1);
    assert.equal(state.profiles[0].jobTitle, 'หัวหน้าฝ่ายขาย');
    assert.deepEqual(state.membershipRoles.map((row) => row.roleId), ['role-sales']);
  });
});
