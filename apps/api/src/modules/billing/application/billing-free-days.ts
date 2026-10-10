import type { PartnerLifecycleTransitionUseCase } from '../../system-partner-management/application/use-cases/partner-lifecycle-transition.use-case';
import { randomUUID } from 'node:crypto';
import type { BillingAccount, BillingOperation, Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { assertStripePrice, billingError, hashBilling } from '../domain/billing-policy';
import { appendPackageInterval } from '../domain/billing-package';
import { termProjectionHash } from '../domain/paid-invoice';
import { stripeId, type StripeObject } from '../infrastructure/stripe.client';
import type { BillingService, BillingSnapshot } from './billing.service';
import { collectionSourceHash } from './billing-collection';
import { collectionContract, currentSchedulePhase, sameScheduleTaxes, schedulePhase, simpleCollection, subscriptionGraph } from './billing-schedule';
import { assertNoPendingRefund } from './billing-refund-source';

export type FreeDaySource = {
  days: number; before: string; after: string; nextChargeBefore: string | null; nextChargeAfter: string | null;
  subscriptionId: string; termHash: string; providerHash: string; originalScheduleId: string | null;
  current: BillingSnapshot; future: BillingSnapshot; pendingId: string | null; pendingVersion: number | null;
  cancel: boolean; zeroPriceId: string; phases: ReturnType<typeof schedulePhase>[];
};
type Journal = { freeDays?: { scheduleId?: string; createdHash?: string; createAt?: string; updateAt?: string; updateHash?: string } };
const review = () => billingError('CONTROL_FREE_DAYS_REVIEW', 'ยังปรับวันไม่ได้ ตรวจรายการต่ออายุเดิมแล้วลองรายการนี้อีกครั้ง');
const json = (value: unknown) => value as Prisma.InputJsonValue;
/** After `expiresAt` nothing is sent; one hour later nothing sent can still be in flight. */
const SETTLE_MS = 3_600_000;

/** A gift changes the collection boundary; it is never a paid receipt grant. */
export class BillingFreeDays {
  constructor(private readonly prisma: PrismaService, private readonly billing: BillingService, private readonly lifecycle?: PartnerLifecycleTransitionUseCase) {}

  async source(account: BillingAccount, days: number): Promise<FreeDaySource> {
    const stripe = this.billing.stripe;
    if (!Number.isSafeInteger(days) || days < 1 || days > 3650 || !stripe.enabled || !account.paidThrough ||
      account.paidThrough.getTime() <= Date.now() + 600000 || !account.baseSubscriptionId || account.graceEndsAt ||
      account.activeAttemptId || account.activeCollectionOperationId || (account.leaseUntil && account.leaseUntil > new Date())) throw review();
    await assertNoPendingRefund(this.prisma.client, account);
    if (!await this.prisma.client.billingInvoice.findFirst({ where: { billingAccountId: account.id, subscriptionId: account.baseSubscriptionId,
      providerStatus: 'paid', applyStatus: 'APPLIED', appliedAt: { not: null }, paidSatang: { gt: 0 }, refundedSatang: 0, disputed: false } })) throw review();
    const company = await this.prisma.client.company.findUniqueOrThrow({ where: { id: account.companyId }, include: { planTerm: true } });
    if (company.status !== 'ACTIVE' || company.planTerm?.termDisabledAt || termProjectionHash(company.planTerm) !== account.termProjectionHash ||
      company.planTerm?.billingReceiptAccountId !== account.id || company.planTerm.termEndsAt.getTime() !== account.paidThrough.getTime()) throw review();
    const contracts = await collectionContract(this.prisma.client, account), { current, future, pending } = contracts;
    const { sub, schedule } = await subscriptionGraph(stripe, account), target = account.paidThrough.getTime() / 1000;
    if (sub.status !== 'active' || sub.billing_mode?.type !== 'classic' || sub.pause_collection || sub.pending_update || sub.pending_invoice_item_interval ||
      !simpleCollection(sub) || sub.items?.has_more || sub.items?.data?.length !== 1 || sub.items.data[0].quantity !== 1 ||
      (sub.items.data[0].discounts?.length ?? 0) || sub.collection_method !== 'charge_automatically' ||
      (account.cancelAtPeriodEnd ? sub.cancel_at !== target : sub.cancel_at || sub.cancel_at_period_end)) throw review();
    if (schedule) await currentSchedulePhase(this.prisma.client, account, sub, schedule, current, future);
    else if (stripeId(sub.items.data[0].price) !== current.priceId || sub.items.data[0].current_period_end !== target ||
      !sameScheduleTaxes(sub.items.data[0].tax_rates, current.policy.taxRateId)) throw review();
    await this.billing.repeater.assertNoDebt(account, await stripe.list('/invoices', { subscription: account.baseSubscriptionId }));
    const zeroPriceId = current.repeat?.zeroPriceId ?? current.policy.zeroPriceIds?.[`${current.quote.offer.offerKey as 'PRO_999'}:${current.quote.offer.interval}`];
    if (!zeroPriceId) throw review();
    const zero = await stripe.request('GET', `/prices/${zeroPriceId}`), paid = await stripe.request('GET', `/prices/${current.priceId}`);
    assertStripePrice(zero, { ...current.quote.offer, priceSatang: 0 }, current.policy, account.livemode, zeroPriceId);
    if (!stripeId(paid.product) || stripeId(zero.product) !== stripeId(paid.product)) throw review();
    await this.billing.assertTaxSettings(future.policy);
    const after = new Date(account.paidThrough.getTime() + days * 86400000);
    const start = schedule?.current_phase?.start_date ?? sub.items.data[0].current_period_start;
    if (!Number.isSafeInteger(start) || start >= target || !Number.isSafeInteger(after.getTime()) || after.getTime() % 1000) throw review();
    return { days, before: account.paidThrough.toISOString(), after: after.toISOString(), nextChargeBefore: account.nextChargeAt?.toISOString() ?? null,
      nextChargeAfter: account.cancelAtPeriodEnd ? null : after.toISOString(), subscriptionId: account.baseSubscriptionId, termHash: account.termProjectionHash!,
      providerHash: collectionSourceHash(sub, schedule), originalScheduleId: schedule?.id ?? null, current, future,
      pendingId: pending?.row.id ?? null, pendingVersion: pending?.row.version ?? null, cancel: account.cancelAtPeriodEnd, zeroPriceId,
      phases: [schedulePhase(start, after.getTime() / 1000, zeroPriceId, null), ...account.cancelAtPeriodEnd ? [] :
        [schedulePhase(after.getTime() / 1000, appendPackageInterval(after, future.quote.offer.interval).getTime() / 1000, future.priceId, future.policy.taxRateId, true)]] };
  }

  private observed(account: BillingAccount, source: FreeDaySource, sub: StripeObject, schedule: StripeObject | null, operationId: string) {
    const target = Date.parse(source.after) / 1000;
    const terminal = source.cancel && schedule?.status === 'completed' && sub.status === 'canceled' && Date.now() >= target * 1000;
    const phases = terminal ? schedule?.phases?.slice(-source.phases.length) : schedule?.phases?.filter((phase: StripeObject) => phase.end_date > schedule.current_phase?.start_date);
    // A delayed observer may see the paid renewal phase. Local renewal reconciliation runs after the gift is recorded.
    const advanced = !source.cancel && schedule?.current_phase?.start_date === target && Date.now() >= target * 1000;
    const expected = advanced ? source.phases.slice(1) : source.phases;
    return !!schedule && schedule.metadata?.mangmeeFreeDaysOperation === operationId && schedule.metadata?.billingAccountId === account.id &&
      (terminal || schedule.status === 'active') && schedule.end_behavior === (source.cancel ? 'cancel' : 'release') && simpleCollection(schedule.default_settings ?? {}) &&
      (terminal || ['active','past_due','unpaid'].includes(sub.status)) && sub.billing_mode?.type === 'classic' && !sub.pause_collection && !sub.pending_update && simpleCollection(sub) &&
      sub.collection_method === 'charge_automatically' && !sub.pending_invoice_item_interval &&
      sub.items?.has_more === false && sub.items.data.length === 1 && sub.items.data[0].quantity === 1 && !(sub.items.data[0].discounts?.length ?? 0) &&
      Number.isSafeInteger(sub.items.data[0].current_period_start) && Number.isSafeInteger(sub.items.data[0].current_period_end) &&
      sub.items.data[0].current_period_start >= expected[0]!.start_date && sub.items.data[0].current_period_start < expected[0]!.end_date &&
      sub.items.data[0].current_period_end > sub.items.data[0].current_period_start && (!advanced || sub.items.data[0].current_period_end === expected[0]!.end_date) &&
      stripeId(sub.items.data[0].price) === expected[0]?.items[0]?.price && sameScheduleTaxes(sub.items.data[0].tax_rates, advanced ? source.future.policy.taxRateId : null) &&
      (source.cancel ? (terminal ? sub.ended_at === target : sub.cancel_at === target) : !sub.cancel_at && !sub.cancel_at_period_end) &&
      (!advanced || sub.billing_cycle_anchor === target) && Array.isArray(phases) && phases.length === expected.length &&
      phases.every((phase: StripeObject, index: number) => {
        const desired = expected[index]!;
        return phase.start_date === desired.start_date && phase.end_date === desired.end_date && simpleCollection(phase) && !phase.trial_end &&
          phase.items?.length === 1 && phase.items[0].quantity === 1 && !phase.items[0].discounts?.length && stripeId(phase.items[0].price) === desired.items[0]!.price &&
          sameScheduleTaxes(phase.items[0].tax_rates, desired.start_date === target ? source.future.policy.taxRateId : null) &&
          (desired.start_date !== target || phase.billing_cycle_anchor === 'phase_start');
      });
  }

  async advance(account: BillingAccount, row: BillingOperation, lease: string,
    authorize: (tx: Prisma.TransactionClient, row: BillingOperation) => Promise<void>) {
    const p = row.proposedJson as unknown as { accountId: string; dayExtension: FreeDaySource };
    const source = p.dayExtension, journal = structuredClone((row.resultJson ?? {}) as Journal), progress = journal.freeDays ??= {};
    const stripe = this.billing.stripe;
    if (p.accountId !== account.id || source.subscriptionId !== account.baseSubscriptionId) throw review();
    const fence = async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${account.companyId}`}))`;
      await lockPlanTermCompany(tx, account.companyId);
      const current = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
      if (current.activeCollectionOperationId !== row.id || current.leaseToken !== lease || !current.leaseUntil || current.leaseUntil <= new Date() ||
        current.baseSubscriptionId !== source.subscriptionId || current.paidThrough?.toISOString() !== source.before || current.pendingPlanChangeId !== source.pendingId ||
        current.termProjectionHash !== source.termHash || current.cancelAtPeriodEnd !== source.cancel) throw review();
      const company = await tx.company.findUniqueOrThrow({ where: { id: account.companyId }, include: { planTerm: true } });
      if (termProjectionHash(company.planTerm) !== source.termHash || (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))) throw review();
      if (source.pendingId) {
        const pending = await tx.billingOperation.findUniqueOrThrow({ where: { id: source.pendingId } });
        if (pending.version !== source.pendingVersion || pending.state !== 'SUCCEEDED') throw review();
      }
      return company;
    };
    const save = (checkAuthority = false) => this.prisma.client.$transaction(async tx => {
      await fence(tx);
      if (checkAuthority) { if (row.expiresAt <= new Date()) throw review(); await authorize(tx, row); await assertNoPendingRefund(tx, account); }
      await tx.billingOperation.update({ where: { id: row.id }, data: { resultJson: json(journal), state: 'RUNNING', version: { increment: 1 } } });
    });
    // A send marker is kept only when it was stored with the authority check, so that the send really follows it.
    const mark = async (key: 'createAt' | 'updateAt') => {
      const had = progress[key]; progress[key] ??= new Date().toISOString();
      try { await save(true); } catch (error) { if (!had) delete progress[key]; throw error; }
    };
    // Over without a change (2026-10-10): nothing is sent, the account is released in this transaction, the review case stays open.
    const end = async (errorCode: 'CONTROL_FREE_DAYS_NOT_SENT' | 'CONTROL_FREE_DAYS_NOT_APPLIED') => {
      await this.prisma.client.$transaction(async tx => {
        await lockPlanTermCompany(tx, account.companyId);
        const current = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
        if (current.activeCollectionOperationId !== row.id || current.leaseToken !== lease || !current.leaseUntil || current.leaseUntil <= new Date()) throw review();
        await tx.billingAccount.update({ where: { id: account.id }, data: { activeCollectionOperationId: null, version: { increment: 1 } } });
        await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'FAILED', errorCode, resultJson: json(journal), version: { increment: 1 } } });
        await tx.auditLog.create({ data: { companyId: account.companyId, actorUserId: row.approverUserId, action: 'billing.free_days.ended', targetType: 'BillingOperation',
          targetId: row.id, requestId: row.id, result: 'FAILED', riskLevel: 'CRITICAL', metadataJson: { errorCode, reason: row.reason, days: source.days, before: source.before } } });
      });
      await this.billing.issue(account.companyId, 'CUSTOMER_COLLECTION_REVIEW', row.id);
    };
    try {
      let graph = await subscriptionGraph(stripe, account);
      const retainedScheduleId = source.originalScheduleId ?? progress.scheduleId;
      if (!graph.schedule && retainedScheduleId && progress.updateAt) {
        const retained = await stripe.request('GET', `/subscription_schedules/${retainedScheduleId}`);
        if (retained.id !== retainedScheduleId || retained.object !== 'subscription_schedule' || stripeId(retained.subscription) !== source.subscriptionId ||
          stripeId(retained.customer) !== account.customerId || retained.livemode !== account.livemode) throw review();
        graph = { ...graph, schedule: retained };
      }
      if (!this.observed(account, source, graph.sub, graph.schedule, row.id)) {
        // No send can leave after expiresAt (`save(true)`), so an hour later nothing is in flight. A schedule without our id and an unchanged
        // source = the provider holds nothing of this command. A schedule left by our create changes the source: that case keeps waiting.
        if ((progress.createAt || progress.updateAt) && Date.now() - row.expiresAt.getTime() >= SETTLE_MS &&
          graph.schedule?.metadata?.mangmeeFreeDaysOperation !== row.id && collectionSourceHash(graph.sub, graph.schedule) === source.providerHash)
          return await end('CONTROL_FREE_DAYS_NOT_APPLIED');
        if (progress.createAt && !progress.scheduleId) {
          if (Date.now() - Date.parse(progress.createAt) >= 23 * 3600000) throw review();
          await save(true);
          const created = await stripe.request('POST', '/subscription_schedules', { from_subscription: source.subscriptionId }, `mm:free-days:${row.id}:create`);
          if (created.object !== 'subscription_schedule' || stripeId(created.subscription) !== source.subscriptionId || stripeId(created.customer) !== account.customerId || created.livemode !== account.livemode) throw review();
          progress.scheduleId = created.id; progress.createdHash = collectionSourceHash({ id: source.subscriptionId }, created); await save();
          graph = await subscriptionGraph(stripe, account);
        }
        if (collectionSourceHash(graph.sub, !source.originalScheduleId && progress.scheduleId ? null : graph.schedule) !== source.providerHash ||
          (progress.scheduleId && graph.schedule?.id !== progress.scheduleId) || (progress.createdHash && collectionSourceHash({ id: source.subscriptionId }, graph.schedule) !== progress.createdHash)) throw review();
        if (!graph.schedule) {
          await mark('createAt');
          const created = await stripe.request('POST', '/subscription_schedules', { from_subscription: source.subscriptionId }, `mm:free-days:${row.id}:create`);
          if (created.object !== 'subscription_schedule' || stripeId(created.subscription) !== source.subscriptionId || stripeId(created.customer) !== account.customerId || created.livemode !== account.livemode) throw review();
          progress.scheduleId = created.id; progress.createdHash = collectionSourceHash({ id: source.subscriptionId }, created); await save();
        }
        const scheduleId = source.originalScheduleId ?? progress.scheduleId;
        if (!scheduleId) throw review();
        const params = { phases: source.phases, end_behavior: source.cancel ? 'cancel' : 'release', proration_behavior: 'none',
          metadata: { billingAccountId: account.id, mangmeeFreeDaysOperation: row.id } };
        const commandHash = hashBilling([scheduleId, params]);
        if ((progress.updateHash && progress.updateHash !== commandHash) || (progress.updateAt && Date.now() - Date.parse(progress.updateAt) >= 23 * 3600000)) throw review();
        progress.updateHash = commandHash; await mark('updateAt');
        await stripe.request('POST', `/subscription_schedules/${scheduleId}`, params, `mm:free-days:${row.id}:update`);
        graph = await subscriptionGraph(stripe, account);
        if (!this.observed(account, source, graph.sub, graph.schedule, row.id)) throw review();
      }
      await this.prisma.client.$transaction(async tx => {
        const company = await fence(tx);
        const after = new Date(source.after), now = new Date();
        // Preserve original customer approval. A separate successor retimes only the accepted boundary.
        let pendingId: string | null = null;
        if (source.pendingId) {
          const original = await tx.billingOperation.findUniqueOrThrow({ where: { id: source.pendingId } }), nextId = randomUUID();
          const originalProposed = original.proposedJson as Prisma.JsonObject;
          const proposed = { ...originalProposed, paidThrough: source.after };
          await tx.billingOperation.create({ data: { id: nextId, companyId: account.companyId, stripeAccountId: account.stripeAccountId, livemode: account.livemode,
            type: original.type, state: 'SUCCEEDED', proposedJson: json(proposed), sourceVersion: account.version, reason: original.reason,
            initiatorUserId: original.initiatorUserId, approverUserId: row.approverUserId, referenceId: original.id,
            requestHash: hashBilling([row.id, original.id, proposed]), expiresAt: original.expiresAt, observedAt: now,
            resultJson: { scheduleId: graph.schedule!.id, boundaryAdjustmentId: row.id, originalRequestId: original.id } } });
          await tx.billingOperation.update({ where: { id: original.id }, data: { state: 'SUPERSEDED', version: { increment: 1 } } });
          pendingId = nextId;
        }
        await tx.billingSubscriptionContract.create({ data: { billingAccountId: account.id, sourceAttemptId: row.id, effectiveAt: after,
          snapshotJson: json(JSON.parse(JSON.stringify({ ...source.future, ...(pendingId ? { planChangeId: pendingId } : {}) }))) } });
        const term = await tx.companyPlanTerm.update({ where: { companyId: account.companyId }, data: { termEndsAt: after, updatedByUserId: row.approverUserId,
          ...(after > now ? { termDisabledAt: null, warn7SentAt: null, warn3SentAt: null, warn1SentAt: null, expiredNotifiedAt: null } : {}) } });
        if (company.status === 'DISABLED' && after > now) {
          if (!this.lifecycle) throw review();
          await this.lifecycle.execute({ companyId: account.companyId, targetStatus: 'ACTIVE', requestingAdminUserId: null,
            requestId: row.id, reason: 'stripe_verified_admin_gift_days' }, tx);
        }
        await tx.billingReceiptGrant.updateMany({ where: { billingAccountId: account.id, companyId: account.companyId,
          kind: { in: ['INITIAL', 'RENEWAL', 'REPEAT', 'UPGRADE'] }, revokedAt: null, expiresAt: { gt: row.createdAt, lt: after } }, data: { expiresAt: after } });
        await tx.billingAccount.update({ where: { id: account.id }, data: { paidThrough: after, nextChargeAt: source.cancel ? null : after,
          termProjectionHash: termProjectionHash(term), pendingPlanChangeId: pendingId, activeCollectionOperationId: null, version: { increment: 1 }, observedAt: now, nextReconcileAt: now } });
        await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'SUCCEEDED', errorCode: null, resultJson: json({ ...journal, scheduleId: graph.schedule!.id }), observedAt: now, version: { increment: 1 } } });
        await tx.auditLog.create({ data: { companyId: account.companyId, actorUserId: row.approverUserId, action: 'billing.free_days.applied',
          targetType: 'BillingOperation', targetId: row.id, requestId: row.id, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: {
            source: 'ADMIN_GIFT_DAYS', reason: row.reason, initiatorUserId: row.initiatorUserId, approverUserId: row.approverUserId,
            days: source.days, before: source.before, after: source.after, nextChargeBefore: source.nextChargeBefore, nextChargeAfter: source.nextChargeAfter,
            pendingChangeBefore: source.pendingId, pendingChangeAfter: pendingId, receiptUnitsAdded: 0, aiQuotaAdded: 0 } } });
        await tx.billingIssue.updateMany({ where: { companyId: account.companyId, stripeAccountId: account.stripeAccountId, livemode: account.livemode,
          kind: 'CUSTOMER_COLLECTION_REVIEW', referenceId: row.id }, data: { state: 'RESOLVED', resolvedAt: now, version: { increment: 1 } } });
      });
    } catch {
      // Never sent, and past expiresAt no pass can send it: over at once.
      if (!progress.createAt && !progress.updateAt && row.expiresAt <= new Date()) return end('CONTROL_FREE_DAYS_NOT_SENT');
      await this.prisma.client.$transaction(async tx => {
        await fence(tx);
        await tx.billingOperation.update({ where: { id: row.id }, data: { state: progress.createAt || progress.updateAt ? 'UNKNOWN' : 'BLOCKED',
          errorCode: 'CONTROL_FREE_DAYS_REVIEW', resultJson: json(journal), version: { increment: 1 } } });
      });
      await this.billing.issue(account.companyId, 'CUSTOMER_COLLECTION_REVIEW', row.id);
    }
  }
}
