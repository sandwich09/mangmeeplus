import type { BillingSnapshot } from '../application/billing.service';
import { stripeId, type StripeObject } from '../infrastructure/stripe.client';
import { billingError, hashBilling, paidVariant } from './billing-policy';

export type PaidInvoiceEvidence = {
  kind: 'INITIAL' | 'RENEWAL';
  invoiceId: string; subscriptionId: string; customerId: string; chargeId: string;
  number: string | null; totalSatang: number; taxSatang: number; paidSatang: number;
  refundedSatang: number; disputed: boolean; feeSatang: number | null; periodStart: Date; periodEnd: Date; evidenceHash: string;
};

export function paidInvoiceEvidence(invoice: StripeObject, subscription: StripeObject, lines: StripeObject[],
  payments: StripeObject[], intent: StripeObject, charge: StripeObject, snapshot: BillingSnapshot, livemode: boolean): PaidInvoiceEvidence {
  const reject = () => { throw billingError('BILLING_INVOICE_MISMATCH', 'หลักฐานการชำระเงินต้องตรวจสอบเพิ่มเติม'); };
  paidVariant(snapshot.quote.offer.offerKey, snapshot.quote.offer.interval);
  const subscriptionId = stripeId(invoice.parent?.subscription_details?.subscription);
  const customerId = stripeId(invoice.customer);
  if (!subscriptionId || !customerId || subscriptionId !== subscription.id || customerId !== stripeId(subscription.customer) ||
      invoice.object !== 'invoice' || invoice.livemode !== livemode || subscription.livemode !== livemode ||
      invoice.status !== 'paid' || invoice.collection_method !== 'charge_automatically' || invoice.currency !== 'thb' ||
      !['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason) || invoice.paid_out_of_band === true ||
      invoice.amount_remaining !== 0 || invoice.total !== snapshot.quote.totalSatang || invoice.amount_paid !== invoice.total ||
      !Number.isSafeInteger(invoice.total) || invoice.total <= 0 || invoice.starting_balance !== 0 ||
      (invoice.pre_payment_credit_notes_amount ?? 0) !== 0 || (invoice.total_discount_amounts?.length ?? 0) > 0 ||
      lines.length !== 1 || payments.length !== 1) reject();
  const line = lines[0]!, payment = payments[0]!;
  const details = line.parent?.subscription_item_details;
  // A schedule price transition replaces subscription items. Historical paid lines remain
  // bound to their original item; verify their invoice/subscription/price instead of today's item.
  if (line.parent?.type !== 'subscription_item_details' || details?.proration !== false ||
      typeof details.subscription_item !== 'string' || !/^si_[a-zA-Z0-9]+$/.test(details.subscription_item) ||
      stripeId(details.subscription) !== subscriptionId || line.pricing?.price_details?.price !== snapshot.priceId ||
      line.currency !== 'thb' || line.quantity !== 1 || line.livemode !== livemode ||
      (line.discount_amounts?.length ?? 0) > 0 || (line.pretax_credit_amounts?.length ?? 0) > 0 ||
      !Number.isSafeInteger(line.period?.start) || !Number.isSafeInteger(line.period?.end) || line.period.start >= line.period.end) reject();
  if (payment.object !== 'invoice_payment' || payment.livemode !== livemode || payment.status !== 'paid' || stripeId(payment.invoice) !== invoice.id ||
      payment.payment?.type !== 'payment_intent' || stripeId(payment.payment.payment_intent) !== intent.id ||
      payment.amount_paid !== invoice.total || payment.currency !== 'thb' || intent.livemode !== livemode || intent.status !== 'succeeded' ||
      intent.currency !== 'thb' || intent.amount_received !== invoice.total || stripeId(intent.customer) !== customerId ||
      stripeId(intent.latest_charge) !== charge.id || charge.livemode !== livemode || charge.status !== 'succeeded' || !charge.paid || !charge.captured ||
      charge.currency !== 'thb' || charge.amount !== invoice.total || stripeId(charge.customer) !== customerId ||
      stripeId(charge.payment_intent) !== intent.id || charge.payment_method_details?.type !== 'card') reject();
  const taxSatang = Array.isArray(invoice.total_taxes) ? invoice.total_taxes.reduce((sum: number, tax: StripeObject) => sum + tax.amount, 0) : 0;
  if (taxSatang !== snapshot.quote.taxSatang) reject();
  const balance = charge.balance_transaction;
  return { kind: invoice.billing_reason === 'subscription_create' ? 'INITIAL' : 'RENEWAL',
    invoiceId: invoice.id, subscriptionId: subscriptionId!, customerId: customerId!, chargeId: charge.id,
    number: typeof invoice.number === 'string' ? invoice.number : null, totalSatang: invoice.total, taxSatang, paidSatang: invoice.amount_paid,
    refundedSatang: Number.isSafeInteger(charge.amount_refunded) ? charge.amount_refunded : 0, disputed: charge.disputed === true,
    feeSatang: balance && typeof balance === 'object' && balance.currency === 'thb' && Number.isSafeInteger(balance.fee) ? balance.fee : null,
    periodStart: new Date(line.period.start * 1000), periodEnd: new Date(line.period.end * 1000),
    evidenceHash: hashBilling([invoice.id, subscriptionId, customerId, charge.id, invoice.total, invoice.amount_paid, snapshot.priceId, line.period.start, line.period.end]),
  };
}

export function termProjectionHash(term: { tierKey: string; branchLimit: number; employeeLimit: number; monthlySlipLimit: number; termEndsAt: Date; billingReceiptAccountId?: string | null } | null): string {
  return hashBilling(term ? [term.tierKey, term.branchLimit, term.employeeLimit, term.monthlySlipLimit, term.termEndsAt.toISOString(), term.billingReceiptAccountId ?? null] : null);
}
