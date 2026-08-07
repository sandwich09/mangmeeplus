import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CrmCustomerProfileExtractAgent } from './crm-customer-profile-extract.agent';

const request = { requestId: 'req-1', companyId: 'company-1', text: 'สมชาย 0812345678', locale: 'th-TH' };

describe('CrmCustomerProfileExtractAgent', () => {
  it('returns only bounded editable fields and clamps confidence', async () => {
    const provider = {
      generateText: async () => ({
        ok: true,
        text: JSON.stringify({
          displayName: `  สมชาย${'ก'.repeat(200)}  `,
          primaryPhone: ' 081-234-5678 ',
          primaryEmail: ' somchai@example.com ',
          notes: 'ลูกค้า walk-in',
          lineUserId: 'must-not-leak',
          confidence: 4,
        }),
      }),
    } as any;

    const result = await new CrmCustomerProfileExtractAgent().run(provider, request);
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    assert.equal(result.suggested.displayName?.length, 160);
    assert.equal(result.suggested.primaryPhone, '081-234-5678');
    assert.equal(result.suggested.primaryEmail, 'somchai@example.com');
    assert.equal('lineUserId' in result.suggested, false);
    assert.equal(result.confidence, 1);
  });

  it('returns uncertain when no identity field is usable', async () => {
    const provider = { generateText: async () => ({ ok: true, text: '{"notes":"ไม่มีข้อมูลติดต่อ"}' }) } as any;
    assert.deepEqual(
      await new CrmCustomerProfileExtractAgent().run(provider, request),
      { status: 'uncertain', requestId: 'req-1' },
    );
  });

  it('returns typed unavailable without retrying or mutating', async () => {
    const provider = { generateText: async () => ({ ok: false, error: 'MODEL_UNAVAILABLE' }) } as any;
    assert.deepEqual(
      await new CrmCustomerProfileExtractAgent().run(provider, request),
      { status: 'unavailable', requestId: 'req-1', error: 'MODEL_UNAVAILABLE' },
    );
  });
});
