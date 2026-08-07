import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Pp36InputClaimController } from './pp36-input-claim.controller.js';

describe('Pp36InputClaimController tenant boundary', () => {
  it('rejects a mismatched route company and delegates exact source identity', async () => {
    let received: any;
    const controller = new Pp36InputClaimController({ execute: async (_ctx: any, input: any) => { received = input; return { adjustmentId: 'a1' }; } } as any);
    const ctx = { companyId: 'company-1' } as any;
    assert.throws(() => controller.execute(ctx, 'other-company', 'bill-1', 'line-1', { evidenceId: 'receipt-1', claimDate: '2026-08-20', reason: 'verified' }), /does not match/);
    assert.deepEqual(await controller.execute(ctx, 'company-1', 'bill-1', 'line-1', { evidenceId: 'receipt-1', claimDate: '2026-08-20', reason: 'verified' }), { adjustmentId: 'a1' });
    assert.deepEqual(received, { vendorBillId: 'bill-1', vendorBillLineId: 'line-1', evidenceId: 'receipt-1', claimDate: '2026-08-20', reason: 'verified' });
  });
});
