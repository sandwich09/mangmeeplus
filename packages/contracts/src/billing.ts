import { PLAN_TIER_PRESETS, type PlanTierKey, type CompanyPlanCapacity, type PlanTermLockReason, type PlanTermState } from './plan-term.js';
import { TIER_FEATURE_PRESETS } from './menu-entitlements.js';
import type { SalesDealBaseTier, SalesDealCadence } from './sales.js';
import type { BillingCompanyProfile } from './billing-company-profile.js';
import type { CompanyLegalAddress } from './company-tax-identity.js';

export const STRIPE_API_VERSION = '2026-08-26.dahlia' as const;
/** Owner 2026-09-21: ENTERPRISE opened for purchase once WHT/50 ทวิ shipped; it is a tier like any other. */
export const BILLING_PAID_TIERS = ['STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999'] as const;
export type PaidTier = typeof BILLING_PAID_TIERS[number];
export type BillingMode = 'TEST' | 'LIVE';
export type BillingPurchaseSource = 'NO_TERM' | 'TRIAL' | 'ADMIN_MANUAL' | 'PAID_CURRENT_MODE' |
  'PAID_EXPIRED_CURRENT_MODE' | 'PAID_OTHER_MODE' | 'SOURCE_INCONSISTENT';
export type BillingSettlementTotals = {grossCharges:string;knownTax:string;unknownTaxCharges:number;fees:string;netMovement:string;payouts:string;payoutReversals:string;excluded:number};
export type BillingSettlementRun = {id:string;mode:BillingMode;state:string;version:number;reason:string;windowStart:string;windowEnd:string;createdAt:string;observedAt:string|null;
  pages:number;seen:number;matched:number;different:number;manual:number;missing:number;totals:BillingSettlementTotals;errorCode:string|null;retryAt:string|null;canCancel:boolean;canResume:boolean;canRun:boolean};
export type BillingSettlementFinding = {id:string;runId:string;classification:'MATCHED'|'DIFFERENT'|'MANUAL'|'LOCAL_MISSING';companyId:string|null;companyName:string|null;invoiceId:string|null;
  observedAt:string;createdAt:string;availableAt:string;refundState:string|null;kind:string;currency:string;amountSatang:number;feeSatang:number;netSatang:number;taxSatang:number|null;availability:'pending'|'available';
  payout:{status:'paid'|'pending'|'in_transit'|'canceled'|'failed';expectedArrivalAt:string;automatic:boolean;reconciliation:'MATCHED'|'PENDING'|'MANUAL'|'INCOMPLETE'|'FAILED';constituentCount:number|null}|null};
export type BillingSettlementFindings = {items:BillingSettlementFinding[];nextCursor:string|null;caseIds:string[]};
export type BillingProviderScanView = {
  id: string; mode: BillingMode; state: string; version: number; reason: string;
  windowStart: string; windowEnd: string; createdAt: string; checkpointAt: string | null;
  pages: number; seen: number; imported: number; known: number; ignored: number; incompatible: number;
  retryAt: string | null; errorCode: string | null; canCancel: boolean; canResume: boolean; automatic?:boolean;kind?:'EVENTS'|'INVOICES';companyId?:string;invoiceFindings?:{matched:number;missing:number;different:number};
};
export type BillingInvoiceFinding = {id:string;scanId:string;companyId:string;observedAt:string;invoiceCreatedAt:string;providerStatus:string;
  classification:'MATCHED'|'LOCAL_MISSING'|'DIFFERENT';localInvoiceId:string|null;localApplyState:string|null;reviewCaseId:string|null};
export type BillingScanScheduleInput = { enabled:boolean;intervalHours:number;initialLookbackHours:number;expectedVersion:number;reason:string };
export type BillingScanScheduleOperation = {id:string;mode:BillingMode;state:'PREVIEW'|'SUCCEEDED'|'CANCELLED';version:number;sourceRevision:number;previewHash:string;
  enabled:boolean;intervalHours:number;initialLookbackHours:number;reason:string;initiatorUserId:string;createdAt:string;expiresAt:string;publishedAt:string|null;
  canPublish:boolean;canCancel:boolean};
export type BillingScanSchedule = {mode:BillingMode|'DISABLED';revision:number;publicationId:string|null;ownerUserId:string|null;enabled:boolean;intervalHours:number;
  initialLookbackHours:number;canManage:boolean;blockedReason:string|null;nextDueAt:string|null;lastRun:BillingProviderScanView|null;lastCompletedWindowEnd:string|null};
export type BillingInterval = 'month' | 'year';
export type BillingPurchaseMode = 'CARD_AUTO' | 'CARD_ONCE' | 'PROMPTPAY_ONCE' | 'PROMPTPAY_RENEW';
export type BillingOfferKey = `${PaidTier}:${BillingInterval}`;
export type BillingTaxTreatment = 'INCLUSIVE_VAT_7' | 'EXCLUSIVE_VAT_7' | 'NOT_VAT_REGISTERED';
export const BILLING_ACTIONS = ['new_sales', 'card_once', 'promptpay_once', 'promptpay_renew', 'plan_changes', 'portal_payment_method', 'portal_change_plan', 'portal_cancel_subscription', 'notification_delivery', 'refunds'] as const;
export type BillingAction = typeof BILLING_ACTIONS[number];
export const BILLING_PERMISSIONS = ['system.billing.read', 'system.billing.financial.read', 'system.billing.document.read', 'system.billing.issue.manage',
  'system.billing.reconcile.run', 'system.billing.apply.retry', 'system.billing.policy.manage', 'system.billing.gate.manage',
  'system.billing.approval.approve', 'system.billing.notification.retry', 'system.billing.collection.manage', 'system.billing.refund.manage',
  'system.billing.override.manage', 'system.billing.audit.read', 'system.billing.export'] as const;

