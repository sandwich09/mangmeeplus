import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CrmBroadcastAgent } from './crm-broadcast.agent';

describe('CrmBroadcastAgent', () => {
  it('returns exactly three bounded structured candidates', async () => {
    const provider = { generateText: async () => ({ ok: true as const, text: JSON.stringify({ candidates: [1,2,3].map((n) => ({ headline: `แบบ ${n}`, body: `ข้อความ ${n}` })) }) }) };
    const result = await new CrmBroadcastAgent().run(provider as never, { requestId: 'req-1', companyId: 'company-1', topic: 'ลด 20%', tone: 'friendly' });
    assert.equal(result.status, 'ok');
    if (result.status === 'ok') assert.deepEqual(result.candidates.map((item) => item.id), ['candidate-1','candidate-2','candidate-3']);
  });

  it('does not emit partial model output', async () => {
    const provider = { generateText: async () => ({ ok: true as const, text: '{"candidates":[{"headline":"A","body":"B"}]}' }) };
    const result = await new CrmBroadcastAgent().run(provider as never, { requestId: 'req-2', companyId: 'company-1', topic: 'โปร', tone: 'polite' });
    assert.equal(result.status, 'uncertain');
  });
});
