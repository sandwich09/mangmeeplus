import { BillingEmailRecipient } from './billing-email-recipient';
import { assertBillingProfileUnchanged, requireBillingProfile, stripeBillingProfile, stripeBillingProfileMatches } from './billing-company-profile';
import { companyBillingProfile } from '@watchdog-bms/contracts';
import { assertAccountEmailProof, lockAccountEmail, verifiedAccountEmailProof } from '../../auth/application/account-email-state';
import type { EmailProof } from '../../auth/domain/logic/email-otp.logic';
import { BillingAdminCollection } from './billing-admin-collection';
import { effectivePlanCapacity } from '../../system-partner-management/domain/logic/plan-capacity';
import { assertNoPendingRefund, pendingRefund } from './billing-refund-source';
import { readInvoiceAdjustments, readInvoiceDocument, sameInvoiceSource } from './billing-invoice-details';
import type { BillingAdjustmentKind } from '@watchdog-bms/contracts';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BILLING_ACTIONS, BILLING_DRAFT_POLICY, billingOffer, type BillingCatalog, type BillingPolicy, type BillingQuote,
  type BillingCheckoutBody, type BillingCheckoutResult, type BillingStatus, type BillingAction, type BillingInvoiceItem, type BillingAttemptView, type BillingPurchaseMode } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { BillingAccount, Prisma } from '../../../generated/prisma/client';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { StripeClient, StripeRequestError, safeStripeUrl, stripeId } from '../infrastructure/stripe.client';
import { assertCompanyCanBuy, companyCanBuy, assertPolicyReady, assertStripePrice, assertStripePortalConfiguration, billingError, billingMonth, effectiveBillingGates, hashBilling, paidVariant, parseBillingPolicy, quoteTotals } from '../domain/billing-policy';

import { BillingRepeat, type RepeatSource } from './billing-repeat';
import { BillingCollection } from './billing-collection';
import { BillingPriceReturn } from './billing-price-return';
import { collectionContract, pendingChange, type ScheduledChange } from './billing-schedule';
import { restartFits, restartSource, type RestartSource } from './billing-restart';
import { fullPackagePurchaseImpact } from '../domain/billing-package';
import { isUpgrade, upgradeHistory, upgradePreview, type UpgradeSource } from './billing-upgrade';
import { capacityOptions, capacityValid, capacityImpact, capacityReview, parseCapacitySelection, purchasedCapacityOffer } from './billing-capacity';
import type { BillingCapacitySelection } from '@watchdog-bms/contracts';
import { PartnerLifecycleTransitionUseCase } from '../../system-partner-management/application/use-cases/partner-lifecycle-transition.use-case';

import { termProjectionHash } from '../domain/paid-invoice';
import { receiptQuotaSnapshot } from '../../line-ai/application/company-ocr-governance';
import { paidReceiptBalance } from './billing-receipt-grants';
import { trialReceiptCarryover, type TrialCarryoverSource } from './billing-trial-carryover';
import { billingState } from '../domain/billing-state';
import { planTermLockReason } from '../../system-partner-management/domain/logic/plan-term.logic';
import { BillingFreeDays } from './billing-free-days';
import { detectBillingIssue } from './billing-issues';
import { billingPurchaseSource, initialPurchaseSource } from './billing-purchase-source';
import type { BillingPurchaseSource } from '@watchdog-bms/contracts';
import { billingFeaturePlan, type BillingFeaturePlan } from './billing-feature-entitlements';
import { assertDealOfferUnchanged, assertDealSnapshot, dealOffer, dealPurchaseModes, dealSnapshot, dealSnapshotHash, type DealSource } from '../domain/deal-offer';
import { autoRenewOf, DEAL_KIND, dealSlipState } from '../../sales-console/domain/sales-deal.logic';

/** D-P5-6: the future contract a `SCHEDULE_PRICE_RETURN` writes. The invoice that applies it puts
 *  the shop back on the tier's default menus, AI credit and limits (Q1) even though it is a RENEWAL. */
export type DealReturnSource = { dealRequestId: string; returnAt: string };
export type BillingSnapshot = { trialCarryover?: TrialCarryoverSource; emailProof?: EmailProof; quote: BillingQuote; deal?: DealSource; dealReturn?: DealReturnSource; priceId: string; productId?: string; policy: BillingPolicy; settingsVersion?: number; termVersion: string | null; termHash: string; featurePlan?: BillingFeaturePlan; repeat?: RepeatSource; restart?: RestartSource; upgrade?: UpgradeSource; oneTime?: { invoiceId: string; paidThrough: string; anchorDay: number; offerKey: string; interval: string }; capacity?: BillingCapacitySelection; planChangeId?: string; pendingChange?: { id: string; version: number; proposed: ScheduledChange } };
const oneTimeMode = (mode: BillingPurchaseMode | undefined) => mode === 'CARD_ONCE' || mode === 'PROMPTPAY_ONCE';
/**
 * D-P5-4 — is this pinned quote an AUTO-RENEWING deal? The quote refuses every other pairing, so
 * the purchase mode alone is proof: a deal on a renewing mode pinned the deal's own recurring
 * Price into `snapshot.priceId`, while a one-time deal pinned the catalog Price.
 */
