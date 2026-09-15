import { observedCollectionPause } from './billing-admin-collection';
import { BillingPlanAdjustmentsService } from './billing-plan-adjustments.service';
import { invoiceFindingSource } from './billing-invoice-finding';
import { detectBillingIssue, resolveBillingIssue } from './billing-issues';
import type { ScheduledChange } from './billing-schedule';
import { BadRequestException, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { STRIPE_API_VERSION } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { Prisma, type BillingAccount, type BillingAttempt } from '../../../generated/prisma/client';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { PartnerLifecycleTransitionUseCase } from '../../system-partner-management/application/use-cases/partner-lifecycle-transition.use-case';
import { StripeClient, stripeId, verifyStripeSignature, type StripeObject } from '../infrastructure/stripe.client';
import { hashBilling } from '../domain/billing-policy';
import { paidInvoiceEvidence, termProjectionHash, type PaidInvoiceEvidence } from '../domain/paid-invoice';
import { BillingService, type BillingSnapshot } from './billing.service';
import { restartFits, restartSource } from './billing-restart';
import { observeBillingCharges, recordBillingFinancials } from './billing-financial';
import { grantPaidPackageReceipts } from './billing-receipt-grants';
import { fulfillPaidPackageRequest } from './billing-package-request';
import { applyCapacity, attemptCapacity, capacityOptions, capacityValid } from './billing-capacity';

export const BILLING_STRIPE_EVENTS = new Set(['checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required', 'invoice.finalization_failed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'charge.refunded',
  'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'refund.created', 'refund.updated', 'refund.failed']);

/** Both authenticated provider discovery and signed ingress accept the same reference shape. */
export function validBillingEvent(event: StripeObject, accountId: string, livemode: boolean): boolean {
  return Boolean(event && event.object === 'event' && typeof event.id === 'string' && /^evt_[a-zA-Z0-9]+$/.test(event.id) &&
    event.api_version === STRIPE_API_VERSION && event.livemode === livemode &&
    (event.account === undefined || event.account === accountId) && typeof event.type === 'string' &&
    typeof event.data?.object?.id === 'string' && /^[a-z]+_[a-zA-Z0-9_]+$/.test(event.data.object.id));
}

@Injectable()
export class BillingReconcilerService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfigService, private readonly stripe: StripeClient,
    private readonly billing: BillingService, private readonly lifecycle: PartnerLifecycleTransitionUseCase, @Optional() private readonly planAdjustments?: BillingPlanAdjustmentsService) {}

  async receive(raw: Buffer | undefined, signature: string | undefined): Promise<{ accepted: true }> {
    if (!this.stripe.enabled || !this.config.stripeWebhookSecret) throw new ServiceUnavailableException('Stripe receiver is not configured');
    if (!raw || !verifyStripeSignature(raw, signature, this.config.stripeWebhookSecret)) throw new UnauthorizedException('Invalid Stripe signature');
    let event: StripeObject;
    try { event = JSON.parse(raw.toString('utf8')); } catch { throw new BadRequestException('Invalid Stripe event'); }
    if (!validBillingEvent(event, this.stripe.accountId, this.stripe.livemode)) throw new BadRequestException('Stripe environment or version mismatch');
    if (!BILLING_STRIPE_EVENTS.has(event.type)) return { accepted: true };
    try { await this.prisma.client.billingProviderEvent.upsert({ where: { stripeAccountId_livemode_eventId: {
      stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode, eventId: event.id,
    } }, create: { stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode, eventId: event.id, eventType: event.type,
      objectId: event.data.object.id, apiVersion: event.api_version, evidenceHash: hashBilling(raw.toString('utf8')) }, update: {} });
    } catch { throw new ServiceUnavailableException('Stripe event persistence unavailable'); }
    return { accepted: true };
  }

  async drain(batchSize = 10): Promise<{ processed: number; failed: number }> {
    if (!this.stripe.enabled) return { processed: 0, failed: 0 };
    const now = new Date();
    const rows = await this.prisma.client.billingProviderEvent.findMany({ where: { stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode,
      status: { in: ['PENDING', 'RETRY', 'PROCESSING'] }, retryAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
      orderBy: { receivedAt: 'asc' }, take: Math.min(25, batchSize) });
    let processed = 0, failed = 0;
    for (const row of rows) {
      const result = await this.reconcileEvent(row.id);
      if (result === 'PROCESSED') processed++;
      else if (result === 'FAILED') failed++;
    }
    return { processed, failed };
  }

  async reconcileEvent(id: string, operatorRetry = false): Promise<'PROCESSED' | 'FAILED' | 'BUSY'> {
    const row = await this.prisma.client.billingProviderEvent.findFirstOrThrow({ where: { id,
      stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode } });
    if (row.status === 'PROCESSED') return 'PROCESSED';
    const now = new Date(), leaseToken = randomUUID();
    if (!['PENDING', 'RETRY', 'PROCESSING', ...(operatorRetry ? ['DEAD'] : [])].includes(row.status) ||
        (!operatorRetry && row.retryAt > now)) return 'BUSY';
    const claimed = await this.prisma.client.billingProviderEvent.updateMany({ where: { id, status: row.status, attempts: row.attempts,
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, data: { status: 'PROCESSING', leaseToken,
        leaseUntil: new Date(now.getTime() + 120_000), attempts: { increment: 1 } } });
    if (!claimed.count) return 'BUSY';
    try {
      await this.handle(row.eventType, row.objectId);
      return await this.prisma.client.$transaction(async tx => {
        const changed = await tx.billingProviderEvent.updateMany({ where: { id, status: 'PROCESSING', leaseToken, leaseUntil: { gt: new Date() } },
          data: { status: 'PROCESSED', processedAt: new Date(), errorCode: null, leaseToken: null, leaseUntil: null } });
        if (!changed.count) return 'BUSY';
        await resolveBillingIssue(tx, { stripeAccountId: row.stripeAccountId, livemode: row.livemode,
          companyId: null, kind: 'PROVIDER_EVENT_FAILED', referenceId: id }, 'PROVIDER_EVENT_PROCESSED');
        return 'PROCESSED';
      });
    } catch {
      const dead = row.attempts >= 9;
      return this.prisma.client.$transaction(async tx => {
        const changed = await tx.billingProviderEvent.updateMany({ where: { id, status: 'PROCESSING', leaseToken, leaseUntil: { gt: new Date() } }, data: {
          status: dead ? 'DEAD' : 'RETRY', leaseToken: null, leaseUntil: null, errorCode: 'reconciliation_required',
          retryAt: new Date(Date.now() + Math.min(3600, 30 * 2 ** Math.min(row.attempts, 7)) * 1000),
        } });
        if (!changed.count) return 'BUSY';
        if (dead) await detectBillingIssue(tx, { companyId: null, stripeAccountId: row.stripeAccountId,
          livemode: row.livemode, kind: 'PROVIDER_EVENT_FAILED', referenceId: id });
        return 'FAILED';
      });
    }
  }

  private async handle(type: string, objectId: string): Promise<void> {
    await this.stripe.assertAccount();
    let object: StripeObject;
    if (type.startsWith('checkout.')) object = await this.stripe.request('GET', `/checkout/sessions/${objectId}`);
    else if (type.startsWith('invoice.')) object = await this.stripe.request('GET', `/invoices/${objectId}`);
    else if (type.startsWith('customer.subscription.')) object = await this.stripe.request('GET', `/subscriptions/${objectId}`);
    else if (type.startsWith('charge.dispute.')) {
      const dispute = await this.stripe.request('GET', `/disputes/${objectId}`);
      object = await this.stripe.request('GET', `/charges/${stripeId(dispute.charge)}`);
    } else if (type.startsWith('refund.')) {
      const refund = await this.stripe.request('GET', `/refunds/${objectId}`);
      object = await this.stripe.request('GET', `/charges/${stripeId(refund.charge)}`);
    } else object = await this.stripe.request('GET', `/charges/${objectId}`);
    const customerId = stripeId(object.customer);
    if (!customerId) throw new Error('billing.customer_missing');
    let account = await this.prisma.client.billingAccount.findUnique({ where: { stripeAccountId_livemode_customerId: {
      stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode, customerId,
    } } });
    if (!account) {
      const customer = await this.stripe.request('GET', `/customers/${customerId}`);
      const candidate = typeof customer.metadata?.billingAccountId === 'string' ? await this.prisma.client.billingAccount.findUnique({ where: { id: customer.metadata.billingAccountId } }) : null;
      if (!candidate || candidate.stripeAccountId !== this.stripe.accountId || candidate.livemode !== this.stripe.livemode ||
          (candidate.customerId !== null && candidate.customerId !== customerId) || !candidate.activeAttemptId) throw new Error('billing.account_unmapped');
      await this.prisma.client.billingAccount.updateMany({ where: { id: candidate.id, customerId: null }, data: { customerId } });
      account = await this.prisma.client.billingAccount.findUniqueOrThrow({ where: { id: candidate.id } });
      if (account.customerId !== customerId) throw new Error('billing.customer_binding_changed');
    }
    const financialEvent = type.startsWith('charge.') || type.startsWith('refund.');
    if (financialEvent && !await this.prisma.client.billingInvoice.findFirst({ where: { billingAccountId: account.id, providerChargeId: object.id } })) {
      await this.billing.issue(account.companyId, 'FINANCIAL_REVIEW', object.id);
    }
    if (type === 'refund.failed') await this.billing.issue(account.companyId, 'REFUND_FAILED', objectId);
    const subscriptionId = object.object === 'subscription' ? object.id : stripeId(object.subscription) ?? stripeId(object.parent?.subscription_details?.subscription);
    await this.reconcileAccount(account.id, subscriptionId ?? undefined, financialEvent ? object.id : undefined);
  }

  async reconcileAccount(accountId: string, hintedSubscriptionId?: string, financialChargeId?: string, onlyInvoiceId?: string): Promise<void> {
    const now = new Date(), leaseToken = randomUUID();
    const acquired = await this.prisma.client.billingAccount.updateMany({ where: { id: accountId, stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode,
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, data: { leaseToken, leaseUntil: new Date(now.getTime() + 120_000) } });
    if (!acquired.count) throw new Error('billing.reconciliation_busy');
    try {
      await this.stripe.assertAccount();
      let account = await this.prisma.client.billingAccount.findUniqueOrThrow({ where: { id: accountId } });
      if(onlyInvoiceId){await this.reconcileOriginalInvoice(account,onlyInvoiceId,leaseToken);return;}
      let attempt = account.activeAttemptId ? await this.prisma.client.billingAttempt.findUnique({ where: { id: account.activeAttemptId } }) : null;
      if (!account.customerId && attempt) {
        // Durable metadata lookup, never recreating a customer after an ambiguous old request.
        const customers = await this.stripe.list('/customers', { created: { gte: Math.floor(attempt.createdAt.getTime() / 1000) - 300 } });
        const matches = customers.filter((c) => c.metadata?.billingAccountId === account.id);
        if (matches.length !== 1) throw new Error('billing.customer_unknown');
        await this.prisma.client.billingAccount.updateMany({ where: { id: account.id, leaseToken, leaseUntil: { gt: new Date() }, customerId: null }, data: { customerId: matches[0]!.id } });
        account = await this.prisma.client.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
      }
      if (!account.customerId) return;
      if (account.activeCollectionOperationId) {
        const operation=await this.prisma.client.billingOperation.findUniqueOrThrow({where:{id:account.activeCollectionOperationId}});
        if(['GRANT_FREE_DAYS','CHANGE_COLLECTION'].includes(operation.type)){
          if(!this.planAdjustments)throw new Error('billing.free_days_handler_missing');
          await this.planAdjustments.advanceFreeDays(account,leaseToken);
        }else await this.billing.collection.advance(account, leaseToken);
        if (financialChargeId) await observeBillingCharges(this.prisma, this.stripe, account, leaseToken, financialChargeId);
        return;
      }
      await observeBillingCharges(this.prisma, this.stripe, account, leaseToken, financialChargeId);
      if (attempt && (attempt.quoteSnapshot as unknown as BillingSnapshot).repeat) {
        await this.billing.repeater.advance(account, attempt, leaseToken, this.config.sesWebBaseUrl);
        return;
      }
      const restart = attempt ? (attempt.quoteSnapshot as unknown as BillingSnapshot).restart : undefined;
      let subscriptionId = account.baseSubscriptionId ?? hintedSubscriptionId;
      if (attempt) {
        const sessions = attempt.checkoutSessionId ? [await this.stripe.request('GET', `/checkout/sessions/${attempt.checkoutSessionId}`)] :
          (await this.stripe.list('/checkout/sessions', { customer: account.customerId })).filter((s) => s.metadata?.billingAttemptId === attempt!.id);
        if (sessions.length !== 1) throw new Error('billing.checkout_unknown');
        const session = sessions[0]!;
        if (session.object !== 'checkout.session' || session.mode !== 'subscription' || session.livemode !== account.livemode ||
          !['open', 'complete', 'expired'].includes(session.status) ||
          session.client_reference_id !== attempt.id || stripeId(session.customer) !== account.customerId ||
          session.metadata?.billingAccountId !== account.id || session.metadata?.billingAttemptId !== attempt.id) throw new Error('billing.session_binding');
        if (session.status === 'expired' && !session.subscription) {
          await this.prisma.client.$transaction(async (tx) => {
            await lockPlanTermCompany(tx, account.companyId);
            await this.assertLease(tx, account.id, leaseToken);
            await tx.billingAttempt.update({ where: { id: attempt!.id }, data: { status: 'EXPIRED', checkoutSessionId: session.id } });
            await tx.billingAccount.update({ where: { id: account.id }, data: { activeAttemptId: null, observedAt: new Date(), version: { increment: 1 } } });
          });
          return;
        }
        subscriptionId = stripeId(session.subscription) ?? subscriptionId;
        await this.prisma.client.$transaction(async (tx) => {
          await lockPlanTermCompany(tx, account.companyId);
          await this.assertLease(tx, account.id, leaseToken);
          await tx.billingAttempt.update({ where: { id: attempt!.id }, data: {
            checkoutSessionId: session.id, status: session.status === 'complete' ? 'COMPLETED' : 'OPEN', subscriptionId: stripeId(session.subscription), version: { increment: 1 },
          } });
          await tx.billingIssue.updateMany({ where: { companyId: account.companyId, stripeAccountId: account.stripeAccountId, livemode: account.livemode,
            kind: 'UNKNOWN_ATTEMPT', referenceId: attempt!.id, state: { not: 'RESOLVED' } }, data: { state: 'RESOLVED', resolvedAt: new Date(), version: { increment: 1 } } });
        });
        if (restart && !stripeId(session.subscription)) return;
      }
      if (!subscriptionId) return;
      let subscription = await this.stripe.request('GET', `/subscriptions/${subscriptionId}`);
      if (restart) {
        if (subscription.id === restart.subscriptionId || subscription.metadata?.billingAttemptId !== attempt!.id) throw new Error('billing.restart_subscription_binding');
        await restartSource(this.prisma, this.stripe, account, restart, subscription.id);
      }
      if (stripeId(subscription.customer) !== account.customerId || subscription.metadata?.billingAccountId !== account.id ||
          (account.baseSubscriptionId && account.baseSubscriptionId !== subscription.id && !restart)) throw new Error('billing.subscription_binding');
      const contractId = restart ? attempt!.id : account.contractAttemptId ?? subscription.metadata?.billingAttemptId;
      const contract = typeof contractId === 'string' ? await this.prisma.client.billingAttempt.findUnique({ where: { id: contractId } }) : null;
      if (!contract || contract.billingAccountId !== account.id || (!account.contractAttemptId && contract.id !== account.activeAttemptId)) throw new Error('billing.contract_binding');
      // Detect a second collectible subscription before granting or offering another purchase.
      const siblings = await this.stripe.list('/subscriptions', { customer: account.customerId, status: 'all' });
      if (siblings.filter((s) => !['canceled', 'incomplete_expired'].includes(s.status)).length > 1) {
        await this.billing.issue(account.companyId, 'DUPLICATE_SUBSCRIPTION', account.id); throw new Error('billing.duplicate_subscription');
      }
      const snapshot = contract.quoteSnapshot as unknown as BillingSnapshot;
      const invoices = await this.stripe.list('/invoices', { subscription: subscription.id });
      if (attempt && ['canceled', 'incomplete_expired'].includes(subscription.status) && invoices.length &&
        invoices.every(i => i.livemode === account.livemode && stripeId(i.customer) === account.customerId &&
          stripeId(i.parent?.subscription_details?.subscription) === subscription.id && i.status === 'void' && i.amount_paid === 0)) {
        await this.prisma.client.$transaction(async tx => {
          await lockPlanTermCompany(tx, account.companyId); await this.assertLease(tx, account.id, leaseToken);
          const current = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
          if (current.activeAttemptId !== attempt!.id || current.baseSubscriptionId !== (restart?.subscriptionId ?? null)) throw new Error('billing.restart_source_changed');
          await tx.billingAttempt.update({ where: { id: attempt!.id }, data: { status: 'EXPIRED', version: { increment: 1 } } });
          await tx.billingAccount.update({ where: { id: account.id }, data: { activeAttemptId: null, observedAt: new Date(), version: { increment: 1 } } });
        });
        return;
      }
      for (const invoice of invoices.filter((i) => i.status === 'paid').sort((a, b) => a.created - b.created)) {
        // A zero trial/credit invoice is never evidence of a successful card charge.
        if (invoice.total === 0) {
          if (!await this.billing.repeater.ownedZeroInvoice(account, invoice, await this.stripe.list(`/invoices/${invoice.id}/lines`, {}))) {
            await this.billing.issue(account.companyId, 'ZERO_INVOICE_REVIEW', invoice.id);
          }
          continue;
        }
        try {
          const lines = await this.stripe.list(`/invoices/${invoice.id}/lines`, {});
          const mapped = await this.prisma.client.billingInvoice.findUnique({ where: {
            billingAccountId_providerInvoiceId: { billingAccountId: account.id, providerInvoiceId: invoice.id },
          }, select: { contractSnapshot: true } });
          const serviceStart = lines[0]?.period?.start;
          if (!Number.isSafeInteger(serviceStart)) throw new Error('billing.invoice_period_missing');
          const invoiceSnapshot = mapped?.contractSnapshot ? mapped.contractSnapshot as unknown as BillingSnapshot :
            invoice.billing_reason === 'subscription_create' ? snapshot : await this.contractSnapshot(account.id, new Date(serviceStart * 1000), snapshot);
          await this.verifyAndApplyInvoice(account,contract,invoice,subscription,lines,invoiceSnapshot,leaseToken);
        } catch (error) { await this.billing.issue(account.companyId, 'PAID_NOT_APPLIED', invoice.id); throw error; }
      }
      const financial = await this.prisma.client.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
      // Keep the original first-purchase/restart command reachable until its paid invoice applies.
      // A complete Checkout can still be unpaid or PAID_HELD and must not lose its repair binding.
      if (attempt && !await this.prisma.client.billingInvoice.findFirst({ where: { billingAccountId: account.id, sourceAttemptId: attempt.id,
        applyStatus: 'APPLIED', appliedAt: { not: null } }, select: { id: true } })) return;
      // A pending restart cannot let the old terminated contract clear its payment reservation.
      if (restart && financial.baseSubscriptionId !== subscription.id) return;
      const renewalSnapshot = financial.paidThrough ? await this.contractSnapshot(account.id, financial.paidThrough, snapshot) : snapshot;
      subscription = await this.enforceGrace(account, subscription, invoices, renewalSnapshot, leaseToken);
      let prepaidNext: Date | null = null;
      if (stripeId(subscription.schedule)) {
        const schedule = await this.stripe.request('GET', `/subscription_schedules/${stripeId(subscription.schedule)}`);
        const last = schedule.phases?.at(-1);
        if (schedule.livemode === account.livemode && stripeId(schedule.customer) === account.customerId &&
            stripeId(schedule.subscription) === account.baseSubscriptionId && schedule.status === 'active' && schedule.end_behavior === 'release' &&
            stripeId(last?.items?.[0]?.price) === renewalSnapshot.priceId && last?.start_date > schedule.current_phase?.start_date &&
            last?.start_date * 1000 === financial.paidThrough?.getTime()) {
          prepaidNext = financial.paidThrough;
        }
      }
      await this.prisma.client.$transaction(async (tx) => {
        await lockPlanTermCompany(tx, account.companyId);
        await this.assertLease(tx, account.id, leaseToken);
        const current = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
        const item = subscription.items?.data?.find((i: StripeObject) => stripeId(i.price) === renewalSnapshot.priceId);
        const next = prepaidNext ?? (typeof item?.current_period_end === 'number' ? new Date(item.current_period_end * 1000) : null);
        await tx.billingAccount.update({ where: { id: account.id }, data: { baseSubscriptionId: subscription.id,
          contractAttemptId: contract.id, activeAttemptId: null, subscriptionState: subscription.status,
          collectionPauseJson: observedCollectionPause(subscription) ? observedCollectionPause(subscription) as Prisma.InputJsonValue : Prisma.DbNull,
          cancelAtPeriodEnd: subscription.cancel_at_period_end === true || (typeof subscription.cancel_at === 'number' && subscription.cancel_at * 1000 === current.paidThrough?.getTime()),
          nextChargeAt: subscription.cancel_at_period_end || subscription.cancel_at || ['canceled', 'incomplete_expired'].includes(subscription.status) ? null : next,
          observedAt: new Date(), version: { increment: 1 },
          // Provider payment can be HELD locally; keep grace provenance until paid application restores old grant expiry.
          graceEndsAt: current.graceEndsAt,
        } });
      });
      await this.prisma.client.billingIssue.updateMany({ where: { companyId: account.companyId, stripeAccountId: account.stripeAccountId, livemode: account.livemode, referenceId: account.id, kind: 'RECONCILIATION_FAILED', state: { not: 'RESOLVED' } },
        data: { state: 'RESOLVED', resolvedAt: new Date(), version: { increment: 1 } } });
    } finally {
      await this.prisma.client.billingAccount.updateMany({ where: { id: accountId, leaseToken }, data: { leaseToken: null, leaseUntil: null, nextReconcileAt: new Date(Date.now() + (onlyInvoiceId?0:300_000)) } });
    }
  }

  async importDiscoveredInvoice(accountId:string,findingId:string,sourceHash:string,guard:(tx:Prisma.TransactionClient)=>Promise<void>) {
    const lease=randomUUID(),now=new Date();
    const acquired=await this.prisma.client.billingAccount.updateMany({where:{id:accountId,stripeAccountId:this.stripe.accountId,livemode:this.stripe.livemode,
      OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},data:{leaseToken:lease,leaseUntil:new Date(now.getTime()+120_000)}});
    if(!acquired.count)throw new Error('billing.reconciliation_busy');
    try{
      const account=await this.prisma.client.billingAccount.findUniqueOrThrow({where:{id:accountId}});
      const source=await invoiceFindingSource(this.prisma.client,account,findingId);
      const authorize=async(tx:Prisma.TransactionClient=this.prisma.client)=>{
        await guard(tx);const current=await tx.billingAccount.findUniqueOrThrow({where:{id:account.id}}),fresh=await invoiceFindingSource(tx,current,findingId);
        if(!fresh.bound||fresh.sourceHash!==sourceHash)throw new Error('billing.finding_source_changed');
      };
      await authorize();
      const existing=await this.prisma.client.billingInvoice.findUnique({where:{billingAccountId_providerInvoiceId:{billingAccountId:account.id,providerInvoiceId:source.observation.providerInvoiceId}}});
      if(existing?.evidenceHash&&existing.providerStatus==='paid'&&existing.paidSatang>0&&existing.paidSatang===existing.totalSatang)return;
      await this.stripe.assertAccount();await authorize();
      const invoice=await this.stripe.request('GET',`/invoices/${source.observation.providerInvoiceId}`);
      if(invoice.id!==source.observation.providerInvoiceId||invoice.object!=='invoice'||invoice.livemode!==account.livemode||stripeId(invoice.customer)!==account.customerId||invoice.created!==source.observation.created)throw new Error('billing.invoice_binding');
      const subscriptionId=stripeId(invoice.parent?.subscription_details?.subscription);
      await authorize();
      const subscription=subscriptionId?await this.stripe.request('GET',`/subscriptions/${subscriptionId}`):null;
      const attemptId=subscription?.metadata?.billingAttemptId??invoice.metadata?.billingAttemptId;
      const attempt=typeof attemptId==='string'?await this.prisma.client.billingAttempt.findFirst({where:{id:attemptId,billingAccountId:account.id}}):null;
      const snapshot=attempt?.quoteSnapshot as unknown as BillingSnapshot|undefined;
      if(!attempt?.checkoutSessionId||!snapshot||attempt.consentRevision!==snapshot.quote.consentRevision||!Number.isFinite(attempt.consentAt.getTime())||attempt.consentAt>new Date()||
        snapshot.quote.companyId!==account.companyId||attempt.policyRevisionId!==snapshot.quote.policyRevision||Math.floor(attempt.consentAt.getTime()/1000)>invoice.created)throw new Error('billing.original_consent_missing');
      const session=await this.stripe.request('GET',`/checkout/sessions/${attempt.checkoutSessionId}`);
      if(session.id!==attempt.checkoutSessionId||session.object!=='checkout.session'||session.livemode!==account.livemode||session.status!=='complete'||
        stripeId(session.customer)!==account.customerId||session.client_reference_id!==attempt.id||session.metadata?.billingAccountId!==account.id||session.metadata?.billingAttemptId!==attempt.id)throw new Error('billing.session_binding');
      const siblings=await this.stripe.list('/subscriptions',{customer:account.customerId,status:'all'});
      if(siblings.filter(s=>!['canceled','incomplete_expired'].includes(s.status)).length>1)throw new Error('billing.duplicate_subscription');
      const attemptHash=hashBilling([attempt.quoteSnapshot,attempt.checkoutSessionId,attempt.consentRevision,attempt.consentAt,attempt.policyRevisionId]);
      const recordOnly=async(tx:Prisma.TransactionClient)=>{
        await authorize(tx);const current=await tx.billingAttempt.findFirst({where:{id:attempt.id,billingAccountId:account.id}});
        if(!current||hashBilling([current.quoteSnapshot,current.checkoutSessionId,current.consentRevision,current.consentAt,current.policyRevisionId])!==attemptHash)throw new Error('billing.original_contract_changed');
      };
      await authorize();
      if(snapshot.repeat){
        if(subscription||session.mode!=='payment'||stripeId(session.invoice)!==invoice.id)throw new Error('billing.original_invoice_changed');
        await this.billing.repeater.importPayment(account,attempt,session,invoice,lease,recordOnly);return;
      }
      if(!subscription||subscription.id!==subscriptionId||subscription.object!=='subscription'||subscription.livemode!==account.livemode||stripeId(subscription.customer)!==account.customerId||
        subscription.metadata?.billingAccountId!==account.id||session.mode!=='subscription'||stripeId(session.subscription)!==subscription.id||
        (attempt.subscriptionId&&attempt.subscriptionId!==subscription.id))throw new Error('billing.subscription_binding');
      const lines=await this.stripe.list(`/invoices/${invoice.id}/lines`,{}),start=lines[0]?.period?.start;
      if(!Number.isSafeInteger(start))throw new Error('billing.invoice_period_missing');
      // An old subscription uses its original consent; never fall back to a newer restarted contract.
      const contracts=await this.prisma.client.billingSubscriptionContract.findMany({where:{billingAccountId:account.id,effectiveAt:{lte:new Date(start*1000)}},orderBy:[{effectiveAt:'desc'},{revision:'desc'}],take:1});
      const effective=contracts[0]?.snapshotJson as unknown as BillingSnapshot|undefined;
      const contractSnapshot=invoice.billing_reason==='subscription_create'?snapshot:effective??snapshot;
      if(contractSnapshot.quote.companyId!==account.companyId||(!account.baseSubscriptionId||account.baseSubscriptionId!==subscription.id)&&contractSnapshot.quote.quoteId!==snapshot.quote.quoteId)throw new Error('billing.original_contract_changed');
      await this.verifyAndApplyInvoice(account,attempt,invoice,subscription,lines,contractSnapshot,lease,recordOnly);
    }finally{await this.prisma.client.billingAccount.updateMany({where:{id:accountId,leaseToken:lease},data:{leaseToken:null,leaseUntil:null}});}
  }

  private async reconcileOriginalInvoice(account:BillingAccount,id:string,lease:string) {
    const source=await this.prisma.client.billingInvoice.findFirstOrThrow({where:{id,billingAccountId:account.id}});
    if(source.applyStatus==='APPLIED'&&source.appliedAt)return;
    if(!account.customerId)throw new Error('billing.customer_unknown');
    const initial=source.sourceAttemptId?await this.prisma.client.billingAttempt.findFirst({where:{id:source.sourceAttemptId,billingAccountId:account.id}}):null;
    if(initial&&(initial.quoteSnapshot as unknown as BillingSnapshot).repeat){
      if(account.activeAttemptId!==initial.id||!initial.checkoutSessionId)throw new Error('billing.original_attempt_changed');
      const session=await this.stripe.request('GET',`/checkout/sessions/${initial.checkoutSessionId}`);
      if(session.status!=='complete'||session.payment_status!=='paid'||stripeId(session.invoice)!==source.providerInvoiceId)throw new Error('billing.original_invoice_changed');
      // Continue only the customer's original paid pack; the existing journal fences every command.
      await this.billing.repeater.advance(account,initial,lease,this.config.sesWebBaseUrl);return;
    }
    if(!source.subscriptionId)throw new Error('billing.subscription_binding');
    const subscription=await this.stripe.request('GET',`/subscriptions/${source.subscriptionId}`);
    if(subscription.id!==source.subscriptionId||stripeId(subscription.customer)!==account.customerId||subscription.metadata?.billingAccountId!==account.id)throw new Error('billing.subscription_binding');
    const contract=initial??await this.prisma.client.billingAttempt.findFirst({where:{id:String(subscription.metadata?.billingAttemptId??''),billingAccountId:account.id}});
    if(!contract)throw new Error('billing.contract_binding');
    const siblings=await this.stripe.list('/subscriptions',{customer:account.customerId,status:'all'});
    if(siblings.filter(s=>!['canceled','incomplete_expired'].includes(s.status)).length>1)throw new Error('billing.duplicate_subscription');
    const invoice=await this.stripe.request('GET',`/invoices/${source.providerInvoiceId}`);
    if(invoice.id!==source.providerInvoiceId)throw new Error('billing.original_invoice_changed');
    const lines=await this.stripe.list(`/invoices/${source.providerInvoiceId}/lines`,{});
    const snapshot=(source.contractSnapshot as unknown as BillingSnapshot|null)??await this.contractSnapshot(account.id,source.periodStart,contract.quoteSnapshot as unknown as BillingSnapshot);
    await this.verifyAndApplyInvoice(account,contract,invoice,subscription,lines,snapshot,lease);
  }
  private async verifyAndApplyInvoice(account:BillingAccount,contract:BillingAttempt,invoice:StripeObject,subscription:StripeObject,lines:StripeObject[],snapshot:BillingSnapshot,lease:string,recordOnly?:(tx:Prisma.TransactionClient)=>Promise<void>) {
    const payments=await this.stripe.list('/invoice_payments',{invoice:invoice.id}),payment=payments.find(p=>p.status==='paid'&&p.payment?.type==='payment_intent');
    if(!payment)throw new Error('billing.card_payment_missing');
    const intent=await this.stripe.request('GET',`/payment_intents/${stripeId(payment.payment.payment_intent)}`,{expand:['latest_charge.balance_transaction']});
    const charge=typeof intent.latest_charge==='object'?intent.latest_charge:await this.stripe.request('GET',`/charges/${stripeId(intent.latest_charge)}`,{expand:['balance_transaction']});
    await this.applyInvoice(account,contract,paidInvoiceEvidence(invoice,subscription,lines,payments,intent,charge,snapshot,this.stripe.livemode),snapshot,lease,recordOnly);
  }

  private async contractSnapshot(accountId: string, at: Date, fallback: BillingSnapshot): Promise<BillingSnapshot> {
    if (!Number.isSafeInteger(at.getTime())) throw new Error('billing.invalid_contract_time');
    const contract = await this.prisma.client.billingSubscriptionContract.findFirst({ where: {
      billingAccountId: accountId, effectiveAt: { lte: at },
    }, orderBy: [{ effectiveAt: 'desc' }, { revision: 'desc' }] });
    return contract ? contract.snapshotJson as unknown as BillingSnapshot : fallback;
  }

  private async assertLease(tx: Prisma.TransactionClient, accountId: string, leaseToken: string): Promise<void> {
    // Lock the fence until this transaction commits; an expired worker cannot overwrite its successor.
    await tx.$queryRaw`SELECT "id" FROM "BillingAccount" WHERE "id" = ${accountId} FOR UPDATE`;
    const account = await tx.billingAccount.findUniqueOrThrow({ where: { id: accountId } });
    if (account.leaseToken !== leaseToken || !account.leaseUntil || account.leaseUntil <= new Date()) throw new Error('billing.lost_lease');
  }

  private async enforceGrace(account: BillingAccount, subscription: StripeObject, invoices: StripeObject[], snapshot: BillingSnapshot, leaseToken: string): Promise<StripeObject> {
    if (subscription.status === 'canceled') {
      // Lost DELETE responses are recovered from observed provider state, without another cancellation.
      await this.prisma.client.$transaction(async tx => {
        await lockPlanTermCompany(tx, account.companyId); await this.assertLease(tx, account.id, leaseToken);
        const pending = await tx.billingOperation.findMany({ where: { companyId: account.companyId, stripeAccountId: account.stripeAccountId,
          livemode: account.livemode, type: 'GRACE_EXPIRE', state: { in: ['RUNNING', 'UNKNOWN'] } } });
        for (const operation of pending) {
          if ((operation.proposedJson as { subscriptionId?: string }).subscriptionId !== subscription.id) continue;
          await tx.billingOperation.update({ where: { id: operation.id }, data: { state: 'SUCCEEDED', observedAt: new Date(), errorCode: null,
            resultJson: { subscriptionState: 'canceled', nextChargeAt: null } } });
          await tx.billingIssue.updateMany({ where: { stripeAccountId: account.stripeAccountId, livemode: account.livemode,
            kind: 'GRACE_CANCELLATION_UNKNOWN', referenceId: operation.id }, data: { state: 'RESOLVED', resolvedAt: new Date() } });
        }
      });
    }
    if (!['past_due', 'unpaid'].includes(subscription.status)) return subscription;
    const current = await this.prisma.client.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
    if (!current.paidThrough || snapshot.policy.graceDays === null) return subscription;
    const unpaid = invoices.find(invoice => invoice.id === stripeId(subscription.latest_invoice));
    // A provider status alone cannot give free access: this must be this contract's unpaid renewal.
    if (!unpaid || unpaid.status !== 'open' || unpaid.billing_reason !== 'subscription_cycle' ||
        unpaid.livemode !== account.livemode || stripeId(unpaid.customer) !== account.customerId ||
        stripeId(unpaid.parent?.subscription_details?.subscription) !== subscription.id ||
        unpaid.total !== snapshot.quote.totalSatang || unpaid.currency !== 'thb' || unpaid.amount_paid !== 0) {
      await this.billing.issue(account.companyId, 'RENEWAL_REVIEW', account.id); return subscription;
    }
    const lines = await this.stripe.list(`/invoices/${unpaid.id}/lines`, {});
    const line = lines[0], details = line?.parent?.subscription_item_details;
    if (lines.length !== 1 || line?.parent?.type !== 'subscription_item_details' || details?.proration !== false ||
        line?.livemode !== account.livemode || line?.currency !== 'thb' || line?.quantity !== 1 ||
        (line?.discount_amounts?.length ?? 0) !== 0 || stripeId(details.subscription) !== subscription.id ||
        line?.pricing?.price_details?.price !== snapshot.priceId || line?.period?.start * 1000 !== current.paidThrough.getTime()) {
      await this.billing.issue(account.companyId, 'RENEWAL_REVIEW', account.id); return subscription;
    }
    const graceEnd = new Date(current.paidThrough.getTime() + snapshot.policy.graceDays * 86400000);
    await this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${account.companyId}`}))`;
      await lockPlanTermCompany(tx, account.companyId);
      await this.assertLease(tx, account.id, leaseToken);
      const fresh = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
      if (fresh.paidThrough?.getTime() !== current.paidThrough!.getTime()) throw new Error('billing.grace_source_changed');
      const company = await tx.company.findUniqueOrThrow({ where: { id: account.companyId }, include: { planTerm: true } });
      const term = company.planTerm;
      const eligible = term?.billingReceiptAccountId === account.id && termProjectionHash(term) === fresh.termProjectionHash &&
        (company.status === 'ACTIVE' || (company.status === 'DISABLED' && term.termDisabledAt));
      if (eligible && graceEnd > new Date() && term.termEndsAt < graceEnd) {
        const updated = await tx.companyPlanTerm.update({ where: { companyId: account.companyId }, data: { termEndsAt: graceEnd, termDisabledAt: null } });
        // Preserve the unspent old units, never mint a renewal grant for an unpaid invoice.
        await tx.billingReceiptGrant.updateMany({ where: { billingAccountId: account.id, companyId: account.companyId,
          kind: { not: 'ADMIN_ADJUSTMENT' }, revokedAt: null, expiresAt: current.paidThrough! }, data: { expiresAt: graceEnd } });
        if (company.status === 'DISABLED') await this.lifecycle.execute({ companyId: account.companyId, targetStatus: 'ACTIVE',
          requestingAdminUserId: null, requestId: unpaid.id, reason: 'stripe_renewal_grace' }, tx);
        await tx.billingAccount.update({ where: { id: account.id }, data: { termProjectionHash: termProjectionHash(updated) } });
        await tx.auditLog.create({ data: { companyId: account.companyId, action: 'billing.grace.started', targetType: 'BillingAccount', targetId: account.id,
          requestId: unpaid.id, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { paidThrough: current.paidThrough!.toISOString(), graceEndsAt: graceEnd.toISOString() } } });
      }
      await tx.billingAccount.update({ where: { id: account.id }, data: { graceEndsAt: graceEnd } });
    });
    if (graceEnd > new Date()) return subscription;
    // Reread immediately before cancelling: a recovered payment or a newer invoice changes the command.
    const latest = await this.stripe.request('GET', `/subscriptions/${subscription.id}`);
    if (latest.id !== subscription.id || latest.livemode !== account.livemode || stripeId(latest.customer) !== account.customerId || latest.metadata?.billingAccountId !== account.id) throw new Error('billing.subscription_binding');
    if (!['past_due', 'unpaid'].includes(latest.status) || stripeId(latest.latest_invoice) !== unpaid.id) return latest;
    const key = `grace-expire:${account.id}:${current.paidThrough.getTime()}`;
    const operation = await this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, account.companyId); await this.assertLease(tx, account.id, leaseToken);
      return tx.billingOperation.upsert({ where: { stripeAccountId_livemode_idempotencyKey: {
        stripeAccountId: account.stripeAccountId, livemode: account.livemode, idempotencyKey: key } }, update: {},
        create: { stripeAccountId: account.stripeAccountId, livemode: account.livemode, companyId: account.companyId,
          type: 'GRACE_EXPIRE', state: 'RUNNING', referenceId: unpaid.id, sourceVersion: current.version,
          proposedJson: { subscriptionId: subscription.id, paidThrough: current.paidThrough!.toISOString(), invoiceId: unpaid.id },
          reason: 'approved_renewal_grace_expired', initiatorUserId: 'billing-worker', idempotencyKey: key,
          requestHash: hashBilling([subscription.id, unpaid.id, graceEnd]), expiresAt: graceEnd } });
    });
    try {
      const cancelled = await this.stripe.request('DELETE', `/subscriptions/${subscription.id}`, { invoice_now: false, prorate: false }, key);
      if (cancelled.id !== subscription.id || cancelled.status !== 'canceled' || stripeId(cancelled.customer) !== account.customerId) throw new Error('billing.cancellation_unconfirmed');
      await this.prisma.client.$transaction(async tx => {
        await lockPlanTermCompany(tx, account.companyId); await this.assertLease(tx, account.id, leaseToken);
        await tx.billingOperation.update({ where: { id: operation.id }, data: { state: 'SUCCEEDED', observedAt: new Date(), errorCode: null,
          resultJson: { subscriptionState: 'canceled', nextChargeAt: null } } });
      });
      return cancelled;
    } catch (error) {
      await this.prisma.client.billingOperation.updateMany({ where: { id: operation.id, state: { not: 'SUCCEEDED' } }, data: { state: 'UNKNOWN', errorCode: 'cancellation_unconfirmed' } });
      await this.billing.issue(account.companyId, 'GRACE_CANCELLATION_UNKNOWN', operation.id); throw error;
    }
  }

  private async applyInvoice(account: BillingAccount, contract: BillingAttempt, evidence: PaidInvoiceEvidence, snapshot: BillingSnapshot, leaseToken: string, recordOnly?:(tx:Prisma.TransactionClient)=>Promise<void>): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${account.companyId}`}))`;
      await lockPlanTermCompany(tx, account.companyId);
      await this.assertLease(tx, account.id, leaseToken);
      if(recordOnly)await recordOnly(tx);
      const existing = await tx.billingInvoice.findUnique({ where: { billingAccountId_providerInvoiceId: { billingAccountId: account.id, providerInvoiceId: evidence.invoiceId } } });
      if (existing?.evidenceHash && existing.evidenceHash !== evidence.evidenceHash) throw new Error('billing.invoice_evidence_changed');
      const invoice = await tx.billingInvoice.upsert({ where: { billingAccountId_providerInvoiceId: { billingAccountId: account.id, providerInvoiceId: evidence.invoiceId } },
        create: { billingAccountId: account.id, providerInvoiceId: evidence.invoiceId, subscriptionId: evidence.subscriptionId,
          sourceAttemptId: evidence.kind === 'INITIAL' ? contract.id : null,
          providerNumber: evidence.number, offerSnapshot: snapshot.quote.offer as unknown as Prisma.InputJsonValue,
          contractSnapshot: snapshot as unknown as Prisma.InputJsonValue, policyRevisionId: snapshot.quote.policyRevision,
          currency: 'THB', totalSatang: evidence.totalSatang, paidSatang: evidence.paidSatang, taxSatang: evidence.taxSatang,
          feeSatang: evidence.feeSatang, refundedSatang: evidence.refundedSatang, disputed: evidence.disputed, financialObservedAt: new Date(), providerChargeId: evidence.chargeId,
          periodStart: evidence.periodStart, periodEnd: evidence.periodEnd, providerStatus: 'paid', evidenceHash: evidence.evidenceHash },
        update: { feeSatang: evidence.feeSatang,
          ...(existing?.contractSnapshot ? {} : { contractSnapshot: snapshot as unknown as Prisma.InputJsonValue }) } });
      await recordBillingFinancials(tx,account,invoice,{refundedSatang:evidence.refundedSatang,disputed:evidence.disputed});
      if(recordOnly){
        if(!invoice.appliedAt){await tx.billingInvoice.update({where:{id:invoice.id},data:{applyStatus:'HELD',errorCode:'access_review_required'}});
          await detectBillingIssue(tx,{companyId:account.companyId,stripeAccountId:account.stripeAccountId,livemode:account.livemode,kind:'PAID_HELD',referenceId:invoice.id});}
        await tx.auditLog.create({data:{companyId:account.companyId,action:'billing.invoice.imported',targetType:'BillingInvoice',targetId:invoice.id,requestId:invoice.id,result:'SUCCESS',riskLevel:'HIGH',metadataJson:{sourceAttemptId:contract.id,rightsChanged:false}}});return;
      }
      const current = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
      const restarting = evidence.kind === 'INITIAL' ? snapshot.restart : undefined;
      const currentContract = restarting ? current.baseSubscriptionId === restarting.subscriptionId && current.activeAttemptId === contract.id &&
        current.contractAttemptId === restarting.contractAttemptId && current.paidThrough?.toISOString() === restarting.paidThrough :
        current.baseSubscriptionId === evidence.subscriptionId || (evidence.kind === 'INITIAL' && current.baseSubscriptionId === null && current.activeAttemptId === contract.id);
      if (evidence.kind === 'INITIAL' && currentContract) await tx.billingSubscriptionContract.upsert({ where: {
        billingAccountId_sourceAttemptId: { billingAccountId: account.id, sourceAttemptId: contract.id },
      }, create: { billingAccountId: account.id, sourceAttemptId: contract.id, effectiveAt: evidence.periodStart,
        snapshotJson: snapshot as unknown as Prisma.InputJsonValue }, update: {} });
      if (invoice.appliedAt) return;
      const company = await tx.company.findUniqueOrThrow({ where: { id: account.companyId }, include: { planTerm: true } });
      const planChange = snapshot.planChangeId ? await tx.billingOperation.findUnique({ where: { id: snapshot.planChangeId } }) : null;
      const applyingChange = evidence.kind === 'RENEWAL' && !!planChange && planChange.state !== 'APPLIED';
      const proposedChange = planChange?.proposedJson as unknown as ScheduledChange | undefined;
      const changeBound = !snapshot.planChangeId || (planChange?.companyId === company.id && planChange.stripeAccountId === account.stripeAccountId && planChange.livemode === account.livemode &&
        proposedChange?.accountId === account.id && proposedChange.subscriptionId === evidence.subscriptionId &&
        (planChange.state === 'APPLIED' || (planChange.state === 'SUCCEEDED' && current.pendingPlanChangeId === planChange.id && proposedChange.paidThrough === evidence.periodStart.toISOString())));
      const capacity = evidence.kind === 'INITIAL' ? await attemptCapacity(tx, account.id, contract) : applyingChange && proposedChange ?
        await attemptCapacity(tx, account.id, { id: planChange!.id, quoteSnapshot: { ...snapshot, capacity: proposedChange.change.selection } as unknown as Prisma.JsonValue }) : undefined;
      const capacityReady = changeBound && ((evidence.kind !== 'INITIAL' && !applyingChange) || (capacity ?
        capacityValid(await capacityOptions(tx, company.id, snapshot.quote.offer), capacity) : await restartFits(tx, company.id, snapshot.quote.offer)));
      // Historical evidence cannot replace a newer customer contract merely because its paid end is later.
      const held = !currentContract || (current.paidThrough !== null && evidence.periodEnd <= current.paidThrough) || (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt)) ||
        evidence.disputed || evidence.refundedSatang > 0 || evidence.periodEnd <= new Date() || evidence.periodStart > new Date() ||
        termProjectionHash(company.planTerm) !== (current.termProjectionHash ?? snapshot.termHash) || !capacityReady ||
        (restarting && (current.baseSubscriptionId !== restarting.subscriptionId || current.activeAttemptId !== contract.id ||
          current.contractAttemptId !== restarting.contractAttemptId || current.paidThrough?.toISOString() !== restarting.paidThrough));
      if (held) {
        await tx.billingInvoice.update({ where: { id: invoice.id }, data: { applyStatus: 'HELD', errorCode: !capacityReady ? 'BILLING_CAP_SELECTION_REQUIRED' : 'access_review_required' } });
        await detectBillingIssue(tx,{stripeAccountId:account.stripeAccountId,livemode:account.livemode,companyId:company.id,kind:'PAID_HELD',referenceId:invoice.id});
        return;
      }
      if (!current.paidThrough || evidence.periodEnd > current.paidThrough) {
        const offer = snapshot.quote.offer;
        if (capacity) await applyCapacity(tx, company.id, offer, capacity, applyingChange ? planChange!.initiatorUserId : contract.initiatingUserId, invoice.id);
        if (current.graceEndsAt && current.paidThrough) await tx.billingReceiptGrant.updateMany({ where: { billingAccountId: account.id,
          companyId: company.id, kind: { not: 'ADMIN_ADJUSTMENT' }, expiresAt: current.graceEndsAt, serviceEnd: { lte: current.paidThrough } }, data: { expiresAt: current.paidThrough } });
        const term = await tx.companyPlanTerm.upsert({ where: { companyId: company.id }, create: {
          companyId: company.id, tierKey: offer.offerKey, branchLimit: offer.branchLimit, employeeLimit: offer.employeeLimit, monthlySlipLimit: offer.monthlySlipLimit,
          termStartAt: evidence.periodStart, termEndsAt: evidence.periodEnd, lastRenewedAt: new Date(),
        }, update: { tierKey: offer.offerKey, branchLimit: offer.branchLimit, employeeLimit: offer.employeeLimit, monthlySlipLimit: offer.monthlySlipLimit,
          termStartAt: evidence.periodStart, termEndsAt: evidence.periodEnd, termDisabledAt: null, warmupUntil: null, warmupSlipLimit: null,
          warn7SentAt: null, warn3SentAt: null, warn1SentAt: null, expiredNotifiedAt: null, lastRenewedAt: new Date(), renewCount: { increment: 1 } } });
        if (company.status === 'DISABLED' && company.planTerm?.termDisabledAt) await this.lifecycle.execute({ companyId: company.id, targetStatus: 'ACTIVE',
          requestingAdminUserId: null, requestId: invoice.id, reason: 'stripe_verified_paid' }, tx);
        await grantPaidPackageReceipts(tx, { companyId: company.id, billingAccountId: account.id, sourceKey: invoice.id,
          policyRevisionId: snapshot.quote.policyRevision, kind: evidence.kind, units: offer.receiptAllowance,
          serviceStart: evidence.periodStart, serviceEnd: evidence.periodEnd, availableAt: evidence.periodStart, expiresAt: evidence.periodEnd });
        if ((applyingChange || restarting) && current.pendingPlanChangeId) await tx.billingOperation.update({ where: { id: current.pendingPlanChangeId },
          data: { state: applyingChange ? 'APPLIED' : 'SUPERSEDED', observedAt: new Date(), version: { increment: 1 } } });
        await tx.billingAccount.update({ where: { id: account.id }, data: { paidThrough: evidence.periodEnd, graceEndsAt: null,
          ...(applyingChange || restarting ? { pendingPlanChangeId: null } : {}),
          ...(restarting ? { baseSubscriptionId: evidence.subscriptionId, contractAttemptId: contract.id, activeAttemptId: null } : {}),
          termProjectionHash: termProjectionHash({ ...term, billingReceiptAccountId: account.id }), version: { increment: 1 } } });
      }
      await tx.billingInvoice.update({ where: { id: invoice.id }, data: { applyStatus: 'APPLIED', appliedAt: new Date(), errorCode: null, version: { increment: 1 } } });
      await fulfillPaidPackageRequest(tx,company.id,account.id,invoice.id);
      await tx.billingIssue.updateMany({ where: { companyId: company.id, stripeAccountId: account.stripeAccountId, livemode: account.livemode,
        kind: 'PAID_HELD', referenceId: invoice.id, state: { not: 'RESOLVED' } }, data: { state: 'RESOLVED', resolvedAt: new Date(), version: { increment: 1 } } });
      await tx.auditLog.create({ data: { companyId: company.id, action: 'billing.invoice.applied', targetType: 'BillingInvoice', targetId: invoice.id,
        requestId: invoice.id, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { periodStart: evidence.periodStart.toISOString(), periodEnd: evidence.periodEnd.toISOString(), tierKey: snapshot.quote.offer.offerKey } } });
      await tx.outboxEvent.upsert({ where: { eventKey: `billing:applied:${invoice.id}` }, update: {}, create: {
        companyId: company.id, eventType: 'billing.invoice.applied', aggregateType: 'BillingInvoice', aggregateId: invoice.id,
        eventKey: `billing:applied:${invoice.id}`, payloadJson: { schemaVersion: 1, occurredAt: new Date().toISOString(), data: { invoiceId: invoice.id, companyId: company.id } },
      } });
    });
  }

  async scan(): Promise<{ scanned: number; failed: number }> {
    if (!this.stripe.enabled) return { scanned: 0, failed: 0 };
    const now = new Date();
    const accounts = await this.prisma.client.billingAccount.findMany({ where: { stripeAccountId: this.stripe.accountId, livemode: this.stripe.livemode,
      nextReconcileAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
      orderBy: [{ nextReconcileAt: 'asc' }, { id: 'asc' }], take: 20 });
    let failed = 0;
    for (const account of accounts) {
      try { await this.reconcileAccount(account.id); }
      catch { failed += 1; await this.billing.issue(account.companyId, 'RECONCILIATION_FAILED', account.id); }
    }
    return { scanned: accounts.length, failed };
  }
}
