import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billingOffer, BILLING_DRAFT_POLICY, type BillingOffer } from '@watchdog-bms/contracts';
import { paidPackageCheckoutEvidence } from './paid-checkout-invoice';

type Input = Parameters<typeof paidPackageCheckoutEvidence>[0];
function fixture(): Input {
  const metadata = { billingAttemptId: 'attempt-repeat', billingAccountId: 'account-repeat' };
  const amount = 999000, created = 1789280740, paidAt = created + 3;
  return { attemptId: metadata.billingAttemptId, billingAccountId: metadata.billingAccountId, customerId: 'cus_test', productId: 'prod_test', livemode: false,
    snapshot: { quote: { offer: billingOffer('PRO_999', 'year'), totalSatang: amount, taxSatang: 0 }, policy: BILLING_DRAFT_POLICY, priceId: 'price_recurring' } as Input['snapshot'],
    session: { id: 'cs_test', object: 'checkout.session', livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid', subscription: null,
      customer: 'cus_test', client_reference_id: metadata.billingAttemptId, metadata: { ...metadata }, invoice: 'in_test', payment_intent: 'pi_test',
      invoice_creation: { enabled: true }, currency: 'thb', amount_total: amount, total_details: { amount_tax: 0, amount_discount: 0, amount_shipping: 0 }, created },
    invoice: { id: 'in_test', object: 'invoice', livemode: false, customer: 'cus_test', metadata: { ...metadata }, status: 'paid', billing_reason: 'manual',
      collection_method: 'send_invoice', parent: null, currency: 'thb', total: amount, amount_paid: amount, amount_remaining: 0, starting_balance: 0,
      status_transitions: { paid_at: paidAt } },
    checkoutLines: [{ quantity: 1, currency: 'thb', amount_total: amount, amount_tax: 0, amount_discount: 0,
      price: { id: 'price_inline', product: 'prod_test', type: 'one_time', active: false, recurring: null, livemode: false, currency: 'thb', unit_amount: amount } }],
    invoiceLines: [{ parent: { type: 'invoice_item_details', invoice_item_details: { invoice_item: 'ii_test', subscription: null, proration: false } },
      pricing: { price_details: { price: 'price_inline', product: 'prod_test' } }, amount, currency: 'thb', livemode: false, quantity: 1, period: { start: paidAt, end: paidAt } }],
    payments: [{ object: 'invoice_payment', livemode: false, status: 'paid', invoice: 'in_test', payment: { type: 'payment_intent', payment_intent: 'pi_test' }, amount_paid: amount, currency: 'thb' }],
    intent: { id: 'pi_test', livemode: false, status: 'succeeded', currency: 'thb', amount_received: amount, customer: 'cus_test', latest_charge: 'ch_test' },
    charge: { id: 'ch_test', livemode: false, status: 'succeeded', paid: true, captured: true, currency: 'thb', amount, customer: 'cus_test',
      payment_intent: 'pi_test', payment_method_details: { type: 'card' }, amount_refunded: 0, disputed: false } };
}
test('actual sandbox shape: manual/send_invoice, inactive inline price and zero-length line period are valid only for bound Checkout', () => {
  const input = fixture(), evidence = paidPackageCheckoutEvidence(input);
  assert.equal(evidence.invoiceId, 'in_test'); assert.equal(evidence.totalSatang, 999000);
  assert.equal(evidence.paidAt.getTime(), input.invoice.status_transitions.paid_at * 1000);
  assert.equal('periodEnd' in evidence, false, 'payment evidence must not invent service time from a one-time line');
  assert.deepEqual(evidence, paidPackageCheckoutEvidence(input));
  input.charge.amount_refunded = 100; input.charge.disputed = true;
  const flagged = paidPackageCheckoutEvidence(input); assert.equal(flagged.refundedSatang, 100); assert.equal(flagged.disputed, true);
});
test('reject unrelated/manual invoices, alternate customer/account/attempt/price and altered payment evidence', () => {
  const mutations: ((input: Input) => void)[] = [
    i => { i.session.status = 'open'; }, i => { i.session.mode = 'subscription'; }, i => { i.session.subscription = 'sub_wrong'; },
    i => { i.session.metadata.billingAttemptId = 'other'; }, i => { i.invoice.metadata.billingAccountId = 'other'; },
    i => { i.session.client_reference_id = 'other'; }, i => { i.invoice.customer = 'cus_other'; },
    i => { i.session.invoice = 'in_other'; }, i => { i.invoice.paid_out_of_band = true; }, i => { i.invoice.starting_balance = -999000; },
    i => { i.invoice.amount_paid = 0; }, i => { i.session.total_details.amount_tax = 7; }, i => { i.invoice.total_taxes = [{ amount: 7 }]; },
    i => { i.checkoutLines[0]!.price.product = 'prod_other'; }, i => { i.invoiceLines[0]!.pricing.price_details.price = 'price_other'; },
    i => { i.invoiceLines[0]!.quantity = 2; }, i => { i.invoiceLines[0]!.parent.invoice_item_details.proration = true; },
    i => { i.payments[0]!.payment.payment_intent = 'pi_other'; }, i => { i.payments.push(i.payments[0]!); },
    i => { i.intent.status = 'requires_action'; }, i => { i.charge.customer = 'cus_other'; }, i => { i.charge.livemode = true; },
    i => { i.charge.captured = false; }, i => { delete i.charge.amount_refunded; }, i => { delete i.charge.disputed; },
    // Phase 6 opened ENTERPRISE_1999 for sale, so the unsellable key here is the trial tier. The
    // cast is the point: a stored snapshot is untrusted input and may hold a key no longer sold.
    i => { i.snapshot.quote.offer = { ...i.snapshot.quote.offer, offerKey: 'FREE_TRIAL_15' as BillingOffer['offerKey'] }; },
  ];
  for (const mutate of mutations) { const input = fixture(); mutate(input); assert.throws(() => paidPackageCheckoutEvidence(input)); }
});

test('upgrade verifies the paid difference while retaining the full recurring offer price', () => {
  const input = fixture(), amount = 250000;
  input.snapshot.upgrade = { amountSatang: amount } as NonNullable<Input['snapshot']['upgrade']>;
  input.snapshot.quote.totalSatang = amount;
  input.session.amount_total = amount; input.invoice.total = amount; input.invoice.amount_paid = amount;
  input.checkoutLines[0]!.price.unit_amount = amount; input.checkoutLines[0]!.amount_total = amount;
  input.invoiceLines[0]!.amount = amount; input.payments[0]!.amount_paid = amount;
  input.intent.amount_received = amount; input.charge.amount = amount;
  assert.equal(paidPackageCheckoutEvidence(input).totalSatang, amount);
  assert.equal(input.snapshot.quote.offer.priceSatang, 999000);
  delete input.snapshot.upgrade; assert.throws(() => paidPackageCheckoutEvidence(input));
});

test('PromptPay proof is bound to a QR charge and rejects a card charge', () => {
  const input = fixture();
  input.paymentMethod = 'promptpay';
  input.snapshot.quote.purchaseMode = 'PROMPTPAY_ONCE';
  assert.throws(() => paidPackageCheckoutEvidence(input));
  input.charge.payment_method_details.type = 'promptpay';
  assert.equal(paidPackageCheckoutEvidence(input).invoiceId, 'in_test');
  input.session.payment_status = 'unpaid';
  assert.throws(() => paidPackageCheckoutEvidence(input));
});
