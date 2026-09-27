import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RequestMethod } from '@nestjs/common';
import { validateSync } from 'class-validator';
import { CreateEmployeeDto, UpdateEmployeeDto } from '../../presentation/http/employee-access.dtos';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { REQUIRED_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';
import { EmployeeController } from '../../presentation/http/employee.controller';
import { SetEmployeeStatusUseCase } from './set-employee-status.use-case';
import { IssueEmployeeLineLinkTokenUseCase } from './issue-employee-line-link-token.use-case';

const COMPANY_ID = 'company-1';
const PROFILE = { id: 'profile-1', companyId: COMPANY_ID, userId: 'user-1', membershipId: 'membership-1' };

/**
 * targetRoleRows: what membershipRole.findMany returns for the target (default: plain Sales).
 * seats: P29 plan limits. `planTerm: null` (the default) is a grandfathered company, so every
 * pre-existing test below keeps its pre-P29 behaviour of no cap at all.
 */
function makePrisma(targetRoleRows: Array<{ role: { key: string; permissions: Array<{ permission: { key: string } }> } }> = [
  { role: { key: 'SALES', permissions: [{ permission: { key: 'crm.customer.read' } }] } },
], seats: { planTerm?: { employeeLimit: number } | null; activeMemberships?: number } = {}) {
  const state = { profileStatus: 'ACTIVE', membershipStatus: 'ACTIVE', auditLogs: [] as any[], tokens: [] as any[], aiPurges: [] as any[] };
  const tx = {
    $queryRaw: async () => [],
    membershipRole: { findMany: async () => targetRoleRows },
    branch: { count: async () => 1 },
    // The seat gate runs on `tx`, inside the same transaction as the status write.
    companyPlanTerm: { findUnique: async () => seats.planTerm ?? null },
    employeeAccessProfile: {
      findFirst: async ({ where }: any) => where.id === PROFILE.id && where.companyId === COMPANY_ID ? { ...PROFILE, status: state.profileStatus } : null,
      update: async ({ data }: any) => { state.profileStatus = data.status ?? state.profileStatus; },
    },
    companyMembership: {
      findUniqueOrThrow: async () => ({ branchScopeMode: 'ALL_BRANCHES', defaultBranchId: null, branchScopes: [] }),
      // P29 seat count: ACTIVE non-SYSTEM_ADMIN memberships already held by the company. The one
      // being re-enabled is NOT among them — it is still SUSPENDED/DISABLED when the gate reads.
      count: async () => seats.activeMemberships ?? 0,
      update: async ({ data }: any) => { state.membershipStatus = data.status ?? state.membershipStatus; },
    },
    aiConversation: {
      findMany: async () => [],
      deleteMany: async ({ where }: any) => { state.aiPurges.push(where); return { count: 2 }; },
    },
    employeeLineLinkToken: {
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const t of state.tokens) {
          if (t.membershipId === where.membershipId && t.status === where.status) {
            t.status = data.status;
            count++;
          }
        }
        return { count };
      },
      create: async ({ data }: any) => { state.tokens.push({ status: 'PENDING', ...data }); return data; },
    },
    auditLog: { create: async ({ data }: any) => { state.auditLogs.push(data); } },
  };

  const prisma = {
    client: {
      employeeAccessProfile: {
        findFirst: async () => PROFILE,
        findFirstOrThrow: async () => ({
          ...PROFILE,
          displayName: 'Somchai Jaidee',
          legalName: null,
          identityType: 'THAI_NATIONAL_ID',
          identityLast4: '0123',
          phoneNumber: '0812345678',
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { credential: null, externalIdentities: [] },
          membership: { roles: [] },
          status: state.profileStatus,
        }),
      },
      membershipRole: { findMany: async () => targetRoleRows },
      $transaction: async (fn: any) => fn(tx),
    },
  } as any;

  return { prisma, state };
}

const ADMIN_PERMS = ['access.employee.disable', 'access.role.manage'];
const MANAGER_PERMS = ['access.employee.read', 'access.employee.update', 'access.employee.disable', 'access.role.read'];

it('validates exactly one role at both employee HTTP write boundaries', () => {
  for (const Dto of [CreateEmployeeDto, UpdateEmployeeDto]) {
    for (const roleIds of [[], ['sales', 'staff'], ['sales', 'sales']]) {
      assert.ok(validateSync(Object.assign(new Dto(), { roleIds })).some((error) => error.property === 'roleIds'));
    }
    assert.equal(validateSync(Object.assign(new Dto(), { roleIds: ['sales'] })).some((error) => error.property === 'roleIds'), false);
  }
  assert.equal(validateSync(new UpdateEmployeeDto()).some((error) => error.property === 'roleIds'), false);
});