const MONTHLY = { STARTER_249: 24900, BASIC_499: 49900, PRO_999: 99900, ENTERPRISE_1999: 199900 } as const;
export type BillingOffer = {
  offerKey: Exclude<PlanTierKey, 'FREE_TRIAL_15'>; interval: BillingInterval;
  /** Catalog offers are always 1; a sales deal (spec §19.2/S35) sells N whole months in one offer. */
  intervalCount: number;
  label: string; priceSatang: number; currency: 'THB'; branchLimit: number; employeeLimit: number; monthlySlipLimit: number;
  /** Granted at once for the paid period; monthlySlipLimit is only the tier's monthly equivalent. */
  receiptAllowance: number; receiptAllowanceCadence: 'PAID_PERIOD';
  /**
   * Owner 2026-09-21: the menus this offer unlocks, so a card can list them and the purchase can
   * grant exactly them. A catalog offer carries `TIER_FEATURE_PRESETS[tier]`; a sales deal carries
   * its own snapshot's set. Thai labels are derived from the keys by the reader.
   */
  featureKeys: string[];
  availability: 'AVAILABLE' | 'UNAVAILABLE' | 'COMING_SOON'; reason: string | null;
};
export type BillingOfferTerms = { monthlyPriceSatang:number; annualPriceSatang:number; monthlyReceiptAllowance:number;
  /** Paired optional capacities; older policies keep catalog defaults. */
  branchLimit?:number; employeeLimit?:number };
export function billingOffer(tier: Exclude<PlanTierKey, 'FREE_TRIAL_15'>, interval: BillingInterval,
  policy?: Partial<Pick<BillingPolicy,'offerTerms'|'priceIds'>> | null): BillingOffer {
  const preset = PLAN_TIER_PRESETS[tier];
  const terms=policy?.offerTerms?.[tier];
  const monthlyReceipts=terms?.monthlyReceiptAllowance??preset.monthlySlipLimit;
  // ENTERPRISE is the one tier whose Stripe Prices the Owner has not bound yet; until it has them
  // the honest answer is "เร็ว ๆ นี้", not "ยังไม่เปิดรับชำระเงิน". Every other tier, and ENTERPRISE
  // once bound, falls back to the ordinary closed-sales reason and `catalog()` opens it.
  const comingSoon = tier === 'ENTERPRISE_1999' && !policy?.priceIds?.[`${tier}:${interval}`];
  return { offerKey: tier, interval, intervalCount: 1, label: preset.labelTh,
    priceSatang: terms ? (interval==='year'?terms.annualPriceSatang:terms.monthlyPriceSatang) : MONTHLY[tier] * (interval === 'year' ? 10 : 1), currency: 'THB',
    branchLimit: terms?.branchLimit??preset.branchLimit, employeeLimit: terms?.employeeLimit??preset.employeeLimit, monthlySlipLimit: monthlyReceipts,
    receiptAllowance: monthlyReceipts * (interval === 'year' ? 12 : 1), receiptAllowanceCadence: 'PAID_PERIOD',
    featureKeys: [...TIER_FEATURE_PRESETS[tier]],
    availability: comingSoon ? 'COMING_SOON' : 'UNAVAILABLE',
    reason: comingSoon ? 'COMING_SOON' : 'BILLING_NOT_READY' };
}

export type BillingPolicy = {
  schemaVersion: 1;
  /** New accepted purchases only; omitted tiers retain original defaults. */
  offerTerms?: Partial<Record<PaidTier,BillingOfferTerms>> | null;
  paidStart: 'IMMEDIATE' | 'AFTER_TRIAL' | null;
  taxTreatment: BillingTaxTreatment | null;
  graceDays: number | null;
  cancellation: 'PERIOD_END' | null;
  planChanges: 'UPGRADE_PRORATED_DOWNGRADE_PERIOD_END' | null;
  debtRecovery: 'MANUAL_REVIEW' | null;
  refundPolicy: 'MANUAL_REVIEW' | null;
  /** Per manually approved refund command; absent/null keeps admission closed. */
  refundLimitSatang?: number | null;
  priceIds: Partial<Record<BillingOfferKey, string>>;
  /** Internal prepaid scheduling prices; never public offers. */
  zeroPriceIds?: Partial<Record<BillingOfferKey, string>>;
  taxRateId: string | null;
  portalConfigurationId: string | null;
  consentRevision: string;
  /** New purchase admission only. Absent/null: all; []: closed; otherwise explicit existing companies. */
  salesCompanyIds?: string[] | null;
  /** Internal case follow-up defaults in minutes; absent/null is OFF. */
  supportSlaMinutes?: { NORMAL:number; HIGH:number; CRITICAL:number } | null;
  issuer?: { legalName: string; address: string; thaiTaxId: string; stripeTaxId: string };
};
export const BILLING_DRAFT_POLICY: BillingPolicy = {
  schemaVersion: 1, paidStart: 'IMMEDIATE', taxTreatment: 'NOT_VAT_REGISTERED', graceDays: 7, cancellation: 'PERIOD_END',
  planChanges: 'UPGRADE_PRORATED_DOWNGRADE_PERIOD_END', debtRecovery: 'MANUAL_REVIEW', refundPolicy: 'MANUAL_REVIEW', priceIds: {}, taxRateId: null,
  portalConfigurationId: null, consentRevision: 'billing-v2-upfront-annual',
};
export type BillingReceiptUsage = {
  used: number; limit: number | null; remaining: number | null;
  cadence: 'LEGACY_MONTH' | 'PAID_GRANTS'; resetsAt: string | null; expiresAt: string | null;
  /** Monthly base and fixed Admin gifts have separate clocks; absent for purchased allowances. */
  monthlyAllowance?: { limit: number | null; used: number; additionalRemaining: number; additionalExpiresAt: string | null };
};
export type BillingFeatureImpact = { removed: { featureKey:string; labelTh:string }[];
  added: { featureKey:string; labelTh:string }[]; preservedAdmin:number };
