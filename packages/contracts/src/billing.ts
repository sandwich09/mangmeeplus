import { PLAN_TIER_PRESETS, type PlanTierKey } from './plan-term.js';

export const STRIPE_API_VERSION = '2026-08-26.dahlia' as const;
export const BILLING_PAID_TIERS = ['STARTER_249', 'BASIC_499', 'PRO_999'] as const;
export type PaidTier = typeof BILLING_PAID_TIERS[number];
export type BillingMode = 'TEST' | 'LIVE';
export type BillingInterval = 'month' | 'year';
export type BillingOfferKey = `${PaidTier}:${BillingInterval}`;
export type BillingTaxTreatment = 'INCLUSIVE_VAT_7' | 'EXCLUSIVE_VAT_7' | 'NOT_VAT_REGISTERED';
export const BILLING_ACTIONS = ['new_sales', 'plan_changes', 'portal_payment_method', 'portal_change_plan', 'portal_cancel_subscription', 'notification_delivery'] as const;
export type BillingAction = typeof BILLING_ACTIONS[number];
export const BILLING_PERMISSIONS = ['system.billing.read', 'system.billing.financial.read', 'system.billing.document.read', 'system.billing.issue.manage',
  'system.billing.reconcile.run', 'system.billing.apply.retry', 'system.billing.policy.manage', 'system.billing.gate.manage',
  'system.billing.approval.approve', 'system.billing.notification.retry', 'system.billing.collection.manage', 'system.billing.refund.manage',
  'system.billing.override.manage', 'system.billing.audit.read', 'system.billing.export'] as const;

const MONTHLY = { STARTER_249: 24900, BASIC_499: 49900, PRO_999: 99900, ENTERPRISE_1999: 199900 } as const;
export type BillingOffer = {
  offerKey: Exclude<PlanTierKey, 'FREE_TRIAL_15'>; interval: BillingInterval; intervalCount: 1;
  label: string; priceSatang: number; currency: 'THB'; branchLimit: number; employeeLimit: number; monthlySlipLimit: number;
  /** Granted at once for the paid period; monthlySlipLimit is only the tier's monthly equivalent. */
  receiptAllowance: number; receiptAllowanceCadence: 'PAID_PERIOD';
  availability: 'AVAILABLE' | 'UNAVAILABLE' | 'COMING_SOON'; reason: string | null;
};
export function billingOffer(tier: Exclude<PlanTierKey, 'FREE_TRIAL_15'>, interval: BillingInterval): BillingOffer {
  const preset = PLAN_TIER_PRESETS[tier];
  return { offerKey: tier, interval, intervalCount: 1, label: preset.labelTh,
    priceSatang: MONTHLY[tier] * (interval === 'year' ? 10 : 1), currency: 'THB',
    branchLimit: preset.branchLimit, employeeLimit: preset.employeeLimit, monthlySlipLimit: preset.monthlySlipLimit,
    receiptAllowance: preset.monthlySlipLimit * (interval === 'year' ? 12 : 1), receiptAllowanceCadence: 'PAID_PERIOD',
    availability: tier === 'ENTERPRISE_1999' ? 'COMING_SOON' : 'UNAVAILABLE',
    reason: tier === 'ENTERPRISE_1999' ? 'COMING_SOON' : 'BILLING_NOT_READY' };
}

