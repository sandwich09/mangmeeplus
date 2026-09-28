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
      // R-C6/R-C7 (purchase-without-setup): no term row on the fake here — a DISABLED company with
      // no term is a human hold, never a term lock.
      if (status === 'DISABLED') assert.equal(result.planState, 'ADMIN_HOLD');
      if (status === 'ACTIVE') assert.equal(result.planState, 'ACTIVE');
      assert.equal('lockReason' in result, false);
    }
  }
});

it('reports NO_PACKAGE + lockReason for a shop the term locked at zero days', async () => {
  const T = new Date('2026-09-20T00:00:00.000Z');
  const prisma = { client: { company: { findUnique: async () => ({
    id: 'co-locked', name: 'Locked shop', status: 'DISABLED', createdAt: new Date('2026-09-20'),
    memberships: [], featureEntitlements: [], signupRequests: [],
    registeredName: null, taxId: null, addressJson: null,
    businessTypeCode: null, businessTypeOther: null, businessTypeVersion: 0,
    planTerm: { tierKey: 'FREE_TRIAL_15', termStartAt: T, termEndsAt: T, renewCount: 0, termDisabledAt: T },
  }) } } } as any;
  const useCase = new GetPartnerDetailUseCase(prisma, { get: async () => ({ status: 'NOT_REGISTERED', version: 0 }) } as any);
  const result = await useCase.execute('co-locked');
  assert.equal(result.planState, 'NO_PACKAGE');
  assert.equal(result.lockReason, 'no_package');
});
