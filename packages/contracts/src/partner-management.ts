// ---- Item 10A Partner Management DTOs ----

import type { CivilDate } from './civil-date.js';
import type { VatRegistrationStatus } from './company-tax-identity.js';

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
};

export const PARTNER_ADJUSTMENT_REASON_MAX_LENGTH = 500;
export function partnerAdjustmentReason(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= PARTNER_ADJUSTMENT_REASON_MAX_LENGTH
    ? value.trim() : null;
}
export type PartnerAiAdjustmentField = 'modelId' | 'monthlyBudgetSatang' | 'enabled' | 'monthlyLimit' | 'receiptQuotaEnforced';
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
export type PartnerAiUsageBasis = 'PROVIDER_REPORTED' | 'CONSERVATIVE_ESTIMATE' | 'UNKNOWN';

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
   * aggregate instead; the two are normally identical and may legitimately differ if events are
   * ever pruned. Both are exposed rather than reconciled away.
   */
  total: PartnerAiUsageMeasuresDto;
  /** Server-derived before the provider call; `UNKNOWN` is history without metadata, never guessed. */
  byRequestKind: Array<{ requestKind: PartnerAiRequestKind } & PartnerAiUsageMeasuresDto>;
  /** Spend only in this phase; `reserved`/`available` per bucket are added in §12 without renaming. */
  byBudgetBucket: Array<{ budgetBucket: PartnerAiBudgetBucket } & PartnerAiUsageMeasuresDto>;
  /** A CONSERVATIVE_ESTIMATE slice must never be presented as measured provider tokens. */
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
  current: PartnerAiUsageMonthDto | null;
  previous: PartnerAiUsageMonthDto | null;
  budget: {
    /** Override when set, else the platform default — what the five enforcement seams compare against. */
    effectiveSatang: number;
    overrideSatang: number | null;
    defaultSatang: number;
    ceilingSatang: number;
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
    current: PartnerOcrUsageMonthDto;
    previous: PartnerOcrUsageMonthDto;
  };
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
