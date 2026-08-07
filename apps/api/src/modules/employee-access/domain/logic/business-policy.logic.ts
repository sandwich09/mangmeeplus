import { BadRequestException } from '@nestjs/common';
import type { ConsentUnsubscribePolicy, DataRetentionPolicy, DiscountPolicy, PoApprovalPolicy } from '@watchdog-bms/contracts';

export function validateDiscountPolicy(policy: DiscountPolicy): DiscountPolicy {
  const values = [policy.defaultPct, policy.maxPct, policy.vipPct, policy.regularPct];
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 50)) {
    throw new BadRequestException('discount percentages must be integers between 0 and 50');
  }
  if (policy.defaultPct > policy.maxPct || policy.vipPct > policy.maxPct || policy.regularPct > policy.maxPct) {
    throw new BadRequestException('discount percentages cannot exceed maxPct');
  }
  return policy;
}

export function validatePoApprovalPolicy(policy: PoApprovalPolicy): PoApprovalPolicy {
  if (!policy.rules.length) throw new BadRequestException('at least one approval rule is required');
  let previousMax = -1;
  for (const rule of policy.rules) {
    const min = rule.minExclusive ?? -1;
    const max = rule.maxInclusive ?? Number.POSITIVE_INFINITY;
    if (min !== previousMax || max <= min) throw new BadRequestException('approval rules must be contiguous and ordered');
    previousMax = max;
  }
  if (previousMax !== Number.POSITIVE_INFINITY) throw new BadRequestException('last approval rule must be open-ended');
  return policy;
}

export function validateDataRetentionPolicy(policy: DataRetentionPolicy): DataRetentionPolicy {
  const days = [policy.chatMediaDays, policy.finalCampaignCreativeDays, policy.unusedAiCandidateDays, policy.pendingSlipDays, policy.duplicateOrRejectedSlipDays];
  if (days.some((value) => !Number.isInteger(value) || value < 1 || value > 3650)) {
    throw new BadRequestException('retention days must be integers between 1 and 3650');
  }
  if (!Number.isInteger(policy.accountingSlipYears) || policy.accountingSlipYears < 7 || policy.accountingSlipYears > 10) {
    throw new BadRequestException('accounting slip retention must be between 7 and 10 years');
  }
  return policy;
}

export function validateConsentUnsubscribePolicy(policy: ConsentUnsubscribePolicy): ConsentUnsubscribePolicy {
  const unsubscribeKeywords = [...new Set(policy.unsubscribeKeywords.map((keyword) => keyword.trim()).filter(Boolean))];
  if (!unsubscribeKeywords.length || unsubscribeKeywords.length > 20 || unsubscribeKeywords.some((keyword) => keyword.length > 50)) {
    throw new BadRequestException('unsubscribeKeywords must contain 1 to 20 values of at most 50 characters');
  }
  const unsubscribeConfirmationText = policy.unsubscribeConfirmationText.trim();
  if (!unsubscribeConfirmationText || unsubscribeConfirmationText.length > 500) {
    throw new BadRequestException('unsubscribeConfirmationText must contain 1 to 500 characters');
  }
  return { ...policy, unsubscribeKeywords, unsubscribeConfirmationText };
}
