import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreateEmployeeUseCase } from './create-employee.use-case';
import { DeleteEmployeeDraftUseCase } from './delete-employee-draft.use-case';
import { IssueEmployeeLineLinkTokenUseCase } from './issue-employee-line-link-token.use-case';
import { ListEmployeesUseCase } from './list-employees.use-case';
import { GetEmployeeUseCase } from './get-employee.use-case';
import { verifyPassword } from '../../../auth/domain/logic/password-credential.logic';

const KEY = Buffer.from('a'.repeat(64), 'hex');
const COMPANY_ID = 'company-1';

function makeUseCase(opts: { roles?: Array<{ id: string; key: string; permissions?: Array<{ permission: { key: string } }> }>; existingIdentity?: boolean; existingPhone?: boolean; existingUsers?: Array<{ id: string; username: string; status?: string; email?: string }>; planTerm?: { employeeLimit: number } | null; activeMemberships?: number } = {}) {
  const roles = (opts.roles ?? [{ id: 'role-sales', key: 'SALES' }]).map((role) => ({ ...role, permissions: role.permissions ?? [] }));
  const state = { users: [] as any[], credentials: [] as any[], memberships: [] as any[], membershipRoles: [] as any[], profiles: [] as any[], auditLogs: [] as any[], lineLinkTokens: [] as any[], branchScopes: [] as any[] };
  for (const u of opts.existingUsers ?? []) state.users.push({ status: 'ACTIVE', ...u });
  // P29 seat cap: pre-existing ACTIVE employees of this company.
  for (let seat = 0; seat < (opts.activeMemberships ?? 0); seat++) {
    state.memberships.push({ id: `seat-${seat}`, companyId: COMPANY_ID, userId: `seat-user-${seat}`, status: 'ACTIVE' });
  }
  let sequence = 0;
  const controls = { beforeTransaction: undefined as (() => Promise<void>) | undefined, locks: [] as string[][] };
  const findProfile = async ({ where, include }: any) => {
    const row = state.profiles.find((item) => item.id === where.id && item.companyId === where.companyId);
    if (!row) return null;
    return include ? profileWithRelations(row) : { ...row };
  };
  const profileWithRelations = (row: any) => ({
    ...row,
    user: { ...state.users.find((user) => user.id === row.userId), credential: state.credentials.find((c) => c.userId === row.userId), externalIdentities: [] },
    membership: { ...state.memberships.find((m) => m.id === row.membershipId), roles: state.membershipRoles.filter((m) => m.membershipId === row.membershipId).map((m) => ({ role: roles.find((r) => r.id === m.roleId) })), branchScopes: [] },
  });

  // P29: `planTerm: null` (the default) is a grandfathered company — every pre-existing test below
  // runs with no seat cap, exactly as a pre-P29 customer does. Shared by both clients on purpose:
  // execute() runs the seat gate on `prisma.client` and completeDraft() runs it on `tx` inside the
  // row lock, and the two must count seats identically or the gate has a hole between them.
  const companyPlanTermFake = { findUnique: async () => opts.planTerm ?? null };
  const countMemberships = async ({ where }: any) => {
    // P29 seat count: ACTIVE non-SYSTEM_ADMIN memberships of one company.
    if (typeof where.companyId === 'string' && where.status === 'ACTIVE') {
      return state.memberships.filter((m) => m.companyId === where.companyId && m.status === 'ACTIVE').length;
    }
    return state.memberships.filter(
      (m) => m.userId === where.userId && (where.companyId?.not ? m.companyId !== where.companyId.not : true),
    ).length;
  };

  const tx = {
    companyPlanTerm: companyPlanTermFake,
    $queryRaw: async (strings: TemplateStringsArray, ...values: string[]) => {
      assert.match(strings.join('?'), /FROM "EmployeeAccessProfile" WHERE "id" = \? AND "companyId" = \? FOR UPDATE/);
      controls.locks.push(values);
      return [];
    },
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
      count: countMemberships,
      findUniqueOrThrow: async ({ where }: any) => ({
        ...state.memberships.find((item) => item.id === where.id),
        branchScopes: state.branchScopes.filter((scope) => scope.membershipId === where.id),
      }),
      create: async ({ data }: any) => {
        const row = { id: `membership-${++sequence}`, ...data };
        state.memberships.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = state.memberships.find((item) => item.id === where.id);
        if (row) Object.assign(row, data);
        return row ?? { id: where.id, ...data };
      },
      deleteMany: async ({ where }: any) => {
        const row = state.memberships.find((m) => m.id === where.id && m.companyId === where.companyId && m.userId === where.userId && m.status === where.status);
        if (!row) return { count: 0 };
        state.memberships = state.memberships.filter((m) => m.id !== row.id);
        state.profiles = state.profiles.filter((p) => p.membershipId !== row.id);
        state.membershipRoles = state.membershipRoles.filter((r) => r.membershipId !== row.id);
        state.branchScopes = state.branchScopes.filter((b) => b.membershipId !== row.id);
        return { count: 1 };
      },
    },
    membershipRole: {
      findMany: async ({ where }: any) => state.membershipRoles.filter((row) => row.membershipId === where.membershipId).map((row) => ({ ...row, role: roles.find((role) => role.id === row.roleId) })),
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
      findFirst: findProfile,
      create: async ({ data }: any) => {
        const row = { id: `profile-${++sequence}`, createdAt: new Date(), updatedAt: new Date(), ...data };
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
      create: async ({ data }: any) => { const row = { status: 'PENDING', ...data }; state.lineLinkTokens.push(row); return row; },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of state.lineLinkTokens) {
          if (row.membershipId === where.membershipId && row.status === where.status && (!where.companyId || row.companyId === where.companyId)) {
            Object.assign(row, data);
            count++;
          }
        }
        return { count };
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
      companyPlanTerm: companyPlanTermFake,
      companyMembership: { count: countMemberships },
      employeeAccessProfile: {
        findMany: async ({ where }: any) => state.profiles.filter((row) => row.companyId === where.companyId).map(profileWithRelations),
        findFirst: async ({ where }: any) => {
          if (where.id) return findProfile({ where });
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
      // Deterministic committed interleavings, not a substitute for Postgres row-lock verification.
      $transaction: async (fn: any) => {
        const before = controls.beforeTransaction;
        controls.beforeTransaction = undefined;
        if (before) await before();
        const snapshot = structuredClone(state);
        try { return await fn(tx); } catch (error) { Object.assign(state, snapshot); throw error; }
      },
    },
  } as any;

  const config = { credentialEncryptionKey: KEY } as any;
  const useCase = new CreateEmployeeUseCase(prisma, config);
  return { useCase, state, prisma, tx, controls, config, roles };
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

  it('rejects multiple or repeated roles before creating any employee records', async () => {
    const { useCase, state } = makeUseCase({ roles: [
      { id: 'role-staff', key: 'STAFF' },
      { id: 'role-reviewer', key: 'REIMBURSEMENT_REVIEWER' },
    ] });

    for (const roleIds of [['role-staff', 'role-reviewer'], ['role-staff', 'role-staff']]) {
      await assert.rejects(() => useCase.execute({ ...baseCommand, roleIds }), /Exactly one employee role/);
    }
    assert.equal(state.users.length, 0);
    assert.equal(state.membershipRoles.length, 0);
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
    const resumed = await useCase.execute({ ...baseCommand, username: 'Somchai.Updated', displayName: 'Somchai Updated', nickname: 'ชัย' });

    assert.equal(resumed.employeeId, first.employeeId);
    assert.equal(state.users.length, 1);
    assert.equal(state.users[0].username, 'somchai.updated');
    assert.equal(resumed.username, state.users[0].username);
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

  it('does not let activation bypass a restricted creator branch assignment', async () => {
    const { useCase, state } = makeUseCase();
    const created = await useCase.execute(baseCommand);
    const cmd = { companyId: COMPANY_ID, employeeId: created.employeeId, requestingUserId: 'manager-1', requesterBranchIds: ['b1'], requestId: 'req-complete' };
    await assert.rejects(() => useCase.completeDraft(cmd), /outside the requester's branch scope/);
    assert.equal(state.profiles[0].status, 'DRAFT');
    assert.equal(state.memberships[0].status, 'DRAFT');
    Object.assign(state.memberships[0], { branchScopeMode: 'SELECTED_BRANCHES', defaultBranchId: 'b2' });
    state.branchScopes.push({ membershipId: state.memberships[0].id, branchId: 'b2' });
    await assert.rejects(() => useCase.completeDraft(cmd), /outside the requester's branch scope/);
    assert.equal(state.profiles[0].status, 'DRAFT');
    state.memberships[0].defaultBranchId = 'b1';
    state.branchScopes[0].branchId = 'b1';
    await useCase.completeDraft(cmd);
    assert.equal(state.profiles[0].status, 'ACTIVE');
    assert.equal(state.memberships[0].status, 'ACTIVE');
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
    await assert.rejects(() => useCase.execute({ ...baseCommand, roleIds: [] }), /Exactly one employee role/);
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
    const resumed = await useCase.execute({ ...baseCommand, username: 'Must.Not.Replace.Shared.Login' });

    assert.equal(resumed.reusedExistingAccount, true);
    assert.equal(resumed.username, 'somchai.j');
    assert.equal(state.users[0].username, 'somchai.j');
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

describe('CreateEmployeeUseCase P29 seat cap', () => {
  it('a company with no plan-term row is unlimited', async () => {
    const { useCase, state } = makeUseCase({ planTerm: null, activeMemberships: 99 });
    await useCase.execute(baseCommand);
    assert.equal(state.profiles.length, 1);
  });

  it('under the limit still creates', async () => {
    const { useCase, state } = makeUseCase({ planTerm: { employeeLimit: 2 }, activeMemberships: 1 });
    await useCase.execute(baseCommand);
    assert.equal(state.profiles.length, 1);
  });

  it('at the limit throws 422 with the Thai package message and writes nothing', async () => {
    const { useCase, state } = makeUseCase({ planTerm: { employeeLimit: 2 }, activeMemberships: 2 });
    await assert.rejects(
      () => useCase.execute(baseCommand),
      (err: any) => {
        assert.equal(err.getResponse().statusCode, 422);
        assert.equal(err.getResponse().message, 'แพ็กเกจปัจจุบันเพิ่มพนักงานได้สูงสุด 2 คน — ติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ');
        return true;
      },
    );
    assert.equal(state.profiles.length, 0);
    assert.equal(state.users.length, 0);
  });

  it('already OVER the limit blocks only the new employee; existing ones are untouched', async () => {
    const { useCase, state } = makeUseCase({ planTerm: { employeeLimit: 1 }, activeMemberships: 5 });
    await assert.rejects(() => useCase.execute(baseCommand), (err: any) => err.getResponse().statusCode === 422);
    assert.equal(state.memberships.length, 5);
    assert.equal(state.profiles.length, 0);
  });

  it('resuming an existing DRAFT is never blocked — it adds no seat', async () => {
    const { useCase, state } = makeUseCase({ planTerm: { employeeLimit: 2 }, activeMemberships: 1 });
    await useCase.execute(baseCommand);
    assert.equal(state.profiles.length, 1);

    // Now at the cap (1 seeded ACTIVE + the cap is 2): a NEW employee would be refused, but this
    // is the same person's draft coming back through the wizard.
    state.memberships.push({ id: 'seat-extra', companyId: COMPANY_ID, userId: 'seat-user-extra', status: 'ACTIVE' });
    await useCase.execute({ ...baseCommand, displayName: 'Somchai Jaidee II' });
    assert.equal(state.profiles.length, 1);
    assert.equal(state.profiles[0].displayName, 'Somchai Jaidee II');
  });
});

/**
 * execute() writes DRAFT rows and the seat count only counts ACTIVE ones, so a cap enforced only on
 * create is no cap at all: stack up drafts under the limit, then Finish every one of them. The gate
 * has to sit on the transition that actually buys the seat.
 */
describe('CreateEmployeeUseCase P29 seat cap on completeDraft', () => {
  const finish = (employeeId: string) => ({
    companyId: COMPANY_ID,
    employeeId,
    requestingUserId: 'admin-1',
    requestId: 'req-complete',
  });

  it('a company with no plan-term row completes drafts unlimited', async () => {
    const { useCase, state } = makeUseCase({ planTerm: null, activeMemberships: 99 });
    const created = await useCase.execute(baseCommand);

    await useCase.completeDraft(finish(created.employeeId));

    assert.equal(state.profiles[0].status, 'ACTIVE');
    assert.equal(state.memberships.at(-1).status, 'ACTIVE');
  });

  it('under the cap completes, and the completed draft is the seat that lands on the limit', async () => {
    // Limit 2, one seat already taken. The draft is still DRAFT when the gate reads the count, so
    // it sees 1 < 2 and lets this completion be the second seat — not an off-by-one refusal.
    const { useCase, state } = makeUseCase({ planTerm: { employeeLimit: 2 }, activeMemberships: 1 });
    const created = await useCase.execute(baseCommand);

    const completed = await useCase.completeDraft(finish(created.employeeId));

    assert.equal(completed.status, 'ACTIVE');
    assert.equal(state.profiles[0].status, 'ACTIVE');
    assert.equal(state.memberships.filter((m: any) => m.status === 'ACTIVE').length, 2);
  });

  it('at the cap refuses the completion with the same 422 the create path throws', async () => {
    const { useCase, state } = makeUseCase({ planTerm: { employeeLimit: 2 }, activeMemberships: 1 });
    const created = await useCase.execute(baseCommand);
    // The company fills its last seat elsewhere while this draft sits in the wizard.
    state.memberships.push({ id: 'seat-late', companyId: COMPANY_ID, userId: 'seat-user-late', status: 'ACTIVE' });

    await assert.rejects(
      () => useCase.completeDraft(finish(created.employeeId)),
      (err: any) => {
        assert.equal(err.getResponse().statusCode, 422);
        assert.equal(err.getResponse().message, 'แพ็กเกจปัจจุบันเพิ่มพนักงานได้สูงสุด 2 คน — ติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ');
        return true;
      },
    );
    // The draft survives the refusal; the customer raises the plan and finishes it later.
    assert.equal(state.profiles[0].status, 'DRAFT');
    assert.equal(state.memberships.find((m: any) => m.id === state.profiles[0].membershipId).status, 'DRAFT');
  });

  it('closes the stacked-draft loophole: drafts created under the cap cannot all be finished', async () => {
    const { useCase, state } = makeUseCase({ planTerm: { employeeLimit: 1 }, activeMemberships: 0 });
    const first = await useCase.execute(baseCommand);
    const second = await useCase.execute({
      ...baseCommand,
      displayName: 'Malee Rakdee',
      username: 'malee.r',
      identityNumber: '9-8765-43210-98-7',
      phoneNumber: '0898765432',
    });
    assert.equal(state.profiles.length, 2, 'both drafts are created: neither consumed a seat yet');

    await useCase.completeDraft(finish(first.employeeId));
    await assert.rejects(
      () => useCase.completeDraft(finish(second.employeeId)),
      (err: any) => err.getResponse().statusCode === 422,
    );

    assert.equal(state.memberships.filter((m: any) => m.status === 'ACTIVE').length, 1);
  });

  it('keeps Finish idempotent at the cap for an already-active employee', async () => {
    // The gate sits below the `status === 'ACTIVE'` early return, so a repeated Finish — a double
    // click, a retried request — must not start failing once the company reaches its limit.
    const { useCase, state } = makeUseCase({ planTerm: { employeeLimit: 1 }, activeMemberships: 0 });
    const created = await useCase.execute(baseCommand);
    await useCase.completeDraft(finish(created.employeeId));

    await useCase.completeDraft(finish(created.employeeId));

    assert.equal(state.profiles[0].status, 'ACTIVE');
    assert.equal(state.memberships.filter((m: any) => m.status === 'ACTIVE').length, 1);
  });
});

describe('company employee draft removal', () => {
  const command = (employeeId: string) => ({
    companyId: COMPANY_ID, employeeId, requestingUserId: 'admin-1',
    requesterPermissions: ['access.employee.disable', 'access.role.manage'], requestId: 'req-delete',
  });
  const hasCode = (code: string) => (error: any) => error.getResponse?.().code === code;

  it('removes only this company draft, releases its identity/phone, revokes pending tokens and audits without PII', async () => {
    const { useCase, prisma, state, controls } = makeUseCase();
    const created = await useCase.execute(baseCommand);
    const membershipId = state.profiles[0].membershipId;
    state.branchScopes.push({ membershipId, branchId: 'branch-1' });
    // The login is also used by a real employee in another company.
    state.memberships.push({ id: 'other-membership', companyId: 'other-company', userId: created.userId, status: 'ACTIVE' });
    state.membershipRoles.push({ membershipId: 'other-membership', roleId: 'role-sales' });
    state.branchScopes.push({ membershipId: 'other-membership', branchId: 'other-branch' });
    state.profiles.push({ ...state.profiles[0], id: 'other-profile', membershipId: 'other-membership', companyId: 'other-company', status: 'ACTIVE' });
    state.lineLinkTokens.push({ companyId: 'other-company', membershipId: 'other-membership', status: 'PENDING' });
    const account = structuredClone({ users: state.users, credentials: state.credentials });

    await new DeleteEmployeeDraftUseCase(prisma).execute(command(created.employeeId));

    assert.deepEqual(await new ListEmployeesUseCase(prisma).execute(COMPANY_ID), []);
    await assert.rejects(() => new GetEmployeeUseCase(prisma).execute(COMPANY_ID, created.employeeId), /not found/i);
    assert.equal(state.profiles[0].id, 'other-profile');
    assert.deepEqual(state.memberships.map((m) => m.id), ['other-membership']);
    assert.deepEqual(state.membershipRoles.map((r) => r.membershipId), ['other-membership']);
    assert.deepEqual(state.branchScopes.map((b) => b.membershipId), ['other-membership']);
    assert.deepEqual({ users: state.users, credentials: state.credentials }, account);
    assert.deepEqual(state.lineLinkTokens.map((t) => t.status), ['REVOKED', 'PENDING']);
    assert.deepEqual(controls.locks, [[created.employeeId, COMPANY_ID]]);
    const audit = state.auditLogs.at(-1);
    assert.equal(audit.action, 'access.employee.draft.delete');
    assert.equal(audit.targetId, created.employeeId);
    assert.equal(audit.actorUserId, 'admin-1');
    assert.equal(audit.companyId, COMPANY_ID);
    assert.deepEqual(audit.metadataJson, { membershipId, userId: created.userId, revokedTokenCount: 1 });
    assert.doesNotMatch(JSON.stringify(audit), /password|identity|phone|tokenHash|dateOfBirth/i);
  });

  it('keeps the existing login and existing-account confirmation/email policy when recreating the deleted identity', async () => {
    const { useCase, prisma, state } = makeUseCase();
    const created = await useCase.execute({ ...baseCommand, email: 'login@example.test' });
    const credential = structuredClone(state.credentials);
    await new DeleteEmployeeDraftUseCase(prisma).execute(command(created.employeeId));

    await assert.rejects(() => useCase.execute(baseCommand), hasCode('employee_existing_user'));
    await assert.rejects(() => useCase.execute({ ...baseCommand, linkExistingUser: true, email: 'login@example.test' }), hasCode('employee_email_must_differ'));
    const recreated = await useCase.execute({ ...baseCommand, linkExistingUser: true, email: 'company@example.test' });
    assert.notEqual(recreated.employeeId, created.employeeId);
    assert.equal(recreated.userId, created.userId);
    assert.equal(recreated.reusedExistingAccount, true);
    assert.equal(recreated.temporaryPassword, '');
    assert.deepEqual(state.credentials, credential);
    assert.equal(state.users.length, 1);
    assert.equal(state.users[0].email, 'login@example.test');
    assert.equal(state.profiles[0].email, 'company@example.test');
    assert.equal(state.profiles[0].phoneNumber, baseCommand.phoneNumber);
    assert.equal(state.profiles[0].status, 'DRAFT');
    await assert.rejects(() => useCase.completeDraft(command(created.employeeId)), hasCode('employee_draft_not_found'));
  });

  it('returns the same safe not-found result for an unknown, cross-company or already-deleted draft', async () => {
    const { useCase, prisma, state } = makeUseCase();
    const { employeeId } = await useCase.execute(baseCommand);
    const remove = new DeleteEmployeeDraftUseCase(prisma);
    const before = structuredClone(state);
    await assert.rejects(() => remove.execute(command('unknown')), hasCode('employee_draft_not_found'));
    await assert.rejects(() => remove.execute({ ...command(employeeId), companyId: 'other-company' }), hasCode('employee_draft_not_found'));
    assert.deepEqual(state, before);
    await remove.execute(command(employeeId));
    const after = structuredClone(state);
    await assert.rejects(() => remove.execute(command(employeeId)), hasCode('employee_draft_not_found'));
    assert.deepEqual(state, after);
  });

  it('denies missing permissions, owner/platform targets and privileged targets without role-management authority', async () => {
    const { useCase, prisma, state, roles } = makeUseCase();
    const { employeeId } = await useCase.execute(baseCommand);
    const remove = new DeleteEmployeeDraftUseCase(prisma);
    const before = structuredClone(state);
    await assert.rejects(() => remove.execute({ ...command(employeeId), requesterPermissions: [] }), (e: any) => e.getStatus() === 403);
    for (const key of ['OWNER', 'SYSTEM_ADMIN']) {
      roles[0].key = key;
      await assert.rejects(() => remove.execute(command(employeeId)), /Owner and platform/);
    }
    roles[0].key = 'ADMIN';
    roles[0].permissions = [{ permission: { key: 'access.role.manage' } }];
    await assert.rejects(() => remove.execute({ ...command(employeeId), requesterPermissions: ['access.employee.disable'] }), /requires access.role.manage/);
    assert.deepEqual(state, before);
    await remove.execute(command(employeeId));
    assert.equal(state.profiles.length, 0);
  });

  it('never deletes a non-draft profile or an active membership, and rolls back token revocation on rejection', async () => {
    for (const status of ['ACTIVE', 'SUSPENDED', 'DISABLED', 'INVITED']) {
      const { useCase, prisma, state } = makeUseCase();
      const { employeeId } = await useCase.execute(baseCommand);
      state.profiles[0].status = status;
      const before = structuredClone(state);
      await assert.rejects(() => new DeleteEmployeeDraftUseCase(prisma).execute(command(employeeId)), hasCode('employee_draft_not_deletable'));
      assert.deepEqual(state, before);
    }
    for (const mismatch of [{ status: 'ACTIVE' }, { companyId: 'other-company' }, { userId: 'other-user' }]) {
      const { useCase, prisma, state } = makeUseCase();
      const { employeeId } = await useCase.execute(baseCommand);
      Object.assign(state.memberships[0], mismatch);
      const before = structuredClone(state);
      await assert.rejects(() => new DeleteEmployeeDraftUseCase(prisma).execute(command(employeeId)), hasCode('employee_draft_not_deletable'));
      assert.deepEqual(state, before);
    }
  });

  it('rolls back removal and revocation if the audit cannot be retained', async () => {
    const { useCase, prisma, state, tx } = makeUseCase();
    const { employeeId } = await useCase.execute(baseCommand);
    const before = structuredClone(state);
    tx.auditLog.create = async () => { throw new Error('audit unavailable'); };
    await assert.rejects(() => new DeleteEmployeeDraftUseCase(prisma).execute(command(employeeId)), /audit unavailable/);
    assert.deepEqual(state, before);
  });

  it('rechecks Finish after a deletion wins, and rejects deletion when Finish wins', async () => {
    const { useCase, prisma, state, controls } = makeUseCase();
    const { employeeId } = await useCase.execute(baseCommand);
    const remove = new DeleteEmployeeDraftUseCase(prisma);
    controls.beforeTransaction = () => remove.execute(command(employeeId));
    await assert.rejects(() => useCase.completeDraft(command(employeeId)), hasCode('employee_draft_not_found'));
    assert.equal(state.profiles.length, 0);
    assert.equal(state.memberships.length, 0);

    const recreated = await useCase.execute({ ...baseCommand, linkExistingUser: true, email: 'company@example.test' });
    controls.beforeTransaction = async () => { await useCase.completeDraft(command(recreated.employeeId)); };
    await assert.rejects(() => remove.execute(command(recreated.employeeId)), hasCode('employee_draft_not_deletable'));
    assert.equal(state.profiles[0].status, 'ACTIVE');
    assert.equal(state.memberships[0].status, 'ACTIVE');
    await useCase.completeDraft(command(recreated.employeeId)); // Finish remains idempotent.
  });

  it('does not let a stale resume recreate a removed draft or reset a completed employee credential', async () => {
    for (const winner of ['delete', 'finish']) {
      const { useCase, prisma, state, controls } = makeUseCase();
      const { employeeId } = await useCase.execute(baseCommand);
      const credential = structuredClone(state.credentials);
      controls.beforeTransaction = async () => {
        if (winner === 'delete') await new DeleteEmployeeDraftUseCase(prisma).execute(command(employeeId));
        else await useCase.completeDraft(command(employeeId));
      };
      await assert.rejects(() => useCase.execute({ ...baseCommand, dateOfBirth: '1990-01-01' }), hasCode(winner === 'delete' ? 'employee_draft_not_found' : 'employee_identity_conflict'));
      assert.deepEqual(state.credentials, credential);
      assert.equal(state.profiles.length, winner === 'delete' ? 0 : 1);
      if (winner === 'finish') assert.equal(state.profiles[0].status, 'ACTIVE');
    }
  });

  it('does not issue an orphan token after deletion, and revokes a token issued just before deletion', async () => {
    for (const winner of ['delete', 'issue']) {
      const { useCase, prisma, state, controls, config } = makeUseCase();
      const { employeeId } = await useCase.execute(baseCommand);
      const remove = new DeleteEmployeeDraftUseCase(prisma);
      const issue = new IssueEmployeeLineLinkTokenUseCase(prisma, config);
      const issueCommand = { ...command(employeeId), apiBaseUrl: baseCommand.apiBaseUrl };
      if (winner === 'delete') {
        controls.beforeTransaction = () => remove.execute(command(employeeId));
        await assert.rejects(() => issue.execute(issueCommand), hasCode('employee_draft_not_found'));
      } else {
        controls.beforeTransaction = async () => { await issue.execute(issueCommand); };
        await remove.execute(command(employeeId));
      }
      assert.equal(state.lineLinkTokens.filter((t) => t.status === 'PENDING').length, 0);
      assert.equal(state.profiles.length, 0);
    }
  });
});
