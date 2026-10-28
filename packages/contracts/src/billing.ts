import { PLAN_TIER_PRESETS, shopPlanTierLabel, type PlanTierKey, type CompanyPlanCapacity, type PlanTermLockReason, type PlanTermState } from './plan-term.js';
import { TIER_FEATURE_PRESETS } from './menu-entitlements.js';
import type { SalesDealBaseTier, SalesDealCadence, SalesEventTicketDisplayState } from './sales.js';
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

/**
 * Add-on foundation (chat credit and receipt image spec §4, §8.1–§8.2; plan PR A): what a quote,
 * attempt or invoice sells. Every row and snapshot written before add-ons is a PACKAGE.
 * Owner 2026-09-29 ("no switches"): add-ons have no billing gate — an offer can be sold only once
 * its Stripe Price is bound in the ACTIVE policy's `addOnPriceIds` and its product is ready.
 */
export const BILLING_PRODUCT_KINDS = ['PACKAGE', 'CHAT_CREDIT', 'RECEIPT_IMAGE'] as const;
export type BillingProductKind = typeof BILLING_PRODUCT_KINDS[number];
export type BillingAddOnProductKind = Exclude<BillingProductKind, 'PACKAGE'>;
/** Absent = PACKAGE. Any other unknown value is null, so a reader fails closed instead of guessing. */
export function billingProductKind(value: unknown): BillingProductKind | null {
  if (value === undefined) return 'PACKAGE';
  return (BILLING_PRODUCT_KINDS as readonly unknown[]).includes(value) ? value as BillingProductKind : null;
}
export const BILLING_ADDON_OFFER_KEYS = ['CHAT_50', 'CHAT_100', 'CHAT_300', 'RECEIPT_IMAGE_20', 'RECEIPT_IMAGE_50', 'RECEIPT_IMAGE_100'] as const;
export type BillingAddOnOfferKey = typeof BILLING_ADDON_OFFER_KEYS[number];
/** Catalog row (spec §8.1); a company's availability comes from its status. One Stripe line item, quantity 1. */
export type BillingAddOnOffer = { offerKey: BillingAddOnOfferKey; productKind: BillingAddOnProductKind;
  /** Integer units: CHAT_CREDIT counts 0.01 credit (unitScale 100), RECEIPT_IMAGE counts whole images (unitScale 1). */
  quantityUnits: number; unitScale: 100 | 1; priceSatang: number; currency: 'THB'; validityMonths: 12;
  availability: 'AVAILABLE' | 'UNAVAILABLE'; reason: string | null };
/** Owner-confirmed prices and quantities (spec §4). Changing one is a new Owner decision, not a policy edit. */
export const BILLING_ADDON_OFFERS: Record<BillingAddOnOfferKey, Pick<BillingAddOnOffer, 'productKind' | 'quantityUnits' | 'unitScale' | 'priceSatang'>> = {
  CHAT_50: { productKind: 'CHAT_CREDIT', quantityUnits: 5000, unitScale: 100, priceSatang: 29900 },
  CHAT_100: { productKind: 'CHAT_CREDIT', quantityUnits: 10000, unitScale: 100, priceSatang: 54900 },
  CHAT_300: { productKind: 'CHAT_CREDIT', quantityUnits: 30000, unitScale: 100, priceSatang: 149900 },
  RECEIPT_IMAGE_20: { productKind: 'RECEIPT_IMAGE', quantityUnits: 20, unitScale: 1, priceSatang: 34900 },
  RECEIPT_IMAGE_50: { productKind: 'RECEIPT_IMAGE', quantityUnits: 50, unitScale: 1, priceSatang: 79900 },
  RECEIPT_IMAGE_100: { productKind: 'RECEIPT_IMAGE', quantityUnits: 100, unitScale: 1, priceSatang: 149900 },
};

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
  /** One-time add-on Prices (spec §8.4). Binding one is what makes that offer sellable (no gate, Owner
   *  2026-09-29); publish only after every running binary parses this key (runbook: minimum binary per policy schema). */
  addOnPriceIds?: Partial<Record<BillingAddOnOfferKey, string>>;
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
  cadence: 'LEGACY_MONTH' | 'PAID_GRANTS' | 'FREE_MONTHLY_3'; resetsAt: string | null; expiresAt: string | null;
  /** Monthly base and fixed Admin gifts have separate clocks; absent for purchased allowances. */
  monthlyAllowance?: { limit: number | null; used: number; additionalRemaining: number; additionalExpiresAt: string | null };
};
export type BillingFeatureImpact = { removed: { featureKey:string; labelTh:string }[];
  added: { featureKey:string; labelTh:string }[]; preservedAdmin:number };
