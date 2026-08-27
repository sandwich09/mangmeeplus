import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ReimbursementEvidenceService } from './reimbursement-evidence.service';

describe('reimbursement evidence source branch', () => {
  const ctx = { companyId: 'c1', userId: 'reviewer', scopes: {} } as any;
  const service = (branchId: string | null) => new ReimbursementEvidenceService({
    findById: async () => ({ id: 'a1', companyId: 'c1', status: 'ACTIVE', uploadedByUserId: 'requester', branchId }),
  } as any, {
    findById: async () => ({ id: 'e1', companyId: 'c1', createdByUserId: 'requester', branchId }),
  } as any);

  it('allows finance to use the requester evidence from the same branch', async () => {
    await service('b1').validate(ctx, 'requester', [{ attachmentId: 'a1', linkedExpenseId: 'e1' }], 'b1');
  });

  for (const ref of [{ attachmentId: 'a1' }, { linkedExpenseId: 'e1' }]) {
    it(`rejects an unassigned or different-branch ${Object.keys(ref)[0]} even for an unrestricted user`, async () => {
      for (const branchId of [null, 'b2']) {
        await assert.rejects(() => service(branchId).validate(ctx, 'requester', [ref], 'b1'),
          (error: any) => error.getStatus() === 422 && error.getResponse().code === 'REIMBURSEMENT_EVIDENCE_BRANCH_MISMATCH');
      }
    });
  }
});
