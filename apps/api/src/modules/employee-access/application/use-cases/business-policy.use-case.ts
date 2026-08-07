import { Inject, Injectable } from '@nestjs/common';
import type { ConsentUnsubscribePolicy, DataRetentionPolicy, DiscountPolicy, PoApprovalPolicy } from '@watchdog-bms/contracts';
import { validateConsentUnsubscribePolicy, validateDataRetentionPolicy, validateDiscountPolicy, validatePoApprovalPolicy } from '../../domain/logic/business-policy.logic';

export const BUSINESS_POLICY_REPOSITORY = Symbol('BUSINESS_POLICY_REPOSITORY');
export interface BusinessPolicyRepository {
  getDiscount(companyId: string): Promise<DiscountPolicy>;
  saveDiscount(companyId: string, policy: DiscountPolicy): Promise<DiscountPolicy>;
  getPoApproval(companyId: string): Promise<PoApprovalPolicy>;
  savePoApproval(companyId: string, policy: PoApprovalPolicy): Promise<PoApprovalPolicy>;
  getRetention(companyId: string): Promise<DataRetentionPolicy>;
  saveRetention(companyId: string, policy: DataRetentionPolicy): Promise<DataRetentionPolicy>;
  getConsent(companyId: string): Promise<ConsentUnsubscribePolicy>;
  saveConsent(companyId: string, policy: ConsentUnsubscribePolicy): Promise<ConsentUnsubscribePolicy>;
}

@Injectable()
export class BusinessPolicyUseCase {
  constructor(@Inject(BUSINESS_POLICY_REPOSITORY) private readonly repository: BusinessPolicyRepository) {}
  getDiscount(companyId: string) { return this.repository.getDiscount(companyId); }
  saveDiscount(companyId: string, policy: DiscountPolicy) { return this.repository.saveDiscount(companyId, validateDiscountPolicy(policy)); }
  getPoApproval(companyId: string) { return this.repository.getPoApproval(companyId); }
  savePoApproval(companyId: string, policy: PoApprovalPolicy) { return this.repository.savePoApproval(companyId, validatePoApprovalPolicy(policy)); }
  getRetention(companyId: string) { return this.repository.getRetention(companyId); }
  saveRetention(companyId: string, policy: DataRetentionPolicy) { return this.repository.saveRetention(companyId, validateDataRetentionPolicy(policy)); }
  getConsent(companyId: string) { return this.repository.getConsent(companyId); }
  saveConsent(companyId: string, policy: ConsentUnsubscribePolicy) { return this.repository.saveConsent(companyId, validateConsentUnsubscribePolicy(policy)); }
}
