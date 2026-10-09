import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../common/database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import type { BillingSnapshot } from '../modules/billing/application/billing.service';
import { grantPaidPackageReceipts } from '../modules/billing/application/billing-receipt-grants';
import { paidInvoiceEvidence, termProjectionHash } from '../modules/billing/domain/paid-invoice';
import type { startBillingBrowser } from './billing-browser-smoke';

type Obj = Record<string, any>;
export async function checkBillingRestart(input: {
  request: (path: string, method?: string, body?: unknown, extra?: Record<string, string>) => Promise<{ status: number; body: any }>;
  prisma: PrismaService; companyId: string; sourceCompanyId: string; extraUserId: string; provider: Record<string, Obj[]>;
  reconcile: (id: string) => Promise<void>; loseCheckout: () => void; browser?: Awaited<ReturnType<typeof startBillingBrowser>>;
}) {
  const { prisma: { client }, companyId, provider } = input, cases: string[] = [], suffix = randomUUID().replaceAll('-', '');
  const base = `/v1/companies/${companyId}/billing`, oldAttemptId = randomUUID(), oldQuoteId = randomUUID(), customerId = `cus_restart${suffix}`;
  const source = await client.billingAccount.findFirstOrThrow({ where: { companyId: input.sourceCompanyId } });
  const template = await client.billingInvoice.findFirstOrThrow({ where: { billingAccountId: source.id, subscriptionId: { not: null } }, orderBy: { periodStart: 'asc' } });
  const original = await client.billingAttempt.findUniqueOrThrow({ where: { id: template.sourceAttemptId! } });
  const snapshot = structuredClone(original.quoteSnapshot) as unknown as BillingSnapshot;
  const oldEnd = Math.floor(Date.now() / 1000) - 86400, oldStart = oldEnd - 365 * 86400;
  const emptyAccount = await client.billingAccount.findUnique({ where: { companyId_stripeAccountId_livemode: { companyId, stripeAccountId: source.stripeAccountId, livemode: false } } });
  assert.equal(emptyAccount?.customerId ?? null, null, 'reuse only the empty cross-tenant fixture');
  const account = await client.billingAccount.upsert({ where: { companyId_stripeAccountId_livemode: { companyId, stripeAccountId: source.stripeAccountId, livemode: false } },
    create: { companyId, stripeAccountId: source.stripeAccountId, livemode: false, customerId, baseSubscriptionId: `sub_old${suffix}`,
      contractAttemptId: oldAttemptId, subscriptionState: 'canceled', paidThrough: new Date(oldEnd * 1000) },
    update: { customerId, baseSubscriptionId: `sub_old${suffix}`, contractAttemptId: oldAttemptId, subscriptionState: 'canceled', paidThrough: new Date(oldEnd * 1000) } });
  const offer = snapshot.quote.offer;
  await client.companyPlanTerm.update({ where: { companyId }, data: { tierKey: offer.offerKey, branchLimit: offer.branchLimit, employeeLimit: offer.employeeLimit,
    monthlySlipLimit: offer.monthlySlipLimit, termStartAt: new Date(oldStart * 1000), termEndsAt: new Date(oldEnd * 1000), billingReceiptAccountId: account.id } });
  const term = await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId } });
  Object.assign(snapshot, { termHash: termProjectionHash(term), termVersion: term.updatedAt.toISOString() });
  Object.assign(snapshot.quote, { quoteId: oldQuoteId, companyId, companyName: 'Synthetic lapsed company', purchase: { kind: 'INITIAL' } });
  const json = snapshot as unknown as Prisma.InputJsonValue;
  await client.billingAccount.update({ where: { id: account.id }, data: { termProjectionHash: snapshot.termHash,
    // R-A5: purchases judge recipient drift against this column, set as the first payment would have.
    recipientEmail: snapshot.quote.billingEmail, recipientSource: 'ACCOUNT_EMAIL' } });
  await client.billingQuote.create({ data: { id: oldQuoteId, companyId, initiatingUserId: original.initiatingUserId,
    policyRevisionId: original.policyRevisionId, expiresAt: new Date(oldStart * 1000), snapshotJson: json } });
  await client.billingAttempt.create({ data: { id: oldAttemptId, billingAccountId: account.id, initiatingUserId: original.initiatingUserId,
    quoteId: oldQuoteId, channel: 'web', idempotencyKey: randomUUID(), requestHash: 'historical-fixture', quoteSnapshot: json,
    policyRevisionId: original.policyRevisionId, consentRevision: original.consentRevision, consentAt: new Date(oldStart * 1000),
    status: 'COMPLETED', subscriptionId: account.baseSubscriptionId } });
  await client.billingSubscriptionContract.create({ data: { billingAccountId: account.id, sourceAttemptId: oldAttemptId,
    effectiveAt: new Date(oldStart * 1000), snapshotJson: json } });
  provider.customers!.push({ id: customerId, object: 'customer', livemode: false, email: snapshot.quote.billingEmail, metadata: { billingAccountId: account.id } });

  function paidContract(id: string, attemptId: string, start: number, end: number, priceId = 'price_ProYear', amount = 999000) {
    const sub: Obj = { id: `sub_${id}`, object: 'subscription', livemode: false, customer: customerId, status: 'active',
      metadata: { billingAccountId: account.id, billingAttemptId: attemptId }, cancel_at_period_end: false, collection_method: 'charge_automatically', billing_mode: { type: 'classic' }, billing_cycle_anchor: start,
      items: { data: [{ id: `si_${id}`, price: priceId, quantity: 1, current_period_start: start, current_period_end: end }] } };
    const invoice: Obj = { id: `in_${id}`, object: 'invoice', livemode: false, customer: customerId, parent: { subscription_details: { subscription: sub.id } },
      status: 'paid', collection_method: 'charge_automatically', currency: 'thb', billing_reason: 'subscription_create', amount_remaining: 0,
      total: amount, amount_paid: amount, starting_balance: 0, number: `SYNTHETIC-${id}`, created: start,
      hosted_invoice_url: 'https://invoice.stripe.com/i/synthetic-restart', invoice_pdf: 'https://invoice.stripe.com/i/synthetic-restart/pdf' };
    const line: Obj = { id: `il_${id}`, invoice: invoice.id, parent: { type: 'subscription_item_details', subscription_item_details: { subscription: sub.id, subscription_item: `si_${id}`, proration: false } },
      pricing: { price_details: { price: priceId } }, currency: 'thb', quantity: 1, livemode: false, period: { start, end } };
    const charge: Obj = { id: `ch_${id}`, livemode: false, status: 'succeeded', paid: true, captured: true, currency: 'thb', amount, customer: customerId,
      payment_intent: `pi_${id}`, payment_method_details: { type: 'card' }, amount_refunded: 0, disputed: false, receipt_url: 'https://pay.stripe.com/receipts/synthetic-restart' };
    const intent: Obj = { id: `pi_${id}`, livemode: false, status: 'succeeded', currency: 'thb', amount_received: amount, customer: customerId, latest_charge: charge };
    const payment: Obj = { id: `inpay_${id}`, object: 'invoice_payment', livemode: false, status: 'paid', invoice: invoice.id,
      payment: { type: 'payment_intent', payment_intent: intent.id }, amount_paid: amount, currency: 'thb' };
    provider.subscriptions!.push(sub); provider.invoices!.push(invoice); provider.lines!.push(line); provider.charges!.push(charge); provider.intents!.push(intent); provider.payments!.push(payment);
    return { sub, invoice, line, charge, intent, payment };
  }
  const old = paidContract(`old${suffix}`, oldAttemptId, oldStart, oldEnd); old.sub.status = 'canceled';
  const evidence = paidInvoiceEvidence(old.invoice, old.sub, [old.line], [old.payment], old.intent, old.charge, snapshot, false);
  const oldInvoice = await client.billingInvoice.create({ data: { billingAccountId: account.id, providerInvoiceId: old.invoice.id, sourceAttemptId: oldAttemptId,
    subscriptionId: old.sub.id, providerNumber: old.invoice.number, offerSnapshot: offer, contractSnapshot: json, policyRevisionId: original.policyRevisionId,
    currency: 'THB', totalSatang: evidence.totalSatang, paidSatang: evidence.paidSatang, providerChargeId: evidence.chargeId,
    periodStart: evidence.periodStart, periodEnd: evidence.periodEnd, providerStatus: 'paid', evidenceHash: evidence.evidenceHash, applyStatus: 'APPLIED', appliedAt: new Date(oldStart * 1000) } });
  const oldGrant = await client.$transaction(tx => grantPaidPackageReceipts(tx, { companyId, billingAccountId: account.id, sourceKey: oldInvoice.id,
    policyRevisionId: original.policyRevisionId, kind: 'INITIAL', units: 1200, serviceStart: evidence.periodStart, serviceEnd: evidence.periodEnd,
    availableAt: evidence.periodStart, expiresAt: evidence.periodEnd }));
  const request: typeof input.request = async (...args) => {
    for (let retry = 0; ; retry++) {
      const result = await input.request(...args); if (result.status !== 429 || retry >= 2) return result;
      assert.ok(result.body.retryAfterSeconds <= 60); await new Promise(r => setTimeout(r, Math.min(60, result.body.retryAfterSeconds + 1) * 1000));
    }
  };
  const quote = (offerKey = 'PRO_999', capacity?: unknown) => request(`${base}/quote`, 'POST', { offerKey, interval: 'year', billingEmail: 'owner@example.test', ...(capacity ? { capacity } : {}) });
  const checkout = (q: Obj, key = randomUUID()) => request(`${base}/checkout`, 'POST', { quoteId: q.quoteId, accepted: true, consentRevision: q.consentRevision, channel: 'line' }, { 'idempotency-key': key });
  const readAccount = () => client.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
  const before = await request(base); assert.equal(before.status, 200, JSON.stringify(before.body)); assert.equal(before.body.accessState, 'EXPIRED'); assert.equal(before.body.usage.remaining, 0);
  assert.ok(before.body.allowedActions.includes('new_sales'));
  old.sub.status = 'active'; assert.equal((await quote()).body.code, 'BILLING_RESTART_REVIEW'); old.sub.status = 'canceled';
  old.charge.amount_refunded = 1; assert.equal((await quote()).body.code, 'BILLING_RESTART_REVIEW'); old.charge.amount_refunded = 0;
  old.charge.disputed = true; assert.equal((await quote()).body.code, 'BILLING_RESTART_REVIEW'); old.charge.disputed = false;
  const beforeUnknown = await readAccount();
  for (const disputed of [undefined, null, 0, '', 'false']) {
    old.charge.disputed = disputed;
    assert.equal((await quote()).body.code, 'BILLING_RESTART_REVIEW', `unknown original dispute state ${String(disputed)}`);
  }
  old.charge.disputed = false;
  assert.deepEqual(await readAccount(), beforeUnknown);
  assert.deepEqual(await client.billingReceiptGrant.findUnique({ where: { id: oldGrant.id } }), oldGrant);
  cases.push('restart-unproven-original-dispute-state-refuses-new-sale-without-changing-paid-history');
  provider.invoices!.push({ ...old.invoice, id: `in_debt${suffix}`, status: 'open', amount_paid: 0, parent: null });
  assert.equal((await quote()).body.code, 'BILLING_RESTART_REVIEW'); provider.invoices!.pop();
  provider.invoices!.splice(provider.invoices!.indexOf(old.invoice), 1);
  assert.equal((await quote()).body.code, 'BILLING_RESTART_REVIEW', 'missing old paid history cannot clear debt review'); provider.invoices!.push(old.invoice);
  cases.push('restart-terminal-collection-debt-refund-dispute-and-complete-history-fences');
  const q = await quote(); assert.equal(q.status, 200, JSON.stringify(q.body)); assert.equal(q.body.purchase.kind, 'RESTART');
  assert.equal(q.body.purchase.projectedRemainingReceipts, 1200); assert.equal(q.body.purchase.previousPaidThrough, account.paidThrough!.toISOString());
  let expired: { status: number; body: any };
  if (input.browser) {
    const { page, origin } = input.browser;
    await page.goto(`${origin}/companies/${companyId}/billing?offer=PRO_999&interval=year&channel=line`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'แพ็กเกจหมดอายุแล้ว', exact: true }).waitFor();
    await page.getByRole('button', { name: /^(เลือกแพ็กเกจ|ซื้อหรือเปลี่ยนแพ็กเกจ)$/, exact: true }).click();
    await page.getByRole('button', { name: 'เลือกแพ็กเกจนี้', exact: true }).click();
    await page.getByText(/วันและโควตาที่หมดอายุไปแล้วไม่ทบ/).waitFor();
    await page.getByRole('checkbox').check();
    const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith(`${base.slice(3)}/checkout`) && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'ยืนยันและไปชำระที่ Stripe', exact: true }).click();
    const result = await response; assert.equal(result.status(), 200);
    await page.getByRole('heading', { name: 'Synthetic Stripe Checkout', exact: true }).waitFor();
    // Navigation can evict Chromium's response body. Verify the committed command instead.
    const pending = await readAccount();
    const command = await client.billingAttempt.findUniqueOrThrow({ where: { id: pending.activeAttemptId! } });
    assert.equal(command.channel, 'line'); assert.equal(command.status, 'OPEN'); assert.ok(command.checkoutSessionId);
    expired = { status: result.status(), body: { attemptId: command.id, state: command.status } };
    cases.push('browser-line-entry-expired-account-restart-review-and-real-checkout-command');
  } else expired = await checkout(q.body);
  assert.equal(expired.status, 200, JSON.stringify(expired.body));
  await input.reconcile(account.id); assert.equal((await readAccount()).activeAttemptId, expired.body.attemptId, 'open restart cannot fall through to old canceled subscription');
  const expiredSession = provider.sessions!.find(s => s.metadata.billingAttemptId === expired.body.attemptId)!;
  const unknownAttempt = await client.billingAttempt.update({ where: { id: expired.body.attemptId }, data: { status: 'UNKNOWN' } });
  const unknownIssue = await client.billingIssue.create({ data: { companyId, stripeAccountId: account.stripeAccountId, livemode: false,
    kind: 'UNKNOWN_ATTEMPT', referenceId: unknownAttempt.id } });
  for (const status of [undefined, null, '', 'pending', 0]) {
    expiredSession.status = status;
    await assert.rejects(() => input.reconcile(account.id), /billing.session_binding/);
    assert.deepEqual(await client.billingAttempt.findUniqueOrThrow({ where: { id: unknownAttempt.id } }), unknownAttempt);
    assert.deepEqual(await client.billingIssue.findUniqueOrThrow({ where: { id: unknownIssue.id } }), unknownIssue);
    assert.equal((await readAccount()).activeAttemptId, unknownAttempt.id);
    assert.equal((await readAccount()).baseSubscriptionId, old.sub.id);
    assert.equal(await client.billingReceiptGrant.count({ where: { billingAccountId: account.id } }), 1);
  }
  expiredSession.status = 'open'; await input.reconcile(account.id);
  assert.equal((await client.billingAttempt.findUniqueOrThrow({ where: { id: unknownAttempt.id } })).status, 'OPEN');
  assert.equal((await client.billingIssue.findUniqueOrThrow({ where: { id: unknownIssue.id } })).state, 'RESOLVED');
  cases.push('unknown-checkout-status-preserves-original-attempt-case-and-rights-until-original-source-recovers');
  expiredSession.status = 'expired';
  await input.reconcile(account.id); assert.equal((await readAccount()).activeAttemptId, null); assert.equal((await readAccount()).baseSubscriptionId, old.sub.id);
  assert.equal(await client.billingReceiptGrant.count({ where: { billingAccountId: account.id } }), 1);
  cases.push('restart-open-and-expired-checkout-preserve-old-contract-without-unlock');
  const failedQuote = await quote(); assert.equal(failedQuote.status, 200);
  const failed = await checkout(failedQuote.body); assert.equal(failed.status, 200);
  const failedSession = provider.sessions!.find(s => s.metadata.billingAttemptId === failed.body.attemptId)!;
  const failedContract = paidContract(`failed${suffix}`, failed.body.attemptId, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) + 365 * 86400);
  failedContract.sub.status = 'incomplete_expired';
  Object.assign(failedContract.invoice, { status: 'open', amount_paid: 0, amount_remaining: 999000 });
  Object.assign(failedContract.charge, { status: 'failed', paid: false, captured: false });
  Object.assign(failedContract.intent, { status: 'requires_payment_method', amount_received: 0 });
  Object.assign(failedContract.payment, { status: 'open', amount_paid: 0 });
  Object.assign(failedSession, { subscription: failedContract.sub.id, status: 'complete', payment_status: 'unpaid' });
  await input.reconcile(account.id); assert.equal((await readAccount()).activeAttemptId, failed.body.attemptId, 'terminal subscription alone cannot forgive open debt');
  Object.assign(failedContract.invoice, { status: 'void', amount_remaining: 0 });
  await input.reconcile(account.id); assert.equal((await readAccount()).activeAttemptId, null); assert.equal((await readAccount()).baseSubscriptionId, old.sub.id);
  assert.equal((await request(`${base}/attempts/${failed.body.attemptId}`)).body.paymentState, 'FAILED');
  assert.equal(await client.billingReceiptGrant.count({ where: { billingAccountId: account.id } }), 1);
  cases.push('restart-terminal-unpaid-subscription-releases-only-after-exact-zero-paid-void-proof');
  const branches = Array.from({ length: 6 }, (_, i) => ({ companyId, code: `restart-${i}`, name: `Synthetic branch ${i}`, type: i === 0 ? 'HEAD_OFFICE' as const : 'BRANCH' as const }));
  await client.branch.createMany({ data: branches });
  const staffMember = await client.companyMembership.create({ data: { companyId, userId: input.extraUserId, status: 'ACTIVE' } });
  const staffProfile = await client.employeeAccessProfile.create({ data: { companyId, userId: input.extraUserId, membershipId: staffMember.id, displayName: 'Synthetic retained selection staff', status: 'ACTIVE',
    identityType: 'PASSPORT', identityLast4: '0000', identityHash: suffix, identityEncryptedRef: 'synthetic-only', phoneNumber: suffix, createdByUserId: original.initiatingUserId } });
  // Current bound LINE context survives as a row, but its pending state must be invalidated on suspension.
  const conversation = await client.aiConversation.create({ data: { companyId, userId: input.extraUserId, membershipId:staffMember.id, channelKind:'USER', messagingChannelId:'synthetic-restart', chatKeyHash:suffix } });
  const settings = await client.billingSettings.findFirstOrThrow({ where: { stripeAccountId: account.stripeAccountId, livemode: false } });
  const revision = await client.billingPolicyRevision.findUniqueOrThrow({ where: { id: settings.policyRevisionId! } });
  const policy = structuredClone(revision.policyJson) as unknown as BillingSnapshot['policy'];
  policy.priceIds['STARTER_249:year'] = 'price_StarterYear'; policy.zeroPriceIds!['STARTER_249:year'] = 'price_ZeroStarterYear';
  const maxRevision = await client.billingPolicyRevision.aggregate({ where: { stripeAccountId: account.stripeAccountId, livemode: false }, _max: { version: true } });
  // Campaigns live beside the policy (promotionJson): a revision made from another one must carry them, or they vanish.
  const nextRevision = await client.billingPolicyRevision.create({ data: { stripeAccountId: account.stripeAccountId, livemode: false, version: (maxRevision._max.version ?? 0)+1, state: 'ACTIVE', policyJson: policy as unknown as Prisma.InputJsonValue, promotionJson: (revision.promotionJson ?? undefined) as Prisma.InputJsonValue | undefined, createdByUserId: original.initiatingUserId } });
  await client.billingSettings.update({ where: { id: settings.id }, data: { policyRevisionId: nextRevision.id, version: { increment: 1 } } });
  assert.equal((await quote('STARTER_249')).body.code, 'BILLING_CAP_SELECTION_REQUIRED');
  const choices = await request(`${base}/capacity?offerKey=STARTER_249&interval=year`); assert.equal(choices.status, 200, JSON.stringify(choices.body));
  const hq = choices.body.branches.find((b: Obj) => b.headOffice), owner = choices.body.memberships.find((m: Obj) => m.owner);
  const selection = { sourceHash: choices.body.sourceHash, branchIds: [hq.id], memberships: [{ id: owner.id, defaultBranchId: null }] };
  assert.equal((await quote('STARTER_249', { ...selection, memberships: [] })).body.code, 'BILLING_CAP_SELECTION_REQUIRED');
  assert.equal((await quote('STARTER_249', { ...selection, branchIds: ['foreign-branch'] })).body.code, 'BILLING_CAP_SELECTION_REQUIRED');
  assert.equal((await quote('STARTER_249', { ...selection, branchIds: [hq.id, hq.id] })).status, 400);
  const stale = await quote('STARTER_249', selection); assert.equal(stale.status, 200);
  await client.branch.update({ where: { id: hq.id }, data: { name: 'Synthetic headquarters' } });
  assert.equal((await checkout(stale.body)).body.code, 'BILLING_QUOTE_STALE');
  let next: { status: number; body: any };
  if (input.browser) {
    const { page, origin } = input.browser;
    await page.goto(`${origin}/companies/${companyId}/billing?offer=STARTER_249&interval=year&channel=line`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^(เลือกแพ็กเกจ|ซื้อหรือเปลี่ยนแพ็กเกจ)$/, exact: true }).click();
    await page.locator('article').filter({ has: page.getByRole('heading', { name: 'เริ่มต้น (STARTER)', exact: true }) }).getByRole('button', { name: 'เลือกแพ็กเกจนี้', exact: true }).click();
    const picker = page.getByRole('region', { name: 'เลือกสาขาและผู้ใช้' }); await picker.waitFor();
    await picker.getByRole('checkbox', { name: 'ฉันตรวจสอบรายการที่คงไว้และรายการที่จะพักแล้ว', exact: true }).check();
    const result = page.waitForResponse(r => new URL(r.url()).pathname.endsWith(`${base.slice(3)}/quote`) && r.request().method() === 'POST');
    await picker.getByRole('button', { name: 'ใช้การเลือกนี้และตรวจสอบราคา', exact: true }).click();
    const response = await result; next = { status: response.status(), body: await response.json() }; assert.equal(next.status, 200, JSON.stringify(next.body));
    await page.getByRole('region', { name: 'ยืนยันซื้อแพ็กเกจ' }).getByText(/พักผู้ใช้: Synthetic retained selection staff/).waitFor();
    cases.push('browser-expired-lower-package-retained-selection-and-impact-review');
  } else { const current = await request(`${base}/capacity?offerKey=STARTER_249&interval=year`); next = await quote('STARTER_249', { ...selection, sourceHash: current.body.sourceHash }); }
  assert.equal(next.status, 200, JSON.stringify(next.body));
  assert.equal(next.body.offer.offerKey, 'STARTER_249'); assert.equal(next.body.capacity.suspendedBranches.length, 5);
  assert.equal(next.body.capacity.suspendedMembers.length, 1);
  input.loseCheckout(); let purchase: { status: number; body: any };
  if (input.browser) {
    const { page } = input.browser, review = page.getByRole('region', { name: 'ยืนยันซื้อแพ็กเกจ' });
    await review.getByRole('checkbox').check();
    const result = page.waitForResponse(r => new URL(r.url()).pathname.endsWith(`${base.slice(3)}/checkout`) && r.request().method() === 'POST');
    await review.getByRole('button', { name: 'ยืนยันและไปชำระที่ Stripe', exact: true }).click();
    const response = await result; purchase = { status: response.status(), body: await response.json() };
  } else purchase = await checkout(next.body);
  assert.equal(purchase.body.state, 'UNKNOWN', JSON.stringify(purchase.body));
  assert.equal(await client.branch.count({ where: { companyId, status: 'ACTIVE' } }), 6);
  assert.equal((await client.employeeAccessProfile.findUniqueOrThrow({ where: { id: staffProfile.id } })).status, 'ACTIVE');
  cases.push('capacity-lower-restart-source-fence-owner-foreign-duplicate-and-no-unpaid-suspension');
  await input.reconcile(account.id);
  const session = provider.sessions!.find(s => s.metadata.billingAttemptId === purchase.body.attemptId)!;
  assert.equal((await readAccount()).activeAttemptId, purchase.body.attemptId); assert.equal(provider.sessions!.filter(s => s.metadata.billingAttemptId === purchase.body.attemptId).length, 1);
  session.client_reference_id = oldAttemptId; await assert.rejects(input.reconcile(account.id), /session_binding/); session.client_reference_id = purchase.body.attemptId;
  session.subscription = old.sub.id; await assert.rejects(input.reconcile(account.id), /restart_subscription_binding/); session.subscription = null;
  const start = Math.floor(Date.now() / 1000) - 1, end = start + 365 * 86400;
  const paid = paidContract(`new${suffix}`, purchase.body.attemptId, start, end, 'price_StarterYear', 249000);
  Object.assign(session, { subscription: paid.sub.id, status: 'complete', payment_status: 'paid' });
  await client.branch.update({ where: { id: hq.id }, data: { name: 'Source changed during payment' } });
  await input.reconcile(account.id);
  assert.equal((await readAccount()).activeAttemptId, purchase.body.attemptId); assert.equal((await readAccount()).baseSubscriptionId, old.sub.id);
  assert.equal((await request(`${base}/attempts/${purchase.body.attemptId}`)).body.applyState, 'HELD');
  assert.equal(await client.billingReceiptGrant.count({ where: { billingAccountId: account.id } }), 1);
  const heldStatus = (await request(base)).body; assert.equal(heldStatus.capacityRepair.attemptId, purchase.body.attemptId);
  const latest = (await request(`${base}/capacity?offerKey=STARTER_249&interval=year`)).body;
  const repairedSelection = { ...selection, sourceHash: latest.sourceHash };
  const repairBody = { expectedVersion: heldStatus.capacityRepair.attemptVersion, selection: repairedSelection, accepted: true };
  const repairKey = randomUUID();
  assert.equal((await request(`/v1/companies/${input.sourceCompanyId}/billing/attempts/${purchase.body.attemptId}/capacity`, 'POST', repairBody, { 'idempotency-key': randomUUID() })).status, 409);
  assert.equal((await request(`${base}/attempts/${purchase.body.attemptId}/capacity`, 'POST', { ...repairBody, selection }, { 'idempotency-key': randomUUID() })).status, 409);
  // Recovery remains available with new sales closed; it authorizes no new provider payment.
  const savedSettings = await client.billingSettings.findUniqueOrThrow({ where: { id: settings.id } });
  await client.billingSettings.update({ where: { id: settings.id }, data: { gatesJson: { ...(savedSettings.gatesJson as Obj), new_sales: false } } });
  let repairOperation: string;
  if (input.browser) {
    const { page, origin, evidenceDir } = input.browser;
    await page.goto(`${origin}/companies/${companyId}/billing/return?attempt=${purchase.body.attemptId}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'เลือกสิทธิ์สำหรับรายการที่จ่ายแล้ว', exact: true }).click();
    const picker = page.getByRole('region', { name: 'เลือกสาขาและผู้ใช้' }); await picker.waitFor();
    await picker.getByRole('checkbox', { name: 'ฉันตรวจสอบรายการที่คงไว้และรายการที่จะพักแล้ว', exact: true }).check();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: `${evidenceDir}/capacity-repair-mobile.png`, fullPage: true });
    const result = page.waitForResponse(r => new URL(r.url()).pathname.endsWith(`/attempts/${purchase.body.attemptId}/capacity`) && r.request().method() === 'POST');
    await picker.getByRole('button', { name: 'ยืนยันการเลือกสำหรับรายการที่จ่ายแล้ว', exact: true }).click();
    const response = await result, body = await response.json(); assert.equal(response.status(), 202, JSON.stringify(body)); repairOperation = body.operationId;
    cases.push('browser-paid-held-capacity-repair-with-sales-closed-no-second-payment');
  } else {
    const repaired = await request(`${base}/attempts/${purchase.body.attemptId}/capacity`, 'POST', repairBody, { 'idempotency-key': repairKey });
    assert.equal(repaired.status, 202, JSON.stringify(repaired.body)); repairOperation = repaired.body.operationId;
    assert.deepEqual((await request(`${base}/attempts/${purchase.body.attemptId}/capacity`, 'POST', repairBody, { 'idempotency-key': repairKey })).body, repaired.body);
    assert.equal((await request(`${base}/attempts/${purchase.body.attemptId}/capacity`, 'POST', repairBody, { 'idempotency-key': randomUUID() })).status, 409);
  }
  assert.equal((await client.billingOperation.findUniqueOrThrow({ where: { id: repairOperation } })).referenceId, purchase.body.attemptId);
  await client.billingSettings.update({ where: { id: settings.id }, data: { gatesJson: savedSettings.gatesJson as Prisma.InputJsonValue } });
  await input.reconcile(account.id); await input.reconcile(account.id);
  const after = (await request(base)).body; assert.equal(after.accessState, 'ACTIVE'); assert.equal(after.usage.remaining, 360); assert.equal(after.tierKey, 'STARTER_249'); assert.equal(after.paidThrough, new Date(end * 1000).toISOString());
  assert.equal((await readAccount()).baseSubscriptionId, paid.sub.id); assert.equal((await readAccount()).contractAttemptId, purchase.body.attemptId);
  assert.equal((await readAccount()).activeAttemptId, null);
  assert.equal(await client.billingIssue.count({ where: { companyId, kind: 'UNKNOWN_ATTEMPT', referenceId: purchase.body.attemptId, state: { not: 'RESOLVED' } } }), 0);
  assert.equal(await client.billingReceiptGrant.count({ where: { billingAccountId: account.id } }), 2);
  assert.deepEqual(await client.billingReceiptGrant.findUnique({ where: { id: oldGrant.id } }), oldGrant, 'expired units remain expired and history unchanged');
  const grants = await client.billingReceiptGrant.findMany({ where: { billingAccountId: account.id }, orderBy: { serviceStart: 'asc' } });
  assert.deepEqual(grants.map(g => g.kind), ['INITIAL', 'INITIAL']);
  assert.equal(await client.billingSubscriptionContract.count({ where: { billingAccountId: account.id } }), 2);
  assert.equal(await client.billingIssue.count({ where: { companyId, kind: 'PAID_HELD', state: { not: 'RESOLVED' } } }), 0);
  assert.equal(await client.branch.count({ where: { companyId, status: 'ACTIVE' } }), 1);
  assert.equal(await client.branch.count({ where: { companyId, status: 'DISABLED' } }), 5);
  assert.equal((await client.employeeAccessProfile.findUniqueOrThrow({ where: { id: staffProfile.id } })).status, 'SUSPENDED');
  assert.equal((await client.companyMembership.findUniqueOrThrow({ where: { id: staffMember.id } })).status, 'SUSPENDED');
  assert.equal((await client.user.findUniqueOrThrow({ where: { id: input.extraUserId } })).status, 'ACTIVE');
  const retainedConversation=await client.aiConversation.findUniqueOrThrow({where:{id:conversation.id}});
  assert.ok(retainedConversation.lifecycleEpoch>conversation.lifecycleEpoch);assert.equal(retainedConversation.taskStateJson,null);
  assert.equal(await client.auditLog.count({ where: { companyId, action: 'billing.capacity.applied' } }), 1);
  cases.push('capacity-paid-apply-atomic-suspension-defaults-history-and-global-user-preserved');
  cases.push('restart-lost-response-binding-cap-race-paid-held-repair-and-exactly-once-new-contract');
  assert.equal((await request(`${base}/history`)).body.items.length, 2);
  assert.equal((await request(`${base}/documents/${oldInvoice.id}/open`, 'POST', { kind: 'receipt' })).status, 200);
  const repeat = await quote('STARTER_249'); assert.equal(repeat.status, 200, JSON.stringify(repeat.body)); assert.equal(repeat.body.purchase.kind, 'REPEAT');
  const repeatStored = await client.billingQuote.findUniqueOrThrow({ where: { id: repeat.body.quoteId } });
  assert.equal((repeatStored.snapshotJson as unknown as BillingSnapshot).repeat!.anchorDay, new Date(start * 1000).getUTCDate());
  cases.push('restart-preserves-old-documents-and-next-repeat-uses-new-anniversary');
  if (input.browser) {
    const { page, origin, evidenceDir } = input.browser;
    await page.goto(`${origin}/companies/${companyId}/billing/return?attempt=${purchase.body.attemptId}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'ชำระแล้ว เปิดใช้งานแล้ว', exact: true }).waitFor();
    assert.match(await page.getByRole('region', { name: 'สถานะแพ็กเกจ' }).innerText(), /360/);
    await page.getByRole('button', { name: 'ประวัติ', exact: true }).click();await page.getByRole('link', { name: 'ดูเอกสาร', exact: true }).first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: `${evidenceDir}/restart-paid-mobile.png`, fullPage: true });
    cases.push('browser-restart-paid-return-new-quota-and-historical-documents');
  }
  return cases;
}
