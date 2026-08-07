import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CrmCustomerProfileExtractUseCase } from './crm-ai-assist.use-case';

const ctx = (permissions = ['crm.customer.create', 'crm.ai.assist']) => ({
  companyId: 'co-1',
  userId: 'staff-1',
  permissions,
  roles: ['SALES'],
  requestId: 'request-1',
}) as any;

describe('CrmCustomerProfileExtractUseCase', () => {
  it('requires both create and AI-assist permissions', async () => {
    const useCase = new CrmCustomerProfileExtractUseCase({} as any);
    await assert.rejects(() => useCase.execute(ctx(['crm.customer.create']), { text: 'สมชาย 0812345678' }), ForbiddenException);
    await assert.rejects(() => useCase.execute(ctx(['crm.ai.assist']), { text: 'สมชาย 0812345678' }), ForbiddenException);
  });

  it('rejects empty or oversized notes before calling the gateway', async () => {
    let called = false;
    const useCase = new CrmCustomerProfileExtractUseCase({ requestCustomerProfileExtract: async () => { called = true; } } as any);
    await assert.rejects(() => useCase.execute(ctx(), { text: ' ' }), BadRequestException);
    await assert.rejects(() => useCase.execute(ctx(), { text: 'x'.repeat(2_001) }), BadRequestException);
    assert.equal(called, false);
  });

  it('revalidates and bounds model output before returning an editable preview', async () => {
    const useCase = new CrmCustomerProfileExtractUseCase({
      requestCustomerProfileExtract: async (request: any) => ({
        requestId: request.requestId,
        status: 'ok',
        suggested: {
          displayName: `  สมชาย${'ก'.repeat(200)} `,
          primaryPhone: ' 081-234-5678 ',
          primaryEmail: ' somchai@example.com ',
          notes: 'ลูกค้า walk-in',
          lineUserId: 'must-not-leak',
        },
        confidence: 2,
      }),
    } as any);

    const result = await useCase.execute(ctx(), { text: 'สมชาย 081-234-5678' });
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    assert.equal(result.suggested.displayName?.length, 160);
    assert.equal(result.suggested.primaryPhone, '081-234-5678');
    assert.equal(result.suggested.primaryEmail, 'somchai@example.com');
    assert.equal('lineUserId' in result.suggested, false);
    assert.equal(result.confidence, 1);
  });

  it('degrades gateway failures to a typed unavailable result', async () => {
    const useCase = new CrmCustomerProfileExtractUseCase({ requestCustomerProfileExtract: async () => { throw new Error('down'); } } as any);
    const result = await useCase.execute(ctx(), { text: 'สมชาย 0812345678' });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.requestId.length > 0, true);
  });
});