export type BillingQuote = {
  /** Absent only on legacy quotes/history; new purchases require a reviewed profile. */
  billingProfile?: BillingCompanyProfile;
  quoteId: string; companyId: string; companyName: string; policyRevision: string; expiresAt: string;
  purchaseMode?: BillingPurchaseMode;
  offer: BillingOffer; subtotalSatang: number; taxSatang: number; totalSatang: number;
  taxTreatment: BillingTaxTreatment; consentRevision: string; paidStart: 'IMMEDIATE' | 'AFTER_TRIAL';
  /** Purchase without setup (R-A2): the company's document recipient, else the buyer's verified
   *  account email; `null` = Stripe Checkout asks for it. */
  billingEmail: string | null; trialEndsAt: string | null; usage: BillingReceiptUsage;
  previousSource?: BillingPurchaseSource; previousTermEndsAt?: string | null;
  featureImpact?: BillingFeatureImpact;
  /** Present only on a sales-deal quote (spec §19.2): what the confirm screen names. */
  deal?: { dealId: string; months: number; description: string; baseLabel: string };
  /** Paid now; the running one-time package keeps its rights until this boundary. */
  advanceDeal?: { startsAt: string; firstCycleEndsAt: string; nextChargeAt: string };
  purchase?: { kind: 'INITIAL' | 'REPEAT' | 'RESTART' | 'UPGRADE' | 'FULL_PACKAGE_UPGRADE' | 'SCHEDULED_CHANGE' | 'ADVANCE_DEAL'; previousInterval?: BillingInterval; previousPaidThrough: string | null; projectedPaidThrough: string;
    receiptUnitsAdded: number; projectedRemainingReceipts: number;
    trialCarryover?: { receiptUnits: number; expiresAt: string } };
  upgrade?: { prorationAt: string; nextRenewalTotalSatang: number;
    segments: { start: string; end: string; amountSatang: number; receiptUnitsAdded: number }[] };
  capacity?: BillingCapacityImpact;
  pendingPlanChange?: { operationId: string; oldEffectiveAt: string; newEffectiveAt: string; offer: BillingOffer; totalSatang: number; capacity: BillingCapacityImpact };
};
export type BillingCapacitySelection = { sourceHash: string; branchIds: string[]; memberships: { id: string; defaultBranchId: string | null }[] };
export type BillingCapacityOptions = { companyId: string; offerKey: string; interval: BillingInterval; sourceHash: string;
  branchLimit: number; employeeLimit: number; overCapacity: boolean;
  branches: { id: string; name: string; headOffice: boolean; required: boolean; openReimbursements: number }[];
  memberships: { id: string; name: string; owner: boolean; required: boolean; allBranches: boolean; branchIds: string[]; defaultBranchId: string | null }[] };
export type BillingCapacityImpact = { retainedBranches: string[]; suspendedBranches: string[]; retainedMembers: string[]; suspendedMembers: string[];
  defaults: { member: string; branch: string | null }[] };
export type BillingCollectionPause = {behavior:'keep_as_draft'|'void'|'mark_uncollectible'|'unknown';resumesAt:string|null};
export type BillingStatus = {
  billingProfile?: BillingCompanyProfile;
  collectionPause?: BillingCollectionPause|null;
  companyId: string; companyName: string; mode: BillingMode | 'DISABLED'; policyRevision: string | null;
  paymentState: 'NONE' | 'PENDING' | 'UNKNOWN' | 'PAID' | 'FAILED' | 'ACTION_REQUIRED';
  applyState: 'NONE' | 'PENDING' | 'APPLIED' | 'HELD' | 'FAILED';
  purchaseEligibility?: 'ELIGIBLE' | 'COMPANY_SALES_CLOSED' | 'SOURCE_REVIEW_REQUIRED' | 'ENTITLEMENT_REVIEW_REQUIRED';
  purchaseSource?: BillingPurchaseSource;
  renewalMode?: BillingPurchaseMode | 'NONE';
  enabledPurchaseModes?: BillingPurchaseMode[];
  availablePurchaseModes?: BillingPurchaseMode[];
  renewalInvoiceUrl?: string | null;
  renewalInvoiceDueAt?: string | null;
  /**
   * The APPROVED, unexpired sales deal this shop may pay for right now (spec §19.2, S39), whole:
   * the offer card draws from this alone, so an OWNER never needs `company.setup.manage` to read
   * their own offer. `purchaseModes` is the card's OWN list — `availablePurchaseModes` answers the
   * catalog and is filtered by the account's renewal family.
   */
  deal?: { dealId: string; base: SalesDealBaseTier; baseLabel: string; priceSatang: number; months: number;
    offerExpiresAt: string; purchaseModes: BillingPurchaseMode[];
    branchLimit: number; employeeLimit: number; monthlySlipLimit: number;
    featureKeys: string[]; aiMonthlyBudgetSatang: number | null; creditScope?: 'CHAT' | 'TOTAL'; description: string;
    /** D-P5-1: the card says "ตัดบัตร/ออกบิลทุกเดือน(ปี) ที่ราคานี้" and `priceSatang` is per cycle.
     *  `cycles` is "N รอบ แล้วกลับราคาปกติ"; `null` on an until-revoked deal. */
    autoRenew: boolean; cadence: SalesDealCadence | null; cycles: number | null };
  refundReviewPending?: boolean;
  pendingDeal?: { dealId: string; purchaseMode: 'CARD_AUTO' | 'PROMPTPAY_RENEW'; startsAt: string; firstCycleEndsAt: string; nextChargeAt: string; state: 'PAID' | 'PENDING_BINDING' | 'HELD' } | null;
  accessState: 'ACTIVE' | 'EXPIRED' | 'HELD'; subscriptionState: string; documentState: 'NONE' | 'PENDING' | 'READY';
  /** R2: present only while `accessState` is EXPIRED — why the shop is locked, so the package page
   *  can say "ยังไม่มีแพ็กเกจ" to a never-started shop and "ครบกำหนด" to one whose term ran out. */
  lockReason?: PlanTermLockReason;
  attemptId: string | null; reference: string | null; observedAt: string | null;
  canCancelCheckout?: boolean;
  tierKey: string | null; interval: BillingInterval | null; termEndsAt: string | null; paidThrough: string | null; nextChargeAt: string | null;
  cancelAtPeriodEnd: boolean; graceEndsAt: string | null; allowedActions: BillingAction[];
  usage: BillingReceiptUsage;
  effectiveCapacity?: CompanyPlanCapacity|null;
  issues: { reference: string; code: string }[];
  collection?: BillingCollectionOperation | null;
  pendingPlanChange?: BillingCollectionOperation | null;
  planCapacityRepair?: { operationId: string; version: number; offerKey: string; interval: BillingInterval } | null;
  capacityRepair?: { attemptId: string; attemptVersion: number; offerKey: string; interval: BillingInterval } | null;
  /** Purchase without setup (R-A7/R-A8): who receives the billing documents. Written when a payment
   *  applies, so it stays empty between PAID and APPLIED. */
  recipient?: BillingRecipientInfo;
  /** DQ5: the address typed at Stripe Checkout, offered to the shop profile; never written to the company. */
  checkoutAddress?: CompanyLegalAddress | null;
};
export type BillingCollectionAction = 'CANCEL_RENEWAL' | 'RESUME_RENEWAL' | 'SCHEDULE_DOWNGRADE' | 'CANCEL_DOWNGRADE' | 'PREPAID_PLAN_CHANGE' | 'EXTEND_TERM' | 'ADMIN_PAUSE_COLLECTION' | 'ADMIN_RESUME_COLLECTION';
export type BillingCollectionOperation = { id: string; companyId: string; action: BillingCollectionAction; state: string; version: number;
  previewHash: string; effectiveAt: string; nextRenewalTotalSatang: number; expiresAt: string; observedAt: string | null;
  errorCode: string | null; allowedActions: ('submit' | 'withdraw')[];
  targetOffer?: BillingOffer; currentOffer?: BillingOffer; capacity?: BillingCapacityImpact;
  /** Phase 7: the menus the target package opens and closes, shown before the customer confirms. */
  featureImpact?: BillingFeatureImpact };
