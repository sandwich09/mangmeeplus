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

/**
 * Public, non-removable LINE commands that always withdraw direct marketing.
 * A tenant may add aliases, but must not replace these safety commands.
 */
export const MANDATORY_MARKETING_UNSUBSCRIBE_KEYWORDS = [
  'ยกเลิกข่าวสาร',
  'หยุดโปร',
  'STOP',
] as const;

export function withMandatoryMarketingUnsubscribeKeywords(
  keywords: ReadonlyArray<string> | null | undefined,
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  const suppliedKeywords = Array.isArray(keywords) ? keywords : [];
  for (const rawKeyword of [...MANDATORY_MARKETING_UNSUBSCRIBE_KEYWORDS, ...suppliedKeywords]) {
    if (typeof rawKeyword !== 'string') continue;
    const keyword = rawKeyword.trim().replace(/\s+/g, ' ');
    if (!keyword) continue;
    const comparisonKey = keyword.normalize('NFKC').toLocaleLowerCase('th-TH');
    if (seen.has(comparisonKey)) continue;
    seen.add(comparisonKey);
    normalized.push(keyword);
  }
  return normalized;
}

export type ConsentUnsubscribePolicy = {
  marketingRequiresExplicitConsent: boolean;
  transactionalMessagesRemainEnabledAfterMarketingOptOut: boolean;
  unsubscribeKeywords: string[];
  unsubscribeConfirmationText: string;
  updatedAt?: string;
};
