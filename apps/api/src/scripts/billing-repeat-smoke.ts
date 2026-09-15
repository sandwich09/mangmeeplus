import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../common/database/prisma.service';
import type { BillingReconcilerService } from '../modules/billing/application/billing-reconciler.service';
import type { startBillingBrowser } from './billing-browser-smoke';
import { appendPackageInterval } from '../modules/billing/domain/billing-package';
import { checkRepeatApply } from './billing-repeat-apply-smoke';
import type { BillingOperationsService } from '../modules/billing/application/billing-operations.service';

type ObjectValue = Record<string, any>;
export function repeatProviderFixture(run: string, provider: Record<string, ObjectValue[]>) {
  const schedules: ObjectValue[] = [], checkoutLines = new Map<string, ObjectValue[]>(), invoiceLines = new Map<string, ObjectValue[]>();
  let loseAfter = '', checkoutCalls = 0, raceOnHold = false, loseRead = false;
  const calls = new Map<string, number>();
  const commands = new Map<string, ObjectValue>();
  const list = (data: ObjectValue[]) => ({ object: 'list', data, has_more: false });
  function complete(session: ObjectValue) {
    const suffix = session.id.replace(/^cs_/, ''), invoiceId = `in_${suffix}`, intentId = `pi_${suffix}`, chargeId = `ch_${suffix}`;
    Object.assign(session, { status: 'complete', payment_status: 'paid', invoice: invoiceId, payment_intent: intentId });
    const amount = session.amount_total, price = checkoutLines.get(session.id)![0]!.price;
    const invoice = { id: invoiceId, object: 'invoice', livemode: false, customer: session.customer, metadata: session.metadata,
      status: 'paid', billing_reason: 'manual', collection_method: 'send_invoice', parent: null, currency: 'thb', total: amount,
      amount_paid: amount, amount_remaining: 0, starting_balance: 0, status_transitions: { paid_at: Math.floor(Date.now() / 1000) }, created: session.created,
      hosted_invoice_url: 'https://invoice.stripe.com/i/synthetic-repeat', invoice_pdf: 'https://invoice.stripe.com/i/synthetic-repeat/pdf' };
    provider.invoices!.push(invoice);
    invoiceLines.set(invoiceId, [{ parent: { type: 'invoice_item_details', invoice_item_details: { invoice_item: `ii_${suffix}`, subscription: null, proration: false } },
      pricing: { price_details: { price: price.id, product: price.product } }, amount: amount, currency: 'thb', livemode: false, quantity: 1 }]);
    const charge = { id: chargeId, livemode: false, status: 'succeeded', paid: true, captured: true, currency: 'thb', amount: amount,
      customer: session.customer, payment_intent: intentId, payment_method_details: { type: 'card' }, amount_refunded: 0, disputed: false,
      receipt_url: 'https://pay.stripe.com/receipts/synthetic-repeat' };
    provider.charges!.push(charge); provider.intents!.push({ id: intentId, livemode: false, status: 'succeeded', currency: 'thb', amount_received: amount,
      customer: session.customer, latest_charge: charge });
    provider.payments!.push({ object: 'invoice_payment', livemode: false, status: 'paid', invoice: invoiceId,
      payment: { type: 'payment_intent', payment_intent: intentId }, amount_paid: amount, currency: 'thb' });
  }
  function heldInvoice() {
    const sub = provider.subscriptions![0]!, id = `in_held${randomUUID().replaceAll('-', '')}`, start = schedules[0]?.phases?.at(-1)?.start_date ?? sub.items.data[0].current_period_end;
    const invoice = { id, object: 'invoice', livemode: false, customer: sub.customer, parent: { subscription_details: { subscription: sub.id } },
      status: 'draft', auto_advance: false, collection_method: 'charge_automatically', billing_reason: 'subscription_cycle',
      currency: 'thb', total: 999000, amount_paid: 0, amount_remaining: 999000, created: Math.floor(Date.now() / 1000), starting_balance: 0 };
    provider.invoices!.push(invoice);
    invoiceLines.set(id, [{ parent: { type: 'subscription_item_details', subscription_item_details: { subscription: sub.id, proration: false } },
      pricing: { price_details: { price: 'price_ProYear' } }, currency: 'thb', livemode: false, quantity: 1, period: { start, end: start + 365 * 86400 } }]);
    return invoice;
  }
  function request(path: string, method: string, form: URLSearchParams, key: string | null): ObjectValue | undefined {
    if (method === 'GET') {
      if (loseRead) { loseRead = false; throw new Error('Synthetic provider read unavailable'); }
      const checkout = /^\/checkout\/sessions\/([^/]+)\/line_items$/.exec(path)?.[1];
      if (checkout && checkoutLines.has(checkout)) return list(checkoutLines.get(checkout)!);
      const invoice = /^\/invoices\/([^/]+)\/lines$/.exec(path)?.[1];
      if (invoice && invoiceLines.has(invoice)) return list(invoiceLines.get(invoice)!);
      return schedules.find(s => path === `/subscription_schedules/${s.id}`);
    }
    if (method !== 'POST') return;
    if (key && commands.has(key)) return commands.get(key);
    let result: ObjectValue | undefined, step = '';
    const sub = provider.subscriptions!.find(s => path === `/subscriptions/${s.id}`);
    if (sub) {
      if (form.has('pause_collection[behavior]')) {
        assert.equal(form.get('pause_collection[behavior]'), 'keep_as_draft');
        sub.pause_collection = { behavior: 'keep_as_draft', resumes_at: form.has('pause_collection[resumes_at]')?Number(form.get('pause_collection[resumes_at]')):null };
        if(form.has('metadata[mangmeeCollectionAttempt]'))sub.metadata.mangmeeCollectionAttempt = form.get('metadata[mangmeeCollectionAttempt]'); step = 'hold';
        if (raceOnHold) { raceOnHold = false; heldInvoice(); }
      } else if (form.has('cancel_at_period_end')) {
        assert.equal(form.get('proration_behavior'), 'none');
        sub.cancel_at_period_end = form.get('cancel_at_period_end') === 'true';
        sub.cancel_at = sub.cancel_at_period_end ? sub.items.data[0].current_period_end : null;
        sub.metadata.mangmeeCollectionOperation = form.get('metadata[mangmeeCollectionOperation]'); step = 'collection';
      } else if (form.get('pause_collection') === '') { sub.pause_collection = null; step = 'resume'; }
      else throw new Error('Unexpected repeat subscription update');
      if(form.has('metadata[mangmeeCollectionControl]'))sub.metadata.mangmeeCollectionControl=form.get('metadata[mangmeeCollectionControl]');
      result = sub;
    }
    if (path === '/checkout/sessions' && form.get('mode') === 'payment') {
      checkoutCalls++;
      assert.equal(provider.subscriptions!.find(s => s.customer === form.get('customer') && s.status === 'active')!.pause_collection?.behavior, 'keep_as_draft');
      const amount = Number(form.get('line_items[0][price_data][unit_amount]')); assert.ok(Number.isInteger(amount) && amount >= 1000);
      assert.equal(form.get('invoice_creation[enabled]'), 'true');
      assert.equal(form.get('payment_method_types[0]'), 'card');
      const metadata = { billingAccountId: form.get('metadata[billingAccountId]'), billingAttemptId: form.get('metadata[billingAttemptId]') };
      assert.equal(form.get('invoice_creation[invoice_data][metadata][billingAttemptId]'), metadata.billingAttemptId);
      const id = `cs_repeat${checkoutCalls}${run}`;
      result = { id, object: 'checkout.session', livemode: false, mode: 'payment', subscription: null, customer: form.get('customer'), metadata,
        status: 'open', payment_status: 'unpaid', client_reference_id: form.get('client_reference_id'), invoice_creation: { enabled: true },
        currency: 'thb', amount_total: amount, total_details: { amount_tax: 0, amount_discount: 0, amount_shipping: 0 },
        created: Math.floor(Date.now() / 1000), url: `https://checkout.stripe.com/c/pay/${id}` };
      provider.sessions!.push(result);
      checkoutLines.set(id, [{ quantity: 1, currency: 'thb', amount_total: amount, amount_tax: 0, amount_discount: 0,
        price: { id: `price_inline${checkoutCalls}${run}`, product: form.get('line_items[0][price_data][product]'), type: 'one_time', recurring: null, active: false, livemode: false, currency: 'thb', unit_amount: amount } }]);
      step = 'checkout';
    }
    if (path === '/subscription_schedules') {
      const target = provider.subscriptions!.find(s => s.id === form.get('from_subscription'))!; assert.ok(target);
      result = { id: `sub_sched_${schedules.length}${run}`, object: 'subscription_schedule', livemode: false, customer: target.customer, subscription: target.id,
        status: 'active', end_behavior: 'release', current_phase: { start_date: target.items.data[0].current_period_start },
        phases: [{ start_date: target.items.data[0].current_period_start, end_date: target.items.data[0].current_period_end,
          items: [{ price: target.items.data[0].price, quantity: 1, tax_rates: target.items.data[0].tax_rates ?? [] }] }], metadata: {} };
      target.schedule = result.id; schedules.push(result); step = 'scheduleCreate';
    }
    const invoiceMatch = /^\/invoices\/([^/]+)(?:\/(finalize|void))?$/.exec(path);
    const invoice = invoiceMatch && provider.invoices!.find(i => i.id === invoiceMatch[1]);
    if (invoice) {
      if (invoiceMatch![2] === 'finalize') { assert.equal(form.get('auto_advance'), 'false'); invoice.status = 'open'; }
      else if (invoiceMatch![2] === 'void') { assert.equal(invoice.status, 'open'); assert.equal(invoice.auto_advance, false); invoice.status = 'void'; }
      else { assert.equal(form.get('auto_advance'), 'true'); invoice.auto_advance = true; }
      result = invoice; step = invoiceMatch![2] ?? 'restore';
    }
    const schedule = schedules.find(s => path === `/subscription_schedules/${s.id}`);
    if (schedule) {
      assert.equal(form.get('proration_behavior'), 'none'); assert.ok(['release', 'cancel'].includes(form.get('end_behavior')!));
      const metadata = { ...schedule.metadata };
      for (const [name, value] of form) if (/^metadata\[.*\]$/.test(name)) metadata[name.slice(9, -1)] = value;
      Object.assign(schedule, { end_behavior: form.get('end_behavior'), metadata,
        phases: [0, 1].filter(i => form.has(`phases[${i}][start_date]`)).map(i => ({ start_date: Number(form.get(`phases[${i}][start_date]`)), end_date: Number(form.get(`phases[${i}][end_date]`)),
          items: [{ price: form.get(`phases[${i}][items][0][price]`), quantity: 1, tax_rates: form.has(`phases[${i}][items][0][tax_rates][0]`) ? [form.get(`phases[${i}][items][0][tax_rates][0]`)] : [] }], billing_cycle_anchor: form.get(`phases[${i}][billing_cycle_anchor]`) })) });
      const scheduledSub = provider.subscriptions!.find(s => s.id === schedule.subscription)!;
      scheduledSub.items.data[0].price = schedule.phases[0].items[0].price;
      scheduledSub.items.data[0].tax_rates = schedule.phases[0].items[0].tax_rates;
      if (form.has('metadata[mangmeeCollectionOperation]') || form.has('metadata[mangmeeFreeDaysOperation]')) {
        scheduledSub.cancel_at = schedule.end_behavior === 'cancel' ? schedule.phases.at(-1).end_date : null;
        scheduledSub.cancel_at_period_end = false;
      }
      result = schedule; step = form.has('metadata[mangmeeCollectionOperation]') ? 'collection' : 'scheduleUpdate';
    }
    if (result) {
      calls.set(step, (calls.get(step) ?? 0) + 1);
      const stored = structuredClone(result); if (key) commands.set(key, stored);
      if (loseAfter === step) { loseAfter = ''; throw new Error('Synthetic response lost after provider commit'); }
      return stored;
    }
  }
  return { request, complete, schedules, calls, heldInvoice, failNextRead: () => { loseRead = true; }, race: () => { raceOnHold = true; }, lose: (step: string) => { loseAfter = step; }, checkoutCalls: () => checkoutCalls };
}

