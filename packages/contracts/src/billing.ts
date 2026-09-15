import { PLAN_TIER_PRESETS, type PlanTierKey } from './plan-term.js';

export const STRIPE_API_VERSION = '2026-08-26.dahlia' as const;
export const BILLING_PAID_TIERS = ['STARTER_249', 'BASIC_499', 'PRO_999'] as const;
export type PaidTier = typeof BILLING_PAID_TIERS[number];
export type BillingMode = 'TEST' | 'LIVE';
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
export type BillingOfferKey = `${PaidTier}:${BillingInterval}`;
export type BillingTaxTreatment = 'INCLUSIVE_VAT_7' | 'EXCLUSIVE_VAT_7' | 'NOT_VAT_REGISTERED';
export const BILLING_ACTIONS = ['new_sales', 'plan_changes', 'portal_payment_method', 'portal_change_plan', 'portal_cancel_subscription', 'notification_delivery', 'refunds'] as const;
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
  purchaseEligibility?: 'ELIGIBLE' | 'COMPANY_SALES_CLOSED';
  refundReviewPending?: boolean;
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
  items: BillingAdjustmentItem[]; nextCursor: string | null; observedAt: string; canOpenDocuments: boolean };
export type BillingCatalog = { schemaVersion: 1; mode: BillingMode | 'DISABLED'; policyRevision: string | null;
  catalogRevision: string; generatedAt: string; validUntil: string; taxTreatment: BillingTaxTreatment | null; offers: BillingOffer[];
  trial: { tierKey: 'FREE_TRIAL_15'; days: 30; monthlySlipLimit: 15; branchLimit: 1; employeeLimit: 2; menus: 7 } };

export type BillingOperationType = 'CHECK_PROVIDER_CONFIGURATION' | 'RECONCILE' | 'IMPORT_INVOICE' | 'RETRY_APPLY' | 'RETRY_NOTIFICATION' | 'RECONCILE_NOTIFICATION' | 'RETRY_PROVIDER_EVENT' | 'SET_ACTION_GATE' | 'PUBLISH_POLICY' | 'EXPIRE_CHECKOUT' | 'CHANGE_COLLECTION' | 'REFUND' | 'GRANT_OVERRIDE' | 'REVOKE_OVERRIDE';
export type BillingOperationState = 'DRAFT' | 'PREVIEW' | 'AWAITING_APPROVAL' | 'SCHEDULED' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'UNKNOWN' | 'BLOCKED' | 'FAILED' | 'CANCELLED';
export type BillingScope = { kind: 'COMPANY'; companyId: string; mode: BillingMode } | { kind: 'PLATFORM'; mode: BillingMode };
export type BillingConfigurationCheckItem = { kind:'POLICY'|'ACCOUNT'|'PRICE'|'PREPAID_PRICE'|'PORTAL'|'TAX'; offerKey?:BillingOfferKey;
  state:'MATCH'|'DIFFERENT'|'UNAVAILABLE'|'NOT_CONFIGURED'; reason:'MATCH'|'NOT_CONNECTED'|'POLICY_NOT_READY'|'MAPPING_DIFFERENT'|'PROVIDER_UNAVAILABLE'|'ACCOUNT_DIFFERENT' };
export type BillingConfigurationCheck = { id:string; mode:BillingMode; state:'QUEUED'|'RUNNING'|'SUCCEEDED'|'BLOCKED'|'CANCELLED'; version:number;
  sourceVersion:number; isCurrent:boolean; reason:string; createdAt:string; observedAt:string|null; errorCode:string|null; reviewCaseId:string|null;
  result:BillingConfigurationCheckItem['state']|null; items:BillingConfigurationCheckItem[]; canRun:boolean; canCancel:boolean };
export type BillingConfigurationCheckHistory = {items:BillingConfigurationCheck[];nextCursor:string|null;activeCheck:BillingConfigurationCheck|null;canCreate:boolean;mode:BillingMode|'DISABLED';settingsVersion:number};
export type BillingOperationView = { id: string; type: BillingOperationType; state: BillingOperationState; scope: BillingScope;
  version: number; reason: string; initiatorUserId: string; approverUserId: string | null; errorCode: string | null;
  createdAt: string; observedAt: string | null; expiresAt: string; referenceId: string | null };

export type BillingCheckoutState = 'open'|'expired'|'complete';
export type BillingCheckoutPaymentState = 'paid'|'unpaid'|'no_payment_required';
export type BillingCheckoutAttempts = {companyName:string;items:{id:string;companyId:string;createdAt:string;state:string;hasCheckout:boolean;channel:'web'|'line'}[];nextCursor:string|null};
export type BillingCheckoutReview = {companyId:string;companyName:string;attemptId:string;mode:BillingMode;sourceHash:string|null;
  providerState:BillingCheckoutState|null;paymentState:BillingCheckoutPaymentState|null;expiresAt:string|null;canExpire:boolean;blockedReason:string|null};