export type BillingQuote = {
  /** Add-on foundation: absent = PACKAGE; an add-on quote is a `BillingAddOnQuote`. */
  productKind?: 'PACKAGE';
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
  /** Sales-event discount (sales-event spec §7.2, SD-O12), present only when the buyer's LINE identity holds a
   *  ticket this purchase can use. `totalSatang` above stays the undiscounted charge; "ชำระวันนี้" is `applied.totalSatang`
   *  when the buyer chose USE. DECLINE keeps the offer so the confirm step can switch back. */
  eventDiscount?: BillingQuoteEventDiscount;
  /** Promotion spec Q4: the one benefit this purchase takes. Absent = a quote from before promotions (NORMAL, or
   *  EVENT_DISCOUNT when `eventDiscount.choice` is USE). */
  benefitChoice?: BillingBenefitChoice;
  /** Present only when `benefitChoice` is PROMOTION. `totalSatang` and `purchase.projectedPaidThrough` stay the paid period's. */
  promotion?: BillingQuotePromotion;
};
export type BillingEventDiscountChoice = 'USE' | 'DECLINE';
export type BillingQuoteEventDiscount = {
  choice: BillingEventDiscountChoice; ticketSerial: string; eventName: string; expiresAt: string;
  /** The ticket's own whole-baht discount (D). */
  discountSatang: number;
  /** Full price − discounted unit price: the "−{จำนวน}" line on the card and the confirm step. */
  shownDiscountSatang: number;
  applied?: { unitAmountSatang: number; subtotalSatang: number; taxSatang: number; totalSatang: number };
};
/** Spec §8.1: `productKind` tells it apart from `BillingQuote`; it carries `addOn` instead of `offer`. One-time only. */
export type BillingAddOnQuote = {
  productKind: BillingAddOnProductKind;
  quoteId: string; companyId: string; companyName: string; policyRevision: string; expiresAt: string;
  purchaseMode: 'CARD_ONCE' | 'PROMPTPAY_ONCE';
  addOn: BillingAddOnOffer; subtotalSatang: number; taxSatang: number; totalSatang: number;
  taxTreatment: BillingTaxTreatment; consentRevision: string; billingEmail: string | null;
  billingProfile?: BillingCompanyProfile;
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
  /** A known local purchase blocker, using the same stable codes as quote/Checkout. Provider checks still run there. */
  purchaseBlockCode?: string | null;
  /** The plan-change gate also applies to active one-time upgrades/cadence changes; repeating the same package remains separate. */
  packageChangesEnabled?: boolean;
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
  /** Add-on balances and the add-on Checkout in flight (spec §8.1, §17.3). Declared by the foundation;
   *  no server fills it yet. Plan managers only. */
  addOns?: BillingAddOnSummary;
  /** Sales-event discount this plan manager holds for this shop (sales-event spec §3.4 ก, §8, SD-O12), computed
   *  with the same helper as the quote. Absent = no ticket, or this shop cannot pay for a package in one go now.
   *  `offers` lists the package cards it lowers; empty when `reason` says why this shop cannot use it
   *  (EVENT_ALREADY_USED: every ticket held is from an event this shop already used — one per event per shop,
   *  `eventName` names it). Any mode of a first purchase or restart (a renewing mode takes it on its first bill
   *  only, SD-O13); a one-time payment of any kind. The top-level ticket and `offers` are the default: the best
   *  ticket for each card. `tickets` lists every discount this shop can use now, best first, each with the cards it
   *  lowers, so the buyer picks which one this payment uses (Owner 2026-09-29); empty when `reason` is set. */
  eventDiscount?: { ticketSerial: string; eventName: string; discountSatang: number; expiresAt: string;
    reason: null | 'DEAL_ACTIVE' | 'EVENT_ALREADY_USED';
    offers: { offerKey: string; interval: BillingInterval; eventName: string; shownDiscountSatang: number }[];
    tickets?: { ticketSerial: string; eventName: string; discountSatang: number; expiresAt: string;
      offers: { offerKey: string; interval: BillingInterval; shownDiscountSatang: number }[] }[] };
  /** Promotion campaigns this shop sees on the package page now, one row per campaign rule, each with whether it can
   *  take it and why not. Absent or empty = nothing to advertise. NORMAL stays purchasable whatever `reason` says. */
  promotions?: BillingPromotionOfferView[];
  /** The newest promotion right this shop reserved or used. Absent = none. */
  promotion?: BillingPromotionUse;
  /** Promotion spec Q5: an immediate upgrade is refused (`PROMOTION_UPGRADE_DEFERRED`) until this instant. */
  upgradeDeferredUntil?: string;
};
/** Spec §17.3: one server snapshot for both products; the client never adds numbers itself. Integer units per `unitScale`. */
export type BillingAddOnBalance = { productKind: BillingAddOnProductKind; unitScale: 100 | 1;
  /** UNLIMITED only for a provable legacy right, never inferred from null. */
  packageLimitKind: 'FINITE' | 'UNLIMITED';
  packageRemainingUnits: number | null; additionalRemainingUnits: number; totalRemainingUnits: number | null;
  packageResetsAt: string | null; packageExpiresAt: string | null; renewalPaymentDueAt: string | null;
  nextAdditionalExpiry: { expiresAt: string; remainingUnits: number } | null;
  useState: 'AVAILABLE' | 'PROCESSING' | 'EXHAUSTED' | 'PACKAGE_REQUIRED' | 'ADMIN_HOLD' | 'COMPANY_LIMIT' | 'FEATURE_UNAVAILABLE' | 'REVIEW_REQUIRED' | 'TEMPORARILY_UNAVAILABLE';
  purchaseState: 'AVAILABLE' | 'PACKAGE_REQUIRED' | 'NOT_ELIGIBLE' | 'RENEWAL_PAYMENT_PENDING' | 'ADMIN_HOLD' | 'SALES_UNAVAILABLE' | 'PAYMENT_PENDING' | 'TEMPORARILY_UNAVAILABLE' };
