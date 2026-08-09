import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BusinessPolicyUseCase } from './business-policy.use-case';
import type { DiscountPolicy, PoApprovalPolicy } from '@watchdog-bms/contracts';

describe('BusinessPolicyUseCase', () => {
  it('validates and persists a discount policy', async () => {
    let saved: any;
    const useCase = new BusinessPolicyUseCase({ saveDiscount: async (_c: string, p: DiscountPolicy) => (saved = p) } as any);
    await useCase.saveDiscount('c1', { allowAuto: true, defaultPct: 10, maxPct: 20, vipPct: 15, regularPct: 10, overrideRole: 'manager' });
    assert.equal(saved.maxPct, 20);
    assert.throws(() => useCase.saveDiscount('c1', { ...saved, vipPct: 21 }));
  });

  it('accepts only contiguous PO ranges with an open-ended final rule', async () => {
    let saved: any;
    const useCase = new BusinessPolicyUseCase({ savePoApproval: async (_c: string, p: PoApprovalPolicy) => (saved = p) } as any);
    await useCase.savePoApproval('c1', { rules: [
      { id: 'auto', maxInclusive: 1000, approverRoleKeys: [] },
      { id: 'manager', minExclusive: 1000, maxInclusive: 10000, approverRoleKeys: ['MANAGER'] },
      { id: 'owner', minExclusive: 10000, approverRoleKeys: ['OWNER'] },
    ] });
    assert.equal(saved.rules.length, 3);
    assert.throws(() => useCase.savePoApproval('c1', { rules: [{ id: 'broken', maxInclusive: 10, approverRoleKeys: [] }] }));
  });

  it('validates retention and normalizes unsubscribe configuration', async () => {
    let retention: any;
    let consent: any;
    const useCase = new BusinessPolicyUseCase({
      saveRetention: async (_c: string, p: unknown) => (retention = p),
      saveConsent: async (_c: string, p: unknown) => (consent = p),
    } as any);
    await useCase.saveRetention('c1', { chatMediaDays: 180, finalCampaignCreativeDays: 730, unusedAiCandidateDays: 30, pendingSlipDays: 90, accountingSlipYears: 7, duplicateOrRejectedSlipDays: 90 });
    await useCase.saveConsent('c1', { marketingRequiresExplicitConsent: true, transactionalMessagesRemainEnabledAfterMarketingOptOut: true, unsubscribeKeywords: [' STOP ', 'stop', 'คำสั่งเพิ่ม'], unsubscribeConfirmationText: ' ยกเลิกแล้ว ' });
    assert.equal(retention.chatMediaDays, 180);
    assert.deepEqual(consent.unsubscribeKeywords, ['ยกเลิกข่าวสาร', 'หยุดโปร', 'STOP', 'คำสั่งเพิ่ม']);
    assert.equal(consent.unsubscribeConfirmationText, 'ยกเลิกแล้ว');
    assert.throws(() => useCase.saveRetention('c1', { ...retention, accountingSlipYears: 6 }));
  });
});
