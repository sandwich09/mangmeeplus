import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RequestContext } from '@watchdog-bms/contracts';
import { CorrectLineCapturedExpenseUseCase } from './line-correction.use-case';

const ctx = (permissions: string[]): RequestContext => ({
  requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
  membershipId: 'm-1', roles: ['ACCOUNTANT'], permissions, scopes: {}, authProvider: 'line',
} as unknown as RequestContext);

const input = {
  lineMessageIdHash: 'hash-1', chatKeyHash: 'chat-1',
  candidates: [{ id: 'expense-1', label: 'บิล · 59 บาท', createdAt: new Date().toISOString() }],
  hints: { vendorName: { to: 'ร้านใหม่' } }, evidence: [{ text: 'แก้ร้านเป็นร้านใหม่', todayIso: '2026-09-26' }],
} as never;

describe('legacy LINE correction compatibility seam', () => {
  it('never writes directly, even with expense.update and the feature flag absent', async () => {
    const outcome = await new CorrectLineCapturedExpenseUseCase().execute(ctx(['expense.update']), input);
    assert.deepEqual(outcome, { status: 'guidance', reason: 'preview_required' });
  });

  it('does not treat review permission as LINE edit permission', async () => {
    const outcome = await new CorrectLineCapturedExpenseUseCase().execute(ctx(['expense.review']), input);
    assert.deepEqual(outcome, { status: 'guidance', reason: 'missing_update_permission' });
  });
});
