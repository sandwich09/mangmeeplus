/**
 * D-P5-6 — `SCHEDULE_PRICE_RETURN`: the operation that puts a shop back on its base tier's catalog
 * price when an auto-renewing deal ends, and with it (Q1) the tier's default menus, AI credit and
 * limits.
 *
 * Shape: the collection-op contract exactly — `Proposed` on the row, a journal in `resultJson`,
 * an `observed()` that decides from the provider alone, an `advance()` fenced by the account lease,
 * and a one-hour re-send window on any started provider write (then read only, see `end`). It is a separate file because nothing about
 * a customer's own renewal controls applies here: no OWNER context, no PREVIEW/submit round trip,
 * no email proof, no capacity selection, and no `plan_changes` gate — the platform is undoing a
 * price the platform itself set, not selling anything.
 *
 * ponytail — the mechanism is a single item-price swap with `proration_behavior: 'none'`, not the
 * two-phase subscription schedule D-P5-6 sketches. Both bill the NEXT cycle at the catalog price
 * and leave the current one untouched, but a schedule also has to satisfy
 * `currentSchedulePhase` (billing-schedule.ts), which only recognises a future phase backed by a
 * registered `pendingPlanChangeId` — a `CUSTOMER_SCHEDULE_DOWNGRADE` row. Teaching it a second
 * owner would mean editing that evidence file beyond the one allowed line, and NOT teaching it
 * would take the customer's own cancel/resume buttons down for the whole final cycle. The swap
 * needs no schedule at all, so `currentSchedulePhase` never sees one. Upgrade path: if a future
 * deal has to change price mid-cycle rather than at the boundary, this becomes a real schedule and
 * `pendingChange()` has to learn this type.
 */