export type BillingCheckoutBody = { quoteId: string; consentRevision: string; accepted: true; channel: 'web' | 'line' };
export type BillingCheckoutResult = { attemptId: string; state: string; checkoutUrl: string | null };
export type BillingAttemptView = {
  attemptId: string; state: string; errorCode: string | null; observedAt: string;
  paymentState: 'PENDING' | 'PAID' | 'FAILED'; applyState: BillingStatus['applyState']; invoiceReference: string | null;
  /** Present when this Checkout paid a sales deal, so the return page can name what was bought. */
  deal?: { dealId: string; baseLabel: string; months: number };
  advanceDeal?: { startsAt: string; firstCycleEndsAt: string; nextChargeAt: string };
};
export type BillingInvoiceItem = { id: string; number: string | null; currency: 'THB'; amountSatang: number;
  refundedSatang: number; disputed: boolean; financialObservedAt: string | null;
  paymentState: string; applyState: string; periodStart: string; periodEnd: string; createdAt: string; hasDocuments: boolean;
  documentActions?: { canResend: boolean } };
export type BillingAdjustmentKind = 'refunds' | 'credit-notes';
/** Implemented customer recovery pages only; this never grants business or Admin access. */
export function isBillingCustomerRecoveryPath(path: string, companyId: string): boolean {
  const pathname=path.split(/[?#]/,1)[0]??'',prefix=`/companies/${encodeURIComponent(companyId)}/billing`;
  if(!pathname.startsWith(prefix))return false;
  return /^(?:\/(?:return|invoices\/[A-Za-z0-9_-]{1,128}))?\/?$/.test(pathname.slice(prefix.length));
}
export type BillingAdjustmentItem = { id: string; number: string | null; amountSatang: number; createdAt: string;
  status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled' | 'unknown' | 'issued' | 'void' };
export type BillingAdjustments = { invoiceId: string; invoiceNumber: string | null; kind: BillingAdjustmentKind; mode: BillingMode;
  items: BillingAdjustmentItem[]; nextCursor: string | null; observedAt: string; canOpenDocuments: boolean;
  documentActions?: { canResend: boolean }; recipientEmail?: string | null };
export type BillingCatalog = { schemaVersion: 1; mode: BillingMode | 'DISABLED'; policyRevision: string | null;
  catalogRevision: string; generatedAt: string; validUntil: string; taxTreatment: BillingTaxTreatment | null; offers: BillingOffer[];
  /**
   * Legacy TOTAL safety budget, not the 80-credit CHAT allowance.
   */
  aiMonthlyBudgetSatang: number;
  /** R1: no longer emitted — new signups get no trial (Owner 2026-09-20). Optional rather than
   *  removed so an older client that still reads it keeps compiling against this contract. */
  trial?: { tierKey: 'FREE_TRIAL_15'; days: 30; monthlySlipLimit: 15; branchLimit: 1; employeeLimit: 2; menus: 7 } };

export type BillingOperationType = 'CHECK_PROVIDER_CONFIGURATION' | 'RECONCILE' | 'IMPORT_INVOICE' | 'RETRY_APPLY' | 'RETRY_NOTIFICATION' | 'RECONCILE_NOTIFICATION' | 'RETRY_PROVIDER_EVENT' | 'SET_ACTION_GATE' | 'PUBLISH_POLICY' | 'EXPIRE_CHECKOUT' | 'CHANGE_COLLECTION' | 'REFUND' | 'GRANT_FREE_DAYS' | 'GRANT_OVERRIDE' | 'REVOKE_OVERRIDE' | 'GRANT_RECEIPTS' | 'REVOKE_RECEIPTS' | 'SCHEDULE_PRICE_RETURN' | 'APPLY_PLAN_MENUS' | 'UPDATE_BILLING_EMAIL' | 'CUSTOMER_PROFILE_SYNC';
export type BillingOperationState = 'DRAFT' | 'PREVIEW' | 'AWAITING_APPROVAL' | 'SCHEDULED' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'UNKNOWN' | 'BLOCKED' | 'FAILED' | 'CANCELLED';
export type BillingScope = { kind: 'COMPANY'; companyId: string; mode: BillingMode } | { kind: 'PLATFORM'; mode: BillingMode };
export type BillingConfigurationCheckItem = { kind:'POLICY'|'ACCOUNT'|'PRICE'|'PREPAID_PRICE'|'PORTAL'|'TAX'; offerKey?:BillingOfferKey;
  state:'MATCH'|'DIFFERENT'|'UNAVAILABLE'|'NOT_CONFIGURED'; reason:'MATCH'|'NOT_CONNECTED'|'POLICY_NOT_READY'|'MAPPING_DIFFERENT'|'PROVIDER_UNAVAILABLE'|'ACCOUNT_DIFFERENT' };
export type BillingConfigurationCheck = { id:string; mode:BillingMode; state:'QUEUED'|'RUNNING'|'SUCCEEDED'|'BLOCKED'|'CANCELLED'; version:number;
  sourceVersion:number; isCurrent:boolean; reason:string; createdAt:string; observedAt:string|null; errorCode:string|null; reviewCaseId:string|null;
  result:BillingConfigurationCheckItem['state']|null; items:BillingConfigurationCheckItem[]; canRun:boolean; canCancel:boolean };
export type BillingConfigurationCheckHistory = {items:BillingConfigurationCheck[];nextCursor:string|null;activeCheck:BillingConfigurationCheck|null;canCreate:boolean;mode:BillingMode|'DISABLED';settingsVersion:number};
export type BillingApprovalMode = 'SINGLE_ADMIN' | 'SECOND_REVIEWER';
export type BillingOperationView = { id: string; type: BillingOperationType; state: BillingOperationState; scope: BillingScope;
  version: number; reason: string; initiatorUserId: string; approverUserId: string | null; approvalMode?: BillingApprovalMode | null; errorCode: string | null;
  createdAt: string; observedAt: string | null; expiresAt: string; referenceId: string | null };

export type BillingCheckoutState = 'open'|'expired'|'complete';
export type BillingCheckoutPaymentState = 'paid'|'unpaid'|'no_payment_required';
export type BillingCheckoutAttempts = {companyName:string;items:{id:string;companyId:string;createdAt:string;state:string;hasCheckout:boolean;channel:'web'|'line'}[];nextCursor:string|null};
export type BillingCheckoutReview = {companyId:string;companyName:string;attemptId:string;mode:BillingMode;sourceHash:string|null;
  providerState:BillingCheckoutState|null;paymentState:BillingCheckoutPaymentState|null;expiresAt:string|null;canExpire:boolean;blockedReason:string|null};
export type BillingCheckoutExpiryOperation = BillingOperationView & {companyName:string;previewHash:string;dispatchedAt:string|null;
  providerState:BillingCheckoutState|null;paymentState:BillingCheckoutPaymentState|null;reconciliationPending:boolean;reviewCaseId:string|null;allowedActions:('submit'|'cancel'|'run')[]};

/** endPackage: after a SUCCEEDED refund, end the running paid package now (default keeps it). */
export type BillingRefundInput = { amountSatang:number; reason:string; memo:string; notifyCustomer:boolean; sourceHash:string; endPackage?:boolean };
export type BillingEndPackageReview = { canEnd:boolean; blockedReason:string|null };
export type BillingRefundReview = { companyId:string; companyName:string; invoiceId:string; invoiceNumber:string|null; mode:BillingMode;
  paidSatang:number; refundedSatang:number; disputed:boolean; refundLimitSatang:number|null; canCreate:boolean; blockedReason:string|null;
  sourceHash:string; observedAt:string; usage:BillingStatus['usage']; adjustments:BillingAdjustmentItem[] };
export type BillingRefundOperation = BillingOperationView & { type:'REFUND'; sourceVersion:number; previewHash:string;
  companyName:string; invoiceNumber:string|null; amountSatang:number; taxSatang:number; memo:string; notifyCustomer:boolean;
  paidSatang:number; previousRefundedSatang:number; usage:BillingStatus['usage'];
  allowedActions:('submit'|'approve'|'cancel'|'run')[]; dispatchedAt:string|null; creditNoteId:string|null; creditNoteNumber:string|null;
  refundId:string|null; refundState:BillingAdjustmentItem['status']|null; reviewCaseId:string|null; bankReceiptConfirmed:false;
  endPackage:boolean; packageEnded:boolean|null };

export type BillingOperatorCompany = {
  accountId: string | null; companyId: string; companyName: string; mode: BillingMode | 'DISABLED'; version: number;
  subscriptionState: string; renewalMode?: BillingPurchaseMode | 'NONE'; paidThrough: string | null; nextChargeAt: string | null; observedAt: string | null;
  tierKey: string | null; termEndsAt: string | null; companyStatus: string; pendingAttemptId: string | null;
  /** 'DEAL' (S43/D-P3-6): the contract attempt behind the current term carries a sales-deal snapshot. */
  source: 'TRIAL' | 'MANUAL' | 'STRIPE' | 'DEAL' | 'OTHER_BILLING' | 'NONE';
  planState?: PlanTermState;
  effectiveCapacity?: CompanyPlanCapacity|null;
  paymentState: BillingStatus['paymentState']; applyState: BillingStatus['applyState']; accessState: BillingStatus['accessState']; documentState: BillingStatus['documentState'];
  graceEndsAt: string | null; cancelEffectiveAt: string | null; origin: 'web' | 'line' | null;
  branchLimit: number | null; employeeLimit: number | null; pendingPlanChangeId: string | null; collectionOperationId: string | null;
};
export type BillingOperatorIssue = { id: string; companyId: string | null; companyName?:string|null; kind: string; reference: string;
  operationType?:string|null;
  relatedInvoiceId?:string|null; relatedRefundOperationId?:string|null; resolvedAt?:string|null;
  state: string; assigneeUserId: string | null; note: string | null; version: number; createdAt: string; updatedAt: string;
  assigneeName: string | null; assigneeAvailable: boolean; backupUserId: string | null; backupName: string | null; backupAvailable: boolean;
  priority: 'NORMAL' | 'HIGH' | 'CRITICAL'; followUpAt: string | null; overdue: boolean; episode: number; lastSeenAt: string;
  slaDueAt?:string|null; slaStartedAt?:string|null; slaPolicyRevisionId?:string|null; effectiveFollowUpAt?:string|null };
export type BillingSupportOutcomeKind = 'CUSTOMER_CONTACTED' | 'PROVIDER_CONTACTED' | 'REPLY_RECORDED' | 'REVIEW_REQUESTED';
export type BillingSupportOutcomeInput = { expectedVersion:number; kind:BillingSupportOutcomeKind; note:string };
export type BillingSupportOutcome = { id:string;issueId:string;companyId:string|null;mode:BillingMode;episode:number;sourceVersion:number;
  kind:BillingSupportOutcomeKind;note:string;actorUserId:string;createdAt:string;recordedAt:string|null;expiresAt:string;version:number;
  state:'PREVIEW'|'SUCCEEDED'|'CANCELLED';previewHash:string;canSubmit:boolean;canCancel:boolean };
export type BillingOperatorOverview = { mode: BillingMode | 'DISABLED'; capabilities: string[]; platformScope: boolean; canManageScopes?: boolean;
  companies: BillingOperatorCompany[]; nextCursor: string | null;
  pagination?: { page: number; pageSize: number; total: number } };
export type BillingBatchView={id:string;version:number;previewHash:string;state:string;mode:BillingMode;reason:string;createdAt:string;expiresAt:string;
  progress:'PREVIEW'|'PENDING'|'REVIEW'|'CHECKED'|'PARTIAL'|'STOPPED';checked:number;pending:number;review:number;stopped:number;canSubmit:boolean;canCancel:boolean;canExport:boolean;
  items:{companyId:string;companyName:string;operationId:string|null;state:string;observedAt:string|null;reviewCaseId:string|null;pendingAttempt:boolean|null;issueCount:number|null}[]};
export type BillingBatchList={items:BillingBatchView[];nextCursor:string|null};
export type BillingBatchExport={csv:string;sha256:string;rowCount:number;exportedAt:string;fileName:string};
export type BillingOperatorCompanyDetail = BillingOperatorCompany & { usage: BillingReceiptUsage;
  issues: BillingOperatorIssue[]; financial: { invoices: BillingInvoiceItem[]; nextCursor: string | null } | null };
export type BillingTimelineEntry = { reference: string; kind: string; type: string; state: string; recordedAt: string; occurredAt: string | null;
  updatedAt: string | null; observedAt: string | null; origin: string | null; amountSatang: number | null; href: string | null };
export type BillingHistoryExport = {fileName:string;csv:string;rowCount:number;exportedAt:string;nextCursor:string|null;financialIncluded:boolean;auditIncluded:boolean;sha256:string};
export type BillingTimeline = { canExport?:boolean; items: BillingTimelineEntry[]; nextCursor: string | null; auditIncluded: boolean; financialIncluded: boolean };
export type BillingRepairPreview = { type: 'RECONCILE' | 'IMPORT_INVOICE' | 'RETRY_APPLY' | 'RETRY_NOTIFICATION' | 'RECONCILE_NOTIFICATION'; companyId: string; expectedVersion: number; reason: string; referenceId?:string; invoiceSourceHash?:string;findingSourceHash?:string };
export type BillingApplyInvoiceView = { id:string;companyId:string;mode:BillingMode;version:number;accountVersion:number;applyState:string;errorCode:string|null;paymentVerified:boolean;
  periodStart:string;periodEnd:string;appliedAt:string|null;observedAt:string|null;sourceHash:string;canRetry:boolean };
export type BillingInvoiceFindingReview = BillingInvoiceFinding & {accountVersion:number;sourceHash:string;canImport:boolean};
export type BillingRepairOperation = BillingOperationView & { sourceVersion: number; previewHash: string;
  findingImpact?: {scanId:string;findingId:string;beforeState:string;invoiceCreatedAt:string};
  invoiceImpact?: { id:string;beforeState:string;periodStart:string;periodEnd:string };
  eventImpact?: { eventType: string; beforeState: string; attempts: number };
  deliveryImpact?:{channel:string;recipientUserId:string|null;recipientName?:string|null;beforeState:string;afterState:'QUEUED'|'OBSERVED';attemptCount:number;retryUntil:string|null;possibleDuplicate?:boolean};
  allowedActions: ('submit' | 'retry' | 'cancel')[]; observed: { pendingAttemptId: string | null; issueCount: number; deliveryId?:string; deliveryState?:string; eventState?: string;invoiceId?:string;invoiceApplyState?:string } | null };
export type BillingProviderEventView = { id: string; mode: BillingMode; eventType: string; state: string; attempts: number;
  receivedAt: string; processedAt: string | null; retryAt: string; leaseUntil: string | null; errorCode: string | null;
  sourceHash: string; canRetry: boolean; issueId: string | null };
/** `recipientUserId` is null for mail addressed to the company's document recipient (R-A7), not to a user. */
export type BillingDeliveryView = { id:string;companyId:string;mode:BillingMode;channel:'WEB'|'LINE'|'EMAIL';invoiceId:string;recipientUserId:string|null;
  companyName?:string;recipientName?:string|null;invoiceNumber?:string|null;
  state:string;attemptCount:number;updatedAt:string;nextAttemptAt:string|null;acceptedAt:string|null;confirmedAt:string|null;
  errorCode:string|null;recoveryBlockedReason:string|null;accountVersion:number;retryOperationId:string|null;canRetry:boolean;canReconcile:boolean;possibleDuplicate:boolean;
  mailHistory?:Array<{id:string;generation:number;state:string;acceptedAt:string|null;deliveredAt:string|null;errorCode:string|null;possibleDuplicate:boolean}> };

export type BillingSalesCompany = { id: string; name: string; status: string };
export type BillingConfiguration = { version: number; mode: BillingMode | 'DISABLED'; policy: BillingPolicy;
  policyRevisionId: string | null; gates: Record<BillingAction, boolean>; capabilities: string[]; reauthenticatedUntil: string | null; salesCompanies?: BillingSalesCompany[] };
export type BillingConfigurationInput = { type: 'PUBLISH_POLICY' | 'SET_ACTION_GATE'; expectedVersion: number;
  policy: BillingPolicy; gates: Record<BillingAction, boolean>; reason: string; draftId?:string;draftVersion?:number; effectiveAt?:string|null };
export type BillingConfigurationDraftInput = Omit<BillingConfigurationInput,'draftVersion'>;
export type BillingConfigurationImpact = { subscriptions: number; inFlightAttempts: number; unusedQuotes: number; pendingPlanChanges: number; collectionCommands: number;
  sourceHash?: string;
  refundLimit?: {before:number|null;after:number|null};
  supportSla?: {before:NonNullable<BillingPolicy['supportSlaMinutes']>|null;after:NonNullable<BillingPolicy['supportSlaMinutes']>|null};
  salesCohort?: { before: string[] | null; after: string[] | null; companies: BillingSalesCompany[] };
  prices: { offerKey: BillingOfferKey; beforeTotalSatang: number; afterTotalSatang: number; beforeReceiptAllowance?:number; afterReceiptAllowance?:number;
    beforeBranchLimit?:number;afterBranchLimit?:number;beforeEmployeeLimit?:number;afterEmployeeLimit?:number }[] };
export const BILLING_CONFIGURATION_IMPACT_KINDS = ['SUBSCRIPTION', 'ATTEMPT', 'QUOTE', 'PLAN_CHANGE', 'COLLECTION'] as const;
export type BillingConfigurationImpactKind = typeof BILLING_CONFIGURATION_IMPACT_KINDS[number];
export type BillingConfigurationImpactItem = { reference: string; kind: BillingConfigurationImpactKind; recordId: string; companyId: string;
  state: string; boundary: string | null; nextChargeAt: string | null };
export type BillingConfigurationImpactPage = { kind: BillingConfigurationImpactKind; items: (BillingConfigurationImpactItem & { companyName: string })[];
  sourceHash: string; matchesPreview: boolean; nextCursor: string | null; observedAt: string };
export type BillingConfigurationOperation = BillingOperationView & { sourceVersion: number; previewHash: string;
  proposed: { policy: BillingPolicy; gates: Record<BillingAction, boolean>; effectiveAt?:string|null }; impact: BillingConfigurationImpact|null;canEditDraft?:boolean;sourceDraftVersion?:number; salesCompanies?: BillingSalesCompany[];
  scheduledFor?:string|null; scheduleDue?:boolean;
  allowedActions: ('submit' | 'approve' | 'cancel' | 'apply')[]; activeRevisionId: string | null };


export type BillingOperatorScopeView = { id: string; companyId: string; companyName: string; userId: string; userName: string;
  mode: BillingMode; version: number; state: 'ACTIVE' | 'EXPIRED' | 'REVOKED'; expiresAt: string | null };
export type BillingScopeDirectory = { items: { id: string; name: string }[]; nextCursor: string | null };
export type BillingScopeChange = { approvalMode?: BillingApprovalMode | null; id: string; type: 'GRANT_SCOPE' | 'REVOKE_SCOPE'; state: BillingOperationState; version: number;
  previewHash: string; mode: BillingMode; companyId: string; companyName: string; userId: string; userName: string; capabilities: string[];
  current: BillingOperatorScopeView | null; expiresAt: string; scopeExpiresAt: string | null; reason: string; observedAt: string | null;
  allowedActions: ('submit' | 'approve' | 'cancel')[] };

/** `AI_OCR_BUDGET_REACHED` is the SPLIT-only case (spec §11.4/R-10): the company's total AI credit is
 *  not gone, but the share allocated to reading documents is. Under SHARED it can never appear.
 *
 *  `AI_CREDIT_HOLDS_PENDING` is additive (credit-wording spec §5.3): AI jobs are running or their
 *  provider outcome is still unknown, so credit is held and the usable balance can be lower than the
 *  numbers this console shows. Words only — like every member here, it carries no money. It is
 *  orthogonal to the three above and may appear with any of them, under SHARED and SPLIT alike. */
export type BillingReceiptReadWarning = 'OCR_DISABLED'|'OCR_LIMIT_REACHED'|'AI_BUDGET_REACHED'|'AI_OCR_BUDGET_REACHED'|'AI_CREDIT_HOLDS_PENDING';
export type BillingReceiptAdjustmentInput = {type:'GRANT_RECEIPTS'|'REVOKE_RECEIPTS';units?:number;expiresAt?:string;grantId?:string;sourceHash:string;reason:string};
export type BillingAdminReceiptGrant = {id:string;units:number;used:number;remaining:number;expiresAt:string;revokedAt:string|null;active:boolean};
export type BillingReceiptAdjustmentOperation = BillingOperationView & {companyName:string;previewHash:string;units:number;grantExpiresAt:string;
  beforeRemaining:number|null;observedRemaining:number|null;requesterName:string|null;approverName:string|null;
  grant:BillingAdminReceiptGrant|null;readWarnings:BillingReceiptReadWarning[];allowedActions:('submit'|'approve'|'cancel')[]};
export type BillingReceiptAdjustments = {companyId:string;companyName:string;sourceHash:string;paidThrough:string|null;maxGrantExpiresAt:string|null;
  monthlyAllowance?: BillingReceiptUsage['monthlyAllowance'];
  remaining:number|null;canCreate:boolean;blockedReason:string|null;readWarnings:BillingReceiptReadWarning[];items:BillingReceiptAdjustmentOperation[];nextCursor:string|null};

/** `aiOcrBudgetReached` is additive and SPLIT-only (spec §11.4): the total money shown below is not
 *  gone, but the share allocated to reading documents is — so "เครดิต AI … ใช้แล้ว …" alone would
 *  read as though the remainder were available for receipts. Absent under SHARED, as it is today.
 *
 *  `aiReservedSatang`/`aiUnresolvedHolds` are additive too (credit-wording spec §5.3) and present
 *  only when non-zero, so a company with no hold keeps today's panel byte for byte. This surface
 *  already shows AI money to a System Admin; no owner-facing view reads this type. */
export type BillingPlanAdjustmentUnchanged = {remainingReceipts:number;termEndsAt:string;nextChargeAt:string|null;ocrEnabled:boolean;ocrMonthlyLimit:number|null;aiBudgetSatang:number;aiUsedSatang:number;aiOcrBudgetReached?:boolean;aiReservedSatang?:number;aiUnresolvedHolds?:number};
export type BillingPlanAdjustmentInput = {type:'GRANT_OVERRIDE'|'REVOKE_OVERRIDE'|'GRANT_FREE_DAYS'|'CHANGE_COLLECTION';collectionAction?:'PAUSE'|'RESUME';resumesAt?:string;days?:number;tierKey?:PaidTier;
  branchLimit?:number;employeeLimit?:number;expiresAt?:string;overrideId?:string;sourceHash:string;reason:string};
export type BillingPlanAdjustmentOperation = BillingOperationView & {companyName:string;previewHash:string;before:CompanyPlanCapacity;after:CompanyPlanCapacity;
  collectionChange?:{action:'PAUSE'|'RESUME';before:BillingCollectionPause|null;after:BillingCollectionPause|null;openInvoices:number;draftInvoices:number;outstandingSatang:number;paidThrough:string|null;graceEndsAt:string|null;cancelAtPeriodEnd:boolean};
  dayExtension?:{days:number;before:string;after:string;nextChargeBefore:string|null;nextChargeAfter:string|null};
  overrideExpiresAt:string|null;activeBranches:number;activeMembers:number;requesterName:string|null;approverName:string|null;
  current:CompanyPlanCapacity|null;unchanged:BillingPlanAdjustmentUnchanged|null;allowedActions:('submit'|'approve'|'cancel')[]};
export type BillingPlanAdjustments = {companyId:string;companyName:string;sourceHash:string;baseline:CompanyPlanCapacity|null;current:CompanyPlanCapacity|null;
  activeBranches:number;activeMembers:number;maxExpiresAt:string|null;canCreate:boolean;blockedReason:string|null;canManageCollection?:boolean;collectionPause?:BillingCollectionPause|null;
  unchanged:BillingPlanAdjustmentUnchanged|null;items:BillingPlanAdjustmentOperation[];nextCursor:string|null};

export type BillingEmailRecipientOperation = { id: string; state: string; version: number; previewHash: string; expiresAt: string;
  previousEmail: string | null; newEmail: string; canSubmit: boolean; canCancel: boolean; source?: BillingRecipientSource };
/** `email` is the Stripe Customer's; `stored` is the column this system owns (they differ only after a Dashboard edit). */
export type BillingEmailRecipient = { email: string | null; hasCustomer: boolean; busy?: boolean; operation: BillingEmailRecipientOperation | null;
  stored?: BillingRecipientInfo };

/** Purchase without setup (spec §18.2 R-A4/R-A8). `ACCOUNT_EMAIL` also marks recipients that predate the column. */
export type BillingRecipientSource = 'ACCOUNT_EMAIL' | 'CUSTOMER_OTP' | 'STRIPE_CHECKOUT' | 'ADMIN';
export type BillingRecipientInfo = { email: string | null; source: BillingRecipientSource | null; bouncedAt: string | null;
  /** A Stripe Customer exists and no purchase or recipient change is in flight (R-A8: opens once the payment applied). */
  canChange: boolean };
/** No `serverNow`: count down from `retryAt` minus the device clock. */
export type BillingRecipientOtpChallenge = { challengeId: string; email: string; expiresAt: string; retryAt: string;
  attemptsRemaining: number; deliveryStatus: string; delivered: boolean };
export type BillingRecipientOtpProof = { recipientProofId: string; email: string; expiresAt: string };
/** `receiptUpdated` false = Stripe did not resend the receipt because its email did not change. */
export type BillingDocumentResendResult = { invoiceSent: boolean; receiptUpdated: boolean; recipientEmail: string; remainingToday: number };

/** PR E admin tools (spec §18.2 R-E1/R-E2/R-E4). An admin recipient change is the same `UPDATE_BILLING_EMAIL`
 *  operation the customer OTP flow uses (`source: 'ADMIN'`), reviewed like a refund and reusing its
 *  `billing.recipient.changed` notification mechanism — see billing-email-recipient.ts. */
export type BillingRecipientAdminReview = { companyId: string; companyName: string; invoiceId: string; invoiceNumber: string | null; mode: BillingMode;
  currentEmail: string | null; currentSource: BillingRecipientSource | null; bouncedAt: string | null; canChange: boolean; blockedReason: string | null;
  sourceHash: string; observedAt: string };
export type BillingRecipientAdminInput = { newEmail: string; reason: string; sourceHash: string; supportRequestId?: string };
export type BillingRecipientAdminOperation = BillingOperationView & { type: 'UPDATE_BILLING_EMAIL'; sourceVersion: number; previewHash: string;
  companyName: string; invoiceNumber: string | null; previousEmail: string | null; newEmail: string; supportRequestId: string | null;
  allowedActions: ('submit' | 'approve' | 'cancel' | 'run')[]; dispatchedAt: string | null; reviewCaseId: string | null; notifiedAt: string | null };
/** Admin document resend needs an internal reason; the result shape is `BillingDocumentResendResult` above. */
export type BillingDocumentAdminResendInput = { reason: string };
export type BillingReferenceLookup = { kind: 'INVOICE' | 'ATTEMPT' | 'OPERATION' | 'ISSUE'; id: string; companyId: string; companyName: string; href: string };
