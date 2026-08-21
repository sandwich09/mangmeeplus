import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  approverModeForRole,
  buildReimbursementApproverRoleOptions,
  GetReimbursementPolicyUseCase,
  UpdateReimbursementPolicyUseCase,
  type ApproverRoleCandidate,
} from './reimbursement-policy.use-case';

const permissions = ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'];
const branches = [{ id: 'b1', name: 'สำนักงานใหญ่' }, { id: 'b2', name: 'สาขาสอง' }];
const holder = (branchIds: string[]): ApproverRoleCandidate['holders'][number] => ({
  branchScopeMode: 'SELECTED_BRANCHES', defaultBranchId: null, branchIds,
});
const role = (overrides: Partial<ApproverRoleCandidate> & Pick<ApproverRoleCandidate, 'key' | 'name'>): ApproverRoleCandidate => ({
  status: 'ACTIVE', permissionKeys: permissions, holders: [], ...overrides,
});

describe('reimbursement approver role options', () => {
  it('returns only executable routes as selectable and uses OWNER for safe branch recovery', () => {
    const options = buildReimbursementApproverRoleOptions([
      role({ key: 'OWNER', name: 'Owner', holders: [holder(['b1', 'b2'])] }),
      role({ key: 'MANAGER', name: 'Manager', holders: [holder(['b1', 'b2'])] }),
      role({ key: 'ACCOUNTANT', name: 'Accountant', holders: [holder(['b1'])] }),
      role({ key: 'FINANCE', name: 'Finance', holders: [] }),
      role({ key: 'STAFF', name: 'Staff', permissionKeys: ['reimbursement.read'], holders: [holder(['b1', 'b2'])] }),
      role({ key: 'SYSTEM_ADMIN', name: 'System Admin', holders: [holder(['b1', 'b2'])] }),
    ], branches);

    assert.equal(options.find((item) => item.key === 'MANAGER')?.coverage, 'COMPLETE');
    assert.equal(options.find((item) => item.key === 'MANAGER')?.selectable, true);
    assert.deepEqual(options.find((item) => item.key === 'ACCOUNTANT')?.uncoveredBranchNames, ['สาขาสอง']);
    assert.equal(options.find((item) => item.key === 'ACCOUNTANT')?.coverage, 'PARTIAL');
    assert.equal(options.find((item) => item.key === 'ACCOUNTANT')?.selectable, true);
    assert.equal(options.find((item) => item.key === 'FINANCE')?.unavailableReason, 'NO_ACTIVE_HOLDERS');
    assert.equal(options.find((item) => item.key === 'STAFF')?.unavailableReason, 'MISSING_CAPABILITY');
    assert.equal(options.some((item) => item.key === 'SYSTEM_ADMIN'), false);
  });

  it('blocks partial coverage when OWNER cannot recover the uncovered branch', () => {
    const options = buildReimbursementApproverRoleOptions([
      role({ key: 'OWNER', name: 'Owner', holders: [holder(['b1'])] }),
      role({ key: 'MANAGER', name: 'Manager', holders: [holder(['b1'])] }),
    ], branches);
    assert.equal(options.find((item) => item.key === 'MANAGER')?.selectable, false);
    assert.equal(options.find((item) => item.key === 'MANAGER')?.unavailableReason, 'OWNER_RECOVERY_NOT_READY');
  });

  it('does not use OWNER as recovery when the role lacks approval capability', () => {
    const options = buildReimbursementApproverRoleOptions([
      role({ key: 'OWNER', name: 'Owner', permissionKeys: ['reimbursement.read'], holders: [holder(['b1', 'b2'])] }),
      role({ key: 'MANAGER', name: 'Manager', holders: [holder(['b1'])] }),
    ], branches);
    assert.equal(options.find((item) => item.key === 'MANAGER')?.selectable, false);
    assert.equal(options.find((item) => item.key === 'MANAGER')?.unavailableReason, 'OWNER_RECOVERY_NOT_READY');
  });

  it('maps the selected role to the server-owned routing mode', () => {
    assert.equal(approverModeForRole('MANAGER'), 'MANAGER_ROLE');
    assert.equal(approverModeForRole('OWNER'), 'OWNER_ROLE');
    assert.equal(approverModeForRole('ACCOUNTANT'), 'CUSTOM_ROLE');
  });
});

describe('reimbursement policy role save', () => {
  const ctx = {
    companyId: 'co-1', userId: 'user-1', requestId: 'req-1',
    permissions: ['reimbursement.policy.manage'],
  } as any;
  const option = {
    key: 'ACCOUNTANT', name: 'Accountant', optionLabel: 'Accountant · 1 คนพร้อมอนุมัติ',
    eligibleApproverCount: 1, coverage: 'COMPLETE' as const, uncoveredBranchNames: [], selectable: true,
  };
  const policy = (data: Record<string, unknown>) => ({
    id: 'policy-1', companyId: 'co-1', currency: 'THB', approvalThresholdAmount: '1.00',
    approvalRequiredFromAmount: '1.00', approverMode: 'CUSTOM_ROLE', defaultApproverRole: 'ACCOUNTANT',
    allowSelfApproval: false, requireReceipt: true, allowMissingReceiptWithReason: false,
    duplicatePolicy: 'WARN', financeReviewRequired: true, status: 'ACTIVE', createdByUserId: 'user-1',
    createdAt: new Date('2026-08-21T00:00:00.000Z'), updatedAt: new Date('2026-08-21T00:00:00.000Z'),
    ...data,
  });

  it('lets policy managers read the form they are allowed to save', async () => {
    const useCase = new GetReimbursementPolicyUseCase({ findPolicy: async () => policy({}) } as any);
    const result = await useCase.execute(ctx);
    assert.equal(result.id, 'policy-1');
  });

  it('revalidates and canonicalizes an explicit role edit before writing', async () => {
    let written: Record<string, unknown> | undefined;
    const repo = {
      upsertPolicy: async (_companyId: string, _branchId: null, data: Record<string, unknown>) => {
        written = data;
        return policy(data);
      },
    };
    const useCase = new UpdateReimbursementPolicyUseCase(
      repo as any, { log: async () => undefined } as any, { append: async () => undefined } as any,
      { load: async () => [option] } as any,
    );

    await useCase.execute(ctx, { defaultApproverRole: ' ACCOUNTANT ' });
    assert.deepEqual(written, {
      defaultApproverRole: 'ACCOUNTANT', approverMode: 'CUSTOM_ROLE', defaultApproverUserId: null,
    });
  });

  it('rejects a stale or ineligible role without writing the policy', async () => {
    let wrote = false;
    const useCase = new UpdateReimbursementPolicyUseCase(
      { upsertPolicy: async () => { wrote = true; return policy({}); } } as any,
      { log: async () => undefined } as any, { append: async () => undefined } as any,
      { load: async () => [{ ...option, selectable: false }] } as any,
    );

    await assert.rejects(useCase.execute(ctx, { defaultApproverRole: 'ACCOUNTANT' }), /approver_role_not_eligible/);
    assert.equal(wrote, false);
  });
});