export type BillingPolicy = {
  schemaVersion: 1;
  paidStart: 'IMMEDIATE' | 'AFTER_TRIAL' | null;
  taxTreatment: BillingTaxTreatment | null;
  graceDays: number | null;
  cancellation: 'PERIOD_END' | null;
  planChanges: 'UPGRADE_PRORATED_DOWNGRADE_PERIOD_END' | null;
  debtRecovery: 'MANUAL_REVIEW' | null;
  refundPolicy: 'MANUAL_REVIEW' | null;
  priceIds: Partial<Record<BillingOfferKey, string>>;
  /** Internal prepaid scheduling prices; never public offers. */
  zeroPriceIds?: Partial<Record<BillingOfferKey, string>>;
  taxRateId: string | null;
  portalConfigurationId: string | null;
  consentRevision: string;
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
};
export type BillingQuote = {
  quoteId: string; companyId: string; companyName: string; policyRevision: string; expiresAt: string;
  offer: BillingOffer; subtotalSatang: number; taxSatang: number; totalSatang: number;
  taxTreatment: BillingTaxTreatment; consentRevision: string; paidStart: 'IMMEDIATE' | 'AFTER_TRIAL';
  billingEmail: string; trialEndsAt: string | null; usage: BillingReceiptUsage;
  purchase?: { kind: 'INITIAL' | 'REPEAT' | 'RESTART' | 'UPGRADE'; previousPaidThrough: string | null; projectedPaidThrough: string;
    receiptUnitsAdded: number; projectedRemainingReceipts: number };
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
export type BillingStatus = {
  companyId: string; companyName: string; mode: BillingMode | 'DISABLED'; policyRevision: string | null;
  paymentState: 'NONE' | 'PENDING' | 'UNKNOWN' | 'PAID' | 'FAILED' | 'ACTION_REQUIRED';
  applyState: 'NONE' | 'PENDING' | 'APPLIED' | 'HELD' | 'FAILED';
  accessState: 'ACTIVE' | 'EXPIRED' | 'HELD'; subscriptionState: string; documentState: 'NONE' | 'PENDING' | 'READY';
  attemptId: string | null; reference: string | null; observedAt: string | null;
  tierKey: string | null; interval: BillingInterval | null; termEndsAt: string | null; paidThrough: string | null; nextChargeAt: string | null;
  cancelAtPeriodEnd: boolean; graceEndsAt: string | null; allowedActions: BillingAction[];
  usage: BillingReceiptUsage;
  issues: { reference: string; code: string }[];
  collection?: BillingCollectionOperation | null;
  pendingPlanChange?: BillingCollectionOperation | null;
  planCapacityRepair?: { operationId: string; version: number; offerKey: string; interval: BillingInterval } | null;
  capacityRepair?: { attemptId: string; attemptVersion: number; offerKey: string; interval: BillingInterval } | null;
};
export type BillingCollectionAction = 'CANCEL_RENEWAL' | 'RESUME_RENEWAL' | 'SCHEDULE_DOWNGRADE' | 'CANCEL_DOWNGRADE';
export type BillingCollectionOperation = { id: string; companyId: string; action: BillingCollectionAction; state: string; version: number;
  previewHash: string; effectiveAt: string; nextRenewalTotalSatang: number; expiresAt: string; observedAt: string | null;
  errorCode: string | null; allowedActions: ('submit' | 'withdraw')[];
  targetOffer?: BillingOffer; capacity?: BillingCapacityImpact };
export type BillingCheckoutBody = { quoteId: string; consentRevision: string; accepted: true; channel: 'web' | 'line' };
export type BillingCheckoutResult = { attemptId: string; state: string; checkoutUrl: string | null };
export type BillingAttemptView = {
  attemptId: string; state: string; errorCode: string | null; observedAt: string;
  paymentState: 'PENDING' | 'PAID' | 'FAILED'; applyState: BillingStatus['applyState']; invoiceReference: string | null;
};
export type BillingInvoiceItem = { id: string; number: string | null; currency: 'THB'; amountSatang: number;
  refundedSatang: number; disputed: boolean; financialObservedAt: string | null;
  paymentState: string; applyState: string; periodStart: string; periodEnd: string; createdAt: string; hasDocuments: boolean };
export type BillingCatalog = { schemaVersion: 1; mode: BillingMode | 'DISABLED'; policyRevision: string | null;
  catalogRevision: string; generatedAt: string; validUntil: string; taxTreatment: BillingTaxTreatment | null; offers: BillingOffer[];
  trial: { tierKey: 'FREE_TRIAL_15'; days: 30; monthlySlipLimit: 15; branchLimit: 1; employeeLimit: 2; menus: 7 } };

export type BillingOperationType = 'RECONCILE' | 'RETRY_APPLY' | 'RETRY_NOTIFICATION' | 'RECONCILE_NOTIFICATION' | 'SET_ACTION_GATE' | 'PUBLISH_POLICY' | 'EXPIRE_CHECKOUT' | 'CHANGE_COLLECTION' | 'REFUND' | 'GRANT_OVERRIDE' | 'REVOKE_OVERRIDE';
export type BillingOperationState = 'DRAFT' | 'PREVIEW' | 'AWAITING_APPROVAL' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'UNKNOWN' | 'BLOCKED' | 'FAILED' | 'CANCELLED';
export type BillingScope = { kind: 'COMPANY'; companyId: string; mode: BillingMode } | { kind: 'PLATFORM'; mode: BillingMode };
export type BillingOperationView = { id: string; type: BillingOperationType; state: BillingOperationState; scope: BillingScope;
  version: number; reason: string; initiatorUserId: string; approverUserId: string | null; errorCode: string | null;
  createdAt: string; observedAt: string | null; expiresAt: string; referenceId: string | null };

export type BillingOperatorCompany = {
  accountId: string | null; companyId: string; companyName: string; mode: BillingMode | 'DISABLED'; version: number;
  subscriptionState: string; paidThrough: string | null; nextChargeAt: string | null; observedAt: string | null;
  tierKey: string | null; termEndsAt: string | null; companyStatus: string; pendingAttemptId: string | null;
  source: 'TRIAL' | 'MANUAL' | 'STRIPE' | 'OTHER_BILLING' | 'NONE';
  paymentState: BillingStatus['paymentState']; applyState: BillingStatus['applyState']; accessState: BillingStatus['accessState']; documentState: BillingStatus['documentState'];
  graceEndsAt: string | null; cancelEffectiveAt: string | null; origin: 'web' | 'line' | null;
  branchLimit: number | null; employeeLimit: number | null; pendingPlanChangeId: string | null; collectionOperationId: string | null;
};
export type BillingOperatorIssue = { id: string; companyId: string | null; kind: string; reference: string;
  state: string; assigneeUserId: string | null; note: string | null; version: number; createdAt: string; updatedAt: string;
  assigneeName: string | null; assigneeAvailable: boolean; backupUserId: string | null; backupName: string | null; backupAvailable: boolean;
  priority: 'NORMAL' | 'HIGH' | 'CRITICAL'; followUpAt: string | null; overdue: boolean; episode: number; lastSeenAt: string };
export type BillingOperatorOverview = { mode: BillingMode | 'DISABLED'; capabilities: string[]; platformScope: boolean; canManageScopes?: boolean;
  companies: BillingOperatorCompany[]; nextCursor: string | null };
export type BillingOperatorCompanyDetail = BillingOperatorCompany & { usage: BillingReceiptUsage;
  issues: BillingOperatorIssue[]; financial: { invoices: BillingInvoiceItem[]; nextCursor: string | null } | null };
export type BillingTimelineEntry = { reference: string; kind: string; type: string; state: string; recordedAt: string; occurredAt: string | null;
  updatedAt: string | null; observedAt: string | null; origin: string | null; amountSatang: number | null; href: string | null };
export type BillingTimeline = { items: BillingTimelineEntry[]; nextCursor: string | null; auditIncluded: boolean; financialIncluded: boolean };
export type BillingRepairPreview = { type: 'RECONCILE' | 'RETRY_APPLY' | 'RETRY_NOTIFICATION' | 'RECONCILE_NOTIFICATION'; companyId: string; expectedVersion: number; reason: string; referenceId?:string };
export type BillingRepairOperation = BillingOperationView & { sourceVersion: number; previewHash: string;
  deliveryImpact?:{channel:string;recipientUserId:string;beforeState:string;afterState:'QUEUED'|'OBSERVED';attemptCount:number;retryUntil:string|null;possibleDuplicate?:boolean};
  allowedActions: ('submit' | 'retry' | 'cancel')[]; observed: { pendingAttemptId: string | null; issueCount: number; deliveryId?:string; deliveryState?:string } | null };
export type BillingDeliveryView = { id:string;companyId:string;mode:BillingMode;channel:'WEB'|'LINE'|'EMAIL';invoiceId:string;recipientUserId:string;
  state:string;attemptCount:number;updatedAt:string;nextAttemptAt:string|null;acceptedAt:string|null;confirmedAt:string|null;
  errorCode:string|null;recoveryBlockedReason:string|null;accountVersion:number;retryOperationId:string|null;canRetry:boolean;canReconcile:boolean;possibleDuplicate:boolean;
  mailHistory?:Array<{id:string;generation:number;state:string;acceptedAt:string|null;deliveredAt:string|null;errorCode:string|null;possibleDuplicate:boolean}> };

export type BillingConfiguration = { version: number; mode: BillingMode | 'DISABLED'; policy: BillingPolicy;
  policyRevisionId: string | null; gates: Record<BillingAction, boolean>; capabilities: string[]; reauthenticatedUntil: string | null };
export type BillingConfigurationInput = { type: 'PUBLISH_POLICY' | 'SET_ACTION_GATE'; expectedVersion: number;
  policy: BillingPolicy; gates: Record<BillingAction, boolean>; reason: string; draftId?:string;draftVersion?:number };
export type BillingConfigurationDraftInput = Omit<BillingConfigurationInput,'draftVersion'>;
export type BillingConfigurationImpact = { subscriptions: number; inFlightAttempts: number; unusedQuotes: number; pendingPlanChanges: number; collectionCommands: number;
  sourceHash?: string;
  prices: { offerKey: BillingOfferKey; beforeTotalSatang: number; afterTotalSatang: number }[] };
export const BILLING_CONFIGURATION_IMPACT_KINDS = ['SUBSCRIPTION', 'ATTEMPT', 'QUOTE', 'PLAN_CHANGE', 'COLLECTION'] as const;
export type BillingConfigurationImpactKind = typeof BILLING_CONFIGURATION_IMPACT_KINDS[number];
export type BillingConfigurationImpactItem = { reference: string; kind: BillingConfigurationImpactKind; recordId: string; companyId: string;
  state: string; boundary: string | null; nextChargeAt: string | null };
export type BillingConfigurationImpactPage = { kind: BillingConfigurationImpactKind; items: (BillingConfigurationImpactItem & { companyName: string })[];
  sourceHash: string; matchesPreview: boolean; nextCursor: string | null; observedAt: string };
export type BillingConfigurationOperation = BillingOperationView & { sourceVersion: number; previewHash: string;
  proposed: { policy: BillingPolicy; gates: Record<BillingAction, boolean> }; impact: BillingConfigurationImpact|null;canEditDraft?:boolean;sourceDraftVersion?:number;
  allowedActions: ('submit' | 'approve' | 'cancel')[]; activeRevisionId: string | null };


export type BillingOperatorScopeView = { id: string; companyId: string; companyName: string; userId: string; userName: string;
  mode: BillingMode; version: number; state: 'ACTIVE' | 'EXPIRED' | 'REVOKED'; expiresAt: string | null };
export type BillingScopeDirectory = { items: { id: string; name: string }[]; nextCursor: string | null };
export type BillingScopeChange = { id: string; type: 'GRANT_SCOPE' | 'REVOKE_SCOPE'; state: BillingOperationState; version: number;
  previewHash: string; mode: BillingMode; companyId: string; companyName: string; userId: string; userName: string; capabilities: string[];
  current: BillingOperatorScopeView | null; expiresAt: string; scopeExpiresAt: string | null; reason: string; observedAt: string | null;
  allowedActions: ('submit' | 'approve' | 'cancel')[] };
