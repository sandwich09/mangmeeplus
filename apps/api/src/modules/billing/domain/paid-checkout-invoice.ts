import type { BillingSnapshot } from '../application/billing.service';
import { stripeId, type StripeObject } from '../infrastructure/stripe.client';
import { billingError, hashBilling, paidVariant } from './billing-policy';

export type PaidCheckoutEvidence = {
  invoiceId: string; customerId: string; chargeId: string; checkoutSessionId: string; paidAt: Date;
  number: string | null; totalSatang: number; taxSatang: number; refundedSatang: number; disputed: boolean;
  feeSatang: number | null; evidenceHash: string;
};

/** Full-package payment only. The caller must separately confirm collection rescheduling before granting. */
export function paidPackageCheckoutEvidence(input: {
  session: StripeObject; invoice: StripeObject; checkoutLines: StripeObject[]; invoiceLines: StripeObject[];
  payments: StripeObject[]; intent: StripeObject; charge: StripeObject; snapshot: BillingSnapshot;
  attemptId: string; billingAccountId: string; customerId: string; productId: string; livemode: boolean; paymentMethod?: 'card' | 'promptpay';
}): PaidCheckoutEvidence {
  const { session, invoice, checkoutLines, invoiceLines, payments, intent, charge, snapshot,
    attemptId, billingAccountId, customerId, productId, livemode } = input;
  const reject = () => { throw billingError('BILLING_CHECKOUT_INVOICE_MISMATCH', 'หลักฐานรายการซื้อเพิ่มต้องตรวจสอบ กรุณาดูสถานะรายการเดิม'); };
  paidVariant(snapshot.quote.offer.offerKey, snapshot.quote.offer.interval);
  const bound = (value: StripeObject) => value.metadata?.billingAttemptId === attemptId && value.metadata?.billingAccountId === billingAccountId;
  const total = snapshot.quote.totalSatang, tax = snapshot.quote.taxSatang;
  const chargedPrice = snapshot.upgrade?.amountSatang ?? snapshot.quote.offer.priceSatang;
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(tax) || tax < 0 ||
      !/^prod_[a-zA-Z0-9]+$/.test(productId) || session.object !== 'checkout.session' || session.livemode !== livemode ||
      session.mode !== 'payment' || session.status !== 'complete' || session.payment_status !== 'paid' ||
      session.subscription !== null || stripeId(session.customer) !== customerId || session.client_reference_id !== attemptId ||
      !bound(session) || stripeId(session.invoice) !== invoice.id || stripeId(session.payment_intent) !== intent.id ||
      session.invoice_creation?.enabled !== true || session.currency !== 'thb' || session.amount_total !== total ||
      session.total_details?.amount_tax !== tax || session.total_details?.amount_discount !== 0 || session.total_details?.amount_shipping !== 0 ||
      invoice.object !== 'invoice' || invoice.livemode !== livemode || stripeId(invoice.customer) !== customerId || !bound(invoice) ||
      invoice.status !== 'paid' || invoice.billing_reason !== 'manual' || invoice.collection_method !== 'send_invoice' || invoice.parent !== null ||
      invoice.currency !== 'thb' || invoice.total !== total || invoice.amount_paid !== total || invoice.amount_remaining !== 0 ||
      invoice.paid_out_of_band === true || invoice.starting_balance !== 0 ||
      (invoice.pre_payment_credit_notes_amount ?? 0) !== 0 || (invoice.total_discount_amounts?.length ?? 0) !== 0 ||
      !Number.isSafeInteger(invoice.status_transitions?.paid_at) || !Number.isSafeInteger(session.created) || invoice.status_transitions.paid_at < session.created ||
      checkoutLines.length !== 1 || invoiceLines.length !== 1 || payments.length !== 1) reject();
  const item = checkoutLines[0]!, line = invoiceLines[0]!, price = item.price, details = line.parent?.invoice_item_details;
  // Stripe's inline Checkout price is one_time and inactive, and its invoice line period may be
  // zero-length. Neither field represents the purchased service interval or a recurring price.
  if (item.quantity !== 1 || item.currency !== 'thb' || item.amount_total !== total || item.amount_tax !== tax || item.amount_discount !== 0 ||
      !price || price.type !== 'one_time' || price.recurring !== null || price.livemode !== livemode || price.currency !== 'thb' ||
      price.unit_amount !== chargedPrice || stripeId(price.product) !== productId ||
      typeof price.id !== 'string' || !/^price_[a-zA-Z0-9]+$/.test(price.id) ||
      line.parent?.type !== 'invoice_item_details' || !details || details.proration !== false || details.subscription !== null ||
      typeof details.invoice_item !== 'string' || !/^ii_[a-zA-Z0-9]+$/.test(details.invoice_item) ||
      line.pricing?.price_details?.price !== price.id || stripeId(line.pricing?.price_details?.product) !== productId ||
      line.currency !== 'thb' || line.livemode !== livemode || line.quantity !== 1 || line.amount !== chargedPrice ||
      (line.discount_amounts?.length ?? 0) !== 0 || (line.pretax_credit_amounts?.length ?? 0) !== 0) reject();
  const payment = payments[0]!;
  if (payment.object !== 'invoice_payment' || payment.livemode !== livemode || payment.status !== 'paid' || stripeId(payment.invoice) !== invoice.id ||
      payment.payment?.type !== 'payment_intent' || stripeId(payment.payment.payment_intent) !== intent.id || payment.amount_paid !== total || payment.currency !== 'thb' ||
      intent.livemode !== livemode || intent.status !== 'succeeded' || intent.currency !== 'thb' || intent.amount_received !== total ||
      stripeId(intent.customer) !== customerId || stripeId(intent.latest_charge) !== charge.id ||
      charge.livemode !== livemode || charge.status !== 'succeeded' || charge.paid !== true || charge.captured !== true ||
      charge.currency !== 'thb' || charge.amount !== total || stripeId(charge.customer) !== customerId || stripeId(charge.payment_intent) !== intent.id ||
      charge.payment_method_details?.type !== (input.paymentMethod ?? 'card') || !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0 || charge.amount_refunded > total ||
      typeof charge.disputed !== 'boolean') reject();
  const invoiceTax = Array.isArray(invoice.total_taxes) ? invoice.total_taxes.reduce((sum: number, entry: StripeObject) => sum + entry.amount, 0) : 0;
  if (invoiceTax !== tax) reject();
  const balance = charge.balance_transaction, paidAt = new Date(invoice.status_transitions.paid_at * 1000);
  if (!Number.isSafeInteger(paidAt.getTime())) reject();
  return { invoiceId: invoice.id, customerId, chargeId: charge.id, checkoutSessionId: session.id, paidAt,
    number: typeof invoice.number === 'string' ? invoice.number : null, totalSatang: total, taxSatang: tax,
    refundedSatang: charge.amount_refunded, disputed: charge.disputed,
    feeSatang: balance && typeof balance === 'object' && balance.currency === 'thb' && Number.isSafeInteger(balance.fee) ? balance.fee : null,
    evidenceHash: hashBilling([attemptId, billingAccountId, customerId, session.id, invoice.id, charge.id, price.id, productId, total, tax, paidAt]) };
}