export type BillingAddOnQuotaSummary = { schemaVersion: 1; companyId: string; snapshotId: string; asOf: string; balances: BillingAddOnBalance[] };
export type BillingAddOnSummary = { quotaSummary: BillingAddOnQuotaSummary; pendingAttempt: { attemptId: string; offerKey: BillingAddOnOfferKey } | null };
export type BillingCollectionAction = 'CANCEL_RENEWAL' | 'RESUME_RENEWAL' | 'SCHEDULE_DOWNGRADE' | 'CANCEL_DOWNGRADE' | 'PREPAID_PLAN_CHANGE' | 'EXTEND_TERM' | 'ADMIN_PAUSE_COLLECTION' | 'ADMIN_RESUME_COLLECTION';
export type BillingCollectionOperation = { id: string; companyId: string; action: BillingCollectionAction; state: string; version: number;
  previewHash: string; effectiveAt: string; nextRenewalTotalSatang: number; expiresAt: string; observedAt: string | null;
  errorCode: string | null; allowedActions: ('submit' | 'withdraw')[];
  targetOffer?: BillingOffer; currentOffer?: BillingOffer; capacity?: BillingCapacityImpact;
  /** Phase 7: the menus the target package opens and closes, shown before the customer confirms. */
  featureImpact?: BillingFeatureImpact };
export type BillingCheckoutBody = { quoteId: string; consentRevision: string; accepted: true; channel: 'web' | 'line' };
export type BillingCheckoutResult = { attemptId: string; state: string; checkoutUrl: string | null; /** Stripe session expiry, when supplied by the provider. */ expiresAt?: string };
export type BillingAttemptView = {
  attemptId: string; state: string; errorCode: string | null; observedAt: string;
  paymentState: 'PENDING' | 'PAID' | 'FAILED'; applyState: BillingStatus['applyState']; invoiceReference: string | null;
  /** Present when this Checkout paid a sales deal, so the return page can name what was bought. */
  deal?: { dealId: string; baseLabel: string; months: number };
  advanceDeal?: { startsAt: string; firstCycleEndsAt: string; nextChargeAt: string };
  /** Sales-event discount on this Checkout: used once the payment is confirmed (sales-event spec §3.6). */
  eventDiscount?: { shownDiscountSatang: number; state: 'IN_PAYMENT' | 'USED' };
  /** The promotion right this Checkout reserved (RESERVED) or used once paid (CONSUMED); dates are null until applied. */
  promotion?: BillingPromotionUse;
};
export type BillingInvoiceItem = {
  offer: { key: string; label: string; interval: 'month' | 'year' } | null;
  method: 'CARD' | 'PROMPTPAY' | null;
  /** Verified provider payment time when supplied by the document read; never the local row creation time. */
  paidAt?: string | null;
  id: string; number: string | null; currency: 'THB'; amountSatang: number;
  refundedSatang: number; disputed: boolean; financialObservedAt: string | null;
  paymentState: string; applyState: string; periodStart: string; periodEnd: string; createdAt: string; hasDocuments: boolean;
  documentActions?: { canResend: boolean };
  /** A promotion purchase: `periodEnd` above is the paid period's end (= `paidEnd`); the free time runs to `benefitEnd`. */
  promotion?: { displayName: string; paidEnd: string; benefitEnd: string; bonusReceiptUnits: number } };
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
  documentActions?: { canResend: boolean }; recipientEmail?: string | null; invoice?: BillingInvoiceItem };
export type BillingCatalog = { schemaVersion: 1; mode: BillingMode | 'DISABLED'; policyRevision: string | null;
  catalogRevision: string; generatedAt: string; validUntil: string; taxTreatment: BillingTaxTreatment | null; offers: BillingOffer[];
  /**
   * Legacy TOTAL safety budget, not the 80-credit CHAT allowance.
   */
  aiMonthlyBudgetSatang: number;
  /** R1: no longer emitted — new signups get no trial (Owner 2026-09-20). Optional rather than
   *  removed so an older client that still reads it keeps compiling against this contract. */
  trial?: { tierKey: 'FREE_TRIAL_15'; days: 30; monthlySlipLimit: 15; branchLimit: 1; employeeLimit: 2; menus: 7 };
  /** Campaigns open for reservation at `generatedAt`, announceable fields only — no company, usage or cap data.
   *  Whether a given shop may take one comes from its `BillingStatus.promotions`. */
  promotions?: BillingCatalogPromotion[] };