it('binds draft deletion to the existing disable permission and forwards only trusted request context', async () => {
  const handler = EmployeeController.prototype.deleteDraft;
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), ':employeeId/draft');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.DELETE);
  assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, handler), 204);
  assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), ['access.employee.disable']);
  const seen: unknown[] = [];
  const controller = new EmployeeController(...[
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    { execute: async (command: unknown) => { seen.push(command); } },
  ] as unknown as ConstructorParameters<typeof EmployeeController>);
  await controller.deleteDraft({ companyId: 'trusted-company', userId: 'actor', permissions: ['access.employee.disable'], requestId: 'req' } as any, 'employee');
  assert.deepEqual(seen, [{ companyId: 'trusted-company', employeeId: 'employee', requestingUserId: 'actor', requesterPermissions: ['access.employee.disable'], requestId: 'req' }]);
});

describe('SetEmployeeStatusUseCase', () => {
  it('disables both the access profile and the underlying membership together', async () => {
    const { prisma, state } = makePrisma();
    const useCase = new SetEmployeeStatusUseCase(prisma);
    await useCase.execute({ companyId: COMPANY_ID, employeeId: PROFILE.id, status: 'DISABLED', requestingUserId: 'admin-1', requesterPermissions: ADMIN_PERMS, requestId: 'req-1' });

    assert.equal(state.profileStatus, 'DISABLED');
    assert.equal(state.membershipStatus, 'DISABLED');
    assert.equal(state.auditLogs[0].action, 'access.employee.disable');
    assert.deepEqual(state.aiPurges, [{ companyId: COMPANY_ID, userId: 'user-1', channelKind: null }]);
    assert.equal(state.auditLogs[0].metadataJson.aiConversationsPurged, 2);
  });

  it('re-enabling sets both back to ACTIVE', async () => {
    const { prisma, state } = makePrisma();
    const useCase = new SetEmployeeStatusUseCase(prisma);
    await useCase.execute({ companyId: COMPANY_ID, employeeId: PROFILE.id, status: 'ACTIVE', requestingUserId: 'admin-1', requesterPermissions: ADMIN_PERMS, requestId: 'req-1' });

    assert.equal(state.profileStatus, 'ACTIVE');
    assert.equal(state.membershipStatus, 'ACTIVE');
    assert.equal(state.aiPurges.length, 0);
  });

  it('does not change draft status outside the employee wizard', async () => {
    const { prisma } = makePrisma();
    prisma.client.employeeAccessProfile.findFirst = async () => ({ ...PROFILE, status: 'DRAFT' });

    for (const status of ['ACTIVE', 'SUSPENDED', 'DISABLED'] as const) {
      await assert.rejects(
        () => new SetEmployeeStatusUseCase(prisma).execute({ companyId: COMPANY_ID, employeeId: PROFILE.id, status, requestingUserId: 'admin-1', requesterPermissions: ADMIN_PERMS, requestId: 'req-1' }),
        /can only be changed by completing the employee wizard/,
      );
    }
  });

  it('never suspends/disables an OWNER target (last-owner lockout protection)', async () => {
    const { prisma } = makePrisma([{ role: { key: 'OWNER', permissions: [] } }]);
    await assert.rejects(
      () => new SetEmployeeStatusUseCase(prisma).execute({ companyId: COMPANY_ID, employeeId: PROFILE.id, status: 'DISABLED', requestingUserId: 'admin-1', requesterPermissions: ADMIN_PERMS, requestId: 'req-1' }),
      /Owner and platform access cannot be suspended/,
    );
  });

  it('blocks a Manager (no access.role.manage) from suspending a people-manager target', async () => {
    const { prisma } = makePrisma([{ role: { key: 'ADMIN', permissions: [{ permission: { key: 'access.role.manage' } }] } }]);
    await assert.rejects(
      () => new SetEmployeeStatusUseCase(prisma).execute({ companyId: COMPANY_ID, employeeId: PROFILE.id, status: 'SUSPENDED', requestingUserId: 'manager-1', requesterPermissions: MANAGER_PERMS, requestId: 'req-1' }),
      /requires access\.role\.manage/,
    );
  });

  /**
   * P29 §4D. Creating and completing an employee both cost a seat, but re-enabling a disabled one
   * did not — so a company at its cap could disable one employee, activate another, then re-enable
   * the first and sit permanently over its limit.
   */
  describe('seat cap on re-enable', () => {
    const REENABLE = { companyId: COMPANY_ID, employeeId: PROFILE.id, status: 'ACTIVE' as const, requestingUserId: 'admin-1', requesterPermissions: ADMIN_PERMS, requestId: 'req-1' };
    /** A target that is currently DISABLED — the state a re-enable actually starts from. */
    const disabledTarget = (seats: { planTerm?: { employeeLimit: number } | null; activeMemberships?: number }) => {
      const made = makePrisma(undefined, seats);
      made.state.profileStatus = 'DISABLED';
      made.state.membershipStatus = 'DISABLED';
      made.prisma.client.employeeAccessProfile.findFirst = async () => ({ ...PROFILE, status: 'DISABLED' });
      return made;
    };

    it('refuses a re-enable past the cap with the same 422 the create path throws', async () => {
      const { prisma, state } = disabledTarget({ planTerm: { employeeLimit: 2 }, activeMemberships: 2 });

      await assert.rejects(
        () => new SetEmployeeStatusUseCase(prisma).execute(REENABLE),
        (err: any) => {
          assert.equal(err.getResponse().statusCode, 422);
          assert.equal(err.getResponse().message, 'แพ็กเกจปัจจุบันเพิ่มพนักงานได้สูงสุด 2 คน — ติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ');
          return true;
        },
      );
      assert.equal(state.membershipStatus, 'DISABLED', 'the refused transaction wrote nothing');
      assert.equal(state.profileStatus, 'DISABLED');
      assert.deepEqual(state.auditLogs, []);
    });

    it('allows the re-enable that lands exactly on the cap', async () => {
      // Limit 2 with one seat taken: the membership being re-enabled is still DISABLED when the gate
      // reads the count, so it sees 1 < 2 and this becomes the second seat. No off-by-one refusal.
      const { prisma, state } = disabledTarget({ planTerm: { employeeLimit: 2 }, activeMemberships: 1 });

      await new SetEmployeeStatusUseCase(prisma).execute(REENABLE);

      assert.equal(state.profileStatus, 'ACTIVE');
      assert.equal(state.membershipStatus, 'ACTIVE');
    });

    it('leaves a grandfathered company with no plan-term row unlimited', async () => {
      const { prisma, state } = disabledTarget({ planTerm: null, activeMemberships: 99 });

      await new SetEmployeeStatusUseCase(prisma).execute(REENABLE);

      assert.equal(state.membershipStatus, 'ACTIVE');
    });

    it('keeps re-activating an already-ACTIVE employee a no-op success at the cap', async () => {
      // Gated on the transition, not the target status: this membership is already inside the count,
      // so checking it would refuse a request that changes nothing.
      const { prisma, state } = makePrisma(undefined, { planTerm: { employeeLimit: 1 }, activeMemberships: 1 });
      prisma.client.employeeAccessProfile.findFirst = async () => ({ ...PROFILE, status: 'ACTIVE' });

      await new SetEmployeeStatusUseCase(prisma).execute(REENABLE);

      assert.equal(state.profileStatus, 'ACTIVE');
      assert.equal(state.membershipStatus, 'ACTIVE');
    });

    it('never blocks suspend or disable at the cap — they free a seat, they do not take one', async () => {
      for (const status of ['SUSPENDED', 'DISABLED'] as const) {
        const { prisma, state } = makePrisma(undefined, { planTerm: { employeeLimit: 1 }, activeMemberships: 5 });
        prisma.client.employeeAccessProfile.findFirst = async () => ({ ...PROFILE, status: 'ACTIVE' });

        await new SetEmployeeStatusUseCase(prisma).execute({ ...REENABLE, status });

        assert.equal(state.membershipStatus, status);
      }
    });
  });

  it('lets a Manager suspend a plain Sales employee', async () => {
    const { prisma, state } = makePrisma();
    await new SetEmployeeStatusUseCase(prisma).execute({ companyId: COMPANY_ID, employeeId: PROFILE.id, status: 'SUSPENDED', requestingUserId: 'manager-1', requesterPermissions: MANAGER_PERMS, requestId: 'req-1' });
    assert.equal(state.profileStatus, 'SUSPENDED');
  });
});

