import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SumReceivedPaymentsByCounterpartyUseCase } from './sum-received-payments-by-counterparty.use-case';

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'u-1', companyId: 'co-1',
    membershipId: 'm-1', roles: ['OWNER'], permissions: ['crm.report.read'], scopes: {}, authProvider: 'dev',
    ...overrides,
  } as any;
}

describe('SumReceivedPaymentsByCounterpartyUseCase', () => {
  it('returns an empty result without querying for an empty counterparty list', async () => {
    const repo = {
      sumReceivedPaymentsByCounterparty: async () => {
        throw new Error('should not query');
      },
    } as any;

    const result = await new SumReceivedPaymentsByCounterpartyUseCase(repo).execute(ctx(), []);

    assert.deepEqual(result, []);
  });

  it('delegates a deduped company-scoped aggregate query', async () => {
    const calls: any[] = [];
    const repo = {
      sumReceivedPaymentsByCounterparty: async (companyId: string, counterpartyIds: string[]) => {
        calls.push({ companyId, counterpartyIds });
        return [{ counterpartyId: 'cp-1', amount: '120.0000', paymentCount: 2, latestPaidAt: new Date('2026-07-01T00:00:00.000Z') }];
      },
    } as any;

    const result = await new SumReceivedPaymentsByCounterpartyUseCase(repo).execute(ctx({ companyId: 'co-x' }), ['cp-1', 'cp-1', '']);

    assert.deepEqual(calls, [{ companyId: 'co-x', counterpartyIds: ['cp-1'] }]);
    assert.deepEqual(result, [{ counterpartyId: 'cp-1', amount: '120.0000', paymentCount: 2, latestPaidAt: new Date('2026-07-01T00:00:00.000Z') }]);
  });
});