export type BillingOperationType = 'CHECK_PROVIDER_CONFIGURATION' | 'RECONCILE' | 'IMPORT_INVOICE' | 'RETRY_APPLY' | 'RETRY_NOTIFICATION' | 'RECONCILE_NOTIFICATION' | 'RETRY_PROVIDER_EVENT' | 'SET_ACTION_GATE' | 'PUBLISH_POLICY' | 'EXPIRE_CHECKOUT' | 'CHANGE_COLLECTION' | 'REFUND' | 'GRANT_FREE_DAYS' | 'GRANT_OVERRIDE' | 'REVOKE_OVERRIDE' | 'GRANT_RECEIPTS' | 'REVOKE_RECEIPTS' | 'SCHEDULE_PRICE_RETURN' | 'APPLY_PLAN_MENUS' | 'UPDATE_BILLING_EMAIL' | 'CUSTOMER_PROFILE_SYNC' | 'ADDON_ADMIN_GRANT' | 'ADDON_ADMIN_REVOKE';
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
/** The promotion the refunded invoice was bought with (spec Q6). `benefitEnd` is null while its free time was never applied. */
export type BillingRefundPromotion = { displayName:string; bonusMonths:number; bonusReceiptUnits:number; benefitEnd:string|null };
export type BillingRefundReview = { companyId:string; companyName:string; invoiceId:string; invoiceNumber:string|null; mode:BillingMode;
  paidSatang:number; refundedSatang:number; disputed:boolean; refundLimitSatang:number|null; canCreate:boolean; blockedReason:string|null;
  sourceHash:string; observedAt:string; usage:BillingStatus['usage']; adjustments:BillingAdjustmentItem[]; promotion?:BillingRefundPromotion;
  /** How the invoice was paid: the provider refunds a PromptPay payment only after the customer answers its e-mail. */
  paymentMethod?:'card'|'promptpay';
  /** This purchase still holds the shop and the system cannot set up its next round: the refund is the way out. RENEWAL (QR bills, prepaid card): only a full refund releases the shop. */
  unrepairedBinding?:'RENEWAL'|'ADVANCE_DEAL' };
export type BillingRefundOperation = BillingOperationView & { type:'REFUND'; sourceVersion:number; previewHash:string;
  companyName:string; invoiceNumber:string|null; amountSatang:number; taxSatang:number; memo:string; notifyCustomer:boolean;
  paidSatang:number; previousRefundedSatang:number; usage:BillingStatus['usage'];
  allowedActions:('submit'|'approve'|'cancel'|'run')[]; dispatchedAt:string|null; creditNoteId:string|null; creditNoteNumber:string|null;
  refundId:string|null; refundState:BillingAdjustmentItem['status']|null; reviewCaseId:string|null; bankReceiptConfirmed:false;
  endPackage:boolean; packageEnded:boolean|null; promotion?:BillingRefundPromotion; paymentMethod?:BillingRefundReview['paymentMethod'];
  /** The provider's own error code and type of its last rejection while this request still has an error (safe tokens only, never its message), for staff to read. */
  providerErrorCode?:string|null; providerErrorType?:string|null };

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
/** Sales-event discounts §6.3: the reconciler raised it because a bill was paid at the discounted amount
 *  but no ticket was RESERVED for that attempt. Apply is not blocked; an operator checks and closes it. */
export const BILLING_EVENT_DISCOUNT_REVIEW_ISSUE = 'EVENT_DISCOUNT_REVIEW';
/** Promotion spec §6: a paid bill whose snapshot holds a promotion but whose right could not be used for it (given back, or
 *  used by another bill), or a fully refunded promotion purchase whose entitlement could not be ended. An operator reviews it. */
export const BILLING_PROMOTION_REVIEW_ISSUE = 'PROMOTION_REVIEW';
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
  issues: BillingOperatorIssue[]; financial: { invoices: BillingInvoiceItem[]; nextCursor: string | null } | null;
  /** Sales-event discounts this shop reserved or used (spec SD-E20), newest first, at most 25. Optional
   *  only so a contracts-first merge keeps older API builds compiling; the API always sends it. */
  eventDiscounts?: BillingCompanyEventDiscount[] };
/** `appliedDiscountSatang` and `invoiceId` are null without `system.billing.financial.read`. The lot of a
 *  credit use arrives with SD-F. The serial is shown: it is the number the shop and the เซลล์ quote. */
export type BillingCompanyEventDiscount = { serial: string; eventName: string; batchName: string;
  redeemedAs: 'DISCOUNT' | 'CREDIT' | null; state: 'ISSUED' | 'RESERVED' | 'USED' | 'REVOKED';
  appliedDiscountSatang: number | null; invoiceId: string | null; usedAt: string | null; reservedAt: string | null };
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
  proposed: { policy: BillingPolicy; gates: Record<BillingAction, boolean>; effectiveAt?:string|null;
    /** A campaign publication: the whole campaign map this publication would store, and the one campaign it changes. */
    promotions?: Record<string, BillingPromotionCampaign>; campaignId?: string }; impact: BillingConfigurationImpact|null;canEditDraft?:boolean;sourceDraftVersion?:number; salesCompanies?: BillingSalesCompany[];
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

/**
 * Add-on plan PR B (spec §8.1, §16): the operator's add-on balance and the reviewed team grant/revoke,
 * both products through one seam (receipt images now, AI credit in PR C). A grant has no expiry field:
 * it is 12 months from the committed approval (D8, C03). Revoke takes a team lot's unused units, never a
 * paid one (that leaves by refund) and never money.
 */
export type BillingAddOnGrantInput = { type: 'ADDON_ADMIN_GRANT' | 'ADDON_ADMIN_REVOKE'; productKind: BillingAddOnProductKind;
  /** Grant only: integer units of the product — whole images for RECEIPT_IMAGE. */
  units?: number;
  /** Revoke only: the team lot. */
  grantId?: string; sourceHash: string; reason: string };