import { billingOffer, TIER_FEATURE_PRESETS } from '@watchdog-bms/contracts';
import type { BillingAccount, BillingOperation, Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { autoRenewOf, DEAL_KIND } from '../../sales-console/domain/sales-deal.logic';
import { assertPolicyReady, assertStripePrice, billingError, hashBilling, quoteTotals } from '../domain/billing-policy';
import { dealSnapshot } from '../domain/deal-offer';
import { stripeId, type StripeClient, type StripeObject } from '../infrastructure/stripe.client';
import type { BillingService, BillingSnapshot } from './billing.service';
import { collectionSourceHash } from './billing-collection';
import { billingFeaturePlan } from './billing-feature-entitlements';
import { collectionContract, sameScheduleTaxes, simpleCollection, subscriptionGraph } from './billing-schedule';

export const PRICE_RETURN_TYPE = 'SCHEDULE_PRICE_RETURN';

export type PriceReturnProposed = {
  /** `ownedSchedule` reads this name, so it stays `accountId` even though nothing here is a phase. */
  accountId: string; dealRequestId: string; subscriptionId: string; subscriptionItemId: string;
  /** The boundary: the last cycle billed at the deal price ends here, and the catalog price starts. */
  paidThrough: string;
  sourceHash: string; sourceTermHash: string | null;
  /** What every cycle from `paidThrough` on is validated against — the catalog offer, plus the
   *  `dealReturn` flag that makes the apply rewrite menus, AI credit and limits (Q1). */
  snapshot: BillingSnapshot;
  dealPriceId: string; params: Record<string, unknown>;
};
type Journal = { startedAt?: string; updateStartedAt?: string; updateHash?: string; observed?: boolean };

/** 2026-10-10: the swap is re-sent under its key for one hour; ten quiet minutes later nothing sent can still be in flight. */
const RESEND_WINDOW_MS = 3600_000, QUIET_MARGIN_MS = 600_000;

const review = () => billingError('SPECIAL_PRICE_RETURN_REVIEW', 'ยังปรับราคากลับเป็นราคาปกติไม่ได้ ทีมงานกำลังตรวจสอบ');

/**
 * The provider alone decides "done": this subscription bills the catalog price from the next cycle
 * on, and the cycle the customer has already paid for is untouched. Pure, so the shapes it accepts
 * and refuses can be exercised without Stripe.
 */
export function priceReturnObserved(proposed: PriceReturnProposed, sub: StripeObject): boolean {
  const item = sub.items?.data?.[0], target = Date.parse(proposed.paidThrough) / 1000;
  return sub.id === proposed.subscriptionId && sub.status === 'active' && !sub.cancel_at && !sub.cancel_at_period_end &&
    !sub.pause_collection && !sub.pending_update && sub.billing_mode?.type === 'classic' && simpleCollection(sub) &&
    sub.collection_method === 'charge_automatically' && !stripeId(sub.schedule) &&
    sub.items?.has_more === false && sub.items.data.length === 1 && item.id === proposed.subscriptionItemId &&
    item.quantity === 1 && !(item.discounts?.length ?? 0) && stripeId(item.price) === proposed.snapshot.priceId &&
    sameScheduleTaxes(item.tax_rates, proposed.snapshot.policy.taxRateId) &&
    // `proration_behavior: 'none'` must not have moved the boundary the customer already paid to.
    item.current_period_end === target;
}

/**
 * The one provider write: swap the item's price, change nothing else, prorate nothing. Pure, so
 * the exact params that reach Stripe are a test rather than a code read.
 */
export function priceReturnParams(input: { itemId: string; catalogPriceId: string; taxRateId: string | null }): Record<string, unknown> {
  return { proration_behavior: 'none', payment_behavior: 'error_if_incomplete',
    items: [{ id: input.itemId, price: input.catalogPriceId, quantity: 1,
      ...(input.taxRateId ? { tax_rates: [input.taxRateId] } : {}) }] };
}
const json = (value: unknown) => value as Prisma.InputJsonValue;

export class BillingPriceReturn {
  constructor(private readonly prisma: PrismaService, private readonly stripe: StripeClient,
    private readonly billing: Pick<BillingService, 'issue' | 'assertTaxSettings' | 'settings' | 'account'>) {}

  /**
   * Claim the account and queue the swap. Called by the sales sweep in the deal's FINAL cycle, so
   * the catalog snapshot it freezes (feature plan included) is days old at apply time rather than
   * a whole cycle old. Returns the operation id, or null when this account is not ready yet — the
   * next 15-minute tick simply tries again.
   */
  async queue(account: BillingAccount, input: { dealRequestId: string; snapshot: BillingSnapshot }): Promise<string | null> {
    if (!account.baseSubscriptionId || !account.paidThrough || account.renewalMode !== 'CARD_AUTO' ||
      account.activeAttemptId || account.activeCollectionOperationId || account.pendingPlanChangeId ||
      account.cancelAtPeriodEnd || account.graceEndsAt || account.subscriptionState !== 'active' ||
      (account.leaseUntil && account.leaseUntil > new Date())) return null;
    const { sub, schedule } = await subscriptionGraph(this.stripe, account);
    const target = account.paidThrough.getTime() / 1000, item = sub.items?.data?.[0];
    // A schedule already owns this subscription's future; a swap underneath it would be invisible
    // to Stripe's own phase, so this account is left to the operator (the issue says so).
    if (schedule || sub.status !== 'active' || sub.cancel_at || sub.cancel_at_period_end || sub.pause_collection ||
      sub.pending_update || sub.billing_mode?.type !== 'classic' || !simpleCollection(sub) ||
      sub.collection_method !== 'charge_automatically' || sub.items?.has_more || sub.items?.data?.length !== 1 ||
      item.quantity !== 1 || (item.discounts?.length ?? 0) || item.current_period_end !== target ||
      !stripeId(item.id) || stripeId(item.price) === input.snapshot.priceId) return null;
    const dealPriceId = stripeId(item.price);
    if (!dealPriceId) return null;
    const params = priceReturnParams({ itemId: item.id, catalogPriceId: input.snapshot.priceId,
      taxRateId: input.snapshot.policy.taxRateId });
    const proposed: PriceReturnProposed = { accountId: account.id, dealRequestId: input.dealRequestId,
      subscriptionId: sub.id, subscriptionItemId: item.id, paidThrough: account.paidThrough.toISOString(),
      sourceHash: collectionSourceHash(sub, null), sourceTermHash: account.termProjectionHash,
      snapshot: JSON.parse(JSON.stringify(input.snapshot)), dealPriceId, params };
    return this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, account.companyId);
      const current = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
      if (current.version !== account.version || current.activeCollectionOperationId || current.activeAttemptId ||
        current.paidThrough?.toISOString() !== proposed.paidThrough) return null;
      const row = await tx.billingOperation.create({ data: { stripeAccountId: account.stripeAccountId,
        livemode: account.livemode, companyId: account.companyId, type: PRICE_RETURN_TYPE, state: 'QUEUED',
        referenceId: input.dealRequestId, proposedJson: json(proposed), sourceVersion: account.version,
        reason: 'sales_deal_price_return', initiatorUserId: 'system:sales-deal-return',
        idempotencyKey: `deal-return:${input.dealRequestId}:${proposed.paidThrough}`,
        requestHash: hashBilling([account.id, proposed.paidThrough, proposed.sourceHash, params]),
        expiresAt: new Date(account.paidThrough!.getTime()) } });
      await tx.billingAccount.update({ where: { id: account.id },
        data: { activeCollectionOperationId: row.id, nextReconcileAt: new Date(), version: { increment: 1 } } });
      await tx.auditLog.create({ data: { companyId: account.companyId, actorType: 'SYSTEM',
        actorRefId: 'sales-deal-return', action: 'billing.price_return.queued', targetType: 'BillingOperation',
        targetId: row.id, requestId: row.id, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { dealRequestId: input.dealRequestId, returnAt: proposed.paidThrough,
          fromPriceId: dealPriceId, toPriceId: input.snapshot.priceId } } });
      return row.id;
    });
  }

  /**
   * The 15-minute pass that queues due returns (called by the sales sweep).
   *
   * The window is deliberately late — inside the deal's FINAL cycle and at least two hours before
   * the boundary — for two reasons: the account's `paidThrough` only equals `returnAt` in that
   * cycle, which is what makes the swap a clean boundary change; and the catalog feature plan the
   * op freezes is validated again at apply time, so freezing it days rather than a cycle early is
   * the difference between a rare review and a routine one.
   */
  async sweep(now = new Date()): Promise<{ queued: number }> {
    if (!this.stripe.enabled) return { queued: 0 };
    const deals = await this.prisma.client.packageChangeRequest.findMany({
      where: { kind: DEAL_KIND, status: 'APPLIED',
        returnAt: { gt: new Date(now.getTime() + 2 * 3600_000), lte: new Date(now.getTime() + 3 * 86400_000) } },
      select: { id: true, companyId: true, offerSnapshotJson: true, returnAt: true }, take: 50,
    });
    let queued = 0;
    for (const deal of deals) {
      // One shop's provider hiccup never stops the batch; the next tick has the rest of the cycle.
      try {
        const account = await this.billing.account(deal.companyId);
        if (!account?.paidThrough || account.paidThrough.getTime() !== deal.returnAt!.getTime()) continue;
        if (await this.prisma.client.billingOperation.findFirst({ where: { type: PRICE_RETURN_TYPE,
          referenceId: deal.id, state: { notIn: ['CANCELLED', 'FAILED'] } }, select: { id: true } })) continue;
        const snapshot = await this.catalogSnapshot(account, deal);
        if (snapshot && await this.queue(account, { dealRequestId: deal.id, snapshot })) queued += 1;
      } catch { /* retried next tick; SPECIAL_PRICE_ENDING has already told the team and the shop */ }
    }
    return { queued };
  }

  /** Q1 — what the shop goes back to: the catalog offer, its Price, and the tier's default menus. */
  private async catalogSnapshot(account: BillingAccount,
    deal: { id: string; offerSnapshotJson: unknown; returnAt: Date | null }): Promise<BillingSnapshot | null> {
    const state = await this.billing.settings();
    if (!state.policy || !state.revision || !deal.returnAt) return null;
    assertPolicyReady(state.policy);
    const dealOfferSnapshot = dealSnapshot(deal.offerSnapshotJson);
    const auto = autoRenewOf(dealOfferSnapshot);
    const base = dealOfferSnapshot.base;
    if (!auto.cadence) return null;
    const priceId = state.policy.priceIds[`${base}:${auto.cadence}`];
    if (!priceId) return null;
    await this.stripe.assertAccount();
    const offer = billingOffer(base, auto.cadence, state.policy);
    const price = await this.stripe.request('GET', `/prices/${priceId}`);
    assertStripePrice(price, offer, state.policy, account.livemode, priceId);
    const productId = stripeId(price.product);
    if (!productId) return null;
    // The consent, the recipient and the company profile are the ones the shop already agreed to;
    // only the price, the offer and the menus change.
    const { future } = await collectionContract(this.prisma.client, account);
    const company = await this.prisma.client.company.findUniqueOrThrow({
      where: { id: account.companyId }, include: { planTerm: true } });
    // Q1/Phase 6: back to the BASE TIER's menus, not the starter preset. An ENTERPRISE deal that
    // ends must leave the shop on the ENTERPRISE package it is now paying the catalog price for.
    const plan = await billingFeaturePlan(this.prisma.client, account.companyId, TIER_FEATURE_PRESETS[base]);
    return {
      ...future, deal: undefined, repeat: undefined, restart: undefined, upgrade: undefined,
      oneTime: undefined, capacity: undefined, planChangeId: undefined, pendingChange: undefined,
      trialCarryover: undefined,
      dealReturn: { dealRequestId: deal.id, returnAt: deal.returnAt.toISOString(),
        creditScope: dealOfferSnapshot.version === 4 ? 'CHAT' : 'TOTAL' },
      quote: { ...future.quote, offer: { ...offer, availability: 'AVAILABLE', reason: null },
        policyRevision: state.revision.id, ...quoteTotals(offer.priceSatang, state.policy.taxTreatment),
        taxTreatment: state.policy.taxTreatment!, consentRevision: state.policy.consentRevision,
        purchase: undefined, upgrade: undefined, capacity: undefined, deal: undefined, trialEndsAt: null },
      priceId, productId, policy: state.policy, settingsVersion: state.settings.version,
      termVersion: company.planTerm?.updatedAt.toISOString() ?? null, termHash: account.termProjectionHash!,
      featurePlan: plan.plan,
    };
  }

  private async fence(tx: Prisma.TransactionClient, account: BillingAccount, operationId: string, lease: string) {
    await lockPlanTermCompany(tx, account.companyId);
    const current = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
    if (current.activeCollectionOperationId !== operationId || current.leaseToken !== lease ||
      !current.leaseUntil || current.leaseUntil <= new Date()) throw review();
    return current;
  }

  /** Dispatched from `reconcileAccount` while this account holds the lease. */
  async advance(account: BillingAccount, lease: string): Promise<void> {
    const row: BillingOperation = await this.prisma.client.billingOperation.findFirstOrThrow({
      where: { id: account.activeCollectionOperationId!, companyId: account.companyId,
        stripeAccountId: account.stripeAccountId, livemode: account.livemode, type: PRICE_RETURN_TYPE } });
    const proposed = row.proposedJson as unknown as PriceReturnProposed;
    const journal: Journal = (row.resultJson as Journal | null) ?? {};
    if (proposed.accountId !== account.id || proposed.subscriptionId !== account.baseSubscriptionId) throw review();
    // Refused before any provider write: no pass will ever send it, so it is over and holds nothing.
    if (row.state === 'BLOCKED' && !journal.startedAt) return this.end(account, row, journal, lease);
    try {
      let { sub, schedule } = await subscriptionGraph(this.stripe, account);
      if (!priceReturnObserved(proposed, sub)) {
        const age = journal.startedAt ? Date.now() - Date.parse(journal.startedAt) : 0;
        if (!Number.isFinite(age)) throw review();
        if (age >= RESEND_WINDOW_MS) {
          // Past the window a pass only reads. It ends only when this read still shows the deal price on the same item;
          // any other shape is not "not applied" and keeps waiting in review.
          const items = sub.items?.data ?? [];
          if (age >= RESEND_WINDOW_MS + QUIET_MARGIN_MS && !schedule && items.length === 1 && sub.items.has_more === false &&
            items[0].id === proposed.subscriptionItemId && stripeId(items[0].price) === proposed.dealPriceId) return await this.end(account, row, journal, lease);
          throw review();
        }
        // Nothing has changed since the proposal was frozen, so the swap is still the right write.
        if (schedule || collectionSourceHash(sub, null) !== proposed.sourceHash) throw review();
        await this.billing.assertTaxSettings(proposed.snapshot.policy);
        const startedAt = journal.startedAt ?? new Date().toISOString();
        await this.prisma.client.$transaction(async tx => {
          const current = await this.fence(tx, account, row.id, lease);
          if (current.baseSubscriptionId !== proposed.subscriptionId ||
            current.paidThrough?.toISOString() !== proposed.paidThrough ||
            current.termProjectionHash !== proposed.sourceTermHash) throw review();
          await tx.billingOperation.update({ where: { id: row.id },
            data: { state: 'RUNNING', resultJson: json({ ...journal, startedAt }), version: { increment: 1 } } });
        });
        journal.startedAt = startedAt;
        const params = { ...proposed.params, metadata: { billingAccountId: account.id, mangmeePriceReturnOperation: row.id } };
        const updateHash = hashBilling(['POST', `/subscriptions/${proposed.subscriptionId}`, params]);
        if (journal.updateHash && journal.updateHash !== updateHash) throw review();
        journal.updateHash = updateHash; journal.updateStartedAt ??= new Date().toISOString();
        await this.prisma.client.$transaction(async tx => { await this.fence(tx, account, row.id, lease);
          await tx.billingOperation.update({ where: { id: row.id }, data: { resultJson: json(journal) } }); });
        await this.stripe.request('POST', `/subscriptions/${proposed.subscriptionId}`, params, `mm:price-return:${row.id}`);
        ({ sub, schedule } = await subscriptionGraph(this.stripe, account));
        if (schedule || !priceReturnObserved(proposed, sub)) throw review();
      }
      await this.prisma.client.$transaction(async tx => {
        const current = await this.fence(tx, account, row.id, lease);
        if (current.paidThrough?.toISOString() !== proposed.paidThrough) throw review();
        // The contract every cycle from the boundary on is validated against. `dealReturn` on it is
        // what makes that first catalog RENEWAL also rewrite menus, AI credit and limits (Q1).
        await tx.billingSubscriptionContract.upsert({
          where: { billingAccountId_sourceAttemptId: { billingAccountId: account.id, sourceAttemptId: row.id } },
          create: { billingAccountId: account.id, sourceAttemptId: row.id,
            effectiveAt: new Date(proposed.paidThrough), snapshotJson: json(proposed.snapshot) },
          update: {} });
        await tx.packageChangeRequest.updateMany({ where: { id: proposed.dealRequestId, kind: 'SALES_DEAL' },
          data: { returnAt: new Date(proposed.paidThrough) } });
        const observedAt = new Date();
        await tx.billingAccount.update({ where: { id: account.id }, data: { activeCollectionOperationId: null,
          subscriptionState: sub.status, observedAt, version: { increment: 1 } } });
        await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'SUCCEEDED',
          resultJson: json({ ...journal, observed: true }), observedAt, errorCode: null, version: { increment: 1 } } });
        await tx.billingIssue.updateMany({ where: { stripeAccountId: account.stripeAccountId, livemode: account.livemode,
          companyId: account.companyId, kind: 'SPECIAL_PRICE_RETURN_REVIEW', referenceId: row.id },
          data: { state: 'RESOLVED', resolvedAt: observedAt, version: { increment: 1 } } });
        await tx.auditLog.create({ data: { companyId: account.companyId, actorType: 'SYSTEM',
          actorRefId: 'sales-deal-return', action: 'billing.price_return.observed', targetType: 'BillingOperation',
          targetId: row.id, requestId: row.id, result: 'SUCCESS', riskLevel: 'CRITICAL',
          metadataJson: { dealRequestId: proposed.dealRequestId, returnAt: proposed.paidThrough,
            fromPriceId: proposed.dealPriceId, toPriceId: proposed.snapshot.priceId } } });
      });
    } catch {
      // Nothing was sent and no later pass would send it: over in this same pass. Once sent, it waits for a read.
      if (!journal.startedAt) await this.end(account, row, journal, lease);
      else await this.prisma.client.$transaction(async tx => {
        await this.fence(tx, account, row.id, lease);
        await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'UNKNOWN',
          resultJson: json(journal), errorCode: 'SPECIAL_PRICE_RETURN_REVIEW', version: { increment: 1 } } });
      });
      await this.billing.issue(account.companyId, 'SPECIAL_PRICE_RETURN_REVIEW', row.id);
    }
  }

  /** The provider does not hold the swap (never sent, or sent and read as not applied): FAILED, the slot released,
   *  the review case left open, nothing sent. The subscription keeps the deal price. */
  private async end(account: BillingAccount, row: BillingOperation, journal: Journal, lease: string): Promise<void> {
    const proposed = row.proposedJson as unknown as PriceReturnProposed;
    await this.prisma.client.$transaction(async tx => {
      await this.fence(tx, account, row.id, lease);
      const observedAt = new Date();
      await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'FAILED', resultJson: json(journal),
        errorCode: 'SPECIAL_PRICE_RETURN_NOT_APPLIED', observedAt, version: { increment: 1 } } });
      await tx.billingAccount.update({ where: { id: account.id }, data: { activeCollectionOperationId: null, observedAt, version: { increment: 1 } } });
      await tx.auditLog.create({ data: { companyId: account.companyId, actorType: 'SYSTEM',
        actorRefId: 'sales-deal-return', action: 'billing.price_return.ended', targetType: 'BillingOperation',
        targetId: row.id, requestId: row.id, result: 'SUCCESS', riskLevel: 'CRITICAL',
        metadataJson: { dealRequestId: proposed.dealRequestId, returnAt: proposed.paidThrough, sent: !!journal.startedAt } } });
    });
  }
}
