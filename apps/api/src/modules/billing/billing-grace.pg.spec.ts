import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { BILLING_DRAFT_POLICY, billingOffer } from '@watchdog-bms/contracts';
import { PrismaClient, type Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../../common/database/prisma.service';
import { BillingService, type BillingSnapshot } from './application/billing.service';
import { BillingReconcilerService } from './application/billing-reconciler.service';
import { grantPaidPackageReceipts, paidReceiptBalance } from './application/billing-receipt-grants';
import { observeBillingCharges } from './application/billing-financial';
import { paidInvoiceEvidence, termProjectionHash } from './domain/paid-invoice';
import { StripeRequestError, type StripeObject } from './infrastructure/stripe.client';
import { admitCompanyOcr } from '../line-ai/application/company-ocr-governance';
import { effectivePlanCapacity } from '../system-partner-management/domain/logic/plan-capacity';
import { fulfillPaidPackageRequest } from './application/billing-package-request';

const databaseUrl = process.env.BILLING_TEST_DATABASE_URL;
test('renewal grace with real PostgreSQL and simulated Stripe (not native channel E2E)', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci'].includes(url.pathname));
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const prisma = { client } as PrismaService;
  const fixtures: { companyId: string; accountId: string }[] = [];
  async function fixture(daysPastDue = 1, graceDays = 7) {
    const run = randomUUID().replaceAll('-', ''), companyId = `grace-${run}`, stripeAccountId = `acct_${run}`;
    const customerId = `cus_${run}`, subscriptionId = `sub_${run}`, contractId = randomUUID(), quoteId = randomUUID();
    const end = Math.floor(Date.now() / 1000) - daysPastDue * 86400, start = end - 30 * 86400;
    const offer = billingOffer('BASIC_499', 'month');
    const account = await client.billingAccount.create({ data: { companyId, stripeAccountId, livemode: false, customerId,
      baseSubscriptionId: subscriptionId, contractAttemptId: contractId, paidThrough: new Date(end * 1000) } });
    fixtures.push({ companyId, accountId: account.id });
    await client.company.create({ data: { id: companyId, name: 'Synthetic grace company' } });
    await client.companyPlanTerm.create({ data: { companyId, tierKey: offer.offerKey, branchLimit: 2, employeeLimit: 5,
      monthlySlipLimit: 50, termStartAt: new Date(start * 1000), termEndsAt: new Date(end * 1000) } });
    await client.$transaction(tx => grantPaidPackageReceipts(tx, { companyId, billingAccountId: account.id, sourceKey: `in_${run}`,
      policyRevisionId: 'test-grace-policy', kind: 'INITIAL', units: 50, serviceStart: new Date(start * 1000), serviceEnd: new Date(end * 1000),
      availableAt: new Date(start * 1000), expiresAt: new Date(end * 1000) }));
    const term = await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId } });
    await client.billingAccount.update({ where: { id: account.id }, data: { termProjectionHash: termProjectionHash(term) } });
    const snapshot: BillingSnapshot = { priceId: `price_${run}`, termVersion: term.updatedAt.toISOString(), termHash: termProjectionHash(term),
      policy: { ...BILLING_DRAFT_POLICY, graceDays }, quote: { quoteId, companyId, companyName: 'Synthetic grace company', policyRevision: 'test-grace-policy',
        expiresAt: new Date().toISOString(), offer, subtotalSatang: 49900, totalSatang: 49900, taxSatang: 0, taxTreatment: 'NOT_VAT_REGISTERED',
        consentRevision: 'test', paidStart: 'IMMEDIATE', billingEmail: 'synthetic@example.test', trialEndsAt: null,
        usage: { used: 0, limit: 50, remaining: 50, cadence: 'PAID_GRANTS', resetsAt: null, expiresAt: term.termEndsAt.toISOString() } } };
    await client.billingQuote.create({ data: { id: quoteId, companyId, initiatingUserId: 'synthetic', policyRevisionId: 'test-grace-policy',
      expiresAt: new Date(), snapshotJson: snapshot as unknown as Prisma.InputJsonValue } });
    await client.billingAttempt.create({ data: { id: contractId, billingAccountId: account.id, initiatingUserId: 'synthetic', quoteId,
      channel: 'web', idempotencyKey: randomUUID(), requestHash: 'synthetic', quoteSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      policyRevisionId: 'test-grace-policy', consentRevision: 'test', consentAt: new Date(), status: 'COMPLETED', subscriptionId } });
    const subscription: StripeObject = { id: subscriptionId, object: 'subscription', customer: customerId, livemode: false,
      metadata: { billingAccountId: account.id, billingAttemptId: contractId }, status: 'past_due', latest_invoice: `in_renew${run}`,
      items: { data: [{ id: `si_${run}`, price: snapshot.priceId, current_period_end: end + 30 * 86400 }] } };
    const line = (s: number, e: number): StripeObject => ({ parent: { type: 'subscription_item_details', subscription_item_details: {
      subscription: subscriptionId, subscription_item: `si_${run}`, proration: false } }, pricing: { price_details: { price: snapshot.priceId } },
      currency: 'thb', quantity: 1, livemode: false, period: { start: s, end: e } });
    const invoice = (id: string, paid: boolean, initial: boolean): StripeObject => ({ id, object: 'invoice', livemode: false, customer: customerId,
      parent: { subscription_details: { subscription: subscriptionId } }, status: paid ? 'paid' : 'open', collection_method: 'charge_automatically',
      currency: 'thb', billing_reason: initial ? 'subscription_create' : 'subscription_cycle', amount_remaining: paid ? 0 : 49900,
      total: 49900, amount_paid: paid ? 49900 : 0, starting_balance: 0, created: initial ? start : end });
    const initialInvoice = invoice(`in_${run}`, true, true), renewal = invoice(subscription.latest_invoice, false, false);
    const invoices = [initialInvoice, renewal];
    const lines = new Map([[initialInvoice.id, line(start, end)], [renewal.id, line(end, end + 30 * 86400)]]);
    const charge = (id: string): StripeObject => ({ id: `ch_${id}`, customer: customerId, payment_intent: `pi_${id}`, livemode: false,
      status: 'succeeded', paid: true, captured: true, currency: 'thb', amount: 49900, amount_refunded: 0, disputed: false, payment_method_details: { type: 'card' } });
    const intent = (id: string): StripeObject => ({ id: `pi_${id}`, customer: customerId, livemode: false, status: 'succeeded',
      currency: 'thb', amount_received: 49900, latest_charge: charge(id) });
    const payment = (id: string): StripeObject => ({ id: `inpay_${id}`, object: 'invoice_payment', livemode: false, status: 'paid', invoice: id,
      payment: { type: 'payment_intent', payment_intent: `pi_${id}` }, amount_paid: 49900, currency: 'thb' });
    const evidence = paidInvoiceEvidence(initialInvoice, subscription, [lines.get(initialInvoice.id)!], [payment(initialInvoice.id)], intent(initialInvoice.id), charge(initialInvoice.id), snapshot, false);
    await client.billingInvoice.create({ data: { billingAccountId: account.id, providerInvoiceId: initialInvoice.id, sourceAttemptId: contractId,
      subscriptionId, offerSnapshot: offer, policyRevisionId: 'test-grace-policy', currency: 'THB', totalSatang: 49900, paidSatang: 49900,
      periodStart: evidence.periodStart, periodEnd: evidence.periodEnd, providerStatus: 'paid', evidenceHash: evidence.evidenceHash,
      applyStatus: 'APPLIED', appliedAt: new Date(start * 1000) } });
    let deleteCalls = 0, loseDeleteResponse = false;
    const stripe = { enabled: true, livemode: false, accountId: stripeAccountId, assertAccount: async () => {},
      request: async (method: string, path: string, params: Record<string, unknown> = {}) => {
        if (path === `/subscriptions/${subscriptionId}`) {
          if (method === 'DELETE') {
            deleteCalls++; assert.deepEqual(params, { invoice_now: false, prorate: false }); subscription.status = 'canceled';
            if (loseDeleteResponse) throw new StripeRequestError('UNKNOWN', 'transport_unknown');
          }
          return structuredClone(subscription);
        }
        if (path.startsWith('/payment_intents/pi_')) return intent(path.slice('/payment_intents/pi_'.length));
        if (path.startsWith('/charges/ch_')) return charge(path.slice('/charges/ch_'.length));
        throw new Error(`Unexpected provider request ${method} ${path}`);
      },
      list: async (path: string, params: Record<string, string> = {}) => {
        if (path === '/subscriptions') return [structuredClone(subscription)];
        if (path === '/invoices') return structuredClone(invoices);
        if (path === '/invoice_payments') return [payment(params.invoice!)];
        const id = /^\/invoices\/([^/]+)\/lines$/.exec(path)?.[1];
        if (id && lines.has(id)) return [structuredClone(lines.get(id))];
        throw new Error(`Unexpected provider list ${path}`);
      } } as unknown as ConstructorParameters<typeof BillingService>[2];
    const billing = new BillingService(prisma, { stripeAccountId } as ConstructorParameters<typeof BillingService>[1], stripe);
    const lifecycle = { execute: async () => { throw new Error('Unexpected lifecycle mutation'); } } as unknown as ConstructorParameters<typeof BillingReconcilerService>[4];
    const reconciler = new BillingReconcilerService(prisma, {} as ConstructorParameters<typeof BillingReconcilerService>[1], stripe, billing, lifecycle);
    return { companyId, accountId: account.id, end, subscription, renewal, reconciler, snapshot, lines, initialInvoice, stripe,
      evidence: (proposed: BillingSnapshot, bill = initialInvoice) => paidInvoiceEvidence(bill, subscription, [lines.get(initialInvoice.id)!],
        [payment(initialInvoice.id)], intent(initialInvoice.id), charge(initialInvoice.id), proposed, false),
      run: () => reconciler.reconcileAccount(account.id), deletes: () => deleteCalls, loseResponse: () => { loseDeleteResponse = true; } };
  }
  try {
    await t.test('trial carryover requires verified paid time while old invoice hashes remain compatible', async () => {
      const f = await fixture();
      const snapshot = { ...f.snapshot, trialCarryover: { units: 9, trialEndsAt: new Date().toISOString() } };
      const start = f.lines.get(f.initialInvoice.id)!.period.start;
      const original = f.evidence(f.snapshot);
      for (const paidAt of [undefined, '123', start - 1, Math.floor(Date.now() / 1000) + 60]) {
        assert.throws(() => f.evidence(snapshot, { ...f.initialInvoice, status_transitions: { paid_at: paidAt } }));
      }
      const invoice = { ...f.initialInvoice, status_transitions: { paid_at: start } };
      assert.equal(f.evidence(snapshot, invoice).paidAt?.getTime(), start * 1000);
      assert.equal(f.evidence(f.snapshot, invoice).evidenceHash, original.evidenceHash);
      assert.equal(f.evidence(snapshot, { ...invoice, billing_reason: 'subscription_cycle' }).paidAt, undefined);
    });
    await t.test('paid renewal fulfills only the original matching request; replay leaves the next request open', async () => {
      const f = await fixture();
      const request = await client.packageChangeRequest.create({data:{companyId:f.companyId,requestedByUserId:'synthetic-owner',
        requestedTierKey:'BASIC_499',note:'ขอเพิ่มแพ็กเกจให้ร้าน'}});
      await f.run();
      assert.equal((await client.packageChangeRequest.findUniqueOrThrow({where:{id:request.id}})).status,'OPEN');
      Object.assign(f.renewal,{status:'paid',amount_paid:49900,amount_remaining:0});f.subscription.status='active';
      await f.run();await f.run();
      const invoice=await client.billingInvoice.findFirstOrThrow({where:{billingAccountId:f.accountId,providerInvoiceId:f.renewal.id}});
      const applied=await client.packageChangeRequest.findUniqueOrThrow({where:{id:request.id}});
      assert.equal(invoice.applyStatus,'APPLIED');assert.equal(applied.status,'APPROVED');assert.equal(applied.paymentState,'STRIPE_APPLIED');
      assert.equal(applied.paymentRef,invoice.id);assert.equal(applied.decidedByUserId,null);assert.equal(applied.note,request.note);
      assert.equal(applied.verifiedAt?.getTime(),invoice.appliedAt?.getTime());
      assert.equal(await client.auditLog.count({where:{companyId:f.companyId,action:'billing.package_request.fulfilled'}}),1);
      const next=await client.packageChangeRequest.create({data:{companyId:f.companyId,requestedByUserId:'synthetic-owner',requestedTierKey:'BASIC_499',
        createdAt:new Date(invoice.appliedAt!.getTime()+1)}});
      await f.run();
      await client.$transaction(async tx=>{await tx.$executeRaw`SELECT id FROM "Company" WHERE id=${f.companyId} FOR UPDATE`;
        await fulfillPaidPackageRequest(tx,f.companyId,f.accountId,invoice.id);});
      assert.equal((await client.packageChangeRequest.findUniqueOrThrow({where:{id:next.id}})).status,'OPEN');
      assert.equal(await client.auditLog.count({where:{companyId:f.companyId,action:'billing.package_request.fulfilled'}}),1);
      assert.equal(await client.outboxEvent.count({where:{companyId:f.companyId,eventType:'billing.invoice.applied'}}),1);
    });
    await t.test('paid source guards preserve other tiers, legacy payment evidence and temporary gifts; audit failure rolls back paid apply', async () => {
      const f=await fixture(),request=await client.packageChangeRequest.create({data:{companyId:f.companyId,requestedByUserId:'synthetic-owner',requestedTierKey:'BASIC_499'}});
      Object.assign(f.renewal,{status:'paid',amount_paid:49900,amount_remaining:0});f.subscription.status='active';
      const trigger=`paid_request_${randomUUID().replaceAll('-','')}`;
      await client.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.package_request.fulfilled' AND NEW."companyId"='${f.companyId}' THEN RAISE EXCEPTION 'synthetic paid request audit failure'; END IF; RETURN NEW; END $$`);
      try {
        await client.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`);
        await assert.rejects(f.run(),/synthetic paid request audit failure/);
        assert.equal((await client.packageChangeRequest.findUniqueOrThrow({where:{id:request.id}})).status,'OPEN');
        assert.equal(await client.billingReceiptGrant.count({where:{companyId:f.companyId,kind:'RENEWAL'}}),0);
        assert.equal((await client.companyPlanTerm.findUniqueOrThrow({where:{companyId:f.companyId}})).termEndsAt.getTime(),f.end*1000);
        assert.equal(await client.outboxEvent.count({where:{companyId:f.companyId,eventType:'billing.invoice.applied'}}),0);
      } finally {
        await client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "AuditLog"`);
        await client.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${trigger}"()`);
      }
      await client.packageChangeRequest.update({where:{id:request.id},data:{requestedTierKey:'PRO_999'}});
      await f.run();
      const invoice=await client.billingInvoice.findFirstOrThrow({where:{billingAccountId:f.accountId,providerInvoiceId:f.renewal.id}});
      const term=await client.companyPlanTerm.findUniqueOrThrow({where:{companyId:f.companyId}});
      await client.companyPlanTerm.update({where:{companyId:f.companyId},data:{capacityOverride:{operationId:randomUUID(),accountId:f.accountId,
        tierKey:'PRO_999',branchLimit:5,employeeLimit:10,effectiveAt:new Date().toISOString(),expiresAt:term.termEndsAt.toISOString()}}});
      const resolve=()=>client.$transaction(async tx=>{await tx.$executeRaw`SELECT id FROM "Company" WHERE id=${f.companyId} FOR UPDATE`;
        await fulfillPaidPackageRequest(tx,f.companyId,f.accountId,invoice.id);});
      await resolve();assert.equal((await client.packageChangeRequest.findUniqueOrThrow({where:{id:request.id}})).status,'OPEN','Pro gift is not a purchased Pro package');
      await client.packageChangeRequest.update({where:{id:request.id},data:{requestedTierKey:'BASIC_499',paymentRef:'legacy-slip'}});
      await resolve();assert.equal((await client.packageChangeRequest.findUniqueOrThrow({where:{id:request.id}})).status,'OPEN');
      await client.packageChangeRequest.update({where:{id:request.id},data:{paymentRef:null}});
      for(const data of [{applyStatus:'HELD'},{providerStatus:'open'},{refundedSatang:1},{disputed:true}]){
        await client.billingInvoice.update({where:{id:invoice.id},data});await resolve();
        assert.equal((await client.packageChangeRequest.findUniqueOrThrow({where:{id:request.id}})).status,'OPEN');
        await client.billingInvoice.update({where:{id:invoice.id},data:{applyStatus:'APPLIED',providerStatus:'paid',refundedSatang:0,disputed:false}});
      }
      const grant=await client.billingReceiptGrant.findFirstOrThrow({where:{companyId:f.companyId,sourceKey:invoice.id}});
      // The expired window is anchored on the grant's own serviceStart (the renewal period opens a
      // day before now), not on Date.now(): the apply stamps availableAt at ~now, and
      // BillingReceiptGrant_valid_units_period_kind requires availableAt < expiresAt, so
      // expiresAt=now-1s is rejected whenever the apply landed less than a second earlier.
      const expiredWindow={availableAt:grant.serviceStart,expiresAt:new Date(grant.serviceStart.getTime()+1000),serviceEnd:new Date(grant.serviceStart.getTime()+1000)};
      for(const data of [{kind:'ADMIN_ADJUSTMENT'},expiredWindow,{availableAt:new Date(Date.now()+86400000)},{revokedAt:new Date()}]){
        await client.billingReceiptGrant.update({where:{id:grant.id},data});await resolve();
        assert.equal((await client.packageChangeRequest.findUniqueOrThrow({where:{id:request.id}})).status,'OPEN');
        await client.billingReceiptGrant.update({where:{id:grant.id},data:{kind:grant.kind,serviceEnd:grant.serviceEnd,expiresAt:grant.expiresAt,availableAt:grant.availableAt,revokedAt:null}});
      }
      await resolve();
      assert.equal((await client.packageChangeRequest.findUniqueOrThrow({where:{id:request.id}})).status,'APPROVED');
      assert.equal(await client.auditLog.count({where:{companyId:f.companyId,action:'billing.package_request.fulfilled'}}),1);
    });
    await t.test('verified paid renewal keeps the purchased hash valid and cannot revive an expired Admin capacity gift', async () => {
      const f = await fixture(), before = await client.companyPlanTerm.findUniqueOrThrow({where:{companyId:f.companyId}});
      const gift = {operationId:randomUUID(),accountId:f.accountId,tierKey:'PRO_999',branchLimit:5,employeeLimit:10,
        effectiveAt:before.termStartAt.toISOString(),expiresAt:before.termEndsAt.toISOString()};
      const adjusted = await client.companyPlanTerm.update({where:{companyId:f.companyId},data:{capacityOverride:gift}});
      assert.equal(termProjectionHash(adjusted),termProjectionHash(before));
      Object.assign(f.renewal,{status:'paid',amount_paid:49900,amount_remaining:0});f.subscription.status='active';
      await f.run();await f.run();
      const invoice = await client.billingInvoice.findFirstOrThrow({where:{billingAccountId:f.accountId,providerInvoiceId:f.renewal.id}});
      assert.equal(invoice.applyStatus,'APPLIED');
      const term = await client.companyPlanTerm.findUniqueOrThrow({where:{companyId:f.companyId}});
      assert.deepEqual(term.capacityOverride,gift);assert.equal(effectivePlanCapacity(term).tierKey,'BASIC_499');
      assert.equal(effectivePlanCapacity(term).temporary,undefined);assert.ok(term.termEndsAt>before.termEndsAt);
      assert.equal(await client.billingReceiptGrant.count({where:{billingAccountId:f.accountId,kind:'RENEWAL'}}),1);
      assert.equal((await paidReceiptBalance(client,f.companyId,f.accountId)).remaining,50);
    });
    await t.test('mapped financial sweep rotates beyond one page without minting access or duplicate cases', async () => {
      const f = await fixture();
      const original = await client.billingInvoice.findFirstOrThrow({ where: { billingAccountId: f.accountId } });
      await client.billingInvoice.createMany({ data: Array.from({ length: 21 }, (_, i) => ({ ...original, id: randomUUID(), sourceAttemptId: null,
        providerInvoiceId: `in_batch${i}`, providerChargeId: `ch_in_batch${i}`, offerSnapshot: original.offerSnapshot as Prisma.InputJsonValue,
        contractSnapshot: undefined })) });
      const account = await client.billingAccount.update({ where: { id: f.accountId }, data: { leaseToken: 'financial-sweep', leaseUntil: new Date(Date.now() + 120000) } });
      await observeBillingCharges(prisma, f.stripe, account, 'financial-sweep');
      assert.equal(await client.billingInvoice.count({ where: { billingAccountId: f.accountId, financialObservedAt: { not: null } } }), 20);
      await observeBillingCharges(prisma, f.stripe, account, 'financial-sweep');
      assert.equal(await client.billingInvoice.count({ where: { billingAccountId: f.accountId, financialObservedAt: { not: null } } }), 21);
      assert.equal(await client.billingReceiptGrant.count({ where: { billingAccountId: f.accountId } }), 1);
      assert.equal(await client.billingIssue.count({ where: { companyId: f.companyId, kind: 'FINANCIAL_REVIEW' } }), 0);
    });
    await t.test('renewal after a restarted contract does not reapply its old-subscription admission fence', async () => {
      const f = await fixture();
      f.snapshot.restart = { subscriptionId: 'sub_terminatedPrevious', contractAttemptId: 'old-contract',
        paidThrough: new Date(f.end * 1000 - 365 * 86400000).toISOString(), termHash: 'old-term' };
      await client.billingAttempt.update({ where: { id: f.subscription.metadata.billingAttemptId }, data: {
        quoteSnapshot: f.snapshot as unknown as Prisma.InputJsonValue,
      } });
      Object.assign(f.renewal, { status: 'paid', amount_paid: 49900, amount_remaining: 0 }); f.subscription.status = 'active';
      await f.run(); await f.run();
      const renewal = await client.billingInvoice.findFirstOrThrow({ where: { billingAccountId: f.accountId, providerInvoiceId: f.renewal.id } });
      assert.equal(renewal.applyStatus, 'APPLIED');
      const account = await client.billingAccount.findUniqueOrThrow({ where: { id: f.accountId } });
      assert.equal(account.baseSubscriptionId, f.subscription.id);
      const grants = await client.billingReceiptGrant.findMany({ where: { billingAccountId: f.accountId }, orderBy: { serviceStart: 'asc' } });
      assert.deepEqual(grants.map(g => g.kind), ['INITIAL', 'RENEWAL']);
    });
    await t.test('historical invoices keep accepted price while renewal selects the contract effective at its service boundary', async () => {
      const f = await fixture(); await f.run();
      const original = await client.billingInvoice.findFirstOrThrow({ where: { billingAccountId: f.accountId, providerInvoiceId: f.initialInvoice.id } });
      const next = structuredClone(f.snapshot);
      next.priceId = 'price_futureContract'; next.quote.policyRevision = 'future-price-policy';
      await client.billingSubscriptionContract.create({ data: { billingAccountId: f.accountId, sourceAttemptId: randomUUID(),
        effectiveAt: new Date(f.end * 1000), snapshotJson: next as unknown as Prisma.InputJsonValue } });
      f.lines.get(f.renewal.id)!.pricing.price_details.price = next.priceId;
      f.subscription.items.data[0].price = next.priceId;
      Object.assign(f.renewal, { status: 'paid', amount_paid: 49900, amount_remaining: 0 }); f.subscription.status = 'active';
      await f.run(); await f.run();
      const history = await client.billingInvoice.findUniqueOrThrow({ where: { id: original.id } });
      assert.deepEqual(history.contractSnapshot, original.contractSnapshot);
      const renewal = await client.billingInvoice.findFirstOrThrow({ where: { billingAccountId: f.accountId, providerInvoiceId: f.renewal.id } });
      assert.equal(renewal.policyRevisionId, 'future-price-policy');
      assert.equal((renewal.contractSnapshot as unknown as BillingSnapshot).priceId, next.priceId);
      assert.equal(await client.billingReceiptGrant.count({ where: { companyId: f.companyId } }), 2);
      assert.equal((await client.billingReceiptGrant.findFirstOrThrow({ where: { companyId: f.companyId, kind: 'RENEWAL' } })).policyRevisionId, 'future-price-policy');
      assert.equal(await client.billingSubscriptionContract.count({ where: { billingAccountId: f.accountId } }), 2);
    });
    await t.test('grace preserves old unspent quota across web and LINE without creating a new grant; recovery replaces it', async () => {
      const f = await fixture(); await f.run(); await f.run();
      const grace = await client.billingAccount.findUniqueOrThrow({ where: { id: f.accountId } });
      assert.equal(grace.paidThrough!.getTime(), f.end * 1000);
      assert.equal(grace.graceEndsAt!.getTime(), (f.end + 7 * 86400) * 1000);
      assert.equal((await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: f.companyId } })).termEndsAt.getTime(), grace.graceEndsAt!.getTime());
      assert.equal(await client.billingReceiptGrant.count({ where: { companyId: f.companyId } }), 1);
      assert.equal(await client.auditLog.count({ where: { companyId: f.companyId, action: 'billing.grace.started' } }), 1);
      for (const sourceRoute of ['receipt-ocr-web', 'receipt-ocr-line'] as const) assert.equal((await admitCompanyOcr(prisma, {
        companyId: f.companyId, sourceRoute, requestId: sourceRoute, monthKey: '2026-09' })).allowed, true);
      assert.equal((await paidReceiptBalance(client, f.companyId, f.accountId)).remaining, 48);
      Object.assign(f.renewal, { status: 'paid', amount_paid: 49900, amount_remaining: 0 }); f.subscription.status = 'active';
      await f.run(); await f.run();
      assert.equal(await client.billingReceiptGrant.count({ where: { companyId: f.companyId } }), 2);
      assert.equal((await paidReceiptBalance(client, f.companyId, f.accountId)).remaining, 50);
      assert.equal((await client.billingAccount.findUniqueOrThrow({ where: { id: f.accountId } })).graceEndsAt, null);
      assert.equal(f.deletes(), 0);
    });
    await t.test('grace and recovery preserve the fixed expiry of Admin and trial receipts', async () => {
      for (const kind of ['ADMIN_ADJUSTMENT', 'TRIAL_CARRYOVER']) {
      const f=await fixture(),end=new Date(f.end*1000),start=new Date(end.getTime()-86400000);
      const gift=await client.billingReceiptGrant.create({data:{companyId:f.companyId,billingAccountId:f.accountId,sourceKey:'synthetic-admin-grace',sourceHash:'synthetic-admin-proof',
        kind,units:3,availableAt:start,serviceStart:start,serviceEnd:end,expiresAt:end,policyRevisionId:'TEST_ONLY'}});
      await f.run();
      assert.equal((await client.billingReceiptGrant.findUniqueOrThrow({where:{id:gift.id}})).expiresAt.toISOString(),end.toISOString());
      Object.assign(f.renewal,{status:'paid',amount_paid:49900,amount_remaining:0});f.subscription.status='active';await f.run();
      assert.equal((await client.billingReceiptGrant.findUniqueOrThrow({where:{id:gift.id}})).expiresAt.toISOString(),end.toISOString());
      assert.equal((await client.billingReceiptGrant.findUniqueOrThrow({where:{id:gift.id}})).units,3);
      }
    });

    await t.test('admin hold, changed term, and unrelated invoice cannot unlock or extend a company', async () => {
      for (const variation of ['hold', 'term', 'invoice']) {
        const f = await fixture();
        if (variation === 'hold') await client.company.update({ where: { id: f.companyId }, data: { status: 'SUSPENDED' } });
        if (variation === 'term') await client.companyPlanTerm.update({ where: { companyId: f.companyId }, data: { employeeLimit: 9 } });
        if (variation === 'invoice') f.renewal.customer = 'cus_other';
        await f.run();
        assert.equal((await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: f.companyId } })).termEndsAt.getTime(), f.end * 1000);
        assert.equal((await paidReceiptBalance(client, f.companyId, f.accountId)).remaining, 0);
        assert.equal(f.deletes(), 0);
      }
    });
    await t.test('grace cannot replenish exhausted receipts, and zero-day policy cancels without free days', async () => {
      const exhausted = await fixture();
      const grant = await client.billingReceiptGrant.findFirstOrThrow({ where: { companyId: exhausted.companyId } });
      await client.companyOcrUsageEvent.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ companyId: exhausted.companyId,
        billingReceiptGrantId: grant.id, sourceRoute: 'receipt-ocr-web', requestId: `used-${i}`, monthKey: '2026-08' })) });
      await exhausted.run();
      assert.equal((await paidReceiptBalance(client, exhausted.companyId, exhausted.accountId)).remaining, 0);
      assert.equal((await admitCompanyOcr(prisma, { companyId: exhausted.companyId, sourceRoute: 'receipt-ocr-line', requestId: 'no-free-refill', monthKey: '2026-09' })).allowed, false);
      const zero = await fixture(1, 0); await zero.run();
      assert.equal(zero.deletes(), 1);
      assert.equal((await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: zero.companyId } })).termEndsAt.getTime(), zero.end * 1000);
    });
    await t.test('expired grace cancels collection once without new quota or deleting the unpaid invoice', async () => {
      const f = await fixture(8); await f.run(); await f.run();
      assert.equal(f.deletes(), 1); assert.equal(f.subscription.status, 'canceled'); assert.equal(f.renewal.status, 'open');
      assert.equal((await client.billingAccount.findUniqueOrThrow({ where: { id: f.accountId } })).nextChargeAt, null);
      assert.equal(await client.billingReceiptGrant.count({ where: { companyId: f.companyId } }), 1);
      assert.equal((await client.billingOperation.findFirstOrThrow({ where: { companyId: f.companyId } })).state, 'SUCCEEDED');
      assert.equal((await admitCompanyOcr(prisma, { companyId: f.companyId, sourceRoute: 'receipt-ocr-web', requestId: 'expired', monthKey: '2026-09' })).allowed, false);
    });
    await t.test('a lost cancellation response remains UNKNOWN then resolves by rereading, without another DELETE', async () => {
      const f = await fixture(8); f.loseResponse();
      await assert.rejects(f.run(), /transport_unknown/);
      assert.equal((await client.billingOperation.findFirstOrThrow({ where: { companyId: f.companyId } })).state, 'UNKNOWN');
      await f.run();
      assert.equal(f.deletes(), 1);
      assert.equal((await client.billingOperation.findFirstOrThrow({ where: { companyId: f.companyId } })).state, 'SUCCEEDED');
      assert.equal(await client.billingIssue.count({ where: { companyId: f.companyId, kind: 'GRACE_CANCELLATION_UNKNOWN', state: 'OPEN' } }), 0);
    });
  } finally {
    const companyIds = fixtures.map(f => f.companyId), accountIds = fixtures.map(f => f.accountId);
    await client.companyOcrUsageEvent.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.companyPlanTerm.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.billingReceiptGrant.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.billingSubscriptionContract.deleteMany({ where: { billingAccountId: { in: accountIds } } });
    await client.billingInvoice.deleteMany({ where: { billingAccountId: { in: accountIds } } });
    await client.billingAttempt.deleteMany({ where: { billingAccountId: { in: accountIds } } });
    await client.billingQuote.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.billingOperation.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.billingIssue.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.billingAccount.deleteMany({ where: { id: { in: accountIds } } });
    await client.auditLog.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.outboxEvent.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.company.deleteMany({ where: { id: { in: companyIds } } });
    await client.$disconnect();
  }
});
