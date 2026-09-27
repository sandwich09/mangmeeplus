import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PublicLookupAdmissionTool } from './public-lookup';
const ctx = { companyId: 'private-company', userId: 'private-user', membershipId: 'private-member', permissions: ['ai.tool.invoke'], locale: 'th' };
const config = { lineAiPublicLookupEnabled: true, lineAiReliabilityV2Mode: 'on', lineAiReliabilityV2CompanyIds: ['private-company'] } as never;
const query = { publicQuestion: 'อัตราดอกเบี้ยล่าสุด', topic: 'rates', locale: 'th', temporalIntent: 'current', sourcePolicyId: 'thai-rates-v1' };
describe('API public.lookup admission', () => {
  it('gates before private reads, then returns only an admitted public question and fixed policy', async () => {
    let reads = 0;
    const tool = new PublicLookupAdmissionTool(config, { client: { company: { findUnique: async () => { reads++; return { name: 'Secret Shop', status: 'ACTIVE' }; } } } } as never);
    assert.equal((await tool.execute({ ...ctx, permissions: [] }, query)).status, 'forbidden'); assert.equal(reads, 0);
    const result = await tool.execute(ctx, query); assert.equal(result.status, 'ok'); assert.equal(reads, 1);
    assert.equal((result.data as any).admissionOnly, true); assert.deepEqual((result.data as any).approvedLookup.request, query);
    assert.equal(JSON.stringify(result).includes('Secret Shop'), false); assert.equal(JSON.stringify(result).includes('private-company'), false);
  });
  it('blocks known private entities and malformed or missing domain policies without performing public lookup', async () => {
    const tool = new PublicLookupAdmissionTool(config, { client: { company: { findUnique: async () => ({ name: 'Secret Shop', status: 'ACTIVE' }) } } } as never);
    for (const question of ['เครดิตของ Secret Shop', 'private-company', 'ส่งถึง a@example.com']) {
      assert.equal((await tool.execute(ctx, { ...query, publicQuestion: question })).errorCode, 'PUBLIC_QUERY_REQUIRES_REPHRASE');
    }
    assert.equal((await tool.execute(ctx, { ...query, sourcePolicyId: 'anything' })).errorCode, 'PUBLIC_POLICY_UNAVAILABLE');
    assert.equal((await tool.execute(ctx, { ...query, rawHistory: 'private' })).errorCode, 'PUBLIC_QUERY_REQUIRES_REPHRASE');
  });
});


it('empty rollout does not enable public lookup unless the feature is explicitly enabled', async () => {
  let reads = 0;
  const cfg = { lineAiPublicLookupEnabled: false, lineAiReliabilityV2Mode: 'on', lineAiReliabilityV2CompanyIds: [] as string[] };
  const tool = new PublicLookupAdmissionTool(cfg as never, { client: { company: { findUnique: async () => { reads++; return { name: 'Secret Shop', status: 'ACTIVE' }; } } } } as never);
  assert.equal((await tool.execute(ctx, query)).errorCode, 'PUBLIC_POLICY_UNAVAILABLE');
  assert.equal(reads, 0);
  cfg.lineAiPublicLookupEnabled = true;
  assert.equal((await tool.execute(ctx, query)).status, 'ok');
  assert.equal(reads, 1);
  cfg.lineAiReliabilityV2CompanyIds = ['other'];
  assert.equal((await tool.execute(ctx, query)).errorCode, 'PUBLIC_POLICY_UNAVAILABLE');
  assert.equal(reads, 1);
});