export type BillingCheckoutExpiryOperation = BillingOperationView & {companyName:string;previewHash:string;dispatchedAt:string|null;
  providerState:BillingCheckoutState|null;paymentState:BillingCheckoutPaymentState|null;reconciliationPending:boolean;reviewCaseId:string|null;allowedActions:('submit'|'cancel'|'run')[]};

export type BillingRefundInput = { amountSatang:number; reason:string; memo:string; notifyCustomer:boolean; sourceHash:string };
export type BillingRefundReview = { companyId:string; companyName:string; invoiceId:string; invoiceNumber:string|null; mode:BillingMode;
  paidSatang:number; refundedSatang:number; disputed:boolean; refundLimitSatang:number|null; canCreate:boolean; blockedReason:string|null;
  sourceHash:string; observedAt:string; usage:BillingStatus['usage']; adjustments:BillingAdjustmentItem[] };
export type BillingRefundOperation = BillingOperationView & { type:'REFUND'; sourceVersion:number; previewHash:string;
  companyName:string; invoiceNumber:string|null; amountSatang:number; taxSatang:number; memo:string; notifyCustomer:boolean;
  paidSatang:number; previousRefundedSatang:number; usage:BillingStatus['usage'];
  allowedActions:('submit'|'approve'|'cancel'|'run')[]; dispatchedAt:string|null; creditNoteId:string|null; creditNoteNumber:string|null;
  refundId:string|null; refundState:BillingAdjustmentItem['status']|null; reviewCaseId:string|null; bankReceiptConfirmed:false };

export type BillingOperatorCompany = {
  accountId: string | null; companyId: string; companyName: string; mode: BillingMode | 'DISABLED'; version: number;
  subscriptionState: string; paidThrough: string | null; nextChargeAt: string | null; observedAt: string | null;
  tierKey: string | null; termEndsAt: string | null; companyStatus: string; pendingAttemptId: string | null;
  source: 'TRIAL' | 'MANUAL' | 'STRIPE' | 'OTHER_BILLING' | 'NONE';
  paymentState: BillingStatus['paymentState']; applyState: BillingStatus['applyState']; accessState: BillingStatus['accessState']; documentState: BillingStatus['documentState'];
  graceEndsAt: string | null; cancelEffectiveAt: string | null; origin: 'web' | 'line' | null;
  branchLimit: number | null; employeeLimit: number | null; pendingPlanChangeId: string | null; collectionOperationId: string | null;
};
export type BillingOperatorIssue = { id: string; companyId: string | null; companyName?:string|null; kind: string; reference: string;
  operationType?:string|null;
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
  companies: BillingOperatorCompany[]; nextCursor: string | null };
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
export type BillingApplyInvoiceView = { id:string;companyId:string;mode:BillingMode;version:number;accountVersion:number;applyState:string;paymentVerified:boolean;
  periodStart:string;periodEnd:string;appliedAt:string|null;observedAt:string|null;sourceHash:string;canRetry:boolean };
export type BillingInvoiceFindingReview = BillingInvoiceFinding & {accountVersion:number;sourceHash:string;canImport:boolean};
export type BillingRepairOperation = BillingOperationView & { sourceVersion: number; previewHash: string;
  findingImpact?: {scanId:string;findingId:string;beforeState:string;invoiceCreatedAt:string};
  invoiceImpact?: { id:string;beforeState:string;periodStart:string;periodEnd:string };
  eventImpact?: { eventType: string; beforeState: string; attempts: number };
  deliveryImpact?:{channel:string;recipientUserId:string;recipientName?:string|null;beforeState:string;afterState:'QUEUED'|'OBSERVED';attemptCount:number;retryUntil:string|null;possibleDuplicate?:boolean};
  allowedActions: ('submit' | 'retry' | 'cancel')[]; observed: { pendingAttemptId: string | null; issueCount: number; deliveryId?:string; deliveryState?:string; eventState?: string;invoiceId?:string;invoiceApplyState?:string } | null };
export type BillingProviderEventView = { id: string; mode: BillingMode; eventType: string; state: string; attempts: number;
  receivedAt: string; processedAt: string | null; retryAt: string; leaseUntil: string | null; errorCode: string | null;
  sourceHash: string; canRetry: boolean; issueId: string | null };
export type BillingDeliveryView = { id:string;companyId:string;mode:BillingMode;channel:'WEB'|'LINE'|'EMAIL';invoiceId:string;recipientUserId:string;
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
  prices: { offerKey: BillingOfferKey; beforeTotalSatang: number; afterTotalSatang: number }[] };
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
export type BillingScopeChange = { id: string; type: 'GRANT_SCOPE' | 'REVOKE_SCOPE'; state: BillingOperationState; version: number;
  previewHash: string; mode: BillingMode; companyId: string; companyName: string; userId: string; userName: string; capabilities: string[];
  current: BillingOperatorScopeView | null; expiresAt: string; scopeExpiresAt: string | null; reason: string; observedAt: string | null;
  allowedActions: ('submit' | 'approve' | 'cancel')[] };
