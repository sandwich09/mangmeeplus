import { ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BILLING_ACTIONS, BILLING_DRAFT_POLICY, billingOffer, type BillingCatalog, type BillingPolicy, type BillingQuote,
  type BillingCheckoutBody, type BillingCheckoutResult, type BillingStatus, type BillingAction, type BillingInvoiceItem, type BillingAttemptView } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { BillingAccount, Prisma } from '../../../generated/prisma/client';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { StripeClient, StripeRequestError, safeStripeUrl, stripeId } from '../infrastructure/stripe.client';
import { assertPolicyReady, assertStripePrice, billingError, billingMonth, effectiveBillingGates, hashBilling, paidVariant, parseBillingPolicy, quoteTotals } from '../domain/billing-policy';

import { BillingRepeat, type RepeatSource } from './billing-repeat';
import { BillingCollection } from './billing-collection';
import { collectionContract, pendingChange, type ScheduledChange } from './billing-schedule';
import { restartFits, restartSource, type RestartSource } from './billing-restart';
import { fullPackagePurchaseImpact } from '../domain/billing-package';
import { isUpgrade, upgradeHistory, upgradePreview, type UpgradeSource } from './billing-upgrade';
import { capacityOptions, capacityValid, capacityImpact, capacityReview, parseCapacitySelection } from './billing-capacity';
import type { BillingCapacitySelection } from '@watchdog-bms/contracts';
import { PartnerLifecycleTransitionUseCase } from '../../system-partner-management/application/use-cases/partner-lifecycle-transition.use-case';

import { termProjectionHash } from '../domain/paid-invoice';
import { receiptQuotaSnapshot } from '../../line-ai/application/company-ocr-governance';
import { billingState } from '../domain/billing-state';
import { detectBillingIssue } from './billing-issues';

