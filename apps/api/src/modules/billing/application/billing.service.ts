import { BillingEmailRecipient, pendingAdminRecipientChange } from './billing-email-recipient';
import { BillingDocumentResend } from './billing-document-resend';
import { checkoutAddressOf } from './billing-recipient-capture';
import { assertBillingProfileUnchanged, billingProfileComplete, stripeCustomerSyncPayload, stripeCustomerSynced } from './billing-company-profile';
import { companyBillingProfile, type BillingRecipientSource } from '@watchdog-bms/contracts';
import { accountEmailState } from '../../auth/application/account-email-state';
import type { EmailProof } from '../../auth/domain/logic/email-otp.logic';
import { BillingAdminCollection } from './billing-admin-collection';
import { effectivePlanCapacity } from '../../system-partner-management/domain/logic/plan-capacity';
import { assertNoPendingRefund, pendingRefund } from './billing-refund-source';
import { invoiceHistoryItem, readInvoiceAdjustments, readInvoiceDocument, sameInvoiceSource } from './billing-invoice-details';
import type { BillingAdjustmentKind } from '@watchdog-bms/contracts';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BILLING_ACTIONS, BILLING_DRAFT_POLICY, BILLING_PAID_TIERS, TIER_FEATURE_PRESETS, billingOffer, billingProductKind, type BillingProductKind, type BillingCatalog, type BillingPolicy, type BillingQuote,
  type BillingCheckoutBody, type BillingCheckoutResult, type BillingStatus, type BillingAction, type BillingInvoiceItem, type BillingAttemptView,
  type BillingPurchaseMode, type BillingOffer } from '@watchdog-bms/contracts';
import { assertNotDemoCompany } from '../../sales-demo/application/demo-company-access';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { BillingAccount, Prisma } from '../../../generated/prisma/client';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { StripeClient, StripeRequestError, safeStripeUrl, stripeId } from '../infrastructure/stripe.client';
import { assertCompanyCanBuy, companyCanBuy, assertPolicyReady, assertStripePrice, assertStripePortalConfiguration, billingError, billingMonth, configurationHash, effectiveBillingGates, hashBilling, paidVariant, parseBillingPolicy, quoteTotals } from '../domain/billing-policy';
import { canManagePlan } from '../../access-control/domain/logic/plan-manager.logic';

import { BillingRepeat, type RepeatSource } from './billing-repeat';
import { BillingCollection } from './billing-collection';
import { BillingPriceReturn } from './billing-price-return';
import { BillingDealSubscriptionCancel, canConvertDealSubscription } from './billing-deal-subscription-cancel';
import { collectionContract, pendingChange, type ScheduledChange } from './billing-schedule';
import { restartFits, restartSource, restartReviewPending, type RestartSource } from './billing-restart';
import { appendPackageInterval, fullPackagePurchaseImpact, invoiceServiceEnd, promotionBoundaries } from '../domain/billing-package';
import { isUpgrade, promotionUpgradeDeferral, promotionUpgradeDeferred, upgradeHistory, upgradePreview, type UpgradeSource } from './billing-upgrade';
import { capacityOptions, capacityValid, capacityImpact, capacityReview, parseCapacitySelection, purchasedCapacityOffer } from './billing-capacity';
import type { BillingCapacitySelection } from '@watchdog-bms/contracts';
import { PartnerLifecycleTransitionUseCase } from '../../system-partner-management/application/use-cases/partner-lifecycle-transition.use-case';

import { termProjectionHash } from '../domain/paid-invoice';
import { receiptQuotaSnapshot } from '../../line-ai/application/company-ocr-governance';
import { packageReceiptBalance } from './billing-receipt-grants';
import { trialReceiptCarryover, type TrialCarryoverSource } from './billing-trial-carryover';
import { billingState } from '../domain/billing-state';
import { planTermLockReason } from '../../system-partner-management/domain/logic/plan-term.logic';
import { BillingFreeDays } from './billing-free-days';
import { detectBillingIssue } from './billing-issues';
import { billingPurchaseSource, packageMenuPurchaseSource, oneTimeSourceReady } from './billing-purchase-source';
import type { BillingPurchaseSource } from '@watchdog-bms/contracts';
import { billingFeaturePlan, type BillingFeaturePlan } from './billing-feature-entitlements';
import { planMenuImpact } from './billing-plan-menus';
import { assertDealOfferUnchanged, assertDealSnapshot, dealOffer, dealPurchaseModes, dealSnapshot, dealSnapshotHash, type DealSource } from '../domain/deal-offer';
import { autoRenewOf, DEAL_KIND } from '../../sales-console/domain/sales-deal.logic';
import type { BillingEventDiscountView } from '@watchdog-bms/contracts';
import { eventDiscountBasis, eventDiscountCheckoutRule, eventDiscountDocumentDescription, eventDiscountExpected, eventDiscountPurchase, type EventDiscountSnapshot } from '../domain/billing-event-discount.logic';
import { eventDiscountHolderBlock, eventDiscountOffer, eventDiscountPath, eventDiscountRenewalState, eventDiscountView, holderEventDiscountTickets, releaseEventDiscount, reserveEventDiscount } from './billing-event-discount';
import { paymentCheckoutMode, paymentCheckoutSnapshot, prepaidCardAuto } from '../domain/billing-checkout-mode';
import type { BillingBenefitChoice, BillingPromotionSnapshot, BillingPromotionUse } from '@watchdog-bms/contracts';
import { parsePromotionCampaignsLenient, promotionCampaignStatus, promotionSignatures, promotionUnavailable, promotionUnsupportedPurchase } from '../domain/billing-promotion';
import { lockPromotionFence, promotionEligibility, promotionEnvironment, promotionForAttempt, promotionOffers, releasePromotion, reservePromotion } from './billing-promotion';
import type { BillingPromotionRedemption } from '../../../generated/prisma/client';

/** D-P5-6: the future contract a `SCHEDULE_PRICE_RETURN` writes. The invoice that applies it puts
 *  the shop back on the tier's default menus, AI credit and limits (Q1) even though it is a RENEWAL. */
export type DealReturnSource = { dealRequestId: string; returnAt: string; creditScope?: 'CHAT' | 'TOTAL' };
/** `emailProof` is read from snapshots written before purchase-without-setup only; new quotes carry none. */
export type BillingSnapshot = { productKind?: BillingProductKind; trialCarryover?: TrialCarryoverSource; emailProof?: EmailProof; quote: BillingQuote; deal?: DealSource; dealReturn?: DealReturnSource; subscriptionConversion?: { subscriptionId: string; paidThrough: string }; advanceDeal?: { invoiceId: string; contractAttemptId: string; paidThrough: string; firstCycleEndsAt: string; anchorDay: number }; priceId: string; productId?: string; policy: BillingPolicy; settingsVersion?: number; termVersion: string | null; termHash: string; featurePlan?: BillingFeaturePlan; repeat?: RepeatSource; restart?: RestartSource; upgrade?: UpgradeSource; oneTime?: { invoiceId: string; paidThrough: string; anchorDay: number; offerKey: string; interval: string }; oneTimeChange?: { effectiveAt: string; currentOffer: BillingOffer }; capacity?: BillingCapacitySelection; planChangeId?: string; pendingChange?: { id: string; version: number; proposed: ScheduledChange };
  /** Sales-event first-bill discount (spec §7.2): the ticket chosen (USE) or the one declined; absent = no offer at quote. */
  eventDiscount?: EventDiscountSnapshot;
  /** Promotion campaign accepted at quote (promotion plan §4): the reservation and the apply read only this. */
  promotion?: BillingPromotionSnapshot };
/** Add-on foundation (plan PR A, A5): absent = PACKAGE, the only kind before add-ons; an unknown kind is never guessed. */
export function snapshotProductKind(snapshot: Pick<BillingSnapshot, 'productKind'>): BillingProductKind {
  const kind = billingProductKind(snapshot.productKind);
  if (!kind) throw new Error('billing.product_kind_unknown');
  return kind;
}
/** Add-on foundation (plan PR A, A4): the one "latest package invoice" read. An add-on invoice ends at its
 *  paidAt, so without the PACKAGE filter it would pass for the newest package period. */
export const latestPackageInvoice = (db: Prisma.TransactionClient, where: Prisma.BillingInvoiceWhereInput) =>
  db.billingInvoice.findFirst({ where: { ...where, productKind: 'PACKAGE' }, orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }] });
const oneTimeMode = (mode: BillingPurchaseMode | 'NONE' | undefined) => mode === 'CARD_ONCE' || mode === 'PROMPTPAY_ONCE';
/** Promotion plan R2: `invoiceServiceEnd(invoice) == at` as a query. An invoice without `benefitEnd` matches exactly as before. */
export const invoiceServiceEndsAt = (at: Date): Prisma.BillingInvoiceWhereInput => ({ OR: [{ benefitEnd: null, periodEnd: at }, { benefitEnd: at }] });
/**
 * Promotion plan R11: the right as the buyer sees it, the renewal setup derived from the account — no state column.
 * One-time: nothing to set up. Renewing: READY once a subscription is bound, PENDING while the paid attempt still holds
 * the account slot (REVIEW after 23 h or with an open issue about this purchase — `renewalSetupIssue`), CANCELLED once
 * renewal was stopped or the slot let go.
 */
function promotionUse(row: BillingPromotionRedemption, snapshot: BillingSnapshot, account: Pick<BillingAccount, 'baseSubscriptionId' | 'subscriptionState' | 'cancelAtPeriodEnd' | 'activeAttemptId'>,
  renewalIssue: boolean, now = new Date()): BillingPromotionUse {
  const renewalSetupState = oneTimeMode(snapshot.quote.purchaseMode) ? 'NOT_REQUIRED' : row.state === 'RESERVED' ? 'PENDING'
    : account.baseSubscriptionId ? account.cancelAtPeriodEnd || ['canceled', 'incomplete_expired'].includes(account.subscriptionState) ? 'CANCELLED' : 'READY'
    : account.activeAttemptId !== row.attemptId ? 'CANCELLED'
    : renewalIssue || (row.consumedAt && now.getTime() - row.consumedAt.getTime() > 23 * 3_600_000) ? 'REVIEW' : 'PENDING';
  return { campaignId: row.campaignId, displayName: snapshot.promotion?.displayName ?? '', state: row.state as 'RESERVED' | 'CONSUMED',
    paidEnd: row.paidEnd?.toISOString() ?? null, benefitEnd: row.bonusEnd?.toISOString() ?? null, bonusMonths: row.bonusMonths, bonusReceiptUnits: row.bonusReceiptUnits,
    renewalSetupState, expectedNextChargeAt: ['NOT_REQUIRED', 'CANCELLED'].includes(renewalSetupState) ? null : row.bonusEnd?.toISOString() ?? null };
}
/**
 * D-P5-4 — is this pinned quote an AUTO-RENEWING deal? The quote refuses every other pairing, so
 * the purchase mode alone is proof: a deal on a renewing mode pinned the deal's own recurring
 * Price into `snapshot.priceId`, while a one-time deal pinned the catalog Price.
 */
const autoRenewDealSnapshot = (snapshot: BillingSnapshot) => !!snapshot.deal && !oneTimeMode(snapshot.quote.purchaseMode);
const gateForMode = (mode: BillingPurchaseMode): BillingAction => mode === 'CARD_ONCE' ? 'card_once' : mode === 'PROMPTPAY_ONCE' ? 'promptpay_once' : mode === 'PROMPTPAY_RENEW' ? 'promptpay_renew' : 'new_sales';
function assertPurchaseMode(mode: unknown): asserts mode is BillingPurchaseMode {
  if (!['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW'].includes(String(mode)))
    throw billingError('BILLING_MODE_NOT_READY', 'วิธีชำระเงินนี้ยังไม่เปิดให้บริการ');
}
const CLOSED_GATES = Object.fromEntries(BILLING_ACTIONS.map((key) => [key, false]));
/** R-A5/R-A10: a recipient changed since the quote makes it stale — judged against the column, never Stripe.
 *  An empty column is not drift: the email the quote pinned (if any) becomes the recipient. */
function assertRecipientUnchanged(account: Pick<BillingAccount, 'recipientEmail'> | null, snapshot: BillingSnapshot) {
  if (account?.recipientEmail && account.recipientEmail !== (snapshot.quote.billingEmail ?? null))
    throw billingError('BILLING_QUOTE_STALE', 'อีเมลรับเอกสารเปลี่ยน กรุณาตรวจสอบรายการใหม่');
}
/** R-D1: resend needs a paid, applied invoice, a recipient and no recipient change in flight. */
export function canResendDocuments(row: { providerStatus: string; applyStatus: string },
  account: Pick<BillingAccount, 'recipientEmail' | 'activeEmailOperationId' | 'recipientBouncedAt'>): boolean {
  // The command itself refuses BILLING_RECIPIENT_BOUNCED (billing-document-resend.ts); the button must
  // agree, or it offers a resend that can only fail.
  return row.providerStatus === 'paid' && row.applyStatus === 'APPLIED' && !!account.recipientEmail && !account.activeEmailOperationId && !account.recipientBouncedAt;
}

/**
 * Promotion plan R3, for every attempt: publishing, pausing or ending a campaign mints a new revision with the SAME base
 * policy and bumps the settings version. Neither withdraws a reserved right, and neither may stop a purchase that has no
 * promotion at all. So a different revision or settings version counts as unchanged while the base policy is the one the
 * attempt pinned. The settings version also moves with a gate: the caller reads `new_sales` and the payment-mode gate as
 * always, and the one other gate Checkout relied on (`plan_changes`, for an upgrade or a scheduled change) is read here.
 */
async function basePolicyUnchanged(db: Prisma.TransactionClient, state: Awaited<ReturnType<BillingService['settings']>>,
  attempt: { quoteSnapshot: unknown; policyRevisionId: string }): Promise<boolean> {
  const snapshot = attempt.quoteSnapshot as BillingSnapshot | null;
  if (!state.revision || ((snapshot?.upgrade || snapshot?.oneTimeChange) && !state.gates.plan_changes)) return false;
  if (state.revision.id === attempt.policyRevisionId) return true;
  const pinned = await db.billingPolicyRevision.findUnique({ where: { id: attempt.policyRevisionId }, select: { policyJson: true } });
  return !!pinned && configurationHash(pinned.policyJson) === configurationHash(state.revision.policyJson);
}

/**
 * Promotion plan R11: is the renewal setup of THIS purchase under review? Only an open issue about the purchase itself
 * counts — its attempt (an unconfirmed Checkout), its invoice (paid but held or not applied), or the account the
 * reconciler could not finish (where a failed renewal bind lands). A refund or dispute review of other money does not.
 */
