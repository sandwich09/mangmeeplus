/**
 * D-P5-3 — the per-company Stripe Price an auto-renewing deal is charged at.
 *
 * The platform has never created a Price before (it only ever read the Owner's catalog ones), so
 * this is the one writer, and it is deliberately narrow: one recurring Price per deal, on the base
 * tier's own catalog product, re-read and re-validated with `assertStripePrice` against the very
 * offer the customer will be quoted. Nothing else may point `BillingSnapshot.priceId` at a Price
 * the Owner did not publish.
 *
 * Durability: the Stripe idempotency key covers a retry inside 24 h, and a `metadata.dealRequestId`
 * lookup covers everything after that — so a Price is never created twice, whatever the retry gap.
 * `priceState` is what the quote reads: only READY may be paid, PENDING/FAILED are retried by the
 * 15-minute sales sweep, and an approval whose Stripe call failed costs a delay, not the offer.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { autoRenewOf, DEAL_KIND } from '../../sales-console/domain/sales-deal.logic';
import { assertPolicyReady, assertStripePrice } from '../domain/billing-policy';
import { dealSnapshot } from '../domain/deal-offer';
import { billingOffer } from '@watchdog-bms/contracts';
import { dealOffer } from '../domain/deal-offer';
import { StripeClient, stripeId } from '../infrastructure/stripe.client';
import { BillingService } from './billing.service';

/** How many rows one sweep pass touches; the next tick picks the rest up. */
const SWEEP_BATCH_LIMIT = 50;

type DealPriceRow = { id: string; companyId: string; status: string; offerSnapshotJson: unknown;
  stripePriceId: string | null; priceState: string | null };

@Injectable()
export class SalesDealPriceService {
  constructor(private readonly prisma: PrismaService, private readonly stripe: StripeClient,
    private readonly billing: BillingService) {}

  /**
   * Make this deal's Price exist and be READY. Safe to call any number of times, from the approval
   * itself and from the sweep; it never throws at its caller — the row's `priceState` IS the answer.
   */
  async ensure(dealId: string): Promise<'READY' | 'PENDING' | 'FAILED' | 'SKIPPED'> {
    const row = await this.prisma.client.packageChangeRequest.findFirst({
      where: { id: dealId, kind: DEAL_KIND },
      select: { id: true, companyId: true, status: true, offerSnapshotJson: true, stripePriceId: true, priceState: true },
    });
    if (!row || row.status !== 'APPROVED' || row.priceState === 'READY') return 'SKIPPED';
    try {
      const priceId = await this.provision(row);
      await this.prisma.client.packageChangeRequest.updateMany({
        where: { id: row.id, kind: DEAL_KIND, status: 'APPROVED' },
        data: { stripePriceId: priceId, stripePriceCreatedAt: new Date(), priceState: 'READY' },
      });
      await this.log(row, 'sales.deal.price_ready', 'SUCCESS', { stripePriceId: priceId });
      return 'READY';
    } catch (error) {
      // FAILED is not terminal — it is "the sweep owns this now". The offer card stays shut until
      // a later pass turns it READY, so a customer never opens a Checkout without a Price.
      await this.prisma.client.packageChangeRequest.updateMany({
        where: { id: row.id, kind: DEAL_KIND, status: 'APPROVED', priceState: { not: 'READY' } },
        data: { priceState: 'FAILED' },
      });
      await this.log(row, 'sales.deal.price_failed', 'FAILED', { reason: reasonOf(error) });
      return 'FAILED';
    }
  }

  /** D-P5-3: the Price stops being sellable the moment the deal does. Idempotent and best-effort. */
  async archive(dealId: string, reason: string): Promise<boolean> {
    const row = await this.prisma.client.packageChangeRequest.findFirst({
      where: { id: dealId, kind: DEAL_KIND },
      select: { id: true, companyId: true, status: true, offerSnapshotJson: true, stripePriceId: true, priceState: true },
    });
    if (!row?.stripePriceId || !this.stripe.enabled) return false;
    try {
      await this.stripe.assertAccount();
      const price = await this.stripe.request('GET', `/prices/${row.stripePriceId}`);
      if (price.id !== row.stripePriceId || price.metadata?.dealRequestId !== row.id) throw new Error('price_binding');
      if (price.active === true) await this.stripe.request('POST', `/prices/${row.stripePriceId}`, { active: false });
      await this.prisma.client.packageChangeRequest.updateMany({ where: { id: row.id, kind: DEAL_KIND },
        data: { priceState: 'ARCHIVED' } });
      await this.log(row, 'sales.deal.price_archived', 'SUCCESS', { stripePriceId: row.stripePriceId, reason });
      return true;
    } catch (error) {
      await this.log(row, 'sales.deal.price_archive_failed', 'FAILED', { reason: reasonOf(error) });
      return false;
    }
  }