/** Operator view only (spec §17.1): the customer never sees a lot, a hold or a source. */
export type BillingAddOnAdminLot = { id: string; productKind: BillingAddOnProductKind; source: 'ADD_ON_PAID' | 'ADD_ON_ADMIN' | 'SALES_EVENT';
  units: number; reserved: number; consumed: number; revoked: number; remaining: number; availableAt: string; expiresAt: string;
  revokedAt: string | null; state: 'ACTIVE' | 'PENDING' | 'EXPIRED' | 'REVOKED'; canRevoke: boolean };
export type BillingAddOnGrantOperation = BillingOperationView & { type: 'ADDON_ADMIN_GRANT' | 'ADDON_ADMIN_REVOKE'; companyName: string;
  previewHash: string; productKind: BillingAddOnProductKind; units: number;
  /** Before approval: what 12 months from now would be. After: the lot's real expiry. */
  grantExpiresAt: string; lot: BillingAddOnAdminLot | null; requesterName: string | null; approverName: string | null;
  allowedActions: ('submit' | 'approve' | 'cancel')[] };
export type BillingAddOnCredits = { companyId: string; companyName: string; sourceHash: string; canCreate: boolean; blockedReason: string | null;
  /** `packageRemaining` is null for a shop whose receipts are not lots yet (it cannot hold add-on units). */
  images: { packageRemaining: number | null; additionalRemaining: number; lots: BillingAddOnAdminLot[] };
  items: BillingAddOnGrantOperation[]; nextCursor: string | null };

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
  previousEmail: string | null; newEmail: string; canSubmit: boolean; canCancel: boolean; source?: BillingRecipientSource; errorCode?: string | null };
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

/** `GET /v1/companies/:companyId/billing/event-discount` (sales-event spec §7.1). The caller's own
 *  ส่วนลดจากงาน — the tickets held by the LINE account linked to their login — and which way this
 *  shop could use one (`path`, spec §4.1). SD-C adds the per-card `discount` offers and SD-F the
 *  `credit` block; both are additive. A plan manager never sees another person's tickets. */
export type BillingEventDiscountTicket = {
  serial: string; eventName: string; discountSatang: number; chatCreditUnits: number; receiptImageUnits: number;
  expiresAt: string; state: SalesEventTicketDisplayState;
  /** The batch was suspended by the sales team: an unused ticket cannot be used until it is lifted. */
  batchSuspended: boolean;
};
export type BillingEventDiscountView = {
  path: 'DISCOUNT' | 'CREDIT' | null;
  /** How this shop renews, read as `BillingStatus.renewalMode` reads it (LINE words why a running renewal cannot use a discount per mode). Absent = no billing account. */
  renewalMode?: BillingPurchaseMode | 'NONE';
  /** Whether that renewal is running, read from the same account columns as `BillingStatus` (cancelAtPeriodEnd, subscriptionState, graceEndsAt, collectionPause):
   *  RUNNING = bound and will charge or bill at the next period; STOPPED = switched off or cancelled while the package still runs; UNPAID = its charge failed or its bill is overdue, so the package page opens no purchase (on any `path`).
   *  Absent = nothing settled to say (no subscription bound yet, collection paused, no account) or an older API: both surfaces then say only the general sentence. */
  renewalState?: 'RUNNING' | 'STOPPED' | 'UNPAID';
  tickets: BillingEventDiscountTicket[];
};

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
/** `EVENT_TICKET`: the 8-character serial of a sales-event discount the shop used (sales-event spec §7.1). */
export type BillingReferenceLookup = { kind: 'INVOICE' | 'ATTEMPT' | 'OPERATION' | 'ISSUE' | 'EVENT_TICKET'; id: string; companyId: string; companyName: string; href: string };

/**
 * Promotion campaigns (docs/specs/starter-249-bonus-month-promotion-spec-th.md; plan
 * docs/plans/starter-249-bonus-month-promotion-plan.md §4). Release 1 knows one type: buy a package period, get
 * whole free months and bonus receipts, once per company per campaign.
 */
/** Spec Q4: exactly one benefit per purchase; the one not chosen is never used. */
export type BillingBenefitChoice = 'NORMAL' | 'PROMOTION' | 'EVENT_DISCOUNT';
/** The permanent namespace of the once-per-company right: Stripe's livemode, never a Stripe account or a deploy. */
export type BillingPromotionEnvironment = 'LIVE' | 'TEST';
/** `offerSignature` pins the catalog offer the rule was published against (tier, cadence, price, tax, base receipts). */
export type BillingPromotionRule = { offerKey: PaidTier; interval: BillingInterval; bonusMonths: number; bonusReceiptUnits: number; offerSignature: string };
/** Published terms inside BillingPolicyRevision.promotionJson[campaignId]. */
export type BillingPromotionCampaign = { campaignId: string; type: 'BONUS_MONTHS'; revision: number;
  internalName: string; description: string | null; displayName: string; rules: BillingPromotionRule[];
  startsAt: string; endsAt: string; cap: number | null; paused: boolean; endedAt: string | null };
