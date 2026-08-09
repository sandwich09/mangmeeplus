import { Injectable } from '@nestjs/common';
import type { ConsentUnsubscribePolicy, DataRetentionPolicy, DiscountPolicy, PoApprovalPolicy } from '@watchdog-bms/contracts';
import {
  MANDATORY_MARKETING_UNSUBSCRIBE_KEYWORDS,
  withMandatoryMarketingUnsubscribeKeywords,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import type { BusinessPolicyRepository } from '../application/use-cases/business-policy.use-case';

const DISCOUNT_DEFAULTS: DiscountPolicy = { allowAuto: true, defaultPct: 10, maxPct: 20, vipPct: 15, regularPct: 10, overrideRole: 'manager' };
const PO_DEFAULTS: PoApprovalPolicy = { rules: [
  { id: 'auto', maxInclusive: 1000, approverRoleKeys: [] },
  { id: 'manager', minExclusive: 1000, maxInclusive: 10000, approverRoleKeys: ['MANAGER'] },
  { id: 'owner-or-manager', minExclusive: 10000, approverRoleKeys: ['MANAGER', 'OWNER'] },
] };
const RETENTION_DEFAULTS: DataRetentionPolicy = { chatMediaDays: 180, finalCampaignCreativeDays: 730, unusedAiCandidateDays: 30, pendingSlipDays: 90, accountingSlipYears: 7, duplicateOrRejectedSlipDays: 90 };
const CONSENT_DEFAULTS: ConsentUnsubscribePolicy = {
  marketingRequiresExplicitConsent: true,
  transactionalMessagesRemainEnabledAfterMarketingOptOut: true,
  unsubscribeKeywords: [...MANDATORY_MARKETING_UNSUBSCRIBE_KEYWORDS],
  unsubscribeConfirmationText: 'ยกเลิกข่าวสารและโปรโมชันเรียบร้อยแล้ว การยกเลิกนี้ไม่กระทบข้อความเกี่ยวกับการจองหรือบริการที่คุณใช้',
};

@Injectable()
export class PrismaBusinessPolicyRepository implements BusinessPolicyRepository {
  constructor(private readonly prisma: PrismaService) {}
  async getDiscount(companyId: string) {
    const row = await this.prisma.client.companyBusinessPolicy.findUnique({ where: { companyId } });
    return row ? { ...(row.discountPolicyJson as DiscountPolicy), updatedAt: row.updatedAt.toISOString() } : DISCOUNT_DEFAULTS;
  }
  async saveDiscount(companyId: string, policy: DiscountPolicy) {
    const row = await this.prisma.client.companyBusinessPolicy.upsert({ where: { companyId }, create: { companyId, discountPolicyJson: policy as any }, update: { discountPolicyJson: policy as any } });
    return { ...(row.discountPolicyJson as DiscountPolicy), updatedAt: row.updatedAt.toISOString() };
  }
  async getPoApproval(companyId: string) {
    const row = await this.prisma.client.companyBusinessPolicy.findUnique({ where: { companyId } });
    return row ? { ...(row.poApprovalPolicyJson as PoApprovalPolicy), updatedAt: row.updatedAt.toISOString() } : PO_DEFAULTS;
  }
  async savePoApproval(companyId: string, policy: PoApprovalPolicy) {
    const row = await this.prisma.client.companyBusinessPolicy.upsert({ where: { companyId }, create: { companyId, poApprovalPolicyJson: policy as any }, update: { poApprovalPolicyJson: policy as any } });
    return { ...(row.poApprovalPolicyJson as PoApprovalPolicy), updatedAt: row.updatedAt.toISOString() };
  }
  async getRetention(companyId: string) {
    const row = await this.prisma.client.companyBusinessPolicy.findUnique({ where: { companyId } });
    return { ...RETENTION_DEFAULTS, ...(row?.retentionPolicyJson as Partial<DataRetentionPolicy> | undefined), ...(row ? { updatedAt: row.updatedAt.toISOString() } : {}) };
  }
  async saveRetention(companyId: string, policy: DataRetentionPolicy) {
    const row = await this.prisma.client.companyBusinessPolicy.upsert({ where: { companyId }, create: { companyId, retentionPolicyJson: policy as any }, update: { retentionPolicyJson: policy as any } });
    return { ...(row.retentionPolicyJson as DataRetentionPolicy), updatedAt: row.updatedAt.toISOString() };
  }
  async getConsent(companyId: string) {
    const row = await this.prisma.client.companyBusinessPolicy.findUnique({ where: { companyId } });
    const policy = { ...CONSENT_DEFAULTS, ...(row?.consentPolicyJson as Partial<ConsentUnsubscribePolicy> | undefined) };
    return {
      ...policy,
      unsubscribeKeywords: withMandatoryMarketingUnsubscribeKeywords(policy.unsubscribeKeywords),
      ...(row ? { updatedAt: row.updatedAt.toISOString() } : {}),
    };
  }
  async saveConsent(companyId: string, policy: ConsentUnsubscribePolicy) {
    const row = await this.prisma.client.companyBusinessPolicy.upsert({ where: { companyId }, create: { companyId, consentPolicyJson: policy as any }, update: { consentPolicyJson: policy as any } });
    return { ...(row.consentPolicyJson as ConsentUnsubscribePolicy), updatedAt: row.updatedAt.toISOString() };
  }
}
