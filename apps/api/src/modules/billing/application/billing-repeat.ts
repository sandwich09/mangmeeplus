import { assertAccountEmailProof, lockAccountEmail } from '../../auth/application/account-email-state';
import { randomUUID } from 'node:crypto';
import type { BillingOffer, BillingPolicy } from '@watchdog-bms/contracts';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { BillingAccount, BillingAttempt, Prisma } from '../../../generated/prisma/client';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import type { PartnerLifecycleTransitionUseCase } from '../../system-partner-management/application/use-cases/partner-lifecycle-transition.use-case';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { StripeClient, stripeId, safeStripeUrl, type StripeObject } from '../infrastructure/stripe.client';
import { assertCompanyCanBuy, assertStripePrice, billingError, hashBilling, quoteTotals } from '../domain/billing-policy';
import { appendPackageInterval, fullPackagePurchaseImpact } from '../domain/billing-package';
import { paidPackageCheckoutEvidence, type PaidCheckoutEvidence } from '../domain/paid-checkout-invoice';
import { detectBillingIssue } from './billing-issues';
import { termProjectionHash } from '../domain/paid-invoice';
import { grantPaidPackageReceipts, paidReceiptBalance } from './billing-receipt-grants';
import { fulfillPaidPackageRequest } from './billing-package-request';
import { assertMappedCharge, recordBillingFinancials } from './billing-financial';
import { collectionContract, ownedSchedule, simpleCollection } from './billing-schedule';
import { capacityOptions, capacityValid } from './billing-capacity';
import { upgradeHistory } from './billing-upgrade';
import type { BillingService, BillingSnapshot } from './billing.service';

export type RepeatSource = { subscriptionId: string; paidThrough: string; productId: string; zeroPriceId: string;
  currentPriceId: string; currentPeriodStart: number; sourcePriceId: string; sourceTaxRateId: string | null; currentTaxRateId?: string | null; sourceTotal: number; anchorDay: number; billingCycleAnchor?: number; scheduleId: string | null };
type Journal = { commands: Record<string, { at: string; hash: string }>; beforeInvoiceIds?: string[]; heldAt?: number;
  checkoutExpiresAt?: number; scheduleId?: string; phaseStart?: number; paidThrough?: string; serviceStart?: string;
  completed?: boolean; aborted?: boolean; abortRequested?: boolean };
const json = (value: unknown) => value as Prisma.InputJsonValue;
const review = () => billingError('BILLING_REPEAT_REVIEW', 'รายการซื้อซ้ำต้องตรวจสอบ กรุณาตรวจสถานะเดิมหรือติดต่อทีมงานพร้อมเลขอ้างอิง');

/** Durable full-package purchase against the existing subscription. No receipt-only offer. */
export class BillingRepeat {
  constructor(private readonly prisma: PrismaService, private readonly stripe: StripeClient,
    private readonly billing: Pick<BillingService, 'settings' | 'assertOwner' | 'issue' | 'assertTaxSettings'>,
    private readonly lifecycle?: PartnerLifecycleTransitionUseCase) {}

  async source(account: BillingAccount, offer: BillingOffer, policy: BillingPolicy, price: StripeObject): Promise<RepeatSource> {
    if (!account.customerId || !account.baseSubscriptionId || !account.paidThrough || account.paidThrough <= new Date() ||
        account.activeAttemptId || account.activeCollectionOperationId || account.cancelAtPeriodEnd || account.graceEndsAt) throw review();
    if (await this.prisma.client.billingIssue.count({ where: { companyId: account.companyId, stripeAccountId: account.stripeAccountId,
      livemode: account.livemode, kind: 'FINANCIAL_REVIEW', state: { not: 'RESOLVED' } } })) throw review();
    const contracts = await collectionContract(this.prisma.client, account), accepted = contracts.current, future = contracts.future;
    if (accepted.quote.offer.offerKey !== offer.offerKey || accepted.quote.offer.interval !== offer.interval) {
      throw billingError('BILLING_PLAN_CHANGE_REQUIRED', 'กรุณาใช้รายการเปลี่ยนแพ็กเกจสำหรับการเปลี่ยนระดับหรือรอบชำระ');
    }
    const zeroPriceId = policy.zeroPriceIds?.[`${offer.offerKey as 'STARTER_249' | 'BASIC_499' | 'PRO_999'}:${offer.interval}`];
    if (!zeroPriceId) throw billingError('BILLING_REPEAT_NOT_READY', 'การซื้อแพ็กเกจซ้ำยังไม่เปิดให้บริการ กรุณาติดต่อทีมงาน');
    const zero = await this.stripe.request('GET', `/prices/${zeroPriceId}`);
    assertStripePrice(zero, { ...offer, priceSatang: 0 }, policy, account.livemode, zeroPriceId);
    const productId = stripeId(price.product);
    if (!productId || stripeId(zero.product) !== productId) throw review();
    const siblings = await this.stripe.list('/subscriptions', { customer: account.customerId, status: 'all' });
    if (siblings.filter(s => !['canceled', 'incomplete_expired'].includes(s.status)).length !== 1) throw review();
    const subscription = await this.stripe.request('GET', `/subscriptions/${account.baseSubscriptionId}`);
    this.assertSubscription(subscription, account);
    if (subscription.pause_collection) throw review();
    const scheduleId = stripeId(subscription.schedule);
    if (scheduleId) {
      if (!await ownedSchedule(this.prisma.client, account, scheduleId)) throw review();
      const schedule = await this.stripe.request('GET', `/subscription_schedules/${scheduleId}`);
      this.assertSchedule(schedule, account);
      const last = schedule.phases?.at(-1);
      if (!((last?.start_date * 1000 === account.paidThrough.getTime() && stripeId(last?.items?.[0]?.price) === future.priceId) ||
        (last?.start_date === schedule.current_phase?.start_date && last?.end_date * 1000 === account.paidThrough.getTime() && stripeId(last?.items?.[0]?.price) === accepted.priceId))) throw review();
    } else if (stripeId(subscription.items.data[0].price) !== accepted.priceId ||
      subscription.items.data[0].current_period_end * 1000 !== account.paidThrough.getTime()) throw review();
    await this.assertNoDebt(account, await this.stripe.list('/invoices', { subscription: account.baseSubscriptionId }));
    const first = await this.prisma.client.billingReceiptGrant.findFirst({ where: { billingAccountId: account.id, kind: 'INITIAL' }, orderBy: { serviceStart: 'desc' } });
    if (!first) throw review();
    if (!Number.isSafeInteger(subscription.items.data[0].current_period_start) || !Number.isSafeInteger(subscription.billing_cycle_anchor) ||
      subscription.billing_cycle_anchor > subscription.items.data[0].current_period_start) throw review();
    const source = { subscriptionId: account.baseSubscriptionId, paidThrough: account.paidThrough.toISOString(), productId, zeroPriceId,
      currentPriceId: stripeId(subscription.items.data[0].price)!, currentPeriodStart: subscription.items.data[0].current_period_start,
      sourcePriceId: future.priceId, sourceTaxRateId: future.policy.taxRateId, sourceTotal: future.quote.totalSatang,
      currentTaxRateId: stripeId(subscription.items.data[0].price) === accepted.priceId ? accepted.policy.taxRateId : null,
      anchorDay: new Date(subscription.billing_cycle_anchor*1000).getUTCDate(), billingCycleAnchor: subscription.billing_cycle_anchor, scheduleId };
    await this.assertOriginalCollection(subscription, account, source, offer.interval);
    return source;
  }