export type BillingPromotionCampaignStatus = 'DRAFT' | 'AWAITING_APPROVAL' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'CATALOG_STALE';
export type BillingPromotionUnavailableReason = 'NOT_STARTED' | 'ENDED' | 'PAUSED' | 'CAP_FULL' | 'ALREADY_USED' | 'IN_PROGRESS'
  | 'CATALOG_STALE' | 'OFFER_NOT_COVERED' | 'PURCHASE_KIND_UNSUPPORTED' | 'CHANGED';
/** Pinned into BillingSnapshot.promotion at quote; the reservation and the apply read only this. */
export type BillingPromotionSnapshot = { environmentId: BillingPromotionEnvironment; campaignId: string; revision: number; termsHash: string;
  displayName: string; offerKey: PaidTier; interval: BillingInterval; offerSignature: string; bonusMonths: number; bonusReceiptUnits: number };
/** Dates are the quote's estimate (apply uses the verified payment time). `expectedNextChargeAt` is null for a one-time mode. */
export type BillingQuotePromotion = { campaignId: string; displayName: string; bonusMonths: number; bonusReceiptUnits: number;
  totalReceiptUnits: number; paidStart: string; paidEnd: string; benefitEnd: string; expectedNextChargeAt: string | null };
/** Company-scoped view on BillingStatus.promotions: what the package page may advertise and why not. */
export type BillingPromotionOfferView = { campaignId: string; displayName: string; offerKey: PaidTier; interval: BillingInterval;
  bonusMonths: number; bonusReceiptUnits: number; totalMonths: number; totalReceiptUnits: number; endsAt: string;
  available: boolean; reason: BillingPromotionUnavailableReason | null };
/** `BillingCatalog.promotions`: the announceable part of an offer view. */
export type BillingCatalogPromotion = Omit<BillingPromotionOfferView, 'campaignId' | 'available' | 'reason'>;
/** NOT_REQUIRED: one-time mode. PENDING: paid and applied, renewal not bound yet. READY: subscription bound, first
 *  charge at `benefitEnd`. REVIEW: binding older than 23 h or an open issue. CANCELLED: the buyer stopped renewal. */
export type BillingRenewalSetupState = 'NOT_REQUIRED' | 'PENDING' | 'READY' | 'REVIEW' | 'CANCELLED';
export type BillingPromotionUse = { campaignId: string; displayName: string; state: 'RESERVED' | 'CONSUMED'; paidEnd: string | null;
  benefitEnd: string | null; bonusMonths: number; bonusReceiptUnits: number; renewalSetupState: BillingRenewalSetupState; expectedNextChargeAt: string | null };
/** After a refund of a promotion purchase (spec Q6): NOT_REQUIRED = no refund or a partial one (everything kept);
 *  PENDING = fully refunded, unused entitlement not ended yet; REVIEW = needs staff; ADJUSTED = ended and stamped. */
export type BillingPromotionEntitlementAdjustmentState = 'NOT_REQUIRED' | 'PENDING' | 'REVIEW' | 'ADJUSTED';

/** Release-1 template (spec §4 "Catalog ที่แคมเปญยอมรับ"): the only rules a campaign may publish. `baseReceiptUnits` and
 *  `monthlyPriceSatang` are what the CURRENT catalog offer must be, or publication is refused. */
export const BILLING_PROMOTION_STARTER_TEMPLATE = { type: 'BONUS_MONTHS', offerKey: 'STARTER_249', monthlyPriceSatang: 24900,
  rules: [{ interval: 'month', bonusMonths: 1, bonusReceiptUnits: 30, baseReceiptUnits: 30 },
    { interval: 'year', bonusMonths: 1, bonusReceiptUnits: 30, baseReceiptUnits: 360 }] } as const;
export type BillingPromotionTemplate = typeof BILLING_PROMOTION_STARTER_TEMPLATE;

/**
 * Admin campaign console. A draft is what an Admin typed and may be incomplete: `campaignId` (server-issued, never
 * changes) plus any of the editable fields. `revision`, `paused`, `endedAt` and each rule's `offerSignature` are
 * server-owned and never part of a draft — the server fills them when it builds the publication.
 */
export type BillingPromotionCampaignDraft = { campaignId: string; type?: 'BONUS_MONTHS'; internalName?: string; description?: string | null;
  displayName?: string; rules?: Omit<BillingPromotionRule, 'offerSignature'>[];
  /** ISO-8601 UTC instants (the form shows Asia/Bangkok). */
  startsAt?: string; endsAt?: string;
  /** null = unlimited (chosen explicitly); absent = not chosen yet. */
  cap?: number | null };
export type BillingPromotionDraftField = Exclude<keyof BillingPromotionCampaignDraft, 'campaignId'>;
/** REQUIRED: absent. INVALID: present but not publishable. END_NOT_AFTER_START: only on `endsAt`. */
export type BillingPromotionDraftError = { field: BillingPromotionDraftField; code: 'REQUIRED' | 'INVALID' | 'END_NOT_AFTER_START' };
/** EDIT = create or save a draft; DISCARD_DRAFT = cancel the draft operation; PREVIEW/SUBMIT/APPROVE/CANCEL = the existing
 *  publication workflow on the draft or the pending operation; PAUSE/END = one-step closing commands; RESUME = publication workflow. */
