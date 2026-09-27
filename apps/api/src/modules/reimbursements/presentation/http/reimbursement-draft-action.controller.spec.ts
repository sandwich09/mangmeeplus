import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReimbursementController } from './reimbursement.controller';

describe('ReimbursementController draft-action surface', () => {
  it('delegates GET/confirm/cancel to the one domain handler with exact revision and digest', async () => {
    const seen: unknown[] = [];
    const draftActions = {
      getForWeb: async (...args: unknown[]) => { seen.push(['get', ...args]); return { status: 'preview' }; },
      confirmForWeb: async (...args: unknown[]) => { seen.push(['confirm', ...args]); return { status: 'applied' }; },
      cancelForWeb: async (...args: unknown[]) => { seen.push(['cancel', ...args]); return { status: 'cancelled' }; },
    };
    const controller = Object.assign(Object.create(ReimbursementController.prototype), { draftActions }) as ReimbursementController;
    const ctx = { companyId: 'c1', userId: 'u1', membershipId: 'm1' } as any;
    const body = { previewRevision: 4, confirmationDigest: 'a'.repeat(64) };
    assert.deepEqual(await controller.getDraftAction(ctx, 'action-1'), { status: 'preview' });
    assert.deepEqual(await controller.confirmDraftAction(ctx, 'action-1', body), { status: 'applied' });
    assert.deepEqual(await controller.cancelDraftAction(ctx, 'action-1', body), { status: 'cancelled' });
    assert.deepEqual(seen, [
      ['get', ctx, 'action-1'],
      ['confirm', ctx, 'action-1', 4, 'a'.repeat(64)],
      ['cancel', ctx, 'action-1', 4, 'a'.repeat(64)],
    ]);
  });
});