async function renewalSetupIssue(db: Prisma.TransactionClient, account: Pick<BillingAccount, 'id' | 'companyId' | 'stripeAccountId' | 'livemode'>,
  right: Pick<BillingPromotionRedemption, 'attemptId' | 'invoiceId'>): Promise<boolean> {
  return !!await db.billingIssue.findFirst({ where: { companyId: account.companyId, stripeAccountId: account.stripeAccountId,
    livemode: account.livemode, state: { not: 'RESOLVED' }, referenceId: { in: [account.id, right.attemptId, right.invoiceId].filter((id): id is string => !!id) } },
    select: { id: true } });
}

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfigService, readonly stripe: StripeClient,
    @Optional() private readonly lifecycle?: PartnerLifecycleTransitionUseCase) {}

  get emailRecipient() { return new BillingEmailRecipient(this.prisma, this.stripe, this, this.config); }
  get documentResend() { return new BillingDocumentResend(this.prisma, this.stripe, this); }
  get freeDays() { return new BillingFreeDays(this.prisma, this, this.lifecycle); }
  get repeater() { return new BillingRepeat(this.prisma, this.stripe, this, this.lifecycle); }
  get collection() { return new BillingCollection(this.prisma, this.stripe, this); }
  get priceReturn() { return new BillingPriceReturn(this.prisma, this.stripe, this); }
  get dealSubscriptionCancel() { return new BillingDealSubscriptionCancel(this.prisma, this.stripe, this); }
  /** Phase 7: what a customer confirming a plan change sees — the menus the target package opens
   *  and closes once the change takes effect. */
  withPlanMenuImpact<T extends { targetOffer?: BillingOffer }>(companyId: string, operation: T): Promise<T> {
    return planMenuImpact(this.prisma.client, companyId, operation);
  }

  async assertTaxSettings(policy: BillingPolicy) {
    if (policy.taxTreatment === 'NOT_VAT_REGISTERED') return;
    if (!policy.issuer || !policy.taxRateId) throw billingError('CONTROL_ISSUER_REQUIRED', 'กรุณาระบุข้อมูลกิจการและเลขภาษีที่ตั้งค่าใน Stripe');
    const account = await this.stripe.request('GET', '/account');
    const tax = await this.stripe.request('GET', `/tax_rates/${policy.taxRateId}`);
    const id = await this.stripe.request('GET', `/tax_ids/${policy.issuer.stripeTaxId}`);
    if (account.id !== this.stripe.accountId || !Array.isArray(account.settings?.invoices?.default_account_tax_ids) ||
        !account.settings.invoices.default_account_tax_ids.some((value: unknown) => stripeId(value) === policy.issuer!.stripeTaxId))
      throw billingError('CONTROL_INVOICE_IDENTITY_NOT_READY', 'ตั้งค่าเลขภาษีนี้เป็นค่าเริ่มต้นของเอกสารใน Stripe แล้วตรวจสอบใหม่');
    if (tax.active !== true || tax.country !== 'TH' || tax.percentage !== 7 || tax.inclusive !== (policy.taxTreatment === 'INCLUSIVE_VAT_7') ||
        id.object !== 'tax_id' || id.type !== 'th_vat' || id.value !== policy.issuer.thaiTaxId || id.owner?.type !== 'self' || id.customer != null)
      throw billingError('BILLING_TAX_MISMATCH', 'ข้อมูลภาษีของบัญชี Stripe ไม่ตรงกับนโยบาย');
  }

  async assertOwner(context: RequestContext, tx: Prisma.TransactionClient = this.prisma.client): Promise<void> {
    if (tx !== this.prisma.client) await tx.$queryRaw`
      SELECT m.id FROM "CompanyMembership" m JOIN "MembershipRole" mr ON mr."membershipId" = m.id
      JOIN "Role" r ON r.id = mr."roleId" WHERE m."companyId" = ${context.companyId} AND m."userId" = ${context.userId}
      ORDER BY r.id FOR SHARE OF m, mr, r`;
    const member = await tx.companyMembership.findUnique({
      where: { companyId_userId: { companyId: context.companyId, userId: context.userId } },
      include: {
        user: { select: { status: true } },
        roles: {
          where: { role: { status: 'ACTIVE' } },
          include: { role: { include: { permissions: { select: { permission: { select: { key: true } } } } } } },
        },
      },
    });
    if (!member || member.status !== 'ACTIVE' || member.user.status !== 'ACTIVE' || !canManagePlan(member.roles)) {
      throw new ForbiddenException('ต้องได้รับสิทธิ์จัดการแพ็กเกจบริษัท');
    }
  }

  async settings(tx: Prisma.TransactionClient = this.prisma.client) {
    const stripeAccountId = this.stripe.accountId, livemode = this.stripe.livemode;
    const where = { stripeAccountId_livemode: { stripeAccountId, livemode } };
    let settings = await tx.billingSettings.findUnique({ where });
    if (!settings) {
      // An empty-update Prisma upsert can race on the first read. ON CONFLICT must
      // leave an existing operator's gates, policy and version untouched.
      await tx.billingSettings.createMany({ data: [{ id: `${stripeAccountId}:${livemode ? 'live' : 'test'}`, stripeAccountId, livemode, gatesJson: CLOSED_GATES }], skipDuplicates: true });
      settings = await tx.billingSettings.findUniqueOrThrow({ where });
    }
    const revision = settings.policyRevisionId ? await tx.billingPolicyRevision.findUnique({ where: { id: settings.policyRevisionId } }) : null;
    let policy:BillingPolicy|null=null;
    if(revision&&revision.stripeAccountId===stripeAccountId&&revision.livemode===livemode&&revision.state==='ACTIVE') {
      try{policy=parseBillingPolicy(revision.policyJson);}catch(error){if(!(error instanceof BadRequestException))throw error;}
    }
    return { settings, revision: policy ? revision : null, policy, gates: effectiveBillingGates(settings.gatesJson),
      // Lenient (promotion plan R1): a campaign that does not parse is not admissible and never closes sales.
      promotions: policy ? parsePromotionCampaignsLenient(revision!.promotionJson) : {} };
  }

  async account(companyId: string, tx: Prisma.TransactionClient = this.prisma.client): Promise<BillingAccount | null> {
    if (!this.config.stripeAccountId) return null;
    return tx.billingAccount.findUnique({ where: { companyId_stripeAccountId_livemode: {
      companyId, stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode,
    } } });
  }

  async purchaseSource(company: { planTerm: Parameters<typeof billingPurchaseSource>[0] }, account: BillingAccount | null,
    tx: Prisma.TransactionClient = this.prisma.client): Promise<BillingPurchaseSource> {
    // CARD_AUTO without a subscription = SD-O13's paid first period still binding, the same window as PROMPTPAY_RENEW.
    const attemptBound = !!account?.contractAttemptId && (!account.baseSubscriptionId &&
      ['CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW', 'CARD_AUTO'].includes(account.renewalMode));
    const paid = account ? await tx.billingInvoice.findFirst({ where: { billingAccountId: account.id, providerStatus: 'paid',
      ...(attemptBound ? { sourceAttemptId: account.contractAttemptId!, applyStatus: 'APPLIED', appliedAt: { not: null },
        // A refund-ended package (billing-end-package.ts) cut paidThrough below its refunded invoice's period.
        // Promotion plan R2: the invoice's service end (`benefitEnd ?? periodEnd`) is what equals paidThrough.
        ...(account.paidThrough ? { OR: [invoiceServiceEndsAt(account.paidThrough),
          { refundedSatang: { gt: 0 }, OR: [{ periodEnd: { gt: account.paidThrough } }, { benefitEnd: { gt: account.paidThrough } }] }] } : {}) } : {}) }, select: { id: true } }) : null;
    return billingPurchaseSource(company.planTerm, account, !!paid);
  }

  async catalog(): Promise<BillingCatalog> {
    const state = this.stripe.enabled ? await this.settings() : null;
    const offers = BILLING_PAID_TIERS
      .flatMap((tier) => (['month', 'year'] as const).map((interval) => {
        const offer = billingOffer(tier, interval, state?.policy);
        // Phase 6: ENTERPRISE is no longer excluded here. The price binding below is the gate —
        // an unbound tier stays COMING_SOON, a bound one is sold like every other package.
        if (state?.policy && state.policy.salesCompanyIds?.length !== 0 && state.gates.new_sales &&
            state.policy.priceIds[`${tier}:${interval}`]) {
          try { assertPolicyReady(state.policy); offer.availability = 'AVAILABLE'; offer.reason = null; } catch { /* Draft remains unavailable. */ }
        }
        return offer;
      }));
    const generatedAt = new Date();
    // Announceable terms of campaigns open now (promotion spec §6 "Public catalog"): no company, usage, cap or id.
    const signatures = state?.policy ? promotionSignatures(offers, state.policy.taxTreatment) : {};
    const promotions = Object.values(state?.promotions ?? {}).filter(campaign => promotionCampaignStatus(campaign, generatedAt, signatures) === 'ACTIVE')
      .flatMap(campaign => campaign.rules.map(rule => ({ displayName: campaign.displayName, offerKey: rule.offerKey, interval: rule.interval,
        bonusMonths: rule.bonusMonths, bonusReceiptUnits: rule.bonusReceiptUnits, totalMonths: (rule.interval === 'year' ? 12 : 1) + rule.bonusMonths,
        totalReceiptUnits: offers.find(offer => offer.offerKey === rule.offerKey && offer.interval === rule.interval)!.receiptAllowance + rule.bonusReceiptUnits,
        endsAt: campaign.endsAt })));
    return { schemaVersion: 1, mode: this.stripe.enabled ? (this.stripe.livemode ? 'LIVE' : 'TEST') : 'DISABLED', policyRevision: state?.revision?.id ?? null,
      catalogRevision: hashBilling([state?.settings.version ?? 0, state?.revision?.id ?? null, offers, state?.policy?.taxTreatment ?? null]),
      generatedAt: generatedAt.toISOString(), validUntil: new Date(generatedAt.getTime() + 30_000).toISOString(), taxTreatment: state?.policy?.taxTreatment ?? null,
      // R1: no `trial` block any more — a new shop gets no free days, so advertising them here
      // would be the page promising what provisioning refuses to grant (Owner 2026-09-20).
      offers, aiMonthlyBudgetSatang: this.config.aiMonthlyBudgetSatang, ...(promotions.length ? { promotions } : {}) };
  }

  async usage(companyId: string): Promise<BillingStatus['usage']> {
    const { monthKey, resetsAt } = billingMonth();
    const quota = await receiptQuotaSnapshot(this.prisma, companyId, monthKey);
    const used = quota.usedCount, limit = quota.planLimit;
    return { used, limit, remaining: limit === null ? null : Math.max(0, limit - used),
      resetsAt: quota.cadence ? null : resetsAt, cadence: quota.cadence ?? 'LEGACY_MONTH', expiresAt: quota.expiresAt ?? null,
      ...(quota.monthlyAllowance ? { monthlyAllowance: quota.monthlyAllowance } : {}) };
  }

  /** Sales-event spec §7.1 (SD-B): the caller's own ส่วนลดจากงาน and which way this shop could use one.
   *  Allowlisted in the auth guard, so a shop with no package or an expired one can read it. */
  async eventDiscount(context: RequestContext): Promise<BillingEventDiscountView> {
    await this.assertOwner(context);
    const company = await this.prisma.client.company.findUnique({ where: { id: context.companyId }, select: { planTerm: true } });
    const account = await this.account(context.companyId);
    const source = await this.purchaseSource({ planTerm: company?.planTerm ?? null }, account);
    // Read as status() reads it (a subscription under a NONE column is a card charged by itself), so LINE and the package page say the same of how this shop renews.
    const renewalMode = (account?.renewalMode !== 'NONE' ? account?.renewalMode : account?.baseSubscriptionId ? 'CARD_AUTO' : 'NONE') as BillingStatus['renewalMode'];
    return { path: eventDiscountPath(source, renewalMode), renewalMode, renewalState: eventDiscountRenewalState(account), tickets: await holderEventDiscountTickets(this.prisma.client, context.userId, new Date()) };
  }

  /** LINE "ฉันมีส่วนลดไหม" (sales-event spec §8.1): the same owner-only read, plus why this shop may not take the discount
   *  now (a deal, or only tickets from events it already used — SD-O12) — the package page's own rules. */
  async lineEventDiscount(context: RequestContext): Promise<BillingEventDiscountView & { block: 'DEAL_ACTIVE' | 'EVENT_ALREADY_USED' | null }> {
    const view = await this.eventDiscount(context);
    return { ...view, block: view.path === 'DISCOUNT' ? await eventDiscountHolderBlock(this.prisma.client, { userId: context.userId, companyId: context.companyId, now: new Date() }) : null };
  }

  async capacity(context: RequestContext, offerKey: string, interval: string) {
    paidVariant(offerKey, interval);
    return this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, context.companyId); await this.assertOwner(context, tx);
      const company = await tx.company.findUniqueOrThrow({ where: { id: context.companyId }, include: { planTerm: true } });
      if (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))
        throw billingError('BILLING_COMPANY_HELD', 'บริษัทอยู่ระหว่างตรวจสอบ กรุณาติดต่อทีมงาน');
      const state=await this.settings(tx),account=await this.account(context.companyId,tx);
      const {offer}=paidVariant(offerKey,interval,state.policy);
      return capacityOptions(tx, context.companyId, purchasedCapacityOffer(offer,company.planTerm,account));
    });
  }

  async repairCapacity(context: RequestContext, attemptId: string, expectedVersion: number, value: unknown, key: string) {
    if (!/^[a-zA-Z0-9_-]{16,120}$/.test(key) || !Number.isInteger(expectedVersion)) throw capacityReview();
    const selection = parseCapacitySelection(value), requestHash = hashBilling([attemptId, expectedVersion, selection]);
    return this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, context.companyId); await this.assertOwner(context, tx);
      const account = await this.account(context.companyId, tx);
      if (!account) throw new NotFoundException();
      const prior = await tx.billingOperation.findUnique({ where: { stripeAccountId_livemode_idempotencyKey: {
        stripeAccountId: account.stripeAccountId, livemode: account.livemode, idempotencyKey: key } } });
      if (prior) {
        if (prior.type !== 'CUSTOMER_CAP_SELECTION_REPAIR' || prior.companyId !== context.companyId || prior.initiatorUserId !== context.userId || prior.requestHash !== requestHash) throw capacityReview();
        return { operationId: prior.id, queued: true };
      }
      const attempt = await tx.billingAttempt.findFirst({ where: { id: attemptId, billingAccountId: account.id } });
      const snapshot = attempt?.quoteSnapshot as unknown as BillingSnapshot | undefined;
      const invoice = await tx.billingInvoice.findFirst({ where: { billingAccountId: account.id, sourceAttemptId: attemptId, providerStatus: 'paid',
        applyStatus: 'HELD', errorCode: 'BILLING_CAP_SELECTION_REQUIRED', appliedAt: null } });
      const company = await tx.company.findUniqueOrThrow({ where: { id: context.companyId }, include: { planTerm: true } });
      if (!attempt || !snapshot || snapshot.repeat || !invoice || account.activeAttemptId !== attemptId || attempt.version !== expectedVersion ||
        (account.leaseUntil && account.leaseUntil > new Date()) || account.activeCollectionOperationId ||
        (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))) throw capacityReview();
      const options = await capacityOptions(tx, context.companyId, snapshot.quote.offer);
      if (!capacityValid(options, selection)) throw capacityReview();
      const row = await tx.billingOperation.create({ data: { companyId: context.companyId, stripeAccountId: account.stripeAccountId, livemode: account.livemode,
        type: 'CUSTOMER_CAP_SELECTION_REPAIR', state: 'SUCCEEDED', referenceId: attempt.id, sourceVersion: attempt.version,
        proposedJson: { accountId: account.id, attemptId: attempt.id, offerHash: hashBilling(snapshot.quote.offer), selection: selection as unknown as Prisma.InputJsonValue },
        reason: 'owner_confirmed_paid_capacity_repair', initiatorUserId: context.userId, idempotencyKey: key, requestHash, expiresAt: new Date(Date.now()+600000), observedAt: new Date() } });
      await tx.billingAttempt.update({ where: { id: attempt.id }, data: { version: { increment: 1 } } });
      await tx.billingAccount.update({ where: { id: account.id }, data: { nextReconcileAt: new Date(), version: { increment: 1 } } });
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'billing.capacity.repair.confirmed', targetType: 'BillingOperation',
        targetId: row.id, requestId: context.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { attemptId, invoiceId: invoice.id, sourceHash: selection.sourceHash } } });
      return { operationId: row.id, queued: true };
    });
  }

  async repairPlanCapacity(context: RequestContext, id: string, expectedVersion: number, value: unknown, key: string) {
    if (!/^[a-zA-Z0-9_-]{16,120}$/.test(key) || !Number.isInteger(expectedVersion)) throw capacityReview();
    const selection = parseCapacitySelection(value), requestHash = hashBilling([id, expectedVersion, selection]);
    return this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, context.companyId); await this.assertOwner(context, tx);
      const account = await this.account(context.companyId, tx);
      if (!account) throw new NotFoundException();
      const prior = await tx.billingOperation.findUnique({ where: { stripeAccountId_livemode_idempotencyKey: {
        stripeAccountId: account.stripeAccountId, livemode: account.livemode, idempotencyKey: key } } });
      if (prior) {
        if (prior.type !== 'CUSTOMER_CAP_SELECTION_REPAIR' || prior.companyId !== context.companyId || prior.initiatorUserId !== context.userId || prior.requestHash !== requestHash) throw capacityReview();
        return { operationId: prior.id, queued: true };
      }
      const pending = await pendingChange(tx, account), company = await tx.company.findUniqueOrThrow({ where: { id: context.companyId }, include: { planTerm: true } });
      const prepaid = pending?.row.type === 'CUSTOMER_PREPAID_PLAN_CHANGE';
      const invoice = prepaid && pending ? await tx.billingInvoice.findFirst({ where: { id: pending.proposed.prepaidInvoiceId,
        billingAccountId: account.id, providerStatus: 'paid', applyStatus: 'APPLIED', refundedSatang: 0, disputed: false,
        appliedAt: { not: null } } }) : await tx.billingInvoice.findFirst({ where: { billingAccountId: account.id,
        providerStatus: 'paid', applyStatus: 'HELD', errorCode: 'BILLING_CAP_SELECTION_REQUIRED',
        contractSnapshot: { path: ['planChangeId'], equals: id }, appliedAt: null } });
      if (!pending || pending.row.id !== id || pending.row.version !== expectedVersion || !invoice || account.activeAttemptId || account.activeCollectionOperationId ||
        (prepaid && (pending.row.state !== 'BLOCKED' || pending.row.errorCode !== 'BILLING_CAP_SELECTION_REQUIRED')) ||
        (account.leaseUntil && account.leaseUntil > new Date()) || (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))) throw capacityReview();
      if (!capacityValid(await capacityOptions(tx, account.companyId, pending.proposed.snapshot.quote.offer), selection)) throw capacityReview();
      const row = await tx.billingOperation.create({ data: { companyId: account.companyId, stripeAccountId: account.stripeAccountId, livemode: account.livemode,
        type: 'CUSTOMER_CAP_SELECTION_REPAIR', state: 'SUCCEEDED', referenceId: id, sourceVersion: expectedVersion,
        proposedJson: { accountId: account.id, attemptId: id, offerHash: hashBilling(pending.proposed.snapshot.quote.offer), selection: selection as unknown as Prisma.InputJsonValue },
        reason: 'owner_confirmed_paid_plan_change_capacity', initiatorUserId: context.userId, idempotencyKey: key, requestHash,
        expiresAt: new Date(Date.now()+600000), observedAt: new Date() } });
      await tx.billingOperation.update({ where: { id }, data: { version: { increment: 1 } } });
      await tx.billingAccount.update({ where: { id: account.id }, data: { nextReconcileAt: new Date(), version: { increment: 1 } } });
      await tx.auditLog.create({ data: { companyId: account.companyId, actorUserId: context.userId, action: 'billing.capacity.repair.confirmed',
        targetType: 'BillingOperation', targetId: row.id, requestId: context.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { planChangeId: id, invoiceId: invoice.id, sourceHash: selection.sourceHash } } });
      return { operationId: row.id, queued: true };
    });
  }

  async quote(context: RequestContext, body: { offerKey?: string; interval?: string; billingEmail?: string; capacity?: unknown; purchaseMode?: BillingPurchaseMode; purchaseIntent?: 'FULL_PACKAGE'; dealId?: string;
    eventDiscountChoice?: 'USE' | 'DECLINE'; eventDiscountTicketSerial?: string;
    /** Promotion spec Q4: the one benefit this purchase takes. Absent = the behaviour before promotions; never PROMOTION. */
    benefitChoice?: BillingBenefitChoice; promotionCampaignId?: string }): Promise<BillingQuote> {
    await this.assertOwner(context);
    const purchaseMode = body.purchaseMode ?? 'CARD_AUTO';
    assertPurchaseMode(purchaseMode);
    // A deal is priced from its own APPROVED row, never from the body: the base tier and the
    // one-month interval come from the snapshot, so `offerKey`/`interval` cannot redirect it (S36).
    const dealRow = body.dealId ? await this.prisma.client.packageChangeRequest.findFirst({ where: { id: body.dealId, kind: DEAL_KIND } }) : null;
    const deal = body.dealId ? assertDealSnapshot(dealRow, context.companyId, new Date()) : null;
    // D-P5-4: a deal is payable only on the family its own snapshot sells. An auto-renewing deal
    // pins a recurring Price, so a one-time Checkout would charge the cycle price once and leave
    // the shop with no subscription at all.
    const auto = autoRenewOf(deal);
    if (deal && (auto.autoRenew ? oneTimeMode(purchaseMode) : !oneTimeMode(purchaseMode)))
      throw billingError('BILLING_MODE_NOT_READY', 'วิธีชำระเงินนี้ยังไม่เปิดให้บริการ');
    const { tier, interval } = deal ? { tier: deal.base, interval: auto.cadence ?? 'month' } : paidVariant(body.offerKey, body.interval);
    if (!this.stripe.enabled) throw billingError('BILLING_NOT_READY', 'ระบบชำระเงินยังไม่เปิดให้บริการ');
    const state = await this.settings();
    if (!state.policy || !state.revision || !state.gates.new_sales) throw billingError('BILLING_SALES_CLOSED', 'ยังไม่เปิดรับชำระเงินใหม่');
    if (!state.gates[gateForMode(purchaseMode)]) throw billingError('BILLING_MODE_NOT_READY', 'วิธีชำระเงินนี้ยังไม่เปิดให้บริการ');
    assertCompanyCanBuy(state.policy, context.companyId);
    assertPolicyReady(state.policy);
    const catalogOffer = billingOffer(tier, interval, state.policy);
    let offer = deal ? dealOffer(deal) : catalogOffer;
    if (state.policy.paidStart !== 'IMMEDIATE') throw billingError('CONTROL_POLICY_NOT_SUPPORTED', 'การเริ่มสมาชิกต้องชำระทันทีตามนโยบายปัจจุบัน');
    const priceId = state.policy.priceIds[`${tier}:${interval}`];
    if (!priceId) throw billingError('BILLING_OFFER_UNAVAILABLE', 'แพ็กเกจนี้ยังไม่เปิดรับชำระเงิน');
    // R-A1/R-A6: neither an account email nor an address is required to buy. The body's `billingEmail`
    // stays accepted for cached clients and is ignored; the quote derives the recipient itself.
    const emailState = await accountEmailState(this.prisma.client, context.userId);
    const verifiedAccountEmail = emailState.requirement === 'READY' ? emailState.user.email!.trim().toLowerCase() : null;
    const company = await this.prisma.client.company.findUnique({ where: { id: context.companyId }, include: { planTerm: true } });
    if (!company) throw new NotFoundException();
    const term = company.planTerm;
    const billingProfile = companyBillingProfile(company);
    if (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && term?.termDisabledAt)) throw billingError('BILLING_COMPANY_HELD', 'บริษัทอยู่ระหว่างตรวจสอบ กรุณาติดต่อทีมงาน');
    const existing = await this.account(company.id);
    // R-A2: the current document recipient first, then the buyer's verified account email; null = Checkout asks.
    const recipientEmail = existing?.recipientEmail ?? verifiedAccountEmail;
    // Q7: a live CARD_AUTO subscription may convert only after the deal payment applies. The
    // snapshot freezes the exact subscription, so Checkout cannot turn a changed account into a
    // second charge; the reconciler then journals and retries the provider cancellation.
    const convertingDeal = !!deal && canConvertDealSubscription(existing);
    const advanceDealEligible = !!deal && auto.autoRenew && !!existing?.paidThrough && existing.paidThrough > new Date() &&
      oneTimeMode(existing.renewalMode as BillingPurchaseMode) && !existing.baseSubscriptionId;
    if (deal && existing?.baseSubscriptionId && existing.paidThrough && existing.paidThrough > new Date() && !convertingDeal)
      throw billingError('CONTROL_DEAL_SUBSCRIPTION_REVIEW', 'ร้านนี้มีสมาชิกที่ยังใช้งานอยู่ ทีมงานจะติดต่อกลับ');
    if (existing?.renewalMode === 'PROMPTPAY_RENEW' && existing.paidThrough && existing.paidThrough > new Date())
      throw billingError('BILLING_PLAN_CHANGE_REQUIRED', 'สมาชิก QR ที่กำลังใช้งานต้องจัดการบิลหรือรอสิ้นรอบก่อนซื้อแพ็กเกจใหม่');
    if (purchaseMode === 'PROMPTPAY_RENEW' && existing?.paidThrough && existing.paidThrough > new Date() && !advanceDealEligible)
      throw billingError('BILLING_MODE_CHANGE_PENDING', 'กรุณารอให้แพ็กเกจปัจจุบันสิ้นสุดก่อนเริ่มต่ออายุด้วย QR');
    if (!convertingDeal && !advanceDealEligible && existing?.paidThrough && existing.paidThrough > new Date() && existing.renewalMode !== 'NONE' &&
        (oneTimeMode(purchaseMode) !== oneTimeMode(existing.renewalMode as BillingPurchaseMode)))
      throw billingError('BILLING_MODE_CHANGE_PENDING', 'กรุณารอให้แพ็กเกจปัจจุบันสิ้นสุดก่อนเปลี่ยนวิธีต่ออายุ');
    // Preserve the existing pending-checkout contract while a paid invoice is HELD before apply;
    // its term link is intentionally incomplete until reconciliation commits.
    if (existing?.activeAttemptId) throw billingError('BILLING_EXISTING_SUBSCRIPTION', 'มีรายการเดิมอยู่แล้ว กรุณาตรวจสถานะหรือจัดการสมาชิก');
    if (existing?.pendingPlanChangeId && oneTimeMode(existing.renewalMode as BillingPurchaseMode))
      throw billingError('BILLING_PLAN_CHANGE_PENDING', 'มีแพ็กเกจที่ชำระล่วงหน้ารอเริ่มใช้งาน กรุณาตรวจรายการเดิม');
    // Promotion spec Q5: an immediate upgrade over a promotion purchase waits; said before any source review code.
    const deferral = existing && !deal ? await promotionUpgradeDeferral(this.prisma.client, existing) : null;
    if (deferral && (body.purchaseIntent === 'FULL_PACKAGE' || isUpgrade(deferral.offer, catalogOffer))) throw promotionUpgradeDeferred(deferral.until);
    const purchaseSource = await this.purchaseSource(company, existing);
    if (purchaseSource === 'PAID_OTHER_MODE' || purchaseSource === 'SOURCE_INCONSISTENT')
      throw billingError('BILLING_SOURCE_REVIEW_REQUIRED', 'ข้อมูลการชำระเงินเดิมไม่ตรงกัน กรุณาติดต่อทีมงานก่อนเริ่มรายการใหม่');
    // R-A5: no Customer email comparison here any more. Checkout re-reads the Customer binding, and a
    // recipient changed since this quote is BILLING_QUOTE_STALE against the column, not Stripe.
    if (!deal) offer = purchasedCapacityOffer(offer, term, existing);
    if(existing)await assertNoPendingRefund(this.prisma.client,existing);
    if (existing && (existing.activeEmailOperationId || await pendingAdminRecipientChange(this.prisma.client, existing)))
      throw billingError('BILLING_EMAIL_UPDATE_PENDING', 'กรุณาตรวจรายการเปลี่ยนผู้รับเอกสารให้เสร็จก่อน');
    if (existing?.activeCollectionOperationId) throw billingError('BILLING_COLLECTION_PENDING', 'กรุณาตรวจคำสั่งต่ออายุเดิมให้เสร็จก่อนซื้อเพิ่ม');
    await this.stripe.assertAccount();
    let subscriptionConversion: BillingSnapshot['subscriptionConversion'];
    if (convertingDeal) {
      const subscription = await this.stripe.request('GET', `/subscriptions/${existing!.baseSubscriptionId}`);
      if (subscription.id !== existing!.baseSubscriptionId || subscription.object !== 'subscription' || subscription.livemode !== existing!.livemode ||
          stripeId(subscription.customer) !== existing!.customerId || subscription.metadata?.billingAccountId !== existing!.id || subscription.status !== 'active')
        throw billingError('CONTROL_DEAL_SUBSCRIPTION_REVIEW', 'สมาชิกเดิมเปลี่ยนสถานะ กรุณาตรวจสอบใหม่');
      await this.repeater.assertNoDebt(existing!, await this.stripe.list('/invoices', { subscription: existing!.baseSubscriptionId }));
      subscriptionConversion = { subscriptionId: existing!.baseSubscriptionId!, paidThrough: existing!.paidThrough!.toISOString() };
    }
    const price = await this.stripe.request('GET', `/prices/${priceId}`);
    // A deal's price is its own; the catalog Price is read only for the product the line item bills.
    assertStripePrice(price, deal ? catalogOffer : offer, state.policy, this.stripe.livemode, priceId);
    const productId = stripeId(price.product);
    if (!productId) throw billingError('BILLING_PRICE_MISMATCH', 'ข้อมูลราคาไม่ตรงกัน กรุณาติดต่อทีมงาน');
    // D-P5-3/D-P5-4: an auto-renewing deal bills its OWN recurring Price, created at approval on
    // the base tier's catalog product. The catalog Price above stays the product source only.
    let snapshotPriceId = priceId;
    if (auto.autoRenew) {
      if (dealRow!.priceState !== 'READY' || !dealRow!.stripePriceId)
        throw billingError('SALES_DEAL_PRICE_PENDING', 'กำลังเตรียมราคาใน Stripe ลองใหม่ในอีกสักครู่');
      const dealPrice = await this.stripe.request('GET', `/prices/${dealRow!.stripePriceId}`);
      assertStripePrice(dealPrice, offer, state.policy, this.stripe.livemode, dealRow!.stripePriceId);
      if (stripeId(dealPrice.product) !== productId) throw billingError('BILLING_PRICE_MISMATCH', 'ข้อมูลราคาไม่ตรงกัน กรุณาติดต่อทีมงาน');
      snapshotPriceId = dealRow!.stripePriceId;
    }
    await this.assertTaxSettings(state.policy);
    const restart = existing?.baseSubscriptionId && existing.paidThrough && existing.paidThrough <= new Date() ? await restartSource(this.prisma, this.stripe, existing) : undefined;
    if (paymentCheckoutMode(purchaseMode) && existing?.baseSubscriptionId && !restart && !convertingDeal)
      throw billingError('BILLING_MODE_CHANGE_PENDING', 'กรุณายุติสมาชิกเดิมและรอให้สิทธิ์สิ้นสุดก่อนซื้อครั้งเดียว');
    if (oneTimeMode(existing?.renewalMode as BillingPurchaseMode) && !existing?.contractAttemptId)
      throw billingError('BILLING_PACKAGE_STATE_INVALID', 'ข้อมูลแพ็กเกจเดิมต้องตรวจสอบ กรุณาติดต่อทีมงาน');
    const previous = existing?.renewalMode === 'CARD_ONCE' || existing?.renewalMode === 'PROMPTPAY_ONCE'
      ? await this.prisma.client.billingInvoice.findFirst({ where: { billingAccountId: existing.id, sourceAttemptId: existing.contractAttemptId!,
        providerStatus: 'paid', applyStatus: 'APPLIED', appliedAt: { not: null } }, orderBy: { createdAt: 'desc' } }) : null;
    const previousSnapshot = previous?.contractSnapshot as BillingSnapshot | null;
    const advanceDeal = advanceDealEligible ? (() => {
      if (!previous || !previousSnapshot || !oneTimeSourceReady(existing, previous) || !existing.contractAttemptId ||
          existing.pendingPlanChangeId || existing.termProjectionHash !== termProjectionHash(term))
        throw billingError('BILLING_PACKAGE_STATE_INVALID', 'ข้อมูลแพ็กเกจเดิมต้องตรวจสอบ กรุณาติดต่อทีมงาน');
      return { invoiceId: previous.id, contractAttemptId: existing.contractAttemptId,
        paidThrough: existing.paidThrough!.toISOString(), anchorDay: existing.billingAnchorDay,
        firstCycleEndsAt: appendPackageInterval(existing.paidThrough!, interval, existing.billingAnchorDay).toISOString() };
    })() : undefined;
    let upgrade: UpgradeSource | undefined, oneTimeChange: BillingSnapshot['oneTimeChange'];
    const oneTime = !convertingDeal && oneTimeMode(purchaseMode) && existing?.paidThrough && existing.paidThrough > new Date() ? (() => {
      if (!previous || !previousSnapshot || !oneTimeSourceReady(existing, previous))
        throw billingError('BILLING_PACKAGE_STATE_INVALID', 'ข้อมูลแพ็กเกจเดิมต้องตรวจสอบ กรุณาติดต่อทีมงาน');
      const currentOffer = previousSnapshot.quote.offer;
      // §19.3: a deal appends after the running one-time term whatever tier it was, at its own
      // price and limits — it is never a catalog upgrade or a scheduled catalog change.
      if (!deal && (currentOffer.offerKey !== offer.offerKey || currentOffer.interval !== offer.interval)) {
        if (!state.gates.plan_changes) throw billingError('BILLING_REPEAT_NOT_READY', 'การเปลี่ยนแพ็กเกจยังไม่เปิดให้บริการ');
        if (isUpgrade(currentOffer, offer)) oneTimeChange = undefined;
        else {
          if (BILLING_PAID_TIERS.indexOf(catalogOffer.offerKey as typeof BILLING_PAID_TIERS[number]) <
              BILLING_PAID_TIERS.indexOf(currentOffer.offerKey as typeof BILLING_PAID_TIERS[number])) offer = catalogOffer;
          oneTimeChange = { effectiveAt: existing.paidThrough.toISOString(), currentOffer };
        }
      }
      return { invoiceId: previous.id, paidThrough: existing.paidThrough.toISOString(), anchorDay: existing.billingAnchorDay,
        offerKey: currentOffer.offerKey, interval: currentOffer.interval };
    })() : undefined;
    const fullPackageUpgrade = body.purchaseIntent === 'FULL_PACKAGE';
    if (fullPackageUpgrade && (deal || !oneTime || !previousSnapshot || previousSnapshot.deal ||
        !isUpgrade(previousSnapshot.quote.offer, offer) || oneTimeChange))
      throw billingError('BILLING_PACKAGE_STATE_INVALID', 'ซื้อแพ็กเต็มเพิ่มได้เฉพาะแพ็กจ่ายครั้งเดียวที่ยังใช้งานอยู่และระดับสูงกว่าในรอบเดียวกัน');
    if (!fullPackageUpgrade && !deal && oneTime && !oneTimeChange && previousSnapshot && isUpgrade(previousSnapshot.quote.offer, offer)) {
      const history = await upgradeHistory(this.prisma.client, existing!, offer, state.policy, new Date(Math.floor(Date.now()/1000)*1000).toISOString());
      if (history.segments.at(-1)!.oldOffer.offerKey !== term?.tierKey || Date.parse(history.segments[0]!.end) <= Date.now()+2401000)
        throw billingError('BILLING_UPGRADE_BOUNDARY', 'ใกล้วันเปลี่ยนรอบแล้ว กรุณาตรวจสถานะใหม่หลังเปลี่ยนรอบหรือติดต่อทีมงาน');
      const preview = await upgradePreview(this.stripe, history.amountSatang, state.policy);
      upgrade = { ...history, previewId: preview.previewId, previewHash: preview.previewHash };
    }
    const capacity = body.capacity === undefined ? undefined : parseCapacitySelection(body.capacity);
    let capacityPreview: BillingQuote['capacity'];
    if (capacity) {
      if (deal || (existing?.baseSubscriptionId && !restart) || (oneTime && !oneTimeChange)) throw capacityReview();
      const options = await this.capacity(context, offer.offerKey, offer.interval);
      if (!capacityValid(options, capacity)) throw capacityReview();
      capacityPreview = capacityImpact(options, capacity);
      // S45: a deal skips the capacity review. Limits below current usage mean "no new branches
      // or users" (P29 §4D); nothing existing is suspended, and the team saw the warning already.
    } else if (!deal && ((!existing?.baseSubscriptionId || restart) && !oneTime || oneTimeChange) && !await restartFits(this.prisma.client, company.id, offer)) throw capacityReview();
    if (existing?.baseSubscriptionId && !restart && !convertingDeal && !state.gates.plan_changes) throw billingError('BILLING_REPEAT_NOT_READY', 'การซื้อแพ็กเกจซ้ำยังไม่เปิดให้บริการ');
    let repeat: RepeatSource | undefined;
    if (existing?.baseSubscriptionId && !restart && purchaseMode === 'CARD_AUTO') {
      const accepted = (await collectionContract(this.prisma.client, existing)).current;
      if (accepted && isUpgrade(accepted.quote.offer, offer)) {
        const oldPrice = await this.stripe.request('GET', `/prices/${accepted.priceId}`);
        repeat = await this.repeater.source(existing, accepted.quote.offer, state.policy, oldPrice);
        const targetZero = state.policy.zeroPriceIds?.[`${tier}:${interval}`];
        if (!targetZero) throw billingError('BILLING_REPEAT_NOT_READY', 'การเปลี่ยนแพ็กเกจยังไม่เปิดให้บริการ กรุณาติดต่อทีมงาน');
        const zero = await this.stripe.request('GET', `/prices/${targetZero}`);
        assertStripePrice(zero, { ...offer, priceSatang: 0 }, state.policy, existing.livemode, targetZero);
        const productId = stripeId(price.product);
        if (!productId || stripeId(zero.product) !== productId) throw billingError('BILLING_PRICE_MISMATCH', 'ข้อมูลราคาไม่ตรงกัน กรุณาติดต่อทีมงาน');
        const history = await upgradeHistory(this.prisma.client, existing, offer, state.policy, new Date(Math.floor(Date.now()/1000)*1000).toISOString());
        if (history.segments[0]!.oldOffer.offerKey !== term?.tierKey || Date.parse(history.segments[0]!.end) <= Date.now()+2401000)
          throw billingError('BILLING_UPGRADE_BOUNDARY', 'ใกล้วันเปลี่ยนรอบแล้ว กรุณาตรวจสถานะใหม่หลังเปลี่ยนรอบหรือติดต่อทีมงาน');
        const preview = await upgradePreview(this.stripe, history.amountSatang, state.policy);
        upgrade = { ...history, previewId: preview.previewId, previewHash: preview.previewHash };
        repeat = { ...repeat, productId, zeroPriceId: targetZero };
      } else repeat = await this.repeater.source(existing, offer, state.policy, price);
    }
    // Phase 6: a catalog purchase grants the purchased tier's menus, not the starter preset every
    // tier used to get, and the plan is pinned so the apply cannot drift from it. A deal still
    // carries its own set. Phase 7 adds the mid-term change: the menus move when the change takes
    // effect, not when it is paid, so the plan is NOT pinned there — the quote shows the two lists
    // and `movePlanMenus` rebuilds the plan at the boundary. Display only, so a shop whose menu
    // rows still need a team review can still buy. A RESTART pins like a first purchase: the term
    // already ended, so the package being bought now is the only thing deciding the menus.
    const featurePinned = !!deal || fullPackageUpgrade || packageMenuPurchaseSource(purchaseSource);
    const featurePreview = featurePinned
      ? await billingFeaturePlan(this.prisma.client, company.id, deal ? deal.featureKeys : TIER_FEATURE_PRESETS[tier])
      : upgrade || oneTimeChange ? await billingFeaturePlan(this.prisma.client, company.id, TIER_FEATURE_PRESETS[tier]).catch(() => null) : null;
    const quoteId = randomUUID();
    const quote: BillingQuote = { quoteId, companyId: company.id, companyName: company.name, policyRevision: state.revision.id,
      purchaseMode,
      expiresAt: new Date(Date.now() + 600_000).toISOString(), offer: { ...offer, availability: 'AVAILABLE', reason: null },
      ...quoteTotals(upgrade?.amountSatang ?? offer.priceSatang, state.policy.taxTreatment), taxTreatment: state.policy.taxTreatment!, consentRevision: state.policy.consentRevision,
      paidStart: state.policy.paidStart!, billingEmail: recipientEmail, billingProfile,
      trialEndsAt: term?.tierKey === 'FREE_TRIAL_15' && term.termEndsAt > new Date() ? term.termEndsAt.toISOString() : null,
      previousSource: purchaseSource, previousTermEndsAt: term?.termEndsAt.toISOString() ?? null,
      ...(featurePreview ? { featureImpact: featurePreview.impact } : {}),
      ...(deal ? { deal: { dealId: dealRow!.id, months: deal.months, description: deal.description, baseLabel: catalogOffer.label } } : {}),
      usage: await this.usage(company.id) };
    if (advanceDeal) quote.advanceDeal = { startsAt: advanceDeal.paidThrough, firstCycleEndsAt: advanceDeal.firstCycleEndsAt,
      nextChargeAt: advanceDeal.firstCycleEndsAt };
    if (capacityPreview) quote.capacity = capacityPreview;
    const impact = fullPackagePurchaseImpact({ tier, interval, offer, verifiedPaidAt: new Date(Math.floor(Date.now() / 1000) * 1000),
      paidThrough: advanceDeal ? new Date(advanceDeal.paidThrough) : repeat ? new Date(repeat.paidThrough) : oneTime ? new Date(oneTime.paidThrough) : null,
      remainingPaidReceipts: repeat || (oneTime && !oneTimeChange) ? quote.usage.remaining ?? 0 : 0, anchorDay: advanceDeal?.anchorDay ?? repeat?.anchorDay ?? oneTime?.anchorDay });
    quote.purchase = { kind: advanceDeal ? 'ADVANCE_DEAL' : fullPackageUpgrade ? 'FULL_PACKAGE_UPGRADE' : oneTimeChange ? 'SCHEDULED_CHANGE' : repeat || oneTime ? 'REPEAT' : restart || purchaseSource === 'PAID_EXPIRED_CURRENT_MODE' ? 'RESTART' : 'INITIAL', previousPaidThrough: advanceDeal?.paidThrough ?? repeat?.paidThrough ?? oneTime?.paidThrough ?? restart?.paidThrough ?? null,
      ...(repeat && repeat.sourceInterval !== interval && !existing?.pendingPlanChangeId ? { previousInterval: repeat.sourceInterval } : {}),
      projectedPaidThrough: advanceDeal?.firstCycleEndsAt ?? impact.paidThrough.toISOString(), receiptUnitsAdded: impact.receiptUnitsAdded,
      projectedRemainingReceipts: impact.remainingReceipts + (advanceDeal || repeat || oneTime ? 0 : (await packageReceiptBalance(this.prisma.client,company.id,null)).remaining) };
    if (upgrade) {
      quote.expiresAt = new Date(Date.parse(upgrade.prorationAt)+600000).toISOString();
      const paidThrough = repeat?.paidThrough ?? oneTime!.paidThrough;
      quote.purchase = { kind: 'UPGRADE', previousPaidThrough: paidThrough, projectedPaidThrough: paidThrough,
        receiptUnitsAdded: upgrade.receiptUnitsAdded, projectedRemainingReceipts: (quote.usage.remaining ?? 0)+upgrade.receiptUnitsAdded };
      quote.upgrade = { prorationAt: upgrade.prorationAt, nextRenewalTotalSatang: quoteTotals(offer.priceSatang, state.policy.taxTreatment).totalSatang,
        segments: upgrade.segments.map(({start,end,amountSatang,receiptUnitsAdded})=>({start,end,amountSatang,receiptUnitsAdded})) };
    }
    // Once this source ends, this is a RESTART with different menus/capacity and payment modes.
    if (oneTime) quote.expiresAt = new Date(Math.min(Date.parse(quote.expiresAt), Date.parse(oneTime.paidThrough))).toISOString();
    const pending = existing && repeat ? await pendingChange(this.prisma.client, existing) : null;
    if (pending) {
      const options = await capacityOptions(this.prisma.client, company.id, pending.proposed.snapshot.quote.offer);
      if (!pending.proposed.change.selection || !capacityValid(options, pending.proposed.change.selection)) throw capacityReview();
      quote.pendingPlanChange = { operationId: pending.row.id, oldEffectiveAt: pending.proposed.paidThrough, newEffectiveAt: quote.purchase!.projectedPaidThrough,
        offer: pending.proposed.snapshot.quote.offer, totalSatang: pending.proposed.snapshot.quote.totalSatang, capacity: capacityImpact(options, pending.proposed.change.selection) };
    }
    const trialCarryover = quote.purchase.kind === 'INITIAL' ? await trialReceiptCarryover(this.prisma.client, company.id) : undefined;
    if (trialCarryover) {
      quote.purchase.trialCarryover = { receiptUnits: trialCarryover.units, expiresAt: quote.purchase.projectedPaidThrough };
      quote.purchase.projectedRemainingReceipts += trialCarryover.units;
    }
    // Sales-event spec §4.3: the best usable ticket for this card; the buyer's choice defaults to USE. The quote's own totals
    // stay the undiscounted charge (the renewal contract); this payment's amounts live in `eventDiscount` (SD-O12: any kind).
    let eventDiscount: EventDiscountSnapshot | undefined;
    // Promotion spec Q4: one benefit per purchase. An explicit choice decides the ticket too — only EVENT_DISCOUNT uses it;
    // PROMOTION and NORMAL record it as declined. No choice = the behaviour before promotions.
    const choice = body.benefitChoice ? body.benefitChoice === 'EVENT_DISCOUNT' ? 'USE' : 'DECLINE' : body.eventDiscountChoice ?? 'USE';
    const serial = choice === 'USE' ? body.eventDiscountTicketSerial : undefined;
    let promotion: BillingPromotionSnapshot | undefined;
    if (body.benefitChoice === 'PROMOTION') {
      // Plan §2 matrix first, then the campaign. Not eligible is an error with its reason — never a quiet NORMAL quote (spec §3).
      const unsupported = promotionUnsupportedPurchase({ purchaseKind: quote.purchase.kind, purchaseMode, hasLiveSubscription: !!existing?.baseSubscriptionId && !restart,
        deal: !!deal, upgrade: !!upgrade || fullPackageUpgrade, scheduledChange: !!oneTimeChange });
      if (unsupported) throw promotionUnavailable(unsupported);
      const eligible = await promotionEligibility(this.prisma.client, { settings: state, companyId: company.id, campaignId: body.promotionCampaignId,
        offer: catalogOffer, tax: state.policy.taxTreatment, now: new Date() });
      if (!eligible.ok) throw promotionUnavailable(eligible.reason);
      promotion = eligible.snapshot;
      // The same service start and anchor day as `impact`; the paid period (`purchase.projectedPaidThrough`, the trial
      // carryover expiry, the price) is untouched — the free time and the bonus receipts are told here only.
      const { paidEnd, benefitEnd } = promotionBoundaries({ serviceStartsAt: impact.serviceStartsAt, interval, anchorDay: oneTime?.anchorDay, bonusMonths: promotion.bonusMonths });
      if (paidEnd.getTime() !== impact.paidThrough.getTime()) throw promotionUnavailable('PURCHASE_KIND_UNSUPPORTED');
      quote.promotion = { campaignId: promotion.campaignId, displayName: promotion.displayName, bonusMonths: promotion.bonusMonths, bonusReceiptUnits: promotion.bonusReceiptUnits,
        totalReceiptUnits: offer.receiptAllowance + promotion.bonusReceiptUnits, paidStart: impact.serviceStartsAt.toISOString(), paidEnd: paidEnd.toISOString(),
        benefitEnd: benefitEnd.toISOString(), expectedNextChargeAt: oneTimeMode(purchaseMode) ? null : benefitEnd.toISOString() };
    }
    if (body.benefitChoice) quote.benefitChoice = body.benefitChoice;
    // Owner 2026-09-29: the buyer may pick which held discount this payment uses; none picked = the best for this card.
    const eventPick = eventDiscountPurchase(quote) ? await eventDiscountOffer(this.prisma.client, { userId: context.userId, companyId: company.id,
      offer: quote.offer, tax: state.policy.taxTreatment, now: new Date(), basisSatang: eventDiscountBasis({ quote, upgrade }), serial }) : null;
    if ((serial || body.benefitChoice === 'EVENT_DISCOUNT') && !eventPick) throw billingError('SALES_EVENT_TICKET_UNAVAILABLE', 'ส่วนลดที่เลือกใช้กับการจ่ายนี้ไม่ได้ กรุณาเลือกส่วนลดอื่นหรือไม่ใช้ครั้งนี้');
    if (eventPick) {
      const { shownDiscountSatang, ...applied } = eventPick.amounts;
      quote.eventDiscount = { choice, ticketSerial: eventPick.ticket.serial, eventName: eventPick.ticket.batch.eventName,
        expiresAt: eventPick.ticket.expiresAt.toISOString(), discountSatang: eventPick.ticket.discountSatang, shownDiscountSatang, ...(choice === 'USE' ? { applied } : {}) };
      eventDiscount = choice === 'USE' ? { ...quote.eventDiscount, choice, applied, ticketId: eventPick.ticket.id, ticketVersion: eventPick.ticket.version,
        batchId: eventPick.ticket.batchId, salesUserId: eventPick.ticket.salesUserId } : { choice, offeredTicketId: eventPick.ticket.id };
    }
    const dealSource: DealSource | undefined = deal ? { requestId: dealRow!.id, snapshotHash: dealSnapshotHash(dealRow!.offerSnapshotJson),
      months: deal.months, salesUserId: dealRow!.salesUserId!, aiMonthlyBudgetSatang: deal.aiMonthlyBudgetSatang,
      creditScope: deal.version === 4 ? 'CHAT' : 'TOTAL',
      ...(auto.autoRenew ? { cadence: auto.cadence, cycles: auto.cycles } : {}) } : undefined;
    const snapshot: BillingSnapshot = { ...(trialCarryover ? { trialCarryover } : {}), ...(dealSource ? { deal: dealSource } : {}), ...(subscriptionConversion ? { subscriptionConversion } : {}), ...(advanceDeal ? { advanceDeal } : {}), ...(pending ? { pendingChange: { id: pending.row.id, version: pending.row.version, proposed: pending.proposed } } : {}), quote, priceId: snapshotPriceId, productId, policy: state.policy, settingsVersion: state.settings.version, termVersion: term?.updatedAt.toISOString() ?? null, termHash: termProjectionHash(term), ...(featurePinned && featurePreview ? { featurePlan: featurePreview.plan } : {}), ...(repeat ? { repeat } : {}), ...(oneTime ? { oneTime } : {}), ...(oneTimeChange ? { oneTimeChange } : {}), ...(restart ? { restart } : {}), ...(upgrade ? { upgrade } : {}), ...(capacity ? { capacity } : {}), ...(eventDiscount ? { eventDiscount } : {}), ...(promotion ? { promotion } : {}) };
    await this.prisma.client.billingQuote.create({ data: { id: quoteId, companyId: company.id, initiatingUserId: context.userId,
      policyRevisionId: state.revision.id, snapshotJson: snapshot as unknown as Prisma.InputJsonValue, expiresAt: new Date(quote.expiresAt) } });
    return quote;
  }

  async checkout(context: RequestContext, body: BillingCheckoutBody, key: string): Promise<BillingCheckoutResult> {
    await assertNotDemoCompany(this.prisma.client, context.companyId);
    if (!/^[a-zA-Z0-9_-]{16,120}$/.test(key)) throw billingError('BILLING_IDEMPOTENCY_REQUIRED', 'กรุณาเริ่มตรวจสอบรายการใหม่');
    if (!this.stripe.enabled) throw billingError('BILLING_NOT_READY', 'ระบบชำระเงินยังไม่เปิดให้บริการ');
    const requestHash = hashBilling({ quoteId: body.quoteId, consentRevision: body.consentRevision, accepted: body.accepted, channel: body.channel });
    // Promotion plan R4: read without a lock whether this quote holds a promotion; the fence must be the transaction's first lock.
    const fenced = !!((await this.prisma.client.billingQuote.findUnique({ where: { id: String(body.quoteId) }, select: { snapshotJson: true } }))
      ?.snapshotJson as unknown as BillingSnapshot | undefined)?.promotion;
    const reserved = await this.prisma.client.$transaction(async (tx) => {
      if (fenced) await lockPromotionFence(tx, promotionEnvironment(this.stripe.livemode));
      await lockPlanTermCompany(tx, context.companyId);
      await this.assertOwner(context, tx);
      let account = await this.account(context.companyId, tx);
      const replay = account ? await tx.billingAttempt.findUnique({ where: { billingAccountId_idempotencyKey: { billingAccountId: account.id, idempotencyKey: key } } }) : null;
      if (replay) {
        if (replay.requestHash !== requestHash || replay.initiatingUserId !== context.userId) throw billingError('BILLING_IDEMPOTENCY_CONFLICT', 'รายการนี้มีข้อมูลต่างจากคำขอเดิม');
        return { attempt: replay, account: account!, fresh: false };
      }
      const quote = await tx.billingQuote.findUnique({ where: { id: body.quoteId } });
      const state = await this.settings(tx);
      if (!quote || quote.companyId !== context.companyId || quote.initiatingUserId !== context.userId || quote.expiresAt <= new Date() ||
          quote.policyRevisionId !== state.revision?.id) throw billingError('BILLING_QUOTE_STALE', 'รายการหมดอายุหรือราคาเปลี่ยน กรุณาตรวจสอบอีกครั้ง');
      if (await tx.billingAttempt.findUnique({ where: { quoteId: quote.id } })) throw billingError('BILLING_QUOTE_STALE', 'กรุณาตรวจสอบราคาและยืนยันรายการใหม่');
      const snapshot = quote.snapshotJson as unknown as BillingSnapshot;
      // One benefit per purchase (promotion spec Q4): a snapshot holding a promotion and a ticket to use, or a promotion
      // read without the fence, is not a quote this server wrote.
      if (snapshot.promotion && (!fenced || snapshot.quote.benefitChoice !== 'PROMOTION' || snapshot.eventDiscount?.choice === 'USE')) throw promotionUnavailable('CHANGED');
      if(account)await assertNoPendingRefund(tx,account);
      if (account && (account.activeEmailOperationId || await pendingAdminRecipientChange(tx, account)))
        throw billingError('BILLING_EMAIL_UPDATE_PENDING', 'กรุณาตรวจรายการเปลี่ยนผู้รับเอกสารให้เสร็จก่อน');
      if (account?.activeCollectionOperationId) throw billingError('BILLING_COLLECTION_PENDING', 'กรุณาตรวจคำสั่งต่ออายุเดิมให้เสร็จก่อนซื้อเพิ่ม');
      if (snapshot.settingsVersion !== state.settings.version) throw billingError('BILLING_QUOTE_STALE', 'การตั้งค่าการขายเปลี่ยน กรุณาตรวจสอบรายการใหม่');
      paidVariant(snapshot.quote.offer.offerKey, snapshot.quote.offer.interval);
      // S46: the offer window is judged here, when the session is created. A session opened inside
      // the window and paid after it still applies — the price was locked when we asked for money.
      if (snapshot.deal) assertDealOfferUnchanged(assertDealSnapshot(
        await tx.packageChangeRequest.findFirst({ where: { id: snapshot.deal.requestId, kind: DEAL_KIND } }),
        context.companyId, new Date(), snapshot.deal), snapshot.quote.offer);
      if (body.accepted !== true || body.consentRevision !== snapshot.quote.consentRevision || !['web', 'line'].includes(body.channel)) throw billingError('BILLING_CONSENT_REQUIRED', 'กรุณายืนยันเงื่อนไขการเรียกเก็บเงิน');
      if (!state.policy || !state.gates.new_sales) throw billingError('BILLING_SALES_CLOSED', 'ยังไม่เปิดรับชำระเงินใหม่');
      const purchaseMode = snapshot.quote.purchaseMode ?? 'CARD_AUTO';
      assertPurchaseMode(purchaseMode);
      if (!state.gates[gateForMode(purchaseMode)]) throw billingError('BILLING_MODE_NOT_READY', 'วิธีชำระเงินนี้ยังไม่เปิดให้บริการ');
      assertCompanyCanBuy(state.policy, context.companyId);
      assertPolicyReady(state.policy);
      const company = await tx.company.findUnique({ where: { id: context.companyId }, include: { planTerm: true } });
      if (!company || (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))) throw billingError('BILLING_COMPANY_HELD', 'บริษัทอยู่ระหว่างตรวจสอบ');
      assertBillingProfileUnchanged(company, snapshot.quote);
      assertRecipientUnchanged(account, snapshot);
      const source = await this.purchaseSource(company, account, tx);
      if (source === 'PAID_OTHER_MODE' || source === 'SOURCE_INCONSISTENT') throw billingError('BILLING_SOURCE_REVIEW_REQUIRED', 'ข้อมูลการชำระเงินเดิมไม่ตรงกัน กรุณาติดต่อทีมงาน');
      if (snapshot.quote.previousSource && source !== snapshot.quote.previousSource) throw billingError('BILLING_QUOTE_STALE', 'แพ็กเกจเดิมเปลี่ยน กรุณาตรวจสอบใหม่');
      if ((packageMenuPurchaseSource(source) || snapshot.deal || snapshot.quote.purchase?.kind === 'FULL_PACKAGE_UPGRADE') && (!snapshot.featurePlan || (await billingFeaturePlan(tx, context.companyId)).plan.sourceHash !== snapshot.featurePlan.sourceHash))
        throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์เมนูเปลี่ยน กรุณาตรวจสอบใหม่');
      if ((company.planTerm?.updatedAt.toISOString() ?? null) !== snapshot.termVersion) throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์บริษัทเปลี่ยน กรุณาตรวจสอบใหม่');
      if (snapshot.subscriptionConversion && (!account || account.baseSubscriptionId !== snapshot.subscriptionConversion.subscriptionId ||
          account.paidThrough?.toISOString() !== snapshot.subscriptionConversion.paidThrough || account.renewalMode !== 'CARD_AUTO' ||
          account.subscriptionState !== 'active' || account.cancelAtPeriodEnd || account.graceEndsAt))
        throw billingError('BILLING_QUOTE_STALE', 'สมาชิกเดิมเปลี่ยน กรุณาตรวจสอบดีลอีกครั้ง');
      if (snapshot.advanceDeal) {
        const old = await tx.billingInvoice.findFirst({ where: { id: snapshot.advanceDeal.invoiceId, billingAccountId: account?.id,
          sourceAttemptId: snapshot.advanceDeal.contractAttemptId, providerStatus: 'paid', applyStatus: 'APPLIED', appliedAt: { not: null } } });
        if (!snapshot.deal?.cadence || !account || !oneTimeMode(account.renewalMode as BillingPurchaseMode) || account.baseSubscriptionId ||
            account.contractAttemptId !== snapshot.advanceDeal.contractAttemptId || account.paidThrough?.toISOString() !== snapshot.advanceDeal.paidThrough ||
            account.billingAnchorDay !== snapshot.advanceDeal.anchorDay || account.termProjectionHash !== snapshot.termHash || account.pendingPlanChangeId ||
            !old || invoiceServiceEnd(old).toISOString() !== snapshot.advanceDeal.paidThrough || old.refundedSatang || old.disputed ||
            appendPackageInterval(new Date(snapshot.advanceDeal.paidThrough), snapshot.deal.cadence, snapshot.advanceDeal.anchorDay).toISOString() !== snapshot.advanceDeal.firstCycleEndsAt)
          throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์หรือรายการเดิมเปลี่ยน กรุณาตรวจสอบใหม่');
      }
      if (account?.activeAttemptId || (account?.baseSubscriptionId && !snapshot.repeat && !snapshot.restart && !snapshot.subscriptionConversion)) throw billingError('BILLING_PURCHASE_PENDING', 'มีรายการชำระเงินอยู่แล้ว กรุณาตรวจสถานะเดิม');
      if (snapshot.restart && (!account || account.baseSubscriptionId !== snapshot.restart.subscriptionId || account.contractAttemptId !== snapshot.restart.contractAttemptId ||
        account.paidThrough?.toISOString() !== snapshot.restart.paidThrough || account.termProjectionHash !== snapshot.restart.termHash)) throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์หรือสมาชิกเดิมเปลี่ยน กรุณาตรวจสอบใหม่');
      if (!snapshot.deal && !snapshot.repeat && !snapshot.oneTime && !(snapshot.capacity ? capacityValid(await capacityOptions(tx, context.companyId, snapshot.quote.offer), snapshot.capacity) :
        await restartFits(tx, context.companyId, snapshot.quote.offer))) throw billingError('BILLING_QUOTE_STALE', 'สาขาหรือผู้ใช้เปลี่ยน กรุณาตรวจการเลือกใหม่');
      if (snapshot.oneTime) {
        const source = await tx.billingInvoice.findFirst({ where: { id: snapshot.oneTime.invoiceId, billingAccountId: account?.id,
          providerStatus: 'paid', applyStatus: 'APPLIED', appliedAt: { not: null } } });
        if (!account || !oneTimeSourceReady(account, source) ||
            !account.paidThrough || account.paidThrough.toISOString() !== snapshot.oneTime.paidThrough ||
            account.billingAnchorDay !== snapshot.oneTime.anchorDay || account.termProjectionHash !== snapshot.termHash ||
            account.paidThrough <= new Date())
          throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์หรือรายการเดิมเปลี่ยน กรุณาตรวจสอบใหม่');
      }
      if (snapshot.oneTimeChange && (!state.gates.plan_changes || account?.pendingPlanChangeId ||
          snapshot.oneTimeChange.effectiveAt !== snapshot.oneTime?.paidThrough ||
          (snapshot.capacity ? !capacityValid(await capacityOptions(tx, context.companyId, snapshot.quote.offer), snapshot.capacity) :
            !await restartFits(tx, context.companyId, snapshot.quote.offer)))) throw billingError('BILLING_QUOTE_STALE', 'ข้อมูลแพ็กเกจรอบถัดไปเปลี่ยน กรุณาตรวจสอบใหม่');
      if (snapshot.repeat && (!state.gates.plan_changes || account?.baseSubscriptionId !== snapshot.repeat.subscriptionId ||
          account.paidThrough?.toISOString() !== snapshot.repeat.paidThrough || account.termProjectionHash !== snapshot.termHash)) throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์หรือรายการเดิมเปลี่ยน กรุณาตรวจสอบใหม่');
      if ((account?.pendingPlanChangeId ?? null) !== (snapshot.pendingChange?.id ?? null) && !snapshot.restart) throw billingError('BILLING_QUOTE_STALE', 'คำสั่งเปลี่ยนแพ็กเกจเปลี่ยน กรุณาตรวจสอบใหม่');
      if (snapshot.pendingChange && (await tx.billingOperation.findUnique({ where: { id: snapshot.pendingChange.id } }))?.version !== snapshot.pendingChange.version) throw capacityReview();
      if (snapshot.upgrade && (!state.gates.plan_changes || !account || (await upgradeHistory(tx, account, snapshot.quote.offer, snapshot.policy, snapshot.upgrade.prorationAt)).sourceHash !== snapshot.upgrade.sourceHash))
        throw billingError('BILLING_QUOTE_STALE', 'ประวัติแพ็กเกจเปลี่ยน กรุณาตรวจส่วนต่างใหม่');
      // Sales-event spec §4.3: DECLINE never goes stale for the discount; no offer at quote goes stale once one exists.
      const eventRule = eventDiscountCheckoutRule(snapshot.eventDiscount, !snapshot.eventDiscount && eventDiscountPurchase(snapshot.quote) &&
        !!await eventDiscountOffer(tx, { userId: context.userId, companyId: context.companyId, offer: snapshot.quote.offer, tax: snapshot.policy.taxTreatment, now: new Date(),
          basisSatang: eventDiscountBasis(snapshot) }));
      if (eventRule === 'STALE') throw billingError('BILLING_QUOTE_STALE', 'มีส่วนลดจากงานที่ใช้ได้ กรุณาเลือกแล้วตรวจยอดอีกครั้ง');
      if (!account) account = await tx.billingAccount.create({ data: { companyId: context.companyId, stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode } });
      const attempt = await tx.billingAttempt.create({ data: { billingAccountId: account.id, initiatingUserId: context.userId, quoteId: quote.id,
        channel: body.channel, idempotencyKey: key, requestHash, quoteSnapshot: quote.snapshotJson!, policyRevisionId: quote.policyRevisionId,
        ...(snapshot.deal ? { dealRequestId: snapshot.deal.requestId } : {}),
        consentRevision: body.consentRevision, consentAt: new Date() } });
      await tx.billingAccount.update({ where: { id: account.id }, data: { activeAttemptId: attempt.id, version: { increment: 1 } } });
      // Promotion spec §6 RESERVED: the right is taken with its attempt, under the fence, on the account as it is locked now.
      // Any refusal rolls the whole transaction back — no attempt, nothing counted, no provider request.
      if (snapshot.promotion) {
        const unsupported = promotionUnsupportedPurchase({ purchaseKind: snapshot.quote.purchase?.kind, purchaseMode, hasLiveSubscription: !!account.baseSubscriptionId && !snapshot.restart,
          deal: !!snapshot.deal || !!snapshot.advanceDeal, upgrade: !!snapshot.upgrade || !!snapshot.repeat, scheduledChange: !!snapshot.oneTimeChange });
        const taken = unsupported ?? await reservePromotion(tx, { snapshot: snapshot.promotion, stripeAccountId: account.stripeAccountId, livemode: account.livemode,
          billingAccountId: account.id, companyId: context.companyId, attemptId: attempt.id, policyRevisionId: quote.policyRevisionId });
        if (taken !== true) throw promotionUnavailable(taken);
      }
      // Spec §6.4: the quoted ticket is reserved in this transaction, after the attempt and the account slot.
      if (eventRule === 'RESERVE' && (!eventDiscountExpected(snapshot) || !await reserveEventDiscount(tx, snapshot.eventDiscount as Extract<EventDiscountSnapshot, { choice: 'USE' }>,
        { userId: context.userId, companyId: context.companyId, attemptId: attempt.id, now: new Date() })))
        throw billingError('BILLING_QUOTE_STALE', 'ส่วนลดหรือราคาเปลี่ยน กรุณาตรวจยอดอีกครั้ง');
      return { attempt, account, fresh: true };
    });
    const { account, attempt } = reserved;
    if (!reserved.fresh) {
      return this.resume(context, attempt.id);
    }
    const snapshot = attempt.quoteSnapshot as unknown as BillingSnapshot;
    if (snapshot.repeat) return this.repeater.start(account, attempt, this.config.sesWebBaseUrl);
    let financialRequestStarted = false;
    let customerRequestUnconfirmed = false;
    try {
      await this.stripe.assertAccount();
      if (snapshot.restart) await restartSource(this.prisma, this.stripe, account, snapshot.restart);
      let customerId = account.customerId;
      if (!customerId) {
        await this.prisma.client.$transaction(async tx => {
          await lockPlanTermCompany(tx, context.companyId);
          await this.assertOwner(context, tx);
        });
        customerRequestUnconfirmed = true;
        // R-A2: no email when the quote pinned none — Checkout then asks for it and stores it on the Customer.
        const customer = await this.stripe.request('POST', '/customers', { ...stripeCustomerSyncPayload(snapshot),
          metadata: { billingAccountId: account.id } }, `mm:${account.id}:customer`);
        if (typeof customer.id !== 'string' || !customer.id.startsWith('cus_')) throw new StripeRequestError('UNKNOWN', 'invalid_customer');
        customerId = customer.id;
        await this.prisma.client.billingAccount.updateMany({ where: { id: account.id, customerId: null }, data: { customerId } });
        const mapped = await this.prisma.client.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
        if (mapped.customerId !== customerId) throw new StripeRequestError('UNKNOWN', 'customer_binding_changed');
        customerRequestUnconfirmed = false;
      }
      const customer = await this.stripe.request('GET', `/customers/${customerId}`);
      if (customer.id !== customerId || customer.metadata?.billingAccountId !== account.id)
        throw billingError('BILLING_MAPPING_MISMATCH', 'ข้อมูลลูกค้าใน Stripe ไม่ตรงกับบริษัท กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง');
      if (!stripeCustomerSynced(customer, snapshot)) {
        // Retain an ambiguous profile write until its original idempotent command is settled.
        // No Checkout can be sent while this marker is unconfirmed. The payload may set the email the
        // quote pinned: the column recipient (already checked for drift) or a verified account email.
        const profileSync = { startedAt: new Date().toISOString(), customerId, confirmed: false };
        await this.prisma.client.billingAttempt.update({ where: { id: attempt.id }, data: { collectionJson: { profileSync } } });
        customerRequestUnconfirmed = true;
        const updated = await this.stripe.request('POST', `/customers/${customerId}`,
          stripeCustomerSyncPayload(snapshot), `mm:${attempt.id}:billing-profile`);
        if (updated.id !== customerId || updated.metadata?.billingAccountId !== account.id || !stripeCustomerSynced(updated, snapshot))
          throw new StripeRequestError('UNKNOWN', 'customer_profile_unconfirmed');
        await this.prisma.client.billingAttempt.update({ where: { id: attempt.id }, data: { collectionJson: { profileSync: { ...profileSync, confirmed: true } } } });
        customerRequestUnconfirmed = false;
      }
      // Recheck authoritative stop barrier immediately before the external financial request.
      await this.prisma.client.$transaction(async (tx) => {
        await lockPlanTermCompany(tx, context.companyId);
        await this.assertOwner(context, tx);
        const state = await this.settings(tx);
        if (!state.gates.new_sales || !state.gates[gateForMode(snapshot.quote.purchaseMode ?? 'CARD_AUTO')] ||
            ((state.revision?.id !== attempt.policyRevisionId || state.settings.version !== snapshot.settingsVersion) &&
              !await basePolicyUnchanged(tx, state, attempt))) throw billingError('BILLING_SALES_CLOSED', 'หยุดรับรายการใหม่ชั่วคราว');
        assertCompanyCanBuy(state.policy, context.companyId);
        const company = await tx.company.findUnique({ where: { id: context.companyId }, include: { planTerm: true } });
        if (!company || (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))) throw billingError('BILLING_COMPANY_HELD', 'บริษัทอยู่ระหว่างตรวจสอบ');
        assertBillingProfileUnchanged(company, snapshot.quote);
        const barrierAccount = await this.account(context.companyId, tx);
        assertRecipientUnchanged(barrierAccount, snapshot);
        const source = await this.purchaseSource(company, barrierAccount, tx);
        if (source === 'PAID_OTHER_MODE' || source === 'SOURCE_INCONSISTENT' || (snapshot.quote.previousSource && source !== snapshot.quote.previousSource))
          throw billingError('BILLING_QUOTE_STALE', 'แพ็กเกจเดิมเปลี่ยน กรุณาตรวจสอบใหม่');
        if (snapshot.advanceDeal) {
          const old = await tx.billingInvoice.findUnique({ where: { id: snapshot.advanceDeal.invoiceId } });
          const current = await this.account(context.companyId, tx);
          if (!current || current.activeAttemptId !== attempt.id || current.baseSubscriptionId || current.pendingPlanChangeId ||
              current.contractAttemptId !== snapshot.advanceDeal.contractAttemptId || current.paidThrough?.toISOString() !== snapshot.advanceDeal.paidThrough ||
              current.termProjectionHash !== snapshot.termHash || old?.billingAccountId !== current.id || old.applyStatus !== 'APPLIED' ||
              old.providerStatus !== 'paid' || old.refundedSatang || old.disputed)
            throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์หรือรายการเดิมเปลี่ยน กรุณาตรวจสอบใหม่');
        }
        if ((packageMenuPurchaseSource(source) || snapshot.deal || snapshot.quote.purchase?.kind === 'FULL_PACKAGE_UPGRADE') && (!snapshot.featurePlan || (await billingFeaturePlan(tx, context.companyId)).plan.sourceHash !== snapshot.featurePlan.sourceHash))
          throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์เมนูเปลี่ยน กรุณาตรวจสอบใหม่');
        if ((company.planTerm?.updatedAt.toISOString() ?? null) !== snapshot.termVersion || company.name !== snapshot.quote.companyName) throw billingError('BILLING_QUOTE_STALE', 'ข้อมูลบริษัทหรือสิทธิ์เปลี่ยน กรุณาตรวจสอบใหม่');
        const changed = await tx.billingAttempt.updateMany({ where: { id: attempt.id, status: 'CREATING', version: 0 }, data: { status: 'REQUESTING', version: { increment: 1 } } });
        if (changed.count !== 1) throw billingError('BILLING_PURCHASE_PENDING', 'กำลังตรวจสอบรายการเดิม');
      });
      const origin = this.config.sesWebBaseUrl;
      if (!origin) throw new StripeRequestError('REJECTED', 'missing_web_origin');
      const returnUrl = new URL(`/companies/${context.companyId}/billing/return?attempt=${attempt.id}`, origin).toString();
      // G12/RV29: the return page tells a cancelled Checkout from a pending one by this marker.
      const cancelUrl = `${returnUrl}&checkout=canceled`;
      // R-A3/RV16: 'auto' writes the Checkout address onto the Customer, so only a complete profile keeps it.
      const customerUpdate = { address: billingProfileComplete(snapshot.quote.billingProfile) ? 'never' : 'auto' } as const;
      if (account.customerId) {
        const customer = await this.stripe.request('GET', `/customers/${customerId}`);
        if (customer.id !== customerId || customer.metadata?.billingAccountId !== account.id)
          throw billingError('BILLING_MAPPING_MISMATCH', 'ข้อมูลลูกค้าใน Stripe ไม่ตรงกับบริษัท กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง');
      }
      await this.assertTaxSettings(snapshot.policy);
      if (paymentCheckoutSnapshot(snapshot)) {
        const price = await this.stripe.request('GET', `/prices/${snapshot.priceId}`);
        // A ONE-TIME deal pins the catalog Price (the product source) and pays `price_data`; an
        // auto-renewing QR deal pins its own recurring Price, which is the deal offer itself.
        assertStripePrice(price, snapshot.deal && !autoRenewDealSnapshot(snapshot)
          ? paidVariant(snapshot.quote.offer.offerKey, 'month', snapshot.policy).offer : snapshot.quote.offer,
          snapshot.policy, account.livemode, snapshot.priceId);
        if (stripeId(price.product) !== snapshot.productId) throw billingError('BILLING_PRICE_MISMATCH', 'ข้อมูลราคาเปลี่ยน กรุณาตรวจสอบใหม่');
        const siblings = await this.stripe.list('/subscriptions', { customer: customerId, status: 'all' });
        if (siblings.some(sub => !['canceled', 'incomplete_expired'].includes(sub.status)))
          throw billingError('BILLING_MODE_CHANGE_PENDING', 'ยังมีสมาชิกที่สามารถเรียกเก็บเงินได้ กรุณาตรวจสอบก่อนซื้อครั้งเดียว');
      } else if (snapshot.deal) {
        // D-P5-4: the subscription branch never read a Price before. A CARD_AUTO deal bills the
        // per-company Price directly on the line item, so it gets the same pre-session proof the
        // one-time branch has had all along.
        const price = await this.stripe.request('GET', `/prices/${snapshot.priceId}`);
        assertStripePrice(price, snapshot.quote.offer, snapshot.policy, account.livemode, snapshot.priceId);
        if (stripeId(price.product) !== snapshot.productId) throw billingError('BILLING_PRICE_MISMATCH', 'ข้อมูลราคาเปลี่ยน กรุณาตรวจสอบใหม่');
      }
      financialRequestStarted = true;
      const metadata = { billingAttemptId: attempt.id, billingAccountId: account.id };
      const once = paymentCheckoutSnapshot(snapshot);
      const documentDescription = eventDiscountDocumentDescription(snapshot);
      const session = await this.stripe.request('POST', '/checkout/sessions', once ? {
        mode: 'payment', customer: customerId, client_reference_id: attempt.id,
        payment_method_types: [snapshot.quote.purchaseMode?.startsWith('PROMPTPAY') ? 'promptpay' : 'card'],
        metadata, payment_intent_data: { metadata, ...(documentDescription ? { description: documentDescription } : {}), ...((snapshot.advanceDeal && snapshot.quote.purchaseMode === 'CARD_AUTO') || prepaidCardAuto(snapshot)
          ? { setup_future_usage: 'off_session' } : {}) },
        invoice_creation: { enabled: true, invoice_data: { metadata,
          ...(documentDescription ? { description: documentDescription } : {}),
          ...(snapshot.policy.taxTreatment !== 'NOT_VAT_REGISTERED' && snapshot.policy.issuer ? { account_tax_ids: [snapshot.policy.issuer.stripeTaxId] } : {}) } },
        line_items: [{ quantity: 1, price_data: { product: snapshot.productId, currency: 'thb',
          unit_amount: eventDiscountExpected(snapshot)?.unitAmountSatang ?? snapshot.upgrade?.amountSatang ?? snapshot.quote.offer.priceSatang, tax_behavior: snapshot.policy.taxTreatment === 'EXCLUSIVE_VAT_7' ? 'exclusive' : 'inclusive' },
          ...(snapshot.policy.taxRateId ? { tax_rates: [snapshot.policy.taxRateId] } : {}) }],
        success_url: returnUrl, cancel_url: cancelUrl, locale: 'th', billing_address_collection: 'required',
        customer_update: customerUpdate,
        expires_at: Math.floor(Date.now() / 1000) + 1800,
      } : {
        mode: 'subscription', customer: customerId, client_reference_id: attempt.id, payment_method_types: ['card'],
        line_items: [{ price: snapshot.priceId, quantity: 1, ...(snapshot.policy.taxRateId ? { tax_rates: [snapshot.policy.taxRateId] } : {}) }],
        success_url: returnUrl, cancel_url: cancelUrl, locale: 'th', billing_address_collection: 'required',
        customer_update: customerUpdate,
        metadata, subscription_data: { billing_mode: { type: 'classic' }, metadata },
        expires_at: Math.floor(Date.now() / 1000) + 1800,
      }, `mm:${attempt.id}:checkout`);
      if (typeof session.id !== 'string' || !session.id.startsWith('cs_') || session.object !== 'checkout.session' || session.mode !== (once ? 'payment' : 'subscription') ||
          session.livemode !== account.livemode || session.client_reference_id !== attempt.id ||
          stripeId(session.customer) !== customerId || session.metadata?.billingAttemptId !== attempt.id || session.metadata?.billingAccountId !== account.id || !safeStripeUrl(session.url, 'checkout')) throw new StripeRequestError('UNKNOWN', 'invalid_checkout');
      await this.prisma.client.billingAttempt.updateMany({ where: { id: attempt.id, status: 'REQUESTING' }, data: { status: 'OPEN', checkoutSessionId: session.id, version: { increment: 1 } } });
      const current = await this.prisma.client.billingAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      return { attemptId: attempt.id, state: current.status, checkoutUrl: current.status === 'OPEN' ? safeStripeUrl(session.url, 'checkout') : null,
        ...(Number.isSafeInteger(session.expires_at) && session.expires_at > 0 && session.expires_at <= 8_640_000_000_000 ? { expiresAt: new Date(session.expires_at * 1000).toISOString() } : {}) };
    } catch (error) {
      const code = error instanceof StripeRequestError ? error.code : 'command_unconfirmed';
      // Only release a reservation when we know no financial request succeeded. A network timeout
      // or malformed provider success retains it for reconciliation and cannot permit a second sale.
      if ((!financialRequestStarted && !customerRequestUnconfirmed) || (error instanceof StripeRequestError && error.outcome === 'REJECTED')) {
        await this.prisma.client.$transaction(async (tx) => {
          await lockPlanTermCompany(tx, context.companyId);
          const changed = await tx.billingAttempt.updateMany({ where: { id: attempt.id, status: { in: ['CREATING', 'REQUESTING'] } }, data: { status: 'FAILED', errorCode: code, version: { increment: 1 } } });
          if (changed.count) {
            await tx.billingAccount.updateMany({ where: { id: account.id, activeAttemptId: attempt.id }, data: { activeAttemptId: null, version: { increment: 1 } } });
            if (snapshot.eventDiscount?.choice === 'USE') await releaseEventDiscount(tx, attempt.id);
            // Proven unpaid: the promotion right goes back. The released row no longer names this attempt, so the audit does.
            const right = snapshot.promotion ? await promotionForAttempt(tx, attempt.id) : null;
            if (right?.state === 'RESERVED') {
              await releasePromotion(tx, attempt.id);
              await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'billing.promotion.released',
                targetType: 'BillingPromotionRedemption', targetId: right.id, requestId: context.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
                metadataJson: { attemptId: attempt.id, campaignId: right.campaignId, reason: 'CHECKOUT_NOT_CREATED', errorCode: code } } });
            }
          }
        });
        if (!(error instanceof StripeRequestError)) throw error;
        return { attemptId: attempt.id, state: 'FAILED', checkoutUrl: null };
      }
      await this.prisma.client.billingAttempt.updateMany({ where: { id: attempt.id, status: { in: ['CREATING', 'REQUESTING'] } }, data: { status: 'UNKNOWN', errorCode: code } });
      await this.issue(context.companyId, 'UNKNOWN_ATTEMPT', attempt.id);
      return { attemptId: attempt.id, state: 'UNKNOWN', checkoutUrl: null };
    }
  }

  async issue(companyId: string | null, kind: string, referenceId: string) {
    return this.prisma.client.$transaction(tx=>detectBillingIssue(tx,{stripeAccountId:this.stripe.accountId,livemode:this.stripe.livemode,companyId,kind,referenceId}));
  }

  get adminCollection() { return new BillingAdminCollection(this.prisma,this); }

  async status(context: RequestContext): Promise<BillingStatus> {
    await this.assertOwner(context);
    const company = await this.prisma.client.company.findUnique({ where: { id: context.companyId }, include: { planTerm: true } });
    if (!company) throw new NotFoundException();
    const term = company.planTerm, account = await this.account(company.id);
    const purchaseSource = await this.purchaseSource(company, account);
    let featureReady = true;
    // The same predicate the quote pins with: a shop that would be refused at Checkout must be
    // told on the package page, not by an error after it picks a package.
    if (packageMenuPurchaseSource(purchaseSource)) {
      try { await billingFeaturePlan(this.prisma.client, company.id); }
      catch (error) {
        if (!(error instanceof ConflictException) || (error.getResponse() as { code?: string }).code !== 'BILLING_ENTITLEMENT_REVIEW_REQUIRED') throw error;
        featureReady = false;
      }
    }
    const attempt = account?.activeAttemptId ? await this.prisma.client.billingAttempt.findUnique({ where: { id: account.activeAttemptId } }) : null;
    const advance = (attempt?.quoteSnapshot as unknown as BillingSnapshot | undefined)?.advanceDeal;
    const invoice = account ? advance
      ? await this.prisma.client.billingInvoice.findFirst({ where: { id: advance.invoiceId, billingAccountId: account.id } })
      : oneTimeMode(account.renewalMode as BillingPurchaseMode) && account.contractAttemptId && account.paidThrough
        ? await this.prisma.client.billingInvoice.findFirst({ where: { billingAccountId: account.id,
          sourceAttemptId: account.contractAttemptId, ...invoiceServiceEndsAt(account.paidThrough) } })
      : await latestPackageInvoice(this.prisma.client, { billingAccountId: account.id }) : null;
    const advanceInvoice = advance && account ? await this.prisma.client.billingInvoice.findFirst({ where: { billingAccountId: account.id,
      sourceAttemptId: attempt!.id, providerStatus: 'paid' } }) : null;
    const advanceOperation = advanceInvoice && account ? await this.prisma.client.billingOperation.findUnique({ where: {
      stripeAccountId_livemode_idempotencyKey: { stripeAccountId: account.stripeAccountId, livemode: account.livemode,
        idempotencyKey: `advance-deal:${attempt!.id}` } } }) : null;
    const settings = this.stripe.enabled ? await this.settings() : null;
    const state = billingState(company, account, invoice, attempt), held = state.accessState === 'HELD';
    const allowedActions: BillingAction[] = [];
    const renewalMode = (account?.renewalMode !== 'NONE' ? account?.renewalMode : account?.baseSubscriptionId ? 'CARD_AUTO' : 'NONE') as BillingStatus['renewalMode'];
    const cardAdvanceContract = account?.subscriptionState === 'trialing' && renewalMode === 'CARD_AUTO' && account.contractAttemptId
      ? await this.prisma.client.billingSubscriptionContract.findFirst({ where: { billingAccountId: account.id,
        sourceAttemptId: account.contractAttemptId }, select: { snapshotJson: true } }) : null;
    // A card subscription trialing through a period already paid once: an advance deal, SD-O13's discounted first period, or a promotion purchase.
    const trialContract = cardAdvanceContract?.snapshotJson as unknown as BillingSnapshot | undefined;
    const cardAdvanceTrial = !!trialContract?.advanceDeal || prepaidCardAuto(trialContract);
    const eligible = companyCanBuy(settings?.policy ?? null, company.id);
    const purchaseReady = featureReady && purchaseSource !== 'PAID_OTHER_MODE' && purchaseSource !== 'SOURCE_INCONSISTENT';
    let policyReady = false;
    if (settings?.policy) { try { assertPolicyReady(settings.policy); policyReady = true; } catch { /* Keep incomplete policies closed. */ } }
    if (settings?.policy && policyReady && !held) {
      if (purchaseReady && !account?.baseSubscriptionId && !account?.activeAttemptId && !account?.activeCollectionOperationId && !account?.pendingPlanChangeId && settings.gates.new_sales && eligible) allowedActions.push('new_sales');
      if (purchaseReady && account?.baseSubscriptionId && !account.activeAttemptId && !account.activeCollectionOperationId &&
        ['canceled', 'incomplete_expired'].includes(account.subscriptionState) && account.paidThrough && account.paidThrough <= new Date() &&
        !(account.graceEndsAt && account.graceEndsAt > new Date()) && settings.gates.new_sales && eligible) allowedActions.push('new_sales');
      if (purchaseReady && account?.baseSubscriptionId && !account.activeAttemptId && !account.activeCollectionOperationId && account.subscriptionState === 'active' && !account.cancelAtPeriodEnd &&
          account.paidThrough && account.paidThrough > new Date() && !account.graceEndsAt && settings.gates.new_sales && settings.gates.plan_changes &&
          Object.keys(settings.policy.zeroPriceIds ?? {}).length && eligible) allowedActions.push('new_sales');
      if (renewalMode === 'CARD_AUTO' && account?.baseSubscriptionId && account.customerId && settings.gates.portal_payment_method) allowedActions.push('portal_payment_method');
    }
    if (settings && !held && account?.baseSubscriptionId && !account.activeAttemptId && !account.activeCollectionOperationId &&
      ['active', 'past_due', 'unpaid', ...((renewalMode === 'PROMPTPAY_RENEW' || cardAdvanceTrial) ? ['trialing'] : [])].includes(account.subscriptionState) &&
      settings.gates.portal_cancel_subscription) allowedActions.push('portal_cancel_subscription');
    const pending = account?.pendingPlanChangeId ? await this.collection.get(context, account.pendingPlanChangeId) : null;
    if (purchaseReady && settings?.gates.plan_changes && (eligible || pending) && account?.paidThrough && account.paidThrough.getTime() > Date.now()+600000 && !account.cancelAtPeriodEnd && !account.graceEndsAt &&
      !held && !account.activeAttemptId && !account.activeCollectionOperationId && account.subscriptionState === 'active' &&
      renewalMode === 'CARD_AUTO') allowedActions.push('plan_changes');
    const snapshot = invoice?.offerSnapshot as unknown as BillingQuote['offer'] | undefined;
    let renewalInvoiceUrl: string | null = null, renewalInvoiceDueAt: string | null = null;
    if (renewalMode === 'PROMPTPAY_RENEW' && account?.baseSubscriptionId && account.customerId && this.stripe.enabled) {
      await this.stripe.assertAccount();
      const sub = await this.stripe.request('GET', `/subscriptions/${account.baseSubscriptionId}`);
      if (sub.id !== account.baseSubscriptionId || sub.livemode !== account.livemode ||
          stripeId(sub.customer) !== account.customerId || sub.metadata?.billingAccountId !== account.id ||
          sub.collection_method !== 'send_invoice') throw billingError('BILLING_MAPPING_MISMATCH', 'ข้อมูลบิลต่ออายุต้องตรวจสอบ กรุณาติดต่อทีมงาน');
      const latestId = stripeId(sub.latest_invoice);
      if (latestId) {
        const due = await this.stripe.request('GET', `/invoices/${latestId}`);
        if (due.id !== latestId || due.livemode !== account.livemode || stripeId(due.customer) !== account.customerId ||
            (due.total > 0 && stripeId(due.parent?.subscription_details?.subscription) !== sub.id))
          throw billingError('BILLING_MAPPING_MISMATCH', 'ข้อมูลบิลต่ออายุต้องตรวจสอบ กรุณาติดต่อทีมงาน');
        if (due.status === 'open' && due.collection_method === 'send_invoice' && due.currency === 'thb' && due.total > 0 &&
            due.amount_paid === 0) {
          renewalInvoiceUrl = safeStripeUrl(due.hosted_invoice_url, 'document');
          renewalInvoiceDueAt = Number.isSafeInteger(due.due_date) ? new Date(due.due_date * 1000).toISOString() : null;
        }
      }
    }
    const enabledPurchaseModes: BillingPurchaseMode[] = settings?.gates.new_sales && eligible && !held
      ? (['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW'] as const).filter(mode => settings.gates[gateForMode(mode)]) : [];
    const availablePurchaseModes: BillingPurchaseMode[] = enabledPurchaseModes.filter(mode =>
          !account?.paidThrough || account.paidThrough <= new Date() ||
            (account.baseSubscriptionId ? renewalMode === 'CARD_AUTO' && mode === 'CARD_AUTO' : renewalMode === 'CARD_ONCE' || renewalMode === 'PROMPTPAY_ONCE'
              ? oneTimeMode(mode) : true));
    const refundReviewPending = !!(account && await pendingRefund(this.prisma.client, account));
    // PR E: an admin-initiated recipient change holds the account without setting activeEmailOperationId
    // (it has its own lease/drain) — the same gate `current()` (billing-email-recipient.ts) already
    // respects for `stored.canChange`, reused here so this can never open while that one refuses.
    const recipientAdminPending = !!(account && await pendingAdminRecipientChange(this.prisma.client, account));
    const expiredSubscription = !!account?.baseSubscriptionId && !!account.paidThrough && account.paidThrough <= new Date();
    const restartBlocked = expiredSubscription && (!['canceled', 'incomplete_expired'].includes(account!.subscriptionState) ||
      !!(account!.graceEndsAt && account!.graceEndsAt > new Date()) || await restartReviewPending(this.prisma.client, account!));
    const purchaseBlockCode = !settings?.policy ? 'BILLING_NOT_READY' : !policyReady ? 'CONTROL_POLICY_NOT_READY'
      : held ? 'BILLING_COMPANY_HELD' : !settings.gates.new_sales ? 'BILLING_SALES_CLOSED'
      : !eligible ? 'BILLING_COMPANY_SALES_CLOSED' : !purchaseReady ? featureReady ? 'BILLING_SOURCE_REVIEW_REQUIRED' : 'BILLING_ENTITLEMENT_REVIEW_REQUIRED'
      : account?.activeEmailOperationId || recipientAdminPending ? 'BILLING_EMAIL_UPDATE_PENDING'
      : account?.activeAttemptId ? 'BILLING_CHECKOUT_PENDING' : account?.activeCollectionOperationId ? 'BILLING_COLLECTION_PENDING'
      : account?.pendingPlanChangeId && (oneTimeMode(renewalMode) || !account.baseSubscriptionId || expiredSubscription) ? 'BILLING_PLAN_CHANGE_PENDING'
      : refundReviewPending ? 'BILLING_REFUND_PENDING' : account?.collectionPauseJson ? 'BILLING_COLLECTION_REVIEW'
      : restartBlocked ? 'BILLING_RESTART_REVIEW'
      : account?.paidThrough && account.paidThrough > new Date() && oneTimeMode(renewalMode) && !oneTimeSourceReady(account, invoice) ? 'BILLING_PACKAGE_STATE_INVALID'
      : account?.paidThrough && account.paidThrough > new Date() && renewalMode === 'PROMPTPAY_RENEW' ? 'BILLING_PLAN_CHANGE_REQUIRED'
      : !availablePurchaseModes.length ? 'BILLING_MODE_NOT_READY'
      : !allowedActions.includes('new_sales') ? 'BILLING_REPEAT_NOT_READY' : null;
    const issues = this.config.stripeAccountId ? await this.prisma.client.billingIssue.findMany({ where: { companyId: company.id, stripeAccountId: this.stripe.accountId,
      livemode: this.stripe.livemode, state: { not: 'RESOLVED' } }, take: 10, select: { id: true, kind: true } }) : [];
    const finalActions = allowedActions.filter(action => (action !== 'new_sales' || !purchaseBlockCode) &&
      (!account?.collectionPauseJson || !['new_sales','plan_changes','portal_cancel_subscription'].includes(action)) &&
      (!refundReviewPending || !['new_sales', 'plan_changes', ...(account?.cancelAtPeriodEnd ? ['portal_cancel_subscription'] : [])].includes(action)));
    const dealConversionReady = !!settings?.policy && policyReady && purchaseReady && !held && eligible && settings.gates.new_sales &&
      account?.baseSubscriptionId != null && account.renewalMode === 'CARD_AUTO' && account.subscriptionState === 'active' &&
      !!account.paidThrough && account.paidThrough > new Date() && !account.cancelAtPeriodEnd && !account.graceEndsAt &&
      !account.activeAttemptId && !account.activeCollectionOperationId && !account.pendingPlanChangeId && !refundReviewPending &&
      !account.activeEmailOperationId && !recipientAdminPending && !account.collectionPauseJson;
    // R10/S39: the APPROVED, unexpired offer this shop may pay for, with the modes ITS card may
    // show. `purchaseModes` is empty exactly where the quote would refuse, so the card falls back
    // to "ติดต่อทีมงาน" instead of opening a Checkout that cannot succeed.
    const dealRow = await this.prisma.client.packageChangeRequest.findFirst({ where: { companyId: company.id, kind: DEAL_KIND,
      status: 'APPROVED', offerExpiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    let deal: BillingStatus['deal'];
    if (dealRow?.offerExpiresAt) {
      // A stored offer that no longer parses must not break the status page; the card stays away.
      try {
        const offer = dealSnapshot(dealRow.offerSnapshotJson), auto = autoRenewOf(offer);
        deal = { dealId: dealRow.id, base: offer.base, baseLabel: billingOffer(offer.base, auto.cadence ?? 'month').label,
          priceSatang: offer.priceSatang, months: offer.months, offerExpiresAt: dealRow.offerExpiresAt.toISOString(),
          autoRenew: auto.autoRenew, cadence: auto.cadence, cycles: auto.cycles,
          // D-P5-3: an auto deal whose Stripe Price is not READY cannot open a Checkout, so the
          // card offers nothing rather than a button whose quote answers SALES_DEAL_PRICE_PENDING.
          purchaseModes: (finalActions.includes('new_sales') || dealConversionReady) &&
            (!auto.autoRenew || dealRow.priceState === 'READY') &&
            (!account?.baseSubscriptionId || !account.paidThrough || account.paidThrough <= new Date() || dealConversionReady)
            ? dealPurchaseModes(settings?.gates ?? {}, offer) : [],
          // The card's own detail, so the OWNER reads their offer here and not through the
          // package-change queue, which `company.setup.manage` gates. `internalReason` and
          // `salesUserId` stay behind in the row: the team's note is not part of the offer (S24).
          branchLimit: offer.branchLimit, employeeLimit: offer.employeeLimit, monthlySlipLimit: offer.monthlySlipLimit,
          featureKeys: offer.featureKeys, aiMonthlyBudgetSatang: offer.aiMonthlyBudgetSatang,
          creditScope: offer.version === 4 ? 'CHAT' : 'TOTAL', description: offer.description };
      } catch { deal = undefined; }
    }
    // Sales-event spec §8 / SD-O12: the discount box and card lines wherever this shop can pay for a package in one go now.
    const eventDiscount = settings?.policy && eventDiscountPath(purchaseSource, renewalMode) === 'DISCOUNT' && finalActions.includes('new_sales')
      ? await eventDiscountView(this.prisma.client, { userId: context.userId, companyId: company.id, tax: settings.policy.taxTreatment, now: new Date(),
        offers: BILLING_PAID_TIERS.flatMap(tier => (['month', 'year'] as const).map(interval => billingOffer(tier, interval, settings.policy))) }) : undefined;
    // Promotion spec §3: what the package page may advertise to this shop, only where it can buy now. A shop whose only
    // possible purchase is outside the release-1 matrix (plan §2) is told so; NORMAL stays purchasable either way.
    // ponytail: active paid time decides it — a one-time package of the same offer may repeat, everything else may not.
    const activePaid = !!account?.paidThrough && account.paidThrough > new Date();
    const promotions = settings?.policy && Object.keys(settings.promotions ?? {}).length && finalActions.includes('new_sales')
      ? (await promotionOffers(this.prisma.client, { settings, companyId: company.id, tax: settings.policy.taxTreatment, now: new Date(),
        offers: BILLING_PAID_TIERS.flatMap(tier => (['month', 'year'] as const).map(interval => billingOffer(tier, interval, settings.policy))) }))
        .map(view => view.available && activePaid && (!oneTimeMode(renewalMode) || account!.baseSubscriptionId || snapshot?.offerKey !== view.offerKey || snapshot.interval !== view.interval)
          ? { ...view, available: false, reason: 'PURCHASE_KIND_UNSUPPORTED' as const } : view) : [];
    // The newest right this shop holds: reserved for a Checkout, or used and still giving free time (one ended by a full
    // refund — `entitlementAdjustedAt` — gives none, so it is not shown as in use).
    const right = account ? await this.prisma.client.billingPromotionRedemption.findFirst({ where: { companyId: company.id,
      promotionEnvironmentId: promotionEnvironment(account.livemode), OR: [{ state: 'RESERVED' }, { state: 'CONSUMED', bonusEnd: { gt: new Date() }, entitlementAdjustedAt: null }] },
      orderBy: { acceptedAt: 'desc' } }) : null;
    const rightAttempt = right?.attemptId ? await this.prisma.client.billingAttempt.findFirst({ where: { id: right.attemptId, billingAccountId: account!.id } }) : null;
    const deferral = account ? await promotionUpgradeDeferral(this.prisma.client, account) : null;
    return { companyId: company.id, companyName: company.name, billingProfile: companyBillingProfile(company), mode: this.stripe.enabled ? (this.stripe.livemode ? 'LIVE' : 'TEST') : 'DISABLED',
      collectionPause: account?.collectionPauseJson as BillingStatus['collectionPause'],
      renewalMode, enabledPurchaseModes, availablePurchaseModes,
      pendingDeal: advanceInvoice && advanceOperation?.state !== 'APPLIED' ? { dealId: (attempt!.quoteSnapshot as unknown as BillingSnapshot).deal!.requestId,
        purchaseMode: (attempt!.quoteSnapshot as unknown as BillingSnapshot).quote.purchaseMode as 'CARD_AUTO' | 'PROMPTPAY_RENEW',
        startsAt: advance!.paidThrough, firstCycleEndsAt: advance!.firstCycleEndsAt, nextChargeAt: advance!.firstCycleEndsAt,
        state: advanceInvoice.applyStatus === 'HELD' || advanceOperation?.state === 'BLOCKED' ? 'HELD' :
          (advanceOperation?.resultJson as { subscriptionId?: string } | null)?.subscriptionId ? 'PAID' : 'PENDING_BINDING' } : null,
      renewalInvoiceUrl, renewalInvoiceDueAt,
      purchaseSource, purchaseBlockCode, packageChangesEnabled: !!settings?.gates.plan_changes,
      purchaseEligibility: !eligible ? 'COMPANY_SALES_CLOSED' : purchaseSource === 'PAID_OTHER_MODE' || purchaseSource === 'SOURCE_INCONSISTENT'
        ? 'SOURCE_REVIEW_REQUIRED' : !featureReady ? 'ENTITLEMENT_REVIEW_REQUIRED' : 'ELIGIBLE', refundReviewPending,
      policyRevision: settings?.revision?.id ?? null, ...state, subscriptionState: account?.subscriptionState ?? 'NONE',
      // R2: same rule the plan-term notice uses, so the package page and the locked shell agree on
      // whether this shop never had a package or ran one to its end. EXPIRED only; a HELD company
      // is an admin hold, which is neither.
      ...(state.accessState === 'EXPIRED' && term ? { lockReason: planTermLockReason(term) } : {}),
      // The number a shop reads to the team: the purchase in flight while it has no invoice of its own
      // (an older invoice would send support to the wrong row), the invoice once there is one.
      attemptId: attempt?.id ?? null, reference: (attempt && invoice?.sourceAttemptId !== attempt.id ? attempt.id : invoice?.id) ?? null,
      observedAt: account?.observedAt?.toISOString() ?? null,
      canCancelCheckout: !!attempt?.checkoutSessionId && !['COMPLETED','EXPIRED','FAILED'].includes(attempt.status) &&
        !(invoice?.sourceAttemptId === attempt.id && invoice.providerStatus === 'paid'),
      effectiveCapacity: term ? effectivePlanCapacity(term) : null, tierKey: term?.tierKey ?? null, interval: pending?.currentOffer?.interval ?? snapshot?.interval ?? null, termEndsAt: term?.termEndsAt.toISOString() ?? null, paidThrough: account?.paidThrough?.toISOString() ?? null,
      nextChargeAt: account?.collectionPauseJson || renewalMode === 'CARD_ONCE' || renewalMode === 'PROMPTPAY_ONCE' ? null : account?.nextChargeAt?.toISOString() ?? null, cancelAtPeriodEnd: account?.cancelAtPeriodEnd ?? false,
      graceEndsAt: account?.graceEndsAt?.toISOString() ?? null,
      allowedActions: finalActions, ...(deal ? { deal } : {}), ...(eventDiscount ? { eventDiscount } : {}),
      ...(promotions.length ? { promotions } : {}),
      ...(right && rightAttempt ? { promotion: promotionUse(right, rightAttempt.quoteSnapshot as unknown as BillingSnapshot, account!, await renewalSetupIssue(this.prisma.client, account!, right)) } : {}),
      ...(deferral ? { upgradeDeferredUntil: deferral.until.toISOString() } : {}),
      usage: await this.usage(company.id),
      pendingPlanChange: pending,
      planCapacityRepair: !held && pending && ((pending.action === 'PREPAID_PLAN_CHANGE' && pending.state === 'BLOCKED' &&
        pending.errorCode === 'BILLING_CAP_SELECTION_REQUIRED') || (invoice?.applyStatus === 'HELD' && invoice.errorCode === 'BILLING_CAP_SELECTION_REQUIRED' &&
        (invoice.contractSnapshot as unknown as BillingSnapshot).planChangeId === pending.id)) ? { operationId: pending.id, version: pending.version,
          offerKey: pending.targetOffer!.offerKey, interval: pending.targetOffer!.interval } : null,
      collection: account?.activeCollectionOperationId ? await this.collection.get(context, account.activeCollectionOperationId) : null,
      capacityRepair: !held && attempt && invoice?.sourceAttemptId === attempt.id && invoice.applyStatus === 'HELD' && invoice.errorCode === 'BILLING_CAP_SELECTION_REQUIRED'
        ? { attemptId: attempt.id, attemptVersion: attempt.version, offerKey: (attempt.quoteSnapshot as unknown as BillingSnapshot).quote.offer.offerKey,
          interval: (attempt.quoteSnapshot as unknown as BillingSnapshot).quote.offer.interval } : null,
      // R-A7/R-A8: the column only — no Stripe read here, so it stays empty until the payment applies.
      recipient: { email: account?.recipientEmail ?? null, source: (account?.recipientSource as BillingRecipientSource | null) ?? null,
        bouncedAt: account?.recipientBouncedAt?.toISOString() ?? null,
        canChange: !!account?.customerId && !account.activeEmailOperationId && !account.activeAttemptId && !recipientAdminPending },
      checkoutAddress: checkoutAddressOf(account?.checkoutAddressJson),
      issues: issues.map((i) => ({ reference: i.id, code: i.kind })) };
  }

  async portal(context: RequestContext): Promise<{ url: string }> {
    await this.assertOwner(context);
    // DQ2: managing the card no longer needs a verified account email; the portal configuration
    // cannot edit the Customer email, and a pending recipient change still blocks it below.
    const account = await this.account(context.companyId), state = await this.settings();
    if (!account?.customerId || !account.baseSubscriptionId || account.renewalMode !== 'CARD_AUTO' || account.activeEmailOperationId || !state.policy?.portalConfigurationId || !state.gates.portal_payment_method) throw billingError('BILLING_PORTAL_UNAVAILABLE', 'กรุณาติดต่อทีมงานเพื่อจัดการการชำระเงิน');
    const assertCurrent = async (tx: Prisma.TransactionClient) => {
      await lockPlanTermCompany(tx, context.companyId);
      await this.assertOwner(context, tx);
      const company = await tx.company.findUniqueOrThrow({ where: { id: context.companyId }, include: { planTerm: true } });
      if (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))
        throw billingError('BILLING_COMPANY_HELD', 'บริษัทอยู่ระหว่างตรวจสอบ กรุณาติดต่อทีมงาน');
      await tx.$queryRaw`SELECT id FROM "BillingSettings" WHERE id = ${state.settings.id} FOR UPDATE`;
      const current = await this.settings(tx), bound = await this.account(context.companyId, tx);
      if (!current.gates.portal_payment_method || current.settings.version !== state.settings.version || current.revision?.id !== state.revision?.id ||
          hashBilling(current.policy) !== hashBilling(state.policy) || bound?.id !== account.id || bound.version !== account.version || bound.customerId !== account.customerId)
        throw billingError('BILLING_PORTAL_UNAVAILABLE', 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดสถานะล่าสุดและลองใหม่');
    };
    await this.prisma.client.$transaction(assertCurrent);
    await this.stripe.assertAccount();
    const config = await this.stripe.request('GET', `/billing_portal/configurations/${state.policy.portalConfigurationId}`);
    // Use a narrowly configured portal. Subscription changes/cancel go through explicit commands.
    try { assertStripePortalConfiguration(config, state.policy.portalConfigurationId, this.stripe.livemode); } catch (error) {
      await this.issue(context.companyId, 'CONFIG_DRIFT', state.policy.portalConfigurationId);
      throw error;
    }
    await this.prisma.client.$transaction(assertCurrent);
    const returnUrl = new URL(`/companies/${context.companyId}/billing`, this.config.sesWebBaseUrl).toString();
    const session = await this.stripe.request('POST', '/billing_portal/sessions', { customer: account.customerId,
      configuration: state.policy.portalConfigurationId, return_url: returnUrl,
      flow_data: { type: 'payment_method_update' } });
    const url = safeStripeUrl(session.url, 'portal');
    if (!url || session.object !== 'billing_portal.session' || typeof session.id !== 'string' || !/^bps_[a-zA-Z0-9]+$/.test(session.id) ||
        session.livemode !== this.stripe.livemode || session.customer !== account.customerId ||
        stripeId(session.configuration) !== state.policy.portalConfigurationId || session.return_url !== returnUrl)
      throw billingError('BILLING_PORTAL_UNAVAILABLE', 'กรุณาลองใหม่หรือติดต่อทีมงาน');
    await this.prisma.client.$transaction(async tx => {
      await assertCurrent(tx);
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'billing.portal.opened',
        targetType: 'BillingAccount', targetId: account.id, requestId: context.requestId, result: 'SUCCESS', riskLevel: 'LOW',
        metadataJson: { action: 'portal_payment_method' } } });
    });
    return { url };
  }

  async attempt(context: RequestContext, id: string): Promise<BillingAttemptView> {
    await this.assertOwner(context);
    const account = await this.account(context.companyId);
    const attempt = account ? await this.prisma.client.billingAttempt.findFirst({ where: { id, billingAccountId: account.id } }) : null;
    if (!attempt) throw new NotFoundException();
    const invoice = await this.prisma.client.billingInvoice.findFirst({ where: { billingAccountId: account!.id, sourceAttemptId: attempt.id } });
    // The return page says "ใช้งานข้อเสนอพิเศษแล้ว" from the contract itself, not from a
    // browser-local breadcrumb that a refresh or a different device would lose.
    const snapshot = attempt.quoteSnapshot as unknown as BillingSnapshot;
    // The right this Checkout holds; one given back with an unpaid Checkout no longer names the attempt, so nothing shows.
    const right = snapshot.promotion ? await promotionForAttempt(this.prisma.client, attempt.id) : null;
    return { attemptId: attempt.id, state: attempt.status, errorCode: attempt.errorCode, observedAt: attempt.updatedAt.toISOString(),
      paymentState: invoice?.providerStatus === 'paid' ? 'PAID' : ['FAILED', 'EXPIRED'].includes(attempt.status) ? 'FAILED' : 'PENDING',
      applyState: invoice ? invoice.applyStatus as BillingStatus['applyState'] : 'NONE', invoiceReference: invoice?.id ?? null,
      ...(snapshot.quote.advanceDeal ? { advanceDeal: snapshot.quote.advanceDeal } : {}),
      ...(snapshot.deal ? { deal: { dealId: snapshot.deal.requestId, months: snapshot.deal.months,
        baseLabel: snapshot.quote.deal?.baseLabel ?? snapshot.quote.offer.label } } : {}),
      // Sales-event spec §3.6: the ticket is used once the payment is confirmed; a Checkout that ended unpaid released it.
      ...(snapshot.eventDiscount?.choice === 'USE' && !['FAILED', 'EXPIRED'].includes(attempt.status) ? { eventDiscount: {
        shownDiscountSatang: snapshot.eventDiscount.shownDiscountSatang, state: invoice?.providerStatus === 'paid' ? 'USED' as const : 'IN_PAYMENT' as const } } : {}),
      ...(right && right.state !== 'RELEASED' && !(right.state === 'RESERVED' && ['FAILED', 'EXPIRED'].includes(attempt.status)) ? { promotion: promotionUse(right, snapshot, account!, await renewalSetupIssue(this.prisma.client, account!, right)) } : {}) };
  }

  async resume(context: RequestContext, id: string): Promise<BillingCheckoutResult> {
    await this.attempt(context, id);
    const account = (await this.account(context.companyId))!;
    const attempt = await this.prisma.client.billingAttempt.findUniqueOrThrow({ where: { id } });
    const result = { attemptId: id, state: attempt.status, checkoutUrl: null };
    if (!attempt.checkoutSessionId || account.activeAttemptId !== id || ['COMPLETED', 'EXPIRED', 'FAILED'].includes(attempt.status)) return result;
    const state = await this.settings();
    const purchaseMode = (attempt.quoteSnapshot as unknown as BillingSnapshot).quote.purchaseMode ?? 'CARD_AUTO';
    if (!state.gates.new_sales || !state.gates[gateForMode(purchaseMode)] ||
        (state.revision?.id !== attempt.policyRevisionId && !await basePolicyUnchanged(this.prisma.client, state, attempt))) return result;
    await this.stripe.assertAccount();
    const session = await this.stripe.request('GET', `/checkout/sessions/${attempt.checkoutSessionId}`);
    if (session.mode !== ((attempt.quoteSnapshot as unknown as BillingSnapshot).repeat || paymentCheckoutSnapshot(attempt.quoteSnapshot as unknown as BillingSnapshot) ? 'payment' : 'subscription') || stripeId(session.customer) !== account.customerId || session.metadata?.billingAccountId !== account.id || session.metadata?.billingAttemptId !== id) throw billingError('BILLING_MAPPING_MISMATCH', 'กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง');
    await this.assertOwner(context);
    const company = await this.prisma.client.company.findUnique({ where: { id: context.companyId }, include: { planTerm: true } });
    if (!company || (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))) return result;
    return { ...result, checkoutUrl: session.status === 'open' ? safeStripeUrl(session.url, 'checkout') : null,
      ...(Number.isSafeInteger(session.expires_at) && session.expires_at > 0 && session.expires_at <= 8_640_000_000_000 ? { expiresAt: new Date(session.expires_at * 1000).toISOString() } : {}) };
  }

  async refresh(context: RequestContext) {
    await this.assertOwner(context);
    const account = await this.account(context.companyId);
    if (account) await this.prisma.client.billingAccount.update({ where: { id: account.id }, data: { nextReconcileAt: new Date() } });
    return { queued: account !== null };
  }

  async history(context: RequestContext, input: { cursor?: string; limit: number }): Promise<{ items: BillingInvoiceItem[]; nextCursor: string | null }> {
    await this.assertOwner(context);
    const account = await this.account(context.companyId);
    if (!account) return { items: [], nextCursor: null };
    const cursor = input.cursor ? await this.prisma.client.billingInvoice.findFirst({ where: { id: input.cursor, billingAccountId: account.id } }) : null;
    if (input.cursor && !cursor) throw new NotFoundException();
    const rows = await this.prisma.client.billingInvoice.findMany({ where: { billingAccountId: account.id,
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: input.limit + 1 });
    const page = rows.slice(0, input.limit);
    const attempts = page.some(row => row.sourceAttemptId) ? await this.prisma.client.billingAttempt.findMany({
      where: { billingAccountId: account.id, id: { in: page.flatMap(row => row.sourceAttemptId ? [row.sourceAttemptId] : []) } },
      select: { id: true, quoteSnapshot: true } }) : [];
    const snapshots = new Map(attempts.map(attempt => [attempt.id, attempt.quoteSnapshot]));
    return { items: page.map(row => ({ ...invoiceHistoryItem(row, snapshots.get(row.sourceAttemptId ?? '') ?? null),
      documentActions: { canResend: canResendDocuments(row, account) } })), nextCursor: rows.length > input.limit ? page.at(-1)!.id : null };
  }

  private async ownedInvoice(context: RequestContext, id: string) {
    await this.assertOwner(context);
    const company=await this.prisma.client.company.findUnique({where:{id:context.companyId},select:{status:true,planTerm:{select:{termDisabledAt:true}}}});
    if(!company||(company.status!=='ACTIVE'&&!(company.status==='DISABLED'&&company.planTerm?.termDisabledAt)))throw new ForbiddenException();
    const account=await this.account(context.companyId);
    const row=account?await this.prisma.client.billingInvoice.findFirst({where:{id,billingAccountId:account.id}}):null;
    if(!row||!account)throw new NotFoundException();return {account,row};
  }
  async adjustments(context: RequestContext, id: string, kind: BillingAdjustmentKind, cursor?: string) {
    const {account,row}=await this.ownedInvoice(context,id);
    const result=await readInvoiceAdjustments(this.stripe,account,row,kind,cursor);
    const current=await this.ownedInvoice(context,id);sameInvoiceSource(account,row,current.account,current.row);
    const attempt = current.row.sourceAttemptId ? await this.prisma.client.billingAttempt.findFirst({
      where: { id: current.row.sourceAttemptId, billingAccountId: current.account.id }, select: { quoteSnapshot: true } }) : null;
    return {...result,invoice:{...invoiceHistoryItem(current.row,attempt?.quoteSnapshot??null),paidAt:result.paidAt},canOpenDocuments:true,documentActions:{canResend:canResendDocuments(current.row,current.account)},recipientEmail:current.account.recipientEmail??null};
  }
  async document(context: RequestContext, id: string, kind: 'invoice'|'receipt'|'pdf'|'credit-note', creditNoteId?: string): Promise<{url:string}> {
    const {account,row}=await this.ownedInvoice(context,id);
    const result=await readInvoiceDocument(this.stripe,account,row,kind,creditNoteId);
    const current=await this.ownedInvoice(context,id);sameInvoiceSource(account,row,current.account,current.row);
    await this.prisma.client.auditLog.create({data:{companyId:context.companyId,actorUserId:context.userId,action:'billing.document.opened',
      targetType:'BillingInvoice',targetId:id,requestId:context.requestId,result:'SUCCESS',riskLevel:'LOW',metadataJson:{kind,...creditNoteId?{creditNoteId}:{}}}});
    return result;
  }
}