export type BillingPromotionCampaignAction = 'EDIT' | 'DISCARD_DRAFT' | 'PREVIEW' | 'SUBMIT' | 'APPROVE' | 'CANCEL' | 'PAUSE' | 'RESUME' | 'END';
export type BillingPromotionCampaignView = {
  campaignId: string;
  /** DRAFT / AWAITING_APPROVAL only while nothing is published; otherwise the published campaign's status now. */
  status: BillingPromotionCampaignStatus;
  /** The terms in the ACTIVE policy revision; null = never published. */
  published: BillingPromotionCampaign | null;
  /** The newest open `PROMOTION_CAMPAIGN_DRAFT` operation of this campaign; `version` is its expectedVersion. */
  draft: { operationId: string; version: number; values: BillingPromotionCampaignDraft; validationErrors: BillingPromotionDraftError[] } | null;
  /** A publication of this campaign in preview, awaiting approval or scheduled; null = none. */
  pendingOperationId: string | null;
  /** Live counts in this mode. `taken` = reserved + consumed (a refund never lowers it); `cap` null = unlimited or unpublished. */
  usage: { reserved: number; consumed: number; taken: number; cap: number | null };
  /** What this caller may do now, by state and permission. */
  allowedActions: BillingPromotionCampaignAction[];
  /** Reserved Checkouts still open: they keep their right after a pause or an end (= `usage.reserved`). */
  pendingCheckouts: number };
export type BillingPromotionCampaignList = {
  mode: BillingMode | 'DISABLED';
  /** BillingSettings.version: the expectedVersion of every campaign command. */
  settingsVersion: number;
  /** The caller's `system.billing.*` permissions. */
  capabilities: string[];
  /** Newest first; includes campaigns that exist only as a draft. */
  campaigns: BillingPromotionCampaignView[];
  /** What "สร้างแคมเปญ" pre-fills. */
  template: BillingPromotionTemplate };
/** One row per rule of a draft or published campaign, computed by the server from the policy that would apply. */
export type BillingPromotionPreviewRow = { offerKey: PaidTier; interval: BillingInterval;
  /** The current catalog offer's signature, which the publication will pin. */
  offerSignature: string;
  /** Catalog price before tax treatment, and the quote totals a buyer pays today. */
  priceSatang: number; subtotalSatang: number; taxSatang: number; totalSatang: number;
  /** 1 or 12; `totalMonths` = paid + bonus. */
  paidMonths: number; bonusMonths: number; totalMonths: number;
  /** Base from the catalog offer; `totalReceiptUnits` = base + bonus. */
  baseReceiptUnits: number; bonusReceiptUnits: number; totalReceiptUnits: number;
  /** A new shop paying at `exampleStartsAt`: the paid period ends at `paidEnd`, the free time at `benefitEnd`. */
  exampleStartsAt: string; paidEnd: string; benefitEnd: string;
  /** The next cycle's full-price total, charged at `benefitEnd` in a renewing mode. */
  renewalTotalSatang: number;
  /** Stable codes that block publication of this row (e.g. CONTROL_PROMOTION_CATALOG_STALE); empty = publishable. */
  blockers: string[] };
export type BillingPromotionReportCompany = { companyId: string; companyName: string;
  state: 'RESERVED' | 'CONSUMED' | 'RELEASED'; offerKey: PaidTier; interval: BillingInterval;
  acceptedAt: string; consumedAt: string | null; benefitAppliedAt: string | null; releasedAt: string | null;
  paidEnd: string | null; benefitEnd: string | null;
  refund: 'NONE' | 'PARTIAL' | 'FULL'; entitlementAdjustmentState: BillingPromotionEntitlementAdjustmentState;
  /** Links into the existing Admin attempt / invoice pages (their own access checks apply); null = none yet. */
  attemptHref: string | null; invoiceHref: string | null };
export type BillingPromotionCampaignReport = { campaignId: string; mode: BillingMode; generatedAt: string;
  /** reserved: Checkout open. paidAwaitingApply: CONSUMED, not applied. applied: benefit applied. releasedBeforePay: how many
   *  times a reserved right was given back with an unpaid Checkout (kept when the shop reserves again). refunded: consumed with any refund. fullyRefunded: cumulative full refund. rightsActive: applied, not fully
   *  refunded, `benefitEnd` in the future. consumed rights = paidAwaitingApply + applied, whatever was refunded. */
  counts: { reserved: number; paidAwaitingApply: number; applied: number; releasedBeforePay: number; refunded: number; fullyRefunded: number; rightsActive: number };
  /** Sums over applied rights; free months are never revenue. */
  bonusMonthsGranted: number; bonusReceiptUnitsGranted: number;
  /** Real money of the source invoices; null without `system.billing.financial.read`. */
  moneyReceivedSatang: number | null; refundedSatang: number | null;
  /** Newest first; `nextCursor` null = last page. */
  companies: BillingPromotionReportCompany[]; nextCursor: string | null };