  private assertSubscription(sub: StripeObject, account: BillingAccount) {
    if (sub.id !== account.baseSubscriptionId || sub.object !== 'subscription' || sub.livemode !== account.livemode ||
        stripeId(sub.customer) !== account.customerId || sub.metadata?.billingAccountId !== account.id ||
        sub.status !== 'active' || sub.billing_mode?.type !== 'classic' || sub.cancel_at_period_end || sub.cancel_at ||
        sub.collection_method !== 'charge_automatically' || !simpleCollection(sub) || (sub.items?.data?.[0]?.discounts?.length ?? 0) || sub.automatic_tax?.enabled || (sub.discounts?.length ?? 0) ||
        sub.pending_update || sub.pending_invoice_item_interval ||
        sub.items?.data?.length !== 1 || sub.items.has_more || sub.items.data[0].quantity !== 1) throw review();
  }
  private async assertOriginalCollection(sub: StripeObject, account: BillingAccount, source: RepeatSource, interval: BillingOffer['interval']) {
    this.assertSubscription(sub, account);
    const taxes = (value: unknown) => Array.isArray(value) ? value.map(stripeId).sort() : [];
    const expectedTaxes = source.sourceTaxRateId ? [source.sourceTaxRateId] : [];
    const currentTax = source.currentTaxRateId === undefined ? (source.currentPriceId === source.sourcePriceId ? source.sourceTaxRateId : null) : source.currentTaxRateId;
    if ((source.billingCycleAnchor !== undefined && sub.billing_cycle_anchor !== source.billingCycleAnchor) || stripeId(sub.schedule) !== source.scheduleId || stripeId(sub.items.data[0].price) !== source.currentPriceId ||
      sub.items.data[0].current_period_start !== source.currentPeriodStart || taxes(sub.default_tax_rates).length ||
      hashBilling(taxes(sub.items.data[0].tax_rates)) !== hashBilling(currentTax ? [currentTax] : [])) throw review();
    if (!source.scheduleId) {
      if (sub.items.data[0].current_period_end * 1000 !== Date.parse(source.paidThrough)) throw review();
      return;
    }
    const schedule = await this.stripe.request('GET', `/subscription_schedules/${source.scheduleId}`); this.assertSchedule(schedule, account);
    const phases = schedule.phases?.filter((p: StripeObject) => p.end_date > schedule.current_phase?.start_date);
    if (phases?.length === 1 && source.currentPriceId === source.sourcePriceId && phases[0].start_date === schedule.current_phase?.start_date &&
      phases[0].start_date <= source.currentPeriodStart && phases[0].end_date * 1000 === Date.parse(source.paidThrough) && schedule.end_behavior === 'release' &&
      simpleCollection(schedule.default_settings ?? {}) && simpleCollection(phases[0]) && !(phases[0].items?.[0]?.discounts?.length ?? 0) && phases[0].items?.length === 1 && phases[0].items[0].quantity === 1 &&
      stripeId(phases[0].items[0].price) === source.currentPriceId && hashBilling(taxes(phases[0].items[0].tax_rates)) === hashBilling(expectedTaxes) &&
      !(phases[0].discounts?.length ?? 0) && !(phases[0].add_invoice_items?.length ?? 0) && !taxes(phases[0].default_tax_rates).length &&
      !phases[0].trial_end && !phases[0].automatic_tax?.enabled && (!phases[0].collection_method || phases[0].collection_method === 'charge_automatically')) return;
    if (schedule.end_behavior !== 'release' || !simpleCollection(schedule.default_settings ?? {}) || phases?.length !== 2 ||
      !Number.isSafeInteger(phases[0].start_date) || phases[0].start_date > source.currentPeriodStart || phases[0].end_date <= source.currentPeriodStart ||
      phases[0].start_date !== schedule.current_phase?.start_date || phases[0].end_date * 1000 !== Date.parse(source.paidThrough) ||
      phases[1].start_date * 1000 !== Date.parse(source.paidThrough) || stripeId(phases[0].items?.[0]?.price) !== source.currentPriceId ||
      stripeId(phases[1].items?.[0]?.price) !== source.sourcePriceId ||
      phases[1].end_date * 1000 !== appendPackageInterval(new Date(source.paidThrough), interval).getTime() ||
      phases[1].billing_cycle_anchor !== 'phase_start' ||
      phases.some((p: StripeObject) => !simpleCollection(p) || (p.items?.[0]?.discounts?.length ?? 0) || p.items?.length !== 1 || p.items[0]?.quantity !== 1 || (p.discounts?.length ?? 0) ||
        (p.add_invoice_items?.length ?? 0) || taxes(p.default_tax_rates).length || p.trial_end || p.automatic_tax?.enabled ||
        (p.collection_method && p.collection_method !== 'charge_automatically')) ||
      hashBilling(taxes(phases[0].items[0].tax_rates)) !== hashBilling(currentTax ? [currentTax] : []) || hashBilling(taxes(phases[1].items[0].tax_rates)) !== hashBilling(expectedTaxes)) throw review();
  }
  private assertSchedule(schedule: StripeObject, account: BillingAccount) {
    if (schedule.object !== 'subscription_schedule' || schedule.livemode !== account.livemode || schedule.status !== 'active' ||
        stripeId(schedule.subscription) !== account.baseSubscriptionId || stripeId(schedule.customer) !== account.customerId) throw review();
  }
  async assertNoDebt(account: BillingAccount, invoices: StripeObject[]) {
    if (invoices.some(i => !['paid', 'void'].includes(i.status))) throw review();
    const paid = invoices.filter(i => i.status === 'paid' && i.total > 0);
    const mapped = await this.prisma.client.billingInvoice.findMany({ where: { billingAccountId: account.id,
      OR: [{ providerInvoiceId: { in: paid.map(i => i.id) } }, { appliedAt: { not: null } }] },
      select: { providerInvoiceId: true, providerChargeId: true, paidSatang: true, applyStatus: true, refundedSatang: true, disputed: true } });
    if (mapped.some(m => m.applyStatus !== 'APPLIED' || m.refundedSatang > 0 || m.disputed) || paid.some(i => !mapped.some(m => m.providerInvoiceId === i.id))) throw review();
    for (const invoice of mapped) {
      if (!invoice.providerChargeId) throw review();
      const charge = await this.stripe.request('GET', `/charges/${invoice.providerChargeId}`);
      assertMappedCharge(charge, account, invoice);
      if (charge.amount_refunded !== 0 || charge.disputed !== false) throw review();
    }
  }
  private async fence(tx: Prisma.TransactionClient, account: BillingAccount, attempt: BillingAttempt, lease: string, requireActive = true) {
    await lockPlanTermCompany(tx, account.companyId);
    await tx.$queryRaw`SELECT "id" FROM "BillingAccount" WHERE "id" = ${account.id} FOR UPDATE`;
    const current = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
    if (current.leaseToken !== lease || !current.leaseUntil || current.leaseUntil <= new Date() || (requireActive && current.activeAttemptId !== attempt.id)) throw new Error('billing.repeat_lost_lease');
    return current;
  }
  private async sourceFence(tx: Prisma.TransactionClient, account: BillingAccount, attempt: BillingAttempt, snapshot: BillingSnapshot) {
    const current = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
    const company = await tx.company.findUniqueOrThrow({ where: { id: account.companyId }, include: { planTerm: true } });
    if (!snapshot.repeat || current.paidThrough?.toISOString() !== snapshot.repeat.paidThrough ||
        termProjectionHash(company.planTerm) !== snapshot.termHash || current.termProjectionHash !== snapshot.termHash ||
        (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))) throw review();
    if ((current.pendingPlanChangeId ?? null) !== (snapshot.pendingChange?.id ?? null)) throw review();
    if (snapshot.pendingChange) {
      const change = await tx.billingOperation.findUnique({ where: { id: snapshot.pendingChange.id } });
      const selection = snapshot.pendingChange.proposed.change.selection;
      if (!change || change.state !== 'SUCCEEDED' || change.version !== snapshot.pendingChange.version || !selection ||
        !capacityValid(await capacityOptions(tx, account.companyId, snapshot.pendingChange.proposed.snapshot.quote.offer), selection)) throw review();
    }
    if (snapshot.upgrade && (await upgradeHistory(tx, current, snapshot.quote.offer, snapshot.policy, snapshot.upgrade.prorationAt)).sourceHash !== snapshot.upgrade.sourceHash) throw review();
    if (await tx.billingIssue.count({ where: { companyId: account.companyId, stripeAccountId: account.stripeAccountId, livemode: account.livemode,
      state: { not: 'RESOLVED' }, kind: { in: ['FINANCIAL_REVIEW', 'DUPLICATE_SUBSCRIPTION', 'PAID_HELD', 'CONFIG_DRIFT'] } } })) throw review();
    return company;
  }

  async start(account: BillingAccount, attempt: BillingAttempt, origin: string | undefined) {
    const lease = randomUUID();
    const acquired = await this.prisma.client.billingAccount.updateMany({ where: { id: account.id,
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] }, data: { leaseToken: lease, leaseUntil: new Date(Date.now() + 120_000) } });
    if (!acquired.count) return { attemptId: attempt.id, state: 'PENDING', checkoutUrl: null };
    try { return await this.advance(account, attempt, lease, origin); }
    finally { await this.prisma.client.billingAccount.updateMany({ where: { id: account.id, leaseToken: lease },
      data: { leaseToken: null, leaseUntil: null, nextReconcileAt: new Date() } }); }
  }

  async advance(account: BillingAccount, attempt: BillingAttempt, lease: string, origin: string | undefined) {
    const snapshot = attempt.quoteSnapshot as unknown as BillingSnapshot, source = snapshot.repeat;
    if (!source || !account.customerId) throw review();
    const future = snapshot.pendingChange?.proposed.snapshot ?? snapshot;
    const journal: Journal = structuredClone(attempt.collectionJson as unknown as Journal | null) ?? { commands: {} };
    const save = async (data: Prisma.BillingAttemptUpdateInput = {}) => this.prisma.client.$transaction(async tx => {
      await this.fence(tx, account, attempt, lease);
      await tx.billingAttempt.update({ where: { id: attempt.id }, data: { ...data, collectionJson: json(journal), version: { increment: 1 } } });
    });
    // Persist exact command identity before I/O; never retry an aged ambiguous financial mutation.
    const command = async (step: string, path: string, params: Record<string, unknown>) => {
      const hash = hashBilling([path, params]), old = journal.commands[step];
      if (old && (old.hash !== hash || Date.now() - Date.parse(old.at) > 23 * 3600000)) throw review();
      if (!old && ['hold', 'billingEmail', 'checkout'].includes(step) && !journal.commands.checkout) {
        await this.prisma.client.$transaction(async tx => {
          await this.fence(tx, account, attempt, lease);
          await this.billing.assertOwner({ companyId: account.companyId, userId: attempt.initiatingUserId } as RequestContext, tx);
          await lockAccountEmail(tx, attempt.initiatingUserId);
          await assertAccountEmailProof(tx, attempt.initiatingUserId, snapshot.emailProof);
          journal.commands[step] = { at: new Date().toISOString(), hash };
          await tx.billingAttempt.update({ where: { id: attempt.id }, data: { collectionJson: json(journal), version: { increment: 1 } } });
        });
      } else { journal.commands[step] ??= { at: new Date().toISOString(), hash }; await save(); }
      return this.stripe.request('POST', path, params, `mm:${attempt.id}:${step}`);
    };
    const authorizeSale = async () => this.prisma.client.$transaction(async tx => {
      await this.fence(tx, account, attempt, lease); await this.sourceFence(tx, account, attempt, snapshot);
      await this.billing.assertOwner({ companyId: account.companyId, userId: attempt.initiatingUserId } as RequestContext, tx);
      const state = await this.billing.settings(tx);
      assertCompanyCanBuy(state.policy, account.companyId);
      if (!state.gates.new_sales || !state.gates.plan_changes || state.revision?.id !== attempt.policyRevisionId || state.settings.version !== snapshot.settingsVersion) throw review();
    });
    const abort = async (status: 'EXPIRED' | 'FAILED') => {
      await this.restoreHeldInvoices(account, attempt, snapshot, journal, command, false);
      let sub = await this.stripe.request('GET', `/subscriptions/${source.subscriptionId}`);
      if (sub.pause_collection) {
        if (sub.metadata?.mangmeeCollectionAttempt !== attempt.id) throw review();
        await command('abortResume', `/subscriptions/${source.subscriptionId}`, { pause_collection: '' });
      }
      sub = await this.stripe.request('GET', `/subscriptions/${source.subscriptionId}`);
      if (sub.pause_collection) throw review();
      journal.aborted = true; await this.finish(account, attempt, lease, journal, status);
      return { attemptId: attempt.id, state: status, checkoutUrl: null };
    };
    try {
      await this.stripe.assertAccount();
      if (journal.abortRequested) return await abort('FAILED');
      let sub = await this.stripe.request('GET', `/subscriptions/${source.subscriptionId}`);
      this.assertSubscription(sub, account);
      if (!journal.beforeInvoiceIds) {
        await authorizeSale();
        await this.billing.assertTaxSettings(snapshot.policy);
        if (snapshot.pendingChange) await this.billing.assertTaxSettings(future.policy);
        if (sub.pause_collection) throw review();
        await this.assertOriginalCollection(sub, account, source, snapshot.quote.offer.interval);
        const invoices = await this.stripe.list('/invoices', { subscription: source.subscriptionId });
        await this.assertNoDebt(account, invoices);
        journal.beforeInvoiceIds = invoices.map(i => i.id); journal.heldAt = Math.floor(Date.now() / 1000); await save();
      }
      // A previous unpause may have succeeded just before a crash. Never reapply the hold then.
      if (!journal.commands.resume && !journal.commands.abortResume) {
        if (!sub.pause_collection) sub = await command('hold', `/subscriptions/${source.subscriptionId}`, {
          pause_collection: { behavior: 'keep_as_draft' }, metadata: { mangmeeCollectionAttempt: attempt.id } });
        sub = await this.stripe.request('GET', `/subscriptions/${source.subscriptionId}`); this.assertSubscription(sub, account);
        if (sub.pause_collection?.behavior !== 'keep_as_draft' || sub.pause_collection.resumes_at || sub.metadata?.mangmeeCollectionAttempt !== attempt.id) throw review();
      }
      let sessions = attempt.checkoutSessionId ? [await this.stripe.request('GET', `/checkout/sessions/${attempt.checkoutSessionId}`)] :
        (await this.stripe.list('/checkout/sessions', { customer: account.customerId })).filter(s => s.metadata?.billingAttemptId === attempt.id);
      if (sessions.length > 1) throw review();
      if (!sessions.length) {
        // Before a first request, validate that no renewal invoice raced the collection hold.
        if (!journal.commands.checkout) {
          await this.assertOriginalCollection(await this.stripe.request('GET', `/subscriptions/${source.subscriptionId}`), account, source, snapshot.quote.offer.interval);
          const currentInvoices = await this.stripe.list('/invoices', { subscription: source.subscriptionId });
          await this.assertNoDebt(account, currentInvoices);
          if (currentInvoices.some(i => !journal.beforeInvoiceIds!.includes(i.id))) throw review();
          await authorizeSale(); journal.checkoutExpiresAt = Math.floor(Date.now() / 1000) + 1800;
          if (snapshot.upgrade && (Date.now() >= Date.parse(snapshot.quote.expiresAt) || journal.checkoutExpiresAt*1000 >= Date.parse(snapshot.upgrade.segments[0]!.end))) throw review();
          await save();
        }
        await authorizeSale();
        let customer = await this.stripe.request('GET', `/customers/${account.customerId}`);
        if (customer.id !== account.customerId || customer.metadata?.billingAccountId !== account.id) throw review();
        if (customer.email !== snapshot.quote.billingEmail) throw review();
        const returnUrl = new URL(`/companies/${account.companyId}/billing/return?attempt=${attempt.id}`, origin).toString();
        const metadata = { billingAttemptId: attempt.id, billingAccountId: account.id };
        sessions = [await command('checkout', '/checkout/sessions', { mode: 'payment', customer: account.customerId,
          client_reference_id: attempt.id, payment_method_types: ['card'], metadata, invoice_creation: { enabled: true, invoice_data: { metadata,
            ...(snapshot.policy.taxTreatment !== 'NOT_VAT_REGISTERED' && snapshot.policy.issuer ? { account_tax_ids: [snapshot.policy.issuer.stripeTaxId] } : {}) } },
          payment_intent_data: { metadata }, line_items: [{ quantity: 1, price_data: { product: source.productId, currency: 'thb',
            unit_amount: snapshot.upgrade?.amountSatang ?? snapshot.quote.offer.priceSatang, tax_behavior: snapshot.policy.taxTreatment === 'EXCLUSIVE_VAT_7' ? 'exclusive' : 'inclusive' },
            ...(snapshot.policy.taxRateId ? { tax_rates: [snapshot.policy.taxRateId] } : {}) }],
          success_url: returnUrl, cancel_url: returnUrl, locale: 'th', billing_address_collection: 'required', expires_at: journal.checkoutExpiresAt })];
      }
      const session = sessions[0]!;
      if (session.object !== 'checkout.session' || typeof session.id !== 'string' || !/^cs_[a-zA-Z0-9_]+$/.test(session.id) ||
          !['open', 'complete', 'expired'].includes(session.status) || (session.status === 'open' && !safeStripeUrl(session.url, 'checkout')) ||
          session.mode !== 'payment' || session.livemode !== account.livemode || stripeId(session.customer) !== account.customerId ||
          session.client_reference_id !== attempt.id || session.metadata?.billingAttemptId !== attempt.id || session.metadata?.billingAccountId !== account.id || session.subscription) throw review();
      await save({ checkoutSessionId: session.id, status: session.status === 'complete' ? 'COMPLETED' : 'OPEN' });
      if (session.status === 'expired') {
        return await abort('EXPIRED');
      }
      if (session.status === 'open') return { attemptId: attempt.id, state: 'OPEN', checkoutUrl: safeStripeUrl(session.url, 'checkout') };
      if (session.status !== 'complete' || session.payment_status !== 'paid' || !stripeId(session.invoice)) throw review();
      const invoice = await this.stripe.request('GET', `/invoices/${stripeId(session.invoice)}`);
      const {evidence,impact}=await this.checkoutPayment(account,attempt,session,invoice);
      if (journal.paidThrough && journal.paidThrough !== impact.paidThrough.toISOString()) throw review();
      journal.paidThrough = impact.paidThrough.toISOString(); journal.serviceStart = impact.serviceStartsAt.toISOString(); await save();
      // Preserve paid evidence immediately so status/documents survive a later scheduling failure.
      await this.recordPayment(account, attempt, snapshot, evidence, journal, lease);
      if (evidence.disputed || evidence.refundedSatang || evidence.paidAt > new Date() || (snapshot.upgrade &&
        (evidence.paidAt < new Date(snapshot.upgrade.prorationAt) || evidence.paidAt.getTime() >= Date.parse(snapshot.upgrade.segments[0]!.end)))) throw review();
      await this.prisma.client.$transaction(async tx => { await this.fence(tx, account, attempt, lease); await this.sourceFence(tx, account, attempt, snapshot); });
      sub = await this.stripe.request('GET', `/subscriptions/${source.subscriptionId}`); this.assertSubscription(sub, account);
      let scheduleId = journal.scheduleId ?? stripeId(sub.schedule);
      if (!scheduleId) {
        const schedule = await command('scheduleCreate', '/subscription_schedules', { from_subscription: source.subscriptionId });
        this.assertSchedule(schedule, account); scheduleId = schedule.id;
      }
      journal.scheduleId = scheduleId!; await save();
      let schedule = await this.stripe.request('GET', `/subscription_schedules/${scheduleId}`); this.assertSchedule(schedule, account);
      journal.phaseStart ??= schedule.current_phase?.start_date; await save();
      if (!Number.isSafeInteger(journal.phaseStart) || journal.phaseStart! >= impact.paidThrough.getTime() / 1000) throw review();
      const target = Math.floor(impact.paidThrough.getTime() / 1000);
      if (schedule.metadata?.mangmeeCollectionAttempt !== attempt.id || schedule.phases?.at(-1)?.start_date !== target) {
        schedule = await command('scheduleUpdate', `/subscription_schedules/${scheduleId}`, { end_behavior: 'release', proration_behavior: 'none',
          metadata: { billingAccountId: account.id, mangmeeCollectionAttempt: attempt.id },
          default_settings: { automatic_tax: { enabled: false }, collection_method: 'charge_automatically' }, phases: [
            { start_date: journal.phaseStart, end_date: target, items: [{ price: source.zeroPriceId, quantity: 1, tax_rates: '' }],
              default_tax_rates: '', discounts: '', proration_behavior: 'none' },
            { start_date: target, end_date: Math.floor(appendPackageInterval(impact.paidThrough, future.quote.offer.interval).getTime() / 1000),
              items: [{ price: future.priceId, quantity: 1, tax_rates: future.policy.taxRateId ? [future.policy.taxRateId] : '' }],
              default_tax_rates: '', discounts: '', billing_cycle_anchor: 'phase_start', proration_behavior: 'none' },
          ] });
      }
      schedule = await this.stripe.request('GET', `/subscription_schedules/${scheduleId}`);
      this.assertSchedule(schedule, account);
      const phases = schedule.phases;
      const taxes = (values: unknown) => Array.isArray(values) ? values.map(stripeId).sort() : [];
      const expectedTax = future.policy.taxRateId ? [future.policy.taxRateId] : [];
      if (schedule.end_behavior !== 'release' || !simpleCollection(schedule.default_settings ?? {}) ||
          phases?.length !== 2 || phases[0].start_date !== journal.phaseStart || phases[0].end_date !== target || phases[1].start_date !== target ||
          phases[1].end_date !== Math.floor(appendPackageInterval(impact.paidThrough, future.quote.offer.interval).getTime() / 1000) ||
          phases.some((p: StripeObject) => !simpleCollection(p) || (p.items?.[0]?.discounts?.length ?? 0) || p.items?.length !== 1 || p.items[0]?.quantity !== 1 || (p.discounts?.length ?? 0) ||
            (p.add_invoice_items?.length ?? 0) || (p.default_tax_rates?.length ?? 0) || p.trial_end || p.automatic_tax?.enabled ||
            (p.collection_method && p.collection_method !== 'charge_automatically')) ||
          taxes(phases[0].items[0].tax_rates).length || hashBilling(taxes(phases[1].items[0].tax_rates)) !== hashBilling(expectedTax) ||
          stripeId(phases[0].items?.[0]?.price) !== source.zeroPriceId || stripeId(phases[1].items?.[0]?.price) !== future.priceId ||
          phases[1].billing_cycle_anchor !== 'phase_start') throw review();
      await this.restoreHeldInvoices(account, attempt, snapshot, journal, command, true);
      sub = await this.stripe.request('GET', `/subscriptions/${source.subscriptionId}`);
      if (sub.pause_collection) {
        if (sub.metadata?.mangmeeCollectionAttempt !== attempt.id) throw review();
        await command('resume', `/subscriptions/${source.subscriptionId}`, { pause_collection: '' });
      }
      sub = await this.stripe.request('GET', `/subscriptions/${source.subscriptionId}`); this.assertSubscription(sub, account);
      if (sub.pause_collection || stripeId(sub.schedule) !== scheduleId) throw review();
      await this.apply(account, attempt, snapshot, evidence, journal, lease);
      return { attemptId: attempt.id, state: 'COMPLETED', checkoutUrl: null };
    } catch (error) {
      if (!journal.beforeInvoiceIds) {
        await this.finish(account, attempt, lease, journal, 'FAILED');
        return { attemptId: attempt.id, state: 'FAILED', checkoutUrl: null };
      }
      if (!journal.commands.checkout) journal.abortRequested = true;
      await save({ status: 'UNKNOWN', errorCode: 'repeat_reconciliation_required' });
      await this.billing.issue(account.companyId, 'REPEAT_RECOVERY', attempt.id);
      return { attemptId: attempt.id, state: 'UNKNOWN', checkoutUrl: null };
    }
  }

  private async restoreHeldInvoices(account: BillingAccount, attempt: BillingAttempt, snapshot: BillingSnapshot, journal: Journal,
    command: (step: string, path: string, params: Record<string, unknown>) => Promise<StripeObject>, paid: boolean) {
    const source = snapshot.repeat!;
    const invoices = await this.stripe.list('/invoices', { subscription: source.subscriptionId });
    for (let invoice of invoices.filter(i => !journal.beforeInvoiceIds!.includes(i.id))) {
      const lines = await this.stripe.list(`/invoices/${invoice.id}/lines`, {}), line = lines[0];
      if (invoice.livemode !== account.livemode || stripeId(invoice.customer) !== account.customerId ||
          stripeId(invoice.parent?.subscription_details?.subscription) !== source.subscriptionId || invoice.created < journal.heldAt! ||
          invoice.billing_reason !== 'subscription_cycle' || invoice.collection_method !== 'charge_automatically' ||
          invoice.currency !== 'thb' || invoice.amount_paid !== 0 || ![0, source.sourceTotal].includes(invoice.total) ||
          lines.length !== 1 || line?.parent?.subscription_item_details?.proration !== false ||
          stripeId(line?.parent?.subscription_item_details?.subscription) !== source.subscriptionId ||
          ![source.sourcePriceId, source.zeroPriceId, source.currentPriceId].includes(line?.pricing?.price_details?.price) ||
          line?.currency !== 'thb' || line?.livemode !== account.livemode || line?.quantity !== 1 ||
          !Number.isSafeInteger(line?.period?.start) || !Number.isSafeInteger(line?.period?.end) || line.period.start >= line.period.end ||
          (invoice.total > 0 ? line.period.start * 1000 < Date.parse(source.paidThrough) : line.period.start < source.currentPeriodStart)) throw review();
      if (invoice.status === 'void' || (invoice.total === 0 && invoice.status === 'paid')) continue;
      if (!paid) {
        if (invoice.status !== 'draft') throw review();
        if (invoice.auto_advance !== true) await command(`restore_${invoice.id}`, `/invoices/${invoice.id}`, { auto_advance: true });
        const restored = await this.stripe.request('GET', `/invoices/${invoice.id}`);
        if (restored.id !== invoice.id || restored.auto_advance !== true) throw review();
        continue;
      }
      if (invoice.status === 'draft' && invoice.auto_advance === false) invoice = await command(`finalize_${invoice.id}`, `/invoices/${invoice.id}/finalize`, { auto_advance: false });
      if (invoice.status !== 'open' || invoice.auto_advance !== false || invoice.amount_paid !== 0) throw review();
      const voided = await command(`void_${invoice.id}`, `/invoices/${invoice.id}/void`, {});
      if (voided.id !== invoice.id || voided.status !== 'void' || voided.amount_paid !== 0) throw review();
    }
  }

  async ownedZeroInvoice(account: BillingAccount, invoice: StripeObject, lines: StripeObject[]): Promise<boolean> {
    const line = lines[0];
    if (invoice.object !== 'invoice' || invoice.livemode !== account.livemode || stripeId(invoice.customer) !== account.customerId ||
        stripeId(invoice.parent?.subscription_details?.subscription) !== account.baseSubscriptionId || invoice.status !== 'paid' ||
        invoice.total !== 0 || invoice.amount_paid !== 0 || invoice.amount_remaining !== 0 || invoice.currency !== 'thb' ||
        invoice.billing_reason !== 'subscription_cycle' || invoice.collection_method !== 'charge_automatically' || invoice.starting_balance !== 0 ||
        lines.length !== 1 || line?.currency !== 'thb' || line?.quantity !== 1 || line?.livemode !== account.livemode ||
        line?.parent?.subscription_item_details?.proration !== false || stripeId(line?.parent?.subscription_item_details?.subscription) !== account.baseSubscriptionId ||
        !Number.isSafeInteger(line?.period?.start) || !Number.isSafeInteger(line?.period?.end) || line.period.start >= line.period.end) return false;
    const attempts = await this.prisma.client.billingAttempt.findMany({ where: { billingAccountId: account.id, status: 'COMPLETED' },
      select: { collectionJson: true, quoteSnapshot: true } });
    return attempts.some(attempt => {
      const journal = attempt.collectionJson as unknown as Journal | null, snapshot = attempt.quoteSnapshot as unknown as BillingSnapshot;
      return journal?.completed && snapshot.repeat && line.pricing?.price_details?.price === snapshot.repeat.zeroPriceId &&
        line.period.start >= journal.phaseStart! && line.period.end * 1000 <= Date.parse(journal.paidThrough!);
    });
  }

  private async checkoutPayment(account:BillingAccount,attempt:BillingAttempt,session:StripeObject,invoice:StripeObject) {
    const snapshot=attempt.quoteSnapshot as unknown as BillingSnapshot,source=snapshot.repeat!;
    const payments = await this.stripe.list('/invoice_payments', { invoice: invoice.id });
    const intent = await this.stripe.request('GET', `/payment_intents/${stripeId(session.payment_intent)}`, { expand: ['latest_charge.balance_transaction'] });
    const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : await this.stripe.request('GET', `/charges/${stripeId(intent.latest_charge)}`);
    const evidence = paidPackageCheckoutEvidence({ session, invoice, payments, intent, charge, snapshot, attemptId: attempt.id,
      billingAccountId: account.id, customerId: account.customerId!, productId: source.productId, livemode: account.livemode,
      checkoutLines: await this.stripe.list(`/checkout/sessions/${session.id}/line_items`, {}), invoiceLines: await this.stripe.list(`/invoices/${invoice.id}/lines`, {}) });
    const impact = snapshot.upgrade ? { paidThrough: new Date(source.paidThrough), serviceStartsAt: new Date(snapshot.upgrade.prorationAt) } :
      fullPackagePurchaseImpact({ tier: snapshot.quote.offer.offerKey, interval: snapshot.quote.offer.interval, offer:snapshot.quote.offer,
        verifiedPaidAt: evidence.paidAt, paidThrough: new Date(source.paidThrough), remainingPaidReceipts: 0, anchorDay: source.anchorDay });
    return {evidence,impact};
  }
  async importPayment(account:BillingAccount,attempt:BillingAttempt,session:StripeObject,invoice:StripeObject,lease:string,guard:(tx:Prisma.TransactionClient)=>Promise<void>) {
    const {evidence,impact}=await this.checkoutPayment(account,attempt,session,invoice);
    const journal:Journal={commands:{},paidThrough:impact.paidThrough.toISOString(),serviceStart:impact.serviceStartsAt.toISOString()};
    await this.recordPayment(account,attempt,attempt.quoteSnapshot as unknown as BillingSnapshot,evidence,journal,lease,guard);
  }

  private async recordPayment(account: BillingAccount, attempt: BillingAttempt, snapshot: BillingSnapshot, evidence: PaidCheckoutEvidence, journal: Journal, lease: string, recordOnly?:(tx:Prisma.TransactionClient)=>Promise<void>) {
    await this.prisma.client.$transaction(async tx => {
      await this.fence(tx, account, attempt, lease, !recordOnly);
      if(recordOnly)await recordOnly(tx);
      const existing = await tx.billingInvoice.findUnique({ where: { sourceAttemptId: attempt.id } });
      if (existing && existing.evidenceHash !== evidence.evidenceHash) throw review();
      const invoice=await tx.billingInvoice.upsert({ where: { sourceAttemptId: attempt.id }, update: { feeSatang: evidence.feeSatang },
        create: { billingAccountId: account.id, sourceAttemptId: attempt.id, providerInvoiceId: evidence.invoiceId, subscriptionId: null,
          providerNumber: evidence.number, offerSnapshot: json(snapshot.quote.offer), contractSnapshot: json(snapshot), policyRevisionId: attempt.policyRevisionId,
          currency: 'THB', totalSatang: evidence.totalSatang, paidSatang: evidence.totalSatang, taxSatang: evidence.taxSatang,
          refundedSatang: evidence.refundedSatang, disputed: evidence.disputed, financialObservedAt: new Date(), feeSatang: evidence.feeSatang, providerChargeId: evidence.chargeId,
          periodStart: new Date(journal.serviceStart!), periodEnd: new Date(journal.paidThrough!), providerStatus: 'paid', evidenceHash: evidence.evidenceHash } });
      await recordBillingFinancials(tx,account,invoice,{refundedSatang:evidence.refundedSatang,disputed:evidence.disputed});
      if(recordOnly&&!invoice.appliedAt){await tx.billingInvoice.update({where:{id:invoice.id},data:{applyStatus:'HELD',errorCode:'access_review_required'}});
        await detectBillingIssue(tx,{companyId:account.companyId,stripeAccountId:account.stripeAccountId,livemode:account.livemode,kind:'PAID_HELD',referenceId:invoice.id});}
      if(recordOnly)await tx.auditLog.create({data:{companyId:account.companyId,action:'billing.invoice.imported',targetType:'BillingInvoice',targetId:invoice.id,requestId:invoice.id,result:'SUCCESS',riskLevel:'HIGH',metadataJson:{sourceAttemptId:attempt.id,rightsChanged:false}}});
    });
  }
  private async apply(account: BillingAccount, attempt: BillingAttempt, snapshot: BillingSnapshot, evidence: PaidCheckoutEvidence, journal: Journal, lease: string) {
    await this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${account.companyId}`}))`;
      await this.fence(tx, account, attempt, lease); const company = await this.sourceFence(tx, account, attempt, snapshot);
      const invoice = await tx.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: attempt.id } });
      if (invoice.appliedAt) return;
      const end = new Date(journal.paidThrough!), start = new Date(journal.serviceStart!);
      if (end <= new Date()) throw review();
      const balance = await paidReceiptBalance(tx, account.companyId, account.id, evidence.paidAt);
      if (snapshot.upgrade) {
        if (balance.remaining + snapshot.upgrade.receiptUnitsAdded > 2147483647) throw review();
      } else fullPackagePurchaseImpact({ tier: snapshot.quote.offer.offerKey, interval: snapshot.quote.offer.interval, offer:snapshot.quote.offer, verifiedPaidAt: evidence.paidAt,
        paidThrough: new Date(snapshot.repeat!.paidThrough), remainingPaidReceipts: balance.remaining, anchorDay: snapshot.repeat!.anchorDay });
      await tx.companyPlanTerm.update({ where: { companyId: account.companyId }, data: { termEndsAt: end, termDisabledAt: null,
        branchLimit:snapshot.quote.offer.branchLimit,employeeLimit:snapshot.quote.offer.employeeLimit,monthlySlipLimit:snapshot.quote.offer.monthlySlipLimit,
        ...(snapshot.upgrade ? { tierKey: snapshot.quote.offer.offerKey } : { lastRenewedAt: new Date(), renewCount: { increment: 1 } }),
        warn7SentAt: null, warn3SentAt: null, warn1SentAt: null, expiredNotifiedAt: null } });
      await grantPaidPackageReceipts(tx, { companyId: account.companyId, billingAccountId: account.id, sourceKey: invoice.id,
        policyRevisionId: attempt.policyRevisionId, kind: snapshot.upgrade ? 'UPGRADE' : 'REPEAT', units: snapshot.upgrade?.receiptUnitsAdded ?? snapshot.quote.offer.receiptAllowance,
        serviceStart: start, serviceEnd: end, availableAt: evidence.paidAt, expiresAt: end });
      const term = await tx.companyPlanTerm.findUniqueOrThrow({ where: { companyId: account.companyId } });
      if (company.status === 'DISABLED') {
        if (!this.lifecycle) throw review();
        await this.lifecycle.execute({ companyId: company.id, targetStatus: 'ACTIVE', requestingAdminUserId: null,
          requestId: attempt.id, reason: 'stripe_verified_repeat_paid' }, tx);
      }
      const { pendingChange: pending, planChangeId: _oldChange, capacity: _capacity, ...baseSnapshot } = snapshot;
      const renewalSnapshot = { ...baseSnapshot, quote: { ...snapshot.quote, ...quoteTotals(snapshot.quote.offer.priceSatang, snapshot.policy.taxTreatment),
        purchase: undefined, upgrade: undefined, capacity: undefined, pendingPlanChange: undefined } };
      const cleanSnapshot = JSON.parse(JSON.stringify(renewalSnapshot)) as BillingSnapshot;
      if (pending) {
        // Record restoration at the old date before appending the lower target at the extended date.
        await tx.billingSubscriptionContract.create({ data: { billingAccountId: account.id, sourceAttemptId: attempt.id,
          effectiveAt: new Date(snapshot.repeat!.paidThrough), snapshotJson: json(cleanSnapshot) } });
        const next = await tx.billingOperation.create({ data: { stripeAccountId: account.stripeAccountId, livemode: account.livemode, companyId: account.companyId,
          type: 'CUSTOMER_SCHEDULE_DOWNGRADE', state: 'SUCCEEDED', referenceId: pending.id, sourceVersion: account.version,
          proposedJson: json({ ...pending.proposed, paidThrough: end.toISOString(), change: { ...pending.proposed.change, previousId: pending.id, currentSnapshot: cleanSnapshot } }),
          reason: snapshot.upgrade ? 'paid_upgrade_preserved_pending_downgrade' : 'paid_repeat_extended_pending_downgrade', initiatorUserId: attempt.initiatingUserId,
          requestHash: hashBilling([attempt.id, invoice.id, pending.id, pending.version, end]), expiresAt: end, observedAt: new Date(),
          resultJson: { observed: true, scheduleId: journal.scheduleId!, purchaseAttemptId: attempt.id } } });
        await tx.billingSubscriptionContract.create({ data: { billingAccountId: account.id, sourceAttemptId: next.id, effectiveAt: end,
          snapshotJson: json({ ...pending.proposed.snapshot, planChangeId: next.id }) } });
        await tx.billingOperation.update({ where: { id: pending.id }, data: { state: 'SUPERSEDED', version: { increment: 1 } } });
        await tx.billingAccount.update({ where: { id: account.id }, data: { pendingPlanChangeId: next.id } });
      } else await tx.billingSubscriptionContract.create({ data: { billingAccountId: account.id, sourceAttemptId: attempt.id, effectiveAt: end, snapshotJson: json(cleanSnapshot) } });
      await tx.billingInvoice.update({ where: { id: invoice.id }, data: { applyStatus: 'APPLIED', appliedAt: new Date(), errorCode: null } });
      journal.completed = true;
      await tx.billingAttempt.update({ where: { id: attempt.id }, data: { status: 'COMPLETED', errorCode: null, collectionJson: json(journal) } });
      await tx.billingAccount.update({ where: { id: account.id }, data: { paidThrough: end, nextChargeAt: end, activeAttemptId: null,
        termProjectionHash: termProjectionHash(term), observedAt: new Date(), version: { increment: 1 } } });
      await fulfillPaidPackageRequest(tx,account.companyId,account.id,invoice.id);
      await tx.auditLog.create({ data: { companyId: account.companyId, actorUserId: attempt.initiatingUserId, action: snapshot.upgrade ? 'billing.package.upgraded' : 'billing.package.repeated',
        targetType: 'BillingInvoice', targetId: invoice.id, requestId: attempt.id, result: 'SUCCESS', riskLevel: 'CRITICAL',
        metadataJson: { receiptUnitsAdded: snapshot.upgrade?.receiptUnitsAdded ?? snapshot.quote.offer.receiptAllowance, paidThrough: end.toISOString() } } });
      await tx.outboxEvent.upsert({ where: { eventKey: `billing:applied:${invoice.id}` }, update: {}, create: { companyId: account.companyId,
        eventType: 'billing.invoice.applied', aggregateType: 'BillingInvoice', aggregateId: invoice.id, eventKey: `billing:applied:${invoice.id}`,
        payloadJson: { schemaVersion: 1, occurredAt: new Date().toISOString(), data: { invoiceId: invoice.id, companyId: account.companyId } } } });
      await tx.billingIssue.updateMany({ where: { companyId: account.companyId, stripeAccountId: account.stripeAccountId, livemode: account.livemode,
        referenceId: attempt.id, kind: 'REPEAT_RECOVERY' }, data: { state: 'RESOLVED', resolvedAt: new Date() } });
    });
  }
  private async finish(account: BillingAccount, attempt: BillingAttempt, lease: string, journal: Journal, status: string) {
    await this.prisma.client.$transaction(async tx => {
      await this.fence(tx, account, attempt, lease);
      await tx.billingAttempt.update({ where: { id: attempt.id }, data: { status, collectionJson: json(journal), errorCode: null } });
      await tx.billingAccount.update({ where: { id: account.id }, data: { activeAttemptId: null, version: { increment: 1 } } });
      await tx.billingIssue.updateMany({ where: { companyId: account.companyId, stripeAccountId: account.stripeAccountId, livemode: account.livemode,
        referenceId: attempt.id, kind: 'REPEAT_RECOVERY' }, data: { state: 'RESOLVED', resolvedAt: new Date() } });
    });
  }
}
