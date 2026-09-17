import { it } from 'node:test';
import assert from 'node:assert/strict';
import { GetPartnerDetailUseCase } from './get-partner-detail.use-case';

it('reads original signup attribution in company details regardless of lifecycle/queue state', async () => {
  for (const status of ['ACTIVE', 'DISABLED', 'ARCHIVED']) {
    for (const signupRequests of [[], [{ discoverySource: 'OTHER', discoverySourceOther: 'เพื่อนแนะนำ' }]]) {
      const prisma = { client: { company: { findUnique: async (args: any) => {
        assert.deepEqual(args.where, { id: 'co-1' });
        assert.deepEqual(args.select.signupRequests, {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1,
          select: { discoverySource: true, discoverySourceOther: true },
        });
        return {
          id: 'co-1', name: 'ร้านมั่งมี', status, createdAt: new Date('2026-09-17'),
          memberships: [], featureEntitlements: [], signupRequests,
          registeredName: 'บริษัท ทดสอบ จำกัด', taxId: '0105556000001',
          addressJson: { line1: '99 ถนนทดสอบ', line2: 'ชั้น 2', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110', unknownLegacyField: 'do not expose' },
          businessTypeCode: '56101', businessTypeOther: null, businessTypeVersion: 2,
        };
      } } } } as any;
      const useCase = new GetPartnerDetailUseCase(prisma, { get: async () => ({ status: 'NOT_REGISTERED', version: 0 }) } as any);
      const result = await useCase.execute('co-1');
      assert.equal(result.discoverySource, signupRequests[0]?.discoverySource);
      assert.equal(result.discoverySourceOther, signupRequests[0]?.discoverySourceOther);
      assert.equal(result.registeredName, 'บริษัท ทดสอบ จำกัด');
      assert.equal(result.taxId, '0105556000001');
      assert.deepEqual(result.businessType, { code: '56101', other: null, version: 2 });
      assert.deepEqual(result.addressJson, { line1: '99 ถนนทดสอบ', line2: 'ชั้น 2', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' });
      assert.equal(result.vatRegistration.status, 'NOT_REGISTERED');
    }
  }
});
