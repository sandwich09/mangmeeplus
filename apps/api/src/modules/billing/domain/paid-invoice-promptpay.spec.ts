import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BILLING_DRAFT_POLICY, billingOffer } from '@watchdog-bms/contracts';
import { paidInvoiceEvidence } from './paid-invoice';
import type { BillingSnapshot } from '../application/billing.service';
import type { StripeObject } from '../infrastructure/stripe.client';

test('a send_invoice PromptPay renewal grants only a bound paid period', () => {
  const start = 1790000000, end = start + 30 * 86400, amount = 49900;
  const offer = billingOffer('BASIC_499', 'month');
  const snapshot = { priceId: 'price_test', policy: BILLING_DRAFT_POLICY,
    quote: { purchaseMode: 'PROMPTPAY_RENEW', offer, totalSatang: amount, taxSatang: 0 } } as BillingSnapshot;
  const sub: StripeObject = { id: 'sub_test', customer: 'cus_test', livemode: false, collection_method: 'send_invoice',
    payment_settings: { payment_method_types: ['promptpay'] } };
  const invoice: StripeObject = { id: 'in_test', object: 'invoice', livemode: false, customer: 'cus_test',
    parent: { subscription_details: { subscription: sub.id } }, status: 'paid', collection_method: 'send_invoice',
    currency: 'thb', billing_reason: 'subscription_create', amount_remaining: 0, total: amount, amount_paid: amount, starting_balance: 0 };
  const line: StripeObject = { parent: { type: 'subscription_item_details', subscription_item_details: {
    subscription: sub.id, subscription_item: 'si_test', proration: false } }, pricing: { price_details: { price: snapshot.priceId } },
    currency: 'thb', quantity: 1, livemode: false, period: { start, end } };
  const payment: StripeObject = { object: 'invoice_payment', livemode: false, status: 'paid', invoice: invoice.id,
    payment: { type: 'payment_intent', payment_intent: 'pi_test' }, amount_paid: amount, currency: 'thb' };
  const intent: StripeObject = { id: 'pi_test', customer: 'cus_test', livemode: false, status: 'succeeded',
    currency: 'thb', amount_received: amount, latest_charge: 'ch_test' };
  const charge: StripeObject = { id: 'ch_test', customer: 'cus_test', payment_intent: 'pi_test', livemode: false,
    status: 'succeeded', paid: true, captured: true, currency: 'thb', amount, amount_refunded: 0, disputed: false,
    payment_method_details: { type: 'promptpay' } };
  const evidence = paidInvoiceEvidence(invoice, sub, [line], [payment], intent, charge, snapshot, false);
  assert.equal(evidence.kind, 'RENEWAL');
  assert.equal(evidence.periodStart.getTime(), start * 1000);
  assert.equal(evidence.periodEnd.getTime(), end * 1000);
  charge.payment_method_details.type = 'card';
  assert.throws(() => paidInvoiceEvidence(invoice, sub, [line], [payment], intent, charge, snapshot, false));
  charge.payment_method_details.type = 'promptpay';
  invoice.collection_method = 'charge_automatically';
  assert.throws(() => paidInvoiceEvidence(invoice, sub, [line], [payment], intent, charge, snapshot, false));
});