/**
 * Admin campaign API wire shapes (plan §6: lane C serves them, lane E calls them). Every route is under
 * `/v1/system/billing`; reading needs `system.billing.read`, every command `system.billing.policy.manage`.
 *
 *   GET  promotion-campaigns                         -> BillingPromotionCampaignList
 *   GET  promotion-campaigns/:campaignId             -> BillingPromotionCampaignDetail
 *   GET  promotion-campaigns/:campaignId/report      -> BillingPromotionCampaignReport          (?cursor=)
 *   POST promotion-campaign-drafts                   -> BillingPromotionCampaignDetail          (BillingPromotionDraftInput, Idempotency-Key)
 *   POST promotion-campaign-drafts/:campaignId/discard -> BillingPromotionCampaignList          ({ draftVersion })
 *   POST promotion-campaigns/:campaignId/preview     -> BillingPromotionPreviewResult           (BillingPromotionPreviewInput)
 *   POST promotion-campaigns/:campaignId/pause | end -> BillingPromotionCampaignDetail          (BillingPromotionStateInput, Idempotency-Key, reauthentication)
 *
 * A preview creates an ordinary configuration change; it is submitted, approved or cancelled through the existing
 * `configuration-changes/:id/{submit|approve|cancel}` routes, and reauthentication is the existing `reauthenticate` route.
 */
export type BillingPromotionCampaignDetail = { mode: BillingMode | 'DISABLED'; settingsVersion: number; capabilities: string[];
  /** As on BillingConfiguration: until when this session's password confirmation is valid; null = confirm first. */
  reauthenticatedUntil: string | null;
  campaign: BillingPromotionCampaignView;
  /** Rows for the draft when one exists and has rules, otherwise for the published terms; empty when neither can be priced. */
  previewRows: BillingPromotionPreviewRow[];
  /** The open publication of this campaign (preview or awaiting approval), with its allowed actions; null = none. */
  operation: BillingConfigurationOperation | null };
/** Save a draft. No `campaignId` = create a campaign (the server mints the id). `draftVersion` = the draft's version when updating one. */
export type BillingPromotionDraftInput = { campaignId?: string; draftVersion?: number; values: Omit<BillingPromotionCampaignDraft, 'campaignId'>; reason: string };
/** PUBLISH = publish the saved draft (strictly validated); RESUME = reopen a paused campaign unchanged. `expectedVersion` = settingsVersion. */
export type BillingPromotionPreviewInput = { expectedVersion: number; draftVersion?: number; action: 'PUBLISH' | 'RESUME'; reason: string };
export type BillingPromotionPreviewResult = { operation: BillingConfigurationOperation; previewRows: BillingPromotionPreviewRow[] };
/** Pause or end now. `expectedVersion` = settingsVersion. */
export type BillingPromotionStateInput = { expectedVersion: number; reason: string };

/** Customer names share the web tier vocabulary; prices must come from the active catalog. */
export function customerPackageName(offer: Pick<BillingOffer, 'offerKey'> & Partial<Pick<BillingOffer, 'priceSatang'>>, language: 'th' | 'en' = 'th'): string {
  const name = language === 'th' ? shopPlanTierLabel(offer.offerKey) : ({ STARTER_249: 'Starter', BASIC_499: 'Basic', PRO_999: 'Pro', ENTERPRISE_1999: 'Enterprise' } as const)[offer.offerKey];
  return offer.priceSatang === undefined ? name : `${name} ${(offer.priceSatang / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${language === 'th' ? 'บาท' : 'THB'}`;
}

/** Wording only: never apply to control data, paths or source evidence. */
export function lineCustomerWording(text: string): string {
  const thai = /[ก-๙]/u.test(text);
  const packageContext = /แพ[็ก๊ค]+เกจ|\b(?:package|plan|tier)\b/iu.test(text);
  const names: Record<string, string> = { STARTER: 'Starter', BASIC: 'Basic', PRO: 'Pro', ENTERPRISE: 'Enterprise', FREE_TRIAL: 'Free trial' };
  return text.replace(/\s*\((?:STARTER|BASIC|PRO|ENTERPRISE)(?:_\d+)?\)/gu, '')
    .replace(/\b(?:STARTER|BASIC|PRO|ENTERPRISE|FREE_TRIAL)(?:_\d+)?\b/gu, code => {
      if (!packageContext && !/_\d+$/u.test(code)) return code;
      const tier = Object.keys(PLAN_TIER_PRESETS).find(tier => tier === code || tier.replace(/_\d+$/u, '') === code);
      return thai && tier ? shopPlanTierLabel(tier as PlanTierKey) : names[code.replace(/_\d+$/u, '')] ?? '';
    }).replace(/^[ \t]*—[ \t]*$/u, '-').replace(/[ \t]*—[ \t]*/gu, ' ').trim();
}

/** Public catalog facts crossing the authenticated API/gateway/runtime boundary. */
export function parseLinePackageOffers(value: unknown): BillingOffer[] | undefined {
  if (!Array.isArray(value) || value.length > 8) return undefined;
  if (value.some(o => !o || !BILLING_PAID_TIERS.includes(o.offerKey) || !['month', 'year'].includes(o.interval)
    || !Number.isSafeInteger(o.priceSatang) || o.priceSatang < 0 || !Array.isArray(o.featureKeys)
    || o.featureKeys.some((key: unknown) => typeof key !== 'string'))) return undefined;
  return value as BillingOffer[];
}