  /**
   * The 15-minute retry (D-P5-3/D-P5-6). Three queues in one pass: deals whose Price is not READY
   * yet, deals whose Price should no longer be sellable at all, and deals whose final cycle is the
   * moment to swap the subscription back to the catalog price.
   */
  async sweep(now = new Date()): Promise<{ provisioned: number; archived: number; returnsQueued: number }> {
    if (!this.stripe.enabled) return { provisioned: 0, archived: 0, returnsQueued: 0 };
    const pending = await this.prisma.client.packageChangeRequest.findMany({
      where: { kind: DEAL_KIND, status: 'APPROVED', priceState: { in: ['PENDING', 'FAILED'] } },
      select: { id: true }, take: SWEEP_BATCH_LIMIT,
    });
    let provisioned = 0;
    for (const deal of pending) if (await this.ensure(deal.id) === 'READY') provisioned += 1;
    // A deal that was cancelled, expired unpaid, or has already gone back to the catalog price
    // must not leave a live per-company Price behind for anyone to attach a subscription to.
    const stale = await this.prisma.client.packageChangeRequest.findMany({
      where: { kind: DEAL_KIND, stripePriceId: { not: null }, priceState: { not: 'ARCHIVED' },
        OR: [{ status: { in: ['CANCELLED', 'EXPIRED', 'REJECTED'] } }, { returnAt: { lte: now } }] },
      select: { id: true, status: true }, take: SWEEP_BATCH_LIMIT,
    });
    let archived = 0;
    for (const deal of stale) if (await this.archive(deal.id, `deal_${deal.status.toLowerCase()}`)) archived += 1;
    // D-P5-6 rides the same pass: the price a deal ends ON is the other half of the price it
    // started with, and both need the same Stripe client and the same 15-minute cadence.
    const returns = await this.billing.priceReturn.sweep(now);
    return { provisioned, archived, returnsQueued: returns.queued };
  }

  /** Find or create this deal's Price and prove it is exactly the offer the customer will pay. */
  private async provision(row: DealPriceRow): Promise<string> {
    const snapshot = dealSnapshot(row.offerSnapshotJson), auto = autoRenewOf(snapshot);
    if (!auto.autoRenew || !auto.cadence) throw new Error('not_auto_renew');
    if (!this.stripe.enabled) throw new Error('billing_disabled');
    const state = await this.billing.settings();
    if (!state.policy || !state.revision) throw new Error('policy_unavailable');
    assertPolicyReady(state.policy);
    const catalogPriceId = state.policy.priceIds[`${snapshot.base}:${auto.cadence}`];
    if (!catalogPriceId) throw new Error('catalog_price_missing');
    await this.stripe.assertAccount();
    // The product is the Owner's own published one. A deal may change the price, never the thing
    // being sold, so the invoice, the receipt and the tax lines stay the base tier's.
    const catalog = await this.stripe.request('GET', `/prices/${catalogPriceId}`);
    assertStripePrice(catalog, billingOffer(snapshot.base, auto.cadence, state.policy), state.policy, this.stripe.livemode, catalogPriceId);
    const productId = stripeId(catalog.product);
    if (!productId) throw new Error('catalog_product_missing');
    const offer = dealOffer(snapshot);
    const mine = (price: { metadata?: Record<string, string> }) =>
      price.metadata?.dealRequestId === row.id && price.metadata?.companyId === row.companyId;
    const existing = (await this.stripe.list('/prices', { product: productId, active: true })).filter(mine);
    if (existing.length > 1) throw new Error('duplicate_deal_price');
    const created = existing[0] ?? await this.stripe.request('POST', '/prices', {
      product: productId, currency: 'thb', unit_amount: offer.priceSatang,
      recurring: { interval: auto.cadence, interval_count: 1, usage_type: 'licensed' },
      billing_scheme: 'per_unit',
      tax_behavior: state.policy.taxTreatment === 'EXCLUSIVE_VAT_7' ? 'exclusive' : 'inclusive',
      nickname: `deal ${row.id}`, metadata: { dealRequestId: row.id, companyId: row.companyId },
    }, `mm:deal:${row.id}:price`);
    const priceId = stripeId(created);
    if (!priceId) throw new Error('price_unconfirmed');
    // Read it back rather than trusting the write: the quote will validate exactly this way, and a
    // Price that cannot pass here must never reach a customer's Checkout.
    const price = await this.stripe.request('GET', `/prices/${priceId}`);
    if (!mine(price) || stripeId(price.product) !== productId) throw new Error('price_binding');
    assertStripePrice(price, offer, state.policy, this.stripe.livemode, priceId);
    return priceId;
  }

  private async log(row: Pick<DealPriceRow, 'id' | 'companyId'>, action: string,
    result: 'SUCCESS' | 'FAILED', metadataJson: Record<string, unknown>): Promise<void> {
    // Written straight to the table, like every other billing-side system audit row, and
    // best-effort: a missing audit row must never be the reason an approved offer stays unsellable.
    await this.prisma.client.auditLog.create({ data: {
      actorType: 'SYSTEM', actorRefId: 'sales-deal-price', companyId: row.companyId, action,
      targetType: 'package_change_request', targetId: row.id, requestId: `sales-deal-price-${row.id}:${Date.now()}`,
      result, riskLevel: 'HIGH', metadataJson: metadataJson as never,
    } }).catch(() => undefined);
  }
}

/** Stripe error bodies never reach a log (stripe.client.ts); only our own short reason does. */
function reasonOf(error: unknown): string {
  return error instanceof Error && /^[a-z_]{3,60}$/.test(error.message) ? error.message : 'price_provision_failed';
}