export async function checkRepeatPurchase(input: {
  request: (path: string, method?: string, body?: unknown, extra?: Record<string, string>) => Promise<{ status: number; body: any }>;
  base: string; companyId: string; prisma: PrismaService; reconciler: BillingReconcilerService; provider: Record<string, ObjectValue[]>;
  fixture: ReturnType<typeof repeatProviderFixture>; browser?: Awaited<ReturnType<typeof startBillingBrowser>>;
  operations:BillingOperationsService;userId:string;membershipId:string;
}): Promise<string[]> {
  const { base, companyId, prisma, reconciler, provider, fixture, browser } = input, client = prisma.client;
  const request: typeof input.request = async (...args) => {
    for (let retry = 0; retry < 3; retry++) {
      const result = await input.request(...args);
      if (result.status !== 429 || retry === 2) return result;
      assert.ok(Number.isInteger(result.body.retryAfterSeconds) && result.body.retryAfterSeconds >= 1 && result.body.retryAfterSeconds <= 60);
      // Redis TTL is integer seconds; leave one second for rounding at the boundary.
      await new Promise(resolve => setTimeout(resolve, Math.min(60, result.body.retryAfterSeconds + 1) * 1000));
    }
    throw new Error('Rate-limit retry budget exhausted');
  };
  const account = await client.billingAccount.findFirstOrThrow({ where: { companyId } });
  const sub = provider.subscriptions![0]!; sub.status = 'active';
  await reconciler.reconcileAccount(account.id);
  const before = (await request(base)).body, oldEnd = new Date(before.paidThrough);
  const quote = async () => {
    const result = await request(`${base}/quote`, 'POST', { offerKey: 'PRO_999', interval: 'year', billingEmail: 'synthetic@example.test' });
    assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.body.purchase.kind, 'REPEAT'); return result.body;
  };
  const checkout = async (q: any) => request(`${base}/checkout`, 'POST', { quoteId: q.quoteId, consentRevision: q.consentRevision, accepted: true, channel: 'line' }, { 'idempotency-key': randomUUID() });
  fixture.race();
  const raced = await checkout(await quote()); assert.equal(raced.body.state, 'UNKNOWN');
  const racedInvoice = provider.invoices!.at(-1)!; assert.equal(racedInvoice.status, 'draft');
  assert.equal(fixture.checkoutCalls(), 0);
  await reconciler.reconcileAccount(account.id);
  assert.equal((await request(`${base}/attempts/${raced.body.attemptId}`)).body.state, 'FAILED');
  assert.equal(racedInvoice.auto_advance, true); assert.equal(sub.pause_collection, null);
  // Resolve the simulated provider renewal outside the attempted purchase before the next case.
  racedInvoice.status = 'void';
  const contender = await quote();
  const expired = await checkout(await quote()); assert.equal(expired.body.state, 'OPEN', JSON.stringify(expired));
  assert.equal((await checkout(contender)).status, 409, 'another idempotency key cannot open a second pending purchase');
  assert.equal(provider.subscriptions![0]!.pause_collection?.behavior, 'keep_as_draft');
  assert.equal((await request(base)).body.usage.remaining, before.usage.remaining);
  provider.sessions!.at(-1)!.status = 'expired'; await reconciler.reconcileAccount(account.id);
  assert.equal((await request(`${base}/attempts/${expired.body.attemptId}`)).body.state, 'EXPIRED');
  assert.equal(sub.pause_collection, null); assert.equal((await request(base)).body.paidThrough, before.paidThrough);
  const q = await quote();
  if (browser) {
    const page = browser.page;
    await page.goto(`${browser.origin}/companies/${companyId}/billing?interval=year`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'อีเมลรับเอกสาร', exact: true }).fill('synthetic@example.test');
    await page.locator('article').filter({ hasText: 'Pro' }).getByRole('button', { name: 'ตรวจสอบราคา', exact: true }).click();
    await page.getByRole('region', { name: 'ยืนยันซื้อแพ็กเกจ' }).getByText(/เพิ่ม 1200 ใบ/).waitFor();
  }
  fixture.lose('checkout');
  const pending = await checkout(q); assert.equal(pending.body.state, 'UNKNOWN');
  const count = fixture.checkoutCalls(); await reconciler.reconcileAccount(account.id);
  assert.equal(fixture.checkoutCalls(), count); assert.equal((await request(base)).body.attemptId, pending.body.attemptId);
  assert.equal((await request(base)).body.usage.remaining, before.usage.remaining);
  fixture.complete(provider.sessions!.at(-1)!); const held = fixture.heldInvoice(); fixture.lose('scheduleUpdate');
  await reconciler.reconcileAccount(account.id);
  assert.equal((await request(base)).body.paymentState, 'PAID', 'verified payment must remain visible while collection recovery is UNKNOWN');
  const paidPending = (await request(`${base}/attempts/${pending.body.attemptId}`)).body;
  assert.equal(paidPending.paymentState, 'PAID'); assert.equal(paidPending.applyState, 'PENDING');
  assert.equal((await request(base)).body.usage.remaining, before.usage.remaining);
  const applyCases=await checkRepeatApply({...input,request,invoiceId:paidPending.invoiceReference,session:provider.sessions!.at(-1)!,
    loseResume:()=>fixture.lose('resume'),purchaseCount:fixture.checkoutCalls,invoiceCount:()=>provider.invoices!.length});
  const after = (await request(base)).body;
  assert.equal(after.usage.remaining, before.usage.remaining + 1200, JSON.stringify(after));
  const expectedEnd = appendPackageInterval(oldEnd, 'year');
  assert.equal(after.paidThrough, expectedEnd.toISOString()); assert.equal(after.nextChargeAt, expectedEnd.toISOString()); assert.equal(sub.pause_collection, null);
  assert.equal((await request(`${base}/attempts/${pending.body.attemptId}`)).body.applyState, 'APPLIED');
  await reconciler.reconcileAccount(account.id); assert.equal((await request(base)).body.usage.remaining, before.usage.remaining + 1200);
  assert.equal(await client.billingReceiptGrant.count({ where: { companyId } }), 2);
  assert.equal(fixture.calls.get('scheduleUpdate'), 1);
  assert.equal(held.status, 'void'); assert.equal(held.amount_paid, 0);
  assert.equal(fixture.calls.get('finalize'), 1); assert.equal(fixture.calls.get('void'), 1);
  assert.equal(fixture.calls.get('resume'), 3, 'raced/expired checkouts restore collection and paid repeat resumes once');
  assert.equal(await client.auditLog.count({ where: { companyId, action: 'billing.package.repeated' } }), 1);
  for (const kind of ['invoice', 'pdf', 'receipt']) assert.equal((await request(`${base}/documents/${paidPending.invoiceReference}/open`, 'POST', { kind })).status, 200);
  if (browser) {
    const page = browser.page;
    await page.goto(`${browser.origin}/companies/${companyId}/billing/return?attempt=${pending.body.attemptId}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'ชำระแล้ว เปิดใช้งานแล้ว', exact: true }).waitFor();
    assert.match(await page.getByRole('region', { name: 'สถานะแพ็กเกจ' }).innerText(), /2398/);
    await page.screenshot({ path: `${browser.evidenceDir}/repeat-paid-mobile.png`, fullPage: true });
  }
  // Exhaust every valid paid grant, then buy the full annual package again. No receipt-only offer.
  const grants = await client.billingReceiptGrant.findMany({ where: { companyId }, include: { _count: { select: { admissions: true } } } });
  for (const grant of grants) await client.companyOcrUsageEvent.createMany({ data: Array.from({ length: grant.units - grant._count.admissions }, (_, i) => ({
    companyId, billingReceiptGrantId: grant.id, sourceRoute: 'receipt-ocr-web', requestId: `exhaust-${grant.id}-${i}`, monthKey: '2026-09' })) });
  assert.equal((await request(base)).body.usage.remaining, 0);
  const again = await checkout(await quote()); assert.equal(again.body.state, 'OPEN', JSON.stringify(again));
  fixture.complete(provider.sessions!.at(-1)!); await reconciler.reconcileAccount(account.id); await reconciler.reconcileAccount(account.id);
  const extended = (await request(base)).body;
  assert.equal(extended.usage.remaining, 1200);
  assert.equal(extended.paidThrough, appendPackageInterval(expectedEnd, 'year').toISOString());
  assert.equal(extended.nextChargeAt, extended.paidThrough);
  assert.equal(provider.subscriptions!.length, 1); assert.equal(fixture.schedules.length, 1); assert.equal(fixture.schedules[0]!.phases.length, 2);
  assert.equal(await client.billingReceiptGrant.count({ where: { companyId } }), 3);
  assert.equal(await client.billingSubscriptionContract.count({ where: { billingAccountId: account.id } }), 3);
  return ['repeat-renewal-race-blocks-checkout-and-restores-original-collection', 'repeat-exact-held-renewal-finalized-without-charge-and-voided', 'repeat-exhausted-quota-and-multiple-prepaid-years-use-one-subscription-two-phases', 'repeat-concurrent-intent-reservation', 'repeat-expired-checkout-restores-collection-without-quota', 'repeat-lost-checkout-response-reuses-single-session',
    'repeat-paid-schedule-and-unpause-crash-recovery-grants-once', 'repeat-calendar-extension-old-quota-carry-and-invoice-receipt',
    ...(browser ? ['browser-repeat-quote-and-verified-return'] : []),...applyCases];
}
