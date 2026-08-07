import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GetSubstituteReceiptPolicyUseCase,
  UpdateSubstituteReceiptPolicyUseCase,
} from './substitute-receipt-policy.use-case';

const ctx = {
  companyId: 'co-1', userId: 'owner-1', requestId: 'req-1', permissions: ['company.setup.manage'],
} as any;

describe('substitute receipt company policy', () => {
  it('returns a ready owner-self strict default without a policy row', async () => {
    const repo = {
      getSubstituteReceiptPolicy: async () => null,
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
    } as any;
    const result = await new GetSubstituteReceiptPolicyUseCase(repo).execute(ctx);
    assert.equal(result.configured, false);
    assert.equal(result.ready, true);
    assert.equal(result.approvalMode, 'OWNER_SELF');
    assert.equal(result.cashEvidencePolicy, 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE');
  });

  it('allows OWNER_SELF with no approvers and rejects an empty DESIGNATED_APPROVERS list', async () => {
    let saved: any;
    const repo = {
      getSubstituteReceiptPolicy: async () => saved ? {
        id: 'policy-1', ...saved, createdByUserId: 'owner-1', updatedByUserId: 'owner-1',
        createdAt: new Date(), updatedAt: new Date(),
      } : null,
      listEligibleSubstituteReceiptApprovers: async () => [],
      upsertSubstituteReceiptPolicy: async (input: any) => {
        saved = input;
        return {
          id: 'policy-1', ...input, createdByUserId: 'owner-1', updatedByUserId: 'owner-1',
          createdAt: new Date(), updatedAt: new Date(),
        };
      },
    } as any;
    const get = new GetSubstituteReceiptPolicyUseCase(repo);
    const useCase = new UpdateSubstituteReceiptPolicyUseCase(repo, get, { log: async () => undefined } as any);
    const result = await useCase.execute(ctx, {
      approvalMode: 'OWNER_SELF', approverUserIds: [], cashEvidencePolicy: 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE',
    });
    assert.equal(result.ready, true);
    assert.deepEqual(saved.approverUserIds, []);
    await assert.rejects(() => useCase.execute(ctx, {
      approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: [], cashEvidencePolicy: 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE',
    }), /Select between 1 and 20 authorized approvers/);
  });

  it('rejects ineligible approvers and audits a valid update', async () => {
    let saved: any;
    let audited: any;
    const policy = {
      id: 'policy-1', companyId: 'co-1', approverUserIds: ['approver-1'],
      approvalMode: 'DESIGNATED_APPROVERS',
      cashEvidencePolicy: 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE', cashEvidenceInstructions: null,
      createdByUserId: 'owner-1', updatedByUserId: 'owner-1', createdAt: new Date(), updatedAt: new Date(),
    };
    const repo = {
      getSubstituteReceiptPolicy: async () => saved ? policy : null,
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
      upsertSubstituteReceiptPolicy: async (input: any) => { saved = input; return policy; },
    } as any;
    const get = new GetSubstituteReceiptPolicyUseCase(repo);
    const useCase = new UpdateSubstituteReceiptPolicyUseCase(repo, get, { log: async (entry: any) => { audited = entry; } } as any);
    await assert.rejects(() => useCase.execute(ctx, {
      approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['staff-1'], cashEvidencePolicy: 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE',
    }), /active company member/);
    const result = await useCase.execute(ctx, {
      approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['approver-1'], cashEvidencePolicy: 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE',
      cashEvidenceInstructions: 'แนบใบสำคัญจ่าย',
    });
    assert.deepEqual(saved.approverUserIds, ['approver-1']);
    assert.equal(audited.riskLevel, 'HIGH');
    assert.equal(result.configured, true);
  });
});