export type BillingSnapshot = { quote: BillingQuote; priceId: string; policy: BillingPolicy; settingsVersion?: number; termVersion: string | null; termHash: string; repeat?: RepeatSource; restart?: RestartSource; upgrade?: UpgradeSource; capacity?: BillingCapacitySelection; planChangeId?: string; pendingChange?: { id: string; version: number; proposed: ScheduledChange } };
const CLOSED_GATES = Object.fromEntries(BILLING_ACTIONS.map((key) => [key, false]));

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfigService, readonly stripe: StripeClient,
    @Optional() private readonly lifecycle?: PartnerLifecycleTransitionUseCase) {}

  get repeater() { return new BillingRepeat(this.prisma, this.stripe, this, this.lifecycle); }
  get collection() { return new BillingCollection(this.prisma, this.stripe, this); }

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
    const member = await tx.companyMembership.findUnique({
      where: { companyId_userId: { companyId: context.companyId, userId: context.userId } },
      include: { user: { select: { status: true } }, roles: { include: { role: true } } },
    });
    if (!member || member.status !== 'ACTIVE' || member.user.status !== 'ACTIVE' ||
        !member.roles.some((r) => r.role.key === 'OWNER' && r.role.status === 'ACTIVE')) throw new ForbiddenException('เฉพาะเจ้าของบริษัทเท่านั้น');
  }

  async settings(tx: Prisma.TransactionClient = this.prisma.client) {
    const stripeAccountId = this.stripe.accountId, livemode = this.stripe.livemode;
    const settings = await tx.billingSettings.upsert({ where: { stripeAccountId_livemode: { stripeAccountId, livemode } },
      create: { id: `${stripeAccountId}:${livemode ? 'live' : 'test'}`, stripeAccountId, livemode, gatesJson: CLOSED_GATES }, update: {} });
    const revision = settings.policyRevisionId ? await tx.billingPolicyRevision.findUnique({ where: { id: settings.policyRevisionId } }) : null;
    const policy = revision && revision.stripeAccountId === stripeAccountId && revision.livemode === livemode && revision.state === 'ACTIVE'
      ? parseBillingPolicy(revision.policyJson) : null;
    return { settings, revision: policy ? revision : null, policy, gates: effectiveBillingGates(settings.gatesJson) };
  }

  async account(companyId: string, tx: Prisma.TransactionClient = this.prisma.client): Promise<BillingAccount | null> {
    if (!this.config.stripeAccountId) return null;
    return tx.billingAccount.findUnique({ where: { companyId_stripeAccountId_livemode: {
      companyId, stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode,
    } } });
  }

  async catalog(): Promise<BillingCatalog> {
    const state = this.stripe.enabled ? await this.settings() : null;
    const offers = (['STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999'] as const)
      .flatMap((tier) => (['month', 'year'] as const).map((interval) => {
        const offer = billingOffer(tier, interval);
        if (tier !== 'ENTERPRISE_1999' && state?.policy && state.gates.new_sales &&
            state.policy.priceIds[`${tier}:${interval}`]) {
          try { assertPolicyReady(state.policy); offer.availability = 'AVAILABLE'; offer.reason = null; } catch { /* Draft remains unavailable. */ }
        }
        return offer;
      }));
    const generatedAt = new Date();
    return { schemaVersion: 1, mode: this.stripe.enabled ? (this.stripe.livemode ? 'LIVE' : 'TEST') : 'DISABLED', policyRevision: state?.revision?.id ?? null,
      catalogRevision: hashBilling([state?.settings.version ?? 0, state?.revision?.id ?? null, offers, state?.policy?.taxTreatment ?? null]),
      generatedAt: generatedAt.toISOString(), validUntil: new Date(generatedAt.getTime() + 30_000).toISOString(), taxTreatment: state?.policy?.taxTreatment ?? null,
      offers, trial: { tierKey: 'FREE_TRIAL_15', days: 30, monthlySlipLimit: 15, branchLimit: 1, employeeLimit: 2, menus: 7 } };
  }

  async usage(companyId: string): Promise<BillingStatus['usage']> {
    const { monthKey, resetsAt } = billingMonth();
    const quota = await receiptQuotaSnapshot(this.prisma, companyId, monthKey);
    const used = quota.usedCount, limit = quota.planLimit;
    return { used, limit, remaining: limit === null ? null : Math.max(0, limit - used),
      resetsAt: quota.cadence ? null : resetsAt, cadence: quota.cadence ?? 'LEGACY_MONTH', expiresAt: quota.expiresAt ?? null };
  }

  async capacity(context: RequestContext, offerKey: string, interval: string) {
    const { offer } = paidVariant(offerKey, interval);
    return this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, context.companyId); await this.assertOwner(context, tx);
      const company = await tx.company.findUniqueOrThrow({ where: { id: context.companyId }, include: { planTerm: true } });
      if (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))
        throw billingError('BILLING_COMPANY_HELD', 'บริษัทอยู่ระหว่างตรวจสอบ กรุณาติดต่อทีมงาน');
      return capacityOptions(tx, context.companyId, offer);
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

  async quote(context: RequestContext, body: { offerKey: string; interval: string; billingEmail: string; capacity?: unknown }): Promise<BillingQuote> {
    await this.assertOwner(context);
    const { tier, interval, offer } = paidVariant(body.offerKey, body.interval);
    if (!this.stripe.enabled) throw billingError('BILLING_NOT_READY', 'ระบบชำระเงินยังไม่เปิดให้บริการ');
    const state = await this.settings();
    if (!state.policy || !state.revision || !state.gates.new_sales) throw billingError('BILLING_SALES_CLOSED', 'ยังไม่เปิดรับชำระเงินใหม่');
    assertPolicyReady(state.policy);
    if (state.policy.paidStart !== 'IMMEDIATE') throw billingError('CONTROL_POLICY_NOT_SUPPORTED', 'การเริ่มสมาชิกต้องชำระทันทีตามนโยบายปัจจุบัน');
    const priceId = state.policy.priceIds[`${tier}:${interval}`];
    if (!priceId) throw billingError('BILLING_OFFER_UNAVAILABLE', 'แพ็กเกจนี้ยังไม่เปิดรับชำระเงิน');
    if (typeof body.billingEmail !== 'string' || body.billingEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.billingEmail)) throw billingError('BILLING_EMAIL_INVALID', 'กรุณาระบุอีเมลสำหรับเอกสารการชำระเงิน');
    const company = await this.prisma.client.company.findUnique({ where: { id: context.companyId }, include: { planTerm: true } });
    if (!company) throw new NotFoundException();
    const term = company.planTerm;
    if (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && term?.termDisabledAt)) throw billingError('BILLING_COMPANY_HELD', 'บริษัทอยู่ระหว่างตรวจสอบ กรุณาติดต่อทีมงาน');
    if (!term || (!['FREE_TRIAL_15'].includes(term.tierKey) && !await this.account(company.id))) {
      throw billingError('BILLING_LEGACY_REVIEW_REQUIRED', 'แพ็กเกจเดิมต้องให้ทีมงานตรวจสอบก่อนซื้อ');
    }
    const existing = await this.account(company.id);
    if (existing?.activeCollectionOperationId) throw billingError('BILLING_COLLECTION_PENDING', 'กรุณาตรวจคำสั่งต่ออายุเดิมให้เสร็จก่อนซื้อเพิ่ม');
    if (existing?.activeAttemptId) throw billingError('BILLING_EXISTING_SUBSCRIPTION', 'มีรายการเดิมอยู่แล้ว กรุณาตรวจสถานะหรือจัดการสมาชิก');
    await this.stripe.assertAccount();
    const price = await this.stripe.request('GET', `/prices/${priceId}`);
    assertStripePrice(price, offer, state.policy, this.stripe.livemode);
    await this.assertTaxSettings(state.policy);
    const restart = existing?.baseSubscriptionId && existing.paidThrough && existing.paidThrough <= new Date() ? await restartSource(this.prisma, this.stripe, existing) : undefined;
    const capacity = body.capacity === undefined ? undefined : parseCapacitySelection(body.capacity);
    let capacityPreview: BillingQuote['capacity'];
    if (capacity) {
      if (existing?.baseSubscriptionId && !restart) throw capacityReview();
      const options = await this.capacity(context, offer.offerKey, offer.interval);
      if (!capacityValid(options, capacity)) throw capacityReview();
      capacityPreview = capacityImpact(options, capacity);
    } else if ((!existing?.baseSubscriptionId || restart) && !await restartFits(this.prisma.client, company.id, offer)) throw capacityReview();
    if (existing?.baseSubscriptionId && !restart && !state.gates.plan_changes) throw billingError('BILLING_REPEAT_NOT_READY', 'การซื้อแพ็กเกจซ้ำยังไม่เปิดให้บริการ');
    let repeat: RepeatSource | undefined, upgrade: UpgradeSource | undefined;
    if (existing?.baseSubscriptionId && !restart) {
      const accepted = (await collectionContract(this.prisma.client, existing)).current;
      if (accepted && isUpgrade(accepted.quote.offer, offer)) {
        const oldPrice = await this.stripe.request('GET', `/prices/${accepted.priceId}`);
        repeat = await this.repeater.source(existing, accepted.quote.offer, state.policy, oldPrice);
        const targetZero = state.policy.zeroPriceIds?.[`${tier}:${interval}`];
        if (!targetZero) throw billingError('BILLING_REPEAT_NOT_READY', 'การเปลี่ยนแพ็กเกจยังไม่เปิดให้บริการ กรุณาติดต่อทีมงาน');
        const zero = await this.stripe.request('GET', `/prices/${targetZero}`);
        assertStripePrice(zero, { ...offer, priceSatang: 0 }, state.policy, existing.livemode);
        const productId = stripeId(price.product);
        if (!productId || stripeId(zero.product) !== productId) throw billingError('BILLING_PRICE_MISMATCH', 'ข้อมูลราคาไม่ตรงกัน กรุณาติดต่อทีมงาน');
        const history = await upgradeHistory(this.prisma.client, existing, offer, state.policy, new Date(Math.floor(Date.now()/1000)*1000).toISOString());
        if (history.segments[0]!.oldOffer.offerKey !== term.tierKey || Date.parse(history.segments[0]!.end) <= Date.now()+2401000)
          throw billingError('BILLING_UPGRADE_BOUNDARY', 'ใกล้วันเปลี่ยนรอบแล้ว กรุณาตรวจสถานะใหม่หลังเปลี่ยนรอบหรือติดต่อทีมงาน');
        const preview = await upgradePreview(this.stripe, history.amountSatang, state.policy);
        upgrade = { ...history, previewId: preview.previewId, previewHash: preview.previewHash };
        repeat = { ...repeat, productId, zeroPriceId: targetZero };
      } else repeat = await this.repeater.source(existing, offer, state.policy, price);
    }
    const quoteId = randomUUID();
    const quote: BillingQuote = { quoteId, companyId: company.id, companyName: company.name, policyRevision: state.revision.id,
      expiresAt: new Date(Date.now() + 600_000).toISOString(), offer: { ...offer, availability: 'AVAILABLE', reason: null },
      ...quoteTotals(upgrade?.amountSatang ?? offer.priceSatang, state.policy.taxTreatment), taxTreatment: state.policy.taxTreatment!, consentRevision: state.policy.consentRevision,
      paidStart: state.policy.paidStart!, billingEmail: body.billingEmail.trim().toLowerCase(),
      trialEndsAt: term?.tierKey === 'FREE_TRIAL_15' && term.termEndsAt > new Date() ? term.termEndsAt.toISOString() : null,
      usage: await this.usage(company.id) };
    if (capacityPreview) quote.capacity = capacityPreview;
    const impact = fullPackagePurchaseImpact({ tier, interval, verifiedPaidAt: new Date(Math.floor(Date.now() / 1000) * 1000),
      paidThrough: repeat ? new Date(repeat.paidThrough) : null, remainingPaidReceipts: repeat ? quote.usage.remaining ?? 0 : 0, anchorDay: repeat?.anchorDay });
    quote.purchase = { kind: repeat ? 'REPEAT' : restart ? 'RESTART' : 'INITIAL', previousPaidThrough: repeat?.paidThrough ?? restart?.paidThrough ?? null,
      projectedPaidThrough: impact.paidThrough.toISOString(), receiptUnitsAdded: impact.receiptUnitsAdded, projectedRemainingReceipts: impact.remainingReceipts };
    if (upgrade) {
      quote.expiresAt = new Date(Date.parse(upgrade.prorationAt)+600000).toISOString();
      quote.purchase = { kind: 'UPGRADE', previousPaidThrough: repeat!.paidThrough, projectedPaidThrough: repeat!.paidThrough,
        receiptUnitsAdded: upgrade.receiptUnitsAdded, projectedRemainingReceipts: (quote.usage.remaining ?? 0)+upgrade.receiptUnitsAdded };
      quote.upgrade = { prorationAt: upgrade.prorationAt, nextRenewalTotalSatang: quoteTotals(offer.priceSatang, state.policy.taxTreatment).totalSatang,
        segments: upgrade.segments.map(({start,end,amountSatang,receiptUnitsAdded})=>({start,end,amountSatang,receiptUnitsAdded})) };
    }
    const pending = existing && repeat ? await pendingChange(this.prisma.client, existing) : null;
    if (pending) {
      const options = await this.capacity(context, pending.proposed.snapshot.quote.offer.offerKey, pending.proposed.snapshot.quote.offer.interval);
      if (!pending.proposed.change.selection || !capacityValid(options, pending.proposed.change.selection)) throw capacityReview();
      quote.pendingPlanChange = { operationId: pending.row.id, oldEffectiveAt: pending.proposed.paidThrough, newEffectiveAt: quote.purchase!.projectedPaidThrough,
        offer: pending.proposed.snapshot.quote.offer, totalSatang: pending.proposed.snapshot.quote.totalSatang, capacity: capacityImpact(options, pending.proposed.change.selection) };
    }
    const snapshot: BillingSnapshot = { ...(pending ? { pendingChange: { id: pending.row.id, version: pending.row.version, proposed: pending.proposed } } : {}), quote, priceId, policy: state.policy, settingsVersion: state.settings.version, termVersion: term?.updatedAt.toISOString() ?? null, termHash: termProjectionHash(term), ...(repeat ? { repeat } : {}), ...(restart ? { restart } : {}), ...(upgrade ? { upgrade } : {}), ...(capacity ? { capacity } : {}) };
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
      if (account?.activeCollectionOperationId) throw billingError('BILLING_COLLECTION_PENDING', 'กรุณาตรวจคำสั่งต่ออายุเดิมให้เสร็จก่อนซื้อเพิ่ม');
      if (snapshot.settingsVersion !== state.settings.version) throw billingError('BILLING_QUOTE_STALE', 'การตั้งค่าการขายเปลี่ยน กรุณาตรวจสอบรายการใหม่');
      paidVariant(snapshot.quote.offer.offerKey, snapshot.quote.offer.interval);
      if (body.accepted !== true || body.consentRevision !== snapshot.quote.consentRevision || !['web', 'line'].includes(body.channel)) throw billingError('BILLING_CONSENT_REQUIRED', 'กรุณายืนยันเงื่อนไขการเรียกเก็บเงิน');
      if (!state.policy || !state.gates.new_sales) throw billingError('BILLING_SALES_CLOSED', 'ยังไม่เปิดรับชำระเงินใหม่');
      assertPolicyReady(state.policy);
      const company = await tx.company.findUnique({ where: { id: context.companyId }, include: { planTerm: true } });
      if (!company || (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))) throw billingError('BILLING_COMPANY_HELD', 'บริษัทอยู่ระหว่างตรวจสอบ');
      if ((company.planTerm?.updatedAt.toISOString() ?? null) !== snapshot.termVersion) throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์บริษัทเปลี่ยน กรุณาตรวจสอบใหม่');
      if (account?.activeAttemptId || (account?.baseSubscriptionId && !snapshot.repeat && !snapshot.restart)) throw billingError('BILLING_PURCHASE_PENDING', 'มีรายการชำระเงินอยู่แล้ว กรุณาตรวจสถานะเดิม');
      if (snapshot.restart && (!account || account.baseSubscriptionId !== snapshot.restart.subscriptionId || account.contractAttemptId !== snapshot.restart.contractAttemptId ||
        account.paidThrough?.toISOString() !== snapshot.restart.paidThrough || account.termProjectionHash !== snapshot.restart.termHash)) throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์หรือสมาชิกเดิมเปลี่ยน กรุณาตรวจสอบใหม่');
      if (!snapshot.repeat && !(snapshot.capacity ? capacityValid(await capacityOptions(tx, context.companyId, snapshot.quote.offer), snapshot.capacity) :
        await restartFits(tx, context.companyId, snapshot.quote.offer))) throw billingError('BILLING_QUOTE_STALE', 'สาขาหรือผู้ใช้เปลี่ยน กรุณาตรวจการเลือกใหม่');
      if (snapshot.repeat && (!state.gates.plan_changes || account?.baseSubscriptionId !== snapshot.repeat.subscriptionId ||
          account.paidThrough?.toISOString() !== snapshot.repeat.paidThrough || account.termProjectionHash !== snapshot.termHash)) throw billingError('BILLING_QUOTE_STALE', 'สิทธิ์หรือรายการเดิมเปลี่ยน กรุณาตรวจสอบใหม่');
      if ((account?.pendingPlanChangeId ?? null) !== (snapshot.pendingChange?.id ?? null) && !snapshot.restart) throw billingError('BILLING_QUOTE_STALE', 'คำสั่งเปลี่ยนแพ็กเกจเปลี่ยน กรุณาตรวจสอบใหม่');
      if (snapshot.pendingChange && (await tx.billingOperation.findUnique({ where: { id: snapshot.pendingChange.id } }))?.version !== snapshot.pendingChange.version) throw capacityReview();
      if (snapshot.upgrade && (!account || (await upgradeHistory(tx, account, snapshot.quote.offer, snapshot.policy, snapshot.upgrade.prorationAt)).sourceHash !== snapshot.upgrade.sourceHash))
        throw billingError('BILLING_QUOTE_STALE', 'ประวัติแพ็กเกจเปลี่ยน กรุณาตรวจส่วนต่างใหม่');
      if (!account) account = await tx.billingAccount.create({ data: { companyId: context.companyId, stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode } });
      const attempt = await tx.billingAttempt.create({ data: { billingAccountId: account.id, initiatingUserId: context.userId, quoteId: quote.id,
        channel: body.channel, idempotencyKey: key, requestHash, quoteSnapshot: quote.snapshotJson!, policyRevisionId: quote.policyRevisionId,
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
        customerRequestUnconfirmed = true;
        const customer = await this.stripe.request('POST', '/customers', { name: snapshot.quote.companyName, email: snapshot.quote.billingEmail,
          metadata: { billingAccountId: account.id } }, `mm:${account.id}:customer`);
        if (typeof customer.id !== 'string' || !customer.id.startsWith('cus_')) throw new StripeRequestError('UNKNOWN', 'invalid_customer');
        customerId = customer.id;
        await this.prisma.client.billingAccount.updateMany({ where: { id: account.id, customerId: null }, data: { customerId } });
        const mapped = await this.prisma.client.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
        if (mapped.customerId !== customerId) throw new StripeRequestError('UNKNOWN', 'customer_binding_changed');
        customerRequestUnconfirmed = false;
      }
      // Recheck authoritative stop barrier immediately before the external financial request.
      await this.prisma.client.$transaction(async (tx) => {
        await lockPlanTermCompany(tx, context.companyId);
        await this.assertOwner(context, tx);
        const state = await this.settings(tx);
        if (!state.gates.new_sales || state.revision?.id !== attempt.policyRevisionId || state.settings.version !== snapshot.settingsVersion) throw billingError('BILLING_SALES_CLOSED', 'หยุดรับรายการใหม่ชั่วคราว');
        const company = await tx.company.findUnique({ where: { id: context.companyId }, include: { planTerm: true } });
        if (!company || (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))) throw billingError('BILLING_COMPANY_HELD', 'บริษัทอยู่ระหว่างตรวจสอบ');
        if ((company.planTerm?.updatedAt.toISOString() ?? null) !== snapshot.termVersion || company.name !== snapshot.quote.companyName) throw billingError('BILLING_QUOTE_STALE', 'ข้อมูลบริษัทหรือสิทธิ์เปลี่ยน กรุณาตรวจสอบใหม่');
        const changed = await tx.billingAttempt.updateMany({ where: { id: attempt.id, status: 'CREATING', version: 0 }, data: { status: 'REQUESTING', version: { increment: 1 } } });
        if (changed.count !== 1) throw billingError('BILLING_PURCHASE_PENDING', 'กำลังตรวจสอบรายการเดิม');
      });
      const origin = this.config.sesWebBaseUrl;
      if (!origin) throw new StripeRequestError('REJECTED', 'missing_web_origin');
      const returnUrl = new URL(`/companies/${context.companyId}/billing/return?attempt=${attempt.id}`, origin).toString();
      if (account.customerId) {
        const customer = await this.stripe.request('POST', `/customers/${customerId}`, { email: snapshot.quote.billingEmail }, `mm:${attempt.id}:billing-email`);
        if (customer.id !== customerId || customer.email !== snapshot.quote.billingEmail || customer.metadata?.billingAccountId !== account.id) throw new StripeRequestError('UNKNOWN', 'customer_email_unconfirmed');
      }
      await this.assertTaxSettings(snapshot.policy);
      financialRequestStarted = true;
      const session = await this.stripe.request('POST', '/checkout/sessions', {
        mode: 'subscription', customer: customerId, client_reference_id: attempt.id, payment_method_types: ['card'],
        line_items: [{ price: snapshot.priceId, quantity: 1, ...(snapshot.policy.taxRateId ? { tax_rates: [snapshot.policy.taxRateId] } : {}) }],
        success_url: returnUrl, cancel_url: returnUrl, locale: 'th', billing_address_collection: 'required',
        metadata: { billingAttemptId: attempt.id, billingAccountId: account.id },
        subscription_data: { billing_mode: { type: 'classic' }, metadata: { billingAttemptId: attempt.id, billingAccountId: account.id } },
        expires_at: Math.floor(Date.now() / 1000) + 1800,
      }, `mm:${attempt.id}:checkout`);
      if (typeof session.id !== 'string' || !session.id.startsWith('cs_') || session.object !== 'checkout.session' || session.mode !== 'subscription' ||
          session.livemode !== account.livemode || session.client_reference_id !== attempt.id ||
          stripeId(session.customer) !== customerId || session.metadata?.billingAttemptId !== attempt.id || session.metadata?.billingAccountId !== account.id || !safeStripeUrl(session.url, 'checkout')) throw new StripeRequestError('UNKNOWN', 'invalid_checkout');
      await this.prisma.client.billingAttempt.updateMany({ where: { id: attempt.id, status: 'REQUESTING' }, data: { status: 'OPEN', checkoutSessionId: session.id, version: { increment: 1 } } });
      const current = await this.prisma.client.billingAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      return { attemptId: attempt.id, state: current.status, checkoutUrl: current.status === 'OPEN' ? safeStripeUrl(session.url, 'checkout') : null };
    } catch (error) {
      const code = error instanceof StripeRequestError ? error.code : 'command_unconfirmed';
      // Only release a reservation when we know no financial request succeeded. A network timeout
      // or malformed provider success retains it for reconciliation and cannot permit a second sale.
      if ((!financialRequestStarted && !customerRequestUnconfirmed) || (financialRequestStarted && error instanceof StripeRequestError && error.outcome === 'REJECTED')) {
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

  async status(context: RequestContext): Promise<BillingStatus> {
    await this.assertOwner(context);
    const company = await this.prisma.client.company.findUnique({ where: { id: context.companyId }, include: { planTerm: true } });
    if (!company) throw new NotFoundException();
    const term = company.planTerm, account = await this.account(company.id);
    const invoice = account ? await this.prisma.client.billingInvoice.findFirst({ where: { billingAccountId: account.id }, orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }] }) : null;
    const attempt = account?.activeAttemptId ? await this.prisma.client.billingAttempt.findUnique({ where: { id: account.activeAttemptId } }) : null;
    const settings = this.stripe.enabled ? await this.settings() : null;
    const state = billingState(company, account, invoice, attempt), held = state.accessState === 'HELD';
    const allowedActions: BillingAction[] = [];
    let policyReady = false;
    if (settings?.policy) { try { assertPolicyReady(settings.policy); policyReady = true; } catch { /* Keep incomplete policies closed. */ } }
    if (settings?.policy && policyReady && !held) {
      if (!account?.baseSubscriptionId && !account?.activeAttemptId && !account?.activeCollectionOperationId && settings.gates.new_sales) allowedActions.push('new_sales');
      if (account?.baseSubscriptionId && !account.activeAttemptId && !account.activeCollectionOperationId &&
        ['canceled', 'incomplete_expired'].includes(account.subscriptionState) && account.paidThrough && account.paidThrough <= new Date() &&
        !(account.graceEndsAt && account.graceEndsAt > new Date()) && settings.gates.new_sales) allowedActions.push('new_sales');
      if (account?.baseSubscriptionId && !account.activeAttemptId && !account.activeCollectionOperationId && account.subscriptionState === 'active' && !account.cancelAtPeriodEnd &&
          account.paidThrough && account.paidThrough > new Date() && !account.graceEndsAt && settings.gates.new_sales && settings.gates.plan_changes &&
          Object.keys(settings.policy.zeroPriceIds ?? {}).length) allowedActions.push('new_sales');
      if (account?.customerId && settings.gates.portal_payment_method) allowedActions.push('portal_payment_method');
    }
    if (settings && !held && account?.baseSubscriptionId && !account.activeAttemptId && !account.activeCollectionOperationId &&
      ['active', 'past_due', 'unpaid'].includes(account.subscriptionState) && settings.gates.portal_cancel_subscription) allowedActions.push('portal_cancel_subscription');
    const pending = account?.pendingPlanChangeId ? await this.collection.get(context, account.pendingPlanChangeId) : null;
    if (settings?.gates.plan_changes && account?.paidThrough && account.paidThrough.getTime() > Date.now()+600000 && !account.cancelAtPeriodEnd && !account.graceEndsAt &&
      !held && !account.activeAttemptId && !account.activeCollectionOperationId && account.subscriptionState === 'active') allowedActions.push('plan_changes');
    const snapshot = invoice?.offerSnapshot as unknown as BillingQuote['offer'] | undefined;
    const issues = this.config.stripeAccountId ? await this.prisma.client.billingIssue.findMany({ where: { companyId: company.id, stripeAccountId: this.stripe.accountId,
      livemode: this.stripe.livemode, state: { not: 'RESOLVED' } }, take: 10, select: { id: true, kind: true } }) : [];
    return { companyId: company.id, companyName: company.name, mode: this.stripe.enabled ? (this.stripe.livemode ? 'LIVE' : 'TEST') : 'DISABLED',
      policyRevision: settings?.revision?.id ?? null, ...state, subscriptionState: account?.subscriptionState ?? 'NONE',
      attemptId: attempt?.id ?? null, reference: invoice?.id ?? attempt?.id ?? null, observedAt: account?.observedAt?.toISOString() ?? null,
      tierKey: term?.tierKey ?? null, interval: snapshot?.interval ?? null, termEndsAt: term?.termEndsAt.toISOString() ?? null, paidThrough: account?.paidThrough?.toISOString() ?? null,
      nextChargeAt: account?.nextChargeAt?.toISOString() ?? null, cancelAtPeriodEnd: account?.cancelAtPeriodEnd ?? false,
      graceEndsAt: account?.graceEndsAt?.toISOString() ?? null, allowedActions, usage: await this.usage(company.id),
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
    const account = await this.account(context.companyId), state = await this.settings();
    if (!account?.customerId || !state.policy?.portalConfigurationId || !state.gates.portal_payment_method) throw billingError('BILLING_PORTAL_UNAVAILABLE', 'กรุณาติดต่อทีมงานเพื่อจัดการการชำระเงิน');
    await this.stripe.assertAccount();
    const config = await this.stripe.request('GET', `/billing_portal/configurations/${state.policy.portalConfigurationId}`);
    // Use a narrowly configured portal. Subscription changes/cancel go through explicit commands.
    if (!config.active || config.features?.subscription_update?.enabled || config.features?.subscription_cancel?.enabled || !config.features?.payment_method_update?.enabled) {
      await this.issue(context.companyId, 'CONFIG_DRIFT', state.policy.portalConfigurationId);
      throw billingError('BILLING_PORTAL_CONFIG_MISMATCH', 'กำลังตรวจสอบการตั้งค่าการชำระเงิน');
    }
    await this.assertOwner(context);
    const current = await this.settings();
    if (!current.gates.portal_payment_method || current.revision?.id !== state.revision?.id) throw billingError('BILLING_PORTAL_UNAVAILABLE', 'การตั้งค่าเปลี่ยน กรุณาลองใหม่');
    const session = await this.stripe.request('POST', '/billing_portal/sessions', { customer: account.customerId,
      configuration: state.policy.portalConfigurationId, return_url: new URL(`/companies/${context.companyId}/billing`, this.config.sesWebBaseUrl).toString(),
      flow_data: { type: 'payment_method_update' } });
    const url = safeStripeUrl(session.url, 'portal');
    if (!url) throw billingError('BILLING_PORTAL_UNAVAILABLE', 'กรุณาลองใหม่หรือติดต่อทีมงาน');
    return { url };
  }

  async attempt(context: RequestContext, id: string): Promise<BillingAttemptView> {
    await this.assertOwner(context);
    const account = await this.account(context.companyId);
    const attempt = account ? await this.prisma.client.billingAttempt.findFirst({ where: { id, billingAccountId: account.id } }) : null;
    if (!attempt) throw new NotFoundException();
    const invoice = await this.prisma.client.billingInvoice.findFirst({ where: { billingAccountId: account!.id, sourceAttemptId: attempt.id } });
    return { attemptId: attempt.id, state: attempt.status, errorCode: attempt.errorCode, observedAt: attempt.updatedAt.toISOString(),
      paymentState: invoice?.providerStatus === 'paid' ? 'PAID' : ['FAILED', 'EXPIRED'].includes(attempt.status) ? 'FAILED' : 'PENDING',
      applyState: invoice ? invoice.applyStatus as BillingStatus['applyState'] : 'NONE', invoiceReference: invoice?.id ?? null };
  }

  async resume(context: RequestContext, id: string): Promise<BillingCheckoutResult> {
    await this.attempt(context, id);
    const account = (await this.account(context.companyId))!;
    const attempt = await this.prisma.client.billingAttempt.findUniqueOrThrow({ where: { id } });
    const result = { attemptId: id, state: attempt.status, checkoutUrl: null };
    if (!attempt.checkoutSessionId || account.activeAttemptId !== id || ['COMPLETED', 'EXPIRED', 'FAILED'].includes(attempt.status)) return result;
    const state = await this.settings();
    if (!state.gates.new_sales || state.revision?.id !== attempt.policyRevisionId) return result;
    await this.stripe.assertAccount();
    const session = await this.stripe.request('GET', `/checkout/sessions/${attempt.checkoutSessionId}`);
    if (session.mode !== ((attempt.quoteSnapshot as unknown as BillingSnapshot).repeat ? 'payment' : 'subscription') || stripeId(session.customer) !== account.customerId || session.metadata?.billingAccountId !== account.id || session.metadata?.billingAttemptId !== id) throw billingError('BILLING_MAPPING_MISMATCH', 'กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง');
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

  async document(context: RequestContext, id: string, kind: 'invoice' | 'receipt' | 'pdf'): Promise<{ url: string }> {
    await this.assertOwner(context);
    const account = await this.account(context.companyId);
    const row = account ? await this.prisma.client.billingInvoice.findFirst({ where: { id, billingAccountId: account.id } }) : null;
    if (!row || !account?.customerId) throw new NotFoundException();
    await this.stripe.assertAccount();
    const invoice = await this.stripe.request('GET', `/invoices/${row.providerInvoiceId}`);
    if (invoice.id !== row.providerInvoiceId || stripeId(invoice.customer) !== account.customerId || stripeId(invoice.parent?.subscription_details?.subscription) !== row.subscriptionId) throw billingError('BILLING_DOCUMENT_BINDING', 'กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง');
    let value = kind === 'pdf' ? invoice.invoice_pdf : invoice.hosted_invoice_url;
    if (kind === 'receipt') {
      if (!row.providerChargeId) throw billingError('BILLING_DOCUMENT_PENDING', 'กำลังเตรียมใบเสร็จ กรุณาลองใหม่');
      const charge = await this.stripe.request('GET', `/charges/${row.providerChargeId}`);
      if (charge.id !== row.providerChargeId || stripeId(charge.customer) !== account.customerId || charge.paid !== true || charge.currency !== 'thb' || charge.amount !== row.paidSatang) throw billingError('BILLING_DOCUMENT_BINDING', 'กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง');
      value = charge.receipt_url;
    }
    const url = safeStripeUrl(value, 'document');
    if (!url) throw billingError('BILLING_DOCUMENT_PENDING', 'กำลังเตรียมเอกสาร กรุณาลองใหม่');
    await this.assertOwner(context);
    await this.prisma.client.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'billing.document.opened',
      targetType: 'BillingInvoice', targetId: id, requestId: context.requestId, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { kind } } });
    return { url };
  }
}
