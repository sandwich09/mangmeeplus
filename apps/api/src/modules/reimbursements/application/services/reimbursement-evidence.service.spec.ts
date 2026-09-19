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

  // Capture appendix §5: the server's own record of who paid is authority enough — a colleague
  // uploading on the payer's behalf must not lock the payer out of their own claim.
  it('accepts an expense the requester did not upload but the server records them as paying', async () => {
    const certificateLookups: string[] = [];
    const service = new ReimbursementEvidenceService({
      findById: async () => ({ id: 'a1', companyId: 'c1', status: 'ACTIVE', uploadedByUserId: 'requester', branchId: 'b1' }),
    } as any, {
      findById: async () => ({ id: 'e1', companyId: 'c1', createdByUserId: 'colleague', payerUserId: 'requester', branchId: 'b1' }),
      findSubstituteEvidence: async (_companyId: string, id: string) => { certificateLookups.push(id); return null; },
    } as any);

    await service.validate(ctx, 'requester', [{ linkedExpenseId: 'e1' }], 'b1');
    assert.deepEqual(certificateLookups, [], 'no certificate lookup is needed once the payer matches');
  });

  it('still refuses an expense somebody else uploaded, paid and holds no certificate for', async () => {
    const service = new ReimbursementEvidenceService({} as any, {
      findById: async () => ({ id: 'e1', companyId: 'c1', createdByUserId: 'colleague', payerUserId: 'colleague', branchId: 'b1' }),
      findSubstituteEvidence: async () => null,
    } as any);

    await assert.rejects(() => service.validate(ctx, 'requester', [{ linkedExpenseId: 'e1' }], 'b1'),
      (error: any) => error.getStatus() === 422 && String(error.getResponse().message ?? error.getResponse()).includes('invalid_linked_expense'));
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