const autoRenewDealSnapshot = (snapshot: BillingSnapshot) => !!snapshot.deal && !oneTimeMode(snapshot.quote.purchaseMode);
const paymentCheckoutMode = (mode: BillingPurchaseMode | undefined) => oneTimeMode(mode) || mode === 'PROMPTPAY_RENEW';
const gateForMode = (mode: BillingPurchaseMode): BillingAction => mode === 'CARD_ONCE' ? 'card_once' : mode === 'PROMPTPAY_ONCE' ? 'promptpay_once' : mode === 'PROMPTPAY_RENEW' ? 'promptpay_renew' : 'new_sales';
function assertPurchaseMode(mode: unknown): asserts mode is BillingPurchaseMode {
  if (!['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW'].includes(String(mode)))
    throw billingError('BILLING_MODE_NOT_READY', 'วิธีชำระเงินนี้ยังไม่เปิดให้บริการ');
}
const CLOSED_GATES = Object.fromEntries(BILLING_ACTIONS.map((key) => [key, false]));

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfigService, readonly stripe: StripeClient,
    @Optional() private readonly lifecycle?: PartnerLifecycleTransitionUseCase) {}

  get emailRecipient() { return new BillingEmailRecipient(this.prisma, this.stripe, this); }
  get freeDays() { return new BillingFreeDays(this.prisma, this, this.lifecycle); }
  get repeater() { return new BillingRepeat(this.prisma, this.stripe, this, this.lifecycle); }
  get collection() { return new BillingCollection(this.prisma, this.stripe, this); }
  get priceReturn() { return new BillingPriceReturn(this.prisma, this.stripe, this); }

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
      include: { user: { select: { status: true } }, roles: { include: { role: true } } },
    });
    if (!member || member.status !== 'ACTIVE' || member.user.status !== 'ACTIVE' ||
        !member.roles.some((r) => r.role.key === 'OWNER' && r.role.status === 'ACTIVE')) throw new ForbiddenException('เฉพาะเจ้าของบริษัทเท่านั้น');
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
    return { settings, revision: policy ? revision : null, policy, gates: effectiveBillingGates(settings.gatesJson) };
  }

  async account(companyId: string, tx: Prisma.TransactionClient = this.prisma.client): Promise<BillingAccount | null> {
    if (!this.config.stripeAccountId) return null;
    return tx.billingAccount.findUnique({ where: { companyId_stripeAccountId_livemode: {
      companyId, stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode,
    } } });
  }

  async purchaseSource(company: { planTerm: Parameters<typeof billingPurchaseSource>[0] }, account: BillingAccount | null,
    tx: Prisma.TransactionClient = this.prisma.client): Promise<BillingPurchaseSource> {
    const paid = account ? await tx.billingInvoice.findFirst({ where: { billingAccountId: account.id, providerStatus: 'paid' }, select: { id: true } }) : null;
    return billingPurchaseSource(company.planTerm, account, !!paid);
  }

  async catalog(): Promise<BillingCatalog> {
    const state = this.stripe.enabled ? await this.settings() : null;
    const offers = (['STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999'] as const)
      .flatMap((tier) => (['month', 'year'] as const).map((interval) => {
        const offer = billingOffer(tier, interval, state?.policy);
        if (tier !== 'ENTERPRISE_1999' && state?.policy && state.policy.salesCompanyIds?.length !== 0 && state.gates.new_sales &&
            state.policy.priceIds[`${tier}:${interval}`]) {
          try { assertPolicyReady(state.policy); offer.availability = 'AVAILABLE'; offer.reason = null; } catch { /* Draft remains unavailable. */ }
        }
        return offer;
      }));
    const generatedAt = new Date();
    return { schemaVersion: 1, mode: this.stripe.enabled ? (this.stripe.livemode ? 'LIVE' : 'TEST') : 'DISABLED', policyRevision: state?.revision?.id ?? null,
      catalogRevision: hashBilling([state?.settings.version ?? 0, state?.revision?.id ?? null, offers, state?.policy?.taxTreatment ?? null]),
      generatedAt: generatedAt.toISOString(), validUntil: new Date(generatedAt.getTime() + 30_000).toISOString(), taxTreatment: state?.policy?.taxTreatment ?? null,
      // R1: no `trial` block any more — a new shop gets no free days, so advertising them here
      // would be the page promising what provisioning refuses to grant (Owner 2026-09-20).
      offers };
  }

  async usage(companyId: string): Promise<BillingStatus['usage']> {
    const { monthKey, resetsAt } = billingMonth();
    const quota = await receiptQuotaSnapshot(this.prisma, companyId, monthKey);
    const used = quota.usedCount, limit = quota.planLimit;
    return { used, limit, remaining: limit === null ? null : Math.max(0, limit - used),
      resetsAt: quota.cadence ? null : resetsAt, cadence: quota.cadence ?? 'LEGACY_MONTH', expiresAt: quota.expiresAt ?? null,
      ...(quota.monthlyAllowance ? { monthlyAllowance: quota.monthlyAllowance } : {}) };
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
      const invoice = await tx.billingInvoice.findFirst({ where: { billingAccountId: account.id, providerStatus: 'paid', applyStatus: 'HELD',
        errorCode: 'BILLING_CAP_SELECTION_REQUIRED', contractSnapshot: { path: ['planChangeId'], equals: id }, appliedAt: null } });
      if (!pending || pending.row.id !== id || pending.row.version !== expectedVersion || !invoice || account.activeAttemptId || account.activeCollectionOperationId ||
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

  async quote(context: RequestContext, body: { offerKey?: string; interval?: string; billingEmail: string; capacity?: unknown; purchaseMode?: BillingPurchaseMode; dealId?: string }): Promise<BillingQuote> {
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
    const emailProof = await verifiedAccountEmailProof(this.prisma.client, context.userId);
    // Retain the old input shape for cached clients; the reviewed quote always derives its recipient from the account.
    const company = await this.prisma.client.company.findUnique({ where: { id: context.companyId }, include: { planTerm: true } });
    if (!company) throw new NotFoundException();
    const term = company.planTerm;
    const billingProfile = requireBillingProfile(company);
    if (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && term?.termDisabledAt)) throw billingError('BILLING_COMPANY_HELD', 'บริษัทอยู่ระหว่างตรวจสอบ กรุณาติดต่อทีมงาน');
    const existing = await this.account(company.id);
    // D-P3-3/R-676-3: converting a live subscription into a deal is Phase 4 (Q7/S34). Until then
    // the team clears the subscription first, so the customer never pays twice for one month.
    if (deal && existing?.baseSubscriptionId && existing.paidThrough && existing.paidThrough > new Date())
      throw billingError('CONTROL_DEAL_SUBSCRIPTION_REVIEW', 'ร้านนี้มีสมาชิกที่ยังใช้งานอยู่ ทีมงานจะติดต่อกลับ');
    if (existing?.renewalMode === 'PROMPTPAY_RENEW' && existing.paidThrough && existing.paidThrough > new Date())
      throw billingError('BILLING_PLAN_CHANGE_REQUIRED', 'สมาชิก QR ที่กำลังใช้งานต้องจัดการบิลหรือรอสิ้นรอบก่อนซื้อแพ็กเกจใหม่');
    if (purchaseMode === 'PROMPTPAY_RENEW' && existing?.paidThrough && existing.paidThrough > new Date())
      throw billingError('BILLING_MODE_CHANGE_PENDING', 'กรุณารอให้แพ็กเกจปัจจุบันสิ้นสุดก่อนเริ่มต่ออายุด้วย QR');
    if (existing?.paidThrough && existing.paidThrough > new Date() && existing.renewalMode !== 'NONE' &&
        (oneTimeMode(purchaseMode) !== oneTimeMode(existing.renewalMode as BillingPurchaseMode)))
      throw billingError('BILLING_MODE_CHANGE_PENDING', 'กรุณารอให้แพ็กเกจปัจจุบันสิ้นสุดก่อนเปลี่ยนวิธีต่ออายุ');
    // Preserve the existing pending-checkout contract while a paid invoice is HELD before apply;
    // its term link is intentionally incomplete until reconciliation commits.
    if (existing?.activeAttemptId) throw billingError('BILLING_EXISTING_SUBSCRIPTION', 'มีรายการเดิมอยู่แล้ว กรุณาตรวจสถานะหรือจัดการสมาชิก');
    const purchaseSource = await this.purchaseSource(company, existing);
    if (purchaseSource === 'PAID_OTHER_MODE' || purchaseSource === 'SOURCE_INCONSISTENT')
      throw billingError('BILLING_SOURCE_REVIEW_REQUIRED', 'ข้อมูลการชำระเงินเดิมไม่ตรงกัน กรุณาติดต่อทีมงานก่อนเริ่มรายการใหม่');
    const featurePreview = deal ? await billingFeaturePlan(this.prisma.client, company.id, deal.featureKeys)
      : initialPurchaseSource(purchaseSource) ? await billingFeaturePlan(this.prisma.client, company.id) : null;
    if (existing?.customerId) {
      const customer = await this.stripe.request('GET', `/customers/${existing.customerId}`);
      if (customer.id !== existing.customerId || customer.metadata?.billingAccountId !== existing.id || customer.email !== emailProof.email)
        throw billingError('BILLING_RECIPIENT_UPDATE_REQUIRED', 'กรุณาตรวจและยืนยันเปลี่ยนผู้รับเอกสารของบริษัทนี้ก่อนเริ่มชำระเงินใหม่');
    }
    if (!deal) offer = purchasedCapacityOffer(offer, term, existing);
    if(existing)await assertNoPendingRefund(this.prisma.client,existing);
    if (existing?.activeEmailOperationId) throw billingError('BILLING_EMAIL_UPDATE_PENDING', 'กรุณาตรวจรายการเปลี่ยนผู้รับเอกสารให้เสร็จก่อน');
    if (existing?.activeCollectionOperationId) throw billingError('BILLING_COLLECTION_PENDING', 'กรุณาตรวจคำสั่งต่ออายุเดิมให้เสร็จก่อนซื้อเพิ่ม');
    await this.stripe.assertAccount();
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
    if (paymentCheckoutMode(purchaseMode) && existing?.baseSubscriptionId && !restart)
      throw billingError('BILLING_MODE_CHANGE_PENDING', 'กรุณายุติสมาชิกเดิมและรอให้สิทธิ์สิ้นสุดก่อนซื้อครั้งเดียว');
    if (oneTimeMode(existing?.renewalMode as BillingPurchaseMode) && !existing?.contractAttemptId)
      throw billingError('BILLING_PACKAGE_STATE_INVALID', 'ข้อมูลแพ็กเกจเดิมต้องตรวจสอบ กรุณาติดต่อทีมงาน');
    const previous = existing?.renewalMode === 'CARD_ONCE' || existing?.renewalMode === 'PROMPTPAY_ONCE'
      ? await this.prisma.client.billingInvoice.findFirst({ where: { billingAccountId: existing.id, sourceAttemptId: existing.contractAttemptId!,
        applyStatus: 'APPLIED', appliedAt: { not: null } }, orderBy: { createdAt: 'desc' } }) : null;
    const previousSnapshot = previous?.contractSnapshot as BillingSnapshot | null;
    const oneTime = oneTimeMode(purchaseMode) && existing?.paidThrough && existing.paidThrough > new Date() ? (() => {
      if (!previous || previous.refundedSatang || previous.disputed || !previousSnapshot || !existing.billingAnchorDay ||
          previous.periodEnd.getTime() !== existing.paidThrough!.getTime() ||
          // §19.3: a deal appends after the running one-time term whatever tier it was — the
          // deal's own limits take effect at apply. A catalog top-up still needs the same package.
          (!deal && (previousSnapshot.quote.offer.offerKey !== offer.offerKey ||
            previousSnapshot.quote.offer.interval !== offer.interval)))
        throw billingError('BILLING_PLAN_CHANGE_REQUIRED', 'ซื้อเพิ่มระหว่างงวดได้เฉพาะแพ็กเกจและรอบเดิม');
      return { invoiceId: previous.id, paidThrough: existing.paidThrough.toISOString(), anchorDay: existing.billingAnchorDay,
        offerKey: offer.offerKey, interval: offer.interval };
    })() : undefined;
    const capacity = body.capacity === undefined ? undefined : parseCapacitySelection(body.capacity);
    let capacityPreview: BillingQuote['capacity'];
    if (capacity) {
      if (deal || (existing?.baseSubscriptionId && !restart) || oneTime) throw capacityReview();
      const options = await this.capacity(context, offer.offerKey, offer.interval);
      if (!capacityValid(options, capacity)) throw capacityReview();
      capacityPreview = capacityImpact(options, capacity);
      // S45: a deal skips the capacity review. Limits below current usage mean "no new branches
      // or users" (P29 §4D); nothing existing is suspended, and the team saw the warning already.
    } else if (!deal && (!existing?.baseSubscriptionId || restart) && !oneTime && !await restartFits(this.prisma.client, company.id, offer)) throw capacityReview();
    if (existing?.baseSubscriptionId && !restart && !state.gates.plan_changes) throw billingError('BILLING_REPEAT_NOT_READY', 'การซื้อแพ็กเกจซ้ำยังไม่เปิดให้บริการ');
    let repeat: RepeatSource | undefined, upgrade: UpgradeSource | undefined;
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
    const quoteId = randomUUID();
    const quote: BillingQuote = { quoteId, companyId: company.id, companyName: company.name, policyRevision: state.revision.id,
      purchaseMode,
      expiresAt: new Date(Date.now() + 600_000).toISOString(), offer: { ...offer, availability: 'AVAILABLE', reason: null },
      ...quoteTotals(upgrade?.amountSatang ?? offer.priceSatang, state.policy.taxTreatment), taxTreatment: state.policy.taxTreatment!, consentRevision: state.policy.consentRevision,
      paidStart: state.policy.paidStart!, billingEmail: emailProof.email, billingProfile,
      trialEndsAt: term?.tierKey === 'FREE_TRIAL_15' && term.termEndsAt > new Date() ? term.termEndsAt.toISOString() : null,
      previousSource: purchaseSource, previousTermEndsAt: term?.termEndsAt.toISOString() ?? null,
      ...(featurePreview ? { featureImpact: featurePreview.impact } : {}),
      ...(deal ? { deal: { dealId: dealRow!.id, months: deal.months, description: deal.description, baseLabel: catalogOffer.label } } : {}),
      usage: await this.usage(company.id) };
    if (capacityPreview) quote.capacity = capacityPreview;
    const impact = fullPackagePurchaseImpact({ tier, interval, offer, verifiedPaidAt: new Date(Math.floor(Date.now() / 1000) * 1000),
      paidThrough: repeat ? new Date(repeat.paidThrough) : oneTime ? new Date(oneTime.paidThrough) : null,
      remainingPaidReceipts: repeat || oneTime ? quote.usage.remaining ?? 0 : 0, anchorDay: repeat?.anchorDay ?? oneTime?.anchorDay });
    quote.purchase = { kind: repeat || oneTime ? 'REPEAT' : restart ? 'RESTART' : 'INITIAL', previousPaidThrough: repeat?.paidThrough ?? oneTime?.paidThrough ?? restart?.paidThrough ?? null,
      ...(repeat && repeat.sourceInterval !== interval && !existing?.pendingPlanChangeId ? { previousInterval: repeat.sourceInterval } : {}),
      projectedPaidThrough: impact.paidThrough.toISOString(), receiptUnitsAdded: impact.receiptUnitsAdded,
      projectedRemainingReceipts: impact.remainingReceipts + (repeat || oneTime ? 0 : (await paidReceiptBalance(this.prisma.client,company.id,null)).remaining) };
    if (upgrade) {
      quote.expiresAt = new Date(Date.parse(upgrade.prorationAt)+600000).toISOString();
      quote.purchase = { kind: 'UPGRADE', previousPaidThrough: repeat!.paidThrough, projectedPaidThrough: repeat!.paidThrough,
        receiptUnitsAdded: upgrade.receiptUnitsAdded, projectedRemainingReceipts: (quote.usage.remaining ?? 0)+upgrade.receiptUnitsAdded };
      quote.upgrade = { prorationAt: upgrade.prorationAt, nextRenewalTotalSatang: quoteTotals(offer.priceSatang, state.policy.taxTreatment).totalSatang,
        segments: upgrade.segments.map(({start,end,amountSatang,receiptUnitsAdded})=>({start,end,amountSatang,receiptUnitsAdded})) };
    }
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
    const dealSource: DealSource | undefined = deal ? { requestId: dealRow!.id, snapshotHash: dealSnapshotHash(dealRow!.offerSnapshotJson),
      months: deal.months, salesUserId: dealRow!.salesUserId!, aiMonthlyBudgetSatang: deal.aiMonthlyBudgetSatang,
      ...(auto.autoRenew ? { cadence: auto.cadence, cycles: auto.cycles } : {}) } : undefined;
    const snapshot: BillingSnapshot = { ...(trialCarryover ? { trialCarryover } : {}), emailProof, ...(dealSource ? { deal: dealSource } : {}), ...(pending ? { pendingChange: { id: pending.row.id, version: pending.row.version, proposed: pending.proposed } } : {}), quote, priceId: snapshotPriceId, productId, policy: state.policy, settingsVersion: state.settings.version, termVersion: term?.updatedAt.toISOString() ?? null, termHash: termProjectionHash(term), ...(featurePreview ? { featurePlan: featurePreview.plan } : {}), ...(repeat ? { repeat } : {}), ...(oneTime ? { oneTime } : {}), ...(restart ? { restart } : {}), ...(upgrade ? { upgrade } : {}), ...(capacity ? { capacity } : {}) };
    await this.prisma.client.billingQuote.create({ data: { id: quoteId, companyId: company.id, initiatingUserId: context.userId,
      policyRevisionId: state.revision.id, snapshotJson: snapshot as unknown as Prisma.InputJsonValue, expiresAt: new Date(quote.expiresAt) } });
    return quote;
  }

  async checkout(context: RequestContext, body: BillingCheckoutBody, key: string): Promise<BillingCheckoutResult> {
    if (!/^[a-zA-Z0-9_-]{16,120}$/.test(key)) throw billingError('BILLING_IDEMPOTENCY_REQUIRED', 'กรุณาเริ่มตรวจสอบรายการใหม่');
    if (!this.stripe.enabled) throw billingError('BILLING_NOT_READY', 'ระบบชำระเงินยังไม่เปิดให้บริการ');
    const requestHash = hashBilling({ quoteId: body.quoteId, consentRevision: body.consentRevision, accepted: body.accepted, channel: body.channel });
    const reserved = await this.prisma.client.$transaction(async (tx) => {
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
      await lockAccountEmail(tx, context.userId);
      await assertAccountEmailProof(tx, context.userId, snapshot.emailProof);
      if(account)await assertNoPendingRefund(tx,account);
      if (account?.activeEmailOperationId) throw billingError('BILLING_EMAIL_UPDATE_PENDING', 'กรุณาตรวจรายการเปลี่ยนผู้รับเอกสารให้เสร็จก่อน');
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
      const source = await this.purchaseSource(company, account, tx);
      if (source === 'PAID_OTHER_MODE' || source === 'SOURCE_INCONSISTENT') throw billingError('BILLING_SOURCE_REVIEW_REQUIRED', 'ข้อมูลการชำระเงินเดิมไม่ตรงกัน กรุณาติดต่อทีมงาน');
      if (snapshot.quote.previousSource && source !== snapshot.quote.previousSource) throw billingError('BILLING_QUOTE_STALE', 'แพ็กเกจเดิมเปลี่ยน กรุณาตรวจสอบใหม่');
      if ((initialPurchaseSource(source) || snapshot.deal) && (!snapshot.featurePlan || (await billingFeaturePlan(tx, context.companyId)).plan.sourceHash !== snapshot.featurePlan.sourceHash))
        throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์เมนูเปลี่ยน กรุณาตรวจสอบใหม่');
      if ((company.planTerm?.updatedAt.toISOString() ?? null) !== snapshot.termVersion) throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์บริษัทเปลี่ยน กรุณาตรวจสอบใหม่');
      if (account?.activeAttemptId || (account?.baseSubscriptionId && !snapshot.repeat && !snapshot.restart)) throw billingError('BILLING_PURCHASE_PENDING', 'มีรายการชำระเงินอยู่แล้ว กรุณาตรวจสถานะเดิม');
      if (snapshot.restart && (!account || account.baseSubscriptionId !== snapshot.restart.subscriptionId || account.contractAttemptId !== snapshot.restart.contractAttemptId ||
        account.paidThrough?.toISOString() !== snapshot.restart.paidThrough || account.termProjectionHash !== snapshot.restart.termHash)) throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์หรือสมาชิกเดิมเปลี่ยน กรุณาตรวจสอบใหม่');
      if (!snapshot.deal && !snapshot.repeat && !snapshot.oneTime && !(snapshot.capacity ? capacityValid(await capacityOptions(tx, context.companyId, snapshot.quote.offer), snapshot.capacity) :
        await restartFits(tx, context.companyId, snapshot.quote.offer))) throw billingError('BILLING_QUOTE_STALE', 'สาขาหรือผู้ใช้เปลี่ยน กรุณาตรวจการเลือกใหม่');
      if (snapshot.oneTime) {
        const source = await tx.billingInvoice.findFirst({ where: { id: snapshot.oneTime.invoiceId, billingAccountId: account?.id,
          applyStatus: 'APPLIED', appliedAt: { not: null } } });
        if (!account || !source || source.refundedSatang || source.disputed || account.baseSubscriptionId ||
            !account.paidThrough || account.paidThrough.toISOString() !== snapshot.oneTime.paidThrough ||
            account.billingAnchorDay !== snapshot.oneTime.anchorDay || account.termProjectionHash !== snapshot.termHash ||
            source.periodEnd.getTime() !== account.paidThrough.getTime())
          throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์หรือรายการเดิมเปลี่ยน กรุณาตรวจสอบใหม่');
      }
      if (snapshot.repeat && (!state.gates.plan_changes || account?.baseSubscriptionId !== snapshot.repeat.subscriptionId ||
          account.paidThrough?.toISOString() !== snapshot.repeat.paidThrough || account.termProjectionHash !== snapshot.termHash)) throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์หรือรายการเดิมเปลี่ยน กรุณาตรวจสอบใหม่');
      if ((account?.pendingPlanChangeId ?? null) !== (snapshot.pendingChange?.id ?? null) && !snapshot.restart) throw billingError('BILLING_QUOTE_STALE', 'คำสั่งเปลี่ยนแพ็กเกจเปลี่ยน กรุณาตรวจสอบใหม่');
      if (snapshot.pendingChange && (await tx.billingOperation.findUnique({ where: { id: snapshot.pendingChange.id } }))?.version !== snapshot.pendingChange.version) throw capacityReview();
      if (snapshot.upgrade && (!account || (await upgradeHistory(tx, account, snapshot.quote.offer, snapshot.policy, snapshot.upgrade.prorationAt)).sourceHash !== snapshot.upgrade.sourceHash))
        throw billingError('BILLING_QUOTE_STALE', 'ประวัติแพ็กเกจเปลี่ยน กรุณาตรวจส่วนต่างใหม่');
      if (!account) account = await tx.billingAccount.create({ data: { companyId: context.companyId, stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode } });
      const attempt = await tx.billingAttempt.create({ data: { billingAccountId: account.id, initiatingUserId: context.userId, quoteId: quote.id,
        channel: body.channel, idempotencyKey: key, requestHash, quoteSnapshot: quote.snapshotJson!, policyRevisionId: quote.policyRevisionId,
        ...(snapshot.deal ? { dealRequestId: snapshot.deal.requestId } : {}),
        consentRevision: body.consentRevision, consentAt: new Date() } });
      await tx.billingAccount.update({ where: { id: account.id }, data: { activeAttemptId: attempt.id, version: { increment: 1 } } });
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
          await lockAccountEmail(tx, context.userId);
          await assertAccountEmailProof(tx, context.userId, snapshot.emailProof);
        });
        customerRequestUnconfirmed = true;
        const customer = await this.stripe.request('POST', '/customers', { ...stripeBillingProfile(snapshot.quote.billingProfile!), email: snapshot.quote.billingEmail,
          metadata: { billingAccountId: account.id } }, `mm:${account.id}:customer`);
        if (typeof customer.id !== 'string' || !customer.id.startsWith('cus_')) throw new StripeRequestError('UNKNOWN', 'invalid_customer');
        customerId = customer.id;
        await this.prisma.client.billingAccount.updateMany({ where: { id: account.id, customerId: null }, data: { customerId } });
        const mapped = await this.prisma.client.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
        if (mapped.customerId !== customerId) throw new StripeRequestError('UNKNOWN', 'customer_binding_changed');
        customerRequestUnconfirmed = false;
      }
      const customer = await this.stripe.request('GET', `/customers/${customerId}`);
      if (customer.id !== customerId || customer.email !== snapshot.quote.billingEmail || customer.metadata?.billingAccountId !== account.id)
        throw billingError('BILLING_RECIPIENT_UPDATE_REQUIRED', 'ผู้รับเอกสารเปลี่ยนแล้ว กรุณาตรวจข้อมูลบริษัทก่อนเริ่มชำระเงินใหม่');
      if (!stripeBillingProfileMatches(customer, snapshot.quote.billingProfile!)) {
        // Retain an ambiguous profile write until its original idempotent command is settled.
        // No Checkout can be sent while this marker is unconfirmed.
        const profileSync = { startedAt: new Date().toISOString(), customerId, confirmed: false };
        await this.prisma.client.billingAttempt.update({ where: { id: attempt.id }, data: { collectionJson: { profileSync } } });
        customerRequestUnconfirmed = true;
        const updated = await this.stripe.request('POST', `/customers/${customerId}`,
          stripeBillingProfile(snapshot.quote.billingProfile!), `mm:${attempt.id}:billing-profile`);
        if (updated.id !== customerId || updated.metadata?.billingAccountId !== account.id || !stripeBillingProfileMatches(updated, snapshot.quote.billingProfile!))
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
            state.revision?.id !== attempt.policyRevisionId || state.settings.version !== snapshot.settingsVersion) throw billingError('BILLING_SALES_CLOSED', 'หยุดรับรายการใหม่ชั่วคราว');
        assertCompanyCanBuy(state.policy, context.companyId);
        const company = await tx.company.findUnique({ where: { id: context.companyId }, include: { planTerm: true } });
        if (!company || (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))) throw billingError('BILLING_COMPANY_HELD', 'บริษัทอยู่ระหว่างตรวจสอบ');
        assertBillingProfileUnchanged(company, snapshot.quote);
        const source = await this.purchaseSource(company, await this.account(context.companyId, tx), tx);
        if (source === 'PAID_OTHER_MODE' || source === 'SOURCE_INCONSISTENT' || (snapshot.quote.previousSource && source !== snapshot.quote.previousSource))
          throw billingError('BILLING_QUOTE_STALE', 'แพ็กเกจเดิมเปลี่ยน กรุณาตรวจสอบใหม่');
        if ((initialPurchaseSource(source) || snapshot.deal) && (!snapshot.featurePlan || (await billingFeaturePlan(tx, context.companyId)).plan.sourceHash !== snapshot.featurePlan.sourceHash))
          throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์เมนูเปลี่ยน กรุณาตรวจสอบใหม่');
        if ((company.planTerm?.updatedAt.toISOString() ?? null) !== snapshot.termVersion || company.name !== snapshot.quote.companyName) throw billingError('BILLING_QUOTE_STALE', 'ข้อมูลบริษัทหรือสิทธิ์เปลี่ยน กรุณาตรวจสอบใหม่');
        await lockAccountEmail(tx, context.userId);
        await assertAccountEmailProof(tx, context.userId, snapshot.emailProof);
        const changed = await tx.billingAttempt.updateMany({ where: { id: attempt.id, status: 'CREATING', version: 0 }, data: { status: 'REQUESTING', version: { increment: 1 } } });
        if (changed.count !== 1) throw billingError('BILLING_PURCHASE_PENDING', 'กำลังตรวจสอบรายการเดิม');
      });
      const origin = this.config.sesWebBaseUrl;
      if (!origin) throw new StripeRequestError('REJECTED', 'missing_web_origin');
      const returnUrl = new URL(`/companies/${context.companyId}/billing/return?attempt=${attempt.id}`, origin).toString();
      if (account.customerId) {
        const customer = await this.stripe.request('GET', `/customers/${customerId}`);
        if (customer.id !== customerId || customer.email !== snapshot.quote.billingEmail || customer.metadata?.billingAccountId !== account.id)
          throw billingError('BILLING_RECIPIENT_UPDATE_REQUIRED', 'ผู้รับเอกสารเปลี่ยนแล้ว กรุณาตรวจข้อมูลบริษัทก่อนเริ่มชำระเงินใหม่');
      }
      await this.assertTaxSettings(snapshot.policy);
      if (paymentCheckoutMode(snapshot.quote.purchaseMode)) {
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
      const once = paymentCheckoutMode(snapshot.quote.purchaseMode);
      const session = await this.stripe.request('POST', '/checkout/sessions', once ? {
        mode: 'payment', customer: customerId, client_reference_id: attempt.id,
        payment_method_types: [snapshot.quote.purchaseMode?.startsWith('PROMPTPAY') ? 'promptpay' : 'card'],
        metadata, payment_intent_data: { metadata },
        invoice_creation: { enabled: true, invoice_data: { metadata,
          ...(snapshot.policy.taxTreatment !== 'NOT_VAT_REGISTERED' && snapshot.policy.issuer ? { account_tax_ids: [snapshot.policy.issuer.stripeTaxId] } : {}) } },
        line_items: [{ quantity: 1, price_data: { product: snapshot.productId, currency: 'thb',
          unit_amount: snapshot.quote.offer.priceSatang, tax_behavior: snapshot.policy.taxTreatment === 'EXCLUSIVE_VAT_7' ? 'exclusive' : 'inclusive' },
          ...(snapshot.policy.taxRateId ? { tax_rates: [snapshot.policy.taxRateId] } : {}) }],
        success_url: returnUrl, cancel_url: returnUrl, locale: 'th', billing_address_collection: 'required',
        expires_at: Math.floor(Date.now() / 1000) + 1800,
      } : {
        mode: 'subscription', customer: customerId, client_reference_id: attempt.id, payment_method_types: ['card'],
        line_items: [{ price: snapshot.priceId, quantity: 1, ...(snapshot.policy.taxRateId ? { tax_rates: [snapshot.policy.taxRateId] } : {}) }],
        success_url: returnUrl, cancel_url: returnUrl, locale: 'th', billing_address_collection: 'required',
        metadata, subscription_data: { billing_mode: { type: 'classic' }, metadata },
        expires_at: Math.floor(Date.now() / 1000) + 1800,
      }, `mm:${attempt.id}:checkout`);
      if (typeof session.id !== 'string' || !session.id.startsWith('cs_') || session.object !== 'checkout.session' || session.mode !== (once ? 'payment' : 'subscription') ||
          session.livemode !== account.livemode || session.client_reference_id !== attempt.id ||
          stripeId(session.customer) !== customerId || session.metadata?.billingAttemptId !== attempt.id || session.metadata?.billingAccountId !== account.id || !safeStripeUrl(session.url, 'checkout')) throw new StripeRequestError('UNKNOWN', 'invalid_checkout');
      await this.prisma.client.billingAttempt.updateMany({ where: { id: attempt.id, status: 'REQUESTING' }, data: { status: 'OPEN', checkoutSessionId: session.id, version: { increment: 1 } } });
      const current = await this.prisma.client.billingAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      return { attemptId: attempt.id, state: current.status, checkoutUrl: current.status === 'OPEN' ? safeStripeUrl(session.url, 'checkout') : null };
    } catch (error) {
      const code = error instanceof StripeRequestError ? error.code : 'command_unconfirmed';
      // Only release a reservation when we know no financial request succeeded. A network timeout
      // or malformed provider success retains it for reconciliation and cannot permit a second sale.
      if ((!financialRequestStarted && !customerRequestUnconfirmed) || (error instanceof StripeRequestError && error.outcome === 'REJECTED')) {
        await this.prisma.client.$transaction(async (tx) => {
          await lockPlanTermCompany(tx, context.companyId);
          const changed = await tx.billingAttempt.updateMany({ where: { id: attempt.id, status: { in: ['CREATING', 'REQUESTING'] } }, data: { status: 'FAILED', errorCode: code, version: { increment: 1 } } });
          if (changed.count) await tx.billingAccount.updateMany({ where: { id: account.id, activeAttemptId: attempt.id }, data: { activeAttemptId: null, version: { increment: 1 } } });
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
    if (initialPurchaseSource(purchaseSource)) {
      try { await billingFeaturePlan(this.prisma.client, company.id); }
      catch (error) {
        if (!(error instanceof ConflictException) || (error.getResponse() as { code?: string }).code !== 'BILLING_ENTITLEMENT_REVIEW_REQUIRED') throw error;
        featureReady = false;
      }
    }
    const invoice = account ? await this.prisma.client.billingInvoice.findFirst({ where: { billingAccountId: account.id }, orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }] }) : null;
    const attempt = account?.activeAttemptId ? await this.prisma.client.billingAttempt.findUnique({ where: { id: account.activeAttemptId } }) : null;
    const settings = this.stripe.enabled ? await this.settings() : null;
    const state = billingState(company, account, invoice, attempt), held = state.accessState === 'HELD';
    const allowedActions: BillingAction[] = [];
    const renewalMode = (account?.renewalMode !== 'NONE' ? account?.renewalMode : account?.baseSubscriptionId ? 'CARD_AUTO' : 'NONE') as BillingStatus['renewalMode'];
    const eligible = companyCanBuy(settings?.policy ?? null, company.id);
    const purchaseReady = featureReady && purchaseSource !== 'PAID_OTHER_MODE' && purchaseSource !== 'SOURCE_INCONSISTENT';
    let policyReady = false;
    if (settings?.policy) { try { assertPolicyReady(settings.policy); policyReady = true; } catch { /* Keep incomplete policies closed. */ } }
    if (settings?.policy && policyReady && !held) {
      if (purchaseReady && !account?.baseSubscriptionId && !account?.activeAttemptId && !account?.activeCollectionOperationId && settings.gates.new_sales && eligible) allowedActions.push('new_sales');
      if (purchaseReady && account?.baseSubscriptionId && !account.activeAttemptId && !account.activeCollectionOperationId &&
        ['canceled', 'incomplete_expired'].includes(account.subscriptionState) && account.paidThrough && account.paidThrough <= new Date() &&
        !(account.graceEndsAt && account.graceEndsAt > new Date()) && settings.gates.new_sales && eligible) allowedActions.push('new_sales');
      if (purchaseReady && account?.baseSubscriptionId && !account.activeAttemptId && !account.activeCollectionOperationId && account.subscriptionState === 'active' && !account.cancelAtPeriodEnd &&
          account.paidThrough && account.paidThrough > new Date() && !account.graceEndsAt && settings.gates.new_sales && settings.gates.plan_changes &&
          Object.keys(settings.policy.zeroPriceIds ?? {}).length && eligible) allowedActions.push('new_sales');
      if (renewalMode === 'CARD_AUTO' && account?.baseSubscriptionId && account.customerId && settings.gates.portal_payment_method) allowedActions.push('portal_payment_method');
    }
    if (settings && !held && account?.baseSubscriptionId && !account.activeAttemptId && !account.activeCollectionOperationId &&
      ['active', 'past_due', 'unpaid', ...(renewalMode === 'PROMPTPAY_RENEW' ? ['trialing'] : [])].includes(account.subscriptionState) &&
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
    const issues = this.config.stripeAccountId ? await this.prisma.client.billingIssue.findMany({ where: { companyId: company.id, stripeAccountId: this.stripe.accountId,
      livemode: this.stripe.livemode, state: { not: 'RESOLVED' } }, take: 10, select: { id: true, kind: true } }) : [];
    const finalActions = allowedActions.filter(action => (action !== 'new_sales' || availablePurchaseModes.length > 0) &&
      (!account?.collectionPauseJson || !['new_sales','plan_changes','portal_cancel_subscription'].includes(action)) &&
      (!refundReviewPending || !['new_sales', 'plan_changes', ...(account?.cancelAtPeriodEnd ? ['portal_cancel_subscription'] : [])].includes(action)));
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
        // Q9: a slip the Owner is still looking at has already answered the offer. Showing pay
        // buttons next to "รอทีมงานตรวจสลิป" is how a shop pays twice for one deal.
        const slipState = dealSlipState(dealRow.paymentState, dealRow.slipSubmittedAt);
        deal = { dealId: dealRow.id, base: offer.base, baseLabel: billingOffer(offer.base, auto.cadence ?? 'month').label,
          priceSatang: offer.priceSatang, months: offer.months, offerExpiresAt: dealRow.offerExpiresAt.toISOString(),
          autoRenew: auto.autoRenew, cadence: auto.cadence, cycles: auto.cycles, slipState,
          slipRejectedReason: slipState === 'REJECTED' ? dealRow.rejectedReason : null,
          // D-P5-3: an auto deal whose Stripe Price is not READY cannot open a Checkout, so the
          // card offers nothing rather than a button whose quote answers SALES_DEAL_PRICE_PENDING.
          purchaseModes: finalActions.includes('new_sales') && slipState !== 'PENDING' &&
            (!auto.autoRenew || dealRow.priceState === 'READY') &&
            !(account?.baseSubscriptionId && account.paidThrough && account.paidThrough > new Date())
            ? dealPurchaseModes(settings?.gates ?? {}, offer) : [],
          // The card's own detail, so the OWNER reads their offer here and not through the
          // package-change queue, which `company.setup.manage` gates. `internalReason` and
          // `salesUserId` stay behind in the row: the team's note is not part of the offer (S24).
          branchLimit: offer.branchLimit, employeeLimit: offer.employeeLimit, monthlySlipLimit: offer.monthlySlipLimit,
          featureKeys: offer.featureKeys, aiMonthlyBudgetSatang: offer.aiMonthlyBudgetSatang, description: offer.description };
      } catch { deal = undefined; }
    }
    return { companyId: company.id, companyName: company.name, billingProfile: companyBillingProfile(company), mode: this.stripe.enabled ? (this.stripe.livemode ? 'LIVE' : 'TEST') : 'DISABLED',
      collectionPause: account?.collectionPauseJson as BillingStatus['collectionPause'],
      renewalMode, enabledPurchaseModes, availablePurchaseModes,
      renewalInvoiceUrl, renewalInvoiceDueAt,
      purchaseSource,
      purchaseEligibility: !eligible ? 'COMPANY_SALES_CLOSED' : purchaseSource === 'PAID_OTHER_MODE' || purchaseSource === 'SOURCE_INCONSISTENT'
        ? 'SOURCE_REVIEW_REQUIRED' : !featureReady ? 'ENTITLEMENT_REVIEW_REQUIRED' : 'ELIGIBLE', refundReviewPending,
      policyRevision: settings?.revision?.id ?? null, ...state, subscriptionState: account?.subscriptionState ?? 'NONE',
      // R2: same rule the plan-term notice uses, so the package page and the locked shell agree on
      // whether this shop never had a package or ran one to its end. EXPIRED only; a HELD company
      // is an admin hold, which is neither.
      ...(state.accessState === 'EXPIRED' && term ? { lockReason: planTermLockReason(term) } : {}),
      attemptId: attempt?.id ?? null, reference: invoice?.id ?? attempt?.id ?? null, observedAt: account?.observedAt?.toISOString() ?? null,
      canCancelCheckout: !!attempt?.checkoutSessionId && !['COMPLETED','EXPIRED','FAILED'].includes(attempt.status) &&
        !(invoice?.sourceAttemptId === attempt.id && invoice.providerStatus === 'paid'),
      effectiveCapacity: term ? effectivePlanCapacity(term) : null, tierKey: term?.tierKey ?? null, interval: snapshot?.interval ?? null, termEndsAt: term?.termEndsAt.toISOString() ?? null, paidThrough: account?.paidThrough?.toISOString() ?? null,
      nextChargeAt: account?.collectionPauseJson || renewalMode === 'CARD_ONCE' || renewalMode === 'PROMPTPAY_ONCE' ? null : account?.nextChargeAt?.toISOString() ?? null, cancelAtPeriodEnd: account?.cancelAtPeriodEnd ?? false,
      graceEndsAt: account?.graceEndsAt?.toISOString() ?? null,
      allowedActions: finalActions, ...(deal ? { deal } : {}),
      usage: await this.usage(company.id),
      pendingPlanChange: pending,
      planCapacityRepair: !held && pending && invoice?.applyStatus === 'HELD' && invoice.errorCode === 'BILLING_CAP_SELECTION_REQUIRED' &&
        (invoice.contractSnapshot as unknown as BillingSnapshot).planChangeId === pending.id ? { operationId: pending.id, version: pending.version,
          offerKey: pending.targetOffer!.offerKey, interval: pending.targetOffer!.interval } : null,
      collection: account?.activeCollectionOperationId ? await this.collection.get(context, account.activeCollectionOperationId) : null,
      capacityRepair: !held && attempt && invoice?.sourceAttemptId === attempt.id && invoice.applyStatus === 'HELD' && invoice.errorCode === 'BILLING_CAP_SELECTION_REQUIRED'
        ? { attemptId: attempt.id, attemptVersion: attempt.version, offerKey: (attempt.quoteSnapshot as unknown as BillingSnapshot).quote.offer.offerKey,
          interval: (attempt.quoteSnapshot as unknown as BillingSnapshot).quote.offer.interval } : null,
      issues: issues.map((i) => ({ reference: i.id, code: i.kind })) };
  }

  async portal(context: RequestContext): Promise<{ url: string }> {
    await this.assertOwner(context);
    const emailProof = await verifiedAccountEmailProof(this.prisma.client, context.userId);
    const account = await this.account(context.companyId), state = await this.settings();
    if (!account?.customerId || !account.baseSubscriptionId || account.renewalMode !== 'CARD_AUTO' || account.activeEmailOperationId || !state.policy?.portalConfigurationId || !state.gates.portal_payment_method) throw billingError('BILLING_PORTAL_UNAVAILABLE', 'กรุณาติดต่อทีมงานเพื่อจัดการการชำระเงิน');
    const assertCurrent = async (tx: Prisma.TransactionClient) => {
      await lockPlanTermCompany(tx, context.companyId);
      await this.assertOwner(context, tx);
      await lockAccountEmail(tx, context.userId);
      await assertAccountEmailProof(tx, context.userId, emailProof);
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
    return { attemptId: attempt.id, state: attempt.status, errorCode: attempt.errorCode, observedAt: attempt.updatedAt.toISOString(),
      paymentState: invoice?.providerStatus === 'paid' ? 'PAID' : ['FAILED', 'EXPIRED'].includes(attempt.status) ? 'FAILED' : 'PENDING',
      applyState: invoice ? invoice.applyStatus as BillingStatus['applyState'] : 'NONE', invoiceReference: invoice?.id ?? null,
      ...(snapshot.deal ? { deal: { dealId: snapshot.deal.requestId, months: snapshot.deal.months,
        baseLabel: snapshot.quote.deal?.baseLabel ?? snapshot.quote.offer.label } } : {}) };
  }

  async resume(context: RequestContext, id: string): Promise<BillingCheckoutResult> {
    await this.attempt(context, id);
    const account = (await this.account(context.companyId))!;
    const attempt = await this.prisma.client.billingAttempt.findUniqueOrThrow({ where: { id } });
    const result = { attemptId: id, state: attempt.status, checkoutUrl: null };
    if (!attempt.checkoutSessionId || account.activeAttemptId !== id || ['COMPLETED', 'EXPIRED', 'FAILED'].includes(attempt.status)) return result;
    const state = await this.settings();
    const purchaseMode = (attempt.quoteSnapshot as unknown as BillingSnapshot).quote.purchaseMode ?? 'CARD_AUTO';
    if (!state.gates.new_sales || !state.gates[gateForMode(purchaseMode)] || state.revision?.id !== attempt.policyRevisionId) return result;
    await this.stripe.assertAccount();
    const session = await this.stripe.request('GET', `/checkout/sessions/${attempt.checkoutSessionId}`);
    if (session.mode !== ((attempt.quoteSnapshot as unknown as BillingSnapshot).repeat || paymentCheckoutMode(purchaseMode) ? 'payment' : 'subscription') || stripeId(session.customer) !== account.customerId || session.metadata?.billingAccountId !== account.id || session.metadata?.billingAttemptId !== id) throw billingError('BILLING_MAPPING_MISMATCH', 'กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง');
    await this.assertOwner(context);
    const company = await this.prisma.client.company.findUnique({ where: { id: context.companyId }, include: { planTerm: true } });
    if (!company || (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))) return result;
    return { ...result, checkoutUrl: session.status === 'open' ? safeStripeUrl(session.url, 'checkout') : null };
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
    return { items: page.map((row) => ({ id: row.id, number: row.providerNumber, currency: 'THB', amountSatang: row.totalSatang,
      refundedSatang: row.refundedSatang, disputed: row.disputed, financialObservedAt: row.financialObservedAt?.toISOString() ?? null,
      paymentState: row.providerStatus, applyState: row.applyStatus, periodStart: row.periodStart.toISOString(), periodEnd: row.periodEnd.toISOString(),
      createdAt: row.createdAt.toISOString(), hasDocuments: row.providerStatus === 'paid' })), nextCursor: rows.length > input.limit ? page.at(-1)!.id : null };
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
    return {...result,canOpenDocuments:true};
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
