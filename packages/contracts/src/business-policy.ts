export type DiscountOverrideRole = 'owner' | 'manager' | 'any';

export type DiscountPolicy = {
  allowAuto: boolean;
  defaultPct: number;
  maxPct: number;
  vipPct: number;
  regularPct: number;
  overrideRole: DiscountOverrideRole;
  updatedAt?: string;
};

export type PoApprovalRule = {
  id: string;
  minExclusive?: number;
  maxInclusive?: number;
  approverRoleKeys: string[];
};

export type PoApprovalPolicy = { rules: PoApprovalRule[]; updatedAt?: string };

export type DataRetentionPolicy = {
  chatMediaDays: number;
  finalCampaignCreativeDays: number;
  unusedAiCandidateDays: number;
  pendingSlipDays: number;
  accountingSlipYears: number;
  duplicateOrRejectedSlipDays: number;
  updatedAt?: string;
};

export type ConsentUnsubscribePolicy = {
  marketingRequiresExplicitConsent: boolean;
  transactionalMessagesRemainEnabledAfterMarketingOptOut: boolean;
  unsubscribeKeywords: string[];
  unsubscribeConfirmationText: string;
  updatedAt?: string;
};
