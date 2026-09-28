import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../common/database/prisma.service';
import { RedisRateLimitService } from '../common/security/redis-rate-limit.service';

type ObjectValue = Record<string, any>;
type Request = (path: string, method?: string, body?: unknown, extra?: Record<string, string>) => Promise<{ status: number; body: any }>;

/**
 * Purchase without setup (pr-c §6.2) through the real Nest HTTP app and PostgreSQL; only Stripe and
 * Postmark are simulated. A shop with no account email and no address buys a one-time package; Checkout
 * collects both; the payment copies them back (never into Company); billing mail follows the recipient
 * column; a code sent to a new mailbox changes it; documents are resent 3 times a day; a bounce is
 * flagged once; and a recipient changed after the quote makes it stale.
 */
export async function checkBillingNoSetup(input: { app: INestApplication; request: Request; prisma: PrismaService; companyId: string; userId: string;
  stripeAccountId: string; event: (type: string, objectId: string, eventId: string) => Promise<number>;
  drain: () => Promise<{ status: number; body: any }>; drainNotifications: () => Promise<{ status: number; body: any }>;
  reconcile: (accountId: string) => Promise<void>;
  transport: (hook?: (url: URL, init?: RequestInit) => Promise<Response | undefined> | Response | undefined) => void }) {
  const { request, companyId, userId } = input, db = input.prisma.client, cases: string[] = [];
  const run = randomUUID().replaceAll('-', ''), base = `/v1/companies/${companyId}/billing`, productId = 'prod_Pro';
  const typed = `nosetup-typed-${run}@example.test`, changed = `nosetup-new-${run}@example.test`, third = `nosetup-third-${run}@example.test`;
  const typedAddress = { city: 'คลองเตย', country: 'TH', line1: '1 ถนนที่กรอกที่หน้าชำระเงิน', line2: null, postal_code: '10110', state: 'กรุงเทพมหานคร' };
  const mail: ObjectValue[] = [], forms: Record<string, URLSearchParams[]> = { customer: [], checkout: [] };
  let customer: ObjectValue | undefined, session: ObjectValue | undefined, invoice: ObjectValue | undefined, intent: ObjectValue | undefined, charge: ObjectValue | undefined;
  let checkoutLines: ObjectValue[] = [], invoiceLines: ObjectValue[] = [], payments: ObjectValue[] = [];
  let customerReads = 0, customerEmailWrites = 0, invoiceSends = 0, failSend = false;
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const list = (data: ObjectValue[]) => json({ object: 'list', data, has_more: false });
  input.transport((url, init) => {
    const method = init?.method ?? 'GET', form = new URLSearchParams(String(init?.body ?? ''));
    if (url.origin === 'https://api.postmarkapp.com' && url.pathname === '/email') {
      const body = JSON.parse(String(init?.body)); mail.push(body);
      return json({ MessageID: randomUUID(), SubmittedAt: new Date().toISOString(), ErrorCode: 0 });
    }
    if (url.origin !== 'https://api.stripe.com') return undefined;
    const path = url.pathname.slice(3);
    if (path === '/customers' && method === 'POST') {
      forms.customer!.push(form);
      customer = { id: `cus_nosetup${run}`, object: 'customer', livemode: false, email: form.get('email'), name: form.get('name'), address: null,
        metadata: { billingAccountId: form.get('metadata[billingAccountId]') } };
      return json(customer);
    }
    if (customer && path === `/customers/${customer.id}`) {
      if (method === 'GET') { customerReads++; return json(customer); }
      if (form.has('email')) { customerEmailWrites++; customer.email = form.get('email'); }
      if (form.has('name')) customer.name = form.get('name');
      return json(customer);
    }
    if (path === '/checkout/sessions' && method === 'POST') {
      forms.checkout!.push(form);
      assert.equal(form.get('mode'), 'payment'); assert.equal(form.get('payment_method_types[0]'), 'card');
      const amount = Number(form.get('line_items[0][price_data][unit_amount]'));
      session = { id: `cs_nosetup${run}`, object: 'checkout.session', livemode: false, mode: 'payment', status: 'open', payment_status: 'unpaid', subscription: null,
        customer: form.get('customer'), client_reference_id: form.get('client_reference_id'), invoice_creation: { enabled: true }, currency: 'thb',
        metadata: { billingAccountId: form.get('metadata[billingAccountId]'), billingAttemptId: form.get('metadata[billingAttemptId]') },
        amount_total: amount, total_details: { amount_tax: 0, amount_discount: 0, amount_shipping: 0 }, created: Math.floor(Date.now() / 1000),
        expires_at: Number(form.get('expires_at')), url: `https://checkout.stripe.com/c/pay/nosetup${run}` };
      return json(session);
    }
    if (session && path === `/checkout/sessions/${session.id}`) return json(session);
    if (session && path === `/checkout/sessions/${session.id}/line_items`) return list(checkoutLines);
    if (customer && path === '/checkout/sessions' && url.searchParams.get('customer') === customer.id) return list(session ? [session] : []);
    if (customer && path === '/subscriptions' && url.searchParams.get('customer') === customer.id) return list([]);
    if (invoice && path === `/invoices/${invoice.id}`) return json(invoice);
    if (invoice && path === `/invoices/${invoice.id}/lines`) return list(invoiceLines);
    if (invoice && path === `/invoices/${invoice.id}/send` && method === 'POST') {
      if (failSend) return json({ error: { type: 'api_error' } }, 500);
      invoiceSends++; return json(invoice);
    }
    if (invoice && path === '/invoice_payments' && url.searchParams.get('invoice') === invoice.id) return list(payments);
    if (intent && path === `/payment_intents/${intent.id}`) return json(intent);
    if (charge && path === `/charges/${charge.id}`) {
      if (method === 'POST' && form.has('receipt_email')) charge.receipt_email = form.get('receipt_email');
      return json(charge);
    }
    return undefined;
  });
  const complete = () => {
    const total = session!.amount_total, now = Math.floor(Date.now() / 1000), priceId = `price_inline${run}`;
    const invoiceId = `in_nosetup${run}`, intentId = `pi_nosetup${run}`, chargeId = `ch_nosetup${run}`;
    Object.assign(session!, { status: 'complete', payment_status: 'paid', invoice: invoiceId, payment_intent: intentId,
      customer_details: { email: typed, name: 'ผู้ซื้อที่ไม่ได้ตั้งค่า', address: typedAddress } });
    // Stripe stores the Checkout email on a Customer that had none, and `customer_update.address=auto` the address.
    if (!customer!.email) customer!.email = typed;
    customer!.address = typedAddress;
    invoice = { id: invoiceId, object: 'invoice', livemode: false, customer: session!.customer, metadata: session!.metadata, status: 'paid', billing_reason: 'manual',
      collection_method: 'send_invoice', parent: null, currency: 'thb', total, amount_paid: total, amount_remaining: 0, starting_balance: 0,
      status_transitions: { paid_at: now }, created: session!.created, number: `NOSETUP-${run.slice(0, 6)}`,
      hosted_invoice_url: 'https://invoice.stripe.com/i/synthetic-nosetup', invoice_pdf: 'https://invoice.stripe.com/i/synthetic-nosetup/pdf' };
    checkoutLines = [{ quantity: 1, currency: 'thb', amount_total: total, amount_tax: 0, amount_discount: 0,
      price: { id: priceId, product: productId, type: 'one_time', recurring: null, active: false, livemode: false, currency: 'thb', unit_amount: total } }];
    invoiceLines = [{ parent: { type: 'invoice_item_details', invoice_item_details: { invoice_item: `ii_nosetup${run}`, subscription: null, proration: false } },
      pricing: { price_details: { price: priceId, product: productId } }, amount: total, currency: 'thb', livemode: false, quantity: 1 }];
    charge = { id: chargeId, object: 'charge', livemode: false, status: 'succeeded', paid: true, captured: true, currency: 'thb', amount: total, customer: session!.customer,
      payment_intent: intentId, payment_method_details: { type: 'card' }, amount_refunded: 0, disputed: false, receipt_email: typed,
      receipt_url: 'https://pay.stripe.com/receipts/synthetic-nosetup' };
    intent = { id: intentId, livemode: false, status: 'succeeded', currency: 'thb', amount_received: total, customer: session!.customer, latest_charge: charge };
    payments = [{ object: 'invoice_payment', livemode: false, status: 'paid', invoice: invoiceId, payment: { type: 'payment_intent', payment_intent: intentId },
      amount_paid: total, currency: 'thb' }];
  };
  const changeRecipient = async (email: string, key: string) => {
    const requestKey = randomUUID(), sent = mail.length;
    const challenge = await request(`${base}/recipient/otp/request`, 'POST', { email, requestKey });
    assert.equal(challenge.status, 202, JSON.stringify(challenge.body)); assert.equal(challenge.body.email, email); assert.equal(mail.length, sent + 1);
    assert.equal(mail.at(-1)!.To, email); assert.equal(mail.at(-1)!.Tag, 'email_verification');
    const code = /\b(\d{6})\b/.exec(String(mail.at(-1)!.TextBody))?.[1]; assert.ok(code);
    const replay = await request(`${base}/recipient/otp/request`, 'POST', { email, requestKey });
    assert.equal(replay.body.challengeId, challenge.body.challengeId); assert.equal(mail.length, sent + 1, 'a replayed request key sends no second code');
    const wrong = await request(`${base}/recipient/otp/confirm`, 'POST', { challengeId: challenge.body.challengeId, code: code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.body.code, 'EMAIL_OTP_INVALID', JSON.stringify(wrong.body));
    const proof = await request(`${base}/recipient/otp/confirm`, 'POST', { challengeId: challenge.body.challengeId, code });
    assert.equal(proof.status, 200, JSON.stringify(proof.body)); assert.equal(proof.body.email, email);
    const preview = await request(`${base}/recipient/preview`, 'POST', { recipientProofId: proof.body.recipientProofId });
    assert.equal(preview.status, 200, JSON.stringify(preview.body)); assert.equal(preview.body.source, 'CUSTOMER_OTP'); assert.equal(preview.body.newEmail, email);
    const again = await request(`${base}/recipient/preview`, 'POST', { recipientProofId: proof.body.recipientProofId });
    assert.equal(again.body.code, 'BILLING_RECIPIENT_PROOF_INVALID', JSON.stringify(again.body));
    const submitted = await request(`${base}/recipient/${preview.body.id}/submit`, 'POST', { expectedVersion: preview.body.version,
      previewHash: preview.body.previewHash, accepted: true }, { 'idempotency-key': key });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    return preview.body.id as string;
  };
  try {
    // 1. No account email, no address: quote and Checkout still open.
    await db.company.update({ where: { id: companyId }, data: { addressJson: {}, registeredName: null } });
    await db.user.update({ where: { id: userId }, data: { email: null, emailVerifiedAt: null } });
    const quote = await request(`${base}/quote`, 'POST', { offerKey: 'PRO_999', interval: 'year', purchaseMode: 'CARD_ONCE' });
    assert.equal(quote.status, 200, JSON.stringify(quote.body)); assert.equal(quote.body.billingEmail, null);
    assert.deepEqual(quote.body.billingProfile.missingFields, ['line1', 'subdistrict', 'district', 'province', 'postalCode']);
    const checkout = await request(`${base}/checkout`, 'POST', { quoteId: quote.body.quoteId, consentRevision: quote.body.consentRevision, accepted: true, channel: 'line' },
      { 'idempotency-key': `nosetup-checkout-${run}` });
    assert.equal(checkout.status, 200, JSON.stringify(checkout.body)); assert.equal(checkout.body.state, 'OPEN');
    const created = forms.customer![0]!, sessionForm = forms.checkout![0]!;
    assert.equal(forms.customer!.length, 1); assert.equal(created.has('email'), false); assert.equal(created.has('address[line1]'), false);
    assert.equal(created.get('name'), 'Synthetic billing company');
    assert.equal(sessionForm.get('customer_update[address]'), 'auto'); assert.equal(sessionForm.get('billing_address_collection'), 'required');
    assert.match(sessionForm.get('cancel_url')!, /\?attempt=[0-9a-f-]{36}&checkout=canceled$/); assert.doesNotMatch(sessionForm.get('success_url')!, /checkout=canceled/);
    assert.equal((await request(`${base}/attempts/${checkout.body.attemptId}`)).body.paymentState, 'PENDING');
    cases.push('no-email-no-address-quote-and-checkout-open-customer-without-email-or-address-address-auto-cancel-marker');

    // 2. Checkout collects both; the verified payment copies them back, never into Company.
    complete();
    assert.equal(await input.event('checkout.session.completed', session!.id, `evt_nosetup${run}`), 200);
    const drained = await input.drain(); assert.equal(drained.body.failed, 0, JSON.stringify(drained.body));
    const account = await db.billingAccount.findFirstOrThrow({ where: { companyId, stripeAccountId: input.stripeAccountId } });
    const row = await db.billingInvoice.findFirstOrThrow({ where: { billingAccountId: account.id } });
    assert.equal(row.applyStatus, 'APPLIED'); assert.equal(account.recipientEmail, typed); assert.equal(account.recipientSource, 'STRIPE_CHECKOUT');
    assert.deepEqual(account.checkoutAddressJson, typedAddress);
    assert.deepEqual((await db.company.findUniqueOrThrow({ where: { id: companyId } })).addressJson, {});
    const reads = customerReads;
    await input.reconcile(account.id); await input.reconcile(account.id);
    assert.equal(customerReads, reads, 'a replay reads no Customer once the recipient is stored');
    assert.equal(await db.auditLog.count({ where: { companyId, action: 'billing.recipient.captured' } }), 1);
    const status = await request(base);
    assert.deepEqual(status.body.recipient, { email: typed, source: 'STRIPE_CHECKOUT', bouncedAt: null, canChange: true });
    assert.deepEqual(status.body.checkoutAddress, { line1: typedAddress.line1, line2: null, subdistrict: '', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' });
    const history = await request(`${base}/history`); assert.equal(history.body.items[0].documentActions.canResend, true);
    cases.push('paid-one-time-captures-checkout-email-and-address-set-if-null-replay-without-provider-read');

    // 3. The paid mail goes to the document recipient, although no owner has an email.
    await input.drainNotifications(); await input.drainNotifications();
    assert.equal((await db.outboxEvent.findUniqueOrThrow({ where: { eventKey: `billing:notice-email:${row.id}:recipient` } })).status, 'PUBLISHED');
    assert.ok(mail.some(m => m.To === typed && m.Tag === 'billing_status'), 'paid mail to the Checkout recipient');
    cases.push('paid-mail-to-document-recipient-without-owner-email');

    // 4. A code sent to a new mailbox changes Stripe and the column; the old recipient and plan managers are told.
    const operationId = await changeRecipient(changed, `nosetup-recipient-${run}`);
    await input.reconcile(account.id);
    assert.equal(customerEmailWrites, 1); assert.equal(customer!.email, changed);
    let stored = await db.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
    assert.equal(stored.recipientEmail, changed); assert.equal(stored.recipientSource, 'CUSTOMER_OTP');
    assert.ok(await db.outboxEvent.findUnique({ where: { eventKey: `billing:recipient-changed:${operationId}` } }));
    await input.drainNotifications();
    const notice = mail.filter(m => m.To === typed && m.Tag === 'billing_status').at(-1)!;
    assert.equal(notice.Subject, 'อีเมลรับเอกสารของบริษัทถูกเปลี่ยน');
    assert.equal(`${notice.TextBody}${notice.HtmlBody}`.includes(changed), false, 'the old mailbox never learns the new address');
    assert.equal(await db.notificationEvent.count({ where: { companyId, title: 'เปลี่ยนอีเมลรับเอกสารแล้ว' } }), 1);
    cases.push('recipient-otp-request-replay-wrong-code-proof-once-review-submit-reconcile-old-recipient-and-plan-managers-told');

    // 5. Resend: a Stripe failure is not counted; three a day; the receipt moves only when its email differs.
    const limits = input.app.get(RedisRateLimitService), budget = () => limits.inspect('billing-resend', row.id, 3, 86_400);
    failSend = true;
    const failed = await request(`${base}/documents/${row.id}/resend`, 'POST', {});
    assert.equal(failed.status, 409, JSON.stringify(failed.body)); assert.equal(failed.body.code, 'BILLING_RESEND_UNAVAILABLE');
    assert.equal((await budget()).count, 0); failSend = false;
    const resent: Array<{ status: number; body: any }> = [];
    for (let i = 0; i < 3; i++) resent.push(await request(`${base}/documents/${row.id}/resend`, 'POST', {}));
    assert.deepEqual(resent.map(r => r.status), [200, 200, 200], JSON.stringify(resent.map(r => r.body)));
    assert.deepEqual(resent.map(r => [r.body.invoiceSent, r.body.receiptUpdated, r.body.recipientEmail, r.body.remainingToday]),
      [[true, true, changed, 2], [true, false, changed, 1], [true, false, changed, 0]]);
    const fourth = await request(`${base}/documents/${row.id}/resend`, 'POST', {});
    assert.equal(fourth.status, 429); assert.equal(fourth.body.code, 'BILLING_RESEND_LIMIT'); assert.ok(fourth.body.retryAfterSeconds > 0);
    assert.equal(invoiceSends, 3); assert.equal(charge!.receipt_email, changed);
    assert.equal(await db.auditLog.count({ where: { companyId, action: 'billing.document.resent' } }), 3);
    await input.drainNotifications();
    const resendOutbox = await db.outboxEvent.findMany({ where: { companyId, eventKey: { startsWith: `billing:notice-email:${row.id}:resend:` } } });
    assert.equal(resendOutbox.length, 3); assert.deepEqual(resendOutbox.map(o => o.status), ['PUBLISHED', 'PUBLISHED', 'PUBLISHED']);
    assert.equal(mail.filter(m => m.To === changed && m.Tag === 'billing_status').length, 3);
    cases.push('resend-provider-failure-uncounted-three-per-day-receipt-email-once-our-mail-each-time');

    // 6. A suppressed recipient is flagged once and told once; a new recipient clears it.
    const last = await db.emailSendAttempt.findFirstOrThrow({ where: { recipient: changed, purpose: 'billing_status' }, orderBy: { createdAt: 'desc' } });
    await db.emailSendAttempt.update({ where: { id: last.id }, data: { status: 'SUPPRESSED', suppressedAt: new Date() } });
    await db.emailSuppression.create({ data: { providerServerId: last.providerServerId, stream: last.stream, recipient: changed, reason: 'HardBounce' } });
    await input.drainNotifications();
    stored = await db.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
    assert.ok(stored.recipientBouncedAt); assert.ok(stored.recipientBounceNotifiedAt);
    const bounceEvents = () => db.notificationEvent.count({ where: { companyId, title: 'อีเมลรับเอกสารส่งไม่ถึง' } });
    assert.equal(await bounceEvents(), 1); await input.drainNotifications(); assert.equal(await bounceEvents(), 1);
    assert.notEqual((await request(base)).body.recipient.bouncedAt, null);
    assert.equal((await request(`${base}/documents/${row.id}/resend`, 'POST', {})).body.code, 'BILLING_RECIPIENT_BOUNCED');
    await db.emailVerificationToken.updateMany({ where: { userId, proofKind: 'BILLING_RECIPIENT' }, data: { createdAt: new Date(Date.now() - 61_000) } });
    await changeRecipient(third, `nosetup-recipient-third-${run}`); await input.reconcile(account.id);
    stored = await db.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
    assert.equal(stored.recipientEmail, third); assert.equal(stored.recipientBouncedAt, null); assert.equal(stored.recipientBounceNotifiedAt, null);
    cases.push('recipient-bounce-flags-and-notifies-once-and-a-new-recipient-clears-it');

    // 7. A recipient changed after the quote makes it stale, judged against the column.
    const repeat = await request(`${base}/quote`, 'POST', { offerKey: 'PRO_999', interval: 'year', purchaseMode: 'CARD_ONCE' });
    assert.equal(repeat.status, 200, JSON.stringify(repeat.body)); assert.equal(repeat.body.billingEmail, third);
    await db.billingAccount.update({ where: { id: account.id }, data: { recipientEmail: `nosetup-drift-${run}@example.test` } });
    const stale = await request(`${base}/checkout`, 'POST', { quoteId: repeat.body.quoteId, consentRevision: repeat.body.consentRevision, accepted: true, channel: 'web' },
      { 'idempotency-key': `nosetup-drift-${run}` });
    assert.equal(stale.body.code, 'BILLING_QUOTE_STALE', JSON.stringify(stale.body));
    await db.billingAccount.update({ where: { id: account.id }, data: { recipientEmail: third } });
    cases.push('recipient-drift-after-quote-is-quote-stale');
    return cases;
  } finally {
    input.transport(undefined);
    const recipients = [typed, changed, third, `nosetup-drift-${run}@example.test`];
    await db.emailSendAttempt.deleteMany({ where: { recipient: { in: recipients } } });
    await db.emailSuppression.deleteMany({ where: { recipient: { in: recipients } } });
  }
}
