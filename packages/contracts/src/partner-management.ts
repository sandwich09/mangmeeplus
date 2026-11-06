// ---- Item 10A Partner Management DTOs ----

import type { CivilDate } from './civil-date.js';
import type { CompanyLegalAddress, VatRegistrationStatus } from './company-tax-identity.js';
import type { CompanyBusinessType } from './company-business-type.js';
import type { SignupDiscoverySource } from './external-signup.js';
import type { PlanTermLockReason, PlanTermState, PlanTierKey } from './plan-term.js';
import type { ReportClassification, ReportIndustryGroup } from './report-labels.js';
import type { SalesReferralSource } from './sales.js';

export type PartnerCompanyStatus = 'ACTIVE' | 'DISABLED' | 'ARCHIVED' | 'SUSPENDED';
export type PartnerCredentialKind = 'LINE_MESSAGING_API' | 'LINE_LOGIN' | 'LINE_LIFF';
export type PartnerCredentialHealth = 'OK' | 'ERROR' | 'UNKNOWN';
export type LineContextHealth = 'LINKED' | 'UNLINKED' | 'NEEDS_COMPANY_SELECTION' | 'UNKNOWN';

// Platform-level shared LINE credential metadata — NO secret fields returned
export type SharedLineCredentialMetadataDto = {
  kind: PartnerCredentialKind;
  health: PartnerCredentialHealth;
  lastValidatedAt?: string;
  rotatedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type SharedLineMessagingSettings = {
  kind: 'LINE_MESSAGING_API'; version: number; channelId: string | null;
  runtimeStatus: 'AVAILABLE' | 'INCOMPLETE' | 'UNAVAILABLE';
  source: 'ENVIRONMENT' | 'DATABASE'; publishedAt: string | null;
  tokenValidatedAt: string | null; inboundVerifiedAt: string | null;
  canReplace: boolean; updatedAt: string | null;
};

/** @deprecated per-partner LINE credentials replaced by shared-OA platform credentials */
export type LineCredentialMetadataDto = SharedLineCredentialMetadataDto;

export type PartnerFeatureEntitlementDto = {
  featureKey: string;
  enabled: boolean;
  updatedAt: string;
  /** Server-owned safe-OFF verdict. It never exposes runoff matrix or route internals. */
  canDisable: boolean;
  /** Friendly operator copy when `canDisable=false`. */
  disableReason?: string;
};

export type PartnerAiConfigurationDto = {
  /** null = the row exists (budget only) but inherits the platform default model — metering spec §6.8. */
  modelId: string | null;
  updatedAt: string;
};

export type PartnerCompanySummaryDto = {
  id: string;
  name: string;
  registeredName?: string;
  timezone: string;
  locale: string;
  status: PartnerCompanyStatus;
  createdAt: string;
  activatedAt?: string;
  disabledAt?: string;
  archivedAt?: string;
  enabledFeatureKeys: string[];
  configuredModelId?: string;
  lineContextHealth: LineContextHealth;
  /** R-C6/R-C7: the term's own state, so a term-locked shop never reads as "ปิดใช้งาน". */
  planState?: PlanTermState;
  lockReason?: PlanTermLockReason;
  tierKey?: PlanTierKey;
  termEndsAt?: string;
  /** Executive report label (executive spec §12.2); null = not classified yet. The platform company is always INTERNAL. */
  reportClassification: ReportClassification | null;
  /** The industry group the report uses: the admin's, else the mapping of the shop's own business type; null = none. */
  reportIndustryGroup: ReportIndustryGroup | null;
};

/** `GET /v1/system/partners` filters beside `q` and `status` (executive spec §16.1). ALL is the default of both. */
export const PARTNER_REPORT_CLASSIFICATION_FILTERS = ['ALL', 'CUSTOMER', 'TEST', 'INTERNAL', 'DEMO', 'UNCLASSIFIED'] as const;
export type PartnerReportClassificationFilter = typeof PARTNER_REPORT_CLASSIFICATION_FILTERS[number];
/** UNSET: neither the admin's group nor a group from the shop's business type — the report shows "ไม่ระบุ". */
export const PARTNER_REPORT_INDUSTRY_GROUP_FILTERS = ['ALL', 'UNSET'] as const;
export type PartnerReportIndustryGroupFilter = typeof PARTNER_REPORT_INDUSTRY_GROUP_FILTERS[number];

/** The two report labels on a company, with who set them and when (executive spec §16.1). */
export type PartnerReportLabelsDto = {
  classification: ReportClassification | null;
  /** When the classification was last chosen. With no `classifiedBy` the system chose it (signup, or the one-time data task). */
  classifiedAt?: string;
  classifiedBy?: { userId: string; displayName: string };
  /** The group the admin set; null = none, and the report falls back to `effectiveIndustryGroup`. */
  industryGroup: ReportIndustryGroup | null;
  industryGroupSetAt?: string;
  industryGroupSetBy?: { userId: string; displayName: string };
  /** What the report uses: the admin's group, else the mapping of the shop's own business type; null = "ไม่ระบุ". */
  effectiveIndustryGroup: ReportIndustryGroup | null;
  /** Version of the business-type mapping behind `effectiveIndustryGroup`. */
  industryGroupVersion: number;
};

export type PaginatedPartnersDto = {
  items: PartnerCompanySummaryDto[];
  total: number;
  page: number;
  pageSize: number;
};

export type PartnerCompanyDetailDto = {
  id: string;
  name: string;
  addressJson?: Partial<CompanyLegalAddress>;
  businessType?: CompanyBusinessType;
  /** Original signup attribution, readable even after the request leaves the review queue. */
  discoverySource?: SignupDiscoverySource;
  discoverySourceOther?: string;
  /**
   * D6: which มั่งมี sales agent this shop is credited to, or null. A SYSTEM_ADMIN may repair it
   * through `PATCH /v1/system/partners/:companyId/referral` within
   * SALES_REFERRAL_ADMIN_WINDOW_DAYS of `createdAt`, always with a reason (audit HIGH).
   */
  referralSales: {
    userId: string; displayName: string; salesCode: string;
    /** When the shop opened — the anchor Phase 4 counts the attribution window from. */
    referredAt: string | null;
    source: SalesReferralSource;
  } | null;
  /**
   * VAT registration as of today. `version` is the compare-and-set token for editing it —
   * an admin console must not overwrite an answer given from the company's own screen.
   */
  vatRegistration: { status: VatRegistrationStatus; effectiveFrom?: CivilDate; version: number };
  registeredName?: string;
  brandName?: string;
  taxId?: string;
  timezone: string;
  locale: string;
  baseCurrency: string;
  phone?: string;
  email?: string;
  status: PartnerCompanyStatus;
  createdAt: string;
  activatedAt?: string;
  disabledAt?: string;
  archivedAt?: string;
  featureEntitlements: PartnerFeatureEntitlementDto[];
  /** Canonical whole-set CAS value to echo in the next feature command. */
  setVersion: number;
  aiConfiguration?: PartnerAiConfigurationDto;
  lineContextHealth: LineContextHealth;
  /**
   * The company's entitlement rows have not been normalized yet, so every entitlement command is
   * refused (`company_entitlement_normalization_pending`). The package screen renders read-only.
   */
  entitlementNormalizationPending: boolean;
  /** Always present, also for a company that has no stored row (it then carries the default and version 0). */
  manualExpenseWebEntry: PartnerManualExpenseWebEntryDto;
  /** A screen setting; null/absent stored values read as hidden. It shares the manual-entry row version. */
  disbursementVoucherWebEntry: PartnerDisbursementVoucherWebEntryDto;
  /** Roles in this shop that currently carry any permission for this document. */
  disbursementVoucherRoles: PartnerDisbursementVoucherRoleDto[];
  planState?: PlanTermState;
  lockReason?: PlanTermLockReason;
  reportLabels: PartnerReportLabelsDto;
};

/**
 * "แสดงเมนูบันทึกด้วยมือบนเว็บ": a per-company screen setting shown under the manual-expense feature.
 * It hides or shows the web entrances to the manual expense page and is NOT an entitlement — it is
 * saved by its own command, outside the feature command and its `setVersion`.
 */
export type PartnerManualExpenseWebEntryDto = {
  enabled: boolean;
  /** The setting's own CAS version: 0 until the first change, then +1 per real change. */
  version: number;
};

/** Absolute desired state; sending the value the company already has is a no-op. */
export type SetPartnerManualExpenseWebEntryDto = {
  enabled: boolean;
  /** `version` from the latest partner detail read. */
  expectedVersion: number;
};

export type PartnerDisbursementVoucherWebEntryDto = {
  enabled: boolean;
  /** Shared company web-entry-setting version, also advanced by the manual-entry switch. */
  version: number;
};

export type SetPartnerDisbursementVoucherWebEntryDto = {
  enabled: boolean;
  expectedVersion: number;
};

export type ExpenseDisbursementPermissionKey =
  | 'expense.disbursement.read'
  | 'expense.disbursement.prepare'
  | 'expense.disbursement.approve'
  | 'expense.disbursement.pay'
  | 'expense.disbursement.issue';

export type PartnerDisbursementVoucherRoleDto = {
  name: string;
  /** True for roles created by the shop or copied from a standard role for editing. */
  isCompanyManaged: boolean;
  permissionKeys: ExpenseDisbursementPermissionKey[];
};

export type PartnerMembershipStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DISABLED';

export type PartnerMemberCredentialDto = {
  status: 'ACTIVE' | 'TEMPORARY' | 'DISABLED';
  mustChangePassword: boolean;
  expiresAt?: string;
  /** An encrypted system-generated temporary password is on record and can be revealed. */
  hasTempPassword: boolean;
};

export type PartnerMemberDto = {
  userId: string;
  displayName: string;
  username?: string;
  email?: string;
  phoneNumber?: string;
  membershipStatus: PartnerMembershipStatus;
  roles: string[];
  lineLinked: boolean;
  /** Current Messaging identity binding; provider delivery readiness is separate. */
  lineMessagingReady?: boolean;
  credential?: PartnerMemberCredentialDto;
};

export type PartnerMembersDto = { items: PartnerMemberDto[] };

export type SetPartnerOwnerNameInput = { displayName: string; expectedDisplayName: string };
export type SetPartnerOwnerNameResult = { displayName: string };

export type PartnerMemberPasswordResetDto = {
  userId: string;
  username?: string;
  temporaryPassword: string;
  expiresAt: string;
};

export type PartnerMemberTempPasswordDto = { temporaryPassword: string };

export type UpdatePartnerProfileDto = {
  name?: string;
  brandName?: string;
  timezone?: string;
  locale?: string;
  phone?: string;
  email?: string;
  /** Executive report labels. Absent = unchanged; null = clear. They stay editable on a held or archived company. */
  reportClassification?: ReportClassification | null;
  reportIndustryGroup?: ReportIndustryGroup | null;
};

export type PartnerLifecycleTransitionDto = {
  targetStatus: 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
  reason?: string;
};

export type SetPartnerFeaturesDto = {
  features: Array<{ featureKey: string; enabled: boolean }>;
  /** Stable across a lost-response retry of this exact payload. */
  commandId: string;
  /** `setVersion` displayed by the detail response. */
  expectedSetVersion: number;
  /** True only after the operator reviewed the dependent features that will also be disabled. */
  confirmCascade: boolean;
};

export type SetPartnerFeaturesResultDto = {
  companyId: string;
  setVersion: number;
  features: Array<{ featureKey: string; enabled: boolean; updatedAt: string }>;
  cascadedOffKeys: string[];
};

/**
 * Partial update — at least one field must be present (the API answers 422 otherwise).
 * An absent field is left untouched; `monthlyBudgetSatang: null` clears the override so the
 * company inherits the platform default again (metering spec §7.7).
 */
export type SetPartnerAiModelDto = {
  reason: string;
  modelId?: string;
  monthlyBudgetSatang?: number | null;
  expectedModelId?: string | null;
  expectedMonthlyBudgetSatang?: number | null;
  /**
   * Separate CHAT/OCR caps (remediation spec §12.4). Absent = preserve whatever is saved;
   * `null` = cancel a FUTURE pending policy only (it can never revert an already-effective one);
   * an object = the desired policy for `effectiveMonthKey`, which must be the current or the next
   * Bangkok month. Under `SHARED`, `chatMonthlyBudgetSatang` is this shop's chat credit set by an
   * admin (`null` = the default or a sales deal); `monthlyBudgetSatang` is only the safety ceiling.
   */
  budgetPolicy?: PartnerAiBudgetPolicyInput | null;
  /** Required with `budgetPolicy`: the `budget.policy.revision` of the read this edit is based on. */
  expectedBudgetRevision?: string;
};

export type PartnerAiBudgetMode = 'SHARED' | 'SPLIT';

/**
 * Where the chat credit in force comes from (admin tab rework 2026-09-29): the platform default,
 * an admin setting for this shop, a live sales deal, or a SPLIT chat cap.
 */
export type PartnerAiChatCreditSource = 'DEFAULT' | 'ADMIN' | 'SALES_DEAL' | 'SPLIT';

/** `0` closes that bucket; `null` means "not set", never "unlimited". SPLIT requires both caps. */
export type PartnerAiBudgetPolicyInput = {
  mode: PartnerAiBudgetMode;
  chatMonthlyBudgetSatang: number | null;
  ocrMonthlyBudgetSatang: number | null;
  /** 'YYYY-MM', Asia/Bangkok. */
  effectiveMonthKey: string;
};

/**
 * The effective policy for one company and one pinned Bangkok month, as the API's single resolver
 * decided it — the same value admission compares against (spec §12.5).
 */
export type PartnerAiBudgetPolicyDto = {
  mode: PartnerAiBudgetMode;
  chatCapSatang: number | null;
  ocrCapSatang: number | null;
  /** `PENDING_ACTIVATED` = a scheduled policy's month has arrived and it is already in force. */
  source: 'ACTIVE' | 'PENDING_ACTIVATED';
  /** CAS fence: binds the row version, the pinned month and the source (review R-07). */
  revision: string;
  /** Only a policy whose month is still in the FUTURE. It changes nothing yet. */
  pending: PartnerAiBudgetPolicyInput | null;
  /** Set => this company's AI admission is refused until an operator fixes the policy. */
  invalidReason?: 'SPLIT_CAPS_MISSING' | 'SPLIT_EXCEEDS_TOTAL' | 'POLICY_MALFORMED';
  /** Where `chatCapSatang` comes from. Absent from an API that predates the admin tab rework. */
  chatSource?: PartnerAiChatCreditSource;
};

/** One scope's money position. `available` is `cap - spent - reserved`, floored at 0. */
export type PartnerAiBudgetScopePositionDto = {
  spentSatang: number;
  reservedSatang: number;
  /** CHAT has a cap under SHARED; OCR is null there because it only uses TOTAL. */
  availableSatang: number | null;
};

export type PartnerAiBudgetPositionDto = {
  total: PartnerAiBudgetScopePositionDto;
  chat: PartnerAiBudgetScopePositionDto;
  ocr: PartnerAiBudgetScopePositionDto;
  /** Holds whose provider outcome is still unknown; they keep counting until evidence closes them. */
  unresolvedHolds: number;
  /** An actual settled above its reserved bound — admission for that scope is closed (spec §12.3). */
  breach: boolean;
};

/**
 * One row of the operator's hold-reconciliation list (hold spec §4.1).
 *
 * Money and ids only. There is deliberately NO customer message text, prompt or LINE identifier
 * here: the only reason an operator opens this list is to decide what to do with held credit, and
 * the attempt key is already a truncated hash.
 */
export type PartnerAiCreditHoldDto = {
  /** `AiBudgetReservation.id` — what the three action routes take. */
  id: string;
  /** `UNRESOLVED` for a hold nobody could close; `SETTLED` for an unacknowledged breach row. */
  status: 'UNRESOLVED' | 'SETTLED';
  /** Why this row is on the list: a stranded hold, or an actual above its bound closing a scope. */
  kind: 'UNRESOLVED_HOLD' | 'BREACH';
  /** Declared step kind (`line-turn`, `receipt-ocr`, …). The web owns the Thai label. */
  stepKind: string;
  bucket: PartnerAiBudgetBucket;
  sourceRoute: string;
  requestKind: PartnerAiRequestKind;
  /** The hold. `charge_at_bound` records exactly this as the actual. */
  upperBoundSatang: number;
  /** Only a breach row has settled money; an `UNRESOLVED` hold has none yet. */
  settledCostSatang: number | null;
  /** 'YYYY-MM', Asia/Bangkok — the PINNED month this hold settles into. */
  monthKey: string;
  createdAt: string;
  dispatchedAt: string | null;
  /** Shortened for display; never the full execution identity. */
  invocationKeyShort: string;
};

export type PartnerAiCreditHoldsDto = {
  /** Whether the CALLER may act. Reading is `system.partner_dashboard.read`; every button is
   *  `system.partner_ai_model.manage`, so a read-only operator sees the table and no buttons. */
  canManage: boolean;
  /** The company is DISABLED/ARCHIVED, so nothing on this card may be written. */
  companyLocked: boolean;
  /** Every month, newest hold first, one page at a time (add-on C11: older holds stay findable). */
  items: PartnerAiCreditHoldDto[];
  /** The months this read swept: the current, the previous and any month still holding a live row. */
  monthKeys: string[];
  /** Pass back as `?cursor=` for the next page; null on the last page. */
  nextCursor?: string | null;
};

/** What `POST …/ai-credit-holds/:id/<action>` answers. */
export type PartnerAiCreditHoldActionResultDto = {
  id: string;
  action: 'release' | 'charge_at_bound' | 'acknowledge_breach';
  /** Terminal status of the hold after the decision. */
  status: 'CANCELLED' | 'SETTLED';
  /** Satang this decision recorded as real spend; 0 for release and acknowledge. */
  chargedSatang: number;
};

export const PARTNER_ADJUSTMENT_REASON_MAX_LENGTH = 500;
export function partnerAdjustmentReason(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= PARTNER_ADJUSTMENT_REASON_MAX_LENGTH
    ? value.trim() : null;
}
export type PartnerAiAdjustmentField = 'modelId' | 'monthlyBudgetSatang' | 'enabled' | 'monthlyLimit' | 'receiptQuotaEnforced'
  // Split-policy history (spec §12.4). Scalars only, like every field above: `pendingBudgetPolicy`
  // is rendered as the compact string `<mode>:<chat>:<ocr>:<YYYY-MM>` so a scheduled change, an
  // edit of one and a cancellation each show up as a plain before/after pair.
  | 'budgetMode' | 'chatMonthlyBudgetSatang' | 'ocrMonthlyBudgetSatang' | 'budgetConfigVersion' | 'pendingBudgetPolicy'
  // Hold reconciliation (hold spec §4.2). One field per operator decision, each a before/after pair
  // of the hold's own status or breach state, so the history row reads as a plain transition.
  | 'creditHoldStatus' | 'creditBreachAcknowledged';
export type PartnerAiAdjustmentHistory = {
  items: Array<{ id:string; recordedAt:string; actorId:string|null; actorName:string|null; source:'ADMIN_ADJUSTMENT'|'LEGACY_ADMIN'; reason:string|null;
    changes:Array<{field:PartnerAiAdjustmentField;before:string|number|boolean|null;after:string|number|boolean|null}> }>;
  nextCursor:string|null;
};

/** Platform-admin OCR control. Both fields are absolute desired state; replaying the same body is a no-op. */
export type SetPartnerOcrConfigDto = {
  reason: string;
  enabled: boolean;
  /** Trial/manual receipts only. null inherits startup; omitted preserves the saved override. */
  receiptQuotaEnforced?: boolean | null;
  /** null = unlimited; otherwise 1..1,000,000 reads per Bangkok calendar month. */
  monthlyLimit: number | null;
  /** CAS fence from the latest partner AI-usage read. */
  expectedVersion: number;
};

export type PartnerOcrConfigDto = {
  enabled: boolean;
  receiptQuotaEnforced?: boolean | null;
  monthlyLimit: number | null;
  /** Dedicated OCR-config CAS version; starts at 0 and increments only on a real config change. */
  version: number;
  /** null when the company has never needed an explicit AI/OCR configuration row. */
  updatedAt: string | null;
};

export type PartnerAiUsageMonthDto = {
  /** 'YYYY-MM' in Asia/Bangkok. */
  monthKey: string;
  costSatang: number;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
};

export type PartnerAiRequestKind = 'TEXT' | 'IMAGE' | 'OTHER' | 'UNKNOWN';
export type PartnerAiBudgetBucket = 'CHAT' | 'OCR' | 'UNKNOWN';
/** `UNKNOWN` stays LAST: the breakdown folds an unrecognised stored value into the final key. */
export type PartnerAiUsageBasis = 'PROVIDER_REPORTED' | 'CONSERVATIVE_ESTIMATE' | 'OPERATOR_CHARGED_AT_BOUND' | 'COMPANY_ABSORBED' | 'UNKNOWN';

/**
 * One slice of a month's AI spend, derived from `AiUsageEvent` rows (remediation spec §11.1).
 * Money is integer satang on the wire like every other money field.
 */
export type PartnerAiUsageMeasuresDto = {
  costSatang: number;
  /** Provider calls = MODEL_CALL rows only. NOT a receipt count: one picture can cost several calls. */
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  /**
   * Cache cost summed from the pricing snapshots of the rows that carry one. `null` = UNAVAILABLE
   * (no priced evidence in this slice), never 0. When `coverage.status` is `partial` this covers
   * only the rows that have a snapshot — the token counts above still cover every row.
   */
  cacheCostSatang: { read: number; write: number } | null;
};

/**
 * Current-month breakdown derived from the event ledger (remediation spec §11.1–11.3).
 * Every list always contains its `UNKNOWN` row, so each list reconciles exactly with `total`.
 */
export type PartnerAiUsageBreakdownDto = {
  monthKey: string;
  /**
   * Event-derived month total. `PartnerAiUsageDto.current` is the running `CompanyAiMonthlyUsage`
   * aggregate instead; the event total also includes COMPANY_ABSORBED internal cost; they may also differ if events are
   * ever pruned. Both are exposed rather than reconciled away.
   */
  total: PartnerAiUsageMeasuresDto;
  /** Server-derived before the provider call; `UNKNOWN` is history without metadata, never guessed. */
  byRequestKind: Array<{ requestKind: PartnerAiRequestKind } & PartnerAiUsageMeasuresDto>;
  /** Spend only in this phase; `reserved`/`available` per bucket are added in §12 without renaming. */
  byBudgetBucket: Array<{ budgetBucket: PartnerAiBudgetBucket } & PartnerAiUsageMeasuresDto>;
  /** Includes COMPANY_ABSORBED internal cost separately; it is excluded from customer aggregates. */
  byUsageBasis: Array<{ usageBasis: PartnerAiUsageBasis } & PartnerAiUsageMeasuresDto>;
  /** Signed COST_ADJUSTMENT totals, already included in `total` cost/tokens and never in `calls`. */
  adjustments: { costSatang: number; rows: number };
  /** Honest label for the rollout month; `firstMetadataAt` is when this company's first tagged row landed. */
  coverage: {
    status: 'complete' | 'partial' | 'none';
    calls: number;
    callsWithMetadata: number;
    firstMetadataAt: string | null;
  };
};

/** Partner-console AI spend meter (metering spec §7.7) — system-admin surface only. */
export type PartnerAiUsageDto = {
  /**
   * Whether the CALLER may write this card. Reading is `system.partner_dashboard.read`; every
   * control on it is `system.partner_ai_model.manage`, so a read-only operator keeps all the
   * numbers and gets no form (spec §11.3/§11.4). Optional: a pre-D2 API omits it, and the web then
   * keeps today's behaviour of showing the form and letting the server answer 403.
   */
  canManage?: boolean;
  current: PartnerAiUsageMonthDto | null;
  previous: PartnerAiUsageMonthDto | null;
  budget: {
    /** Override when set, else the platform default — what the five enforcement seams compare against. */
    effectiveSatang: number;
    overrideSatang: number | null;
    defaultSatang: number;
    ceilingSatang: number;
    /**
     * The effective CHAT/OCR policy for the current Bangkok month (spec §12.5), resolved by the
     * same function admission uses.
     */
    policy: PartnerAiBudgetPolicyDto;
    /**
     * Live money position for the current Bangkok month (spec §12.3, ADR 0013 §10). `spent` is the
     * bucket aggregate — the same number admission compares — and `reserved` is the live sum of
     * non-terminal holds, so the console can say "not enough left" without ever calling it "full".
     */
    position: PartnerAiBudgetPositionDto;
    /** Chat credit facts the console explains next to `policy.chatSource` (admin tab rework). */
    chatCredit?: {
      /** A sales deal's chat credit that is live now, even when an admin setting wins over it. */
      deal: { satang: number; endsAt: string | null } | null;
      /** From this instant AI credit runs on package cycles and lots (add-on spec §11); null = not moved. */
      cutoverAt: string | null;
    };
  };
  /** Current month's spend by `usageTag`, highest first, at most 10 rows. */
  topTags: Array<{ tag: string } & PartnerAiUsageMeasuresDto>;
  /** Everything outside `topTags`, so top-10 + other reconciles with `breakdown.total`. */
  otherTags: { tags: number } & PartnerAiUsageMeasuresDto;
  breakdown: PartnerAiUsageBreakdownDto;
  ocr: {
    config: PartnerOcrConfigDto;
    /** Observed enforcement, independent from the operational OCR cap. Paid grants cannot be bypassed. */
    planQuota?: { enforced: boolean; source: 'PAID_GRANTS' | 'COMPANY' | 'DEFAULT'; defaultEnforced: boolean };
    /** The receipt-image balance admission uses right now (admin tab rework). Absent from an older API. */
    receiptImages?: PartnerReceiptImagesDto;
    current: PartnerOcrUsageMonthDto;
    previous: PartnerOcrUsageMonthDto;
  };
};

/**
 * Receipt images a shop can still have read, from the same lots and counters admission uses
 * (add-on spec §6.1, §17.2). Counts are images, never money.
 */
export type PartnerReceiptImagesDto = {
  /**
   * `PACKAGE_LOTS`: a paid package — package lots, then team and purchased lots; always enforced.
   * `MONTHLY`: a trial or staff-set package — an allowance per Bangkok month plus admin gifts.
   * `NONE`: no package term, so no image limit comes from a package.
   */
  basis: 'PACKAGE_LOTS' | 'MONTHLY' | 'NONE';
  tierKey: string | null;
  /** Whether reaching the limit stops reading. `PACKAGE_LOTS` is always true. */
  enforced: boolean;
  /** `PACKAGE_LOTS`: the package is paid up and the company is active; otherwise reading is refused. */
  active: boolean;
  /**
   * Package lots now (`PACKAGE_LOTS`) or this month's allowance (`MONTHLY`); null for `NONE`.
   * `expiresAt` is the lot admission draws from next (null for a monthly allowance).
   */
  package: { limit: number; used: number; remaining: number; expiresAt: string | null } | null;
  /** Team gifts and purchases ("ยอดเพิ่มเติม"); `expiresAt` is the lot drawn next, null when none is left. */
  additional: { remaining: number; expiresAt: string | null };
  /** `package.remaining + additional.remaining`; null for `NONE`. */
  totalRemaining: number | null;
};

export type PartnerOcrUsageMonthDto = {
  /** 'YYYY-MM' in Asia/Bangkok. */
  monthKey: string;
  /** OCR requests admitted immediately before a provider call, success and failure combined. */
  usedCount: number;
  /** Stored ACTIVE receipt primary/supporting attachments; excludes signatures/generated/payment evidence. */
  uploadedReceiptDocumentCount: number;
  sourceCounts: Array<{
    sourceRoute: 'receipt-ocr-web' | 'receipt-ocr-line' | 'bank-statement-extract';
    reads: number;
  }>;
};

/**
 * Platform-wide AI budget settings (metering spec §7.4, §7.9) — system-admin surface only.
 * Money stays in satang integers on the wire like every other money field; the web converts to
 * baht for the operator. `source` says whether each value comes from the DB row or the env
 * fallback, and `envDefaults` is what the platform would fall back to if the row were removed.
 */
export type PlatformAiBudgetDto = {
  monthlyBudgetSatang: number;
  ceilingSatang: number;
  source: { monthlyBudgetSatang: 'db' | 'env'; ceilingSatang: 'db' | 'env' };
  envDefaults: { monthlyBudgetSatang: number; ceilingSatang: number };
  /** Write only (add-on spec §5.3, plan C6): companies on AI credit that inherit this default and now
   *  hold more credit than this month's room under it. A warning; the save went through. */
  aiCreditWarningCompanyCount?: number;
};

/** Both fields are required on write: the pair is validated together (ceiling ≥ default). */
export type SetPlatformAiBudgetDto = {
  monthlyBudgetSatang: number;
  ceilingSatang: number;
};

// Write-only input for platform shared LINE credential; secret fields never returned
export type SetSharedLineCredentialDto = {
  channelId: string;
  channelSecret: string;
  accessToken?: string;
};

/** @deprecated alias for SetSharedLineCredentialDto */
export type SetPartnerLineCredentialDto = SetSharedLineCredentialDto;

// ── System console user lookup ────────────────────────────────────────────────
// One email can own several companies (signup attach) and two accounts can be merged
// (AccountMergeTicket), so the console needs a person-centric read next to its per-company ones.

export type SystemUserMembershipDto = {
  companyId: string;
  companyName: string;
  companyStatus: PartnerCompanyStatus;
  /** R-C6/R-C7: the term's own state, so a term-locked shop never reads as "ปิดใช้งาน". */
  companyPlanState?: PlanTermState;
  membershipStatus: PartnerMembershipStatus;
  roleKeys: string[];
};

/** `merged_into`: this account's companies moved out into `otherUserId` and it was disabled.
 *  `received_merge`: `otherUserId`'s companies moved in here. */
export type SystemUserMergeTrailDto = {
  direction: 'merged_into' | 'received_merge';
  otherUserId: string;
  at: string;
};

export type SystemUserLookupItemDto = {
  userId: string;
  displayName: string;
  username?: string;
  email?: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  /** An ACTIVE LINE ExternalIdentity is on record. */
  lineLinked: boolean;
  /** Non-ACTIVE memberships are included on purpose: a DISABLED duplicate left behind by a
   *  merge is part of the story the admin is trying to read. The UI labels them. */
  memberships: SystemUserMembershipDto[];
  mergeTrail: SystemUserMergeTrailDto[];
};

export type SystemUserLookupDto = { items: SystemUserLookupItemDto[] };

// ---- Purchase without setup PR E (R-E3, DQ9): admin legal-identity edit ----

/** GET .../identity — the CAS token and which change kinds the form may offer. Mirrors
 *  `CompanyIdentityControl` (company-tax-identity.ts) but adds `allowedChangeKinds`, which the
 *  console needs and the company's own wizard derives client-side from `USER_LEGAL_IDENTITY_CHANGE_KINDS`. */
export type PartnerIdentityControlDto = {
  legalIdentityVersion: number;
  captureWindowOpen: boolean;
  authoritativeLatched: boolean;
  fieldLatched: { registeredName: boolean; addressJson: boolean };
  allowedChangeKinds: string[];
};

/** PATCH .../identity body: the company identity fields, plus the two the console adds. */
export type PatchPartnerIdentityDto = {
  expectedLegalIdentityVersion: number;
  changeKind: string;
  registeredName?: string;
  taxId?: string;
  addressJson?: CompanyLegalAddress;
  effectiveFrom?: CivilDate;
  correctionReason?: string;
  note?: string;
  evidenceRef?: string;
  /** Internal reason (never shown to the customer). */
  reason: string;
  supportRequestId?: string;
};
