import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { BillingCollectionAction, BillingCollectionOperation } from '@watchdog-bms/contracts';
import type { BillingAccount, BillingOperation, Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { assertCompanyCanBuy, assertPolicyReady, assertStripePrice, billingError, hashBilling, paidVariant, quoteTotals } from '../domain/billing-policy';
import { appendPackageInterval } from '../domain/billing-package';
import { stripeId, type StripeClient, type StripeObject } from '../infrastructure/stripe.client';
import type { BillingService, BillingSnapshot } from './billing.service';

import { collectionContract, currentSchedulePhase, schedulePhase, subscriptionGraph, simpleCollection, sameScheduleTaxes as sameTaxes, scheduleTaxes as taxes, type PlanChangeSource } from './billing-schedule';
import { capacityOptions, capacityValid, capacityImpact, capacityReview, parseCapacitySelection } from './billing-capacity';
import { isUpgrade } from './billing-upgrade';
import { termProjectionHash } from '../domain/paid-invoice';

type Proposed = { accountId: string; action: BillingCollectionAction; subscriptionId: string; paidThrough: string; sourceHash: string;
  snapshot: BillingSnapshot; method: 'POST' | 'DELETE'; path: string; params: Record<string, unknown>; sourceTermHash: string | null; change?: PlanChangeSource; originalScheduleId?: string | null };
type Journal = { startedAt?: string; observed?: boolean; createStartedAt?: string; scheduleId?: string; updateStartedAt?: string; updateHash?: string; createdScheduleHash?: string };
const TYPES = ['CUSTOMER_CANCEL_RENEWAL', 'CUSTOMER_RESUME_RENEWAL', 'CUSTOMER_SCHEDULE_DOWNGRADE', 'CUSTOMER_CANCEL_DOWNGRADE'];
const changing = (action: BillingCollectionAction) => action === 'SCHEDULE_DOWNGRADE' || action === 'CANCEL_DOWNGRADE';
const review = () => billingError('BILLING_COLLECTION_REVIEW', 'ข้อมูลการต่ออายุเปลี่ยน กรุณาตรวจสถานะเดิมหรือติดต่อทีมงานพร้อมเลขอ้างอิง');
const sourceHash = (sub: StripeObject, schedule: StripeObject | null) => hashBilling([sub.id, sub.status, sub.cancel_at_period_end === true,
  sub.billing_mode ?? null, sub.billing_cycle_anchor ?? null, sub.cancel_at ?? null, sub.pause_collection ?? null, sub.pending_update ?? null,
  sub.collection_method, sub.automatic_tax, sub.discounts, sub.default_tax_rates, sub.transfer_data, sub.application_fee_percent,
  sub.items?.data?.map((i: StripeObject) => [stripeId(i.price), i.quantity, i.current_period_start, i.current_period_end, taxes(i.tax_rates), i.discounts]),
  schedule ? [schedule.id, schedule.status, schedule.end_behavior, schedule.phases?.map((p: StripeObject) => [p.start_date, p.end_date,
    p.items?.map((i: StripeObject) => [stripeId(i.price), i.quantity, taxes(i.tax_rates), i.discounts]), p.default_tax_rates, p.discounts,
    p.add_invoice_items, p.trial_end, p.automatic_tax, p.collection_method, p.billing_cycle_anchor, p.transfer_data, p.application_fee_percent]), schedule.default_settings] : null]);

export class BillingCollection {
  constructor(private readonly prisma: PrismaService, private readonly stripe: StripeClient,
    private readonly billing: Pick<BillingService, 'settings' | 'assertOwner' | 'account' | 'issue' | 'assertTaxSettings' | 'repeater'>) {}
  private async assertCompany(companyId: string, tx: Prisma.TransactionClient = this.prisma.client) {
    const company = await tx.company.findUnique({ where: { id: companyId }, include: { planTerm: true } });
    if (!company || (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))) throw review();
  }
  view(row: BillingOperation, userId: string): BillingCollectionOperation {
    const p = row.proposedJson as unknown as Proposed, journal = row.resultJson as Journal | null;
    return { id: row.id, companyId: row.companyId!, action: p.action, state: row.state, version: row.version, previewHash: row.requestHash,
      effectiveAt: p.paidThrough, nextRenewalTotalSatang: p.snapshot.quote.totalSatang, expiresAt: row.expiresAt.toISOString(),
      observedAt: row.observedAt?.toISOString() ?? null, errorCode: row.errorCode,
      ...(p.change ? { targetOffer: p.snapshot.quote.offer, capacity: p.snapshot.quote.capacity } : {}),
      allowedActions: [...(row.state === 'PREVIEW' && row.expiresAt > new Date() && row.initiatorUserId === userId ? ['submit' as const] : []),
        ...(['PREVIEW', 'QUEUED', 'BLOCKED'].includes(row.state) && !journal?.startedAt ? ['withdraw' as const] : [])] };
  }
  async get(context: RequestContext, id: string) {
    await this.billing.assertOwner(context);
    const row = await this.prisma.client.billingOperation.findFirst({ where: { id, companyId: context.companyId, stripeAccountId: this.stripe.accountId,
      livemode: this.stripe.livemode, type: { in: TYPES } } });
    if (!row) throw new NotFoundException(); return this.view(row, context.userId);
  }
  private async provider(account: BillingAccount) {
    return subscriptionGraph(this.stripe, account);
  }
  async preview(context: RequestContext, action: BillingCollectionAction, targetInput?: { offerKey: string; interval: string; capacity: unknown }) {
    if (!['CANCEL_RENEWAL', 'RESUME_RENEWAL', 'SCHEDULE_DOWNGRADE', 'CANCEL_DOWNGRADE'].includes(action)) throw new BadRequestException('Invalid renewal action');
    await this.billing.assertOwner(context);
    await this.assertCompany(context.companyId);
    const account = await this.billing.account(context.companyId), state = await this.billing.settings();
    if (action === 'SCHEDULE_DOWNGRADE') assertCompanyCanBuy(state.policy, context.companyId);
    if (!(changing(action) ? state.gates.plan_changes : state.gates.portal_cancel_subscription)) throw billingError('BILLING_COLLECTION_CLOSED', 'ติดต่อทีมงานพร้อมเลขอ้างอิงเพื่อจัดการการต่ออายุ');
    if (!account?.customerId || !account.baseSubscriptionId || !account.paidThrough || account.activeAttemptId || account.activeCollectionOperationId) throw review();
    const accepted = await collectionContract(this.prisma.client, account);
    let snapshot = accepted.future, change: PlanChangeSource | undefined;
    const { sub, schedule } = await this.provider(account), target = account.paidThrough.getTime() / 1000;
    if (changing(action)) {
      if (account.paidThrough.getTime() <= Date.now()+600000 || account.cancelAtPeriodEnd || account.graceEndsAt || sub.status !== 'active' || sub.cancel_at || sub.cancel_at_period_end) throw review();
      const company = await this.prisma.client.company.findUniqueOrThrow({ where: { id: context.companyId }, include: { planTerm: true } });
      if (termProjectionHash(company.planTerm) !== account.termProjectionHash || company.planTerm?.tierKey !== accepted.current.quote.offer.offerKey) throw review();
      await this.billing.repeater.assertNoDebt(account, await this.stripe.list('/invoices', { subscription: account.baseSubscriptionId }));
      if (action === 'SCHEDULE_DOWNGRADE') {
        if (!state.policy || !state.revision || !state.gates.new_sales || !targetInput) throw review();
        assertPolicyReady(state.policy);
        const { tier, interval, offer } = paidVariant(targetInput.offerKey, targetInput.interval);
        if (!isUpgrade(offer, accepted.current.quote.offer) || state.policy.planChanges !== 'UPGRADE_PRORATED_DOWNGRADE_PERIOD_END') throw review();
        const priceId = state.policy.priceIds[`${tier}:${interval}`];
        if (!priceId) throw review();
        assertStripePrice(await this.stripe.request('GET', `/prices/${priceId}`), offer, state.policy, account.livemode, priceId);
        await this.billing.assertTaxSettings(state.policy);
        const selection = parseCapacitySelection(targetInput.capacity), options = await capacityOptions(this.prisma.client, context.companyId, offer);
        if (!capacityValid(options, selection)) throw capacityReview();
        snapshot = { quote: { ...accepted.current.quote, offer: { ...offer, availability: 'AVAILABLE', reason: null }, policyRevision: state.revision.id, ...quoteTotals(offer.priceSatang, state.policy.taxTreatment),
          taxTreatment: state.policy.taxTreatment!, consentRevision: state.policy.consentRevision, purchase: undefined, upgrade: undefined,
          capacity: capacityImpact(options, selection), trialEndsAt: null }, priceId, policy: state.policy, settingsVersion: state.settings.version,
          termVersion: company.planTerm?.updatedAt.toISOString() ?? null, termHash: account.termProjectionHash! };
        change = { previousId: accepted.pending?.row.id ?? null, currentSnapshot: accepted.current, selection };
      } else {
        if (!accepted.pending) throw review();
        snapshot = accepted.current;
        change = { previousId: accepted.pending.row.id, currentSnapshot: accepted.current };
        await this.billing.assertTaxSettings(snapshot.policy);
      }
    }
    if (snapshot.policy.cancellation !== 'PERIOD_END' || sub.billing_mode?.type !== 'classic' || sub.collection_method !== 'charge_automatically' ||
      sub.pause_collection || sub.pending_update || !simpleCollection(sub) || sub.items?.data?.length !== 1 || sub.items.has_more ||
      sub.items.data[0].quantity !== 1 || (sub.items.data[0].discounts?.length ?? 0)) throw review();
    if (action === 'RESUME_RENEWAL' && (account.paidThrough <= new Date() || sub.status !== 'active')) throw review();
    if (!['active', 'past_due', 'unpaid'].includes(sub.status)) throw review();
    let method: Proposed['method'] = 'POST', path = `/subscriptions/${sub.id}`, params: Record<string, unknown>;
    if (account.paidThrough <= new Date()) {
      if (schedule) throw review();
      method = 'DELETE'; params = { prorate: false, invoice_now: false };
    } else if (schedule || changing(action)) {
      const phase = schedule ? await currentSchedulePhase(this.prisma.client, account, sub, schedule, accepted.current, accepted.future) :
        schedulePhase(sub.items.data[0].current_period_start, target, accepted.current.priceId, accepted.current.policy.taxRateId);
      if (!schedule && (stripeId(sub.items.data[0].price) !== accepted.current.priceId || sub.items.data[0].current_period_end !== target ||
        !sameTaxes(sub.items.data[0].tax_rates, accepted.current.policy.taxRateId))) throw review();
      path = schedule ? `/subscription_schedules/${schedule.id}` : '/subscription_schedules';
      params = { end_behavior: action === 'CANCEL_RENEWAL' ? 'cancel' : 'release', proration_behavior: 'none', phases: [phase,
        ...(action !== 'CANCEL_RENEWAL' ? [schedulePhase(target, Math.floor(appendPackageInterval(account.paidThrough, snapshot.quote.offer.interval).getTime()/1000), snapshot.priceId, snapshot.policy.taxRateId, true)] : [])] };
    } else {
      if (stripeId(sub.items.data[0].price) !== snapshot.priceId || !sameTaxes(sub.items.data[0].tax_rates, snapshot.policy.taxRateId) ||
        sub.items.data[0].current_period_end !== target || (sub.cancel_at && sub.cancel_at !== target)) throw review();
      params = { cancel_at_period_end: action === 'CANCEL_RENEWAL', proration_behavior: 'none' };
    }
    const proposed: Proposed = { accountId: account.id, action, subscriptionId: sub.id, paidThrough: account.paidThrough.toISOString(), sourceHash: sourceHash(sub, schedule),
      snapshot: JSON.parse(JSON.stringify(snapshot)), method, path, params, sourceTermHash: account.termProjectionHash,
      ...(change ? { change, originalScheduleId: schedule?.id ?? null } : {}) };
    const row = await this.prisma.client.billingOperation.create({ data: { stripeAccountId: account.stripeAccountId, livemode: account.livemode, companyId: account.companyId,
      type: `CUSTOMER_${action}`, proposedJson: proposed as unknown as Prisma.InputJsonValue, sourceVersion: account.version, reason: action,
      initiatorUserId: context.userId, requestHash: hashBilling([account.id, account.version, action, proposed.sourceHash, params, proposed.change ?? null]), expiresAt: new Date(Date.now() + 600_000) } });
    return this.view(row, context.userId);
  }
  async submit(context: RequestContext, id: string, expectedVersion: number, previewHash: string, key: string) {
    if (!/^[a-zA-Z0-9_-]{16,120}$/.test(key)) throw new BadRequestException('Invalid idempotency key');
    await this.get(context, id);
    const row = await this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, context.companyId); await this.billing.assertOwner(context, tx);
      await this.assertCompany(context.companyId, tx);
      const account = await this.billing.account(context.companyId, tx), current = await tx.billingOperation.findUniqueOrThrow({ where: { id } });
      const replay = await tx.billingOperation.findUnique({ where: { stripeAccountId_livemode_idempotencyKey: { stripeAccountId: current.stripeAccountId, livemode: current.livemode, idempotencyKey: key } } });
      if (replay) { if (replay.id !== id || replay.requestHash !== previewHash || replay.initiatorUserId !== context.userId) throw review(); return replay; }
      const state = await this.billing.settings(tx);
      const proposed = current.proposedJson as unknown as Proposed;
      if (proposed.action === 'SCHEDULE_DOWNGRADE') assertCompanyCanBuy(state.policy, context.companyId);
      if (!(changing(proposed.action) ? state.gates.plan_changes : state.gates.portal_cancel_subscription) || !account || account.version !== current.sourceVersion || account.activeAttemptId || account.activeCollectionOperationId ||
        (account.leaseUntil && account.leaseUntil > new Date()) || current.version !== expectedVersion || current.requestHash !== previewHash || current.expiresAt <= new Date() ||
        current.initiatorUserId !== context.userId || current.state !== 'PREVIEW') throw review();
      if (proposed.change && (account.pendingPlanChangeId !== proposed.change.previousId || (proposed.change.selection &&
        !capacityValid(await capacityOptions(tx, account.companyId, proposed.snapshot.quote.offer), proposed.change.selection)))) throw capacityReview();
      if (proposed.action === 'SCHEDULE_DOWNGRADE' && (!state.gates.new_sales || proposed.snapshot.settingsVersion !== state.settings.version || proposed.snapshot.quote.policyRevision !== state.revision?.id)) throw review();
      const changed = await tx.billingOperation.updateMany({ where: { id, state: 'PREVIEW', version: expectedVersion }, data: { state: 'QUEUED', idempotencyKey: key, version: { increment: 1 } } });
      if (!changed.count) throw review();
      await tx.billingAccount.update({ where: { id: account.id }, data: { activeCollectionOperationId: id, version: { increment: 1 }, nextReconcileAt: new Date() } });
      await this.audit(tx, current, 'queued'); return tx.billingOperation.findUniqueOrThrow({ where: { id } });
    }); return this.view(row, context.userId);
  }
  async withdraw(context: RequestContext, id: string, expectedVersion: number) {
    await this.get(context, id);
    const row = await this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, context.companyId); await this.billing.assertOwner(context, tx);
      const current = await tx.billingOperation.findUniqueOrThrow({ where: { id } }), account = await this.billing.account(context.companyId, tx);
      if (current.version !== expectedVersion || !['PREVIEW', 'QUEUED', 'BLOCKED'].includes(current.state) || (current.resultJson as Journal | null)?.startedAt ||
        (account?.leaseUntil && account.leaseUntil > new Date())) throw review();
      const changed = await tx.billingOperation.updateMany({ where: { id, state: current.state, version: expectedVersion }, data: { state: 'CANCELLED', version: { increment: 1 } } });
      if (!changed.count) throw review();
      await tx.billingAccount.updateMany({ where: { id: account!.id, activeCollectionOperationId: id }, data: { activeCollectionOperationId: null, version: { increment: 1 } } });
      await this.audit(tx, { ...current, initiatorUserId: context.userId }, 'withdrawn'); return tx.billingOperation.findUniqueOrThrow({ where: { id } });
    }); return this.view(row, context.userId);
  }
  private async fence(tx: Prisma.TransactionClient, account: BillingAccount, operation: BillingOperation, lease: string) {
    await lockPlanTermCompany(tx, account.companyId);
    const current = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
    if (current.activeCollectionOperationId !== operation.id || current.leaseToken !== lease || !current.leaseUntil || current.leaseUntil <= new Date()) throw review();
    return current;
  }
  private audit(tx: Prisma.TransactionClient, row: BillingOperation, action: string) {
    return tx.auditLog.create({ data: { companyId: row.companyId!, actorUserId: row.initiatorUserId, action: `billing.collection.${action}`, targetType: 'BillingOperation',
      targetId: row.id, requestId: row.id, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { type: row.type, sourceVersion: row.sourceVersion, previewHash: row.requestHash } } });
  }
  private observed(p: Proposed, sub: StripeObject, schedule: StripeObject | null, id: string) {
    const cancel = p.action === 'CANCEL_RENEWAL', target = Date.parse(p.paidThrough) / 1000;
    if (sub.status === 'canceled') return cancel && !changing(p.action);
    if (p.method === 'DELETE') return false;
    if (sub.billing_mode?.type !== 'classic' || !(cancel ? ['active', 'past_due', 'unpaid'] : ['active']).includes(sub.status) || sub.pause_collection || sub.pending_update || !simpleCollection(sub) || sub.items?.has_more ||
      sub.items?.data?.length !== 1 || sub.items.data[0].quantity !== 1 || (sub.items.data[0].discounts?.length ?? 0)) return false;
    if (!schedule) return !p.params.phases && stripeId(sub.items.data[0].price) === p.snapshot.priceId && sub.items.data[0].current_period_end === target &&
      sameTaxes(sub.items.data[0].tax_rates, p.snapshot.policy.taxRateId) && sub.metadata?.mangmeeCollectionOperation === id && sub.cancel_at_period_end === cancel && (cancel ? sub.cancel_at === target : !sub.cancel_at);
    const phases = schedule.phases?.filter((phase: StripeObject) => phase.end_date > schedule.current_phase?.start_date);
    let desired = p.params.phases as { start_date: number; end_date: number; items: { price: string; quantity: number; tax_rates: string | string[] }[] }[];
    if (Array.isArray(desired) && desired.length === 2 && schedule.current_phase?.start_date === desired[1]!.start_date && Date.now() >= target*1000 &&
      sub.items.data[0].current_period_start === target && sub.items.data[0].current_period_end === desired[1]!.end_date) desired = desired.slice(1);
    return Array.isArray(desired) && simpleCollection(schedule.default_settings ?? {}) && stripeId(sub.items.data[0].price) === desired[0]?.items[0]?.price &&
      sameTaxes(sub.items.data[0].tax_rates, Array.isArray(desired[0]?.items[0]?.tax_rates) ? desired[0].items[0].tax_rates[0] ?? null : null) && schedule.metadata?.mangmeeCollectionOperation === id && schedule.status === 'active' && schedule.end_behavior === (cancel ? 'cancel' : 'release') &&
      Array.isArray(phases) && phases.length === desired.length && phases.every((phase: StripeObject, index: number) => {
        const expected = desired[index]!;
        return simpleCollection(phase) && !phase.trial_end && !(phase.items?.[0]?.discounts?.length ?? 0) && (phase.start_date !== target || (phase.billing_cycle_anchor === 'phase_start' && (index !== 0 || sub.billing_cycle_anchor === target))) &&
          phase.start_date === expected.start_date && phase.end_date === expected.end_date && phase.items?.length === 1 &&
          stripeId(phase.items[0].price) === expected.items[0]!.price && phase.items[0].quantity === 1 &&
          JSON.stringify((phase.items[0].tax_rates ?? []).map(stripeId)) === JSON.stringify(Array.isArray(expected.items[0]!.tax_rates) ? expected.items[0]!.tax_rates : []);
      }) && (cancel ? sub.cancel_at === target : !sub.cancel_at);
  }
  async advance(account: BillingAccount, lease: string) {
    const row = await this.prisma.client.billingOperation.findFirstOrThrow({ where: { id: account.activeCollectionOperationId!, companyId: account.companyId,
      stripeAccountId: account.stripeAccountId, livemode: account.livemode, type: { in: TYPES } } });
    const proposed = row.proposedJson as unknown as Proposed, journal: Journal = (row.resultJson as Journal | null) ?? {};
    if (proposed.accountId !== account.id || proposed.subscriptionId !== account.baseSubscriptionId) throw review();
    if (row.state === 'BLOCKED' && !journal.startedAt) return;
    try {
      // A lost from_subscription response must replay that exact command before adopting any schedule.
      const create = async () => {
        if (!journal.createStartedAt || Date.now()-Date.parse(journal.createStartedAt) >= 23*3600000) throw review();
        const created = await this.stripe.request('POST', '/subscription_schedules', { from_subscription: proposed.subscriptionId }, `mm:collection:${row.id}:create`);
        if (created.object !== 'subscription_schedule' || created.livemode !== account.livemode || stripeId(created.customer) !== account.customerId ||
          stripeId(created.subscription) !== proposed.subscriptionId) throw review();
        journal.scheduleId = created.id; journal.createdScheduleHash = sourceHash({ id: proposed.subscriptionId }, created);
        await this.prisma.client.$transaction(async tx => { await this.fence(tx, account, row, lease);
          await tx.billingOperation.update({ where: { id: row.id }, data: { resultJson: journal as Prisma.InputJsonValue } }); });
      };
      if (journal.createStartedAt && !journal.scheduleId) await create();
      let { sub, schedule } = await this.provider(account);
      if (!this.observed(proposed, sub, schedule, row.id)) {
        if (journal.startedAt && (!Number.isFinite(Date.parse(journal.startedAt)) || Date.now() - Date.parse(journal.startedAt) >= 23 * 3600000)) throw review();
        if (sourceHash(sub, journal.scheduleId && !proposed.originalScheduleId ? null : schedule) !== proposed.sourceHash ||
          (journal.scheduleId && schedule?.id !== journal.scheduleId) || (journal.createdScheduleHash &&
          sourceHash({ id: proposed.subscriptionId }, schedule) !== journal.createdScheduleHash)) throw review();
        if (proposed.action !== 'CANCEL_RENEWAL') await this.billing.assertTaxSettings(proposed.snapshot.policy);
        const startedAt = journal.startedAt ?? new Date().toISOString();
        await this.prisma.client.$transaction(async tx => {
          const current = await this.fence(tx, account, row, lease);
          if (current.baseSubscriptionId !== proposed.subscriptionId || current.paidThrough?.toISOString() !== proposed.paidThrough || current.termProjectionHash !== proposed.sourceTermHash) throw review();
          await this.billing.assertOwner({ companyId: account.companyId, userId: row.initiatorUserId } as RequestContext, tx);
          await this.assertCompany(account.companyId, tx);
          const state = await this.billing.settings(tx);
          if (proposed.action === 'SCHEDULE_DOWNGRADE') assertCompanyCanBuy(state.policy, account.companyId);
          if (!(changing(proposed.action) ? state.gates.plan_changes : state.gates.portal_cancel_subscription)) throw review();
          if (proposed.change && (current.pendingPlanChangeId !== proposed.change.previousId || current.paidThrough!.getTime() <= Date.now()+60000 ||
            (proposed.change.selection && !capacityValid(await capacityOptions(tx, current.companyId, proposed.snapshot.quote.offer), proposed.change.selection)))) throw review();
          if (proposed.action === 'SCHEDULE_DOWNGRADE' && (!state.gates.new_sales || proposed.snapshot.settingsVersion !== state.settings.version)) throw review();
          await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'RUNNING', resultJson: { ...journal, startedAt }, version: { increment: 1 } } });
        });
        journal.startedAt = startedAt;
        if (proposed.change && !proposed.originalScheduleId && !journal.scheduleId) {
          journal.createStartedAt ??= startedAt;
          await this.prisma.client.$transaction(async tx => { await this.fence(tx, account, row, lease);
            await tx.billingOperation.update({ where: { id: row.id }, data: { resultJson: journal as Prisma.InputJsonValue } }); });
          await create();
        }
        const path = journal.scheduleId ? `/subscription_schedules/${journal.scheduleId}` : proposed.path;
        const params = { ...proposed.params, ...(proposed.method === 'POST' ? { metadata: { billingAccountId: account.id, mangmeeCollectionOperation: row.id } } : {}) };
        const updateHash = hashBilling([proposed.method, path, params]);
        if (journal.updateHash && journal.updateHash !== updateHash) throw review();
        journal.updateHash = updateHash; journal.updateStartedAt ??= new Date().toISOString();
        await this.prisma.client.$transaction(async tx => { await this.fence(tx, account, row, lease);
          await tx.billingOperation.update({ where: { id: row.id }, data: { resultJson: journal as Prisma.InputJsonValue } }); });
        await this.stripe.request(proposed.method, path, params, `mm:collection:${row.id}`);
        ({ sub, schedule } = await this.provider(account));
        if (!this.observed(proposed, sub, schedule, row.id)) throw review();
      }
      await this.prisma.client.$transaction(async tx => {
        const current = await this.fence(tx, account, row, lease);
        if (proposed.change) {
          if (current.pendingPlanChangeId !== proposed.change.previousId || current.paidThrough?.toISOString() !== proposed.paidThrough) throw review();
          journal.scheduleId = schedule!.id;
          const future = { ...proposed.snapshot, planChangeId: proposed.action === 'SCHEDULE_DOWNGRADE' ? row.id : undefined };
          await tx.billingSubscriptionContract.create({ data: { billingAccountId: account.id, sourceAttemptId: row.id,
            effectiveAt: new Date(proposed.paidThrough), snapshotJson: JSON.parse(JSON.stringify(future)) } });
          if (proposed.change.previousId) await tx.billingOperation.update({ where: { id: proposed.change.previousId }, data: { state: 'SUPERSEDED', version: { increment: 1 } } });
        }
        const observedAt = new Date();
        await tx.billingAccount.update({ where: { id: account.id }, data: { activeCollectionOperationId: null,
          ...(proposed.change ? { pendingPlanChangeId: proposed.action === 'SCHEDULE_DOWNGRADE' ? row.id : null } : {}), cancelAtPeriodEnd: proposed.action === 'CANCEL_RENEWAL',
          subscriptionState: sub.status, nextChargeAt: proposed.action === 'CANCEL_RENEWAL' ? null : new Date(proposed.paidThrough), observedAt, version: { increment: 1 } } });
        await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'SUCCEEDED', resultJson: { ...journal, observed: true }, observedAt, errorCode: null, version: { increment: 1 } } });
        await tx.billingIssue.updateMany({ where: { stripeAccountId: account.stripeAccountId, livemode: account.livemode, companyId: account.companyId,
          kind: 'CUSTOMER_COLLECTION_REVIEW', referenceId: row.id }, data: { state: 'RESOLVED', resolvedAt: new Date(), version: { increment: 1 } } });
        await this.audit(tx, row, 'observed');
      });
    } catch {
      await this.prisma.client.$transaction(async tx => {
        await this.fence(tx, account, row, lease);
        await tx.billingOperation.update({ where: { id: row.id }, data: { state: journal.startedAt ? 'UNKNOWN' : 'BLOCKED', resultJson: journal as Prisma.InputJsonValue,
          errorCode: 'BILLING_COLLECTION_REVIEW', version: { increment: 1 } } });
      });
      await this.billing.issue(account.companyId, 'CUSTOMER_COLLECTION_REVIEW', row.id);
    }
  }
}