describe('IssueEmployeeLineLinkTokenUseCase', () => {
  it('issues a token and returns a URL embedding it, never the raw token alone in the audit log', async () => {
    const { prisma, state } = makePrisma();
    const useCase = new IssueEmployeeLineLinkTokenUseCase(prisma, { lineLiffId: '2010784350-ruzn5beM' } as any);
    const result = await useCase.execute({
      companyId: COMPANY_ID,
      employeeId: PROFILE.id,
      requestingUserId: 'admin-1',
      requestId: 'req-1',
      apiBaseUrl: 'https://api.example.com/v1',
    });

    assert.match(result.linkUrl, /^https:\/\/liff\.line\.me\/2010784350-ruzn5beM\/employee\?token=/);
    assert.equal(state.tokens.length, 1);
    assert.equal(state.tokens[0].status, 'PENDING');
    assert.equal(state.auditLogs[0].action, 'access.employee.line_link.issue');
    assert.ok(!JSON.stringify(state.auditLogs).includes('token='));
  });

  it('revokes prior pending tokens for the same membership before issuing a new one', async () => {
    const { prisma, state } = makePrisma();
    const useCase = new IssueEmployeeLineLinkTokenUseCase(prisma, { lineLiffId: '2010784350-ruzn5beM' } as any);
    await useCase.execute({ companyId: COMPANY_ID, employeeId: PROFILE.id, requestingUserId: 'admin-1', requestId: 'req-1', apiBaseUrl: 'https://api.example.com/v1' });
    await useCase.execute({ companyId: COMPANY_ID, employeeId: PROFILE.id, requestingUserId: 'admin-1', requestId: 'req-2', apiBaseUrl: 'https://api.example.com/v1' });

    const pending = state.tokens.filter((t) => t.status === 'PENDING');
    const revoked = state.tokens.filter((t) => t.status === 'REVOKED');
    assert.equal(pending.length, 1);
    assert.equal(revoked.length, 1);
  });
});
